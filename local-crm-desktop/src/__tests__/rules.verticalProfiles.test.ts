import { describe, expect, it } from 'vitest';

import { applyWechatPassed, getRecommendedAction } from '../lib/rules';
import type { Customer } from '../lib/types';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../lib/verticalProfiles';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = new Date().toISOString();
  return {
    id: 'rules-profile-customer',
    name: 'Rules Profile Customer',
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    contact_method: null,
    wechat_id: null,
    phone_number: null,
    website: null,
    region: null,
    industry: null,
    contact_person: null,
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    source: null,
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
    last_contacted_at: now,
    last_feedback_type: 'UNKNOWN',
    next_action: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    paid_at: null,
    closed_at: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('getRecommendedAction vertical profile rules', () => {
  it('keeps legacy callers on the active vertical profile recommendation rules', () => {
    const customer = makeCustomer({ customer_grade: 'B' });

    expect(getRecommendedAction(customer)).toBe(
      getRecommendedAction(customer, { profile: getActiveVerticalProfile() }),
    );
  });

  it('uses supplied vertical profile recommendation rules instead of fixed GEO/export text', () => {
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_rules_profile',
      name: 'Dummy Rules Profile',
      rules: {
        ...getActiveVerticalProfile().rules,
        recommendedAction: {
          overduePrefix: '[LATE] ',
          byGrade: {
            A: 'Dummy A follow-up',
            B: 'Dummy B follow-up',
            C: 'Dummy C follow-up',
            D: 'Dummy D follow-up',
            default: 'Dummy manual review',
          },
          neverContactedByGrade: {
            A: 'Dummy first A touch',
          },
        },
      },
    };

    expect(getRecommendedAction(
      makeCustomer({ customer_grade: 'A', last_contacted_at: null }),
      { profile: dummyProfile },
    )).toBe('Dummy first A touch');
    expect(getRecommendedAction(
      makeCustomer({ customer_grade: 'B' }),
      { profile: dummyProfile },
    )).toBe('Dummy B follow-up');

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(getRecommendedAction(
      makeCustomer({ customer_grade: 'C', next_follow_up_at: yesterday.toISOString() }),
      { profile: dummyProfile },
    )).toBe('[LATE] Dummy C follow-up');
  });
});

describe('applyWechatPassed vertical profile rules', () => {
  it('uses supplied vertical profile task title rules while legacy callers keep active defaults', () => {
    const customer = makeCustomer({ customer_grade: 'B' });
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_wechat_rules_profile',
      name: 'Dummy WeChat Rules Profile',
      rules: {
        ...getActiveVerticalProfile().rules,
        taskTitles: {
          ...getActiveVerticalProfile().rules.taskTitles,
          wechatPassed: 'Dummy first channel task',
        },
      },
    };

    expect(applyWechatPassed(customer).tasks[0].title).toBe(
      getActiveVerticalProfile().rules.taskTitles.wechatPassed,
    );
    expect(applyWechatPassed(customer, { profile: dummyProfile }).tasks[0].title)
      .toBe('Dummy first channel task');
  });
});
