// @vitest-environment jsdom
/**
 * V0.2 final UI compression — lightweight projection / DOM contract tests.
 * Display-only. Does not change capabilities, schema, A10, Layer-1, or nonce.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { Customer, FollowUpRecord, VisitRecord } from '../lib/types';
import type { ActionCard } from '../lib/battleCard/types';
import {
  projectCustomerDetailFirstLayer,
  projectCustomerProfileFields,
  CUSTOMER_DETAIL_LAYER2_ACCORDIONS,
} from '../lib/customerDetailUi/customerDetailProjection';
import { buildCustomerTimeline } from '../lib/salesWorkspace/customerIntelligence';
import {
  BATTLE_CARD_PRIMARY_SECTION_IDS,
  BATTLE_CARD_SECONDARY_SECTION_IDS,
  toStageCardBundle,
} from '../lib/battleCardUi/battleCardViewModels';
import { ActionCardView } from '../components/battleCard/ActionCardView';
import { TRANSLATION_CATALOG } from '../lib/i18n/catalog';
import { resetAppLocaleForTests, setAppLocale, t, tField, tStage } from '../lib/i18n/appLocale';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HANZI = /[\u4e00-\u9fff]/;
const customerDetailSrc = readFileSync('src/pages/CustomerDetail.tsx', 'utf8');
const battlePageSrc = readFileSync('src/pages/CustomerBattleCardPage.tsx', 'utf8');
const actionCardSrc = readFileSync('src/components/battleCard/ActionCardView.tsx', 'utf8');
const catalogSrc = readFileSync('src/lib/i18n/catalog.ts', 'utf8');

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    name: '广州星河科技',
    customer_grade: 'A',
    stage: 'CONTACTED',
    contact_method: null,
    wechat_id: null,
    phone_number: null,
    wechat_search_status: null,
    is_key_decision_maker: 0,
    wechat_add_status: 'NOT_ADDED',
    has_replied: 0,
    intent_level: 'HIGH',
    phone_feedback: null,
    can_schedule_visit: 0,
    visit_scheduled_at: null,
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: '2026-08-21T10:00:00+08:00',
    last_contacted_at: '2026-08-18T10:00:00+08:00',
    last_feedback_type: 'UNKNOWN',
    next_action: 'CONTACT_AGAIN',
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    opportunity_amount: 200000,
    paid_at: null,
    closed_at: null,
    website: null,
    region: null,
    industry: null,
    contact_person: '张总',
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    source: null,
    notes: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

function makeFollowUp(): FollowUpRecord {
  return {
    id: 'fu-1',
    customer_id: 'c1',
    title: '电话沟通需求',
    contact_channel: 'phone',
    contact_result: 'positive',
    feedback_notes: '客户愿意看方案',
    intent_assessment: 'HIGH',
    suggested_grade: null,
    next_action: null,
    next_follow_up_at: null,
    is_completed: 1,
    created_at: '2026-08-17T00:00:00.000Z',
    updated_at: '2026-08-17T12:00:00.000Z',
  };
}

function makeVisit(): VisitRecord {
  return {
    id: 'v-1',
    customer_id: 'c1',
    title: '现场拜访',
    visit_notes: '确认采购流程',
    customer_concerns: null,
    intent_after_visit: null,
    visit_outcome: 'FOLLOW_UP_NEEDED',
    next_action: null,
    expected_contract_at: null,
    visited_at: '2026-08-16T00:00:00.000Z',
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
  };
}

const action: ActionCard = {
  current_situation: '客户处于已联系阶段，决策人仍待确认。',
  stage_goal: '确认决策人并约到下一次沟通。',
  stage_entry_criteria: ['线索已入库'],
  stage_exit_criteria: ['完成有效触达'],
  confirmed_facts: [{
    fact_id: 'f1',
    statement: '公司在广州',
    applicability: 'GLOBAL',
    evidence_refs: ['CUSTOMER:c1'],
  }],
  key_hypotheses: [{
    hypothesis_id: 'h1',
    statement: '采购流程分散',
    status: 'PENDING',
    applicability: 'CONDITIONAL',
    why_it_matters: '影响切入',
    validation_question: '谁拍板？',
    disconfirm_condition: '已有负责人',
    evidence_refs: [],
  }],
  target_roles: ['采购'],
  must_ask_questions: ['当前用什么工具？'],
  next_best_action: {
    target_role: '采购',
    channel: 'wechat',
    recommended_time: '本周',
    objective: '确认需求',
    opening: '您好',
    questions: ['Q1'],
    success_signal: '愿意见面',
    failure_signal: '无回复',
    fallback_action: '电话跟进',
  },
  success_signal: '客户同意下一步',
  failure_signal: '连续无回复',
  risks: ['决策人不清'],
  do_not_say: ['保证成交'],
  changes_since_previous_card: ['首版'],
  confidence: 'medium',
  evidence_refs: ['CUSTOMER:c1'],
};

let container: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  root = createRoot(container);
  act(() => { root.render(node); });
}

beforeEach(() => {
  resetAppLocaleForTests();
  document.body.innerHTML = '<div id="test-container"></div>';
  container = document.querySelector('#test-container') as HTMLDivElement;
});

afterEach(() => {
  act(() => { root?.unmount(); });
  document.body.innerHTML = '';
  resetAppLocaleForTests();
});

describe('T1 — empty fields do not occupy every row', () => {
  it('omits empty optional profile fields and reports the missing count', () => {
    const projection = projectCustomerProfileFields(makeCustomer());
    expect(projection.presentKeys).toContain('name');
    expect(projection.presentKeys).toContain('contact_person');
    expect(projection.presentKeys).not.toContain('phone_number');
    expect(projection.presentKeys).not.toContain('email');
    expect(projection.presentKeys).not.toContain('industry');
    expect(projection.emptyCount).toBeGreaterThanOrEqual(3);
    expect(customerDetailSrc).toContain('projectCustomerProfileFields');
    expect(customerDetailSrc).not.toMatch(/customer\.phone_number \|\| '-'/);
    expect(customerDetailSrc).not.toMatch(/customer\.email \|\| '-'/);
  });
});

describe('T2 — timeline is not fully expanded by default', () => {
  it('keeps first-layer timelineCollapsed and mounts the full timeline only in a closed accordion', () => {
    const followUps = [makeFollowUp(), { ...makeFollowUp(), id: 'fu-2', title: '第二次跟进', updated_at: '2026-08-15T00:00:00.000Z' }];
    const visits = [makeVisit()];
    const first = projectCustomerDetailFirstLayer(makeCustomer(), followUps, visits, buildCustomerTimeline(followUps, visits));
    expect(first.timelineExpanded).toBe(false);
    expect(customerDetailSrc).toContain('data-testid="customer-detail-layer-timeline"');
    expect(customerDetailSrc).toMatch(/<details[^>]*data-testid="customer-detail-layer-timeline"/);
    expect(customerDetailSrc).not.toMatch(/data-testid="customer-detail-layer-timeline"[^>]*\sopen/);
    expect(customerDetailSrc).not.toContain('detailsOpen');
  });
});

describe('T3 — first layer keeps high-frequency summary', () => {
  it('projects name, grade, stage, amount, next follow-up, contact, recent activity, and next action', () => {
    const followUps = [makeFollowUp()];
    const visits = [makeVisit()];
    const first = projectCustomerDetailFirstLayer(
      makeCustomer(),
      followUps,
      visits,
      buildCustomerTimeline(followUps, visits),
    );
    expect(first.name).toBe('广州星河科技');
    expect(first.grade).toBe('A');
    expect(first.stage).toBe('CONTACTED');
    expect(first.opportunityAmount).toBe(200000);
    expect(first.nextFollowUpAt).toBeTruthy();
    expect(first.contactPerson).toBe('张总');
    expect(first.nextAction).toBe('CONTACT_AGAIN');
    expect(first.recent.lastFollowUp?.title).toBe('电话沟通需求');
    expect(first.recent.lastVisit?.title).toBe('现场拜访');
    expect(first.recent.lastKeyChange).toBeTruthy();
    expect(customerDetailSrc).toContain('data-testid="customer-detail-first-layer"');
    expect(customerDetailSrc).toContain('data-testid="customer-detail-recent-activity"');
    expect(customerDetailSrc).toContain('data-testid="customer-detail-next-step"');
    expect(customerDetailSrc).toContain("t('customer.detail.grade')");
    expect(customerDetailSrc).toContain("t('customer.detail.amount')");
    expect(customerDetailSrc).toContain("t('customer.detail.nextFollowUp')");
  });
});

describe('T4 — low-frequency content lives in a small accordion set', () => {
  it('folds profile, timeline, intelligence, and management into four closed layers', () => {
    expect(CUSTOMER_DETAIL_LAYER2_ACCORDIONS).toEqual([
      'profile',
      'timeline',
      'intelligence',
      'management',
    ]);
    for (const id of CUSTOMER_DETAIL_LAYER2_ACCORDIONS) {
      expect(customerDetailSrc).toContain(`data-testid="customer-detail-layer-${id}"`);
    }
    expect(customerDetailSrc).toContain('CustomerIntelligencePanel');
    expect(customerDetailSrc).toContain("t('customer.detail.delete')");
    expect(customerDetailSrc.match(/data-testid="customer-detail-layer-/g)?.length).toBe(4);
  });
});

describe('T5 — zh-CN chrome does not leak raw schema keys', () => {
  it('uses locale labels instead of NEW_LEAD / contact_method / raw keys', () => {
    resetAppLocaleForTests();
    expect(tStage('NEW_LEAD')).toBe('新线索');
    expect(tStage('NEW_LEAD')).not.toBe('NEW_LEAD');
    expect(tField('contact_method')).not.toBe('contact_method');
    expect(t('customer.detail.stage')).not.toBe('stage');
    expect(customerDetailSrc).toContain('tStage(');
    expect(customerDetailSrc).not.toMatch(/\{customer\.stage\}/);
    expect(customerDetailSrc).not.toMatch(/>NEW_LEAD</);
    expect(customerDetailSrc).not.toMatch(/>contact_method</);
  });
});

describe('T6 — en-US modified chrome has no hardcoded Chinese', () => {
  it('keeps en-US catalog copy for this round Hanzi-free', () => {
    const keys = Object.entries(TRANSLATION_CATALOG).filter(([key]) => (
      key.startsWith('customer.detail.') || key.startsWith('battle.')
    ));
    expect(keys.length).toBeGreaterThan(20);
    for (const [key, copy] of keys) {
      expect(copy['en-US'], key).not.toMatch(HANZI);
    }
  });
});

describe('T7 — battle card first layer keeps situation / goal / risk / next action', () => {
  it('renders primary sections outside any closed details', () => {
    render(<ActionCardView action={action} />);
    const primary = container.querySelector('[data-testid="bc-layer-primary"]');
    expect(primary).toBeTruthy();
    expect(primary?.querySelector('[data-testid="bc-current-situation"]')?.textContent).toContain('决策人仍待确认');
    expect(primary?.querySelector('[data-testid="bc-stage-goal"]')?.textContent).toContain('确认决策人');
    expect(primary?.querySelector('[data-testid="bc-risks"]')?.textContent).toContain('决策人不清');
    expect(primary?.querySelector('[data-testid="bc-next-best-action"]')?.textContent).toContain('确认需求');
    expect(primary?.querySelector('[data-testid="bc-signals"]')?.textContent).toContain('客户同意下一步');
    expect(BATTLE_CARD_PRIMARY_SECTION_IDS).toEqual([
      'bc-current-situation',
      'bc-stage-goal',
      'bc-risks',
      'bc-next-best-action',
      'bc-signals',
    ]);
  });
});

describe('T8 — evidence / history / secondary blocks default collapsed', () => {
  it('keeps detailed intelligence and supporting material closed, evidence/history as drawers', () => {
    render(<ActionCardView action={action} />);
    const secondary = container.querySelector('[data-testid="bc-layer-secondary"]');
    expect(secondary).toBeTruthy();
    expect(secondary?.hasAttribute('open')).toBe(false);
    expect(BATTLE_CARD_SECONDARY_SECTION_IDS.length).toBeGreaterThan(3);
    expect(battlePageSrc).toContain('data-testid="bc-supporting-material"');
    expect(battlePageSrc).not.toMatch(/data-testid="bc-supporting-material"[^>]*\sopen/);
    expect(battlePageSrc).toContain('historyOpen');
    expect(battlePageSrc).toContain('useState(false)');
    expect(battlePageSrc).toContain('evidenceOpen');
  });
});

describe('T9 — canonical battle-card data is not deleted', () => {
  it('still projects the full action payload and keeps secondary fields in the DOM', () => {
    const bundle = toStageCardBundle({
      id: 'card-1',
      customer_id: 'c1',
      stage_code: 'CONTACTED',
      version: 1,
      schema_version: 'battle-card-payload-v1',
      card_status: 'CONFIRMED',
      source_import_id: null,
      supersedes_card_id: null,
      payload_json: JSON.stringify({
        action_card: action,
        solution_reference_card: {
          feishu_value_statement: {
            original: '原文',
            current: '原文',
            short_spoken_version: null,
            full_spoken_version: null,
            wechat_version: null,
            version_history: [],
          },
          solution_scenarios: [],
          human_review_boundaries: [],
          peer_references: [],
          counterexamples_and_boundaries: [],
          poc_path: [],
          acceptance_metrics: ['完成演示'],
          evidence_refs: [],
        },
      }),
      evidence_snapshot_hash: 'h',
      generated_by: 'DETERMINISTIC',
      confirmed_by: 'HUMAN_CONFIRM',
      created_at: '2026-08-01T00:00:00Z',
      confirmed_at: '2026-08-01T00:00:00Z',
    });
    expect(bundle.action.current_situation).toBe(action.current_situation);
    expect(bundle.action.stage_entry_criteria).toEqual(['线索已入库']);
    expect(bundle.action.confirmed_facts).toHaveLength(1);
    expect(bundle.solution.acceptance_metrics).toEqual(['完成演示']);

    render(<ActionCardView action={action} />);
    const text = container.textContent ?? '';
    expect(text).toContain('线索已入库');
    expect(text).toContain('公司在广州');
    expect(text).toContain('采购流程分散');
    expect(text).toContain('保证成交');
    expect(text).toContain('当前用什么工具？');
  });
});

describe('T10 — zh-CN / en-US share one locale source of truth', () => {
  it('reads this-round chrome from TRANSLATION_CATALOG via t()', () => {
    expect(catalogSrc).toContain("'customer.detail.accordion.profile'");
    expect(catalogSrc).toContain("'battle.currentSituation'");
    expect(actionCardSrc).toContain("t('battle.currentSituation')");
    expect(actionCardSrc).toContain("t('battle.stageGoal')");
    expect(actionCardSrc).toContain("t('battle.risks')");
    expect(battlePageSrc).toContain("t('battle.supportingMaterial')");
    expect(customerDetailSrc).toContain("t('customer.detail.accordion.profile')");
    setAppLocale('zh-CN');
    expect(t('battle.currentSituation')).toBe('当前情况');
    setAppLocale('en-US');
    expect(t('battle.currentSituation')).toBe('Current situation');
    expect(t('customer.detail.accordion.profile')).toBe('Full profile');
    expect(t('battle.currentSituation')).not.toMatch(HANZI);
  });
});
