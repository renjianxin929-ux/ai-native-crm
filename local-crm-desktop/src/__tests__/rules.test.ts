import { describe, it, expect } from 'vitest';
import {
  getDefaultCustomerGrade,
  applyWechatPassed,
  applyIntentRule,
  calculateNextFollowUpAt,
  applyVisitOutcome,
  applyPaymentRule,
  applyNoShow,
  buildTodaySummary,
  getRecommendedAction,
  applyFollowUpUpdate,
} from '../lib/rules';
import type { Customer, Task } from '../lib/types';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    name: '测试客户',
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
    last_contacted_at: null,
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

describe('getDefaultCustomerGrade', () => {
  it('新普通客户默认为 C', () => {
    const grade = getDefaultCustomerGrade({});
    expect(grade).toBe('C');
  });

  it('关键KP默认为 B', () => {
    const grade = getDefaultCustomerGrade({ is_key_decision_maker: true });
    expect(grade).toBe('B');
  });

  it('微信搜不到/异常默认为 D', () => {
    expect(getDefaultCustomerGrade({ wechat_search_status: 'NOT_FOUND' })).toBe('D');
    expect(getDefaultCustomerGrade({ wechat_search_status: 'ABNORMAL' })).toBe('D');
  });

  it('KP且微信正常应为 B（KP优先）', () => {
    const grade = getDefaultCustomerGrade({
      is_key_decision_maker: true,
      wechat_search_status: 'FOUND',
    });
    expect(grade).toBe('B');
  });
});

describe('applyWechatPassed', () => {
  it('微信通过不自动升级等级', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated, tasks } = applyWechatPassed(customer);
    expect(updated.customer_grade).toBe('C');
    expect(updated.stage).toBe('WECHAT_PASSED');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('首次微信沟通');
    expect(tasks[0].source).toBe('RULE');
  });

  it('微信通过创建首次沟通任务', () => {
    const customer = makeCustomer({ customer_grade: 'B', wechat_add_status: 'ADDED' });
    const { customer: updated, tasks } = applyWechatPassed(customer);
    expect(updated.customer_grade).toBe('B');
    expect(updated.stage).toBe('WECHAT_PASSED');
    const dueDate = new Date(tasks[0].due_at!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(dueDate.getDate()).toBe(tomorrow.getDate());
    expect(dueDate.getHours()).toBe(9);
    expect(dueDate.getMinutes()).toBe(30);
  });
});

describe('applyIntentRule', () => {
  it('高意向设为 A', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyIntentRule(customer, { intent_level: 'HIGH' });
    expect(updated.customer_grade).toBe('A');
    expect(updated.next_action).toBe('SCHEDULE_VISIT');
  });

  it('CAN_MEET 设为 A 且阶段为 VISIT_READY', () => {
    const customer = makeCustomer({ customer_grade: 'B' });
    const { customer: updated } = applyIntentRule(customer, { phone_feedback: 'CAN_MEET' });
    expect(updated.customer_grade).toBe('A');
    expect(updated.next_action).toBe('SCHEDULE_VISIT');
  });

  it('INTERESTED 设为 A', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyIntentRule(customer, { phone_feedback: 'INTERESTED' });
    expect(updated.customer_grade).toBe('A');
  });

  it('中意向设为 B', () => {
    const customer = makeCustomer({ customer_grade: 'D' });
    const { customer: updated } = applyIntentRule(customer, { intent_level: 'MEDIUM' });
    expect(updated.customer_grade).toBe('B');
  });

  it('低意向不降级A', () => {
    const customer = makeCustomer({ customer_grade: 'A' });
    const { customer: updated } = applyIntentRule(customer, { intent_level: 'LOW' });
    expect(updated.customer_grade).toBe('A');
  });

  it('无意向设为 D', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyIntentRule(customer, { intent_level: 'NONE' });
    expect(updated.customer_grade).toBe('D');
    expect(updated.next_action).toBe('LOW_FREQUENCY');
  });

  it('NOT_NEEDED 设为 D', () => {
    const customer = makeCustomer({ customer_grade: 'B' });
    const { customer: updated } = applyIntentRule(customer, { phone_feedback: 'NOT_NEEDED' });
    expect(updated.customer_grade).toBe('D');
    expect(updated.next_action).toBe('CLOSE');
  });

  it('空号设为 D', () => {
    const customer = makeCustomer({ customer_grade: 'B' });
    const { customer: updated } = applyIntentRule(customer, { phone_feedback: 'INVALID_NUMBER' });
    expect(updated.customer_grade).toBe('D');
    expect(updated.next_action).toBe('CLOSE');
  });

  it('已有 A 的客户不因中意向降级', () => {
    const customer = makeCustomer({ customer_grade: 'A', intent_level: 'HIGH' });
    const { customer: updated } = applyIntentRule(customer, { intent_level: 'MEDIUM' });
    expect(updated.customer_grade).toBe('A');
  });
});

describe('calculateNextFollowUpAt', () => {
  it('A 客户 2 天后跟进', () => {
    const result = calculateNextFollowUpAt('A');
    const expected = new Date();
    expected.setDate(expected.getDate() + 2);
    expected.setHours(9, 30, 0, 0);
    const actual = new Date(result);
    expect(actual.getDate()).toBe(expected.getDate());
    expect(actual.getHours()).toBe(9);
    expect(actual.getMinutes()).toBe(30);
  });

  it('B 客户 4 天后跟进', () => {
    const result = calculateNextFollowUpAt('B');
    const expected = new Date();
    expected.setDate(expected.getDate() + 4);
    const actual = new Date(result);
    expect(actual.getDate()).toBe(expected.getDate());
  });

  it('C 客户 8 天后跟进', () => {
    const result = calculateNextFollowUpAt('C');
    const expected = new Date();
    expected.setDate(expected.getDate() + 8);
    const actual = new Date(result);
    expect(actual.getDate()).toBe(expected.getDate());
  });

  it('D 客户 30 天后跟进', () => {
    const result = calculateNextFollowUpAt('D');
    const expected = new Date();
    expected.setDate(expected.getDate() + 30);
    const actual = new Date(result);
    expect(actual.getDate()).toBe(expected.getDate());
  });
});

describe('applyVisitOutcome', () => {
  it('签合同 → CONTRACTING, grade A, SEND_CONTRACT', () => {
    const customer = makeCustomer({ customer_grade: 'B' });
    const { customer: updated } = applyVisitOutcome(customer, 'READY_TO_SIGN');
    expect(updated.stage).toBe('CONTRACTING');
    expect(updated.customer_grade).toBe('A');
    expect(updated.next_action).toBe('SEND_CONTRACT');
  });

  it('再考虑 → 已是A不降级', () => {
    const customer = makeCustomer({ customer_grade: 'A' });
    const { customer: updated } = applyVisitOutcome(customer, 'CONSIDERING');
    expect(updated.customer_grade).toBe('A');
    expect(updated.next_action).toBe('WAIT_CUSTOMER');
  });

  it('再考虑 → 不是A则设为B', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyVisitOutcome(customer, 'CONSIDERING');
    expect(updated.customer_grade).toBe('B');
  });

  it('再对比 → grade B', () => {
    const customer = makeCustomer({ customer_grade: 'A' });
    const { customer: updated } = applyVisitOutcome(customer, 'COMPARING');
    expect(updated.customer_grade).toBe('B');
    expect(updated.next_action).toBe('CONTACT_AGAIN');
  });

  it('丢单 → stage LOST', () => {
    const customer = makeCustomer({});
    const { customer: updated } = applyVisitOutcome(customer, 'LOST');
    expect(updated.stage).toBe('LOST');
    expect(updated.next_action).toBe('CLOSE');
  });

  it('放鸽子/爽约 → 触发 no-show 规则', () => {
    const customer = makeCustomer({ customer_grade: 'A', no_show_count: 0 });
    const { customer: updated } = applyVisitOutcome(customer, 'NO_SHOW');
    expect(updated.no_show_count).toBe(1);
    expect(updated.customer_grade).toBe('B');
  });
});

describe('applyPaymentRule', () => {
  it('发合同后设为 PAYMENT_PENDING', () => {
    const customer = makeCustomer({ stage: 'CONTRACTING' });
    const { customer: updated } = applyPaymentRule(customer, 'SEND_CONTRACT');
    expect(updated.stage).toBe('PAYMENT_PENDING');
    expect(updated.payment_status).toBe('PENDING');
    expect(updated.next_action).toBe('CONFIRM_PAYMENT');
  });

  it('已打款后设为 PAID', () => {
    const customer = makeCustomer({ stage: 'PAYMENT_PENDING', payment_status: 'PENDING' });
    const { customer: updated } = applyPaymentRule(customer, 'MARK_PAID');
    expect(updated.stage).toBe('PAID');
    expect(updated.payment_status).toBe('PAID');
    expect(updated.paid_at).toBeTruthy();
  });

  it('成交后设为 WON', () => {
    const customer = makeCustomer({ stage: 'PAID', payment_status: 'PAID' });
    const { customer: updated } = applyPaymentRule(customer, 'MARK_WON');
    expect(updated.stage).toBe('WON');
    expect(updated.closed_at).toBeTruthy();
    expect(updated.customer_grade).toBe('A');
  });
});

describe('applyNoShow', () => {
  it('第一次爽约 A→B', () => {
    const customer = makeCustomer({ customer_grade: 'A', no_show_count: 0 });
    const { customer: updated } = applyNoShow(customer);
    expect(updated.no_show_count).toBe(1);
    expect(updated.customer_grade).toBe('B');
    expect(updated.last_feedback_type).toBe('NEGATIVE');
  });

  it('第一次爽约 B→C', () => {
    const customer = makeCustomer({ customer_grade: 'B', no_show_count: 0 });
    const { customer: updated } = applyNoShow(customer);
    expect(updated.customer_grade).toBe('C');
  });

  it('第二次爽约设为 D', () => {
    const customer = makeCustomer({ customer_grade: 'B', no_show_count: 1 });
    const { customer: updated } = applyNoShow(customer);
    expect(updated.no_show_count).toBe(2);
    expect(updated.customer_grade).toBe('D');
    expect(updated.next_action).toBe('LOW_FREQUENCY');
  });
});

describe('buildTodaySummary', () => {
  it('返回今日待跟进和逾期客户', () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const customers: Customer[] = [
      makeCustomer({ id: '1', name: '逾期客户A', customer_grade: 'A', next_follow_up_at: yesterday.toISOString() }),
      makeCustomer({ id: '2', name: '今日客户B', customer_grade: 'B', next_follow_up_at: now.toISOString() }),
      makeCustomer({ id: '3', name: '未来客户C', customer_grade: 'C', next_follow_up_at: tomorrow.toISOString() }),
    ];

    const result = buildTodaySummary(customers, []);
    expect(result.overdue_customers).toHaveLength(1);
    expect(result.overdue_customers[0].name).toBe('逾期客户A');
    expect(result.due_today_customers).toHaveLength(1);
    expect(result.due_today_customers[0].name).toBe('今日客户B');
  });

  it('A 客户 2 天未联系应出现在长期未触达', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const customers: Customer[] = [
      makeCustomer({ id: '1', name: 'A客户久未联系', customer_grade: 'A', last_contacted_at: threeDaysAgo.toISOString() }),
    ];

    const result = buildTodaySummary(customers, []);
    expect(result.long_time_no_contact).toHaveLength(1);
    expect(result.long_time_no_contact[0].name).toBe('A客户久未联系');
  });

  it('真实 tasks 进入摘要 tasks_due_today', () => {
    const now = new Date();
    const tasks: Task[] = [
      {
        id: 't1', customer_id: '1', title: '今日任务',
        due_at: now.toISOString(), status: 'OPEN', priority: 'HIGH',
        source: 'RULE', created_at: now.toISOString(), updated_at: now.toISOString(),
      },
      {
        id: 't2', customer_id: '2', title: '已完成任务',
        due_at: now.toISOString(), status: 'DONE', priority: 'MEDIUM',
        source: 'MANUAL', created_at: now.toISOString(), updated_at: now.toISOString(),
      },
    ];

    const result = buildTodaySummary([], tasks);
    expect(result.tasks_due_today).toHaveLength(1);
    expect(result.tasks_due_today[0].title).toBe('今日任务');
  });
});

describe('组合规则: 微信通过 + 意向', () => {
  it('微信通过不会自动升A', () => {
    const customer = makeCustomer({ customer_grade: 'C', wechat_add_status: 'ADDED' });
    const { customer: updated } = applyWechatPassed(customer);
    expect(updated.customer_grade).toBe('C');
    expect(updated.stage).toBe('WECHAT_PASSED');
  });

  it('微信通过+高意向→A(来自意向而非微信)', () => {
    const customer = makeCustomer({ customer_grade: 'C', wechat_add_status: 'ADDED' });
    const { customer: afterPass } = applyWechatPassed(customer);
    expect(afterPass.customer_grade).toBe('C');
    const { customer: afterIntent } = applyIntentRule(afterPass, { intent_level: 'HIGH' });
    expect(afterIntent.customer_grade).toBe('A');
  });

  it('微信通过+可以见面→A(来自电话反馈而非微信)', () => {
    const customer = makeCustomer({ customer_grade: 'B', wechat_add_status: 'ADDED' });
    const { customer: afterPass } = applyWechatPassed(customer);
    expect(afterPass.customer_grade).toBe('B');
    const { customer: afterPhone } = applyIntentRule(afterPass, { phone_feedback: 'CAN_MEET' });
    expect(afterPhone.customer_grade).toBe('A');
  });

  it('编辑时变更意向度触发规则', () => {
    const customer = makeCustomer({ customer_grade: 'C', intent_level: 'UNKNOWN' });
    const { customer: updated } = applyIntentRule(customer, { intent_level: 'HIGH' });
    expect(updated.customer_grade).toBe('A');
    expect(updated.intent_level).toBe('HIGH');
  });
});

// ═══════════════════════════════════════════
// v0.3.1: getRecommendedAction
// ═══════════════════════════════════════════

describe('getRecommendedAction', () => {
  it('A 类客户 → 优先触达并尝试约访', () => {
    const action = getRecommendedAction(makeCustomer({ customer_grade: 'A' }));
    expect(action).toContain('电话');
    expect(action).toContain('约访');
  });

  it('B 类客户 → 补充痛点推动下一步', () => {
    const action = getRecommendedAction(makeCustomer({ customer_grade: 'B' }));
    expect(action).toContain('痛点');
  });

  it('C 类客户 → 低频触达观察反馈', () => {
    const action = getRecommendedAction(makeCustomer({ customer_grade: 'C' }));
    expect(action).toContain('触达');
  });

  it('D 类客户 → 降低频率或归档', () => {
    const action = getRecommendedAction(makeCustomer({ customer_grade: 'D' }));
    expect(action).toContain('归档');
  });

  it('逾期客户提示加急', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const action = getRecommendedAction(
      makeCustomer({ customer_grade: 'B', next_follow_up_at: yesterday.toISOString() }),
    );
    expect(action).toContain('逾期');
  });

  it('从未触达的 A 类客户提示优先联系', () => {
    const action = getRecommendedAction(
      makeCustomer({ customer_grade: 'A', last_contacted_at: null }),
    );
    expect(action).toContain('首次');
  });
});

// ═══════════════════════════════════════════
// v0.3.1: applyFollowUpUpdate
// ═══════════════════════════════════════════

describe('applyFollowUpUpdate', () => {
  it('正反馈 + 高意向 → 升级为 A，阶段推进', () => {
    const customer = makeCustomer({ customer_grade: 'B', stage: 'CONTACTED' });
    const { customer: updated } = applyFollowUpUpdate(customer, {
      contact_result: 'positive',
      intent_assessment: 'HIGH',
    });
    expect(updated.customer_grade).toBe('A');
    expect(updated.stage).not.toBe('CONTACTED');
    expect(updated.next_follow_up_at).toBeTruthy();
  });

  it('无回复 → 不升级但更新跟进时间', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyFollowUpUpdate(customer, {
      contact_result: 'no_response',
    });
    // 不因无回复升级
    expect(updated.customer_grade).toBe('C');
  });

  it('负反馈 → 降级为 D，建议关闭', () => {
    const customer = makeCustomer({ customer_grade: 'B' });
    const { customer: updated } = applyFollowUpUpdate(customer, {
      contact_result: 'negative',
      intent_assessment: 'NONE',
    });
    expect(updated.customer_grade).toBe('D');
  });

  it('建议等级直接覆盖', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyFollowUpUpdate(customer, {
      suggested_grade: 'A',
    });
    expect(updated.customer_grade).toBe('A');
  });

  it('更新 last_contacted_at', () => {
    const customer = makeCustomer({ customer_grade: 'C' });
    const { customer: updated } = applyFollowUpUpdate(customer, {});
    expect(updated.last_contacted_at).toBeTruthy();
  });

  it('A 类负反馈不直接降 D，保留缓冲', () => {
    const customer = makeCustomer({ customer_grade: 'A' });
    const { customer: updated } = applyFollowUpUpdate(customer, {
      contact_result: 'negative',
    });
    // A 类一次负反馈不直接降到 D
    expect(updated.customer_grade).not.toBe('D');
  });
});
