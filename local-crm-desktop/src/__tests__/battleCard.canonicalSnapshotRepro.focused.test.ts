/**
 * Canonical Snapshot 复现测试（修复前必须 FAIL 的场景）。
 * P0-A: nested evidence_refs 引用共享；P0-B: Object.create(null)/getter/Proxy 被接受。
 */
import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';

import { parseFactVerificationsRuntime, buildWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { __resetSessionWriteStateStoreForTests, registerCanonicalProposal } from '../lib/salesAgentTools/sessionWriteStateStore';
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
      raw_content: '广州电秀科技发展有限公司 战前卡\n\n1. 主体与公开事实\n\n已核事实/证据：\n广州品牌出海案例销售覆盖80多个国家和地区。\n\n来源：案例\n',
      source_system: 'FEISHU_BTABLE',
      customer_id: 'cust-tinsol',
      keep_fact_ids: ['fact-company-1'],
      keep_hypothesis_ids: [],
      fact_overrides: {},
      fact_verifications,
      expected_version: 'import:any',
      idempotency_key: 'idempotency-key-x',
    },
    reason: 'test',
  });
}

async function confirmViaSession(proposal: Awaited<ReturnType<typeof buildImportProposal>>) {
  const session = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce!,
    confirmed_at: '2026-08-01T12:30:00.000Z',
  }, approvedCrmWriteBoundary);
}

describe('P0-A nested reference aliasing reproduction', () => {
  it('A1-fixed) evidence_refs of the canonical payload are frozen: post-build mutation is rejected', () => {
    const input = [
      { fact_id: 'fact-company-1', decision: 'VERIFY' as const, applicable_scope: '80+ 国家版本', evidence_refs: ['import:官方活动案例'] },
    ];
    const proposal = buildImportProposal(input);
    const hashBefore = proposal.proposal_hash;
    const payload = proposal.proposed_values.fact_verifications as { evidence_refs?: readonly string[] }[];
    // canonical 载荷的嵌套数组已冻结：push 必须被拒绝
    expect(() => (payload[0]!.evidence_refs as string[]).push('import:evil')).toThrow();
    expect(proposal.proposal_hash).toBe(hashBefore);
    const canonical = registerCanonicalProposal(proposal);
    const stored = (canonical.proposed_values.fact_verifications as { evidence_refs?: string[] }[]);
    expect(stored[0]?.evidence_refs).toEqual(['import:官方活动案例']);
  });

  it('A2) full composition: caller input mutation after production propose does not leak into confirm (regression guard)', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const keepFacts = preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id);
    const callerInput = [
      { fact_id: keepFacts[0]!, decision: 'VERIFY' as const, applicable_scope: '80+ 国家版本', evidence_refs: ['import:官方活动案例'] },
    ];
    const proposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: keepFacts,
      keep_hypothesis_ids: [],
      fact_verifications: callerInput,
    });
    // 注册后对调用者原始输入变异：不得影响 canonical 快照
    callerInput[0]!.evidence_refs!.push('import:evil');
    const outcome = await confirmViaSession(proposal);
    expect(outcome.entity_id).toBeTruthy();
    const repos = createBattleCardRepositories(db, CLOCK);
    const facts = await repos.facts.listByCustomer('cust-tinsol');
    const verified = facts.find(fact => fact.verification_status === 'VERIFIED');
    expect(verified).toBeTruthy();
    // 持久化的 evidence 来自事实本身（authoritative import_ref），不含恶意 ref
    const refs = JSON.parse(verified?.evidence_refs_json ?? '[]') as { import_ref?: string }[];
    expect(refs.some(ref => String(ref.import_ref).includes('evil'))).toBe(false);
  });
});

describe('P0-B non-data object reproduction', () => {
  it('B1-fixed) Object.create(null) is rejected by the validator', () => {
    const bare = Object.create(null);
    bare.fact_id = 'fact-company-1';
    bare.decision = 'KEEP';
    expect(() => parseFactVerificationsRuntime([bare])).toThrow(/plain object/);
    // 正式构造路径同样拒绝
    expect(() => buildImportProposal([bare])).toThrow();
  });

  it('B2-fixed) getter object is rejected without invoking the getter', () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, 'fact_id', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'fact-company-1';
      },
    });
    Object.defineProperty(input, 'decision', { enumerable: true, value: 'KEEP' });
    expect(() => parseFactVerificationsRuntime([input])).toThrow(/accessor/);
    expect(getterCalls).toBe(0); // 不允许为校验读取 accessor 值
    // setter 同样拒绝
    let setterCalls = 0;
    const setterObj: Record<string, unknown> = {};
    Object.defineProperty(setterObj, 'fact_id', {
      enumerable: true,
      set() { setterCalls += 1; },
      get() { return 'fact-company-1'; },
    });
    Object.defineProperty(setterObj, 'decision', { enumerable: true, value: 'KEEP' });
    expect(() => parseFactVerificationsRuntime([setterObj])).toThrow(/accessor/);
    expect(setterCalls).toBe(0);
  });

  it('B3-fixed) transparent Proxy is rejected at the canonical construction path', () => {
    const target = { fact_id: 'fact-company-1', decision: 'KEEP' as const };
    const proxy = new Proxy(target, {});
    // structuredClone 对 Proxy 抛错 → fail-closed（正式构造路径）
    expect(() => buildImportProposal([proxy])).toThrow(/non-cloneable|DataCloneError|cannot be cloned/);
  });
});
