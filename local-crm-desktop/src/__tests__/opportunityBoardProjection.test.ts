/**
 * V0.2C / C0 — Personal Opportunity Board Projection 语义闭合测试。
 *
 * 证明看板投影层把"列态（board column state）"与"聚合资格（aggregate
 * eligibility）"分离，且每个 CustomerStage 恰好映射一个列态、PAID 显式分类、
 * open pipeline 只聚合非终端的显式金额、null 永不当作 0、绝不派生默认金额。
 * 同时证明 C0 既有数据基础（opportunity_amount 字段 / 写能力 / 25 能力 /
 * B1 Evidence）在本轮未被改动。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  deriveBoardStage,
  isOpenPipelineStage,
  projectOpportunityBoard,
} from '../lib/opportunityBoard/opportunityBoardProjection';
import { PRODUCTION_CAPABILITY_COUNT, PRODUCTION_CAPABILITY_REGISTRY } from '../lib/capabilities/execution';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';
import type { Customer, CustomerStage } from '../lib/types';

const ALL_STAGES: readonly CustomerStage[] = [
  'NEW_LEAD', 'CONTACTED', 'WECHAT_PASSED', 'REPLIED',
  'VISIT_READY', 'VISITED',
  'CONTRACTING', 'PAYMENT_PENDING',
  'PAID', 'WON', 'LOST',
];

function makeCustomer(overrides: Partial<Customer> & { id: string; name: string; stage: CustomerStage }): Customer {
  return {
    id: overrides.id,
    name: overrides.name,
    customer_grade: 'C',
    stage: overrides.stage,
    contact_method: null,
    wechat_id: null,
    phone_number: null,
    wechat_search_status: null,
    is_key_decision_maker: 0,
    wechat_add_status: 'NOT_ADDED',
    has_replied: 0,
    intent_level: 'UNKNOWN',
    phone_feedback: null,
    can_schedule_visit: 0,
    visit_scheduled_at: null,
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: overrides.next_follow_up_at ?? null,
    last_contacted_at: null,
    last_feedback_type: 'UNKNOWN',
    next_action: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    opportunity_amount: overrides.opportunity_amount ?? null,
    paid_at: null,
    closed_at: null,
    notes: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
  };
}

describe('C0 closure — T1/T2: exhaustive stage mapping + explicit PAID classification', () => {
  it('T1: every CustomerStage maps exactly once to a board column (no unclassified stage)', () => {
    const byStage: Record<string, string> = {};
    for (const stage of ALL_STAGES) {
      const column = deriveBoardStage(stage);
      // 恰好一个列态：重复映射会覆盖；这里记录并确认无遗漏。
      byStage[stage] = column;
    }
    expect(Object.keys(byStage)).toHaveLength(ALL_STAGES.length);
    // 穷尽：每个阶段都有列态。
    expect(Object.values(byStage)).toHaveLength(ALL_STAGES.length);

    expect(byStage).toEqual({
      NEW_LEAD: 'NEW',
      CONTACTED: 'NEW',
      WECHAT_PASSED: 'NEW',
      REPLIED: 'NEW',
      VISIT_READY: 'ACTIVE',
      VISITED: 'ACTIVE',
      CONTRACTING: 'PENDING',
      PAYMENT_PENDING: 'PENDING',
      PAID: 'WON',
      WON: 'WON',
      LOST: 'LOST',
    });
  });

  it('T1: unknown stage fails closed (never silently classified)', () => {
    expect(() => deriveBoardStage('INVENTED_STAGE')).toThrow(/Unknown customer stage/);
  });

  it('T2: PAID has explicit classification = WON (commercial completion), and is NOT open pipeline', () => {
    expect(deriveBoardStage('PAID')).toBe('WON');
    expect(isOpenPipelineStage('PAID')).toBe(false);
    expect(deriveBoardStage('WON')).toBe('WON');
    expect(isOpenPipelineStage('WON')).toBe(false);
    expect(isOpenPipelineStage('LOST')).toBe(false);
    // 非终端才 open。
    for (const stage of ['NEW_LEAD', 'CONTACTED', 'WECHAT_PASSED', 'REPLIED', 'VISIT_READY', 'VISITED', 'CONTRACTING', 'PAYMENT_PENDING']) {
      expect(isOpenPipelineStage(stage)).toBe(true);
    }
  });
});

describe('C0 closure — T3/T4/T5: column subtotals are mutually exclusive', () => {
  it('T3: NEW amount does not appear in ACTIVE-column subtotal', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'new', name: 'N', stage: 'NEW_LEAD', opportunity_amount: 100 }),
    ]);
    expect(projection.summary.new_column_amount).toBe(100);
    expect(projection.summary.active_column_amount).toBe(0);
    expect(projection.summary.pending_column_amount).toBe(0);
    expect(projection.summary.open_pipeline_amount).toBe(100);
  });

  it('T4: ACTIVE amount appears only in ACTIVE-column subtotal', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'act', name: 'A', stage: 'VISITED', opportunity_amount: 200 }),
    ]);
    expect(projection.summary.active_column_amount).toBe(200);
    expect(projection.summary.new_column_amount).toBe(0);
    expect(projection.summary.pending_column_amount).toBe(0);
    expect(projection.summary.open_pipeline_amount).toBe(200);
  });

  it('T5: PENDING amount appears only in PENDING subtotal', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'pend', name: 'P', stage: 'PAYMENT_PENDING', opportunity_amount: 300 }),
    ]);
    expect(projection.summary.pending_column_amount).toBe(300);
    expect(projection.summary.new_column_amount).toBe(0);
    expect(projection.summary.active_column_amount).toBe(0);
    expect(projection.summary.open_pipeline_amount).toBe(300);
  });
});

describe('C0 closure — T6/T7/T8: open pipeline eligibility', () => {
  it('T6: WON does not pollute open pipeline', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'w', name: 'W', stage: 'WON', opportunity_amount: 500 }),
    ]);
    expect(projection.summary.open_pipeline_amount).toBe(0);
    expect(projection.summary.won_amount).toBe(500);
    expect(projection.rows[0]!.open_pipeline).toBe(false);
  });

  it('T7: LOST does not pollute open pipeline', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'l', name: 'L', stage: 'LOST', opportunity_amount: 700 }),
    ]);
    expect(projection.summary.open_pipeline_amount).toBe(0);
    expect(projection.summary.lost_amount).toBe(700);
    expect(projection.rows[0]!.open_pipeline).toBe(false);
  });

  it('T6b: PAID does not pollute open pipeline (terminal, same as WON)', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'p', name: 'P', stage: 'PAID', opportunity_amount: 600 }),
    ]);
    expect(projection.summary.open_pipeline_amount).toBe(0);
    expect(projection.summary.won_amount).toBe(600);
    expect(projection.rows[0]!.open_pipeline).toBe(false);
    expect(projection.rows[0]!.board_stage).toBe('WON');
  });

  it('T8: open pipeline aggregate = NEW + ACTIVE + PENDING, excluding PAID/WON/LOST', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'n', name: 'N', stage: 'NEW_LEAD', opportunity_amount: 10 }),
      makeCustomer({ id: 'a', name: 'A', stage: 'VISITED', opportunity_amount: 20 }),
      makeCustomer({ id: 'p1', name: 'P1', stage: 'CONTRACTING', opportunity_amount: 30 }),
      makeCustomer({ id: 'p2', name: 'P2', stage: 'PAYMENT_PENDING', opportunity_amount: 40 }),
      makeCustomer({ id: 'paid', name: 'PAID', stage: 'PAID', opportunity_amount: 500 }),
      makeCustomer({ id: 'w', name: 'W', stage: 'WON', opportunity_amount: 600 }),
      makeCustomer({ id: 'l', name: 'L', stage: 'LOST', opportunity_amount: 700 }),
    ]);
    expect(projection.summary.new_column_amount).toBe(10);
    expect(projection.summary.active_column_amount).toBe(20);
    expect(projection.summary.pending_column_amount).toBe(70);
    expect(projection.summary.open_pipeline_amount).toBe(100);
    expect(projection.summary.won_amount).toBe(1100);
    expect(projection.summary.lost_amount).toBe(700);
    expect(projection.summary.open_pipeline_count).toBe(4);
  });
});

describe('C0 closure — T9/T10: null invariants + no default amount', () => {
  it('T9: null amount remains unknown and never aggregates as zero', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'n', name: 'N', stage: 'VISITED', opportunity_amount: null }),
      makeCustomer({ id: 'u', name: 'U', stage: 'NEW_LEAD', opportunity_amount: undefined }),
      makeCustomer({ id: 'x', name: 'X', stage: 'CONTRACTING', opportunity_amount: Number.NaN }),
    ]);
    expect(projection.rows.every((r) => r.opportunity_amount === null)).toBe(true);
    expect(projection.summary.open_pipeline_amount).toBe(0);
    expect(projection.summary.unknown_amount_count).toBe(3);
    // 计数仍计入三列。
    expect(projection.summary.open_pipeline_count).toBe(3);
  });

  it('T10: no stage derives a default amount (unknown stays null, never a stage-derived value)', () => {
    for (const stage of ALL_STAGES) {
      const projection = projectOpportunityBoard([
        makeCustomer({ id: `s-${stage}`, name: stage, stage, opportunity_amount: null }),
      ]);
      expect(projection.rows[0]!.opportunity_amount).toBeNull();
      // 绝不存在任何"阶段默认金额"进入聚合。
      expect(projection.summary.open_pipeline_amount + projection.summary.won_amount + projection.summary.lost_amount).toBe(0);
    }
  });
});

describe('C0 closure — T11/T12/T13: C0 data foundation unchanged', () => {
  it('T11: opportunity_amount write capability is unchanged (id/version/effect/confirmation/executor)', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.opportunity_amount.update', '1.0.0');
    expect(definition.id).toBe('customer.opportunity_amount.update');
    expect(definition.version).toBe('1.0.0');
    expect(definition.effect).toBe('WRITE');
    expect(definition.data_target).toBe('CRM_FACT');
    expect(definition.requires_confirmation).toBe(true);
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_opportunity_amount');
  });

  it('T12: production capability count remains 25', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(25);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(25);
  });

  it('T13: B1 Evidence architecture is unchanged', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
  });

  it('T14: projection module is pure data projection (no UI/React/presentation code)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/opportunityBoard/opportunityBoardProjection.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]react['"]/);
    expect(source).not.toMatch(/\.tsx/);
    expect(source).not.toMatch(/useState|useEffect|className|style=/);
    expect(source).not.toMatch(/import .* from ['"]\.\.\/\.\.\/(pages|components)\//);
  });
});
