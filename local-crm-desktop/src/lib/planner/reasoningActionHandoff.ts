/**
 * Short-lived session handoff from a reasoning result to an explicit CRM action.
 *
 * Reasoning is not CRM truth. It may only PREPARE a normal capability request
 * after the user asks to act. Never writes. Never persists to DB.
 */

import type { AgentSessionResult } from '../salesAgentTools/agentSession';
import { parseRelativeDateTime } from '../salesAgentTools/writeIntent';
import { classifyFollowUpVsSchedule, isCurrentTurnScheduleDecision } from './followUpInteractionContract';

export type ReasoningActionHint = 'task' | 'schedule';

export interface ReasoningSuggestedAction {
  readonly text: string;
  readonly optional_action_type_hint: ReasoningActionHint | null;
}

export interface LastReasoningActionContext {
  readonly customer_id: string;
  readonly customer_name: string | null;
  readonly reasoning_intent: string;
  readonly conclusion: string;
  readonly suggested_actions: readonly ReasoningSuggestedAction[];
  readonly evidence_refs: readonly string[];
  readonly created_at: string;
}

export type ReasoningContinuationKind =
  | 'generate_task'
  | 'ordinal_task'
  | 'execute_ordinal'
  | 'schedule_next_follow_up'
  | 'do_this';

export interface ReasoningContinuationRequest {
  readonly kind: ReasoningContinuationKind;
  readonly ordinal: number | null;
}

const ORDINAL_CN: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const GENERIC_NEXT = /请人工复核后再决定下一步|保持跟进节奏|请结合本次进展决定下一步/;
const SCHEDULE_HINT = /再(?:次)?联系|下次(?:跟进|联系|沟通)|下[一个]?工作日|(?:周|星期)[一二三四五六日天].{0,8}联系/;
const TASK_HINT = /准备|材料|说明|案例|内部确认|待办|任务/;

export function hintReasoningActionType(text: string): ReasoningActionHint {
  if (classifyFollowUpVsSchedule(text).kind === 'future_only') return 'schedule';
  if (SCHEDULE_HINT.test(text) && !TASK_HINT.test(text)) return 'schedule';
  return 'task';
}

export function projectReasoningActionContext(
  result: AgentSessionResult,
  customerId: string,
  createdAt: string,
  customerName?: string | null,
): LastReasoningActionContext | null {
  const texts = extractSuggestedActionTexts(result);
  if (texts.length === 0) return null;
  return {
    customer_id: customerId,
    customer_name: customerName ?? null,
    reasoning_intent: result.intent_envelope.intent,
    conclusion: stripClaimPrefix(result.structured.customer_understanding),
    suggested_actions: texts.slice(0, 3).map(text => ({
      text,
      optional_action_type_hint: hintReasoningActionType(text),
    })),
    evidence_refs: result.evidence_refs.slice(0, 12),
    created_at: createdAt,
  };
}

export function classifyReasoningActionContinuation(utterance: string): ReasoningContinuationRequest | null {
  const text = stripContinuationPrefix(utterance);
  if (!text) return null;
  if (isCurrentTurnScheduleDecision(text)) return null;
  const ordinal = parseOrdinal(text);
  const wantsTask = /待办|任务|记下来|记住|记下|做成任务|加成待办|生成待办|弄成待办|建个|加进去/.test(text);
  if (ordinal != null && wantsTask) {
    return { kind: 'ordinal_task', ordinal };
  }
  if (ordinal != null) {
    return { kind: 'execute_ordinal', ordinal };
  }
  if (
    /根据复盘生成待办|按这个生成待办|按刚才的建议生成待办|生成(?:下一步)?待办/.test(text)
    || /(?:根据|按).{0,10}(?:刚才|复盘|这个|那个).{0,12}(?:待办|任务)/.test(text)
    || /弄个待办/.test(text)
  ) {
    return { kind: 'generate_task', ordinal: null };
  }
  if (EXPLICIT_PREVIOUS_SCHEDULE_REFERENCE.test(text)) {
    return { kind: 'schedule_next_follow_up', ordinal: null };
  }
  if (/^执行第一条[。！!]?$/.test(text)) {
    return { kind: 'execute_ordinal', ordinal: 1 };
  }
  if (hasPreviousTurnReference(text) || hasExecutionAnaphora(text)) {
    return { kind: 'do_this', ordinal: null };
  }
  return null;
}

const EXPLICIT_PREVIOUS_SCHEDULE_REFERENCE =
  /安排一下下次跟进|安排下次跟进|按刚才的建议安排下次(?:联系|跟进)|安排一下下次联系/;

/**
 * Previous-result reference is a pointing relation, not action semantics.
 * Weekday / 联系 / 安排 / 合适吗 alone never count.
 */
function hasPreviousTurnReference(text: string): boolean {
  return /刚才(?:那个|那条|的建议|说的)|你刚才说的|按你刚才|按上面的建议|上一条/.test(text);
}

function hasExecutionAnaphora(text: string): boolean {
  return /把那个记下来|(?:就)?按这个(?:来|做)/.test(text);
}

/**
 * True only when the user is pointing at the previous reasoning result
 * (ordinal / previous-turn pointer / execution anaphora / explicit “安排一下下次跟进”).
 * A self-contained current-turn decision (“那就 + date + 找/联系”) is not a pointer.
 */
export function isGenuinePreviousResultReference(utterance: string): boolean {
  const text = stripContinuationPrefix(utterance);
  if (!text) return false;
  if (isCurrentTurnScheduleDecision(text)) return false;
  if (parseOrdinal(text) != null) return true;
  if (hasPreviousTurnReference(text) || hasExecutionAnaphora(text)) return true;
  if (EXPLICIT_PREVIOUS_SCHEDULE_REFERENCE.test(text)) return true;
  const request = classifyReasoningActionContinuation(utterance);
  if (!request) return false;
  if (request.kind === 'schedule_next_follow_up') {
    return EXPLICIT_PREVIOUS_SCHEDULE_REFERENCE.test(text);
  }
  return true;
}

export type ReasoningHandoffSelection =
  | { readonly kind: 'task'; readonly text: string }
  | { readonly kind: 'schedule'; readonly text: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'ordinal_out_of_range'; readonly count: number }
  | { readonly kind: 'missing' };

export function selectReasoningHandoff(
  context: LastReasoningActionContext,
  request: ReasoningContinuationRequest,
): ReasoningHandoffSelection {
  const actions = context.suggested_actions;
  if (actions.length === 0) return { kind: 'missing' };
  if (request.kind === 'ordinal_task' || request.kind === 'execute_ordinal') {
    const index = (request.ordinal ?? 0) - 1;
    if (index < 0 || index >= actions.length) return { kind: 'ordinal_out_of_range', count: actions.length };
    const selected = actions[index]!;
    if (request.kind === 'ordinal_task') return { kind: 'task', text: selected.text };
    return selected.optional_action_type_hint === 'schedule'
      ? { kind: 'schedule', text: selected.text }
      : { kind: 'task', text: selected.text };
  }
  if (request.kind === 'generate_task') {
    const taskLike = actions.filter(item => item.optional_action_type_hint !== 'schedule');
    const picked = (taskLike.length > 0 ? taskLike : actions)[0];
    return picked ? { kind: 'task', text: picked.text } : { kind: 'missing' };
  }
  if (request.kind === 'schedule_next_follow_up') {
    const scheduleLike = actions.filter(item => item.optional_action_type_hint === 'schedule');
    const picked = scheduleLike[0] ?? actions.find(item => SCHEDULE_HINT.test(item.text)) ?? null;
    return picked ? { kind: 'schedule', text: picked.text } : { kind: 'missing' };
  }
  const hints = new Set(actions.map(item => item.optional_action_type_hint ?? 'task'));
  if (hints.has('task') && hints.has('schedule') && actions.length > 1) return { kind: 'ambiguous' };
  if (actions.length === 1) {
    const only = actions[0]!;
    return only.optional_action_type_hint === 'schedule'
      ? { kind: 'schedule', text: only.text }
      : { kind: 'task', text: only.text };
  }
  if (hints.has('schedule') && !hints.has('task')) {
    return { kind: 'schedule', text: actions[0]!.text };
  }
  return { kind: 'task', text: actions.find(item => item.optional_action_type_hint !== 'schedule')?.text ?? actions[0]!.text };
}

export function parseScheduleFromReasoningAction(text: string, nowIso: string) {
  return parseRelativeDateTime(text, nowIso);
}

export function staleReasoningActionMessage(context: LastReasoningActionContext): string {
  const name = context.customer_name?.trim();
  if (name) return `这条操作对应的上一轮建议已经不可用。刚才的建议属于${name}，不能用于当前客户。请重新分析当前客户。`;
  return '这条操作对应的上一轮建议已经不可用，请重新分析当前客户。';
}

export const MISSING_REASONING_ACTION_MESSAGE = '这条操作对应的上一轮建议已经不可用，请重新分析当前客户。';

function extractSuggestedActionTexts(result: AgentSessionResult): string[] {
  const blocked = result.blocked_message?.trim() ?? '';
  const usable = (text: string) => {
    const value = stripClaimPrefix(text);
    if (!value) return false;
    if (blocked && value === blocked) return false;
    if (/模型引用了无效证据|大模型当前未配置|未生成 AI 分析/.test(value)) return false;
    if (GENERIC_NEXT.test(value)) return false;
    return true;
  };
  const recommendations = result.grounded_claims
    .filter(item => item.claim_type === 'recommendation')
    .map(item => stripClaimPrefix(item.text))
    .filter(usable);
  if (recommendations.length > 0) return uniqueTexts(recommendations);
  const fromFacts = result.grounded_claims
    .filter(item => item.claim_type === 'crm_fact')
    .map(item => nextClause(item.text))
    .filter((item): item is string => item != null && usable(item));
  if (fromFacts.length > 0) return uniqueTexts(fromFacts);
  const raw = stripClaimPrefix(result.structured.recommended_next_step);
  if (!raw || !usable(raw)) return [];
  return uniqueTexts(splitActions(raw).filter(usable));
}

function nextClause(text: string): string | null {
  const match = stripClaimPrefix(text).match(/下一步[：:]\s*(.+)$/);
  const value = match?.[1]?.replace(/[。．.]+$/u, '').trim() ?? '';
  return value && !GENERIC_NEXT.test(value) ? value : null;
}

function splitActions(text: string): string[] {
  return text
    .split(/[;；\n]/)
    .map(part => part.replace(/^[\d.、\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function uniqueTexts(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function stripClaimPrefix(text: string): string {
  return text.replace(/【[^】]*】/g, '').trim();
}

function stripContinuationPrefix(utterance: string): string {
  return utterance.trim().replace(/^(?:好的?|行|嗯|请|帮我|给我)[，,。\s]*/u, '').trim();
}

function parseOrdinal(text: string): number | null {
  const match = text.match(/第([一二三四五六七八九十]|[1-9]|10)[条个]?/);
  if (!match?.[1]) return null;
  return ORDINAL_CN[match[1]] ?? Number(match[1]);
}
