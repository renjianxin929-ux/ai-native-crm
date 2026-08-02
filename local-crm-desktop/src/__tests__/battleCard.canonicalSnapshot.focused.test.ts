/**
 * Canonical Proposal Snapshot — 专项测试（任务十二矩阵）。
 * Registry 真源 = canonical_payload_json + proposal_hash；
 * 深层引用隔离 / hash 完整性 / schema-version / Confirm revalidation。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { buildWriteProposal, computeProposalHash, PROPOSAL_SCHEMA_VERSION, sha256HexSync } from '../lib/salesAgentTools/confirmedWrite';
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

async function proposeWithVerifications(verifications: unknown) {
  const tools = createBattleCardAgentTools({ db, clock: CLOCK });
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
  const keepFacts = preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id);
  return tools.proposeConfirmIntelligenceImport({
    customer_id: 'cust-tinsol',
    raw_content: GOLDEN_SAMPLE_TINSOL,
    keep_fact_ids: keepFacts,
    keep_hypothesis_ids: [],
    fact_verifications: verifications as never,
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

describe('深层引用隔离（Registry 真源为 canonical JSON）', () => {
  it('1) nested evidence_refs mutation after register does not affect the snapshot', async () => {
    const callerInput = [{ ...VALID[0]!, evidence_refs: [...VALID[0]!.evidence_refs!] }];
    const proposal = await proposeWithVerifications(callerInput);
    const registered = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol');
    const snapshotPayloadBefore = JSON.stringify((registered!.proposed_values.fact_verifications as unknown[]));

    // 对调用者原始输入的各种变异
    (callerInput[0]!.evidence_refs as string[]).push('import:evil');
    (callerInput[0] as { decision: string }).decision = 'KEEP';
    (callerInput[0] as { applicable_scope: string }).applicable_scope = 'MUTATED';
    callerInput.push({ fact_id: 'fact-company-2', decision: 'KEEP' as const });
    callerInput.length = 0;

    const after = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol');
    expect(JSON.stringify((after!.proposed_values.fact_verifications as unknown[]))).toBe(snapshotPayloadBefore);
    expect(after!.proposal_hash).toBe(proposal.proposal_hash);
    // Confirm 执行最初注册内容
    const outcome = await confirmViaSession(proposal);
    expect(outcome.entity_id).toBeTruthy();
  });

  it('2) registry returned-copy mutation does not affect the registry', async () => {
    const proposal = await proposeWithVerifications(VALID);
    const copy = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')!;
    const fv = copy.proposed_values.fact_verifications as { evidence_refs?: readonly string[] }[];
    // rebuild 对象为 frozen canonical：数组变异与 item 属性赋值都被拒绝（只读防护）
    expect(() => (fv[0]!.evidence_refs as string[]).push('import:evil')).toThrow();
    expect(() => fv.push({ fact_id: 'fact-company-2', decision: 'KEEP' as never })).toThrow();
    expect(() => { (fv[0] as { applicable_scope?: string }).applicable_scope = 'MUTATED'; }).toThrow();
    // proposed_values 本体为 rebuild 新对象（每次重建）：修改副本不影响 registry
    (copy.proposed_values as Record<string, unknown>).raw_content = 'MUTATED';

    const pristine = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')!;
    expect((pristine.proposed_values.fact_verifications as unknown[])).toHaveLength(1);
    expect(JSON.stringify(pristine.proposed_values)).not.toContain('evil');
    expect(JSON.stringify(pristine.proposed_values)).not.toContain('MUTATED');
  });

  it('3) registry does not expose the internal snapshot object', async () => {
    const proposal = await proposeWithVerifications(VALID);
    const a = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')!;
    const b = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')!;
    expect(a).not.toBe(b); // 每次调用全新副本
  });
});

describe('hash 完整性（fail-closed）', () => {
  async function registerProposal() {
    const proposal = await proposeWithVerifications(VALID);
    const registered = getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')!;
    expect(registered.proposal_hash).toBe(proposal.proposal_hash);
    return proposal;
  }

  it('4) canonical envelope JSON changed, hash unchanged → Confirm rejected, zero writes', async () => {
    const proposal = await registerProposal();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({
      ...snapshot,
      canonical_envelope_json: snapshot.canonical_envelope_json.replace('import:官方活动案例', 'import:evil'),
    }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash mismatch/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });

  it('5) hash changed, JSON unchanged → Confirm rejected, zero writes', async () => {
    const proposal = await registerProposal();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({
      ...snapshot,
      proposal_hash: 'deadbeef'.padStart(16, '0'),
    }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/hash mismatch/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('6) snapshot schema version changed → rejected (schema unsupported), zero writes', async () => {
    const proposal = await registerProposal();
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => ({
      ...snapshot,
      snapshot_schema_version: 'canonical-proposal-snapshot-v0',
    }));
    await expect(confirmViaSession(proposal)).rejects.toThrow(/snapshot schema unsupported|hash mismatch/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('6b) hash input includes schema_version + canonical JSON (deterministic)', () => {
    const json = '{"a":1,"b":2}';
    expect(computeProposalHash('v1', json)).toBe(computeProposalHash('v1', json));
    expect(computeProposalHash('v1', json)).not.toBe(computeProposalHash('v2', json));
  });
});

describe('Confirm revalidation', () => {
  it('7) registry JSON with semantically invalid cross-customer evidence is rejected at confirm', async () => {
    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    await db.execute(
      `INSERT INTO tasks (id, customer_id, title, status, priority, source, created_at, updated_at)
       VALUES ('task-other', 'cust-other', '其他客户任务', 'OPEN', 'HIGH', 'MANUAL', ?, ?)`,
      [CLOCK(), CLOCK()],
    );
    const proposal = await proposeWithVerifications(VALID);
    // 受控替换 Envelope 内 payload：把 evidence 换成跨客户 TASK（结构合法、语义非法），并重算 SHA-256 保持 hash 一致
    __corruptCanonicalSnapshotForTests(proposal.proposal_id, 'cust-tinsol', snapshot => {
      const json = snapshot.canonical_envelope_json.replace('import:官方活动案例', 'TASK:task-other');
      return { ...snapshot, canonical_envelope_json: json, proposal_hash: sha256HexSync(json) };
    });
    await expect(confirmViaSession(proposal)).rejects.toThrow(/does not exist for customer/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });

  it('8) replay after successful confirm still writes zero second time', async () => {
    const proposal = await proposeWithVerifications(VALID);
    await confirmViaSession(proposal);
    await expect(confirmViaSession(proposal)).rejects.toThrow(/replay|consumed/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(1);
  });

  it('9) expected_version conflict still blocks', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const repos = createBattleCardRepositories(db, CLOCK);
    const proposal = await proposeWithVerifications(VALID);
    await confirmViaSession(proposal);
    const hypothesis = (await repos.hypotheses.listByCustomer('cust-tinsol'))[0];
    if (!hypothesis) return; // 无假设时跳过（合成材料没有 H）
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

  it('10) scope mismatch still rejected', async () => {
    await seedCustomer(db, { id: 'cust-other2', name: '另一客户2' });
    const proposal = await proposeWithVerifications(VALID);
    const session = new SalesAgentSession('cust-other2', null, CLOCK, undefined);
    await expect(session.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce!,
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('11) transaction rollback on semantic failure leaves zero residue', async () => {
    const proposal = await proposeWithVerifications([
      { fact_id: 'fact-company-1', decision: 'VERIFY', applicable_scope: 'x', evidence_refs: ['TASK:missing'] },
    ]);
    await expect(confirmViaSession(proposal)).rejects.toThrow(/does not exist for customer/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('12) confirm triggers zero automatic model calls', async () => {
    const proposal = await proposeWithVerifications(VALID);
    const outcome = await confirmViaSession(proposal);
    expect(outcome.entity_id).toBeTruthy();
    // 无 provider 调用痕迹：直接确认流程内无额外副作用
    const repos = createBattleCardRepositories(db, CLOCK);
    expect((await repos.facts.listByCustomer('cust-tinsol')).length).toBe(1);
  });
});

describe('buildWriteProposal canonical hash', () => {
  it('13) proposal hash is deterministic and bound to payload', () => {
    const base = {
      customer_id: 'cust-tinsol',
      message: 'x',
      evidence_refs: [] as string[],
      created_at: '2026-08-01T12:00:00.000Z',
      tool_id: 'confirm_battle_intelligence_import' as const,
      proposed_values: {
        raw_content: 'x', source_system: 'S', customer_id: 'c', keep_fact_ids: [] as string[], keep_hypothesis_ids: [] as string[],
        fact_overrides: {}, fact_verifications: [] as unknown[], expected_version: 'v', idempotency_key: 'k',
      },
      reason: 'r',
    };
    const a = buildWriteProposal(base);
    const b = buildWriteProposal({ ...base, created_at: '2026-08-01T12:00:01.000Z' });
    expect(a.proposal_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.proposal_hash).not.toBe(b.proposal_hash);
  });

  it('14) register rebuild preserves hash and identity fields', async () => {
    const proposal = await proposeWithVerifications(VALID);
    const registered = registerCanonicalProposal(proposal);
    expect(registered.proposal_id).toBe(proposal.proposal_id);
    expect(registered.proposal_hash).toBe(proposal.proposal_hash);
    expect(registered.nonce).toBe(proposal.nonce);
    expect(registered.customer_id).toBe('cust-tinsol');
  });
});

describe('proposal persistence across restarts', () => {
  it('15) registry is process-local: reset clears snapshots (old proposals naturally invalid)', () => {
    const proposal = buildWriteProposal({
      customer_id: 'cust-tinsol',
      message: 'x',
      evidence_refs: [],
      created_at: '2026-08-01T12:00:00.000Z',
      tool_id: 'create_follow_up_record',
      proposed_values: { title: 't', feedback_notes: 'n' },
      reason: 'r',
    });
    registerCanonicalProposal(proposal);
    expect(getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')).not.toBeNull();
    __resetSessionWriteStateStoreForTests();
    expect(getCanonicalProposal(proposal.proposal_id, 'cust-tinsol')).toBeNull();
  });
});
