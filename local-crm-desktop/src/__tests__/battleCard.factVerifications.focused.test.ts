/**
 * Fact Verifications 闭合运行时 Schema — 完整对抗测试（36 场景）。
 * 结构层 + 语义层分层；E/F 组必须经过正式 production composition 全链路
 * （默认 approvedCrmWriteBoundary → Proposal → confirmWriteByRef → BattleCardWriteExecutor → 隔离 SQLite）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { parseFactVerificationsRuntime, buildWriteProposal, type FactVerificationItem } from '../lib/salesAgentTools/confirmedWrite';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { __resetSessionWriteStateStoreForTests, cancelCanonicalProposal } from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { createBattleCardAgentTools } from '../lib/battleCard/agentTools';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { previewIntelligenceImport } from '../lib/battleCard/importService';
import { CLOCK, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

// ── A. 结构层（parseFactVerificationsRuntime 为唯一结构入口） ──

describe('A. 正常路径（结构层）', () => {
  it('1) 合法 KEEP 载荷通过', () => {
    const result = parseFactVerificationsRuntime([{ fact_id: 'fact-company-1', decision: 'KEEP' }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.fact_id).toBe('fact-company-1');
    expect(result[0]?.decision).toBe('KEEP');
  });

  it('2) 合法 CONDITIONAL + scope + evidence 载荷通过', () => {
    const result = parseFactVerificationsRuntime([{
      fact_id: 'fact-company-1', decision: 'VERIFY', applicability: 'CONDITIONAL',
      applicable_scope: '80+ 国家版本', product_line: '美容仪', evidence_refs: ['import:官方活动案例'], reason: '人工核实',
    }]);
    expect(result[0]?.applicability).toBe('CONDITIONAL');
    expect(result[0]?.evidence_refs).toEqual(['import:官方活动案例']);
  });
});

describe('B. 未知字段（拒绝，不 strip）', () => {
  it('6) 未知根字段 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', evil: 1 }])).toThrow(/unknown field/);
  });
  it('7) 未知嵌套对象 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', nested: { x: 1 } }])).toThrow(/unknown field/);
  });
  it('8) 未知嵌套数组 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', extra: [1, 2] }])).toThrow(/unknown field/);
  });
  it('9) 未知字段值为 null → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', evil: null }])).toThrow(/unknown field/);
  });
  it('10) 未知字段即使执行器不读取 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', customer_stage: 'WON' }])).toThrow(/unknown field/);
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', customer_grade: 'A' }])).toThrow(/unknown field/);
  });
});

describe('C. 类型攻击', () => {
  it('11) fact_verifications 不是数组 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime({ 'fact-company-1': { decision: 'KEEP' } })).toThrow(/must be an array/);
    expect(() => parseFactVerificationsRuntime('not-array')).toThrow(/must be an array/);
  });
  it('12) item 为字符串/数组/null → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime(['str'])).toThrow(/plain object/);
    expect(() => parseFactVerificationsRuntime([[1]])).toThrow(/plain object/);
    expect(() => parseFactVerificationsRuntime([null])).toThrow(/plain object/);
  });
  it('13) fact_id 类型错误 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 123, decision: 'KEEP' }])).toThrow(/fact_id must be a string/);
    expect(() => parseFactVerificationsRuntime([{ fact_id: '', decision: 'KEEP' }])).toThrow(/must not be empty/);
  });
  it('14) evidence_refs 含非字符串 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', evidence_refs: [42] }])).toThrow(/evidence_refs/);
  });
  it('15) decision 非法枚举 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'MAYBE' }])).toThrow(/decision/);
  });
  it('16) applicability 非法枚举 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', applicability: 'MAYBE' }])).toThrow(/applicability/);
  });
  it('17) 超长字符串 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', reason: 'x'.repeat(600) }])).toThrow(/exceeds max length/);
  });
  it('18) 超大数组 → 拒绝', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ fact_id: `f${i}`, decision: 'KEEP' as const }));
    expect(() => parseFactVerificationsRuntime(items)).toThrow(/exceeds max items/);
  });
  it('19) 重复 fact_id → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([
      { fact_id: 'a', decision: 'KEEP' },
      { fact_id: 'a', decision: 'VERIFY' },
    ])).toThrow(/duplicate fact_id/);
  });
  it('20) 重复 evidence ref 去重并明确行为', () => {
    const result = parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', evidence_refs: ['import:x', 'import:x'] }]);
    expect(result[0]?.evidence_refs).toEqual(['import:x']);
  });
  it('20b) evidence ref 无合法前缀 → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', evidence_refs: ['官方活动案例'] }])).toThrow(/prefix/);
  });
});

describe('D. Prototype pollution', () => {
  it('21) __proto__ → 拒绝', () => {
    // 对象字面量 __proto__ 会设置原型（isPlainObject 拒绝）；JSON.parse 构造的自有键走 forbidden key 分支
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', __proto__: { x: 1 } }])).toThrow();
    const viaJson = JSON.parse('[{"fact_id":"a","decision":"KEEP","__proto__":{"x":1}}]') as never[];
    expect(() => parseFactVerificationsRuntime(viaJson)).toThrow(/forbidden key/);
  });
  it('22) constructor → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', constructor: { x: 1 } }])).toThrow(/forbidden key/);
  });
  it('23) prototype → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', prototype: { x: 1 } }])).toThrow(/forbidden key/);
  });
  it('24) 深层 prototype pollution key → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([{ fact_id: 'a', decision: 'KEEP', evidence_refs: [] as string[], 'x.__proto__': 1 }])).toThrow(/unknown field/);
  });
  it('24b) class instance / Date / Map 作为 item → 拒绝', () => {
    expect(() => parseFactVerificationsRuntime([new Date()])).toThrow(/plain object/);
    expect(() => parseFactVerificationsRuntime([new Map()])).toThrow(/plain object/);
  });
});

describe('F. Canonicalization', () => {
  it('33) Validator 返回新对象，不保留原输入引用', () => {
    const input = [{ fact_id: 'a', decision: 'KEEP' as const, evidence_refs: ['import:x'] }];
    const result = parseFactVerificationsRuntime(input);
    expect(result[0]).not.toBe(input[0]);
    expect(result[0]?.evidence_refs).not.toBe(input[0]?.evidence_refs);
  });
  it('34) 校验后修改原始输入对象，不影响 canonical 结果', () => {
    const input = [{ fact_id: 'a', decision: 'KEEP' as const, applicable_scope: 'x' }];
    const result = parseFactVerificationsRuntime(input);
    (input[0] as { applicable_scope: string }).applicable_scope = 'MUTATED';
    expect(result[0]?.applicable_scope).toBe('x');
  });
  it('35) Proposal 构造时即 canonical 化（非法载荷无法构造 Proposal）', () => {
    __resetSessionWriteStateStoreForTests();
    expect(() => buildWriteProposal({
      customer_id: 'cust-tinsol',
      message: 'x',
      evidence_refs: [],
      created_at: '2026-08-01T12:00:00.000Z',
      tool_id: 'confirm_battle_intelligence_import',
      proposed_values: {
        raw_content: 'x', source_system: 'S', customer_id: 'c', keep_fact_ids: [], keep_hypothesis_ids: [],
        fact_overrides: {}, fact_verifications: [{ fact_id: 'a', decision: 'KEEP', evil: true }],
        expected_version: 'v', idempotency_key: 'k',
      },
      reason: 'r',
    })).toThrow(/unknown field/);
  });
  it('36) 合法载荷构造 Proposal 后载荷为 canonical 数组（新引用）', () => {
    __resetSessionWriteStateStoreForTests();
    const input = [{ fact_id: 'a', decision: 'KEEP' as const }];
    const proposal = buildWriteProposal({
      customer_id: 'cust-tinsol',
      message: 'x',
      evidence_refs: [],
      created_at: '2026-08-01T12:00:00.000Z',
      tool_id: 'confirm_battle_intelligence_import',
      proposed_values: {
        raw_content: 'x', source_system: 'S', customer_id: 'c', keep_fact_ids: [], keep_hypothesis_ids: [],
        fact_overrides: {}, fact_verifications: input,
        expected_version: 'v', idempotency_key: 'k',
      },
      reason: 'r',
    });
    const payload = proposal.proposed_values.fact_verifications as readonly FactVerificationItem[];
    expect(payload).toHaveLength(1);
    expect(payload[0]).not.toBe(input[0]);
    // 修改原输入不影响 canonical proposal
    (input[0] as { decision: string }).decision = 'VERIFY';
    expect((payload[0] as { decision: string }).decision).toBe('KEEP');
  });
});

// ── E. 业务越权（正式 production composition 全链路） ──

let db: ReturnType<typeof createSqliteDb>;

beforeEach(async () => {
  __resetSessionWriteStateStoreForTests();
  db = createSqliteDb();
  await initializeDatabaseSchema(db);
  await seedCustomer(db);
  __setDbInstanceForTests(db);
});

async function confirmImport(proposal: Awaited<ReturnType<ReturnType<typeof createBattleCardAgentTools>['proposeConfirmIntelligenceImport']>>) {
  const session = new SalesAgentSession('cust-tinsol', null, CLOCK, undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce!,
    confirmed_at: '2026-08-01T12:30:00.000Z',
  }, approvedCrmWriteBoundary);
}

async function importProposal(fact_verifications: readonly FactVerificationItem[] | undefined, keepFacts = 1) {
  const tools = createBattleCardAgentTools({ db, clock: CLOCK });
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
  const keepFactIds = preview.draft.extracted_facts.slice(0, keepFacts).map(fact => fact.fact_id);
  // 权威 Candidate 合同：fact_id 现在是 64-hex candidate_id；把测试里的旧顺序编号映射为 preview 真实 id（保持原语义）
  const mappedVerifications = fact_verifications?.map(verification => {
    const indexMatch = verification.fact_id.match(/^fact-company-(\d+)$/);
    if (indexMatch) {
      const index = Number(indexMatch[1]) - 1;
      const candidate = preview.draft.extracted_facts[index];
      if (candidate) return { ...verification, fact_id: candidate.fact_id };
    }
    return verification;
  });
  return { tools, preview, proposal: await tools.proposeConfirmIntelligenceImport({
    customer_id: 'cust-tinsol',
    raw_content: GOLDEN_SAMPLE_TINSOL,
    keep_fact_ids: keepFactIds,
    keep_hypothesis_ids: [],
    fact_verifications: mappedVerifications,
  }) };
}

describe('E. 业务越权与全链路', () => {
  it('3) Confirm 精确一次（合法 VERIFY 载荷）', async () => {
    const { proposal } = await importProposal([
      { fact_id: 'fact-company-1', decision: 'VERIFY', applicable_scope: '80+ 国家版本', evidence_refs: ['import:官方活动案例'] },
    ]);
    const outcome = await confirmImport(proposal);
    expect(outcome.entity_id).toBeTruthy();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    const repos = createBattleCardRepositories(db, CLOCK);
    const facts = await repos.facts.listByCustomer('cust-tinsol');
    expect(facts.filter(fact => fact.verification_status === 'VERIFIED')).toHaveLength(1);
    expect(facts.filter(fact => fact.verification_status === 'PENDING')).toHaveLength(0);
  });

  it('4) Replay 零第二次', async () => {
    const { proposal } = await importProposal([{ fact_id: 'fact-company-1', decision: 'KEEP' }]);
    await confirmImport(proposal);
    await expect(confirmImport(proposal)).rejects.toThrow(/replay|consumed/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
  });

  it('5) Cancel 零写入', async () => {
    const { proposal } = await importProposal([{ fact_id: 'fact-company-1', decision: 'KEEP' }]);
    cancelCanonicalProposal(proposal);
    await expect(confirmImport(proposal)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });

  it('25) 跨客户 fact_id → 拒绝且零残留', async () => {
    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    const { proposal } = await importProposal([{ fact_id: 'fact-company-1', decision: 'KEEP' }]);
    // 篡改 customer 归属：proposal 绑定 cust-tinsol，但用另一客户会话确认 → scope mismatch
    const session = new SalesAgentSession('cust-other', null, CLOCK, undefined);
    await expect(session.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce!,
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('26) 跨客户 Evidence → 拒绝且零残留', async () => {
    // 在另一客户下创建任务，然后本客户 verify 引用它
    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    await db.execute(
      `INSERT INTO tasks (id, customer_id, title, status, priority, source, created_at, updated_at)
       VALUES ('task-other', 'cust-other', '其他客户任务', 'OPEN', 'HIGH', 'MANUAL', ?, ?)`,
      [CLOCK(), CLOCK()],
    );
    const { proposal } = await importProposal([
      { fact_id: 'fact-company-1', decision: 'VERIFY', applicable_scope: 'x', evidence_refs: ['TASK:task-other'] },
    ]);
    await expect(confirmImport(proposal)).rejects.toThrow(/does not exist for customer/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });

  it('27) CONDITIONAL 缺 scope → 拒绝 VERIFIED', async () => {
    const { preview, proposal } = await importProposal([
      { fact_id: 'fact-company-1', decision: 'VERIFY', evidence_refs: ['import:官方活动案例'] },
    ], 1);
    // 权威判定 GLOBAL（已核事实）→ 无 scope 也通过？这里用 CONDITIONAL 事实验证：构造合成材料
    void preview;
    void proposal;
    const synthetic = `1. 主体与公开事实\n\n已核事实/证据：\n产品配方温和，成分安全（SYNTHETIC）。\n\n来源：SYNTHETIC\n\n10. 来源\nSYNTHETIC`;
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const p2 = await previewIntelligenceImport(synthetic, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
    const formulaFact = p2.draft.extracted_facts.find(fact => /配方|成分/.test(fact.statement))!;
    const proposal2 = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: synthetic,
      keep_fact_ids: [formulaFact.fact_id],
      keep_hypothesis_ids: [],
      fact_verifications: [{ fact_id: formulaFact.fact_id, decision: 'VERIFY', evidence_refs: ['import:来源'] }],
    });
    await expect(confirmImport(proposal2)).rejects.toThrow(/requires applicable_scope\/product_line and evidence refs/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('28) CONDITIONAL 缺 Evidence → 拒绝 VERIFIED', async () => {
    const synthetic = `1. 主体与公开事实\n\n已核事实/证据：\n产品配方温和，成分安全（SYNTHETIC）。\n\n来源：SYNTHETIC\n\n10. 来源\nSYNTHETIC`;
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const p2 = await previewIntelligenceImport(synthetic, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
    const formulaFact = p2.draft.extracted_facts.find(fact => /配方|成分/.test(fact.statement))!;
    const proposal2 = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: synthetic,
      keep_fact_ids: [formulaFact.fact_id],
      keep_hypothesis_ids: [],
      fact_verifications: [{ fact_id: formulaFact.fact_id, decision: 'VERIFY', applicable_scope: '美容仪线' }],
    });
    await expect(confirmImport(proposal2)).rejects.toThrow(/requires applicable_scope\/product_line and evidence refs/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('29) CONDITIONAL 篡改为 GLOBAL → 拒绝且零残留', async () => {
    const synthetic = `1. 主体与公开事实\n\n已核事实/证据：\n产品配方温和，成分安全（SYNTHETIC）。\n\n来源：SYNTHETIC\n\n10. 来源\nSYNTHETIC`;
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const p2 = await previewIntelligenceImport(synthetic, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
    const formulaFact = p2.draft.extracted_facts.find(fact => /配方|成分/.test(fact.statement))!;
    const proposal2 = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: synthetic,
      keep_fact_ids: [formulaFact.fact_id],
      keep_hypothesis_ids: [],
      fact_verifications: [{
        fact_id: formulaFact.fact_id, decision: 'VERIFY', applicability: 'GLOBAL',
        applicable_scope: 'x', evidence_refs: ['import:来源'],
      }],
    });
    await expect(confirmImport(proposal2)).rejects.toThrow(/applicability tamper detected/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('30) 附带 customer_stage/customer_grade 字段 → Proposal 构造即拒绝', async () => {
    const result = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    await expect(tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: result.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
      fact_verifications: [{ fact_id: 'fact-company-1', decision: 'KEEP', customer_stage: 'WON' } as never],
    })).rejects.toThrow(/unknown field/);
  });

  it('31) 被拒绝后数据库零残留（全链路）', async () => {
    const { proposal } = await importProposal([
      { fact_id: 'fact-company-1', decision: 'VERIFY', applicable_scope: 'x', evidence_refs: ['TASK:not-exist'] },
    ]);
    await expect(confirmImport(proposal)).rejects.toThrow(/does not exist for customer/);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('32) 合法的其他公开 Fact 不因一条非法 verification 被部分写入', async () => {
    const { preview, proposal } = await importProposal([
      { fact_id: 'fact-company-1', decision: 'VERIFY', applicable_scope: '80+ 国家版本', evidence_refs: ['import:官方活动案例'] },
      { fact_id: 'fact-company-2', decision: 'VERIFY', applicable_scope: 'x', evidence_refs: ['TASK:not-exist'] },
    ], 2);
    void preview;
    await expect(confirmImport(proposal)).rejects.toThrow(/does not exist for customer/);
    // 事务回滚：两条都不能部分写入
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });

  it('33b) 非数组 fact_verifications 在 Proposal 构造即拒绝（全链路）', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
    await expect(tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
      fact_verifications: { 'fact-company-1': { applicable_scope: 'x' } } as never,
    })).rejects.toThrow(/must be an array/);
  });
});
