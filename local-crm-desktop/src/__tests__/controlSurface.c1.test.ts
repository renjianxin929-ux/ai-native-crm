import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_CAPABILITY_COUNT, PRODUCTION_CAPABILITY_BINDING_REGISTRY } from '../lib/capabilities/execution';
import { projectOpportunityBoard } from '../lib/opportunityBoard/opportunityBoardProjection';
import {
  countThisWeekFollowUps,
  formatOpenPipelineMetric,
  formatOpportunityAmount,
  rowsForBoardStage,
} from '../lib/opportunityBoard/boardPresentation';
import { AGENT_HOME_QUICK_ACTIONS, SALES_AGENT_QUICK_ACTIONS } from '../lib/salesAgentUi/quickActions';
import { explainUnchangedCrmError, mapUserExecutionState } from '../lib/salesAgentUi/executionState';
import type { Customer } from '../lib/types';

const app = readFileSync('src/App.tsx', 'utf8');
const workspace = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');
const interaction = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
const glassOrb = readFileSync('src/components/aiNative/SalesAgentGlassOrb.tsx', 'utf8');
const boardPage = readFileSync('src/pages/OpportunityBoardPage.tsx', 'utf8');
const boardPresentation = readFileSync('src/lib/opportunityBoard/boardPresentation.ts', 'utf8');
const customerList = readFileSync('src/pages/CustomerList.tsx', 'utf8');
const customerDetail = readFileSync('src/pages/CustomerDetail.tsx', 'utf8');
const review = readFileSync('src/pages/DailyBattleReviewPage.tsx', 'utf8');

function makeCustomer(overrides: Partial<Customer>): Customer {
  return {
    id: 'c1',
    name: '测试客户',
    customer_grade: 'B',
    stage: 'NEW_LEAD',
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
    next_action: null,
    next_follow_up_at: null,
    last_contacted_at: null,
    last_feedback_type: 'UNKNOWN',
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    opportunity_amount: null,
    paid_at: null,
    closed_at: null,
    website: null,
    region: null,
    industry: null,
    notes: null,
    source: null,
    contact_person: null,
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('C1 AI-native control surface', () => {
  it('keeps frozen production capability contract', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(25);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(25);
  });

  it('primary nav has exactly four destinations and Agent is home', () => {
    expect(app).toContain("label: t('nav.agent')");
    expect(app).toContain("label: t('nav.board')");
    expect(app).toContain("label: t('nav.customers')");
    expect(app).toContain("label: t('nav.review')");
    expect(app).not.toContain("label: 'Sales Agent'");
    expect(app).not.toContain("label: '获客作业台'");
    expect(app).not.toContain("label: '设置'");
    expect(app).toContain("to: '/'");
    expect(app).toContain('/board');
    expect(app).toContain('system-entry');
    expect(app.match(/label: t\('nav\./g)?.length).toBe(4);
  });

  it('preserves the existing 3D glass orb and Agent home short layout', () => {
    expect(glassOrb).toContain('agent-orb-glass');
    expect(glassOrb).toContain('agent-orb-ring');
    expect(interaction).toContain('SalesAgentGlassOrb');
    expect(interaction).toContain("t('agent.home.title')");
    expect(interaction).toContain("t('agent.selectCustomerOptional')");
    expect(interaction).not.toContain('<select');
    expect(interaction).toContain('展开完整分析');
    expect(AGENT_HOME_QUICK_ACTIONS).toHaveLength(3);
    expect(SALES_AGENT_QUICK_ACTIONS.length).toBeGreaterThan(3);
    expect(workspace).not.toContain('SalesAgentBattleCardEntry');
  });

  it('board renders projection truth and never shows ¥0 for null amounts', () => {
    const projection = projectOpportunityBoard([
      makeCustomer({ id: 'open', name: '未录入客户', stage: 'VISITED', opportunity_amount: null }),
      makeCustomer({ id: 'known', name: '已确认客户', stage: 'CONTRACTING', opportunity_amount: 200000 }),
      makeCustomer({ id: 'won', name: '成交客户', stage: 'WON', opportunity_amount: 800000 }),
      makeCustomer({ id: 'paid', name: '已打款', stage: 'PAID', opportunity_amount: 100000 }),
    ]);
    expect(projection.summary.open_pipeline_amount).toBe(200000);
    expect(formatOpportunityAmount(null)).toBe('未录入');
    expect(formatOpportunityAmount(projection.rows.find(row => row.customer_id === 'open')?.opportunity_amount ?? null)).toBe('未录入');
    expect(formatOpportunityAmount(200000)).toMatch(/^¥/);
    expect(formatOpportunityAmount(200000)).not.toBe('未录入');
    expect(formatOpenPipelineMetric(projection)).toMatch(/^¥/);
    expect(rowsForBoardStage(projection.rows, 'PENDING')).toHaveLength(1);
    expect(countThisWeekFollowUps(projection.rows, new Date('2026-08-16T00:00:00'))).toBe(0);
    expect(boardPage).toContain('projectOpportunityBoard');
    expect(boardPage).toContain('formatOpportunityAmount');
    expect(boardPresentation).toContain('未录入');
    expect(boardPage).not.toContain('deriveBoardStage');
    expect(boardPresentation).not.toContain('NEW_LEAD');
    expect(boardPage).not.toContain('¥0');
  });

  it('customer and review default to low density, evidence stays quiet', () => {
    expect(customerList).toContain('formatOpportunityAmount');
    expect(customerDetail).toContain("t('customer.detail.accordion.profile')");
    expect(customerDetail).toContain('evidenceEntryLabel');
    expect(readFileSync('src/lib/evidence/evidenceEntryLabel.ts', 'utf8')).toContain("t('customer.detail.evidence')");
    expect(customerDetail).toContain("t('customer.detail.askAgent')");
    expect(customerDetail).toContain('updateCustomerOpportunityAmount');
    expect(customerDetail).toContain("t('customer.detail.deleteConfirm')");
    expect(review).toContain("t('review.expand')");
    expect(review).toContain('review-short-memo');
    expect(interaction).toContain('is-strong');
    expect(interaction).toContain('explainUnchangedCrmError');
    expect(mapUserExecutionState({ awaitingConfirmation: true })).toBe('等待确认');
    expect(explainUnchangedCrmError('customer does not exist')).toContain('CRM 没有发生任何变化');
  });
});
