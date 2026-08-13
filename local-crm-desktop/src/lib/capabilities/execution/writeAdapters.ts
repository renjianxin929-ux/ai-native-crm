/**
 * V0.2A / W3-1 Closure 1 — Production Write Adapters（生产写绑定 + 确认交接适配器）。
 *
 * 本模块是 GAP-B / GAP-C / GAP-F 的执行侧实现：为七个 W3-3 冻结写能力提供
 * 真实、权威优先、确认安全的 W3-1 生产绑定：
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
import type { CustomerStage } from '../../types';
import type { CapabilityExecutorBinding } from './binding';
import {
  CapabilityInputValidationError,
  type CapabilityConfirmationHandoff,
  type CapabilityInvocationScope,
} from './contract';
import { buildWriteProposal, parseFactVerificationsRuntime, MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES, type FactVerificationItem } from '../../salesAgentTools/confirmedWrite';
import { registerCanonicalProposal } from '../../salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../../salesAgentTools/appClock';
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
/* 生产写绑定集合（7 项；供 production.ts 组合；冻结数组）                 */
/* ------------------------------------------------------------------ */

export const PRODUCTION_WRITE_BINDINGS: readonly CapabilityExecutorBinding[] = Object.freeze([
  Object.freeze(followUpCreateBinding),
  Object.freeze(taskCreateBinding),
  Object.freeze(customerNextFollowUpTimeUpdateBinding),
  Object.freeze(battleCardDraftCreateBinding),
  Object.freeze(battleCardConfirmBinding),
  Object.freeze(battleCardHypothesisStatusUpdateBinding),
  Object.freeze(battleCardIntelligenceImportConfirmBinding),
]);
