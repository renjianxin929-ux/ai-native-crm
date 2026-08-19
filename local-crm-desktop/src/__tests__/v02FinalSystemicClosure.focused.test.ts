import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planCapability } from '../lib/planner/runtimePlanner';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { interpretCustomerQuery } from '../lib/planner/customerQueryInterpretation';
import { ALL_25_RUNTIME_INPUT_CAPABILITY_IDS, materializeRuntimeInput } from '../lib/planner/runtimeContextMaterializer';
import { createPendingCapabilityTurn, mergePendingCapabilityAnswer } from '../lib/planner/pendingCapabilityTurn';
import { parseRelativeDateTimeInZone } from '../lib/salesAgentTools/appClock';
import { formatProposalValues } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { formatQueryFailure } from '../lib/salesAgentUi/queryFailure';
import { classifyFollowUpVsSchedule } from '../lib/planner/followUpInteractionContract';
import { PRODUCTION_CAPABILITY_BINDINGS, PRODUCTION_CAPABILITY_REGISTRY } from '../lib/capabilities/execution';

const NOW = '2026-08-17T12:00:00+08:00';
const TZ = 'Asia/Shanghai';

describe('V0.2 final closure — customer query interpretation (module)', () => {
  it('广州客户有哪些 is a list with name_query, not region', () => {
    expect(interpretCustomerQuery('广州客户有哪些')).toMatchObject({
      list_mode: true,
      name_query: '广州',
      explicit_region: false,
    });
    expect(interpretCustomerQuery('广州客户有哪些').region).toBeUndefined();
  });

  it('找一下广州客户 is name contains 广州', () => {
    expect(interpretCustomerQuery('找一下广州客户').name_query).toBe('广州');
  });

  it('广州 C 级客户 keeps name + grade', () => {
    expect(interpretCustomerQuery('广州 C 级客户')).toMatchObject({
      name_query: '广州',
      customer_grade: 'C',
    });
    expect(interpretCustomerQuery('广州 C 级客户').region).toBeUndefined();
  });

  it('广州机械设备客户 is name + industry, not region', () => {
    const query = interpretCustomerQuery('广州机械设备客户');
    expect(query).toMatchObject({ name_query: '广州', industry: '机械设备', explicit_region: false });
    expect(query.region).toBeUndefined();
  });

  it('广州做机械设备的公司 is name + industry unless explicit geo language exists', () => {
    const query = interpretCustomerQuery('广州做机械设备的公司');
    expect(query).toMatchObject({ name_query: '广州', industry: '机械设备', explicit_region: false });
    expect(query.region).toBeUndefined();
  });

  it('广州地区的机械设备客户 uses explicit geo as region', () => {
    expect(interpretCustomerQuery('广州地区的机械设备客户')).toMatchObject({
      region: '广州',
      industry: '机械设备',
      explicit_region: true,
    });
    expect(interpretCustomerQuery('广州地区的机械设备客户').name_query).toBeUndefined();
  });

  it('位于广州的 C 级客户 uses explicit geo + grade', () => {
    expect(interpretCustomerQuery('位于广州的 C 级客户')).toMatchObject({
      region: '广州',
      customer_grade: 'C',
      explicit_region: true,
    });
  });

  it('广州地区的客户 is explicit region and current-product empty-region is not a name search', () => {
    expect(interpretCustomerQuery('广州地区的客户有哪些')).toMatchObject({
      region: '广州',
      explicit_region: true,
    });
    expect(interpretCustomerQuery('广州地区的客户有哪些').name_query).toBeUndefined();
  });

  it('上次联系广州ABC is a named last-contact fact, not region', () => {
    const query = interpretCustomerQuery('上次联系广州ABC是什么时候');
    expect(query.direct_fact).toBe('last_contact');
    expect(query.name_query).toMatch(/广州ABC/);
    expect(query.explicit_region).toBe(false);
  });

  it('帮我找深圳精确唯一客户有限公司 is a named lookup', () => {
    const query = interpretCustomerQuery('帮我找深圳精确唯一客户有限公司');
    expect(query.mode).toBe('lookup');
    expect(query.list_mode).toBe(false);
    expect(query.name_query).toBe('深圳精确唯一客户有限公司');
  });
});

describe('V0.2 final closure — Chinese meridiem clock (module)', () => {
  it.each([
    ['上午10:00', 'T10:00'],
    ['下午3:00', 'T15:00'],
    ['下午 3:00', 'T15:00'],
    ['晚上8:30', 'T20:30'],
    ['中午12:00', 'T12:00'],
  ])('%s parses to %s', (phrase, expected) => {
    const parsed = parseRelativeDateTimeInZone(`周三${phrase}`, NOW, TZ);
    expect(parsed?.iso).toContain(expected);
  });
});

describe('V0.2 final closure — production UI planner wiring (source)', () => {
  it('SalesAgentInteractionWorkspace builds a Trusted Host model planner, not an injected test planner', () => {
    const workspace = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
    const adapter = readFileSync('src/lib/salesAgentTools/trustedHostAdapter.ts', 'utf8');
    expect(workspace).toContain('createModelPlannerCaller');
    expect(workspace).toContain('model_planner:');
    expect(workspace).not.toMatch(/capability_planner\s*:/);
    expect(adapter).toContain('createTrustedHostModelPlannerCaller');
    expect(adapter).not.toMatch(/\bfetch\s*\(/);
  });

  it('keeps 25 production capabilities and 25 bindings', () => {
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(25);
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(25);
  });
});

describe('V0.2 final closure — runtime materializer + pending turn (module)', () => {
  it('lists all 25 capability ids as materializable', () => {
    expect(ALL_25_RUNTIME_INPUT_CAPABILITY_IDS).toHaveLength(25);
  });

  it('strips invented db/customer_id and injects the trusted db handle for search', async () => {
    const db = {
      async execute() { return { rowsAffected: 0 }; },
      async select() { return []; },
    };
    const input = await materializeRuntimeInput(
      'customer.search',
      { name_query: '广州', db: 'invented', customer_id: 'forged' },
      { db, clock: () => NOW, scoped_customer_id: null },
    ) as { filters: Record<string, unknown>; db: unknown };
    expect(input.db).toBe(db);
    expect(input.filters.name_query).toBe('广州');
    expect(input.filters.customer_id).toBeUndefined();
  });

  it('merges a clarification answer into the same pending capability', () => {
    const pending = createPendingCapabilityTurn({
      capability_id: 'customer.create',
      original_instruction: '新建一个广州新建客户',
      missing_fields: ['name'],
      clarification_question: '请提供客户名称',
      customer_scope: null,
      created_at: NOW,
    });
    const merged = mergePendingCapabilityAnswer(pending, '广州星河科技E2E');
    expect(merged.capability_id).toBe('customer.create');
    expect(merged.parsed_arguments.name).toBe('广州星河科技E2E');
    expect(merged.parsed_arguments).not.toHaveProperty('clarification_answer');
    expect(merged.missing_fields).toEqual([]);
  });
});

describe('V0.2 final closure — follow-up contract + field formatter (module)', () => {
  it('treats 写个跟进周三联系 as future-only scheduling', () => {
    expect(classifyFollowUpVsSchedule('写个跟进周三联系').kind).toBe('future_only');
  });

  it('treats mixed occurred + future as mixed', () => {
    expect(classifyFollowUpVsSchedule('记录跟进：今天打电话没接，周三再联系').kind).toBe('mixed');
  });

  it('formats proposal fields without raw internal names', () => {
    const text = formatProposalValues({
      next_follow_up_at: '2026-08-19T15:00:00+08:00',
      next_action: 'SEND_CONTRACT',
      opportunity_amount: 200000,
      capability_id: 'hidden',
    });
    expect(text).toMatch(/下次跟进/);
    expect(text).toMatch(/发送方案\/合同/);
    expect(text).toMatch(/¥200/);
    expect(text).not.toContain('capability_id');
    expect(text).not.toContain('SEND_CONTRACT');
  });

  it('uses cause-specific empty-region copy', () => {
    expect(formatQueryFailure('no_region_match', '广州')).toContain('地区字段为“广州”');
    expect(formatQueryFailure('no_region_match', '广州')).not.toContain('请补充更完整');
  });
});

describe('V0.2 final closure — Trusted Host model planner composition', () => {
  it('createTrustedHostModelPlannerCaller + planCapability keeps visit.create (no double-validate drop)', async () => {
    const caller = createTrustedHostModelPlannerCaller(async () => JSON.stringify({
      kind: 'invoke',
      capability_id: 'visit.create',
      arguments: { title: '记录今天拜访' },
    }));
    const result = await planCapability('记录今天拜访：客户担心实施周期', NOW, 'gz-abc', { modelSelect: caller });
    expect(result.kind).toBe('invoke');
    if (result.kind === 'invoke') {
      expect(result.selection.capability_id).toBe('visit.create');
      expect(result.selection.arguments.title).toBe('记录今天拜访');
    }
  });

  it('planCapability does not drop an already-validated invoke selection', async () => {
    const result = await planCapability('记录今天拜访', NOW, 'gz-abc', {
      modelSelect: async () => ({
        kind: 'invoke',
        selection: { capability_id: 'visit.create', arguments: { title: '记录今天拜访' } },
      }),
    });
    expect(result.kind).toBe('invoke');
    if (result.kind === 'invoke') expect(result.selection.capability_id).toBe('visit.create');
  });
});
