/**
 * Battle Card Backend V1 — Repository 层。
 * 所有持久化必须经过本层；AI/领域服务不直接写 SQL。
 * Evidence ownership 复用现有 SqliteCrmEvidenceResolver（customerMemory/repository.ts）。
 */

import type { DatabaseLike } from '../db';
import { SqliteCrmEvidenceResolver } from '../customerMemory/repository';
import { createEvidenceRepository } from '../evidence';
import { defaultAtomicWriteBackend } from '../battleCardUi/atomicWriteBackend';
import type {
  CustomerHypothesisInput,
  CustomerHypothesisRow,
  CustomerStageCardInput,
  CustomerStageCardRow,
  FactEvidenceRef,
  HypothesisStatus,
  HypothesisStatusAuditEntry,
  IntelligenceImportInput,
  IntelligenceImportRow,
  IntelligenceParseStatus,
  ReviewedFactInput,
  ReviewedFactRow,
  StageCardStatus,
} from './types';

// ── 基础工具 ──

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 单事务包装：失败整体回滚。
 *
 * ⚠️ 语义边界：仅对**单物理连接**适配器（测试 better-sqlite3 / 内存库）成立。
 * 生产传输 tauri-plugin-sql（sqlx Pool）每次 execute 可能命中不同池连接，裸
 * BEGIN/COMMIT/ROLLBACK 不构成可靠事务（已实测可产生部分提交）。
 * 生产写入必须经 battleCardUi/atomicWriteBackend（单次 Tauri invoke + Rust 单连接事务）。
 * 生产代码禁止调用本 helper。
 */
export async function withTransaction<T>(
  db: DatabaseLike,
  work: () => Promise<T>,
): Promise<T> {
  await db.execute('BEGIN');
  try {
    const result = await work();
    await db.execute('COMMIT');
    return result;
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

export function parseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : fallback;
  } catch {
    return fallback;
  }
}

// ── Evidence ownership 校验（复用现有 Evidence 模型）──

export class BattleCardEvidenceGuard {
  private readonly resolver: SqliteCrmEvidenceResolver;
  private readonly evidence: ReturnType<typeof createEvidenceRepository>;

  constructor(db: DatabaseLike) {
    this.resolver = new SqliteCrmEvidenceResolver(db);
    this.evidence = createEvidenceRepository(db);
  }

  async assertAll(customerId: string, refs: readonly FactEvidenceRef[]): Promise<void> {
    for (const ref of refs) {
      if (ref.import_ref && ref.import_ref.trim()) continue;
      // IMPORT_SOURCE：权威层自动生成的导入来源证据，无需查 CRM resolver
      if (ref.evidence_type === 'IMPORT_SOURCE') continue;
      // EVIDENCE（B1）：Battle Card 引用一等 Evidence 实体（customer-scoped 存在性校验）
      if (ref.evidence_type === 'EVIDENCE') {
        if (!ref.evidence_id) {
          throw new Error(`Battle card evidence ref is invalid for customer ${customerId}: ${JSON.stringify(ref)}`);
        }
        const owned = await this.evidence.exists(customerId, ref.evidence_id);
        if (!owned) {
          throw new Error(`Battle card evidence ownership failed: EVIDENCE:${ref.evidence_id} for customer ${customerId}`);
        }
        continue;
      }
      if (!ref.evidence_type || !ref.evidence_id) {
        throw new Error(`Battle card evidence ref is invalid for customer ${customerId}: ${JSON.stringify(ref)}`);
      }
      const exists = await this.resolver.exists(customerId, ref.evidence_type, ref.evidence_id);
      if (!exists) {
        throw new Error(`Battle card evidence ownership failed: ${ref.evidence_type}:${ref.evidence_id} for customer ${customerId}`);
      }
    }
  }
}

// ── IntelligenceImportRepository ──

export interface IntelligenceImportRepository {
  create(input: IntelligenceImportInput): Promise<IntelligenceImportRow>;
  findByDedupKey(customerId: string | null, sourceSystem: string, contentHash: string): Promise<IntelligenceImportRow | null>;
  get(id: string): Promise<IntelligenceImportRow | null>;
  listByCustomer(customerId: string): Promise<IntelligenceImportRow[]>;
  updateStatus(id: string, status: IntelligenceParseStatus, at: string): Promise<void>;
}

export function createIntelligenceImportRepository(
  db: DatabaseLike,
  clock: () => string = () => new Date().toISOString(),
): IntelligenceImportRepository {
  return {
    async create(input) {
      const now = clock();
      await db.execute(
        `INSERT INTO intelligence_imports
         (id, customer_id, source_system, source_label, raw_content, content_hash,
          parser_version, parse_status, confirmed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.customer_id, input.source_system, input.source_label, input.raw_content,
          input.content_hash, input.parser_version, input.parse_status,
          input.parse_status === 'CONFIRMED' ? now : null, input.created_at, now],
      );
      const row = await this.get(input.id);
      if (!row) throw new Error('Intelligence import insert failed.');
      return row;
    },
    async findByDedupKey(customerId, sourceSystem, contentHash) {
      if (!customerId) {
        const rows = await db.select<IntelligenceImportRow>(
          'SELECT * FROM intelligence_imports WHERE customer_id IS NULL AND source_system = ? AND content_hash = ? LIMIT 1',
          [sourceSystem, contentHash],
        );
        return rows[0] ?? null;
      }
      const rows = await db.select<IntelligenceImportRow>(
        'SELECT * FROM intelligence_imports WHERE customer_id = ? AND source_system = ? AND content_hash = ? LIMIT 1',
        [customerId, sourceSystem, contentHash],
      );
      return rows[0] ?? null;
    },
    async get(id) {
      const rows = await db.select<IntelligenceImportRow>('SELECT * FROM intelligence_imports WHERE id = ?', [id]);
      return rows[0] ?? null;
    },
    async listByCustomer(customerId) {
      return db.select<IntelligenceImportRow>(
        'SELECT * FROM intelligence_imports WHERE customer_id = ? ORDER BY created_at DESC, id DESC',
        [customerId],
      );
    },
    async updateStatus(id, status, at) {
      await db.execute(
        'UPDATE intelligence_imports SET parse_status = ?, updated_at = ? WHERE id = ?',
        [status, at, id],
      );
    },
  };
}

// ── ReviewedFactRepository ──

export interface ReviewedFactRepository {
  insertMany(facts: readonly ReviewedFactInput[]): Promise<ReviewedFactRow[]>;
  insert(fact: ReviewedFactInput): Promise<ReviewedFactRow>;
  get(id: string): Promise<ReviewedFactRow | null>;
  listByCustomer(customerId: string, opts?: { readonly verification_status?: string }): Promise<ReviewedFactRow[]>;
  /** 同客户同 statement 的已有事实（用于冲突检测与幂等）。 */
  findByStatement(customerId: string, statement: string): Promise<ReviewedFactRow[]>;
  markConflicted(id: string, reason: string, at: string): Promise<void>;
  markSuperseded(id: string, at: string): Promise<void>;
}

function factRowToModel(row: ReviewedFactRow): ReviewedFactRow {
  return row;
}

export function createReviewedFactRepository(
  db: DatabaseLike,
  clock: () => string = () => new Date().toISOString(),
): ReviewedFactRepository {
  return {
    async insertMany(facts) {
      const rows: ReviewedFactRow[] = [];
      for (const fact of facts) {
        rows.push(await this.insert(fact));
      }
      return rows;
    },
    async insert(fact) {
      const now = clock();
      await db.execute(
        `INSERT INTO reviewed_facts
         (id, customer_id, source_import_id, fact_category, statement, normalized_value_json,
          verification_status, confidence, applicability, observed_at, valid_until,
          evidence_refs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fact.id, fact.customer_id, fact.source_import_id, fact.fact_category, fact.statement,
          fact.normalized_value_json ?? null, fact.verification_status, fact.confidence,
          fact.applicability, fact.observed_at ?? null, fact.valid_until ?? null,
          JSON.stringify(fact.evidence_refs), fact.created_at, now],
      );
      const row = await this.get(fact.id);
      if (!row) throw new Error('Reviewed fact insert failed.');
      return row;
    },
    async get(id) {
      const rows = await db.select<ReviewedFactRow>('SELECT * FROM reviewed_facts WHERE id = ?', [id]);
      return rows[0] ? factRowToModel(rows[0]) : null;
    },
    async listByCustomer(customerId, opts) {
      if (opts?.verification_status) {
        return db.select<ReviewedFactRow>(
          'SELECT * FROM reviewed_facts WHERE customer_id = ? AND verification_status = ? ORDER BY created_at ASC, id ASC',
          [customerId, opts.verification_status],
        );
      }
      return db.select<ReviewedFactRow>(
        'SELECT * FROM reviewed_facts WHERE customer_id = ? ORDER BY created_at ASC, id ASC',
        [customerId],
      );
    },
    async findByStatement(customerId, statement) {
      const normalized = statement.trim();
      return db.select<ReviewedFactRow>(
        'SELECT * FROM reviewed_facts WHERE customer_id = ? AND statement = ?',
        [customerId, normalized],
      );
    },
    async markConflicted(id, reason, at) {
      await db.execute(
        `UPDATE reviewed_facts SET verification_status = 'CONFLICTED', updated_at = ?
         WHERE id = ? AND verification_status != 'CONFLICTED'`,
        [at, id],
      );
      void reason;
    },
    async markSuperseded(id, at) {
      await db.execute(
        `UPDATE reviewed_facts SET verification_status = 'SUPERSEDED', updated_at = ?
         WHERE id = ? AND verification_status != 'SUPERSEDED'`,
        [at, id],
      );
    },
  };
}

// ── HypothesisRepository ──

export interface HypothesisRepository {
  insertMany(hypotheses: readonly CustomerHypothesisInput[]): Promise<CustomerHypothesisRow[]>;
  insert(hypothesis: CustomerHypothesisInput): Promise<CustomerHypothesisRow>;
  get(id: string): Promise<CustomerHypothesisRow | null>;
  listByCustomer(customerId: string, opts?: { readonly status?: HypothesisStatus }): Promise<CustomerHypothesisRow[]>;
  listOpen(customerId: string): Promise<CustomerHypothesisRow[]>;
  /** 乐观锁更新状态；每次变化追加审计；resolved 时写 resolved_at。 */
  updateStatus(input: {
    id: string;
    newStatus: HypothesisStatus;
    by: string;
    reason: string | null;
    expectedUpdatedAt?: string;
    at: string;
  }): Promise<CustomerHypothesisRow>;
}

export function createHypothesisRepository(
  db: DatabaseLike,
  clock: () => string = () => new Date().toISOString(),
): HypothesisRepository {
  return {
    async insertMany(hypotheses) {
      const rows: CustomerHypothesisRow[] = [];
      for (const hypothesis of hypotheses) {
        rows.push(await this.insert(hypothesis));
      }
      return rows;
    },
    async insert(hypothesis) {
      const now = clock();
      const audit: HypothesisStatusAuditEntry[] = [{
        at: now,
        old_status: 'PENDING',
        new_status: hypothesis.status,
        by: 'HUMAN_CONFIRM',
        reason: '导入确认时创建',
      }];
      await db.execute(
        `INSERT INTO customer_hypotheses
         (id, customer_id, source_import_id, category, statement, rationale, status,
          applicability, why_it_matters, validation_question, disconfirm_condition,
          evidence_refs_json, status_audit_json, created_at, resolved_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [hypothesis.id, hypothesis.customer_id, hypothesis.source_import_id, hypothesis.category,
          hypothesis.statement, hypothesis.rationale ?? null, hypothesis.status,
          hypothesis.applicability, hypothesis.why_it_matters ?? null,
          hypothesis.validation_question ?? null, hypothesis.disconfirm_condition ?? null,
          JSON.stringify(hypothesis.evidence_refs), JSON.stringify(audit),
          hypothesis.created_at,
          hypothesis.status === 'CONFIRMED' || hypothesis.status === 'REJECTED' || hypothesis.status === 'EXPIRED' ? now : null,
          now],
      );
      const row = await this.get(hypothesis.id);
      if (!row) throw new Error('Customer hypothesis insert failed.');
      return row;
    },
    async get(id) {
      const rows = await db.select<CustomerHypothesisRow>('SELECT * FROM customer_hypotheses WHERE id = ?', [id]);
      return rows[0] ?? null;
    },
    async listByCustomer(customerId, opts) {
      if (opts?.status) {
        return db.select<CustomerHypothesisRow>(
          'SELECT * FROM customer_hypotheses WHERE customer_id = ? AND status = ? ORDER BY created_at ASC, id ASC',
          [customerId, opts.status],
        );
      }
      return db.select<CustomerHypothesisRow>(
        'SELECT * FROM customer_hypotheses WHERE customer_id = ? ORDER BY created_at ASC, id ASC',
        [customerId],
      );
    },
    async listOpen(customerId) {
      return db.select<CustomerHypothesisRow>(
        `SELECT * FROM customer_hypotheses WHERE customer_id = ? AND status IN ('PENDING', 'PARTIALLY_CONFIRMED')
         ORDER BY created_at ASC, id ASC`,
        [customerId],
      );
    },
    async updateStatus({ id, newStatus, by, reason, expectedUpdatedAt, at }) {
      const existing = await this.get(id);
      if (!existing) throw new Error(`Customer hypothesis does not exist: ${id}`);
      if (expectedUpdatedAt !== undefined && existing.updated_at !== expectedUpdatedAt) {
        throw new Error(`Customer hypothesis version conflict: expected updated_at ${expectedUpdatedAt}, actual ${existing.updated_at}`);
      }
      const audit = parseJsonArray<HypothesisStatusAuditEntry>(existing.status_audit_json);
      audit.push({ at, old_status: existing.status, new_status: newStatus, by, reason });
      const resolvedAt = ['CONFIRMED', 'REJECTED', 'EXPIRED'].includes(newStatus) ? at : null;
      await db.execute(
        `UPDATE customer_hypotheses
         SET status = ?, status_audit_json = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`,
        [newStatus, JSON.stringify(audit), resolvedAt, at, id],
      );
      const row = await this.get(id);
      if (!row) throw new Error('Customer hypothesis update failed.');
      return row;
    },
  };
}

// ── StageCardRepository ──

export interface StageCardRepository {
  nextVersion(customerId: string, stageCode: string): Promise<number>;
  insert(card: CustomerStageCardInput): Promise<CustomerStageCardRow>;
  get(id: string): Promise<CustomerStageCardRow | null>;
  listByCustomer(customerId: string): Promise<CustomerStageCardRow[]>;
  latestForStage(customerId: string, stageCode: string): Promise<CustomerStageCardRow | null>;
  latestForStageWithStatus(customerId: string, stageCode: string, status: StageCardStatus): Promise<CustomerStageCardRow | null>;
  /** DRAFT → CONFIRMED，并更新 customers 指针；同一事务。 */
  confirm(cardId: string, by: string, at: string): Promise<CustomerStageCardRow>;
}

export function createStageCardRepository(
  db: DatabaseLike,
  _clock: () => string = () => new Date().toISOString(),
  backend?: () => import('../battleCardUi/atomicWriteBackend').AtomicBattleCardWriteBackend | undefined,
): StageCardRepository {
  const atomic = backend ?? (() => defaultAtomicWriteBackend());
  return {
    async nextVersion(customerId, stageCode) {
      const rows = await db.select<{ max_version: number | null }>(
        'SELECT MAX(version) AS max_version FROM customer_stage_cards WHERE customer_id = ? AND stage_code = ?',
        [customerId, stageCode],
      );
      return Number(rows[0]?.max_version ?? 0) + 1;
    },
    async insert(card) {
      await db.execute(
        `INSERT INTO customer_stage_cards
         (id, customer_id, stage_code, version, schema_version, card_status, source_import_id,
          supersedes_card_id, payload_json, evidence_snapshot_hash, generated_by, confirmed_by,
          created_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [card.id, card.customer_id, card.stage_code, card.version, card.schema_version,
          card.card_status, card.source_import_id, card.supersedes_card_id, card.payload_json,
          card.evidence_snapshot_hash, card.generated_by, card.confirmed_by, card.created_at,
          card.confirmed_at],
      );
      const row = await this.get(card.id);
      if (!row) throw new Error('Stage card insert failed.');
      return row;
    },
    async get(id) {
      const rows = await db.select<CustomerStageCardRow>('SELECT * FROM customer_stage_cards WHERE id = ?', [id]);
      return rows[0] ?? null;
    },
    async listByCustomer(customerId) {
      return db.select<CustomerStageCardRow>(
        'SELECT * FROM customer_stage_cards WHERE customer_id = ? ORDER BY created_at ASC, version ASC, id ASC',
        [customerId],
      );
    },
    async latestForStage(customerId, stageCode) {
      const rows = await db.select<CustomerStageCardRow>(
        'SELECT * FROM customer_stage_cards WHERE customer_id = ? AND stage_code = ? ORDER BY version DESC, id DESC LIMIT 1',
        [customerId, stageCode],
      );
      return rows[0] ?? null;
    },
    async latestForStageWithStatus(customerId, stageCode, status) {
      const rows = await db.select<CustomerStageCardRow>(
        'SELECT * FROM customer_stage_cards WHERE customer_id = ? AND stage_code = ? AND card_status = ? ORDER BY version DESC, id DESC LIMIT 1',
        [customerId, stageCode, status],
      );
      return rows[0] ?? null;
    },
    async confirm(cardId, by, at) {
      // 生产：单次 Tauri invoke（Rust 同一连接单事务）。
      const atomicBackend = atomic();
      if (atomicBackend) {
        const card = await this.get(cardId);
        if (!card) throw new Error(`Stage card does not exist: ${cardId}`);
        if (card.card_status !== 'DRAFT') throw new Error(`Stage card is not a draft: ${cardId}`);
        const outcome = await atomicBackend.confirmStageCard({
          customerId: card.customer_id,
          cardId,
          expectedVersion: card.version,
          confirmedBy: by,
          confirmedAt: at,
        });
        if (outcome.cardStatus !== 'CONFIRMED') {
          throw new Error('Stage card confirm failed.');
        }
        const row = await this.get(cardId);
        if (!row) throw new Error('Stage card confirm failed.');
        return { ...row, card_status: 'CONFIRMED' as StageCardStatus, confirmed_by: by, confirmed_at: at };
      }
      // 测试/无 Tauri 传输：单连接事务（withTransaction 仅对单连接适配器语义正确）。
      return withTransaction(db, async () => {
        const card = await this.get(cardId);
        if (!card) throw new Error(`Stage card does not exist: ${cardId}`);
        if (card.card_status !== 'DRAFT') throw new Error(`Stage card is not a draft: ${cardId}`);
        await db.execute(
          `UPDATE customer_stage_cards SET card_status = 'CONFIRMED', confirmed_by = ?, confirmed_at = ?
           WHERE id = ? AND card_status = 'DRAFT'`,
          [by, at, cardId],
        );
        await db.execute(
          `UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ?
           WHERE id = ?`,
          [cardId, at, at, card.customer_id],
        );
        const row = await this.get(cardId);
        if (!row) throw new Error('Stage card confirm failed.');
        return row;
      });
    },
  };
}

// ── 聚合工厂 ──

export interface BattleCardRepositories {
  readonly imports: IntelligenceImportRepository;
  readonly facts: ReviewedFactRepository;
  readonly hypotheses: HypothesisRepository;
  readonly cards: StageCardRepository;
  readonly evidenceGuard: BattleCardEvidenceGuard;
}

export function createBattleCardRepositories(
  db: DatabaseLike,
  clock: () => string = () => new Date().toISOString(),
  backend?: () => import('../battleCardUi/atomicWriteBackend').AtomicBattleCardWriteBackend | undefined,
): BattleCardRepositories {
  return {
    imports: createIntelligenceImportRepository(db, clock),
    facts: createReviewedFactRepository(db, clock),
    hypotheses: createHypothesisRepository(db, clock),
    cards: createStageCardRepository(db, clock, backend),
    evidenceGuard: new BattleCardEvidenceGuard(db),
  };
}
