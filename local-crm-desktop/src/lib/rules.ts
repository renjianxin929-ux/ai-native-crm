import type {
  Customer,
  CustomerGrade,
  Task,
  VisitOutcome,
  DailySummary,
} from './types';
import { v4 as uuidv4 } from 'uuid';

function nowISO(): string {
  return new Date().toISOString();
}

function daysLater(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 30, 0, 0);
  return d.toISOString();
}

function tomorrow0930(): string {
  return daysLater(1);
}

function makeTask(
  title: string,
  customerId: string,
  dueAt: string | null,
  priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM',
  source: 'MANUAL' | 'RULE' | 'AI' = 'RULE',
): Task {
  const now = nowISO();
  return {
    id: uuidv4(),
    customer_id: customerId,
    title,
    due_at: dueAt,
    status: 'OPEN',
    priority,
    source,
    created_at: now,
    updated_at: now,
  };
}

export function getDefaultCustomerGrade(params: {
  wechat_search_status?: string | null;
  is_key_decision_maker?: boolean;
}): CustomerGrade {
  if (params.wechat_search_status === 'ABNORMAL' || params.wechat_search_status === 'NOT_FOUND') {
    return 'D';
  }
  if (params.is_key_decision_maker) {
    return 'B';
  }
  return 'C';
}

export function applyWechatPassed(customer: Customer): { customer: Customer; tasks: Task[] } {
  const updated = { ...customer };
  updated.stage = 'WECHAT_PASSED';
  updated.wechat_add_status = 'PASSED';
  updated.updated_at = nowISO();

  const task = makeTask('首次微信沟通', customer.id, tomorrow0930(), 'MEDIUM', 'RULE');

  return { customer: updated, tasks: [task] };
}

export function applyIntentRule(
  customer: Customer,
  signal: {
    intent_level?: string | null;
    phone_feedback?: string | null;
    contact_result?: string | null;
    intent_assessment?: string | null;
  },
): { customer: Customer; tasks: Task[] } {
  const updated = { ...customer };
  const tasks: Task[] = [];
  const prevGrade = customer.customer_grade;

  // Determine effective signal
  const intentLevel = signal.intent_level || signal.intent_assessment || customer.intent_level;
  const phoneFeedback = signal.phone_feedback || customer.phone_feedback;

  // Rule matching
  if (intentLevel === 'HIGH') {
    updated.intent_level = 'HIGH';
    updated.customer_grade = 'A';
    updated.next_action = 'SCHEDULE_VISIT';
    if (customer.stage === 'NEW_LEAD' || customer.stage === 'CONTACTED' || customer.stage === 'WECHAT_PASSED') {
      updated.stage = 'REPLIED';
    }
  } else if (phoneFeedback === 'CAN_MEET') {
    updated.phone_feedback = 'CAN_MEET';
    updated.customer_grade = 'A';
    updated.stage = 'VISIT_READY';
    updated.next_action = 'SCHEDULE_VISIT';
  } else if (phoneFeedback === 'INTERESTED') {
    updated.phone_feedback = 'INTERESTED';
    updated.customer_grade = 'A';
    updated.next_action = 'SCHEDULE_VISIT';
    if (customer.stage !== 'VISITED' && customer.stage !== 'CONTRACTING' && customer.stage !== 'PAYMENT_PENDING' && customer.stage !== 'PAID' && customer.stage !== 'WON') {
      updated.stage = 'REPLIED';
    }
  } else if (intentLevel === 'MEDIUM') {
    updated.intent_level = 'MEDIUM';
    // Don't downgrade A unless explicit negative
    if (prevGrade !== 'A') {
      updated.customer_grade = 'B';
    }
    updated.next_action = 'CONTACT_AGAIN';
  } else if (phoneFeedback === 'CAN_LEARN') {
    updated.phone_feedback = 'CAN_LEARN';
    if (prevGrade !== 'A') {
      updated.customer_grade = 'B';
    }
    updated.next_action = 'CONTACT_AGAIN';
  } else if (intentLevel === 'LOW') {
    updated.intent_level = 'LOW';
    // Don't downgrade A/B unless explicit negative
    if (prevGrade !== 'A' && prevGrade !== 'B') {
      updated.customer_grade = 'C';
    }
    updated.next_action = 'CONTACT_AGAIN';
  } else if (intentLevel === 'NONE') {
    updated.intent_level = 'NONE';
    updated.customer_grade = 'D';
    updated.next_action = 'LOW_FREQUENCY';
  } else if (phoneFeedback === 'NOT_NEEDED' || phoneFeedback === 'INVALID_NUMBER') {
    updated.phone_feedback = phoneFeedback;
    updated.customer_grade = 'D';
    updated.next_action = 'CLOSE';
  }

  // Update follow-up cadence
  if (updated.customer_grade !== prevGrade) {
    updated.next_follow_up_at = calculateNextFollowUpAt(updated.customer_grade);
  }

  updated.updated_at = nowISO();
  return { customer: updated, tasks };
}

export function calculateNextFollowUpAt(grade: CustomerGrade): string {
  switch (grade) {
    case 'A': return daysLater(2);
    case 'B': return daysLater(4);
    case 'C': return daysLater(8);
    case 'D': return daysLater(30);
    default: return daysLater(8);
  }
}

export function applyVisitOutcome(
  customer: Customer,
  outcome: VisitOutcome,
): { customer: Customer; tasks: Task[] } {
  const updated = { ...customer };
  const tasks: Task[] = [];

  switch (outcome) {
    case 'READY_TO_SIGN': {
      updated.customer_grade = 'A';
      updated.stage = 'CONTRACTING';
      updated.next_action = 'SEND_CONTRACT';
      updated.next_follow_up_at = daysLater(1);
      tasks.push(makeTask('发送/确认合同', customer.id, daysLater(1), 'HIGH', 'RULE'));
      break;
    }
    case 'FOLLOW_UP_NEEDED': {
      updated.next_action = 'CONTACT_AGAIN';
      updated.next_follow_up_at = daysLater(2);
      tasks.push(makeTask('跟进客户', customer.id, daysLater(2), 'MEDIUM', 'RULE'));
      break;
    }
    case 'CONSIDERING': {
      if (customer.customer_grade !== 'A') {
        updated.customer_grade = 'B';
      }
      updated.next_action = 'WAIT_CUSTOMER';
      updated.next_follow_up_at = daysLater(3);
      tasks.push(makeTask('等待客户决定', customer.id, daysLater(3), 'MEDIUM', 'RULE'));
      break;
    }
    case 'COMPARING': {
      updated.customer_grade = 'B';
      updated.next_action = 'CONTACT_AGAIN';
      updated.next_follow_up_at = daysLater(5);
      tasks.push(makeTask('跟进对比客户', customer.id, daysLater(5), 'MEDIUM', 'RULE'));
      break;
    }
    case 'NO_SHOW': {
      // Apply no-show rule
      const noShowResult = applyNoShow(customer);
      Object.assign(updated, noShowResult.customer);
      tasks.push(...noShowResult.tasks);
      tasks.push(makeTask('重新确认约访意愿', customer.id, daysLater(1), 'HIGH', 'RULE'));
      break;
    }
    case 'LOST': {
      updated.stage = 'LOST';
      updated.next_action = 'CLOSE';
      updated.lost_reason = '面访后丢单';
      break;
    }
  }

  updated.updated_at = nowISO();
  return { customer: updated, tasks };
}

export function applyNoShow(customer: Customer): { customer: Customer; tasks: Task[] } {
  const updated = { ...customer };
  updated.no_show_count = (customer.no_show_count || 0) + 1;
  updated.last_feedback_type = 'NEGATIVE';

  if (updated.no_show_count >= 2) {
    updated.customer_grade = 'D';
    updated.next_action = 'LOW_FREQUENCY';
  } else if (customer.customer_grade === 'A') {
    updated.customer_grade = 'B';
  } else if (customer.customer_grade === 'B') {
    updated.customer_grade = 'C';
  }

  updated.next_follow_up_at = daysLater(2);
  updated.updated_at = nowISO();

  return { customer: updated, tasks: [] };
}

export function applyPaymentRule(
  customer: Customer,
  action: 'SEND_CONTRACT' | 'MARK_PAID' | 'MARK_WON',
): { customer: Customer; tasks: Task[] } {
  const updated = { ...customer };
  const tasks: Task[] = [];
  const now = nowISO();

  switch (action) {
    case 'SEND_CONTRACT':
      updated.stage = 'PAYMENT_PENDING';
      updated.payment_status = 'PENDING';
      updated.next_action = 'CONFIRM_PAYMENT';
      updated.next_follow_up_at = daysLater(2);
      tasks.push(makeTask('确认打款', customer.id, daysLater(2), 'HIGH', 'RULE'));
      break;
    case 'MARK_PAID':
      updated.stage = 'PAID';
      updated.payment_status = 'PAID';
      updated.paid_at = now;
      updated.next_action = 'CLOSE';
      break;
    case 'MARK_WON':
      updated.stage = 'WON';
      updated.closed_at = now;
      updated.customer_grade = 'A';
      updated.next_action = 'CLOSE';
      break;
  }

  updated.updated_at = now;
  return { customer: updated, tasks };
}

export function buildTodaySummary(
  customers: Customer[],
  tasks: Task[],
): DailySummary {
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const overdue_customers: Customer[] = [];
  const due_today_customers: Customer[] = [];
  const upcoming_visits: Customer[] = [];
  const long_time_no_contact: Customer[] = [];

  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

  for (const c of customers) {
    if (c.stage === 'LOST' || c.stage === 'WON') continue;

    const nextFollowUp = c.next_follow_up_at ? new Date(c.next_follow_up_at) : null;
    const lastContact = c.last_contacted_at ? new Date(c.last_contacted_at) : null;

    // Overdue: next_follow_up_at < today start
    if (nextFollowUp && nextFollowUp < todayStart) {
      overdue_customers.push(c);
    }
    // Due today
    else if (nextFollowUp && nextFollowUp >= todayStart && nextFollowUp <= todayEnd) {
      due_today_customers.push(c);
    }
    // Upcoming 7 days
    else if (nextFollowUp && nextFollowUp > todayEnd && nextFollowUp <= sevenDaysLater) {
      upcoming_visits.push(c);
    }

    // Long time no contact
    if (lastContact) {
      const daysSinceContact = (now.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24);
      if (c.customer_grade === 'A' && daysSinceContact > 2) {
        long_time_no_contact.push(c);
      } else if (c.customer_grade === 'B' && daysSinceContact > 4) {
        long_time_no_contact.push(c);
      }
    } else if (c.customer_grade === 'A' || c.customer_grade === 'B') {
      // Never contacted - include in long time
      long_time_no_contact.push(c);
    }
  }

  const tasks_due_today = tasks.filter(t => {
    if (!t.due_at || t.status !== 'OPEN') return false;
    const due = new Date(t.due_at);
    return due <= todayEnd;
  });

  // Sort: A > B > C > D, overdue > due today
  const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  const sortByGrade = (a: Customer, b: Customer) =>
    (gradeOrder[a.customer_grade] || 4) - (gradeOrder[b.customer_grade] || 4);

  overdue_customers.sort(sortByGrade);
  due_today_customers.sort(sortByGrade);

  return {
    date: now.toISOString().split('T')[0],
    overdue_customers,
    due_today_customers,
    upcoming_visits,
    long_time_no_contact,
    tasks_due_today,
  };
}

// ── v0.3.1: Recommended action by grade ──

export function getRecommendedAction(customer: Customer): string {
  const now = new Date();
  const nextFollowUp = customer.next_follow_up_at ? new Date(customer.next_follow_up_at) : null;
  const isOverdue = nextFollowUp && nextFollowUp < now;
  const neverContacted = !customer.last_contacted_at;

  const prefix = isOverdue ? '【逾期】' : '';

  switch (customer.customer_grade) {
    case 'A':
      if (neverContacted) return `${prefix}首次触达：优先电话/微信联系，尝试约访`;
      return `${prefix}优先电话/微信二次触达，尝试约访`;
    case 'B':
      return `${prefix}补充客户痛点，推动明确下一步动作`;
    case 'C':
      return `${prefix}低频触达，观察反馈后再决定是否升级`;
    case 'D':
      return `${prefix}降低跟进频率或归档观察`;
    default:
      return `${prefix}待评估，建议人工判断`;
  }
}

// ── v0.3.1: Follow-up auto-update ──

export function applyFollowUpUpdate(
  customer: Customer,
  signal: {
    contact_result?: string | null;
    intent_assessment?: string | null;
    suggested_grade?: string | null;
  },
): { customer: Customer; tasks: Task[] } {
  const updated = { ...customer };
  const tasks: Task[] = [];
  const prevGrade = customer.customer_grade;

  updated.last_contacted_at = nowISO();

  // Suggested grade takes priority
  if (signal.suggested_grade && ['A', 'B', 'C', 'D'].includes(signal.suggested_grade)) {
    updated.customer_grade = signal.suggested_grade as CustomerGrade;
  } else if (signal.contact_result === 'negative') {
    // Negative feedback: degrade
    if (signal.intent_assessment === 'NONE') {
      updated.customer_grade = 'D';
      updated.next_action = 'CLOSE';
    } else if (prevGrade === 'A') {
      updated.customer_grade = 'B';
    } else if (prevGrade === 'B') {
      updated.customer_grade = 'C';
    }
  } else if (signal.contact_result === 'positive') {
    // Positive feedback + high intent → upgrade
    if (signal.intent_assessment === 'HIGH') {
      updated.customer_grade = 'A';
      updated.intent_level = 'HIGH';
      updated.next_action = 'SCHEDULE_VISIT';
      if (customer.stage === 'NEW_LEAD' || customer.stage === 'CONTACTED' || customer.stage === 'WECHAT_PASSED') {
        updated.stage = 'REPLIED';
      }
    } else if (signal.intent_assessment === 'MEDIUM' && prevGrade !== 'A') {
      updated.customer_grade = 'B';
      updated.intent_level = 'MEDIUM';
      updated.next_action = 'CONTACT_AGAIN';
    }
  }

  // Recalculate follow-up if grade changed
  if (updated.customer_grade !== prevGrade) {
    updated.next_follow_up_at = calculateNextFollowUpAt(updated.customer_grade);
  }

  updated.updated_at = nowISO();
  return { customer: updated, tasks };
}
