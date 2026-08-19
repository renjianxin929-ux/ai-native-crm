/**
 * Follow-up / interaction contract.
 *
 * follow_up.create = an ACTUAL occurred follow-up. Confirmed historical rows are is_completed = 1
 * and may participate in last_contact / interaction timeline.
 *
 * Pure future scheduling (“周三联系” / “下周再联系”) must not fabricate an occurred interaction.
 * Mixed: one confirmed logical action with both an occurred note and a future schedule.
 */

export type FollowUpInteractionKind = 'occurred' | 'future_only' | 'mixed' | 'ambiguous';

export interface FollowUpInteractionClassification {
  readonly kind: FollowUpInteractionKind;
  readonly occurred_notes: string | null;
  readonly has_future_schedule: boolean;
}

const OCCURRED = /今天|今日|刚才|已经|已沟|已确认|打了|打电话|没接|未接|沟通过|拜访了|反馈|客户表示|客户确认|客户要求|沟通要点|本次|这次|确认方案/;
const FUTURE = /下周|下周一|下周二|下周三|下周四|下周五|下周六|下周日|明天|后天|本周|下次|改到|(?:周|星期)[一二三四五六日天](?:再)?(?:联系|找)|月底|月末/;
const SCHEDULE_ONLY_NOTE = /^(?:周|星期)?[一二三四五六日天](?:再)?(?:联系|找他|找她)$|^(?:下次|明天|后天|下周).{0,12}(?:联系|找他|找她)$/;
const ADVICE_QUESTION = /合适吗|行不行|怎么样|是不是|比较好|什么时候|啥时候/;
const PREVIOUS_RESULT_POINTER = /刚才|上一条|按这个来|把那个记下来|第[一二三四五六七八九十1-9]/;
const CURRENT_TURN_SCHEDULE_DECISION =
  /^(?:那就|就)(?:按)?(?:.{0,6})?(?:下?(?:周|星期)[一二三四五六日天]|明天|后天|(?:本|这)(?:周|星期)[一二三四五六日天]|(?:周|星期)[一二三四五六日天]).{0,10}(?:找他|找她|找您|联系|跟进)/;

/**
 * A complete current-turn schedule decision: confirmation + date + contact action.
 * This is not a pointer at a previous structured result.
 */
export function isCurrentTurnScheduleDecision(utterance: string): boolean {
  const text = utterance.trim().replace(/^(?:好的?|行|嗯|请|帮我|给我)[，,。\s]*/u, '').trim();
  if (!text || ADVICE_QUESTION.test(text) || PREVIOUS_RESULT_POINTER.test(text)) return false;
  return CURRENT_TURN_SCHEDULE_DECISION.test(text);
}

export function classifyFollowUpVsSchedule(utterance: string): FollowUpInteractionClassification {
  const text = utterance.trim();
  const clauses = text.split(/[，,。；;]/).map(part => part.trim()).filter(Boolean);
  const occurredClauses = clauses.filter(part => OCCURRED.test(part));
  const hasFuture = FUTURE.test(text);
  const hasOccurred = OCCURRED.test(text);

  if (hasOccurred && hasFuture) {
    return {
      kind: 'mixed',
      occurred_notes: occurredClauses.join('，') || text,
      has_future_schedule: true,
    };
  }
  if (hasFuture && !hasOccurred) {
    const leftover = clauses.filter(part => !FUTURE.test(part) && !/^(?:帮我|给我|请)?(?:写|新增|添加|记录|创建).{0,12}跟进/.test(part)).join('，');
    if (leftover && leftover.length >= 4 && !SCHEDULE_ONLY_NOTE.test(leftover)) {
      return { kind: 'ambiguous', occurred_notes: leftover, has_future_schedule: true };
    }
    return { kind: 'future_only', occurred_notes: null, has_future_schedule: true };
  }
  if (hasOccurred) {
    return { kind: 'occurred', occurred_notes: occurredClauses.join('，') || text, has_future_schedule: false };
  }
  return { kind: 'ambiguous', occurred_notes: null, has_future_schedule: hasFuture };
}

export function isScheduleOnlyFollowUpNote(notes: string | null | undefined): boolean {
  if (!notes) return true;
  return SCHEDULE_ONLY_NOTE.test(notes.trim());
}

/** Timeline / last-contact may only use completed follow-ups plus actual visits. */
export function isCompletedHistoricalFollowUp(row: { readonly is_completed?: number | boolean | null }): boolean {
  return row.is_completed === 1 || row.is_completed === true;
}
