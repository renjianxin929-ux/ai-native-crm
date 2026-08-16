/**
 * V0.2A / W3-1 Closure 1 (+ W4-1 customer.create + W4-2 customer.profile.update
 * + W4-4 customer.delete + W4-3 visit.create + C0 customer.opportunity_amount.update)
 * — Production Write Adapters（生产写绑定 + 确认交接适配器）。
 *
 * 本模块是 GAP-B / GAP-C / GAP-F 的执行侧实现：为 W3-3 七个冻结写能力提供
 * 真实、权威优先、确认安全的 W3-1 生产绑定，为 W4-1 customer.create 提供
 * scope=NONE 的新增生产写绑定，为 W4-2 customer.profile.update 提供
 * scope=CUSTOMER 的窄资料更新生产写绑定（A10 REQUIRE_CONFIRMATION / 现有确认运行时），
 * 为 W4-4 customer.delete 提供 scope=CUSTOMER 的破坏性删除写绑定
 * （A10 REQUIRE_STRONG_CONFIRMATION），并为 W4-3 visit.create 提供
 * scope=CUSTOMER 的面访创建写绑定（A10 REQUIRE_CONFIRMATION），
 * 为 C0 customer.opportunity_amount.update 提供 scope=CUSTOMER 的窄义商机金额
 * 更新写绑定（A10 REQUIRE_CONFIRMATION / 现有确认运行时）：
 *
 *   - executor_ref 精确绑定到已审计的现有 Product 写执行器身份；
 *   - validateInput 是确定性输入护栏（fail-closed，执行前）——绝不 `input: unknown`
 *     直接 cast；未知字段/坏形状/客户选择字段与 scope 矛盾一律抛
 *     CapabilityInputValidationError（INVALID_INPUT，业务执行器调用数 = 0）；
 *   - handoff（GAP-F）把"确认类结果"交接进现有产品确认机制：
 *        salesAgent 写  → buildWriteProposal + registerCanonicalProposal
 *                        （sessionWriteStateStore，与 agentSession.emitWriteProposal 同源）
 *        Battle Card 写 → createBattleCardAgentTools.proposeXxx（产品唯一提案构造路径）
 *     交接只注册 canonical 提案（CONFIRMATION_HANDOFF_SIDE_EFFECT），绝不执行业务写；
 *     人工确认后仍由现有机制（confirmWriteByRef → approvedCrmWriteBoundary）执行
 *     （POST_CONFIRM_EXISTING_EXECUTOR，本分支不改动）。
 *   - execute 对六个确认类能力是 fail-closed 护栏：统一执行引擎在 A10 要求确认时
 *     绝不调用业务执行器；若被直接调用（防御纵深）也拒绝执行，绝不 bypass
 *     现有 nonce/replay 确认语义。
 *   - 唯一 AUTO 写（battle_card.draft.create）的 execute 调用真实产品草稿执行器
 *     （battleCardClient.generateStageCardDraft → engine.generateStageCardDraft），
 *     保持 append-only DRAFT 语义，不确认卡片、不改 current_stage_card_id。
 *
 * 客户所有权不变式（§19-21）：
 *   - CUSTOMER 写能力的执行器生效客户身份只来自 invocation.scope.customer_id；
 *   - 输入顶层客户选择字段（customer_id / customerId）若出现必须等于 scope；
 *   - Battle Card 的 by-ID 目标（card_id / hypothesis_id）必须在交接前证明属于
 *     scope 客户（直接只读 SELECT 校验，不修改仓库层）；所有权不符 → fail closed。
 *
 * 本模块刻意独立于 production.ts：让统一执行层的"引擎/契约/绑定模型"文件保持
 * 零写语义（W3-1 静态护栏），写适配器集中在本文件并只复用现有产品运行时。
 */

import type { DatabaseLike } from '../../db';
import type {
  ContactMethod,
  CustomerStage,
  IntentLevel,
  PhoneFeedback,
  VisitOutcome,
  WechatAddStatus,
  WechatSearchStatus,
} from '../../types';
import type { CapabilityExecutorBinding } from './binding';
import {
  CapabilityInputValidationError,
  type CapabilityConfirmationHandoff,
  type CapabilityInvocationScope,
} from './contract';
import { buildWriteProposal, parseFactVerificationsRuntime, MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES, type FactVerificationItem } from '../../salesAgentTools/confirmedWrite';
import { registerCanonicalProposal } from '../../salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../../salesAgentTools/appClock';
import { CUSTOMER_PROFILE_UPDATE_KEYS } from '../../customerProfileUpdate';
import { VISIT_CREATE_INPUT_KEYS, VISIT_NEXT_ACTIONS, VISIT_OUTCOMES } from '../../visitCreate';
import { v4 as uuidv4 } from 'uuid';
import { createBattleCardAgentTools } from '../../battleCard/agentTools';
import type { ConfirmImportDecisions } from '../../battleCard/importService';
import type { HypothesisStatus } from '../../battleCard/types';

/* ------------------------------------------------------------------ */
/* 确认机制身份（现有产品确认机制；不创建任何新确认运行时）                 */
/* ------------------------------------------------------------------ */

/** Sales Agent 确认机制：sessionWriteStateStore 提案 + confirmWriteByRef → approvedCrmWriteBoundary。 */
export const SALES_AGENT_CONFIRMATION_MECHANISM = 'salesAgentConfirmedWrite' as const;
/** Battle Card 确认机制：createBattleCardAgentTools.proposeXxx 提案 + confirmProposal → approvedCrmWriteBoundary（battleCard executor proxy）。 */
export const BATTLE_CARD_CONFIRMATION_MECHANISM = 'battleCardConfirmedWrite' as const;

/* ------------------------------------------------------------------ */
/* 共享校验护栏（确定性、fail-closed、无副作用；与 production.ts 同款）    */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDatabaseLike(value: unknown): value is DatabaseLike {
  return isPlainObject(value)
    && typeof value.execute === 'function'
    && typeof value.select === 'function';
}

function requireCustomerScope(scope: CapabilityInvocationScope): string {
  const customerId = scope.customer_id;
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    throw new Error('Internal invariant: customer scope is required before executor execution.');
  }
  return customerId;
}

/** 客户选择字段（真实输入契约拼写 + 防御性检查；与 production.ts 同款，不递归扫描）。 */
const CUSTOMER_SELECTOR_KEYS: readonly string[] = ['customer_id', 'customerId'];

/** SCOPE↔INPUT 客户相干护栏：顶层客户选择字段出现时不得反驳 scope（值必须相等）。 */
function assertCustomerSelectorCoherent(input: unknown, scope: CapabilityInvocationScope): void {
  if (!isPlainObject(input)) return;
  const record = input as Record<string, unknown>;
  const scopeCustomerId = scope.customer_id;
  const hasValidScope = typeof scopeCustomerId === 'string' && scopeCustomerId.trim().length > 0;
  for (const key of CUSTOMER_SELECTOR_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new CapabilityInputValidationError(`Input customer selector '${key}' must be a non-empty string when present.`);
    }
    if (hasValidScope && value !== scopeCustomerId) {
      throw new CapabilityInputValidationError(
        `Input customer selector '${key}' ("${value}") contradicts invocation scope.customer_id ("${scopeCustomerId}"); refusing to execute.`,
      );
    }
  }
}

/** 拒绝输入中的未知字段（fail closed；允许客户选择字段经相干校验后保留）。 */
function rejectUnknownFields(record: Record<string, unknown>, capabilityId: string, allowed: readonly string[]): void {
  const allowedSet = new Set<string>(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new CapabilityInputValidationError(`${capabilityId} rejects unknown input field '${key}'.`);
    }
  }
}

const MAX_STRING_LENGTH = 512;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CapabilityInputValidationError(`${field} must be a non-empty string.`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new CapabilityInputValidationError(`${field} exceeds max length ${MAX_STRING_LENGTH}.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, field);
}

/**
 * raw_content 字段护栏：非空字符串；UTF-8 字节数不得超过现有产品权威上限
 * （MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES —— 提案 envelope 总量上限，见 confirmedWrite）。
 * 超过即 fail-closed（与现有确认运行时同一上限常量，不复制另一份数值）。
 */
function requireRawContent(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CapabilityInputValidationError(`${field} must be a non-empty string.`);
  }
  if (new TextEncoder().encode(value).byteLength > MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES) {
    throw new CapabilityInputValidationError(`${field} exceeds the canonical proposal byte limit (${MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES} bytes).`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string, maxItems = 500): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CapabilityInputValidationError(`${field} must be an array of non-empty strings.`);
  if (value.length > maxItems) throw new CapabilityInputValidationError(`${field} exceeds max items ${maxItems}.`);
  return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

const CUSTOMER_STAGES: readonly string[] = [
  'NEW_LEAD', 'CONTACTED', 'WECHAT_PASSED', 'REPLIED', 'VISIT_READY',
  'VISITED', 'CONTRACTING', 'PAYMENT_PENDING', 'PAID', 'WON', 'LOST',
];

const HYPOTHESIS_STATUSES: readonly HypothesisStatus[] = [
  'PENDING', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED', 'EXPIRED',
];

function optionalClock(value: unknown): (() => string) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'function') {
    throw new CapabilityInputValidationError('clock must be a function when present.');
  }
  return value as () => string;
}

const now = (): string => SALES_AGENT_APP_CLOCK.now();

/* ------------------------------------------------------------------ */
/* 确认类执行器护栏（fail-closed）：统一执行在确认前绝不调用业务执行器。      */
/* 防御纵深：即使被直接调用也拒绝，绝不 bypass 现有 nonce/replay 确认语义。  */
/* ------------------------------------------------------------------ */

function refuseBusinessExecutor(capabilityId: string): never {
  throw new Error(
    `${capabilityId} requires exact human confirmation through the existing product confirmation flow; ` +
    'the unified execution engine must never invoke the business executor before confirmation. ' +
    'The existing mechanism (confirmWriteByRef → approvedCrmWriteBoundary) owns post-confirmation execution.',
  );
}

/* ------------------------------------------------------------------ */
/* 1) follow_up.create — salesAgentWriteTool:create_follow_up_record     */
/* ------------------------------------------------------------------ */

export interface FollowUpCreateInput {
  readonly title: string;
  readonly feedback_notes: string | null;
  readonly next_follow_up_at: string | null;
}

const FOLLOW_UP_CREATE_KEYS: readonly string[] = ['title', 'feedback_notes', 'next_follow_up_at', ...CUSTOMER_SELECTOR_KEYS];

const followUpCreateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:create_follow_up_record',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): FollowUpCreateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('follow_up.create requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'follow_up.create', FOLLOW_UP_CREATE_KEYS);
    const title = requireString(record.title, 'follow_up.create title');
    const feedback_notes = optionalString(record.feedback_notes, 'follow_up.create feedback_notes');
    const next_follow_up_at = optionalString(record.next_follow_up_at, 'follow_up.create next_follow_up_at');
    return { title, feedback_notes, next_follow_up_at };
  },
  handoff: (validatedInput: unknown, scope: CapabilityInvocationScope): CapabilityConfirmationHandoff => {
    const input = validatedInput as FollowUpCreateInput;
    const customerId = requireCustomerScope(scope);
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '创建跟进记录',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'create_follow_up_record',
      proposed_values: {
        title: input.title,
        feedback_notes: input.feedback_notes,
        next_follow_up_at: input.next_follow_up_at,
      },
      reason: 'W3-1 统一执行确认交接（现有 confirmed-write 提案路径）',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('follow_up.create'),
};

/* ------------------------------------------------------------------ */
/* 2) task.create — salesAgentWriteTool:create_task                     */
/* ------------------------------------------------------------------ */

export interface TaskCreateInput {
  readonly title: string;
  readonly due_at: string | null;
}

const TASK_CREATE_KEYS: readonly string[] = ['title', 'due_at', ...CUSTOMER_SELECTOR_KEYS];

const taskCreateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:create_task',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): TaskCreateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('task.create requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'task.create', TASK_CREATE_KEYS);
    const title = requireString(record.title, 'task.create title');
    const due_at = optionalString(record.due_at, 'task.create due_at');
    return { title, due_at };
  },
  handoff: (validatedInput: unknown, scope: CapabilityInvocationScope): CapabilityConfirmationHandoff => {
    const input = validatedInput as TaskCreateInput;
    const customerId = requireCustomerScope(scope);
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '创建任务',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'create_task',
      // 冻结语义（W3-3 描述）：Task 实体，status OPEN、due_at 可选、priority MEDIUM、source MANUAL。
      proposed_values: { title: input.title, due_at: input.due_at, status: 'OPEN' },
      reason: 'W3-1 统一执行确认交接（现有 confirmed-write 提案路径）',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('task.create'),
};

/* ------------------------------------------------------------------ */
/* 3) customer.next_follow_up_time.update —                             */
/*    salesAgentWriteTool:update_next_follow_up_time                    */
/* ------------------------------------------------------------------ */

export interface CustomerNextFollowUpTimeUpdateInput {
  readonly db: DatabaseLike;
  readonly next_follow_up_at: string;
}

const CUSTOMER_NEXT_FOLLOW_UP_UPDATE_KEYS: readonly string[] = ['db', 'next_follow_up_at', ...CUSTOMER_SELECTOR_KEYS];

const customerNextFollowUpTimeUpdateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:update_next_follow_up_time',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): CustomerNextFollowUpTimeUpdateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('customer.next_follow_up_time.update requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'customer.next_follow_up_time.update', CUSTOMER_NEXT_FOLLOW_UP_UPDATE_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('customer.next_follow_up_time.update requires a DatabaseLike db handle (to read the stored current value for the proposal).');
    }
    const next_follow_up_at = requireString(record.next_follow_up_at, 'customer.next_follow_up_time.update next_follow_up_at');
    return { db: record.db as DatabaseLike, next_follow_up_at };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as CustomerNextFollowUpTimeUpdateInput;
    const customerId = requireCustomerScope(scope);
    // 现有产品语义（currentValuesForTool）：提案必须携带客户当前存储值。
    const rows = await input.db.select<{ next_follow_up_at: string | null }>(
      'SELECT next_follow_up_at FROM customers WHERE id = ?',
      [customerId],
    );
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`customer.next_follow_up_time.update scope customer does not exist: ${customerId}`);
    }
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '更新下次跟进时间',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'update_next_follow_up_time',
      current_values: { next_follow_up_at: rows[0]?.next_follow_up_at ?? null },
      proposed_values: { next_follow_up_at: input.next_follow_up_at },
      reason: 'W3-1 统一执行确认交接（现有 confirmed-write 提案路径）',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('customer.next_follow_up_time.update'),
};

/* ------------------------------------------------------------------ */
/* 3.5) customer.create — salesAgentWriteTool:create_customer          */
/*      （W4-1：唯一新增生产能力；scope=NONE；A10 REQUIRE_CONFIRMATION）   */
/* ------------------------------------------------------------------ */

/**
 * 人工"新增客户"表单的 20 个用户可编辑字段（与 CustomerForm 白名单一致；
 * 与 confirmedWrite.allowedFields['create_customer'] 同一集合）。
 * 刻意不包含：id / 时间戳 / stage / grade / 支付 / 战斗卡 / 调度等系统字段，
 * 也绝不包含 customer_id / customerId 目标身份（scope=NONE，无既有客户）。
 */
export const CUSTOMER_CREATE_INPUT_KEYS: readonly string[] = Object.freeze([
  'name',
  'wechat_id',
  'phone_number',
  'contact_method',
  'wechat_search_status',
  'is_key_decision_maker',
  'wechat_add_status',
  'intent_level',
  'phone_feedback',
  'rough_visit_time_text',
  'notes',
  'website',
  'region',
  'industry',
  'contact_person',
  'email',
  'address',
  'pitch_angle',
  'qualification_reason',
  'source',
]);

const CONTACT_METHODS = ['WECHAT', 'PHONE', 'WECHAT_AND_PHONE'] as const;
const WECHAT_SEARCH_STATUSES = ['FOUND', 'NOT_FOUND', 'ABNORMAL', 'UNCERTAIN'] as const;
const WECHAT_ADD_STATUSES = ['NOT_ADDED', 'ADDED', 'PASSED', 'REJECTED', 'NO_RESPONSE'] as const;
const INTENT_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN'] as const;
const PHONE_FEEDBACKS = ['NOT_NEEDED', 'CAN_LEARN', 'INTERESTED', 'CAN_MEET', 'NO_ANSWER', 'INVALID_NUMBER', 'UNKNOWN'] as const;

/**
 * 规范化的 customer.create 输入（校验后；默认值已按产品语义应用）：
 * - 空串/未提供 → 产品默认（wechat_add_status=NOT_ADDED、intent_level=UNKNOWN、
 *   is_key_decision_maker=0、其余可空字段 null）；
 * - 该对象原样进入 canonical proposal 的 proposed_values（人工确认所见即所得）。
 */
export interface CustomerCreateInput {
  readonly name: string;
  readonly wechat_id: string | null;
  readonly phone_number: string | null;
  readonly contact_method: ContactMethod | null;
  readonly wechat_search_status: WechatSearchStatus | null;
  readonly is_key_decision_maker: 0 | 1;
  readonly wechat_add_status: WechatAddStatus;
  readonly intent_level: IntentLevel;
  readonly phone_feedback: PhoneFeedback | null;
  readonly rough_visit_time_text: string | null;
  readonly notes: string | null;
  readonly website: string | null;
  readonly region: string | null;
  readonly industry: string | null;
  readonly contact_person: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly pitch_angle: string | null;
  readonly qualification_reason: string | null;
  readonly source: string | null;
}

/** 可选产品字符串字段：undefined/null/'' → null（与 CustomerForm `value || null` 一致）；其余按原样、有界。 */
function optionalProductString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new CapabilityInputValidationError(`${field} must be a string when present.`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new CapabilityInputValidationError(`${field} exceeds max length ${MAX_STRING_LENGTH}.`);
  }
  if (value === '') return null;
  return value;
}

/** 可选枚举字段：undefined/null/'' → 默认（可空字段默认 null；产品默认枚举走 defaultValue）。 */
function optionalProductEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  defaultValue: T | null,
): T | null {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new CapabilityInputValidationError(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

const customerCreateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:create_customer',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): CustomerCreateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('customer.create requires an object input with the customer form fields.');
    }
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'customer.create', CUSTOMER_CREATE_INPUT_KEYS);
    // scope=NONE：绝不接受调用方 scope 内的客户身份注入（无 fallback、无"当前客户"）。
    void scope;
    const name = requireString(record.name, 'customer.create name');
    const wechat_id = optionalProductString(record.wechat_id, 'customer.create wechat_id');
    const phone_number = optionalProductString(record.phone_number, 'customer.create phone_number');
    const contact_method = optionalProductEnum(record.contact_method, CONTACT_METHODS, 'customer.create contact_method', null);
    const wechat_search_status = optionalProductEnum(record.wechat_search_status, WECHAT_SEARCH_STATUSES, 'customer.create wechat_search_status', null);
    const rawKeyDm = record.is_key_decision_maker;
    if (rawKeyDm !== undefined && rawKeyDm !== 0 && rawKeyDm !== 1) {
      throw new CapabilityInputValidationError('customer.create is_key_decision_maker must be 0 or 1.');
    }
    const is_key_decision_maker: 0 | 1 = rawKeyDm === undefined ? 0 : (rawKeyDm as 0 | 1);
    const wechat_add_status = optionalProductEnum(record.wechat_add_status, WECHAT_ADD_STATUSES, 'customer.create wechat_add_status', 'NOT_ADDED') ?? 'NOT_ADDED';
    const intent_level = optionalProductEnum(record.intent_level, INTENT_LEVELS, 'customer.create intent_level', 'UNKNOWN') ?? 'UNKNOWN';
    const phone_feedback = optionalProductEnum(record.phone_feedback, PHONE_FEEDBACKS, 'customer.create phone_feedback', null);
    const rough_visit_time_text = optionalProductString(record.rough_visit_time_text, 'customer.create rough_visit_time_text');
    const notes = optionalProductString(record.notes, 'customer.create notes');
    const website = optionalProductString(record.website, 'customer.create website');
    const region = optionalProductString(record.region, 'customer.create region');
    const industry = optionalProductString(record.industry, 'customer.create industry');
    const contact_person = optionalProductString(record.contact_person, 'customer.create contact_person');
    const email = optionalProductString(record.email, 'customer.create email');
    const address = optionalProductString(record.address, 'customer.create address');
    const pitch_angle = optionalProductString(record.pitch_angle, 'customer.create pitch_angle');
    const qualification_reason = optionalProductString(record.qualification_reason, 'customer.create qualification_reason');
    const source = optionalProductString(record.source, 'customer.create source');
    return {
      name,
      wechat_id,
      phone_number,
      contact_method,
      wechat_search_status,
      is_key_decision_maker,
      wechat_add_status,
      intent_level,
      phone_feedback,
      rough_visit_time_text,
      notes,
      website,
      region,
      industry,
      contact_person,
      email,
      address,
      pitch_angle,
      qualification_reason,
      source,
    };
  },
  handoff: (validatedInput: unknown): CapabilityConfirmationHandoff => {
    const input = validatedInput as CustomerCreateInput;
    // 创建前客户不存在：客户 id 在交接时生成（与 CustomerForm 提交时生成 id 一致），
    // 成为提案 customer_id 与确认后真实持久化的客户身份（§16 生成 id = 实际身份）。
    const newCustomerId = uuidv4();
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: newCustomerId,
      message: '创建客户',
      evidence_refs: [],
      created_at: now(),
      tool_id: 'create_customer',
      // proposed_values = 规范化后的 20 个人工表单字段（含产品默认值）——
      // 人工确认所见即所得，绝不携带系统/规则/领域字段。
      proposed_values: { ...input },
      reason: 'W4-1 统一执行确认交接（现有 confirmed-write 提案路径）。确认后将按现有产品"新增客户"语义创建客户：初始等级与跟进时间由产品规则计算；微信通过/意向度等字段按产品规则可能触发后续状态与任务。',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('customer.create'),
};

/* ------------------------------------------------------------------ */
/* 3.6) customer.profile.update — salesAgentWriteTool:update_customer_profile */
/*      （W4-2：唯一新增生产能力；scope=CUSTOMER；A10 REQUIRE_CONFIRMATION）   */
/* ------------------------------------------------------------------ */

/**
 * 校验后的 customer.profile.update 输入（部分更新；db 句柄 + 已提供的资料字段）。
 * 只有普通客户资料字段可进入；系统/规则/调度/战斗卡字段在此层即 fail closed。
 * 资料字段白名单与 CUSTOMER_PROFILE_UPDATE_KEYS（共享产品服务）一致。
 */
export interface CustomerProfileUpdateInput {
  readonly db: DatabaseLike;
  readonly name?: string;
  readonly wechat_id?: string | null;
  readonly phone_number?: string | null;
  readonly wechat_search_status?: WechatSearchStatus | null;
  readonly is_key_decision_maker?: 0 | 1;
  readonly contact_method?: ContactMethod | null;
  readonly notes?: string | null;
  readonly website?: string | null;
  readonly region?: string | null;
  readonly industry?: string | null;
  readonly contact_person?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly pitch_angle?: string | null;
  readonly qualification_reason?: string | null;
  readonly source?: string | null;
}

/** 输入允许键 = 16 个资料字段 + 执行句柄 db + 防御性客户选择字段（经相干校验后拒绝/放行）。 */
const CUSTOMER_PROFILE_UPDATE_INPUT_KEYS: readonly string[] = Object.freeze([
  ...CUSTOMER_PROFILE_UPDATE_KEYS,
  'db',
  ...CUSTOMER_SELECTOR_KEYS,
]);

/** 原型污染键：显式拒绝（与 confirmedWrite FORBIDDEN_PROTOTYPE_KEYS 同款；纵深防御）。 */
const FORBIDDEN_PROTOTYPE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

const customerProfileUpdateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:update_customer_profile',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): CustomerProfileUpdateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('customer.profile.update requires an object input with a db handle and profile fields.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    // 原型污染键显式 fail closed（Object.keys 之外的保护层；绝不 strip）。
    for (const key of FORBIDDEN_PROTOTYPE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new CapabilityInputValidationError(`customer.profile.update rejects forbidden key '${key}'.`);
      }
    }
    rejectUnknownFields(record, 'customer.profile.update', CUSTOMER_PROFILE_UPDATE_INPUT_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('customer.profile.update requires a DatabaseLike db handle (to read the stored current values for the proposal).');
    }
    const builder: Record<string, unknown> = { db: record.db as DatabaseLike };
    let profileFieldCount = 0;

    // name：编辑模式必填；未提供 → 不变。
    if (record.name !== undefined) {
      builder.name = requireString(record.name, 'customer.profile.update name');
      profileFieldCount += 1;
    }
    // 可选资料字符串：undefined → 不变；null/'' → null（CustomerForm `value || null` 清除语义）。
    const optionalProfileStringFields: ReadonlyArray<[string, string]> = [
      ['wechat_id', 'wechat_id'],
      ['phone_number', 'phone_number'],
      ['notes', 'notes'],
      ['website', 'website'],
      ['region', 'region'],
      ['industry', 'industry'],
      ['contact_person', 'contact_person'],
      ['email', 'email'],
      ['address', 'address'],
      ['pitch_angle', 'pitch_angle'],
      ['qualification_reason', 'qualification_reason'],
      ['source', 'source'],
    ];
    for (const [field, label] of optionalProfileStringFields) {
      if (record[field] !== undefined) {
        builder[field] = optionalProductString(record[field], `customer.profile.update ${label}`);
        profileFieldCount += 1;
      }
    }
    // 可选枚举：undefined → 不变；null/'' → null。
    if (record.wechat_search_status !== undefined) {
      builder.wechat_search_status = optionalProductEnum(
        record.wechat_search_status,
        WECHAT_SEARCH_STATUSES,
        'customer.profile.update wechat_search_status',
        null,
      );
      profileFieldCount += 1;
    }
    if (record.contact_method !== undefined) {
      builder.contact_method = optionalProductEnum(
        record.contact_method,
        CONTACT_METHODS,
        'customer.profile.update contact_method',
        null,
      );
      profileFieldCount += 1;
    }
    // is_key_decision_maker：产品表示 0/1（编辑模式 select 仅 0/1；无清除语义）。
    if (record.is_key_decision_maker !== undefined) {
      const rawKeyDm = record.is_key_decision_maker;
      if (rawKeyDm !== 0 && rawKeyDm !== 1) {
        throw new CapabilityInputValidationError('customer.profile.update is_key_decision_maker must be 0 or 1.');
      }
      builder.is_key_decision_maker = rawKeyDm as 0 | 1;
      profileFieldCount += 1;
    }

    // 空 patch fail closed（§9）：至少一个资料字段。
    if (profileFieldCount === 0) {
      throw new CapabilityInputValidationError('customer.profile.update requires at least one profile field (empty patch).');
    }
    return builder as unknown as CustomerProfileUpdateInput;
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as CustomerProfileUpdateInput;
    const customerId = requireCustomerScope(scope);
    // 现有产品语义（currentValuesForTool）：提案必须携带客户当前存储值（before 侧），
    // 且目标客户必须已存在（§8：未知客户 → truthful failure，零写入，绝不 upsert）。
    const rows = await input.db.select<Record<string, unknown>>(
      'SELECT * FROM customers WHERE id = ?',
      [customerId],
    );
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`customer.profile.update scope customer does not exist: ${customerId}`);
    }
    const row = rows[0] ?? {};
    const inputRecord = input as unknown as Record<string, unknown>;
    const current_values: Record<string, unknown> = {};
    const proposed_values: Record<string, unknown> = {};
    for (const key of CUSTOMER_PROFILE_UPDATE_KEYS) {
      if (inputRecord[key] !== undefined) {
        current_values[key] = row[key] ?? null;
        proposed_values[key] = inputRecord[key];
      }
    }
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '更新客户资料',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'update_customer_profile',
      current_values,
      proposed_values,
      reason: 'W4-2 统一执行确认交接（现有 confirmed-write 提案路径）。仅普通资料字段变更，绝不携带等级/阶段/支付/调度/战斗卡等规则或系统字段；确认后按人工编辑客户资料的同一产品语义仅更新资料字段，不触发任何规则/状态迁移/任务。',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('customer.profile.update'),
};

/* ------------------------------------------------------------------ */
/* 3.6b) customer.opportunity_amount.update —                          */
/*       salesAgentWriteTool:update_opportunity_amount                 */
/*       （C0：唯一新增窄义商机金额写能力；scope=CUSTOMER；CONFIRM）      */
/* ------------------------------------------------------------------ */

/**
 * 校验后的 customer.opportunity_amount.update 输入（db 句柄 + 单字段值）。
 * 值只允许：有限正数（记录期望商业金额）或 null（显式清除为 unknown）。
 * 客户身份只来自 invocation.scope；绝不携带 customer_id / customerId 目标身份。
 */
export interface CustomerOpportunityAmountUpdateInput {
  readonly db: DatabaseLike;
  readonly opportunity_amount: number | null;
}

/** 输入允许键 = 执行句柄 db + 单字段 opportunity_amount + 防御性客户选择字段。 */
const CUSTOMER_OPPORTUNITY_AMOUNT_UPDATE_INPUT_KEYS: readonly string[] = Object.freeze([
  'db',
  'opportunity_amount',
  ...CUSTOMER_SELECTOR_KEYS,
]);

/** 商机金额值护栏（Layer 1）：有限正数 或 null（unknown/清除）；其余 fail closed。 */
function requireOpportunityAmount(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new CapabilityInputValidationError(`${field} must be a finite positive number or null (unknown).`);
  }
  return value;
}

const customerOpportunityAmountUpdateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:update_opportunity_amount',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): CustomerOpportunityAmountUpdateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('customer.opportunity_amount.update requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    // 原型污染键显式 fail closed（与 profile.update 同款；纵深防御）。
    for (const key of FORBIDDEN_PROTOTYPE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new CapabilityInputValidationError(`customer.opportunity_amount.update rejects forbidden key '${key}'.`);
      }
    }
    rejectUnknownFields(record, 'customer.opportunity_amount.update', CUSTOMER_OPPORTUNITY_AMOUNT_UPDATE_INPUT_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('customer.opportunity_amount.update requires a DatabaseLike db handle (to read the stored current value for the proposal).');
    }
    if (!Object.prototype.hasOwnProperty.call(record, 'opportunity_amount')) {
      throw new CapabilityInputValidationError('customer.opportunity_amount.update requires the opportunity_amount field.');
    }
    const opportunity_amount = requireOpportunityAmount(record.opportunity_amount, 'customer.opportunity_amount.update opportunity_amount');
    return { db: record.db as DatabaseLike, opportunity_amount };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as CustomerOpportunityAmountUpdateInput;
    const customerId = requireCustomerScope(scope);
    // 现有产品语义（currentValuesForTool）：提案必须携带客户当前存储值（before 侧），
    // 且目标客户必须已存在（未知客户 → truthful failure，零写入，绝不 upsert）。
    const rows = await input.db.select<{ opportunity_amount: number | null }>(
      'SELECT opportunity_amount FROM customers WHERE id = ?',
      [customerId],
    );
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`customer.opportunity_amount.update scope customer does not exist: ${customerId}`);
    }
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '更新商机金额',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'update_opportunity_amount',
      current_values: { opportunity_amount: rows[0]?.opportunity_amount ?? null },
      proposed_values: { opportunity_amount: input.opportunity_amount },
      reason: 'C0 统一执行确认交接（现有 confirmed-write 提案路径）。仅更新 opportunity_amount（用户确认/显式记录的期望商业金额；null=unknown），绝不触发规则/状态迁移/任务，绝不写入 deal_amount 或任何其它列。',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('customer.opportunity_amount.update'),
};

/* ------------------------------------------------------------------ */
/* 3.7) customer.delete — salesAgentWriteTool:delete_customer          */
/*      （W4-4：唯一新增生产能力；scope=CUSTOMER；A10 REQUIRE_STRONG_CONFIRMATION） */
/* ------------------------------------------------------------------ */

/** 校验后的 customer.delete 输入：只含执行句柄 db（客户身份只来自 invocation.scope）。 */
export interface CustomerDeleteInput {
  readonly db: DatabaseLike;
}

/** 输入允许键 = 执行句柄 db + 防御性客户选择字段（经相干校验后拒绝/放行）。 */
const CUSTOMER_DELETE_INPUT_KEYS: readonly string[] = Object.freeze([
  'db',
  ...CUSTOMER_SELECTOR_KEYS,
]);

const customerDeleteBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:delete_customer',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): CustomerDeleteInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('customer.delete requires an object input with a db handle.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    // 原型污染键显式 fail closed（与 profile.update 同款；纵深防御）。
    for (const key of FORBIDDEN_PROTOTYPE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new CapabilityInputValidationError(`customer.delete rejects forbidden key '${key}'.`);
      }
    }
    rejectUnknownFields(record, 'customer.delete', CUSTOMER_DELETE_INPUT_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('customer.delete requires a DatabaseLike db handle (to read the bounded display summary for the proposal).');
    }
    return { db: record.db as DatabaseLike };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as CustomerDeleteInput;
    const customerId = requireCustomerScope(scope);
    // 未知客户 → 交接前 fail closed（truthful failure，零写入，绝不删除另一个客户）。
    // 只读 name 作为 bounded 展示摘要（不序列化整行客户快照、不扩大 PII）。
    const rows = await input.db.select<{ name: string }>(
      'SELECT name FROM customers WHERE id = ?',
      [customerId],
    );
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`customer.delete scope customer does not exist: ${customerId}`);
    }
    const displayName = typeof rows[0]?.name === 'string' ? rows[0].name : '';
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '删除客户',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'delete_customer',
      operation: 'delete',
      reversible: false,
      // current_values 携带 bounded 展示摘要（仅 name）：人工确认所见即"将被永久删除的客户"。
      current_values: { customer_name: displayName },
      // 硬删除后无剩余字段（proposed_values 合法为空）。
      proposed_values: {},
      reason: 'W4-4 统一执行确认交接（现有 confirmed-write 提案路径）。这是硬删除（不可逆）：确认后将按现有产品"删除客户"同一路径（db.deleteCustomer）永久删除该客户及其 follow_up_records / visit_records / tasks / customer_stage_cards / customer_hypotheses / reviewed_facts / intelligence_imports 级联记录；产品无回收站/回滚/tombstone。',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('customer.delete'),
};

/* ------------------------------------------------------------------ */
/* 3.8) visit.create — salesAgentWriteTool:create_visit_record          */
/*      （W4-3：唯一新增生产能力；scope=CUSTOMER；A10 REQUIRE_CONFIRMATION）*/
/* ------------------------------------------------------------------ */

/**
 * 校验后的 visit.create 输入（db 句柄用于交接前证明目标客户存在；title 必填；
 * 其余 6 个面访字段可选，空值 → null）。面访结论/意向/下一步动作枚举在绑定层
 * 即闭合校验；系统派生字段（visited_at / id / created_at / updated_at）绝不进入输入。
 */
export interface VisitCreateInput {
  readonly db: DatabaseLike;
  readonly title: string;
  readonly visit_notes: string | null;
  readonly customer_concerns: string | null;
  readonly intent_after_visit: IntentLevel | null;
  readonly visit_outcome: VisitOutcome | null;
  /** 下一步动作（人工面访表单 6 项子集；非完整 NextAction）。 */
  readonly next_action: string | null;
  /** 预计签约时间（YYYY-MM-DD，来自人工表单 `<input type="date">`）。 */
  readonly expected_contract_at: string | null;
}

/** 输入允许键 = db 执行句柄 + 7 个面访表单字段 + 防御性客户选择字段（经相干校验后拒绝/放行）。 */
const VISIT_CREATE_INPUT_KEYS_WITH_SELECTORS: readonly string[] = Object.freeze([
  'db',
  ...VISIT_CREATE_INPUT_KEYS,
  ...CUSTOMER_SELECTOR_KEYS,
]);

/** 可选面访日期字段：undefined/null/'' → null；否则必须是 YYYY-MM-DD 有效日历日期。 */
function optionalVisitDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new CapabilityInputValidationError(`${field} must be a string when present.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CapabilityInputValidationError(`${field} must be a YYYY-MM-DD date string.`);
  }
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  // 回环校验：拒绝 JavaScript Date 会把非法日期（如 2026-02-30 / 2026-13-40）归一化的情形。
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new CapabilityInputValidationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

const visitCreateBinding: CapabilityExecutorBinding = {
  executor_ref: 'salesAgentWriteTool:create_visit_record',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): VisitCreateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('visit.create requires an object input with the visit form fields.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    // 原型污染键显式 fail closed（Object.keys 之外的保护层；绝不 strip）。
    for (const key of FORBIDDEN_PROTOTYPE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new CapabilityInputValidationError(`visit.create rejects forbidden key '${key}'.`);
      }
    }
    rejectUnknownFields(record, 'visit.create', VISIT_CREATE_INPUT_KEYS_WITH_SELECTORS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('visit.create requires a DatabaseLike db handle (to prove the scope customer exists before handoff).');
    }
    const title = requireString(record.title, 'visit.create title');
    const visit_notes = optionalProductString(record.visit_notes, 'visit.create visit_notes');
    const customer_concerns = optionalProductString(record.customer_concerns, 'visit.create customer_concerns');
    const intent_after_visit = optionalProductEnum(record.intent_after_visit, INTENT_LEVELS, 'visit.create intent_after_visit', null);
    const visit_outcome = optionalProductEnum(record.visit_outcome, VISIT_OUTCOMES, 'visit.create visit_outcome', null);
    const next_action = optionalProductEnum(record.next_action, VISIT_NEXT_ACTIONS, 'visit.create next_action', null);
    const expected_contract_at = optionalVisitDate(record.expected_contract_at, 'visit.create expected_contract_at');
    return {
      db: record.db as DatabaseLike,
      title,
      visit_notes,
      customer_concerns,
      intent_after_visit,
      visit_outcome,
      next_action,
      expected_contract_at,
    };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as VisitCreateInput;
    const customerId = requireCustomerScope(scope);
    // 目标客户必须已存在（§8）：未知客户 → truthful failure（INVALID_INPUT），
    // 零提案注册、零写入，绝不 upsert / create。
    const rows = await input.db.select<{ id: string }>('SELECT id FROM customers WHERE id = ?', [customerId]);
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`visit.create scope customer does not exist: ${customerId}`);
    }
    const proposal = registerCanonicalProposal(buildWriteProposal({
      customer_id: customerId,
      message: '新增面访记录',
      evidence_refs: [`customer:${customerId}`],
      created_at: now(),
      tool_id: 'create_visit_record',
      // proposed_values = 规范化后的 7 个人工面访表单字段（空值 → null）——
      // 人工确认所见即所得，绝不携带系统派生字段（id/visited_at/created_at/updated_at）。
      proposed_values: {
        title: input.title,
        visit_notes: input.visit_notes,
        customer_concerns: input.customer_concerns,
        intent_after_visit: input.intent_after_visit,
        visit_outcome: input.visit_outcome,
        next_action: input.next_action,
        expected_contract_at: input.expected_contract_at,
      },
      reason: 'W4-3 统一执行确认交接（现有 confirmed-write 提案路径）。确认后将按现有产品"新增面访记录"语义创建面访记录：系统派生 visited_at/created_at/updated_at；若 visit_outcome 非空，还将按面访结论规则更新客户状态（等级/阶段/下一步/下次跟进，与人工面访路径一致，不创建任务）。',
    }));
    return { mechanism: SALES_AGENT_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('visit.create'),
};

/* ------------------------------------------------------------------ */
/* 4) battle_card.draft.create — battleCard:generateStageCardDraft      */
/*    （唯一 AUTO 写；execute 调用真实产品草稿执行器）                     */
/* ------------------------------------------------------------------ */

export interface BattleCardDraftCreateInput {
  readonly db: DatabaseLike;
  readonly stage_code: CustomerStage;
  readonly clock?: () => string;
}

const BATTLE_CARD_DRAFT_CREATE_KEYS: readonly string[] = ['db', 'stage_code', 'clock', ...CUSTOMER_SELECTOR_KEYS];

const battleCardDraftCreateBinding: CapabilityExecutorBinding = {
  executor_ref: 'battleCard:generateStageCardDraft',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): BattleCardDraftCreateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('battle_card.draft.create requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'battle_card.draft.create', BATTLE_CARD_DRAFT_CREATE_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('battle_card.draft.create requires a DatabaseLike db handle.');
    }
    const stageCode = record.stage_code;
    if (typeof stageCode !== 'string' || !CUSTOMER_STAGES.includes(stageCode)) {
      throw new CapabilityInputValidationError(`battle_card.draft.create stage_code must be one of: ${CUSTOMER_STAGES.join(', ')}.`);
    }
    return { db: record.db as DatabaseLike, stage_code: stageCode as CustomerStage, clock: optionalClock(record.clock) };
  },
  // A10=ALLOW_AUTO：真实产品草稿执行器（append-only DRAFT；不确认卡片、不改指针）。
  execute: async (validatedInput: unknown, scope: CapabilityInvocationScope) => {
    const input = validatedInput as BattleCardDraftCreateInput;
    const customerId = requireCustomerScope(scope);
    const tools = createBattleCardAgentTools({ db: input.db, clock: input.clock });
    return tools.generateStageCardDraft(customerId, input.stage_code);
  },
};

/* ------------------------------------------------------------------ */
/* 5) battle_card.confirm — battleCard:confirmStageCard                 */
/* ------------------------------------------------------------------ */

export interface BattleCardConfirmInput {
  readonly db: DatabaseLike;
  readonly card_id: string;
  readonly expected_version: number;
  readonly clock?: () => string;
}

const BATTLE_CARD_CONFIRM_KEYS: readonly string[] = ['db', 'card_id', 'expected_version', 'clock', ...CUSTOMER_SELECTOR_KEYS];

const battleCardConfirmBinding: CapabilityExecutorBinding = {
  executor_ref: 'battleCard:confirmStageCard',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): BattleCardConfirmInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('battle_card.confirm requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'battle_card.confirm', BATTLE_CARD_CONFIRM_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('battle_card.confirm requires a DatabaseLike db handle.');
    }
    const card_id = requireString(record.card_id, 'battle_card.confirm card_id');
    const expected_version = record.expected_version;
    if (typeof expected_version !== 'number' || !Number.isFinite(expected_version)) {
      throw new CapabilityInputValidationError('battle_card.confirm expected_version must be a finite number.');
    }
    return { db: record.db as DatabaseLike, card_id, expected_version, clock: optionalClock(record.clock) };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as BattleCardConfirmInput;
    const customerId = requireCustomerScope(scope);
    // 客户所有权证明：不允许 card_id 单独绕过客户所有权（§21）。
    const rows = await input.db.select<{ customer_id: string }>(
      'SELECT customer_id FROM customer_stage_cards WHERE id = ?',
      [input.card_id],
    );
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`battle_card.confirm card does not exist: ${input.card_id}`);
    }
    if (rows[0]?.customer_id !== customerId) {
      throw new CapabilityInputValidationError(
        `battle_card.confirm card ${input.card_id} belongs to customer ${rows[0]?.customer_id}, not scope customer ${customerId}; refusing to hand off.`,
      );
    }
    const proposal = await createBattleCardAgentTools({ db: input.db, clock: input.clock })
      .proposeConfirmStageCard({
        customer_id: customerId,
        card_id: input.card_id,
        expected_version: input.expected_version,
        created_at: input.clock ? input.clock() : now(),
      });
    return { mechanism: BATTLE_CARD_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('battle_card.confirm'),
};

/* ------------------------------------------------------------------ */
/* 6) battle_card.hypothesis.status.update —                           */
/*    battleCard:updateHypothesisStatus                                */
/* ------------------------------------------------------------------ */

export interface BattleCardHypothesisStatusUpdateInput {
  readonly db: DatabaseLike;
  readonly hypothesis_id: string;
  readonly new_status: HypothesisStatus;
  readonly reason: string | null;
  readonly expected_version: string;
  readonly clock?: () => string;
}

const BATTLE_CARD_HYPOTHESIS_UPDATE_KEYS: readonly string[] = ['db', 'hypothesis_id', 'new_status', 'reason', 'expected_version', 'clock', ...CUSTOMER_SELECTOR_KEYS];

const battleCardHypothesisStatusUpdateBinding: CapabilityExecutorBinding = {
  executor_ref: 'battleCard:updateHypothesisStatus',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): BattleCardHypothesisStatusUpdateInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('battle_card.hypothesis.status.update requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'battle_card.hypothesis.status.update', BATTLE_CARD_HYPOTHESIS_UPDATE_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('battle_card.hypothesis.status.update requires a DatabaseLike db handle.');
    }
    const hypothesis_id = requireString(record.hypothesis_id, 'battle_card.hypothesis.status.update hypothesis_id');
    const new_status = record.new_status;
    if (typeof new_status !== 'string' || !HYPOTHESIS_STATUSES.includes(new_status as HypothesisStatus)) {
      throw new CapabilityInputValidationError(`battle_card.hypothesis.status.update new_status must be one of: ${HYPOTHESIS_STATUSES.join(', ')}.`);
    }
    const reason = optionalString(record.reason, 'battle_card.hypothesis.status.update reason');
    const expected_version = requireString(record.expected_version, 'battle_card.hypothesis.status.update expected_version');
    return {
      db: record.db as DatabaseLike,
      hypothesis_id,
      new_status: new_status as HypothesisStatus,
      reason,
      expected_version,
      clock: optionalClock(record.clock),
    };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as BattleCardHypothesisStatusUpdateInput;
    const customerId = requireCustomerScope(scope);
    // 客户所有权证明：不允许 hypothesis_id 单独绕过客户所有权（§21）。
    const rows = await input.db.select<{ customer_id: string }>(
      'SELECT customer_id FROM customer_hypotheses WHERE id = ?',
      [input.hypothesis_id],
    );
    if (rows.length === 0) {
      throw new CapabilityInputValidationError(`battle_card.hypothesis.status.update hypothesis does not exist: ${input.hypothesis_id}`);
    }
    if (rows[0]?.customer_id !== customerId) {
      throw new CapabilityInputValidationError(
        `battle_card.hypothesis.status.update hypothesis ${input.hypothesis_id} belongs to customer ${rows[0]?.customer_id}, not scope customer ${customerId}; refusing to hand off.`,
      );
    }
    const proposal = await createBattleCardAgentTools({ db: input.db, clock: input.clock })
      .proposeUpdateHypothesisStatus({
        customer_id: customerId,
        hypothesis_id: input.hypothesis_id,
        new_status: input.new_status,
        reason: input.reason,
        expected_version: input.expected_version,
        created_at: input.clock ? input.clock() : now(),
      });
    return { mechanism: BATTLE_CARD_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('battle_card.hypothesis.status.update'),
};

/* ------------------------------------------------------------------ */
/* 7) battle_card.intelligence_import.confirm —                        */
/*    battleCard:confirmIntelligenceImport（BULK_WRITE / 强确认）        */
/* ------------------------------------------------------------------ */

export interface BattleCardIntelligenceImportConfirmInput {
  readonly db: DatabaseLike;
  readonly raw_content: string;
  readonly keep_fact_ids: readonly string[];
  readonly keep_hypothesis_ids: readonly string[];
  readonly fact_overrides: Readonly<Record<string, unknown>>;
  readonly fact_verifications: readonly FactVerificationItem[];
  readonly source_system: string | null;
  readonly clock?: () => string;
}

const BATTLE_CARD_IMPORT_CONFIRM_KEYS: readonly string[] = ['db', 'raw_content', 'keep_fact_ids', 'keep_hypothesis_ids', 'fact_overrides', 'fact_verifications', 'source_system', 'clock', ...CUSTOMER_SELECTOR_KEYS];

const battleCardIntelligenceImportConfirmBinding: CapabilityExecutorBinding = {
  executor_ref: 'battleCard:confirmIntelligenceImport',
  validateInput: (input: unknown, scope: CapabilityInvocationScope): BattleCardIntelligenceImportConfirmInput => {
    if (!isPlainObject(input)) {
      throw new CapabilityInputValidationError('battle_card.intelligence_import.confirm requires an object input.');
    }
    assertCustomerSelectorCoherent(input, scope);
    const record = input as Record<string, unknown>;
    rejectUnknownFields(record, 'battle_card.intelligence_import.confirm', BATTLE_CARD_IMPORT_CONFIRM_KEYS);
    if (!isDatabaseLike(record.db)) {
      throw new CapabilityInputValidationError('battle_card.intelligence_import.confirm requires a DatabaseLike db handle.');
    }
    const raw_content = requireRawContent(record.raw_content, 'battle_card.intelligence_import.confirm raw_content');
    const keep_fact_ids = requireStringArray(record.keep_fact_ids, 'battle_card.intelligence_import.confirm keep_fact_ids');
    const keep_hypothesis_ids = requireStringArray(record.keep_hypothesis_ids, 'battle_card.intelligence_import.confirm keep_hypothesis_ids');
    const fact_overrides = record.fact_overrides === undefined ? {} : record.fact_overrides;
    if (!isPlainObject(fact_overrides)) {
      throw new CapabilityInputValidationError('battle_card.intelligence_import.confirm fact_overrides must be a plain object when present.');
    }
    // 闭合运行时 Schema（现有权威校验；与提案构造/确认同一版本）。
    const fact_verifications = parseFactVerificationsRuntime(record.fact_verifications);
    const source_system = optionalString(record.source_system, 'battle_card.intelligence_import.confirm source_system');
    return {
      db: record.db as DatabaseLike,
      raw_content,
      keep_fact_ids,
      keep_hypothesis_ids,
      fact_overrides: fact_overrides as Readonly<Record<string, unknown>>,
      fact_verifications,
      source_system,
      clock: optionalClock(record.clock),
    };
  },
  handoff: async (validatedInput: unknown, scope: CapabilityInvocationScope): Promise<CapabilityConfirmationHandoff> => {
    const input = validatedInput as BattleCardIntelligenceImportConfirmInput;
    const customerId = requireCustomerScope(scope);
    // 客户来自 scope（无 by-ID 目标可绕过）；产品向导/agent 工具均以 customer_id 绑定。
    const proposal = await createBattleCardAgentTools({ db: input.db, clock: input.clock })
      .proposeConfirmIntelligenceImport({
        customer_id: customerId,
        raw_content: input.raw_content,
        keep_fact_ids: input.keep_fact_ids,
        keep_hypothesis_ids: input.keep_hypothesis_ids,
        fact_overrides: input.fact_overrides as ConfirmImportDecisions['fact_overrides'],
        fact_verifications: input.fact_verifications,
        source_system: input.source_system ?? undefined,
        created_at: input.clock ? input.clock() : now(),
      });
    return { mechanism: BATTLE_CARD_CONFIRMATION_MECHANISM, proposal_id: proposal.proposal_id };
  },
  execute: () => refuseBusinessExecutor('battle_card.intelligence_import.confirm'),
};

/* ------------------------------------------------------------------ */
/* 生产写绑定集合（12 项；W3-3 七项 + W4-1 customer.create + W4-2      */
/* customer.profile.update + W4-4 customer.delete + W4-3 visit.create； */
/* + C0 customer.opportunity_amount.update；供 production.ts 组合；冻结数组） */
/* ------------------------------------------------------------------ */

export const PRODUCTION_WRITE_BINDINGS: readonly CapabilityExecutorBinding[] = Object.freeze([
  Object.freeze(followUpCreateBinding),
  Object.freeze(taskCreateBinding),
  Object.freeze(customerNextFollowUpTimeUpdateBinding),
  Object.freeze(customerCreateBinding),
  Object.freeze(customerProfileUpdateBinding),
  Object.freeze(customerOpportunityAmountUpdateBinding),
  Object.freeze(customerDeleteBinding),
  Object.freeze(visitCreateBinding),
  Object.freeze(battleCardDraftCreateBinding),
  Object.freeze(battleCardConfirmBinding),
  Object.freeze(battleCardHypothesisStatusUpdateBinding),
  Object.freeze(battleCardIntelligenceImportConfirmBinding),
]);
