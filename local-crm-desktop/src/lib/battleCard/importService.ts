/**
 * Battle Card Backend V1 — 战前材料导入服务。
 * preview 只读；confirm 单一事务；cancel 零写入。
 * AI 不直接写 CRM：所有持久化经 Repository 与人工 decisions。
 */

import type { DatabaseLike } from '../db';
import { parseIntelligenceMaterial, type IntelligenceDraft } from './parser';
import { BATTLE_CARD_PARSER_VERSION } from './schema';
import { parseFactVerificationsRuntime, isFactVerificationEvidenceRef, type FactVerificationItem } from '../salesAgentTools/confirmedWrite';
import { SqliteCrmEvidenceResolver } from '../customerMemory/repository';
import type { FactApplicability, IntelligenceParseStatus } from './types';
import {
  createBattleCardRepositories,
  sha256Hex,
  type BattleCardRepositories,
} from './repository';
import {
  defaultAtomicWriteBackend,
  createSingleConnectionAtomicWriteBackend,
  type AtomicBattleCardWriteBackend,
  type AtomicImportPayloadV1,
} from '../battleCardUi/atomicWriteBackend';
import { determineApplicability, detectCompositeBusiness } from './parser';

export interface ImportPreviewResult {
  readonly draft: IntelligenceDraft;
  readonly content_hash: string;
  /** 幂等提示：相同 customer+source+hash 已存在。 */
  readonly duplicate_of: string | null;
  readonly writes: 0;
}

export interface ConfirmImportDecisions {
  /** 人工选定客户；缺省/为空时导入行以候选身份落库（不猜 customer_id）。 */
  readonly customer_id?: string | null;
  /** 人工保留的事实（draft.extracted_facts 的 fact_id 子集）；保留即写入，但默认 PENDING（候选），不自动 VERIFIED。 */
  readonly keep_fact_ids?: readonly string[];
  /** 显式核实决策（闭合运行时 Schema）；decision=VERIFY 的事实可成为 VERIFIED（CONDITIONAL 需 scope/product_line + evidence）。 */
  readonly fact_verifications?: readonly FactVerificationItem[];
  /** 人工保留的假设（draft.extracted_hypotheses 的 hypothesis_id 子集）。 */
  readonly keep_hypothesis_ids?: readonly string[];
  /** 人工覆盖：适用性调整等。 */
  readonly fact_overrides?: Readonly<Record<string, { readonly applicability?: FactApplicability }>>;
  readonly confirmed_by?: string;
}

export interface ConfirmImportResult {
  readonly import_id: string;
  readonly customer_id: string | null;
  readonly facts_written: number;
  readonly hypotheses_written: number;
  readonly duplicates_skipped: readonly string[];
  readonly deduped: boolean;
}

export interface CancelImportResult {
  readonly cancelled: true;
  readonly writes: 0;
}

export interface ImportServiceDeps {
  readonly db: DatabaseLike;
  readonly repos?: BattleCardRepositories;
  readonly clock?: () => string;
  readonly source_system?: string;
  readonly source_label?: string | null;
  /** 权威 Import Scope 绑定（P0-B）：Preview 阶段即绑定 customer，candidate_id 跨客户不可复用。 */
  readonly customer_id?: string;
  /** 生产原子事务后端（单次 invoke）；缺省按运行环境自动选择（Tauri → invoke，测试 → 单连接）。 */
  readonly atomic_backend?: AtomicBattleCardWriteBackend;
}

export async function previewIntelligenceImport(
  rawContent: string,
  deps: ImportServiceDeps,
): Promise<ImportPreviewResult> {
  if (!rawContent.trim()) throw new Error('战前材料为空，无法解析。');
  const draft = parseIntelligenceMaterial(rawContent, { customer_id: deps.customer_id ?? '', source_kind: deps.source_system ?? 'MANUAL_PASTE' });
  const contentHash = await sha256Hex(rawContent);

  let duplicateOf: string | null = null;
  if (deps.db) {
    // 幂等提示：同一份材料（source+hash）不应重复导入，无论绑定到哪个客户；confirm 阶段按目标客户二次去重
    const existing = await deps.db.select<{ id: string }>(
      'SELECT id FROM intelligence_imports WHERE source_system = ? AND content_hash = ? LIMIT 1',
      [deps.source_system ?? 'MANUAL_PASTE', contentHash],
    );
    duplicateOf = existing[0]?.id ?? null;
  }

  return {
    draft: { ...draft, content_hash: contentHash, source_system: deps.source_system ?? 'MANUAL_PASTE', source_label: deps.source_label ?? null },
    content_hash: contentHash,
    duplicate_of: duplicateOf,
    writes: 0,
  };
}

export async function confirmIntelligenceImport(
  preview: ImportPreviewResult,
  decisions: ConfirmImportDecisions,
  deps: ImportServiceDeps,
): Promise<ConfirmImportResult> {
  const repos = deps.repos ?? createBattleCardRepositories(deps.db, deps.clock);
  const now = deps.clock?.() ?? new Date().toISOString();
  const draft = preview.draft;
  const contentHash = preview.content_hash;
  const sourceSystem = deps.source_system ?? draft.source_system;
  const customerId = decisions.customer_id?.trim() || null;

  // 客户不明确：只落导入行（候选，customer_id NULL）。单语句写入天然原子，无需事务后端。
  if (!customerId) {
    const existing = await repos.imports.findByDedupKey(null, sourceSystem, contentHash);
    if (existing) {
      return {
        import_id: existing.id,
        customer_id: null,
        facts_written: 0,
        hypotheses_written: 0,
        duplicates_skipped: [],
        deduped: true,
      };
    }
    const importRow = await repos.imports.create({
      id: `import-${now.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`,
      customer_id: null,
      source_system: sourceSystem,
      source_label: deps.source_label ?? draft.source_label,
      raw_content: draft.raw_content,
      content_hash: contentHash,
      parser_version: BATTLE_CARD_PARSER_VERSION,
      parse_status: 'CONFIRMED' as IntelligenceParseStatus,
      created_at: now,
    });
    return {
      import_id: importRow.id,
      customer_id: null,
      facts_written: 0,
      hypotheses_written: 0,
      duplicates_skipped: [],
      deduped: false,
    };
  }

  // 业务计算（只读）：权威重解析 / 语义门禁 / 去重决策 / 行集构造。
  const writeSet = await buildImportWriteSet({
    preview, decisions, deps, repos, now, customerId, sourceSystem, contentHash,
  });
  if (writeSet.deduped) {
    return {
      import_id: writeSet.dedupedImportId as string,
      customer_id: customerId,
      facts_written: 0,
      hypotheses_written: 0,
      duplicates_skipped: [],
      deduped: true,
    };
  }

  // 生产：单次 Tauri invoke —— Rust 在同一物理连接的一个 sqlx Transaction 内完成全部写入。
  const atomic = deps.atomic_backend ?? defaultAtomicWriteBackend();
  if (atomic) {
    const outcome = await atomic.confirmImport(writeSet.payload);
    return {
      import_id: outcome.importId,
      customer_id: customerId,
      facts_written: outcome.factsWritten,
      hypotheses_written: outcome.hypothesesWritten,
      duplicates_skipped: [...writeSet.duplicatesSkipped],
      deduped: false,
    };
  }

  // 测试/无 Tauri 传输：单连接事务写入（与 Rust 同一推导规则；withTransaction 仅对单连接适配器语义正确）。
  const fallback = createSingleConnectionAtomicWriteBackend({ db: deps.db, repos, clock: deps.clock ?? (() => new Date().toISOString()) });
  const outcome = await fallback.confirmImport(writeSet.payload);
  return {
    import_id: outcome.importId,
    customer_id: customerId,
    facts_written: outcome.factsWritten,
    hypotheses_written: outcome.hypothesesWritten,
    duplicates_skipped: [...writeSet.duplicatesSkipped],
    deduped: false,
  };
}

// ── 行集构造（只读业务计算；生产/测试共用，不产生任何写入）──

export interface ImportWriteSet {
  readonly deduped: boolean;
  readonly dedupedImportId: string | null;
  readonly duplicatesSkipped: readonly string[];
  readonly payload: AtomicImportPayloadV1;
}

export async function buildImportWriteSet(input: {
  readonly preview: ImportPreviewResult;
  readonly decisions: ConfirmImportDecisions;
  readonly deps: ImportServiceDeps;
  readonly repos: BattleCardRepositories;
  readonly now: string;
  readonly customerId: string;
  readonly sourceSystem: string;
  readonly contentHash: string;
}): Promise<ImportWriteSet> {
  const { preview, decisions, deps, repos, now, customerId, sourceSystem, contentHash } = input;
  const draft = preview.draft;

  // 幂等去重：customer_id + source_system + content_hash
  const existing = await repos.imports.findByDedupKey(customerId, sourceSystem, contentHash);
  if (existing) {
    return {
      deduped: true,
      dedupedImportId: existing.id,
      duplicatesSkipped: [],
      payload: undefined as unknown as AtomicImportPayloadV1,
    };
  }

  // 权威上下文（与 Rust 同源）：材料全文复合业务判定
  const composite = detectCompositeBusiness(draft.raw_content);

  // 事实（仅人工保留项；无来源不得自动 VERIFIED）
  const keepFactIds = new Set(decisions.keep_fact_ids ?? []);
  const verifications = parseFactVerificationsRuntime(decisions.fact_verifications);
  const verificationByFactId = new Map(verifications.map(item => [item.fact_id, item]));
  const duplicatesSkipped: string[] = [];

  // 权威重解析：Confirm 不信任 preview 内存对象；statement/applicability 必须与 raw_content 重解析一致（防篡改）
  const authoritative = parseIntelligenceMaterial(draft.raw_content, { customer_id: customerId, source_kind: sourceSystem });
  const authoritativeFacts = authoritative.extracted_facts;
  // 语义校验分层：所有 verification 的 fact_id 必须属于当前 import scope（authoritative draft）
  await validateFactVerificationSemantics({
    verifications,
    authoritativeFacts,
    customerId,
    db: deps.db,
  });

  const supersedeFactIds: { factId: string; customerId: string; at: string }[] = [];
  const factDecisions: {
    candidateId: string; decision: 'KEEP' | 'VERIFY';
    applicableScope?: string; productLine?: string; reason?: string;
    supplementalEvidenceRefs?: string[];
  }[] = [];

  for (const fact of draft.extracted_facts) {
    if (!keepFactIds.has(fact.fact_id)) continue;
    const overrides = decisions.fact_overrides?.[fact.fact_id];
    const applicability = overrides?.applicability ?? fact.applicability;

    // 篡改检测：proposed applicability 必须与权威重解析一致
    const authoritativeFact = authoritativeFacts.find(candidate => candidate.statement === fact.statement);
    if (!authoritativeFact) {
      throw new Error(`Import confirm rejected: fact statement not found in authoritative reparse (${fact.fact_id}).`);
    }
    if (fact.applicability !== authoritativeFact.applicability || applicability !== authoritativeFact.applicability) {
      throw new Error(`Import confirm rejected: applicability tamper detected for ${fact.fact_id} (proposed ${applicability}, authoritative ${authoritativeFact.applicability}).`);
    }
    // verification 载荷中的 applicability 同样必须与权威判定一致（防 GLOBAL 篡改）
    const verificationItem = verificationByFactId.get(fact.fact_id);
    if (verificationItem?.applicability !== undefined && verificationItem.applicability !== authoritativeFact.applicability) {
      throw new Error(`Import confirm rejected: verification applicability tamper detected for ${fact.fact_id} (proposed ${verificationItem.applicability}, authoritative ${authoritativeFact.applicability}).`);
    }

    const existingFacts = await repos.facts.findByStatement(customerId, fact.statement);
    const activeDuplicate = existingFacts.find(row => row.verification_status === 'VERIFIED');
    if (activeDuplicate) {
      duplicatesSkipped.push(fact.fact_id);
      continue;
    }
    // 旧 CONFLICTED/SUPERSEDED 同语句事实被新确认事实替代
    for (const stale of existingFacts) {
      if (stale.verification_status === 'CONFLICTED' || stale.verification_status === 'SUPERSEDED') {
        supersedeFactIds.push({ factId: stale.id, customerId, at: now });
      }
    }

    // 显式核实门禁（语义层，与 Rust 推导同源）：decision=VERIFY 才可 VERIFIED；
    // CONDITIONAL 必须带 scope/product_line（Primary Evidence 由 Rust 自动生成，不在此处构造）
    const authoritativeApplicability = determineApplicability(fact.statement, composite);
    if (verificationItem && verificationItem.decision === 'VERIFY') {
      const hasScope = Boolean(verificationItem.applicable_scope?.trim() || verificationItem.product_line?.trim());
      if (authoritativeApplicability === 'CONDITIONAL' && !hasScope) {
        throw new Error(`Import confirm rejected: CONDITIONAL fact ${fact.fact_id} requires applicable_scope/product_line before VERIFIED.`);
      }
    }
    const decision = verificationItem?.decision === 'VERIFY' ? 'VERIFY' as const : 'KEEP' as const;
    factDecisions.push({
      candidateId: fact.fact_id,
      decision,
      ...(verificationItem?.applicable_scope?.trim() ? { applicableScope: verificationItem.applicable_scope.trim() } : {}),
      ...(verificationItem?.product_line?.trim() ? { productLine: verificationItem.product_line.trim() } : {}),
      ...(verificationItem?.reason?.trim() ? { reason: verificationItem.reason.trim() } : {}),
    });
  }

  // 假设（仅人工保留项；状态审计由事务层落库）
  const keepHypothesisIds = new Set(decisions.keep_hypothesis_ids ?? []);
  const hypothesisCandidateIds: string[] = [];
  for (const hypothesis of draft.extracted_hypotheses) {
    if (!keepHypothesisIds.has(hypothesis.hypothesis_id)) continue;
    hypothesisCandidateIds.push(hypothesis.hypothesis_id);
  }

  return {
    deduped: false,
    dedupedImportId: null,
    duplicatesSkipped,
    payload: {
      customerId,
      importRow: {
        sourceSystem,
        sourceLabel: deps.source_label ?? draft.source_label,
        rawContent: draft.raw_content,
        contentHash,
        parserVersion: BATTLE_CARD_PARSER_VERSION,
      },
      supersedeFactIds,
      factDecisions,
      hypothesisCandidateIds,
    },
  };
}

/** 单连接事务写入（测试/无 Tauri 传输；withTransaction 仅对单连接适配器语义正确）。 */
export async function cancelIntelligenceImport(_preview: ImportPreviewResult): Promise<CancelImportResult> {
  // Cancel 零写入：不产生任何业务数据，不落 parse_status。
  return { cancelled: true, writes: 0 };
}

/**
 * 语义门禁（分层：结构校验见 parseFactVerificationsRuntime，本函数只做业务语义）。
 * 结构合法 ≠ 业务合法：fact_id 必须属于当前 import scope；evidence 必须真实存在且同客户；
 * 不得跨客户引用；不得携带 stage/grade/priority/ownership 等业务越权字段（闭合 Schema 已排除）。
 */
export async function validateFactVerificationSemantics(input: {
  readonly verifications: readonly FactVerificationItem[];
  readonly authoritativeFacts: readonly { readonly fact_id: string; readonly statement: string; readonly applicability: FactApplicability }[];
  readonly customerId: string;
  readonly db: DatabaseLike;
}): Promise<void> {
  const { verifications, authoritativeFacts, customerId, db } = input;
  const factIds = new Set(authoritativeFacts.map(fact => fact.fact_id));
  const evidenceResolver = new SqliteCrmEvidenceResolver(db);
  for (const verification of verifications) {
    // 1) fact_id 必须属于当前 import scope（当前 customer 与当前 draft）
    if (!factIds.has(verification.fact_id)) {
      throw new Error(`Import confirm rejected: fact_id ${verification.fact_id} is not part of the current import scope.`);
    }
    // 2/3/4) evidence_refs 必须真实存在且属于同一 customer（CRM evidence）或 import 材料引用
    for (const ref of verification.evidence_refs ?? []) {
      if (ref.startsWith('import:')) continue; // 材料内引用，不查 CRM
      if (isFactVerificationEvidenceRef(ref)) {
        const match = ref.match(/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):(.+)$/);
        const type = match?.[1] as 'CUSTOMER' | 'FOLLOW_UP_RECORD' | 'VISIT_RECORD' | 'TASK';
        const id = match?.[2] ?? '';
        const exists = await evidenceResolver.exists(customerId, type, id);
        if (!exists) {
          throw new Error(`Import confirm rejected: evidence ${ref} does not exist for customer ${customerId}.`);
        }
      } else {
        throw new Error(`Import confirm rejected: evidence ref ${ref.slice(0, 40)} is not import: nor a CRM evidence reference.`);
      }
    }
    // 5) CONDITIONAL → VERIFY 必须带 scope/product_line + evidence（缺一拒绝）
    const authoritativeFact = authoritativeFacts.find(fact => fact.fact_id === verification.fact_id);
    if (authoritativeFact && verification.decision === 'VERIFY') {
      if (authoritativeFact.applicability === 'CONDITIONAL') {
        const hasScope = Boolean(verification.applicable_scope?.trim() || verification.product_line?.trim());
        const hasEvidence = (verification.evidence_refs?.length ?? 0) > 0;
        if (!hasScope || !hasEvidence) {
          throw new Error(`Import confirm rejected: CONDITIONAL fact ${verification.fact_id} requires applicable_scope/product_line and evidence refs before VERIFIED.`);
        }
      }
      // 6) authoritative 判定 CONDITIONAL 时，payload 不得提交为 GLOBAL
      if (verification.applicability !== undefined && verification.applicability !== authoritativeFact.applicability) {
        throw new Error(`Import confirm rejected: verification applicability tamper detected for ${verification.fact_id}.`);
      }
    }
  }
}
