/**
 * V0.2C / C1.11 — Planner closed-value input schema closure (focused tests).
 *
 * 证明 C1.11 的中央修复：
 *   - planner 输入 schema 现在为每个有界业务字段暴露 type / required / nullable /
 *     enum_values / boolean_values / numeric_constraint / format；
 *   - 这些枚举/格式来自生产运行时代码已存在的唯一真源（引用同一数组对象，
 *     绝不新建第二份枚举表）——PRODUCTION_CONSTRAINT_IS_SOURCE_OF_TRUTH=true；
 *   - 绝不暴露 db / clock / customer_id / customerId 等执行/身份字段；
 *   - semantic_hint 仍是"能力消歧"提示，绝不复制业务枚举（
 *     SEMANTIC_HINT_BUSINESS_CONTRACT_DUPLICATION=false）；
 *   - planner schema 只是指导，绝不 bypass Layer-1：自由文本 next_action 仍被
 *     Layer-1（writeAdapters.validateInput）权威拒绝（PLANNER_SCHEMA_BYPASSES_LAYER1=false）。
 *
 * 全部测试无需真实模型、无网络、无真实用户数据（Layer-1 权威性用最小 db stub）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_CONFIRM_KEYS,
  BATTLE_CARD_DRAFT_CREATE_KEYS,
  BATTLE_CARD_HYPOTHESIS_UPDATE_KEYS,
  BATTLE_CARD_IMPORT_CONFIRM_KEYS,
  CONTACT_METHODS,
  CUSTOMER_CREATE_INPUT_KEYS,
  CUSTOMER_DELETE_INPUT_KEYS,
  CUSTOMER_NEXT_FOLLOW_UP_UPDATE_KEYS,
  CUSTOMER_OPPORTUNITY_AMOUNT_UPDATE_INPUT_KEYS,
  CUSTOMER_PROFILE_UPDATE_INPUT_KEYS,
  CUSTOMER_STAGES,
  FOLLOW_UP_CREATE_KEYS,
  HYPOTHESIS_STATUSES,
  INTENT_LEVELS,
  PHONE_FEEDBACKS,
  TASK_CREATE_KEYS,
  VISIT_CREATE_INPUT_KEYS_WITH_SELECTORS,
  WECHAT_ADD_STATUSES,
  WECHAT_SEARCH_STATUSES,
} from '../lib/capabilities/execution/writeAdapters';
import { VISIT_NEXT_ACTIONS, VISIT_OUTCOMES } from '../lib/visitCreate';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { planCapability } from '../lib/planner/runtimePlanner';
import { __setDbInstanceForTests, type DatabaseLike } from '../lib/db';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sessionForWrite, sqliteFixture } from './salesAgentProductionHarness';
import {
  PLANNER_INPUT_SCHEMAS,
  plannerInputSchemaFor,
  type PlannerFieldDescriptor,
} from '../lib/planner/plannerInputSchema';
import {
  PRODUCTION_PLANNER_TOOL_SURFACE,
  PLANNER_TOOL_CAPABILITY_IDS,
} from '../lib/planner/plannerToolSurface';
import { validateModelPlannerOutput } from '../lib/planner/runtimePlanner';
import {
  PRODUCTION_CAPABILITY_EXECUTION,
  type CapabilityInvocationScope,
} from '../lib/capabilities/execution';

/** 最小 db stub：select 恒返回 scope 客户存在（供 Layer-1 存在性前置校验前跳过）。 */
const dbStub: DatabaseLike = {
  execute: async () => ({ rowsAffected: 0 }),
  select: async () => [{ id: 'customer-A' }],
};

const FORBIDDEN_EXECUTION_KEYS = ['db', 'clock', 'customer_id', 'customerId'];

function allDescriptors(): Array<{ capabilityId: string; field: PlannerFieldDescriptor }> {
  const result: Array<{ capabilityId: string; field: PlannerFieldDescriptor }> = [];
  for (const [capabilityId, schema] of Object.entries(PLANNER_INPUT_SCHEMAS)) {
    for (const field of Object.values(schema.fields)) {
      result.push({ capabilityId, field });
    }
  }
  return result;
}

describe('C1.11 — planner schema exposes closed-value constraints from production truth', () => {
  it('every write capability carries a fields descriptor map consistent with allowed_fields', () => {
    expect(Object.keys(PLANNER_INPUT_SCHEMAS)).toHaveLength(13);
    for (const [capabilityId, schema] of Object.entries(PLANNER_INPUT_SCHEMAS)) {
      expect(Object.keys(schema.fields).sort(), capabilityId).toEqual([...schema.allowed_fields].sort());
      for (const name of schema.allowed_fields) {
        expect(schema.fields[name].name, `${capabilityId}.${name}`).toBe(name);
      }
      // required 由描述单一派生，与 required_fields 一致。
      const requiredFromFields = Object.values(schema.fields).filter((f) => f.required).map((f) => f.name);
      expect(requiredFromFields.sort(), capabilityId).toEqual([...schema.required_fields].sort());
    }
  });

  it('never exposes db/clock/customer_id/customerId or executor internals', () => {
    for (const { capabilityId, field } of allDescriptors()) {
      expect(FORBIDDEN_EXECUTION_KEYS, `${capabilityId}.${field.name}`).not.toContain(field.name);
    }
    const serialized = JSON.stringify(PRODUCTION_PLANNER_TOOL_SURFACE);
    expect(serialized).not.toMatch(/executor_ref|"db"|"clock"|api_key|sk-[A-Za-z0-9]/i);
  });

  it('visit.create exposes the exact next_action/visit_outcome/intent enums from the canonical source (same reference)', () => {
    const visit = PLANNER_INPUT_SCHEMAS['visit.create']!;
    expect(visit.fields.next_action!.enum_values).toBe(VISIT_NEXT_ACTIONS);
    expect(visit.fields.visit_outcome!.enum_values).toBe(VISIT_OUTCOMES);
    expect(visit.fields.intent_after_visit!.enum_values).toBe(INTENT_LEVELS);
    expect(visit.fields.next_action!.type).toBe('enum');
    expect(visit.fields.next_action!.required).toBe(false);
    expect(visit.fields.next_action!.nullable).toBe(true);
    expect(visit.fields.expected_contract_at!.type).toBe('string');
    expect(visit.fields.expected_contract_at!.format).toBe('YYYY-MM-DD');
  });

  it('customer.create exposes all five closed enums + boolean 0|1 from the canonical source', () => {
    const create = PLANNER_INPUT_SCHEMAS['customer.create']!;
    expect(create.fields.contact_method!.enum_values).toBe(CONTACT_METHODS);
    expect(create.fields.wechat_search_status!.enum_values).toBe(WECHAT_SEARCH_STATUSES);
    expect(create.fields.wechat_add_status!.enum_values).toBe(WECHAT_ADD_STATUSES);
    expect(create.fields.intent_level!.enum_values).toBe(INTENT_LEVELS);
    expect(create.fields.phone_feedback!.enum_values).toBe(PHONE_FEEDBACKS);
    expect(create.fields.is_key_decision_maker!.type).toBe('boolean');
    expect(create.fields.is_key_decision_maker!.boolean_values).toEqual([0, 1]);
  });

  it('customer.profile.update exposes its closed enums + boolean from the canonical source', () => {
    const profile = PLANNER_INPUT_SCHEMAS['customer.profile.update']!;
    expect(profile.fields.wechat_search_status!.enum_values).toBe(WECHAT_SEARCH_STATUSES);
    expect(profile.fields.contact_method!.enum_values).toBe(CONTACT_METHODS);
    expect(profile.fields.is_key_decision_maker!.type).toBe('boolean');
  });

  it('battle card bounded fields expose canonical enums/numeric constraints', () => {
    const draft = PLANNER_INPUT_SCHEMAS['battle_card.draft.create']!;
    expect(draft.fields.stage_code!.enum_values).toBe(CUSTOMER_STAGES);
    expect(draft.fields.stage_code!.required).toBe(true);

    const hypothesis = PLANNER_INPUT_SCHEMAS['battle_card.hypothesis.status.update']!;
    expect(hypothesis.fields.new_status!.enum_values).toBe(HYPOTHESIS_STATUSES);
    expect(hypothesis.fields.new_status!.required).toBe(true);

    const confirm = PLANNER_INPUT_SCHEMAS['battle_card.confirm']!;
    expect(confirm.fields.expected_version!.type).toBe('number');
    expect(confirm.fields.expected_version!.numeric_constraint).toBe('finite');
  });

  it('opportunity_amount is a finite-positive-or-null number', () => {
    const opp = PLANNER_INPUT_SCHEMAS['customer.opportunity_amount.update']!;
    expect(opp.fields.opportunity_amount!.type).toBe('number');
    expect(opp.fields.opportunity_amount!.required).toBe(true);
    expect(opp.fields.opportunity_amount!.nullable).toBe(true);
    expect(opp.fields.opportunity_amount!.numeric_constraint).toBe('positive');
  });

  it('audit counts match the frozen constraint surface (bounded=21, enum=12, format=1)', () => {
    const descriptors = allDescriptors();
    const enumCount = descriptors.filter((d) => d.field.type === 'enum').length;
    const formatCount = descriptors.filter((d) => d.field.format !== undefined).length;
    const boundedCount = descriptors.filter((d) => d.field.type !== 'string' || d.field.format !== undefined).length;
    expect(enumCount).toBe(12);
    expect(formatCount).toBe(1);
    expect(boundedCount).toBe(21);
  });

  it('field descriptor names exactly match the Layer-1 input key constants (no drift, no system fields)', () => {
    const KEYS_BY_CAPABILITY: Record<string, readonly string[]> = {
      'follow_up.create': FOLLOW_UP_CREATE_KEYS,
      'task.create': TASK_CREATE_KEYS,
      'customer.next_follow_up_time.update': CUSTOMER_NEXT_FOLLOW_UP_UPDATE_KEYS,
      'customer.create': CUSTOMER_CREATE_INPUT_KEYS,
      'customer.profile.update': CUSTOMER_PROFILE_UPDATE_INPUT_KEYS,
      'customer.opportunity_amount.update': CUSTOMER_OPPORTUNITY_AMOUNT_UPDATE_INPUT_KEYS,
      'customer.delete': CUSTOMER_DELETE_INPUT_KEYS,
      'visit.create': VISIT_CREATE_INPUT_KEYS_WITH_SELECTORS,
      'battle_card.draft.create': BATTLE_CARD_DRAFT_CREATE_KEYS,
      'battle_card.confirm': BATTLE_CARD_CONFIRM_KEYS,
      'battle_card.hypothesis.status.update': BATTLE_CARD_HYPOTHESIS_UPDATE_KEYS,
      'battle_card.intelligence_import.confirm': BATTLE_CARD_IMPORT_CONFIRM_KEYS,
    };
    const systemKeys = new Set(['db', 'clock', 'customer_id', 'customerId']);
    for (const [capabilityId, keys] of Object.entries(KEYS_BY_CAPABILITY)) {
      const businessFields = keys.filter((k) => !systemKeys.has(k)).sort();
      expect(Object.keys(PLANNER_INPUT_SCHEMAS[capabilityId]!.fields).sort(), capabilityId).toEqual(businessFields);
    }
  });
});

describe('C1.11 — semantic_hint stays selection disambiguation only (no enum/contract duplication)', () => {
  it('no semantic_hint carries any enum value or business contract', () => {
    const enumValues = new Set([
      ...VISIT_NEXT_ACTIONS, ...VISIT_OUTCOMES, ...INTENT_LEVELS,
      ...CONTACT_METHODS, ...WECHAT_SEARCH_STATUSES, ...WECHAT_ADD_STATUSES,
      ...PHONE_FEEDBACKS, ...CUSTOMER_STAGES, ...HYPOTHESIS_STATUSES,
    ]);
    for (const descriptor of PRODUCTION_PLANNER_TOOL_SURFACE) {
      for (const value of enumValues) {
        expect(descriptor.semantic_hint, `${descriptor.capability_id} semantic_hint`).not.toContain(value);
      }
    }
  });
});

describe('C1.11 — planner schema is guidance, not authoritative (Layer-1 still enforces)', () => {
  it('validateModelPlannerOutput passes a valid enum value through untouched', () => {
    const result = validateModelPlannerOutput({
      kind: 'invoke',
      capability_id: 'visit.create',
      arguments: { title: '记录今天拜访', next_action: 'SEND_CONTRACT' },
    });
    expect(result.kind).toBe('invoke');
    if (result.kind === 'invoke') {
      expect(result.selection.arguments.next_action).toBe('SEND_CONTRACT');
    }
  });

  it('Layer-1 still rejects free-text next_action (planner never bypasses production validation)', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'visit.create',
      capability_version: '1.0.0',
      input: { db: dbStub, title: '记录今天拜访', next_action: '周五发方案' },
      scope: { customer_id: 'customer-A' } satisfies CapabilityInvocationScope,
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
  });
});

describe('C1.11 — planner tool surface carries the field descriptors to the model', () => {
  it('all 25 descriptors expose an input_schema with a fields map', () => {
    expect(PRODUCTION_PLANNER_TOOL_SURFACE).toHaveLength(25);
    expect(PLANNER_TOOL_CAPABILITY_IDS).toHaveLength(25);
    for (const descriptor of PRODUCTION_PLANNER_TOOL_SURFACE) {
      expect(descriptor.input_schema.fields, descriptor.capability_id).toBeDefined();
      expect(typeof descriptor.input_schema.fields, descriptor.capability_id).toBe('object');
    }
  });

  it('visit.create tool descriptor exposes next_action enum_values to the model', () => {
    const visit = PRODUCTION_PLANNER_TOOL_SURFACE.find((d) => d.capability_id === 'visit.create')!;
    expect(visit.input_schema.fields.next_action!.enum_values).toBe(VISIT_NEXT_ACTIONS);
  });

  it('scope-only reads have empty input schemas; customer.search exposes business filters', () => {
    expect(plannerInputSchemaFor('customer.search').allowed_fields).toEqual([
      'name_query', 'region', 'industry', 'customer_grade', 'list_kind',
    ]);
    for (const id of ['customer.get', 'follow_up.global.read', 'timeline.visit.read']) {
      const schema = plannerInputSchemaFor(id);
      expect(schema.allowed_fields, id).toEqual([]);
      expect(schema.required_fields, id).toEqual([]);
      expect(Object.keys(schema.fields), id).toEqual([]);
    }
  });
});

describe('C1.11 — non-live pipeline proof: valid enum reaches proposal with 0 pre-confirm writes', () => {
  afterEach(() => {
    __resetSessionWriteStateStoreForTests();
    __setDbInstanceForTests(null);
  });

  it('controller.submit with a model that returns SEND_CONTRACT reaches proposal (visit.create, 0 writes)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');

    const NOW = '2026-07-15T12:00:00+08:00';
    const controller = new SalesAgentInteractionController({
      db: fixture.db as never,
      createSession: () => sessionForWrite(),
      clock: () => NOW,
      capability_planner: (utterance, scopedCustomerId) => planCapability(utterance, NOW, scopedCustomerId, {
        db: fixture.db as never,
        modelSelect: async () => ({
          kind: 'invoke',
          capability_id: 'visit.create',
          arguments: { title: '记录今天拜访', customer_concerns: '担心实施周期', next_action: 'SEND_CONTRACT' },
        }),
      }),
    });
    controller.syncExternalScope('customer-1', '测试客户');

    const turn = await controller.submit('记录今天拜访：客户担心实施周期，下一步周五发方案');

    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_visit_record');
    expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
    expect(turn.state.latest_proposal?.proposed_values?.next_action).toBe('SEND_CONTRACT');
    // 确认前零写入（无面访行、客户仍存在）。
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get().c).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1').c).toBe(1);
    fixture.close();
  });

  it('controller.submit with a model that returns industry reaches proposal (profile.update, 0 writes)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');

    const NOW = '2026-07-15T12:00:00+08:00';
    const controller = new SalesAgentInteractionController({
      db: fixture.db as never,
      createSession: () => sessionForWrite(),
      clock: () => NOW,
      capability_planner: (utterance, scopedCustomerId) => planCapability(utterance, NOW, scopedCustomerId, {
        db: fixture.db as never,
        modelSelect: async () => ({
          kind: 'invoke',
          capability_id: 'customer.profile.update',
          arguments: { industry: '跨境电商' },
        }),
      }),
    });
    controller.syncExternalScope('customer-1', '测试客户');

    const turn = await controller.submit('把这个客户行业改成跨境电商');

    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('update_customer_profile');
    expect(turn.state.latest_proposal?.proposed_values?.industry).toBe('跨境电商');
    // 确认前零写入：客户 industry 仍为种子值。
    const row = fixture.sqlite.prepare('SELECT industry FROM customers WHERE id=?').get('customer-1') as { industry: string | null };
    expect(row.industry).toBeNull();
    fixture.close();
  });
});
