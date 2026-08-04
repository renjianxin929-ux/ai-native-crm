/**
 * Battle Card UI — 生产原子事务写后端（TS 侧唯一 invoke 桥）。
 *
 * 生产环境：confirmIntelligenceImport / confirmStageCard 的持久化经**单次** Tauri invoke
 * 由 Rust 侧在同一物理 SQLite 连接的一个 sqlx Transaction 内完成（见
 * src-tauri/src/battle_card_transactions.rs 与 battle_card_authoritative.rs）。
 *
 * ## 权威 Candidate 合同（本轮）
 * - DTO 只接受 candidate_id（Authoritative Candidate ID）+ 人工决策；
 * - Renderer 不得提供 statement / fact_category / confidence / verificationStatus /
 *   applicability / evidenceRefsJson / 行 id / 时间戳；
 * - 正文、适用性、Primary Import Source Evidence 全部由 Rust 从 raw_content
 *   权威重解析并自动生成；Supplemental CRM Evidence 可选（真实查表）；
 * - 测试环境使用单连接适配器，与 Rust 共享同一解析规则（TS parser 同源输出）。
 */

import { invoke } from '@tauri-apps/api/core';
import type { DatabaseLike } from '../db';
import { withTransaction } from '../battleCard/repository';
import { buildImportScopeId, parseIntelligenceMaterial, SOURCE_SPAN_CONTRACT_VERSION } from '../battleCard/parser';
import { sha256HexSync } from '../salesAgentTools/confirmedWrite';
import { deriveVerificationStatusForWriteSet } from './applicabilityDerivation';

// ── 闭合 DTO（对应 Rust serde camelCase + deny_unknown_fields）──

export interface AtomicFactDecisionV1 {
  /** 权威 Candidate ID（TS parser 生成；Rust 重解析校验）。 */
  readonly candidateId: string;
  /** KEEP | VERIFY（人工决策）。 */
  readonly decision: 'KEEP' | 'VERIFY';
  readonly applicableScope?: string;
  readonly productLine?: string;
  readonly reason?: string;
  /** 补充 CRM Evidence（CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK:id）。 */
  readonly supplementalEvidenceRefs?: readonly string[];
}

/** 对应 Rust BattleCardImportPayloadV1（camelCase 序列化）。 */
export interface AtomicImportPayloadV1 {
  readonly customerId: string;
  readonly importRow: {
    readonly sourceSystem: string;
    readonly sourceLabel: string | null;
    readonly rawContent: string;
    readonly contentHash: string;
    readonly parserVersion: string;
  };
  readonly supersedeFactIds: readonly { readonly factId: string; readonly customerId: string; readonly at: string }[];
  readonly factDecisions: readonly AtomicFactDecisionV1[];
  /** 保留的 Hypothesis 权威 Candidate ID 列表。 */
  readonly hypothesisCandidateIds: readonly string[];
}

export interface AtomicImportResultV1 {
  readonly importId: string;
  readonly factsWritten: number;
  readonly hypothesesWritten: number;
  readonly duplicatesSkipped: number;
  readonly deduped: boolean;
}

/** 对应 Rust BattleCardStageCardPayloadV1。 */
export interface AtomicStageCardPayloadV1 {
  readonly customerId: string;
  readonly cardId: string;
  readonly expectedVersion: number;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

export interface AtomicStageCardResultV1 {
  readonly cardId: string;
  readonly cardStatus: string;
  readonly confirmedAt: string;
  readonly currentStageCardId: string;
}

export interface AtomicBattleCardWriteBackend {
  readonly kind: 'TAURI_INVOKE' | 'SINGLE_CONNECTION_TEST';
  confirmImport(payload: AtomicImportPayloadV1): Promise<AtomicImportResultV1>;
  confirmStageCard(payload: AtomicStageCardPayloadV1): Promise<AtomicStageCardResultV1>;
}

/** 生产环境判定：Tauri WebView 暴露 __TAURI_INTERNALS__（vitest node 环境无 window）。 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const IMPORT_COMMAND = 'confirm_battle_card_import_atomic_v1';
const STAGE_CARD_COMMAND = 'confirm_battle_card_stage_card_atomic_v1';

/** 生产后端：单次 invoke，Rust 侧同一连接单事务。 */
export function createTauriAtomicWriteBackend(): AtomicBattleCardWriteBackend {
  return {
    kind: 'TAURI_INVOKE',
    async confirmImport(payload) {
      return invoke<AtomicImportResultV1>(IMPORT_COMMAND, { payload });
    },
    async confirmStageCard(payload) {
      return invoke<AtomicStageCardResultV1>(STAGE_CARD_COMMAND, { payload });
    },
  };
}

/** 默认装配：Tauri 环境 → invoke 后端；否则 undefined（测试走旧单连接路径）。 */
export function defaultAtomicWriteBackend(): AtomicBattleCardWriteBackend | undefined {
  return isTauriRuntime() ? createTauriAtomicWriteBackend() : undefined;
}

// ── 单连接测试后端（vitest 冻结语义测试用；与 Rust 同一解析规则）──

export interface SingleConnectionTestBackendDeps {
  readonly db: DatabaseLike;
  readonly repos: import('../battleCard/repository').BattleCardRepositories;
  readonly clock: () => string;
}

/** 测试后端轻量 CRM evidence 校验（import ref 不允许作为 supplemental）。 */
async function resolveTestEvidence(
  db: DatabaseLike,
  customerId: string,
  refText: string,
): Promise<{ evidence_type: string; evidence_id: string }> {
  if (refText.startsWith('import:')) {
    throw new Error(`Test atomic backend: supplemental evidence ref must be a CRM record: ${refText.slice(0, 40)}`);
  }
  const match = refText.match(/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):(.+)$/);
  if (!match) throw new Error(`Test atomic backend: evidence ref ${refText.slice(0, 40)} has no valid type prefix.`);
  const evidenceType = match[1] as 'CUSTOMER' | 'FOLLOW_UP_RECORD' | 'VISIT_RECORD' | 'TASK';
  const evidenceId = match[2] ?? '';
  if (!evidenceId.trim()) throw new Error('Test atomic backend: evidence id must not be empty.');
  if (evidenceType === 'CUSTOMER') {
    if (evidenceId !== customerId) throw new Error('Test atomic backend: evidence customer mismatch (CUSTOMER).');
    const rows = await db.select<{ id: string }>('SELECT id FROM customers WHERE id = ?', [evidenceId]);
    if (rows.length === 0) throw new Error('Test atomic backend: evidence does not exist (CUSTOMER).');
  } else {
    const table = evidenceType === 'FOLLOW_UP_RECORD' ? 'follow_up_records' : evidenceType === 'VISIT_RECORD' ? 'visit_records' : 'tasks';
    const rows = await db.select<{ customer_id: string | null }>(`SELECT customer_id FROM ${table} WHERE id = ?`, [evidenceId]);
    if (rows.length === 0) throw new Error(`Test atomic backend: evidence does not exist (${evidenceType}).`);
    if (rows[0]?.customer_id !== customerId) throw new Error(`Test atomic backend: evidence customer mismatch (${evidenceType}).`);
  }
  return { evidence_type: evidenceType, evidence_id: evidenceId };
}

/**
 * 单连接测试后端：用 withTransaction（better-sqlite3 单连接）按 payload 决策写入。
 * 与 Rust 同一权威规则：正文/适用性来自 TS parser 的权威候选（fact_id = candidate_id），
 * Primary Import Source Evidence 自动生成，Supplemental 查表校验。仅测试环境使用。
 */
export function createSingleConnectionAtomicWriteBackend(deps: SingleConnectionTestBackendDeps): AtomicBattleCardWriteBackend {
  const { db, repos } = deps;
  return {
    kind: 'SINGLE_CONNECTION_TEST',
    async confirmImport(payload) {
      const importRow = payload.importRow;
      const existing = await repos.imports.findByDedupKey(payload.customerId, importRow.sourceSystem, importRow.contentHash);
      if (existing) {
        return { importId: existing.id, factsWritten: 0, hypothesesWritten: 0, duplicatesSkipped: 0, deduped: true };
      }
      // 权威重解析（与 Rust 同规则；fact_id/hypothesis_id 即 candidate_id）
      const draft = parseIntelligenceMaterial(importRow.rawContent, {
        customer_id: payload.customerId,
        source_kind: importRow.sourceSystem,
      });
      // P0-B：Authoritative Import Scope（与 Rust 同一合同；candidate 跨客户不可复用）
      const testImportScopeId = buildImportScopeId({
        customerId: payload.customerId,
        rawContentSha256: sha256HexSync(importRow.rawContent),
        parserContractVersion: draft.parser_version,
        sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
        sourceKind: importRow.sourceSystem,
      });
      const factById = new Map(draft.extracted_facts.map(fact => [fact.fact_id, fact]));
      const hypothesisById = new Map(draft.extracted_hypotheses.map(hypothesis => [hypothesis.hypothesis_id, hypothesis]));
      return withTransaction(db, async () => {
        const created = await repos.imports.create({
          id: `import-test-${Math.random().toString(36).slice(2, 10)}`,
          customer_id: payload.customerId,
          source_system: importRow.sourceSystem,
          source_label: importRow.sourceLabel,
          raw_content: importRow.rawContent,
          content_hash: importRow.contentHash,
          parser_version: importRow.parserVersion,
          parse_status: 'CONFIRMED',
          created_at: deps.clock(),
        });
        for (const supersede of payload.supersedeFactIds) {
          if (supersede.customerId !== payload.customerId) throw new Error('Test atomic backend: supersede customer mismatch.');
          await repos.facts.markSuperseded(supersede.factId, supersede.at);
        }
        for (const [index, factDecision] of payload.factDecisions.entries()) {
          const candidate = factById.get(factDecision.candidateId);
          if (!candidate) throw new Error(`Test atomic backend: candidate_id ${factDecision.candidateId.slice(0, 24)} not found in authoritative reparse.`);
          // Primary Import Source Evidence（自动生成；结构同 Rust）
          const primary = {
            evidence_type: 'IMPORT_SOURCE' as const,
            import_id: created.id,
            customer_id: payload.customerId,
            import_scope_id: testImportScopeId,
            parser_contract_version: candidate.parser_contract_version,
            source_span_contract_version: candidate.source_span_contract_version,
            source_section: candidate.source_section as string,
            start_byte: candidate.start_byte,
            end_byte: candidate.end_byte,
            excerpt_sha256: candidate.excerpt_sha256,
            statement_sha256: candidate.statement_sha256,
          };
          const supplemental = [];
          const seen = new Set<string>();
          for (const refText of factDecision.supplementalEvidenceRefs ?? []) {
            if (seen.has(refText)) throw new Error(`Test atomic backend: duplicate supplemental evidence ref for ${factDecision.candidateId.slice(0, 24)}.`);
            seen.add(refText);
            supplemental.push(await resolveTestEvidence(db, payload.customerId, refText) as import('../battleCard/types').FactEvidenceRef);
          }
          const hasScope = Boolean(factDecision.applicableScope?.trim() || factDecision.productLine?.trim());
          const status = deriveVerificationStatusForWriteSet({
            decision: factDecision.decision,
            applicability: candidate.applicability,
            hasScopeOrProductLine: hasScope,
            primaryEvidencePresent: true,
          });
          await repos.facts.insert({
            id: `fact-${created.id}-${index + 1}`,
            customer_id: payload.customerId,
            source_import_id: created.id,
            fact_category: candidate.fact_category,
            statement: candidate.statement,
            normalized_value_json: null,
            verification_status: status,
            confidence: 0.8,
            applicability: candidate.applicability,
            observed_at: deps.clock(),
            valid_until: null,
            evidence_refs: [primary, ...supplemental],
            created_at: deps.clock(),
          });
        }
        for (const [index, candidateId] of payload.hypothesisCandidateIds.entries()) {
          const candidate = hypothesisById.get(candidateId);
          if (!candidate) throw new Error(`Test atomic backend: hypothesis candidate_id ${candidateId.slice(0, 24)} not found in authoritative reparse.`);
          const primary = {
            evidence_type: 'IMPORT_SOURCE' as const,
            import_id: created.id,
            customer_id: payload.customerId,
            import_scope_id: testImportScopeId,
            parser_contract_version: candidate.parser_contract_version,
            source_span_contract_version: candidate.source_span_contract_version,
            source_section: candidate.source_section as string,
            start_byte: candidate.start_byte,
            end_byte: candidate.end_byte,
            excerpt_sha256: candidate.excerpt_sha256,
            statement_sha256: candidate.statement_sha256,
          };
          await repos.hypotheses.insert({
            id: `hyp-${created.id}-${index + 1}`,
            customer_id: payload.customerId,
            source_import_id: created.id,
            category: candidate.category,
            statement: candidate.statement,
            rationale: candidate.rationale,
            status: 'PENDING',
            applicability: candidate.applicability,
            why_it_matters: candidate.why_it_matters,
            validation_question: candidate.validation_question,
            disconfirm_condition: candidate.disconfirm_condition,
            evidence_refs: [primary],
            created_at: deps.clock(),
          });
        }
        return { importId: created.id, factsWritten: payload.factDecisions.length, hypothesesWritten: payload.hypothesisCandidateIds.length, duplicatesSkipped: 0, deduped: false };
      });
    },
    async confirmStageCard(payload) {
      const card = await repos.cards.get(payload.cardId);
      if (!card) throw new Error(`Stage card does not exist: ${payload.cardId}`);
      if (card.customer_id !== payload.customerId) throw new Error('Stage card customer mismatch.');
      const confirmed = await repos.cards.confirm(payload.cardId, payload.confirmedBy, payload.confirmedAt);
      return {
        cardId: confirmed.id,
        cardStatus: confirmed.card_status,
        confirmedAt: confirmed.confirmed_at ?? payload.confirmedAt,
        currentStageCardId: confirmed.id,
      };
    },
  };
}
