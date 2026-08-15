/**
 * V0.2B / B1 — First-Class Evidence Repository。
 *
 * 所有 Evidence 持久化必须经过本层。创建时：
 *   1. fail-closed provenance 校验（policy.ts）；
 *   2. 确定性 content_hash 推导（identity.ts，调用方不可伪造）；
 *   3. 确定性 dedup：customer + source_type + source_identity + content_hash 命中则幂等返回；
 *   4. 只写 evidence 表，绝不触碰 customers / reviewed_facts / customer_hypotheses /
 *      customer_stage_cards 等权威表（EVIDENCE ≠ CRM_FACT）。
 *
 * 读取全部 customer-scoped（CROSS_CUSTOMER_EVIDENCE_LEAKAGE=false）。
 */

import type { DatabaseLike } from '../db';
import { normalizeEvidenceInput } from './policy';
import { computeContentHash } from './identity';
import type { EvidenceInput, EvidenceRow, EvidenceSourceType, EvidenceStatus } from './types';

export interface CreateEvidenceResult {
  readonly row: EvidenceRow;
  readonly deduped: boolean;
}

export interface EvidenceRepository {
  create(input: EvidenceInput): Promise<CreateEvidenceResult>;
  get(id: string): Promise<EvidenceRow | null>;
  /** 仅返回该客户拥有的证据（跨客户 get 返回 null = 不泄漏存在性以外的信息）。 */
  getOwned(customerId: string, id: string): Promise<EvidenceRow | null>;
  listByCustomer(customerId: string, opts?: { readonly status?: EvidenceStatus }): Promise<EvidenceRow[]>;
  /** 客户作用域存在性校验（Battle Card evidence_refs 兼容 seam 使用）。 */
  exists(customerId: string, evidenceId: string): Promise<boolean>;
  markSuperseded(id: string, at: string): Promise<void>;
  markRetired(id: string, at: string): Promise<void>;
}

const EVIDENCE_ROW_FIELDS =
  'id, customer_id, source_type, source_url, source_title, source_ref, captured_at, summary, excerpt, content_hash, status, created_at, updated_at';

export function createEvidenceRepository(
  db: DatabaseLike,
  clock: () => string = () => new Date().toISOString(),
): EvidenceRepository {
  async function findByDedupKey(
    customerId: string,
    sourceType: EvidenceSourceType,
    sourceUrl: string | null,
    sourceRef: string | null,
    contentHash: string,
  ): Promise<EvidenceRow | null> {
    // 确定性 dedup：来源身份 = source_url（若存在）否则 source_ref。
    if (sourceUrl) {
      const rows = await db.select<EvidenceRow>(
        `SELECT ${EVIDENCE_ROW_FIELDS} FROM evidence
         WHERE customer_id = ? AND source_type = ? AND content_hash = ? AND source_url = ?
         LIMIT 1`,
        [customerId, sourceType, contentHash, sourceUrl],
      );
      return rows[0] ?? null;
    }
    const rows = await db.select<EvidenceRow>(
      `SELECT ${EVIDENCE_ROW_FIELDS} FROM evidence
       WHERE customer_id = ? AND source_type = ? AND content_hash = ? AND source_ref = ?
         AND (source_url IS NULL OR source_url = '')
       LIMIT 1`,
      [customerId, sourceType, contentHash, sourceRef],
    );
    return rows[0] ?? null;
  }

  return {
    async create(input) {
      const normalized = normalizeEvidenceInput(input);
      const contentHash = await computeContentHash(normalized.summary, normalized.excerpt);
      const existing = await findByDedupKey(
        normalized.customer_id,
        normalized.source_type,
        normalized.source_url,
        normalized.source_ref,
        contentHash,
      );
      if (existing) {
        return { row: existing, deduped: true };
      }
      const now = clock();
      await db.execute(
        `INSERT INTO evidence
         (id, customer_id, source_type, source_url, source_title, source_ref, captured_at,
          summary, excerpt, content_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [
          normalized.id,
          normalized.customer_id,
          normalized.source_type,
          normalized.source_url,
          normalized.source_title,
          normalized.source_ref,
          normalized.captured_at,
          normalized.summary,
          normalized.excerpt,
          contentHash,
          now,
          now,
        ],
      );
      const row = await this.get(normalized.id);
      if (!row) throw new Error('Evidence insert failed.');
      return { row, deduped: false };
    },

    async get(id) {
      const rows = await db.select<EvidenceRow>(
        `SELECT ${EVIDENCE_ROW_FIELDS} FROM evidence WHERE id = ?`,
        [id],
      );
      return rows[0] ?? null;
    },

    async getOwned(customerId, id) {
      const rows = await db.select<EvidenceRow>(
        `SELECT ${EVIDENCE_ROW_FIELDS} FROM evidence WHERE id = ? AND customer_id = ?`,
        [id, customerId],
      );
      return rows[0] ?? null;
    },

    async listByCustomer(customerId, opts) {
      if (opts?.status) {
        return db.select<EvidenceRow>(
          `SELECT ${EVIDENCE_ROW_FIELDS} FROM evidence
           WHERE customer_id = ? AND status = ? ORDER BY captured_at DESC, id DESC`,
          [customerId, opts.status],
        );
      }
      return db.select<EvidenceRow>(
        `SELECT ${EVIDENCE_ROW_FIELDS} FROM evidence
         WHERE customer_id = ? ORDER BY captured_at DESC, id DESC`,
        [customerId],
      );
    },

    async exists(customerId, evidenceId) {
      const rows = await db.select<{ id: string }>(
        'SELECT id FROM evidence WHERE id = ? AND customer_id = ?',
        [evidenceId, customerId],
      );
      return rows.length === 1;
    },

    async markSuperseded(id, at) {
      await db.execute(
        `UPDATE evidence SET status = 'SUPERSEDED', updated_at = ? WHERE id = ? AND status = 'ACTIVE'`,
        [at, id],
      );
    },

    async markRetired(id, at) {
      await db.execute(
        `UPDATE evidence SET status = 'RETIRED', updated_at = ? WHERE id = ? AND status != 'RETIRED'`,
        [at, id],
      );
    },
  };
}
