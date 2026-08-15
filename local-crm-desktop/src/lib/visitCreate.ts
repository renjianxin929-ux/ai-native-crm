/**
 * V0.2A / W4-3 — Visit Create shared product service.
 *
 * 单一真源：把 VisitForm "新增面访记录"（CustomerDetail.handleVisitSaved）的
 * 完整产品语义提取到这里，让人工 UI 路径与 Agent 确认后执行路径复用同一份
 * 产品组合（§4 产品语义对等）：
 *
 *   form input → 存在性校验（客户必须已存在，绝不 upsert/create）
 *   → 若 visit_outcome 提供 → applyVisitOutcome(customer, outcome) → updateCustomer
 *     （人工路径只取 `{ customer: updated }`，丢弃 applyVisitOutcome 返回的 tasks：
 *      产品真实行为是"只更新客户状态，不创建任务"——与 CustomerDetail.handleVisitSaved
 *      逐字一致）
 *   → db.createVisit（INSERT INTO visit_records，visited_at / created_at /
 *     updated_at = 当前时间）
 *   → 返回 { visit_id }
 *
 * ── 与 VisitForm / CustomerDetail.handleVisitSaved 的产品对等 ────────────
 * 人工新增面访记录时（CustomerDetail.tsx:320-335）：
 *   - title 必填（表单阻止空标题提交）；其余 6 个字段可选，`value || null`
 *     （空串 → null，逐字段复用）。
 *   - visited_at 由表单固定为 `new Date().toISOString()`（系统派生，非用户可编辑）。
 *   - id / created_at / updated_at 由提交路径生成（uuidv4 + 当前时间）。
 *   - 若 visit_outcome 非空 → applyVisitOutcome(customer, outcome) 后 updateCustomer；
 *     返回的 tasks 被丢弃（人工路径不创建任务）。
 *   - 之后 createVisit 插入面访记录行。
 * 本服务在"给定已校验的产品字段，按人工 VisitForm 完全相同的方式创建面访记录"
 * 上与之等价。
 *
 * 本模块不实现输入安全护栏的"值规范化"（白名单键 / 枚举 / fail-closed 属于
 * 能力绑定层 + confirmedWrite allowedFields）；它只负责"给定已校验的产品字段，
 * 按人工 VisitForm 完全相同的方式创建面访记录"，并作为第 3 层（approved boundary /
 * 产品服务）在运行时再次闭合白名单——任何非面访字段到达这里都 fail closed。
 *
 * 输出最小化（W4-3 契约）：返回 { visit_id }，绝不返回完整面访记录行。
 */

import { createVisit, getCustomer, updateCustomer } from './db';
import { applyVisitOutcome } from './rules';
import type { IntentLevel, NextAction, VisitOutcome, VisitRecord } from './types';

/**
 * 人工"新增面访记录"表单的 7 个用户可编辑字段（与 VisitForm 白名单一致；
 * 与 confirmedWrite.allowedFields['create_visit_record'] 同一集合）。
 * 刻意不包含：id / created_at / updated_at / visited_at（系统派生字段）、
 * customer_id（来自 invocation.scope，非输入字段）。
 */
export const VISIT_CREATE_INPUT_KEYS: readonly string[] = Object.freeze([
  'title',
  'visit_notes',
  'customer_concerns',
  'intent_after_visit',
  'visit_outcome',
  'next_action',
  'expected_contract_at',
]);

/** 面访结论枚举（与 types.ts VisitOutcome 完全一致；人工表单 select 全部 6 项）。 */
export const VISIT_OUTCOMES: readonly VisitOutcome[] = Object.freeze([
  'READY_TO_SIGN',
  'FOLLOW_UP_NEEDED',
  'CONSIDERING',
  'COMPARING',
  'NO_SHOW',
  'LOST',
]);

/** 面访后意向枚举（与 types.ts IntentLevel 完全一致；人工表单 select 全部 5 项）。 */
export const VISIT_INTENT_LEVELS: readonly IntentLevel[] = Object.freeze([
  'HIGH',
  'MEDIUM',
  'LOW',
  'NONE',
  'UNKNOWN',
]);

/**
 * 面访记录"下一步动作"枚举：人工 VisitForm 的 select 只提供这 6 项
 * （CONTACT_AGAIN / SCHEDULE_VISIT / SEND_CONTRACT / WAIT_CUSTOMER /
 * LOW_FREQUENCY / CLOSE）。NextAction 类型的 VISIT / CONFIRM_PAYMENT 两项
 * 刻意不在其中——人工面访表单无法产出它们，Agent 面访能力也不得越权设置。
 */
export const VISIT_NEXT_ACTIONS: readonly string[] = Object.freeze([
  'CONTACT_AGAIN',
  'SCHEDULE_VISIT',
  'SEND_CONTRACT',
  'WAIT_CUSTOMER',
  'LOW_FREQUENCY',
  'CLOSE',
]);

const VISIT_OUTCOME_SET: ReadonlySet<string> = new Set<string>(VISIT_OUTCOMES);
const VISIT_INTENT_LEVEL_SET: ReadonlySet<string> = new Set<string>(VISIT_INTENT_LEVELS);
const VISIT_NEXT_ACTION_SET: ReadonlySet<string> = new Set<string>(VISIT_NEXT_ACTIONS);

/** 待创建面访记录的完整产品字段（id / customer_id 由调用方生成/提供；可选字段空值语义见下）。 */
export interface VisitCreateInput {
  /** 待创建面访记录 id（调用方生成；与人工提交时 CustomerDetail 生成 uuidv4 一致）。 */
  readonly id: string;
  /** 目标客户 id（来自 invocation.scope.customer_id；服务层不重新选择客户）。 */
  readonly customer_id: string;
  /** 面访标题（必填；人工表单阻止空标题提交）。 */
  readonly title: string;
  readonly visit_notes?: string | null;
  readonly customer_concerns?: string | null;
  readonly intent_after_visit?: IntentLevel | null;
  readonly visit_outcome?: VisitOutcome | null;
  /** 下一步动作（人工表单 6 项子集，非完整 NextAction）。 */
  readonly next_action?: string | null;
  /** 预计签约时间（YYYY-MM-DD，来自人工表单 `<input type="date">`）。 */
  readonly expected_contract_at?: string | null;
}

/**
 * 确认后执行的最小真实产品"新增面访记录"执行器（§18）。
 *
 * 纵深防御（Layer 3）：
 * - 白名单键闭合：任何非面访字段键一律 fail closed（绝不 strip、绝不透传）；
 * - id / customer_id 非空；title 非空（人工表单阻止空标题提交）；
 * - 枚举值闭合（intent_after_visit / visit_outcome / next_action 只在人工表单可选集合内）；
 * - 目标客户必须存在（§8）：不存在 → truthful failure，零写入（绝不 upsert / create）。
 *
 * 产品语义：若 visit_outcome 非空 → applyVisitOutcome 后 updateCustomer（只取
 * customer，丢弃 tasks——与人工路径逐字一致）；然后 createVisit 插入面访记录。
 * 返回 { visit_id }（最小输出契约）。
 */
/** 服务层允许键 = id + customer_id + 7 个面访字段（纵深防御第 3 层白名单闭合）。 */
const VISIT_SERVICE_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'id',
  'customer_id',
  ...VISIT_CREATE_INPUT_KEYS,
]);

export async function createVisitWithProductRules(
  input: VisitCreateInput,
): Promise<{ visit_id: string }> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('visit.create input must be a plain object.');
  }
  // 纵深防御（Layer 3）：未知键 / 原型键 fail closed（绝不 strip、绝不透传）。
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!VISIT_SERVICE_ALLOWED_KEYS.has(key)) {
      throw new Error(`visit.create rejects unknown field: ${key}`);
    }
  }
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    throw new Error('visit.create requires a non-empty id.');
  }
  if (typeof input.customer_id !== 'string' || input.customer_id.trim().length === 0) {
    throw new Error('visit.create requires a non-empty customer_id.');
  }
  const title = input.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('visit.create title must be a non-empty string.');
  }
  if (
    input.intent_after_visit !== undefined
    && input.intent_after_visit !== null
    && (typeof input.intent_after_visit !== 'string' || !VISIT_INTENT_LEVEL_SET.has(input.intent_after_visit))
  ) {
    throw new Error(`visit.create intent_after_visit must be one of: ${VISIT_INTENT_LEVELS.join(', ')}.`);
  }
  if (
    input.visit_outcome !== undefined
    && input.visit_outcome !== null
    && (typeof input.visit_outcome !== 'string' || !VISIT_OUTCOME_SET.has(input.visit_outcome))
  ) {
    throw new Error(`visit.create visit_outcome must be one of: ${VISIT_OUTCOMES.join(', ')}.`);
  }
  if (
    input.next_action !== undefined
    && input.next_action !== null
    && (typeof input.next_action !== 'string' || !VISIT_NEXT_ACTION_SET.has(input.next_action))
  ) {
    throw new Error(`visit.create next_action must be one of: ${VISIT_NEXT_ACTIONS.join(', ')}.`);
  }

  // 存在性校验（§8）：未知客户 → truthful failure → 零写入。
  const existing = await getCustomer(input.customer_id);
  if (!existing) {
    throw new Error(`visit.create target customer does not exist: ${input.customer_id}`);
  }

  const now = new Date().toISOString();
  const record: VisitRecord = {
    id: input.id,
    customer_id: input.customer_id,
    title: title.trim(),
    // 系统派生：visited_at = 当前时间（与人工表单 `new Date().toISOString()` 一致）。
    visited_at: now,
    visit_notes: input.visit_notes ?? null,
    customer_concerns: input.customer_concerns ?? null,
    intent_after_visit: input.intent_after_visit ?? null,
    visit_outcome: input.visit_outcome ?? null,
    next_action: (input.next_action ?? null) as NextAction | null,
    expected_contract_at: input.expected_contract_at ?? null,
    created_at: now,
    updated_at: now,
  };

  // 产品规则副作用（与人工 CustomerDetail.handleVisitSaved 逐字一致）：
  // 只取 applyVisitOutcome 返回的 customer 并更新；返回的 tasks 被丢弃（不创建任务）。
  if (record.visit_outcome) {
    const { customer: updated } = applyVisitOutcome(existing, record.visit_outcome);
    await updateCustomer(input.customer_id, updated);
  }

  await createVisit(record);
  return { visit_id: record.id };
}
