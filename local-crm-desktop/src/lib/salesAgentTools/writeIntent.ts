/**
 * Deterministic NL write-intent classification and relative schedule parsing.
 * Owned by Session/confirmed-write boundaries — React never classifies or invents dates.
 */

import type { AgentWriteToolId } from './confirmedWrite';
import {
  parseRelativeDateTimeInZone,
  withTimeInZone,
  type ParsedUserSchedule,
} from './appClock';

export type ClosedWriteIntent =
  | 'CREATE_FOLLOW_UP_REQUEST'
  | 'CREATE_TASK_REQUEST'
  | 'UPDATE_CUSTOMER_REQUEST';

export interface ClassifiedWriteIntent {
  readonly intent: ClosedWriteIntent;
  readonly tool_id: AgentWriteToolId;
  readonly reason: string;
}

export type ParsedSchedule = ParsedUserSchedule;

export interface WriteFieldDraft {
  readonly intent: ClosedWriteIntent;
  readonly tool_id: AgentWriteToolId;
  readonly original_instruction: string;
  readonly parsed_fields: Readonly<Record<string, unknown>>;
  readonly missing_fields: readonly string[];
  readonly question: string | null;
  readonly quick_replies: readonly WriteClarificationQuickReply[];
}

export interface WriteClarificationQuickReply {
  readonly label: string;
  readonly value: string;
}

export interface WriteClarificationRequest {
  readonly kind: 'CLARIFICATION_REQUIRED';
  readonly clarification_id: string;
  readonly intent: ClosedWriteIntent;
  readonly tool_id: AgentWriteToolId;
  readonly original_instruction: string;
  readonly customer_id: string;
  readonly question: string;
  readonly missing_fields: readonly string[];
  readonly parsed_fields: Readonly<Record<string, unknown>>;
  readonly quick_replies: readonly WriteClarificationQuickReply[];
  readonly pending_write_intent: ClosedWriteIntent;
}

const CREATE_FOLLOW_UP =
  /(写\s*(一\s*)?条\s*跟进|新增\s*(一\s*)?条?\s*跟进|添加\s*(一\s*)?条?\s*跟进|记录\s*(一下|一\s*条)?\s*(这次)?\s*(沟通|客户)?\s*跟进|帮我\s*记\s*(一\s*)?条\s*(客户)?\s*跟进|创建\s*.*跟进\s*记录|log\s+a\s+follow\s*[- ]?up|create\s+follow\s*[- ]?up)/i;

const CREATE_TASK =
  /(创建\s*(一\s*)?个?\s*任务|建\s*(一\s*)?个?\s*待办|提醒我|待办|create\s+task)/i;

const UPDATE_NEXT_FOLLOW_UP =
  /(修改\s*下次\s*跟进|更新\s*下次\s*跟进|把\s*下\s*一?\s*次\s*(联系|跟进)\s*改|下次\s*跟进\s*(时间|改到)|set\s+next\s+follow|update\s+next\s+follow|改到\s*(下|本|今|明)|下[一二三四五六日天]再?联系)/i;

/** True when utterance is an explicit CRM write (must not fall into summary/draft). */
export function isClosedWriteIntentUtterance(message: string): boolean {
  return classifyClosedWriteIntent(message) !== null;
}

export function classifyClosedWriteIntent(message: string): ClassifiedWriteIntent | null {
  const text = message.trim();
  if (!text) return null;

  // Task before generic follow-up so “提醒我……跟进” remains task.
  if (CREATE_TASK.test(text)) {
    return {
      intent: 'CREATE_TASK_REQUEST',
      tool_id: 'create_task',
      reason: '用户明确要求创建任务/待办提醒。',
    };
  }

  // Explicit follow-up record creation outranks weekday-only schedule language.
  if (CREATE_FOLLOW_UP.test(text)) {
    return {
      intent: 'CREATE_FOLLOW_UP_REQUEST',
      tool_id: 'create_follow_up_record',
      reason: '用户明确要求新增跟进记录。',
    };
  }

  if (UPDATE_NEXT_FOLLOW_UP.test(text)) {
    return {
      intent: 'UPDATE_CUSTOMER_REQUEST',
      tool_id: 'update_next_follow_up_time',
      reason: '用户明确要求更新下一次跟进时间。',
    };
  }

  return null;
}

export function draftWriteFields(message: string, nowIso: string): WriteFieldDraft | null {
  const classified = classifyClosedWriteIntent(message);
  if (!classified) return null;
  const original_instruction = message.trim();
  const schedule = parseRelativeDateTime(original_instruction, nowIso);
  const parsed_fields: Record<string, unknown> = {};
  const missing: string[] = [];

  if (classified.tool_id === 'create_follow_up_record') {
    const notes = extractFollowUpNotes(original_instruction);
    parsed_fields.title = '跟进记录';
    if (notes) parsed_fields.feedback_notes = notes;
    else missing.push('feedback_notes');
    // Only treat future contact language as next_follow_up_at — not past-comms “今天…” narratives.
    const futureSchedule = extractFutureContactSchedule(original_instruction, nowIso);
    if (futureSchedule) {
      if (futureSchedule.has_explicit_time) parsed_fields.next_follow_up_at = futureSchedule.iso;
      else {
        parsed_fields.next_follow_up_date = futureSchedule.iso.slice(0, 10);
        missing.push('next_follow_up_time');
      }
    }
  } else if (classified.tool_id === 'create_task') {
    parsed_fields.title = extractTaskTitle(original_instruction);
    parsed_fields.status = 'OPEN';
    if (schedule?.has_explicit_time) parsed_fields.due_at = schedule.iso;
    else if (schedule) {
      parsed_fields.due_date = schedule.iso.slice(0, 10);
      missing.push('due_at_time');
    }
    // due_at remains optional when the user did not mention any schedule.
  } else if (classified.tool_id === 'update_next_follow_up_time') {
    if (schedule?.has_explicit_time) parsed_fields.next_follow_up_at = schedule.iso;
    else if (schedule) {
      parsed_fields.next_follow_up_date = schedule.iso.slice(0, 10);
      missing.push('next_follow_up_time');
    } else {
      missing.push('next_follow_up_at');
    }
  }

  const question = missing.includes('next_follow_up_time') || missing.includes('due_at_time')
    ? buildTimeClarificationQuestion(schedule)
    : missing.includes('feedback_notes')
      ? '请补充这次跟进的具体内容（已发生的沟通要点）。'
      : missing.includes('due_at') || missing.includes('next_follow_up_at')
        ? '请补充具体日期和时间。'
        : null;

  return {
    intent: classified.intent,
    tool_id: classified.tool_id,
    original_instruction,
    parsed_fields,
    missing_fields: missing,
    question,
    quick_replies: question && (missing.includes('next_follow_up_time') || missing.includes('due_at_time'))
      ? [
          { label: '上午 10:00', value: '上午10:00' },
          { label: '下午 3:00', value: '下午3:00' },
          { label: '自定义时间', value: '__custom__' },
        ]
      : [],
  };
}

export function mergeClarificationAnswer(
  draft: WriteFieldDraft,
  answer: string,
  nowIso: string,
): WriteFieldDraft {
  const trimmed = answer.trim();
  if (!trimmed || trimmed === '__custom__') {
    return {
      ...draft,
      question: draft.missing_fields.some(f => f.includes('time') || f.includes('due_at') || f.includes('follow_up'))
        ? '请输入具体时间，例如 上午10:00 或 15:30。'
        : draft.question,
      quick_replies: [],
      missing_fields: draft.missing_fields,
    };
  }

  const parsed_fields: Record<string, unknown> = { ...draft.parsed_fields };
  const missing = [...draft.missing_fields];
  const dateHint = typeof parsed_fields.next_follow_up_date === 'string'
    ? String(parsed_fields.next_follow_up_date)
    : typeof parsed_fields.due_date === 'string'
      ? String(parsed_fields.due_date)
      : null;

  if (missing.includes('feedback_notes')) {
    parsed_fields.feedback_notes = trimmed;
    missing.splice(missing.indexOf('feedback_notes'), 1);
  }

  if (missing.includes('next_follow_up_time') || missing.includes('due_at_time') || missing.includes('due_at') || missing.includes('next_follow_up_at')) {
    const combined = dateHint ? `${dateHint} ${trimmed}` : `${draft.original_instruction} ${trimmed}`;
    const schedule = parseRelativeDateTime(combined, nowIso) ?? parseRelativeDateTime(trimmed, nowIso);
    if (schedule?.has_explicit_time || (schedule && !dateHint)) {
      if (draft.tool_id === 'create_task') {
        parsed_fields.due_at = schedule.has_explicit_time ? schedule.iso : withDefaultLocalTime(schedule.iso.slice(0, 10), 10, 0, nowIso);
        delete parsed_fields.due_date;
      } else {
        parsed_fields.next_follow_up_at = schedule.has_explicit_time
          ? schedule.iso
          : withDefaultLocalTime(schedule.iso.slice(0, 10), 10, 0, nowIso);
        delete parsed_fields.next_follow_up_date;
      }
      for (const key of ['next_follow_up_time', 'due_at_time', 'due_at', 'next_follow_up_at'] as const) {
        const idx = missing.indexOf(key);
        if (idx >= 0) missing.splice(idx, 1);
      }
    }
  }

  const nextQuestion = missing.includes('next_follow_up_time') || missing.includes('due_at_time')
    ? '下周一几点联系？'
    : missing.length
      ? '请继续补充缺失信息。'
      : null;

  return {
    ...draft,
    parsed_fields,
    missing_fields: missing,
    question: nextQuestion,
    quick_replies: nextQuestion && (missing.includes('next_follow_up_time') || missing.includes('due_at_time'))
      ? [
          { label: '上午 10:00', value: '上午10:00' },
          { label: '下午 3:00', value: '下午3:00' },
          { label: '自定义时间', value: '__custom__' },
        ]
      : [],
  };
}

export function proposedValuesFromDraft(draft: WriteFieldDraft): Readonly<Record<string, unknown>> {
  if (draft.tool_id === 'create_follow_up_record') {
    return {
      title: String(draft.parsed_fields.title ?? '跟进记录'),
      feedback_notes: String(draft.parsed_fields.feedback_notes ?? draft.original_instruction),
    };
  }
  if (draft.tool_id === 'create_task') {
    return {
      title: String(draft.parsed_fields.title ?? draft.original_instruction),
      status: 'OPEN',
      ...(typeof draft.parsed_fields.due_at === 'string' ? { due_at: draft.parsed_fields.due_at } : {}),
    };
  }
  return {
    next_follow_up_at: String(draft.parsed_fields.next_follow_up_at),
  };
}

/** Parse relative Chinese/English schedules without relying on the process locale. */
export function parseRelativeDateTime(message: string, nowIso: string): ParsedSchedule | null {
  return parseRelativeDateTimeInZone(message, nowIso);
}

/** Future contact / next-follow language only (avoids treating “今天沟通了” as a schedule). */
function extractFutureContactSchedule(message: string, nowIso: string): ParsedSchedule | null {
  if (!/(下次|下周一|下周二|下周三|下周四|下周五|下周六|下周日|下星期天|明天|后天|本周|改到|联系)/.test(message)) {
    return null;
  }
  // Prefer the clause after punctuation that mentions contacting again.
  const clause = message.split(/[，,。；;]/).find(part => /下次|下周|明天|后天|本周|联系|改到/.test(part)) ?? message;
  return parseRelativeDateTime(clause, nowIso);
}

function extractFollowUpNotes(message: string): string | null {
  const explicit = message.match(/跟进记录\s*[:：]\s*(.+)$/);
  if (explicit?.[1]?.trim()) return explicit[1].trim();
  const after = message
    .replace(/^(帮我|请)?\s*(写|新增|添加|记录|创建)\s*(一\s*)?条?\s*(客户)?\s*跟进(记录)?\s*[:：,，]?\s*/i, '')
    .replace(/^log\s+a\s+follow\s*[- ]?up\s*[:：,]?\s*/i, '')
    .replace(/^[，,、：:\s]+/u, '')
    .trim();
  if (after && after !== message.trim()) return after;
  if (/客户表示|今天|已确认|沟通|反馈/.test(message)) return message.trim();
  // Planning-only follow-up (“写一条跟进，下周一联系”) — keep the schedule clause as note, not empty.
  if (/联系|跟进/.test(after || message)) return (after || '安排后续联系').replace(/^[，,、：:\s]+/u, '').trim();
  return null;
}

function extractTaskTitle(message: string): string {
  const cleaned = message
    .replace(/^(帮我|请)?\s*/u, '')
    .replace(/提醒我|创建(一个)?任务|建(一个)?待办|create\s+task\s*[:：]?\s*/gi, '')
    .trim();
  return cleaned || message.trim();
}

function buildTimeClarificationQuestion(schedule: ParsedSchedule | null): string {
  if (schedule?.display) return `${schedule.display}几点联系？`;
  return '下周一几点联系？';
}

function withDefaultLocalTime(dateOnly: string, hours: number, minutes: number, nowIso: string): string {
  return withTimeInZone(dateOnly, hours, minutes, nowIso);
}
