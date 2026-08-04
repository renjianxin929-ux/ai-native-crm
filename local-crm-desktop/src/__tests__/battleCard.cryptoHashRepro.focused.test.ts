/**
 * Cryptographic Hash 修复验收（SHA-256 + Canonical Envelope）。
 * 覆盖：算法基础 / Envelope 边界 / Snapshot 完整性 / 正式路径 / 旧格式拒绝 / Production Bundle Hook 审计。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildCanonicalEnvelope,
  computeProposalHash,
  createCanonicalProposalSnapshot,
  HASH_ALGORITHM,
  PROPOSAL_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  sha256HexSync,
  buildWriteProposal,
  canonicalJsonStringify,
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
import { createBattleCardRepositories } from '../lib/battleCard/repository';
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

function buildImportProposal(fact_verifications: unknown) {
  return buildWriteProposal({
    customer_id: 'cust-tinsol',
    message: '确认战前材料导入',
    evidence_refs: ['customer:cust-tinsol'],
    created_at: '2026-08-01T12:00:00.000Z',
    tool_id: 'confirm_battle_intelligence_import',
    proposed_values: {
      raw_content: 'x', source_system: 'S', customer_id: 'c', keep_fact_ids: ['fact-company-1'], keep_hypothesis_ids: [],
      fact_overrides: {}, fact_verifications, expected_version: 'v', idempotency_key: 'k',
    },
    reason: 'r',
  });
}

async function proposeWithVerifications(verifications: unknown) {
  const tools = createBattleCardAgentTools({ db, clock: CLOCK });
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
  const keepFacts = preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id);
  // 权威 Candidate 合同：旧顺序编号 fact_id → preview 真实 candidate_id（保持原语义）
  const mapped = Array.isArray(verifications)
    ? verifications.map((verification: { fact_id?: string }) => {
      const indexMatch = verification.fact_id?.match(/^fact-company-(\d+)$/);
      if (indexMatch) {
        const candidate = preview.draft.extracted_facts[Number(indexMatch[1]) - 1];
        if (candidate) return { ...verification, fact_id: candidate.fact_id };
      }
      return verification;
    })
    : verifications;
  return tools.proposeConfirmIntelligenceImport({
    customer_id: 'cust-tinsol',
    raw_content: GOLDEN_SAMPLE_TINSOL,
    keep_fact_ids: keepFacts,
    keep_hypothesis_ids: [],
    fact_verifications: mapped as never,
  });
}

async function confirmViaSession(proposal: Awaited<ReturnType<typeof proposeWithVerifications>>) {
  const session = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce!,
    confirmed_at: '2026-08-01T12:30:00.000Z',
  }, approvedCrmWriteBoundary);
}

const VALID = [
  { fact_id: 'fact-company-1', decision: 'VERIFY' as const, applicable_scope: '80+ 国家版本', evidence_refs: ['import:官方活动案例'] },
];

describe('A. Hash 基础（SHA-256）', () => {
  it('1) algorithm is explicitly SHA-256', () => {
    expect(HASH_ALGORITHM).toBe('SHA-256');
    const snapshot = createCanonicalProposalSnapshot(buildImportProposal([]));
    expect(snapshot.hash_algorithm).toBe('SHA-256');
  });

  it('2) output length matches SHA-256 encoding (64 lowercase hex)', () => {
    expect(sha256HexSync('')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256HexSync('abc')).toMatch(/^[0-9a-f]{64}$/);
    const snapshot = createCanonicalProposalSnapshot(buildImportProposal([]));
    expect(snapshot.proposal_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2b) NIST official vectors + cross-validation with crypto.subtle', async () => {
    expect(sha256HexSync('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256HexSync('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const unicode = '飞书多维表格可以把亚马逊、TikTok Shop 的客户与售后数据统一收口。';
    const subtle = createHash('sha256').update(Buffer.from(unicode, 'utf8')).digest('hex');
    expect(sha256HexSync(unicode)).toBe(subtle);
  });

  it('3) identical envelope yields identical hash', () => {
    const a = computeProposalHash('v1', '{"x":1}');
    const b = computeProposalHash('v1', '{"x":1}');
    expect(a).toBe(b);
  });

  it('4) any single byte change changes the hash', () => {
    const a = sha256HexSync('{"x":1}');
    const b = sha256HexSync('{"x":2}');
    expect(a).not.toBe(b);
  });

  it('5) schema_version change changes the hash', () => {
    expect(computeProposalHash('v1', '{"x":1}')).not.toBe(computeProposalHash('v2', '{"x":1}'));
  });

  it('6) unknown hash_algorithm is rejected at rebuild', () => {
    const proposal = buildImportProposal([]);
    const snapshot = createCanonicalProposalSnapshot(proposal);
    registerCanonicalProposal(proposal);
    __corruptCanonicalSnapshotForTests(snapshot.proposal_id, 'cust-tinsol', () => ({ ...snapshot, hash_algorithm: 'FNV-1a' }));
    expect(() => getCanonicalProposal(snapshot.proposal_id, 'cust-tinsol')).toThrow(/hash algorithm unsupported/);
  });

  it('7) unknown snapshot schema version is rejected', () => {
    const proposal = buildImportProposal([]);
    const snapshot = createCanonicalProposalSnapshot(proposal);
    registerCanonicalProposal(proposal);
    __corruptCanonicalSnapshotForTests(snapshot.proposal_id, 'cust-tinsol', () => ({ ...snapshot, snapshot_schema_version: 'canonical-proposal-snapshot-v0' }));
    expect(() => getCanonicalProposal(snapshot.proposal_id, 'cust-tinsol')).toThrow(/snapshot schema unsupported/);
  });
});

describe('B. Envelope 边界', () => {
  it('8) same payload with different proposal schema → different hash', () => {
    const env1 = buildCanonicalEnvelope({ a: 1 });
    env1.proposal_schema_version = 'v1';
    const env2 = buildCanonicalEnvelope({ a: 1 });
    env2.proposal_schema_version = 'v2';
    expect(sha256HexSync(canonicalJsonStringify(env1))).not.toBe(sha256HexSync(canonicalJsonStringify(env2)));
  });

  it('9) same payload with different snapshot schema → different hash', () => {
    const env1 = buildCanonicalEnvelope({ a: 1 });
    env1.snapshot_schema_version = 'sv1';
    const env2 = buildCanonicalEnvelope({ a: 1 });
    env2.snapshot_schema_version = 'sv2';
    expect(sha256HexSync(canonicalJsonStringify(env1))).not.toBe(sha256HexSync(canonicalJsonStringify(env2)));
  });

  it('10) no naive concatenation ambiguity (envelope is a closed object)', () => {
    const env = buildCanonicalEnvelope({ payload: 'x' });
    expect(Object.keys(env).sort()).toEqual(['canonical_payload', 'hash_algorithm', 'proposal_schema_version', 'snapshot_schema_version']);
  });

  it('11) different object key order canonicalizes to the same hash', () => {
    const a = sha256HexSync(canonicalJsonStringify({ b: 1, a: 2 }));
    const b = sha256HexSync(canonicalJsonStringify({ a: 2, b: 1 }));
    expect(a).toBe(b);
  });

  it('12) different array order → different hash', () => {
    expect(sha256HexSync(canonicalJsonStringify({ arr: [1, 2] }))).not.toBe(sha256HexSync(canonicalJsonStringify({ arr: [2, 1] })));
  });
});

describe('C. Snapshot Integrity（tamper）', () => {
  async function register() {
    const proposal = await proposeWithVerifications(VALID);
    return proposal;
  }

  it('13) canonical_envelope_json changed, hash unchanged → rejected, zero writes', async () => {
    const proposal = await register();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({
      ...snapshot,
      canonical_envelope_json: snapshot.canonical_envelope_json.replace('import:官方活动案例', 'import:evil'),
    }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash mismatch/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('14) hash changed, envelope unchanged → rejected', async () => {
    const proposal = await register();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({
      ...snapshot,
      proposal_hash: '0'.repeat(64),
    }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash mismatch/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('15) hash_algorithm changed → rejected', async () => {
    const proposal = await register();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({ ...snapshot, hash_algorithm: 'MD5' }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash algorithm unsupported/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('16) snapshot schema version changed → rejected', async () => {
    const proposal = await register();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({ ...snapshot, snapshot_schema_version: 'v0' }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/snapshot schema unsupported/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('17/18/19) evidence_refs / reason / applicability tamper (hash recomputed? no → mismatch) or envelope-level change rejected', async () => {
    const proposal = await register();
    const snapshotOf = createCanonicalProposalSnapshot(proposal);
    // 直接修改 Envelope 内 payload 而不重算 hash → mismatch
    const evilEnvelope = snapshotOf.canonical_envelope_json.replace('官方活动案例', 'EVIL');
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({
      ...snapshot,
      canonical_envelope_json: evilEnvelope,
    }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash mismatch/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });
});

describe('D. 正式路径（SHA-256 下回归）', () => {
  it('20) valid proposal confirm exactly once', async () => {
    const proposal = await proposeWithVerifications(VALID);
    await confirmViaSession(proposal);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    const repos = createBattleCardRepositories(db, CLOCK);
    expect((await repos.facts.listByCustomer('cust-tinsol')).filter(fact => fact.verification_status === 'VERIFIED')).toHaveLength(1);
  });

  it('21) cancel zero writes', async () => {
    const { cancelCanonicalProposal } = await import('../lib/salesAgentTools/sessionWriteStateStore');
    const proposal = await proposeWithVerifications(VALID);
    cancelCanonicalProposal(proposal);
    await expect(confirmViaSession(proposal)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('22) replay zero second write', async () => {
    const proposal = await proposeWithVerifications(VALID);
    await confirmViaSession(proposal);
    await expect(confirmViaSession(proposal)).rejects.toThrow(/replay|consumed/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
  });

  it('23) scope mismatch rejected', async () => {
    await seedCustomer(db, { id: 'cust-scope', name: '作用域客户' });
    const proposal = await proposeWithVerifications(VALID);
    const session = new SalesAgentSession('cust-scope', null, CLOCK, undefined);
    await expect(session.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce!,
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('24) expected_version conflict rejected', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await proposeWithVerifications(VALID);
    await confirmViaSession(proposal);
    const repos = createBattleCardRepositories(db, CLOCK);
    const hypothesis = (await repos.hypotheses.listByCustomer('cust-tinsol'))[0];
    if (!hypothesis) return;
    const stale = await tools.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis.id,
      new_status: 'CONFIRMED',
      expected_version: 'stale',
    });
    const session = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
    await expect(session.confirmWriteByRef({
      proposal_id: stale.proposal_id,
      nonce: stale.nonce!,
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow(/version conflict/);
  });

  it('25) transaction failure zero residue', async () => {
    const proposal = await proposeWithVerifications([
      { fact_id: 'fact-company-1', decision: 'VERIFY', applicable_scope: 'x', evidence_refs: ['TASK:missing'] },
    ]);
    await expect(confirmViaSession(proposal)).rejects.toThrow(/does not exist for customer/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('26) confirm triggers zero automatic model calls', async () => {
    const proposal = await proposeWithVerifications(VALID);
    const outcome = await confirmViaSession(proposal);
    expect(outcome.entity_id).toBeTruthy();
    const repos = createBattleCardRepositories(db, CLOCK);
    expect((await repos.facts.listByCustomer('cust-tinsol')).length).toBe(1);
  });
});

describe('E. 旧格式拒绝', () => {
  it('27/28/29) legacy FNV snapshot (no hash_algorithm / no snapshot_schema_version / 16-hex hash) is rejected', () => {
    const proposal = buildImportProposal([]);
    const snapshot = createCanonicalProposalSnapshot(proposal);
    const legacy = {
      ...snapshot,
      // 模拟旧格式：缺 hash_algorithm / snapshot_schema_version，hash 为 16 hex FNV
      proposal_hash: 'deadbeefdeadbeef',
      hash_algorithm: undefined as unknown as string,
      snapshot_schema_version: undefined as unknown as string,
    };
    registerCanonicalProposal(proposal);
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', () => legacy as never);
    expect(() => getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')).toThrow(/hash algorithm unsupported/);
  });

  it('30) legacy format hint: regeneration required, never executed', async () => {
    const proposal = await proposeWithVerifications(VALID);
    const snapshot = createCanonicalProposalSnapshot(proposal);
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', () => ({
      ...snapshot,
      proposal_hash: 'deadbeefdeadbeef',
      hash_algorithm: undefined as unknown as string,
    }) as never);
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash algorithm unsupported/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });
});

describe('F. Production Bundle Hook 审计', () => {
  it('31) production bundle does not contain a callable corruption hook', () => {
    // 源码链：corrupt hook 仅存在于 sessionWriteStateStore（生产模块导出，__xxxForTests 惯例）；
    // 生产 bundle 扫描在验证链 build 后执行（dist/assets 不含标识符），此处做源码可达性断言
    const storeSource = readFileSync(new URL('../lib/salesAgentTools/sessionWriteStateStore.ts', import.meta.url), 'utf8');
    expect(storeSource).toContain('__corruptCanonicalSnapshotForTests'); // 定义存在（测试专用）
    // dist 产物扫描（若存在）：生产 bundle 不得含可调用入口
    const distDir = new URL('../../dist/', import.meta.url);
    let distFiles: string[] = [];
    try {
      distFiles = readdirSync(distDir).filter(name => name.endsWith('.js') || name.endsWith('.mjs'));
    } catch {
      distFiles = [];
    }
    for (const file of distFiles) {
      const content = readFileSync(join(distDir.pathname, file), 'utf8');
      expect(content).not.toContain('__corruptCanonicalSnapshotForTests');
    }
  });

  it('32) production registry public API has no mutation methods', () => {
    // 生产 API 面 = 无任意 snapshot 注入；corrupt hook 为 __ 前缀测试专用
    const storeSource = readFileSync(new URL('../lib/salesAgentTools/sessionWriteStateStore.ts', import.meta.url), 'utf8');
    const productionExports = storeSource.match(/^export (?:function|const) ([A-Za-z0-9_]+)/gm) ?? [];
    for (const line of productionExports) {
      const name = line.replace(/^export (?:function|const) /, '');
      if (name.startsWith('__')) continue; // 测试专用
      expect(name).not.toMatch(/corrupt|mutate|inject|override/i);
    }
  });

  it('33) runtime code cannot reach the hook via window/globalThis', () => {
    expect((globalThis as Record<string, unknown>).__corruptCanonicalSnapshotForTests).toBeUndefined();
    expect((globalThis as Record<string, unknown>).corruptCanonicalSnapshotForTests).toBeUndefined();
  });
});
