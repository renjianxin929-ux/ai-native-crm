/**
 * V0.2A / W3-2 — Capability Observation / Audit Event Contract (types + validation).
 *
 * 本模块回答架构问题："Capability 执行生命周期可观察、可审计所需的最小
 * 结构化事件语义是什么？" 它只定义：事件词汇 + 事件结构 + fail-closed 校验
 * + 不可变构造。不实现持久化、查询、审计 UI、执行、planner 或 Agent 运行时。
 *
 * ── 锁定边界（OBSERVATION != PERSISTENCE / EXECUTION）──────────────────
 * - 不持久化：无 SQLite / 文件 / 网络 / 遥测 / HTTP sink。
 * - 不执行：无 executor / DB / 模型 / provider 调用（EXECUTOR_CALLS=0）。
 * - 不决定后续动作：观察是被动基础设施，不含 planner / 工具选择 / Agent loop。
 * - 无 UI / 无查询 / 无保留策略 / 无审计存储。
 *
 * ── PII / 载荷最小化 ──────────────────────────────────────────────────
 * 事件只携带结构化元数据（调用关联 / 身份 / 范围 / 授权 / 确认 / 结果 / 错误类别）。
 * 事件结构中没有 payload 字段；构造时白名单外的任何键（raw notes / prompt /
 * model response / spreadsheet rows / secrets / stack ...）一律被拒绝
 * （INVALID_EVENT，fail closed）。事件 ID 采用本地单调序列，不依赖网络/UUID 服务。
 *
 * ── 生命周期关联（invocation_id）──────────────────────────────────────
 * invocation_id 标识"一次被尝试的 Capability 调用"：同一调用产生的全部生命周期
 * 事件（INVOCATION_STARTED → AUTHORITY_DECIDED → CONFIRMATION_REQUIRED /
 * AUTONOMY_DENIED → EXECUTION_COMPLETED / EXECUTION_FAILED）必须保留相同的
 * invocation_id；event_id 保持每个事件唯一。关系：一个 invocation_id → 一个或多个
 * 唯一 event_id。invocation_id 由执行集成层显式提供：不生成、不从能力身份 / 客户
 * 身份 / 时间戳推断，缺失 / 空串 / 非字符串 fail closed（INVALID_INVOCATION_ID）。
 * 并发场景：同能力同范围的多次调用以不同 invocation_id 区分，事件不会相互混淆。
 * 本契约不引入分布式追踪 / span / OpenTelemetry / 会话框架。
 *
 * ── 时间戳信任边界（仅文档化）─────────────────────────────────────────
 * timestamp 是生命周期事件元数据：ISO 有效性只保证"格式与可解析性"，不证明可信
 * 墙钟来源。W3-1 / 未来执行集成应在可信本地执行边界提供 timestamp；本模块不构建
 * 时钟基础设施、不校验墙钟真实性（无新不安全行为）。
 *
 * ── 与 A1 audit_contract 的关系（A1_AUDIT_CONTRACT_RELATIONSHIP）────────
 * - A1 CapabilityAuditContract（audit_required / record_input / record_output /
 *   record_effect）是冻结定义上的"声明式审计需求"元数据，本模块不修改、不复制进事件。
 * - W3-2 事件以 capability_id + capability_version 精确引用定义，audit_contract
 *   可按身份解析（未来持久化层按它决定记录范围）。
 * - A1 audit_contract 不含 event_name / records_scope / records_result /
 *   records_error 等字段（仅 4 个布尔），故没有可逐字段复用的语义字段。
 * - 即使某能力 audit_contract.record_input=true（如 import.file.preview），
 *   W3-2 事件也不携带原始输入/输出——事件契约与"按 audit_contract 记录内容"分离。
 *
 * ── 复用冻结词汇（不发明第二套枚举）────────────────────────────────────
 * - 范围：复用 A1 CapabilityScopeRequirement（GLOBAL | CUSTOMER | NONE）。
 * - 授权：复用 A10 AuthorityDecisionKind / AuthorityDecisionReason（含运行时常量表）。
 *
 * ── 确认语义（区分"授权要求确认"与"人工确认已完成"）──────────────────────
 * - 授权层状态：NOT_REQUIRED / REQUIRED / STRONG_REQUIRED（由决策派生，防篡改）。
 * - 人工完成状态：CONFIRMED（仅可显式出现在 EXECUTION_* 事件，且决策必须是确认类）。
 * - 保留词汇：REJECTED / CANCELLED 属于未来 handoff 词汇，W3-2 不发出（fail-closed，
 *   任何 W3-2 事件类型都无法如实承载"人工否决"这一独立阶段）。
 */

import {
  AUTHORITY_DECISION_KINDS,
  AUTHORITY_DECISION_REASONS,
  type AuthorityDecisionKind,
  type AuthorityDecisionReason,
} from '../authority/types';
import type { CapabilityScopeRequirement } from '../types';

/* ------------------------------------------------------------------ */
/* 词汇（类型联合 + 运行时常量表；与冻结的 A1/A10 词汇保持一致）           */
/* ------------------------------------------------------------------ */

/**
 * 生命周期事件类型（最小集合，刻意不扩展）。
 * - INVOCATION_STARTED：调用开始（尚无授权决策）。
 * - AUTHORITY_DECIDED：授权决策产出（ALLOW_AUTO / REQUIRE_CONFIRMATION /
 *   REQUIRE_STRONG_CONFIRMATION / DENY_AUTONOMOUS 均可）。
 * - CONFIRMATION_REQUIRED：确认要求显式化（决策必须是确认类）。
 * - AUTONOMY_DENIED：自主执行被拒绝（决策必须是 DENY_AUTONOMOUS；不是执行错误）。
 * - EXECUTION_COMPLETED：执行成功结束。
 * - EXECUTION_FAILED：执行失败（携带稳定错误类别）。
 */
export type ObservationEventType =
  | 'INVOCATION_STARTED'
  | 'AUTHORITY_DECIDED'
  | 'CONFIRMATION_REQUIRED'
  | 'AUTONOMY_DENIED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED';

/** 观察范围类型：复用 A1 CapabilityScopeRequirement 词汇，不发明 RBAC/组织范围。 */
export type ObservationScopeType = CapabilityScopeRequirement;

/**
 * 确认生命周期状态（模型词汇；W3-2 只发出前四种可如实承载的状态）。
 * - NOT_REQUIRED：不要求确认。
 * - REQUIRED / STRONG_REQUIRED：授权要求（普通/强）确认。
 * - CONFIRMED：人工确认已完成（仅 EXECUTION_* 事件可显式携带）。
 * - REJECTED / CANCELLED：保留词汇（未来 handoff），W3-2 不发出。
 */
export type ObservationConfirmationState =
  | 'NOT_REQUIRED'
  | 'REQUIRED'
  | 'STRONG_REQUIRED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED';

/** 执行结果状态（小集合；由事件类型派生，防篡改）。 */
export type ObservationResultStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'NOT_EXECUTED';

/**
 * 稳定错误类别（小集合；不定义领域错误清单，不暴露原始 stack / message）。
 * - CAPABILITY_NOT_FOUND / INVALID_INPUT / INVALID_SCOPE：调用/输入/范围层。
 * - AUTHORITY_DENIED：执行期因授权被拒而失败（区别于 AUTONOMY_DENIED 决策事件）。
 * - EXECUTOR_NOT_BOUND：执行器未绑定。
 * - EXECUTOR_ERROR：执行器内部错误（兜底类别）。
 */
export type ObservationErrorCode =
  | 'CAPABILITY_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_SCOPE'
  | 'AUTHORITY_DENIED'
  | 'EXECUTOR_NOT_BOUND'
  | 'EXECUTOR_ERROR';

/** ISO-8601 时间戳（带时区偏移或 Z），与项目 AppClock 序列化惯例一致。 */
export type ObservationTimestamp = string;

export const OBSERVATION_EVENT_TYPES: readonly ObservationEventType[] = Object.freeze([
  'INVOCATION_STARTED',
  'AUTHORITY_DECIDED',
  'CONFIRMATION_REQUIRED',
  'AUTONOMY_DENIED',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
]);

export const OBSERVATION_SCOPE_TYPES: readonly ObservationScopeType[] = Object.freeze([
  'GLOBAL',
  'CUSTOMER',
  'NONE',
]);

export const OBSERVATION_CONFIRMATION_STATES: readonly ObservationConfirmationState[] = Object.freeze([
  'NOT_REQUIRED',
  'REQUIRED',
  'STRONG_REQUIRED',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
]);

export const OBSERVATION_RESULT_STATUSES: readonly ObservationResultStatus[] = Object.freeze([
  'SUCCESS',
  'FAILED',
  'NOT_EXECUTED',
]);

export const OBSERVATION_ERROR_CODES: readonly ObservationErrorCode[] = Object.freeze([
  'CAPABILITY_NOT_FOUND',
  'INVALID_INPUT',
  'INVALID_SCOPE',
  'AUTHORITY_DENIED',
  'EXECUTOR_NOT_BOUND',
  'EXECUTOR_ERROR',
]);

/* ------------------------------------------------------------------ */
/* 事件结构                                                             */
/* ------------------------------------------------------------------ */

/**
 * 统一 Capability 生命周期观察事件（最小结构化字段）。
 * 所有字段只读；运行时经规范化构造后深度冻结，杜绝事后变异。
 */
export interface ObservationEvent {
  /** 事件标识（本地单调序列或调用方显式提供；同一 emitter 内唯一）。 */
  readonly event_id: string;
  /**
   * 调用关联标识：标识"一次被尝试的 Capability 调用"。
   * 一次 invocation_id 对应一个或多个唯一 event_id；同一调用的所有生命周期事件
   * 必须保留相同的 invocation_id。由执行集成层显式提供，本模块不生成、不从
   * capability_id / scope_id / timestamp 推断。
   */
  readonly invocation_id: string;
  /** 生命周期事件类型。 */
  readonly event_type: ObservationEventType;
  /** 显式时间戳（ISO-8601）。 */
  readonly timestamp: ObservationTimestamp;
  /** 能力身份：id（精确保留）。 */
  readonly capability_id: string;
  /** 能力身份：version（精确保留）。 */
  readonly capability_version: string;
  /** 实际调用范围（GLOBAL / CUSTOMER / NONE）。 */
  readonly scope_type: ObservationScopeType;
  /** 范围 id：仅 CUSTOMER 非空；GLOBAL / NONE 恒为 null（不伪造客户身份）。 */
  readonly scope_id: string | null;
  /** 执行器引用（A1 executor_ref 风格，如 'salesAgentTool:get_customer'）。 */
  readonly executor_ref: string;
  /** 授权决策类别（A10 词汇；INVOCATION_STARTED 为 null）。 */
  readonly authority_decision: AuthorityDecisionKind | null;
  /** 授权稳定原因码（A10 词汇；INVOCATION_STARTED 为 null）。 */
  readonly authority_reason_code: AuthorityDecisionReason | null;
  /** 授权是否要求确认（由决策精确派生，防篡改）。 */
  readonly confirmation_required: boolean;
  /** 确认生命周期状态。 */
  readonly confirmation_state: ObservationConfirmationState;
  /** 执行结果（由事件类型精确派生：SUCCESS / FAILED / NOT_EXECUTED）。 */
  readonly result_status: ObservationResultStatus;
  /** 稳定错误类别（仅 EXECUTION_FAILED 非空）。 */
  readonly error_code: ObservationErrorCode | null;
}

/**
 * 事件构造输入（可选字段有确定性默认；矛盾输入一律 fail closed）。
 * - timestamp 缺省为当前本地 ISO；event_id 缺省为本地单调序列。
 * - authority_decision / authority_reason_code：INVOCATION_STARTED 必须缺省（null），
 *   其余类型必须提供。
 * - confirmation_state 缺省由决策派生；EXECUTION_* 下确认类决策必须显式给 CONFIRMED。
 * - expected_scope_requirement：可选一致性断言（应传能力声明的 scope_requirement），
 *   与 scope_type 矛盾即拒绝；不写入事件。
 */
export interface ObservationEventInput {
  readonly event_type: ObservationEventType;
  readonly timestamp?: ObservationTimestamp;
  readonly event_id?: string;
  /**
   * 调用关联标识（必填、显式、稳定标量）：标识一次被尝试的 Capability 调用。
   * 缺失 / 空串 / 非字符串一律 fail closed；本模块不从能力身份、客户身份或
   * 时间戳推断它；不包含任意业务载荷。
   */
  readonly invocation_id: string;
  readonly capability_id: string;
  readonly capability_version: string;
  readonly scope_type: ObservationScopeType;
  readonly scope_id?: string | null;
  readonly expected_scope_requirement?: CapabilityScopeRequirement;
  readonly executor_ref: string;
  readonly authority_decision?: AuthorityDecisionKind | null;
  readonly authority_reason_code?: AuthorityDecisionReason | null;
  readonly confirmation_state?: ObservationConfirmationState;
  /** 派生字段（confirmation_required / result_status）：完整事件回灌时允许携带，但必须与派生值一致，否则 fail closed。 */
  readonly confirmation_required?: boolean;
  readonly result_status?: ObservationResultStatus;
  readonly error_code?: ObservationErrorCode | null;
}

/* ------------------------------------------------------------------ */
/* 错误契约（稳定可区分；与 A1/A10 错误模式一致）                         */
/* ------------------------------------------------------------------ */

export type ObservationEventErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_INVOCATION_ID'
  | 'INVALID_IDENTITY'
  | 'INVALID_SCOPE'
  | 'INVALID_AUTHORITY_STATE'
  | 'INVALID_CONFIRMATION_STATE'
  | 'INVALID_RESULT_STATE'
  | 'INVALID_TIMESTAMP'
  | 'DUPLICATE_EVENT_ID';

export class ObservationEventError extends Error {
  readonly code: ObservationEventErrorCode;

  constructor(code: ObservationEventErrorCode, message: string) {
    // 插值值已在调用点经 JSON.stringify 转义（控制字符/引号）：拒绝通过错误消息进行日志注入。
    super(message);
    this.name = 'ObservationEventError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* 派生规则（确定性；等价输入 → 等价输出）                                */
/* ------------------------------------------------------------------ */

function resultFromKind(kind: ObservationEventType): ObservationResultStatus {
  switch (kind) {
    case 'EXECUTION_COMPLETED':
      return 'SUCCESS';
    case 'EXECUTION_FAILED':
      return 'FAILED';
    default:
      return 'NOT_EXECUTED';
  }
}

function confirmationFromDecision(decision: AuthorityDecisionKind | null): {
  required: boolean;
  state: ObservationConfirmationState;
} {
  switch (decision) {
    case 'REQUIRE_CONFIRMATION':
      return { required: true, state: 'REQUIRED' };
    case 'REQUIRE_STRONG_CONFIRMATION':
      return { required: true, state: 'STRONG_REQUIRED' };
    default:
      return { required: false, state: 'NOT_REQUIRED' };
  }
}

/* ------------------------------------------------------------------ */
/* 基础守卫                                                             */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 时间戳格式校验（仅格式 + 可解析性）。
 *
 * 信任边界（仅文档化）：ISO 有效性不证明可信墙钟来源——timestamp 是生命周期事件
 * 元数据，其墙钟真实性由提供方（W3-1 / 未来执行集成，在可信本地执行边界）负责。
 * 本模块不构建时钟基础设施、不校验墙钟真实性。
 */
export function isValidObservationTimestamp(value: unknown): value is ObservationTimestamp {
  return (
    typeof value === 'string' &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** 本地时区 ISO 序列化（与 AppClock zoned wall-time 惯例一致；无依赖）。 */
function localIsoTimestamp(): ObservationTimestamp {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 本地单调事件 id 序列（进程内确定性；不依赖网络/UUID 服务）。 */
let eventSequence = 0;

export function nextObservationEventId(): string {
  eventSequence += 1;
  return `OBS-${String(eventSequence).padStart(6, '0')}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* 一致性校验（fail closed；每类事件只允许如实承载的状态组合）              */
/* ------------------------------------------------------------------ */

function assertKindConsistency(
  kind: ObservationEventType,
  decision: AuthorityDecisionKind | null,
  reason: AuthorityDecisionReason | null,
  errorCode: ObservationErrorCode | null,
): void {
  switch (kind) {
    case 'INVOCATION_STARTED': {
      if (decision !== null || reason !== null) {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'INVOCATION_STARTED cannot carry an authority decision/reason code (no decision exists at invocation time).',
        );
      }
      if (errorCode !== null) {
        throw new ObservationEventError(
          'INVALID_RESULT_STATE',
          'INVOCATION_STARTED cannot carry an error category.',
        );
      }
      return;
    }
    case 'AUTHORITY_DECIDED': {
      if (decision === null || reason === null) {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'AUTHORITY_DECIDED requires a decision kind and a stable reason code.',
        );
      }
      return;
    }
    case 'CONFIRMATION_REQUIRED': {
      if (decision !== 'REQUIRE_CONFIRMATION' && decision !== 'REQUIRE_STRONG_CONFIRMATION') {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'CONFIRMATION_REQUIRED requires a confirmation-class decision (REQUIRE_CONFIRMATION | REQUIRE_STRONG_CONFIRMATION).',
        );
      }
      if (reason === null) {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'CONFIRMATION_REQUIRED requires a stable reason code.',
        );
      }
      return;
    }
    case 'AUTONOMY_DENIED': {
      if (decision !== 'DENY_AUTONOMOUS') {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'AUTONOMY_DENIED requires decision=DENY_AUTONOMOUS.',
        );
      }
      if (reason === null) {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'AUTONOMY_DENIED requires a stable reason code.',
        );
      }
      if (errorCode !== null) {
        throw new ObservationEventError(
          'INVALID_RESULT_STATE',
          'AUTONOMY_DENIED is a decision outcome, not an execution error.',
        );
      }
      return;
    }
    case 'EXECUTION_COMPLETED':
    case 'EXECUTION_FAILED': {
      if (decision === null || decision === 'DENY_AUTONOMOUS') {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'Execution events require a governing non-denied authority decision.',
        );
      }
      if (reason === null) {
        throw new ObservationEventError(
          'INVALID_AUTHORITY_STATE',
          'Execution events require a stable reason code.',
        );
      }
      if (kind === 'EXECUTION_FAILED' && errorCode === null) {
        throw new ObservationEventError(
          'INVALID_RESULT_STATE',
          'EXECUTION_FAILED requires a stable error category.',
        );
      }
      if (kind === 'EXECUTION_COMPLETED' && errorCode !== null) {
        throw new ObservationEventError(
          'INVALID_RESULT_STATE',
          'EXECUTION_COMPLETED cannot carry an error category.',
        );
      }
      return;
    }
  }
}

function assertConfirmationConsistency(
  kind: ObservationEventType,
  decision: AuthorityDecisionKind | null,
  state: ObservationConfirmationState,
): void {
  if (state === 'REJECTED' || state === 'CANCELLED') {
    throw new ObservationEventError(
      'INVALID_CONFIRMATION_STATE',
      'Confirmation states REJECTED/CANCELLED are reserved future-handoff vocabulary; no W3-2 event type can truthfully carry a human decision outcome.',
    );
  }
  if (decision === null) {
    if (state !== 'NOT_REQUIRED') {
      throw new ObservationEventError(
        'INVALID_CONFIRMATION_STATE',
        'Confirmation state must be NOT_REQUIRED before any authority decision exists.',
      );
    }
    return;
  }
  if (decision === 'ALLOW_AUTO' || decision === 'DENY_AUTONOMOUS') {
    if (state !== 'NOT_REQUIRED') {
      throw new ObservationEventError(
        'INVALID_CONFIRMATION_STATE',
        'Autonomous/denied decisions cannot carry a confirmation-required state.',
      );
    }
    return;
  }
  // decision ∈ { REQUIRE_CONFIRMATION, REQUIRE_STRONG_CONFIRMATION }
  if (kind === 'EXECUTION_COMPLETED' || kind === 'EXECUTION_FAILED') {
    if (state !== 'CONFIRMED') {
      throw new ObservationEventError(
        'INVALID_CONFIRMATION_STATE',
        'Execution under a confirmation decision requires confirmation_state=CONFIRMED (human confirmation completed before execution).',
      );
    }
    return;
  }
  const expected: ObservationConfirmationState =
    decision === 'REQUIRE_STRONG_CONFIRMATION' ? 'STRONG_REQUIRED' : 'REQUIRED';
  if (state !== expected) {
    throw new ObservationEventError(
      'INVALID_CONFIRMATION_STATE',
      `Confirmation state ${JSON.stringify(state)} does not match decision ${JSON.stringify(decision)}.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 规范化 / 构造（唯一校验入口；白名单键 + 单次读取 + 全新冻结对象）         */
/* ------------------------------------------------------------------ */

const EVENT_INPUT_KEYS: readonly string[] = Object.freeze([
  'event_type',
  'timestamp',
  'event_id',
  'invocation_id',
  'capability_id',
  'capability_version',
  'scope_type',
  'scope_id',
  'expected_scope_requirement',
  'executor_ref',
  'authority_decision',
  'authority_reason_code',
  'confirmation_state',
  'confirmation_required',
  'result_status',
  'error_code',
]);

/**
 * 将任意输入规范化为一个全新的、深度冻结的 ObservationEvent。
 * - 白名单键：拒绝任何额外键（PII / 任意载荷 / 原型注入键均不属于契约）。
 * - 逐字段一次性读取（避免 getter 二次读取 TOCTOU；与 A1 clone-first 同模式）。
 * - 任何缺失/未知/矛盾状态都 fail closed（ObservationEventError）。
 */
export function normalizeObservationEvent(value: unknown): ObservationEvent {
  if (!isRecord(value)) {
    throw new ObservationEventError('INVALID_EVENT', 'Observation event input must be a plain object.');
  }

  for (const key of Object.keys(value)) {
    if (!EVENT_INPUT_KEYS.includes(key)) {
      throw new ObservationEventError(
        'INVALID_EVENT',
        `Observation event rejects unknown field: ${JSON.stringify(key)}.`,
      );
    }
  }

  const rawKind = value['event_type'];
  const rawTimestamp = value['timestamp'];
  const rawEventId = value['event_id'];
  const rawInvocationId = value['invocation_id'];
  const rawCapabilityId = value['capability_id'];
  const rawCapabilityVersion = value['capability_version'];
  const rawScopeType = value['scope_type'];
  const rawScopeId = value['scope_id'];
  const rawExpectedScope = value['expected_scope_requirement'];
  const rawExecutorRef = value['executor_ref'];
  const rawDecision = value['authority_decision'];
  const rawReason = value['authority_reason_code'];
  const rawConfirmationState = value['confirmation_state'];
  const rawConfirmationRequired = value['confirmation_required'];
  const rawResultStatus = value['result_status'];
  const rawErrorCode = value['error_code'];

  if (!isOneOf(rawKind, OBSERVATION_EVENT_TYPES)) {
    throw new ObservationEventError(
      'INVALID_EVENT',
      `Unsupported observation event type: ${JSON.stringify(rawKind)}.`,
    );
  }
  const kind = rawKind as ObservationEventType;

  const timestamp = rawTimestamp === undefined ? localIsoTimestamp() : rawTimestamp;
  if (!isValidObservationTimestamp(timestamp)) {
    throw new ObservationEventError(
      'INVALID_TIMESTAMP',
      'Observation event timestamp must be an explicit ISO-8601 string with zone offset or Z.',
    );
  }

  if (rawEventId !== undefined && !isNonEmptyString(rawEventId)) {
    throw new ObservationEventError('INVALID_EVENT', 'Observation event_id must be a non-empty string.');
  }
  const eventId = rawEventId === undefined ? nextObservationEventId() : rawEventId;

  // invocation_id：显式、稳定、非空标量；缺失 / 空串 / 非字符串一律 fail closed。
  // 本模块不生成、不从 capability_id / scope_id / timestamp 推断它。
  if (typeof rawInvocationId !== 'string' || rawInvocationId.trim().length === 0) {
    throw new ObservationEventError(
      'INVALID_INVOCATION_ID',
      'Observation event requires an explicit non-empty invocation_id string (lifecycle correlation identity).',
    );
  }
  const invocationId = rawInvocationId;

  if (!isNonEmptyString(rawCapabilityId) || !isNonEmptyString(rawCapabilityVersion)) {
    throw new ObservationEventError(
      'INVALID_IDENTITY',
      'capability_id and capability_version must be non-empty strings.',
    );
  }

  if (!isOneOf(rawScopeType, OBSERVATION_SCOPE_TYPES)) {
    throw new ObservationEventError(
      'INVALID_SCOPE',
      `Unsupported scope type: ${JSON.stringify(rawScopeType)}.`,
    );
  }
  const scopeType = rawScopeType as ObservationScopeType;

  let scopeId: string | null = null;
  if (rawScopeId !== undefined && rawScopeId !== null) {
    if (typeof rawScopeId !== 'string') {
      throw new ObservationEventError('INVALID_SCOPE', 'scope_id must be a string or null.');
    }
    if (scopeType === 'CUSTOMER') {
      if (rawScopeId.trim().length === 0) {
        throw new ObservationEventError(
          'INVALID_SCOPE',
          'CUSTOMER-scoped events require a non-empty scope_id (fail closed; never silently drop the customer identity).',
        );
      }
      scopeId = rawScopeId;
    } else {
      // GLOBAL / NONE：不得伪造/携带客户范围 id
      throw new ObservationEventError(
        'INVALID_SCOPE',
        `${JSON.stringify(scopeType)}-scoped events cannot carry a scope_id (no fabricated customer identity).`,
      );
    }
  } else if (scopeType === 'CUSTOMER') {
    throw new ObservationEventError(
      'INVALID_SCOPE',
      'CUSTOMER-scoped events require scope_id (fail closed; never silently drop the customer identity).',
    );
  }

  if (rawExpectedScope !== undefined) {
    if (!isOneOf(rawExpectedScope, OBSERVATION_SCOPE_TYPES)) {
      throw new ObservationEventError(
        'INVALID_SCOPE',
        'expected_scope_requirement must be GLOBAL | CUSTOMER | NONE.',
      );
    }
    if (rawExpectedScope !== scopeType) {
      throw new ObservationEventError(
        'INVALID_SCOPE',
        `Invocation scope ${JSON.stringify(scopeType)} contradicts the capability's declared scope_requirement ${JSON.stringify(rawExpectedScope)}.`,
      );
    }
  }

  if (!isNonEmptyString(rawExecutorRef)) {
    throw new ObservationEventError('INVALID_EVENT', 'executor_ref must be a non-empty string.');
  }

  let decision: AuthorityDecisionKind | null = null;
  if (rawDecision !== undefined && rawDecision !== null) {
    if (!isOneOf(rawDecision, AUTHORITY_DECISION_KINDS)) {
      throw new ObservationEventError(
        'INVALID_AUTHORITY_STATE',
        `Unsupported authority decision kind: ${JSON.stringify(rawDecision)}.`,
      );
    }
    decision = rawDecision as AuthorityDecisionKind;
  }

  let reason: AuthorityDecisionReason | null = null;
  if (rawReason !== undefined && rawReason !== null) {
    if (!isOneOf(rawReason, AUTHORITY_DECISION_REASONS)) {
      throw new ObservationEventError(
        'INVALID_AUTHORITY_STATE',
        `Unsupported authority reason code: ${JSON.stringify(rawReason)}.`,
      );
    }
    reason = rawReason as AuthorityDecisionReason;
  }

  let confirmationState: ObservationConfirmationState;
  if (rawConfirmationState === undefined) {
    confirmationState = confirmationFromDecision(decision).state;
  } else {
    if (!isOneOf(rawConfirmationState, OBSERVATION_CONFIRMATION_STATES)) {
      throw new ObservationEventError(
        'INVALID_CONFIRMATION_STATE',
        `Unsupported confirmation state: ${JSON.stringify(rawConfirmationState)}.`,
      );
    }
    confirmationState = rawConfirmationState as ObservationConfirmationState;
  }

  let errorCode: ObservationErrorCode | null = null;
  if (rawErrorCode !== undefined && rawErrorCode !== null) {
    if (!isOneOf(rawErrorCode, OBSERVATION_ERROR_CODES)) {
      throw new ObservationEventError(
        'INVALID_RESULT_STATE',
        `Unsupported error category: ${JSON.stringify(rawErrorCode)}.`,
      );
    }
    errorCode = rawErrorCode as ObservationErrorCode;
  }

  assertKindConsistency(kind, decision, reason, errorCode);
  assertConfirmationConsistency(kind, decision, confirmationState);

  const confirmation = confirmationFromDecision(decision);

  // 完整事件回灌（emitter 路径）：派生字段若显式携带，必须与派生值一致，否则 fail closed。
  if (rawConfirmationRequired !== undefined) {
    if (typeof rawConfirmationRequired !== 'boolean' || rawConfirmationRequired !== confirmation.required) {
      throw new ObservationEventError(
        'INVALID_CONFIRMATION_STATE',
        'confirmation_required must equal the value derived from the authority decision.',
      );
    }
  }
  if (rawResultStatus !== undefined) {
    const derivedResult = resultFromKind(kind);
    if (!isOneOf(rawResultStatus, OBSERVATION_RESULT_STATUSES) || rawResultStatus !== derivedResult) {
      throw new ObservationEventError(
        'INVALID_RESULT_STATE',
        'result_status must equal the value derived from the event type.',
      );
    }
  }

  const event: ObservationEvent = {
    event_id: eventId,
    invocation_id: invocationId,
    event_type: kind,
    timestamp,
    capability_id: rawCapabilityId,
    capability_version: rawCapabilityVersion,
    scope_type: scopeType,
    scope_id: scopeId,
    executor_ref: rawExecutorRef,
    authority_decision: decision,
    authority_reason_code: reason,
    confirmation_required: confirmation.required,
    confirmation_state: confirmationState,
    result_status: resultFromKind(kind),
    error_code: errorCode,
  };
  return deepFreeze(event);
}

/** 构造一个合法、冻结的观察事件（等价于 normalizeObservationEvent）。 */
export function createObservationEvent(input: ObservationEventInput): ObservationEvent {
  return normalizeObservationEvent(input);
}
