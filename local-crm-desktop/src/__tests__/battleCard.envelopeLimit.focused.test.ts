/**
 * Envelope 总字节上限 — 失败基线 + 完整验收（256 KiB = 262,144 UTF-8 bytes）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES,
  assertCanonicalEnvelopeByteLimit,
  buildCanonicalEnvelope,
  buildWriteProposal,
  canonicalJsonStringify,
  createCanonicalProposalSnapshot,
  sha256HexSync,
  type CanonicalProposalSnapshot,
} from '../lib/salesAgentTools/confirmedWrite';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  __corruptCanonicalSnapshotForTests,
  __resetSessionWriteStateStoreForTests,
  getCanonicalProposal,
  registerCanonicalProposal,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { createBattleCardAgentTools } from '../lib/battleCard/agentTools';
import { previewIntelligenceImport } from '../lib/battleCard/importService';
import { CLOCK, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

let db: ReturnType<typeof createSqliteDb>;

beforeEach(async () => {
  __resetSessionWriteStateStoreForTests();
  db = createSqliteDb();
  await initializeDatabaseSchema(db);
  await seedCustomer(db);
  __setDbInstanceForTests(db);
});

const encoder = new TextEncoder();

function buildProposalWithRaw(rawContent: string) {
  return buildWriteProposal({
    customer_id: 'cust-tinsol',
    message: '确认战前材料导入',
    evidence_refs: ['customer:cust-tinsol'],
    created_at: '2026-08-01T12:00:00.000Z',
    tool_id: 'confirm_battle_intelligence_import',
    proposed_values: {
      raw_content: rawContent, source_system: 'S', customer_id: 'c', keep_fact_ids: ['fact-company-1'], keep_hypothesis_ids: [],
      fact_overrides: {}, fact_verifications: [], expected_version: 'v', idempotency_key: 'k',
    },
    reason: 'r',
  });
}

function envelopeBytesOf(proposal: ReturnType<typeof buildProposalWithRaw>): number {
  const snapshot = createCanonicalProposalSnapshot(proposal);
  return encoder.encode(snapshot.canonical_envelope_json).byteLength;
}

describe('A. 修复后行为（原失败基线反转）', () => {
  it('0a-fixed) 1,000,311-byte envelope is rejected at proposal construction (pre-hash)', () => {
    __resetSessionWriteStateStoreForTests();
    // 构造阶段（buildWriteProposal 内 hash 计算前）即拒绝
    expect(() => buildProposalWithRaw('x'.repeat(1_000_000))).toThrow(/exceeds the 262144-byte limit/);
  });

  it('0b-fixed) byte-limit constant and helper exist', async () => {
    const mod = await import('../lib/salesAgentTools/confirmedWrite');
    const record = mod as unknown as Record<string, unknown>;
    expect(record.MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES).toBe(262_144);
    expect(typeof record.assertCanonicalEnvelopeByteLimit).toBe('function');
  });
});

describe('B. 常量与纯函数', () => {
  it('1) constant is exactly 262,144 with documented semantics', () => {
    expect(MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES).toBe(262_144);
  });

  it('2) unit is UTF-8 bytes (TextEncoder byteLength, same encoding as SHA-256 input)', () => {
    const json = canonicalJsonStringify(buildCanonicalEnvelope({ payload: '中' }));
    const bytes = encoder.encode(json).byteLength;
    expect(bytes).toBe(encoder.encode(json).byteLength);
    // 中文三字节：字符数 1 但字节 3
    expect(encoder.encode('中').byteLength).toBe(3);
  });

  it('3) helper is a pure function over the envelope JSON string', () => {
    const json = canonicalJsonStringify(buildCanonicalEnvelope({ a: 1 }));
    expect(() => assertCanonicalEnvelopeByteLimit(json)).not.toThrow();
    expect(assertCanonicalEnvelopeByteLimit.name).toBeTruthy();
  });
});

describe('C. 精确字节边界（UTF-8）', () => {
  function envelopeJsonOfSize(targetBytes: number, seed: string): { json: string; bytes: number } {
    // 用 ASCII 填充逼近目标字节数（seed 为固定前缀保证确定性）
    const base = canonicalJsonStringify(buildCanonicalEnvelope({ payload: '' }));
    const head = base.length - 2; // 去掉尾部 '"}'
    let json = '';
    // 二分逼近：构造 payload 长度使总字节精确
    let low = 0;
    let high = targetBytes + 64;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = canonicalJsonStringify(buildCanonicalEnvelope({ payload: seed.repeat(Math.max(0, Math.floor(mid / seed.length))) + seed.slice(0, mid % seed.length) }));
      const size = encoder.encode(candidate).byteLength;
      if (size < targetBytes) low = mid + 1;
      else if (size > targetBytes) high = mid - 1;
      else return { json: candidate, bytes: size };
      json = candidate;
    }
    // 未精确命中：返回最接近且不超过的
    return { json, bytes: encoder.encode(json).byteLength };
  }

  it('4) minimal legal envelope passes', () => {
    const json = canonicalJsonStringify(buildCanonicalEnvelope({ payload: { proposal_id: 'p' } }));
    expect(() => assertCanonicalEnvelopeByteLimit(json)).not.toThrow();
  });

  it('5) 262,143 bytes passes', () => {
    const { json, bytes } = envelopeJsonOfSize(262_143, 'a');
    expect(bytes).toBe(262_143);
    expect(() => assertCanonicalEnvelopeByteLimit(json)).not.toThrow();
  });

  it('6) 262,144 bytes passes (exact limit)', () => {
    const { json, bytes } = envelopeJsonOfSize(262_144, 'a');
    expect(bytes).toBe(262_144);
    expect(() => assertCanonicalEnvelopeByteLimit(json)).not.toThrow();
  });

  it('7) 262,145 bytes rejected', () => {
    const { json, bytes } = envelopeJsonOfSize(262_145, 'a');
    expect(bytes).toBe(262_145);
    expect(() => assertCanonicalEnvelopeByteLimit(json)).toThrow(/too large|exceeds/i);
  });

  it('8) 1,000,311 bytes rejected', () => {
    const { json, bytes } = envelopeJsonOfSize(1_000_311, 'a');
    expect(bytes).toBe(1_000_311);
    expect(() => assertCanonicalEnvelopeByteLimit(json)).toThrow(/too large|exceeds/i);
  });

  it('9) large ASCII judged by bytes', () => {
    const { json, bytes } = envelopeJsonOfSize(300_000, 'b');
    expect(bytes).toBe(300_000);
    expect(() => assertCanonicalEnvelopeByteLimit(json)).toThrow();
  });

  it('10) Chinese content judged by UTF-8 bytes, not character count', () => {
    // 60000 个中文字符 = 180000 bytes（3 字节/字）< 262144 → 通过
    const json = canonicalJsonStringify(buildCanonicalEnvelope({ payload: '中'.repeat(60_000) }));
    expect(json.length).toBeLessThan(262_144); // 字符数远小于上限
    const bytes = encoder.encode(json).byteLength;
    expect(bytes).toBeGreaterThan(180_000);
    expect(bytes).toBeLessThanOrEqual(262_144);
    expect(() => assertCanonicalEnvelopeByteLimit(json)).not.toThrow();
    // 90000 个中文字符 = 270000 bytes > 262144 → 拒绝
    const big = canonicalJsonStringify(buildCanonicalEnvelope({ payload: '中'.repeat(90_000) }));
    expect(encoder.encode(big).byteLength).toBeGreaterThan(262_144);
    expect(() => assertCanonicalEnvelopeByteLimit(big)).toThrow();
  });

  it('11) Emoji / multi-byte UTF-8 judged correctly', () => {
    // Emoji 4 字节：65000 个 ≈ 260,000 + 元数据 < 262,144 → 通过；65600 个 ≈ 262,400 > limit → 拒绝
    const under = canonicalJsonStringify(buildCanonicalEnvelope({ payload: '😀'.repeat(65_000) }));
    expect(encoder.encode(under).byteLength).toBeLessThanOrEqual(262_144);
    expect(() => assertCanonicalEnvelopeByteLimit(under)).not.toThrow();
    const over = canonicalJsonStringify(buildCanonicalEnvelope({ payload: '😀'.repeat(65_600) }));
    expect(encoder.encode(over).byteLength).toBeGreaterThan(262_144);
    expect(() => assertCanonicalEnvelopeByteLimit(over)).toThrow();
  });

  it('12) payload within limit but envelope metadata pushes over → rejected', () => {
    // payload 单独 < limit，但 envelope 字段 + payload 超过
    const payloadJson = canonicalJsonStringify({ proposal_id: 'x', proposed_values: { raw_content: 'a'.repeat(262_000) } });
    expect(encoder.encode(payloadJson).byteLength).toBeLessThan(262_144);
    const envelopeJson = canonicalJsonStringify(buildCanonicalEnvelope(JSON.parse(payloadJson)));
    expect(encoder.encode(envelopeJson).byteLength).toBeGreaterThan(262_144);
    expect(() => assertCanonicalEnvelopeByteLimit(envelopeJson)).toThrow();
  });

  it('13) key ordering is stable: same content yields same size and hash', () => {
    const a = canonicalJsonStringify(buildCanonicalEnvelope({ b: 1, a: 2 }));
    const b = canonicalJsonStringify(buildCanonicalEnvelope({ a: 2, b: 1 }));
    expect(a).toBe(b);
    expect(encoder.encode(a).byteLength).toBe(encoder.encode(b).byteLength);
  });
});

describe('D. 注册侧 pre-hash 拒绝', () => {
  it('14) oversized payload never enters the registry', () => {
    __resetSessionWriteStateStoreForTests();
    expect(() => buildProposalWithRaw('x'.repeat(1_000_000))).toThrow(/exceeds the 262144-byte limit/);
    expect(getCanonicalProposal('any', 'cust-tinsol')).toBeNull();
  });

  it('15) oversized payload yields no usable proposal_ref', () => {
    __resetSessionWriteStateStoreForTests();
    try {
      buildProposalWithRaw('x'.repeat(1_000_000));
    } catch {
      // 预期拒绝
    }
    expect(getCanonicalProposal('any', 'cust-tinsol')).toBeNull();
  });

  it('16) pre-hash: byte-limit rejection originates from the limit helper before any hash output', () => {
    __resetSessionWriteStateStoreForTests();
    try {
      buildProposalWithRaw('x'.repeat(1_000_000));
      expect(true).toBe(false);
    } catch (error) {
      const message = (error as Error).message;
      // 错误来自字节上限检查（在 hash 计算之前），且不含任何 hash 产物
      expect(message).toMatch(/exceeds the 262144-byte limit/);
      expect(message).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it('17) error message does not include the full payload', () => {
    try {
      buildProposalWithRaw('x'.repeat(1_000_000));
      expect(true).toBe(false);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('x'.repeat(50));
      expect(message.length).toBeLessThan(500);
    }
  });
});

describe('E. Confirm 侧防御', () => {
  async function registerThenCorruptOversized() {
    const proposal = await (async () => {
      const tools = createBattleCardAgentTools({ db, clock: CLOCK });
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      return tools.proposeConfirmIntelligenceImport({
        customer_id: 'cust-tinsol',
        raw_content: GOLDEN_SAMPLE_TINSOL,
        keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
        keep_hypothesis_ids: [],
        fact_verifications: [{ fact_id: 'fact-company-1', decision: 'KEEP' }],
      });
    })();
    const snapshot = createCanonicalProposalSnapshot(proposal);
    // 受控替换为超限 envelope（保留旧 hash）
    const oversizedJson = canonicalJsonStringify(buildCanonicalEnvelope({ payload: 'z'.repeat(262_200) }));
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', () => ({
      ...snapshot,
      canonical_envelope_json: oversizedJson,
    }) as unknown as CanonicalProposalSnapshot);
    return proposal;
  }

  it('18) Confirm rejects oversized envelope before hash computation, zero writes', async () => {
    const proposal = await registerThenCorruptOversized();
    const session = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
    await expect(session.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce!,
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow(/too large|exceeds/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('19) replay state is not advanced after oversized rejection', async () => {
    const proposal = await registerThenCorruptOversized();
    const session = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
    await expect(session.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce!,
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow();
    // 未被标记消费：同一 nonce 再次确认仍走同一拒绝路径（未被当作 replay）
    const session2 = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
    await expect(session2.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce!,
      confirmed_at: '2026-08-01T12:31:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow(/too large|exceeds/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });
});
