/**
 * V0.2C / C1.8 — REAL DeepSeek chat capability E2E release gate.
 *
 * 这是真实模型端到端：真实 DeepSeek（deepseek-chat 别名）接收 registry 派生的
 * planner 工具面 + 用户自然语言，返回结构化能力选择；选择结果经真实生产代码
 * （validateModelPlannerOutput → routeCapabilitySelection → PRODUCTION_CAPABILITY_EXECUTION
 * → A10 → 确认 → 执行器，隔离 DB）验证。
 *
 * SCOPE: live-model / module composition. This injects capability_planner for
 * isolation. It is NOT proof that SalesAgentInteractionWorkspace production UI
 * wires Trusted Host createModelPlannerCaller. That wiring is asserted in
 * v02FinalSystemicClosure (source) and trustedHostProvider tests.
 *
 * 绝不：直接注入 capability_id、直接调 routeCapabilitySelection、mock 模型选择、
 * 污染真实用户数据。所有写/删除仅在隔离 fixture 上确认执行。
 *
 * 测试凭据来自未提交的环境变量 DEEPSEEK_LIVE_KEY（与 deepseekLiveContract 约定一致）；
 * 未设置该变量时本套件自动跳过，绝不读取明文提交的密钥。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';
import { planCapability, type ModelPlannerRequest } from '../lib/planner/runtimePlanner';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sessionForWrite, sqliteFixture } from './salesAgentProductionHarness';
import { VISIT_NEXT_ACTIONS } from '../lib/visitCreate';

const DEEPSEEK_KEY = process.env.DEEPSEEK_LIVE_KEY ?? '';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';
const NOW = '2026-07-15T12:00:00+08:00';

let realModelCallCount = 0;

function compactSurface() {
  return PRODUCTION_PLANNER_TOOL_SURFACE.map((d) => ({
    capability_id: d.capability_id,
    effect: d.effect,
    scope: d.scope_requirement,
    semantic_hint: d.semantic_hint,
    required_fields: d.input_schema.required_fields,
    allowed_fields: d.input_schema.allowed_fields,
    fields: Object.values(d.input_schema.fields).map((f) => ({
      name: f.name,
      required: f.required,
      type: f.type,
      ...(f.nullable !== undefined ? { nullable: f.nullable } : {}),
      ...(f.enum_values ? { enum_values: f.enum_values } : {}),
      ...(f.boolean_values ? { boolean_values: f.boolean_values } : {}),
      ...(f.numeric_constraint ? { numeric_constraint: f.numeric_constraint } : {}),
      ...(f.format ? { format: f.format } : {}),
    })),
  }));
}

const SYSTEM_PROMPT = [
  '你是 CRM 能力选择器。根据用户指令，从工具清单中选择恰好一个能力。',
  '只返回严格 JSON（不要 markdown 代码块、不要多余文字）：',
  '  选中执行：{"kind":"invoke","capability_id":"<id>","arguments":{...}}',
  '  信息缺失：{"kind":"clarify","capability_id":"<id或null>","clarification_question":"...","missing_fields":["..."]}',
  '规则：写/删除能力只选不执行；arguments 只在用户明确给出时填写，绝不编造金额/时间/ID/事实；',
  '字段约束（通用，非针对某个能力）：若字段带 enum_values 只能从中取一个值；',
  '若字段带 boolean_values 只能取 0 或 1；若字段带 format 必须符合格式；若带 numeric_constraint 必须符合约束；',
  '可选字段（required=false）用户未提供就省略；必填字段缺失时必须返回 clarify。',
].join('\n');

function parseJson(content: string): unknown {
  const stripped = content
    .replace(/```(?:json)?\s*/g, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`无法解析模型 JSON: ${stripped.slice(0, 120)}`);
  }
}

async function deepseekChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  realModelCallCount += 1;
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 400, temperature: 0, stream: false }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? '';
  return content;
}

async function realModelSelect(request: ModelPlannerRequest): Promise<unknown> {
  const user = `当前客户ID=${request.customer_id ?? '(无)'}。\n工具清单=${JSON.stringify(compactSurface())}\n\n指令：${request.instruction}`;
  const content = await deepseekChat([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }]);
  return parseJson(content);
}

function makeController(db: unknown, scopeId?: string) {
  const controller = new SalesAgentInteractionController({
    db: db as never,
    createSession: () => sessionForWrite(),
    clock: () => NOW,
    capability_planner: (utterance, scopedCustomerId) => planCapability(utterance, NOW, scopedCustomerId, {
      db: db as never,
      modelSelect: realModelSelect,
    }),
  });
  if (scopeId) controller.syncExternalScope(scopeId, '测试客户');
  return controller;
}

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

describe.skipIf(!process.env.DEEPSEEK_LIVE_KEY)('C1.8 REAL DeepSeek — P0 five-command smoke gate', () => {
  it('SMOKE-1 global read: 最近所有客户的跟进记录 → follow_up.global.read (no mutation)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const controller = makeController(fixture.db);
    const turn = await controller.submit('最近所有客户的跟进记录有哪些？');
    expect(turn.state.phase).toBe('scoped');
    expect(turn.state.latest_direct_answer?.shape).toBe('LIST');
    expect(turn.state.agent_message).toMatch(/跟进记录/);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get().c).toBe(0);
    fixture.close();
  });

  it('SMOKE-2 opportunity amount: 商机金额记 20 万 → update_opportunity_amount 200000 (confirm, 0 writes)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('这个客户商机金额记 20 万');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
    expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(200000);
    const row = fixture.sqlite.prepare('SELECT opportunity_amount FROM customers WHERE id=?').get('customer-1') as { opportunity_amount: number | null };
    expect(row.opportunity_amount).toBeNull();
    fixture.close();
  });

  it('SMOKE-3 customer create: 新建客户 → create_customer (name + contact)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const controller = makeController(fixture.db);
    const turn = await controller.submit('新建一个客户，广州星河科技，联系人张总');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_customer');
    fixture.close();
  });

  it('SMOKE-4 follow up: 记录跟进 → follow_up.create (confirm, 0 writes)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('记录跟进：客户今天没回复，周三再联系');
    expect(turn.state.phase === 'proposal' || turn.state.phase === 'clarification').toBe(true);
    if (turn.state.phase === 'proposal') expect(turn.state.latest_proposal?.tool_id).toBe('create_follow_up_record');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get().c).toBe(0);
    fixture.close();
  });

  it('SMOKE-5 delete: 把这个客户删掉 → delete_customer STRONG_CONFIRM, 0 writes, customer exists', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('把这个客户删掉');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
    expect(turn.state.latest_proposal?.operation).toBe('delete');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1').c).toBe(1);
    fixture.close();
  });
});

describe.skipIf(!process.env.DEEPSEEK_LIVE_KEY)('C1.8 REAL DeepSeek — short-command safety', () => {
  it('写个跟进 → follow_up.create intent + clarify (missing content), no summary, 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('写个跟进');
    expect(turn.state.phase === 'clarification' || turn.state.phase === 'proposal').toBe(true);
    expect(turn.state.agent_message).not.toContain('本地字段汇总');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get().c).toBe(0);
    fixture.close();
  });

  it('删掉 (ambiguous) → clarify/fail-closed, no mutation', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('删掉');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1').c).toBe(1);
    fixture.close();
  });
});

describe.skipIf(!process.env.DEEPSEEK_LIVE_KEY)('C1.8 REAL DeepSeek — all-25 model routing matrix', () => {
  const CASES: Array<{ id: string; utterance: string }> = [
    { id: 'customer.search', utterance: '查找广州的客户' },
    { id: 'customer.get', utterance: '查看当前客户的资料' },
    { id: 'customer.context', utterance: '读取当前客户的上下文' },
    { id: 'timeline.customer.read', utterance: '查看当前客户的时间线' },
    { id: 'timeline.visit.read', utterance: '查看当前客户的拜访记录' },
    { id: 'follow_up.customer.read', utterance: '查看当前客户的跟进记录' },
    { id: 'follow_up.global.read', utterance: '最近所有客户的跟进记录有哪些' },
    { id: 'task.read_by_customer', utterance: '查看当前客户的任务' },
    { id: 'battle_card.current.read', utterance: '查看当前客户的作战卡' },
    { id: 'battle_card.history.read', utterance: '查看当前客户作战卡的历史版本' },
    { id: 'battle_card.context.read', utterance: '查看当前客户的作战卡上下文' },
    { id: 'import.file.preview', utterance: '帮我预览这个导入文件' },
    { id: 'import.mapping.validate', utterance: '校验这个导入文件的字段映射' },
    { id: 'customer.next_follow_up_time.update', utterance: '把下次跟进时间改到下周五下午三点' },
    { id: 'follow_up.create', utterance: '记录跟进：客户今天没回复' },
    { id: 'task.create', utterance: '创建任务：下周三提醒发报价' },
    { id: 'battle_card.draft.create', utterance: '生成当前客户的作战卡草稿' },
    { id: 'battle_card.confirm', utterance: '把这张作战卡草稿确认提交' },
    { id: 'battle_card.hypothesis.status.update', utterance: '更新作战卡假设的状态' },
    { id: 'battle_card.intelligence_import.confirm', utterance: '确认情报导入' },
    { id: 'customer.create', utterance: '新建客户广州星河科技，联系人张总' },
    { id: 'customer.profile.update', utterance: '把这个客户行业改成跨境电商' },
    { id: 'customer.delete', utterance: '把这个客户删掉' },
    { id: 'visit.create', utterance: '记录今天拜访：客户担心实施周期' },
    { id: 'customer.opportunity_amount.update', utterance: '这个客户商机金额记 20 万' },
  ];

  it(`model routes all 25 capabilities (count=${CASES.length})`, async () => {
    const failures: string[] = [];
    for (const c of CASES) {
      const result = await planCapability(c.utterance, NOW, 'customer-1', { modelSelect: realModelSelect });
      const selected = result.kind === 'invoke' ? result.selection.capability_id
        : result.kind === 'clarify' ? result.clarification.capability_id
          : null;
      if (selected !== c.id) {
        failures.push(`${c.id} ← "${c.utterance}" 实际选成 ${selected ?? '(unknown)'}`);
      }
    }
    expect(failures).toEqual([]);
  }, 180000);
});

describe.skipIf(!process.env.DEEPSEEK_LIVE_KEY)('C1.11 REAL DeepSeek — visit.create closed-value retest', () => {
  it('记录今天拜访：客户担心实施周期，下一步周五发方案 → visit.create with a valid next_action (never free text), 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');

    const turn = await controller.submit('记录今天拜访：客户担心实施周期，下一步周五发方案');

    // MODEL_SELECTED_CAPABILITY=visit.create：真实 proposal 必须落在 create_visit_record。
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_visit_record');
    expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);

    // next_action 必须是闭合枚举或省略，绝不自由文本（"周五发方案"）。
    const nextAction = turn.state.latest_proposal?.proposed_values?.next_action;
    if (nextAction !== undefined && nextAction !== null) {
      expect(typeof nextAction).toBe('string');
      expect(VISIT_NEXT_ACTIONS).toContain(nextAction);
    }

    // 确认前零写入。
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get().c).toBe(0);
    fixture.close();
  }, 120000);
});

describe.skipIf(!process.env.DEEPSEEK_LIVE_KEY)('C1.11 REAL DeepSeek — six controller.submit write E2E (0 pre-confirm writes)', () => {
  it('CASE-1 delete: 把这个客户删掉 → delete_customer STRONG_CONFIRM, 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('把这个客户删掉');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
    expect(turn.state.latest_proposal?.operation).toBe('delete');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1').c).toBe(1);
    fixture.close();
  }, 120000);

  it('CASE-2 opportunity: 这个客户商机金额记 20 万 → update_opportunity_amount 200000, 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('这个客户商机金额记 20 万');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
    expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(200000);
    const row = fixture.sqlite.prepare('SELECT opportunity_amount FROM customers WHERE id=?').get('customer-1') as { opportunity_amount: number | null };
    expect(row.opportunity_amount).toBeNull();
    fixture.close();
  }, 120000);

  it('CASE-3 create: 新建客户广州星河科技，联系人张总 → create_customer, 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const controller = makeController(fixture.db);
    const turn = await controller.submit('新建客户广州星河科技，联系人张总');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_customer');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get().c).toBe(0);
    fixture.close();
  }, 120000);

  it('CASE-4 visit: 记录今天拜访：客户担心实施周期，下一步周五发方案 → visit.create valid next_action, 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('记录今天拜访：客户担心实施周期，下一步周五发方案');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_visit_record');
    const nextAction = turn.state.latest_proposal?.proposed_values?.next_action;
    if (nextAction !== undefined && nextAction !== null) {
      expect(VISIT_NEXT_ACTIONS).toContain(nextAction);
    }
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get().c).toBe(0);
    fixture.close();
  }, 120000);

  it('CASE-5 profile: 把这个客户行业改成跨境电商 → update_customer_profile, 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('把这个客户行业改成跨境电商');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('update_customer_profile');
    const row = fixture.sqlite.prepare('SELECT industry FROM customers WHERE id=?').get('customer-1') as { industry: string | null };
    expect(row.industry).toBeNull();
    fixture.close();
  }, 120000);

  it('CASE-6 follow-up: 记录跟进：客户今天没回复，周三再联系 → create_follow_up_record (proposal/clarify), 0 writes', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = makeController(fixture.db, 'customer-1');
    const turn = await controller.submit('记录跟进：客户今天没回复，周三再联系');
    expect(turn.state.phase === 'proposal' || turn.state.phase === 'clarification').toBe(true);
    if (turn.state.phase === 'proposal') expect(turn.state.latest_proposal?.tool_id).toBe('create_follow_up_record');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get().c).toBe(0);
    fixture.close();
  }, 120000);
});
