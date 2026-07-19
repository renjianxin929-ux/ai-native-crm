import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildCustomerActionAnalysis,
  formatCustomerAnalysisTextForDraft,
} from '../pages/CustomerDetail';
import type { Customer, FollowUpRecord } from '../lib/types';

describe('CustomerDetail AI action analysis', () => {
  it('keeps C grade weak-info leads conservative and focused on enrichment', () => {
    const analysis = buildCustomerActionAnalysis(makeCustomer({
      name: 'Guangzhou Ouster Hydraulic Co., Ltd',
      customer_grade: 'C',
      stage: 'NEW_LEAD',
      phone_number: null,
      wechat_id: null,
      contact_person: null,
      website: null,
      industry: null,
      source: null,
      region: '广州',
      notes: '来自广州供应商/制造商列表；下一步需用公司名反查官网、联系人和官网内容薄弱点',
    }), [
      makeFollowUp({
        contact_channel: 'wechat',
        contact_result: 'no_response',
        intent_assessment: 'MEDIUM',
        feedback_notes: '微信，无响应，中意向',
      }),
    ]);

    const text = formatCustomerAnalysisTextForDraft(analysis);

    expect(analysis.leadJudgement).toContain('信息不足');
    expect(analysis.leadJudgement).toContain('不建议直接销售推进');
    expect(analysis.facts).toContain('客户等级：C类客户');
    expect(analysis.facts).toContain('当前阶段：新线索');
    expect(analysis.facts).toContain('城市/区域：广州');
    expect(analysis.facts).toContain('联系方式：暂无手机号/微信');
    expect(analysis.gaps).toEqual(expect.arrayContaining([
      '缺联系人',
      '缺手机号/微信',
      '缺官网',
      '缺行业/主营产品',
      '缺有效来源证据',
    ]));
    expect(analysis.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('反查官网'),
      expect.stringContaining('补充主营产品'),
      expect.stringContaining('5 分钟'),
      expect.stringContaining('暂不做复杂销售推进'),
    ]));
    expect(text).toContain('线索判断');
    expect(text).toContain('已知事实');
    expect(text).toContain('信息缺口');
    expect(text).toContain('下一步动作');
    expect(text).toContain('风险提醒');
    expect(text).not.toContain('48小时');
    expect(text).not.toContain('一周内微信添加成功');
    expect(text).not.toContain('采购经理');
    expect(text).not.toContain('技术总监');
  });

  it('marks company-name industry inference as speculation rather than fact', () => {
    const analysis = buildCustomerActionAnalysis(makeCustomer({
      name: 'Guangzhou Ouster Hydraulic Co., Ltd',
      industry: null,
      notes: '',
    }), []);
    const text = formatCustomerAnalysisTextForDraft(analysis);

    expect(text).toContain('基于公司名推测');
    expect(text).toContain('可能与液压相关');
    expect(text).not.toContain('该公司是液压元件制造商');
  });

  it('returns structured card content without raw markdown markers', () => {
    const analysis = buildCustomerActionAnalysis(makeCustomer(), []);
    const text = formatCustomerAnalysisTextForDraft(analysis);
    const customerDetailSource = readFileSync(new URL('../pages/CustomerDetail.tsx', import.meta.url), 'utf8');

    expect(Object.keys(analysis)).toEqual([
      'leadJudgement',
      'facts',
      'gaps',
      'nextActions',
      'risks',
    ]);
    expect(text).not.toContain('###');
    expect(text).not.toContain('**');
    expect(customerDetailSource).not.toContain('analysis-card-grid');
    expect(customerDetailSource).not.toContain("whiteSpace: 'pre-wrap'");
  });

  it('allows short touch suggestions for customers with phone or wechat without promising outcomes', () => {
    const analysis = buildCustomerActionAnalysis(makeCustomer({
      customer_grade: 'B',
      phone_number: '13800138000',
      wechat_id: 'test_wx',
      contact_person: '李经理',
    }), []);
    const text = formatCustomerAnalysisTextForDraft(analysis);

    expect(text).toContain('可短触达');
    expect(text).toContain('围绕已有联系方式做一次轻量触达');
    expect(text).not.toContain('保证');
    expect(text).not.toContain('成功率');
  });

  it('gives different guidance for complete A/B leads than weak C leads', () => {
    const weak = buildCustomerActionAnalysis(makeCustomer({
      customer_grade: 'C',
      phone_number: null,
      wechat_id: null,
      contact_person: null,
      website: null,
      industry: null,
    }), []);
    const strong = buildCustomerActionAnalysis(makeCustomer({
      customer_grade: 'A',
      phone_number: '13800138000',
      wechat_id: 'strong_wx',
      contact_person: '王总',
      website: 'https://example.com',
      industry: '包装设备',
    }), []);

    expect(formatCustomerAnalysisTextForDraft(weak)).toContain('低投入验证');
    expect(formatCustomerAnalysisTextForDraft(strong)).toContain('优先跟进');
    expect(strong.nextActions.some(action => action.includes('确认需求'))).toBe(true);
    expect(weak.nextActions.some(action => action.includes('5 分钟'))).toBe(true);
  });
  it('removes the legacy AI draft affordance from customer detail', () => {
    const source = readFileSync(new URL('../pages/CustomerDetail.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('formatAIDraftsButtonLabel');
    expect(source).not.toContain('查看 AI 草稿');
  });
});

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = '2026-06-16T00:00:00.000Z';
  return {
    id: 'customer-1',
    name: '测试客户',
    customer_grade: 'C',
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
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: null,
    last_contacted_at: null,
    last_feedback_type: 'UNKNOWN',
    next_action: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    paid_at: null,
    closed_at: null,
    website: null,
    region: null,
    industry: null,
    contact_person: null,
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    source: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUpRecord>): FollowUpRecord {
  return {
    id: 'follow-1',
    customer_id: 'customer-1',
    title: '跟进',
    contact_channel: null,
    contact_result: null,
    feedback_notes: null,
    intent_assessment: null,
    suggested_grade: null,
    next_action: null,
    next_follow_up_at: null,
    is_completed: 0,
    created_at: '2026-06-16T00:00:00.000Z',
    updated_at: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}
