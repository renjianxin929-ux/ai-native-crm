/**
 * V0.2A / W3-1 — Capability Execution Contract (types + stable error taxonomy).
 *
 * 本文件是 W3-1 的类型边界：定义"一次显式选定的 Capability 如何被确定性、
 * 安全地调用"的最小契约形状。它不包含任何执行、DB、网络、Provider、UI 语义，
 * 不实现 Agent 选路 / 工具选择 / 规划（那属于 V0.3）。
 *
 * 语义路径（本分支的权威链，见 engine.ts 实现）：
 *   Capability identity → Registry lookup → Input validation → Scope validation
 *   → Authority decision (A10) → Executor binding → Execute OR confirmation-required
 *   → Unified result/error → Observation seam
 *
 * 关键不变式：
 * - 一次 CapabilityInvocation 只对应"一个已选定的能力身份 + 显式 scope + 输入"。
 * - 执行框架绝不自行解释 A10 规则：只消费 AuthorityDecision，决策来自
 *   evaluateAuthorityPolicy（A10 的确定性 fail-closed 评估器）。
 * - 写类能力在确认/强确认/拒绝决策下绝不进入执行器（executor 调用数 = 0）。
 * - 幂等元数据只被保留/暴露在结果中，W3-1 不实现幂等执行与重放保护
 *   （现有 confirmedWrite 的 nonce/replay 体系保持独立、不被本层触碰）。
 */

import type { AuthorityDecision } from '../authority/types';
import type {
  CapabilityExecutorRef,
  CapabilityId,
  CapabilityIdempotency,
  CapabilityVersion,
} from '../types';

/**
 * 显式执行作用域。customer_id 仅在 CUSTOMER 范围能力上被强制要求。
 *
 * SCOPE↔INPUT 相干不变式（W3-1 安全要求）：
 * 对 CUSTOMER 范围能力，执行器生效的客户身份必须完全等于
 * scope.customer_id —— 任何输入字段都不能覆盖、替换或反驳显式 invocation scope。
 * 具体由绑定层护栏执行：
 * - 若输入包含客户选择字段（customer_id / customerId）且值 ≠ scope.customer_id
 *   → INVALID_INPUT，执行器绝不被调用（MISMATCHED_EXECUTOR_CALL_COUNT=0）。
 * - 若输入包含客户选择字段且值 = scope.customer_id → 允许（执行器仍以 scope 为准）。
 * - 缺失/空白 scope.customer_id → INVALID_SCOPE，执行器绝不被调用。
 * 无 fallback、无 "input wins"、无 "last known customer"。
 */
export interface CapabilityInvocationScope {
  readonly customer_id?: string;
}

/**
 * 一次能力调用请求。请求到达时，Capability 已经被选定
 * （W3-1 不实现目标解释 / 意图检测 / 工具搜索 / 工具排名 / 多步规划）。
 */
export interface CapabilityInvocation {
  readonly capability_id: CapabilityId;
  readonly capability_version: CapabilityVersion;
  /** 执行器输入（形状由绑定层的校验器定义；不是 JSON Schema 字符串描述）。 */
  readonly input: unknown;
  /** 显式执行作用域（执行层强制执行 scope_requirement）。 */
  readonly scope: CapabilityInvocationScope;
}

/** 执行结果状态（刻意保持最小集合；拒绝发明数十种业务状态）。 */
export type CapabilityExecutionStatus =
  | 'SUCCESS'
  | 'CONFIRMATION_REQUIRED'
  | 'STRONG_CONFIRMATION_REQUIRED'
  | 'AUTONOMY_DENIED'
  | 'EXECUTION_ERROR';

/**
 * 执行级稳定错误类别（只在此处区分有用类别；领域/业务错误不被复制成
 * 数十种业务错误码，而是如实落在 EXECUTOR_ERROR 并保留底层声明语义）。
 */
export type CapabilityExecutionErrorCode =
  | 'CAPABILITY_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_SCOPE'
  | 'EXECUTOR_NOT_BOUND'
  | 'EXECUTOR_ERROR';

/** 所有结果共享的基础元数据。 */
interface CapabilityExecutionOutcomeBase {
  readonly status: CapabilityExecutionStatus;
  readonly capability_id: CapabilityId;
  readonly capability_version: CapabilityVersion;
}

/** 成功：原始 Product 结果被原样保留在 payload 中（不重写、不克隆改写）。 */
export interface CapabilityExecutionSuccess extends CapabilityExecutionOutcomeBase {
  readonly status: 'SUCCESS';
  readonly authority_decision: AuthorityDecision;
  readonly executor_ref: CapabilityExecutorRef;
  /** A1 幂等元数据只读保留（供 W3-2 观察；本层不执行幂等/重放）。 */
  readonly idempotency: CapabilityIdempotency;
  /** 执行器原始结果（领域 payload 原样保留）。 */
  readonly payload: unknown;
}

/** A10 要求确认：不执行执行器，返回结构化确认结果。 */
export interface CapabilityExecutionConfirmationRequired extends CapabilityExecutionOutcomeBase {
  readonly status: 'CONFIRMATION_REQUIRED';
  readonly authority_decision: AuthorityDecision;
  readonly executor_ref: CapabilityExecutorRef;
  readonly idempotency: CapabilityIdempotency;
}

/** A10 要求强确认：不执行执行器，返回结构化强确认结果。 */
export interface CapabilityExecutionStrongConfirmationRequired extends CapabilityExecutionOutcomeBase {
  readonly status: 'STRONG_CONFIRMATION_REQUIRED';
  readonly authority_decision: AuthorityDecision;
  readonly executor_ref: CapabilityExecutorRef;
  readonly idempotency: CapabilityIdempotency;
}

/** A10 拒绝自主执行：不执行执行器，返回结构化拒绝结果。 */
export interface CapabilityExecutionDenied extends CapabilityExecutionOutcomeBase {
  readonly status: 'AUTONOMY_DENIED';
  readonly authority_decision: AuthorityDecision;
  readonly executor_ref: CapabilityExecutorRef;
  readonly idempotency: CapabilityIdempotency;
}

/**
 * 执行失败（fail-closed 结构）：稳定错误类别 + 脱敏消息。
 * 当定义可解析时保留 authority_decision / executor_ref / idempotency；
 * 定义不可解析（如 CAPABILITY_NOT_FOUND）时这些字段为 null。
 * 消息已做控制字符转义 + 长度截断，不泄露原始敏感内容。
 */
export interface CapabilityExecutionFailure extends CapabilityExecutionOutcomeBase {
  readonly status: 'EXECUTION_ERROR';
  readonly error_code: CapabilityExecutionErrorCode;
  /** 稳定、脱敏、有界的错误消息（非自由文本语义源）。 */
  readonly message: string;
  readonly authority_decision: AuthorityDecision | null;
  readonly executor_ref: CapabilityExecutorRef | null;
  readonly idempotency: CapabilityIdempotency | null;
}

/** 统一执行结果（判别联合；SUCCESS / 确认 / 强确认 / 拒绝 / 执行错误）。 */
export type CapabilityExecutionOutcome =
  | CapabilityExecutionSuccess
  | CapabilityExecutionConfirmationRequired
  | CapabilityExecutionStrongConfirmationRequired
  | CapabilityExecutionDenied
  | CapabilityExecutionFailure;

/**
 * 输入校验失败（绑定层校验器抛出；引擎将其映射为 INVALID_INPUT 结果）。
 * 这是唯一允许的"校验失败"通道：校验失败绝不以 SUCCESS 或自由文本形式外泄。
 */
export class CapabilityInputValidationError extends Error {
  readonly code = 'INVALID_INPUT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CapabilityInputValidationError';
  }
}

/**
 * 观察集成缝（W3-2 Observation/Audit 未来的挂载点）。
 * 本层不实现 W3-2 事件契约、不持久化、不审计；只暴露最小事件缺口：
 * 权威决策后 / 执行前 / 结果后。observer 为可选，缺省时零开销。
 */
export interface CapabilityExecutionObservationEvent {
  readonly phase: 'AUTHORITY_DECIDED' | 'BEFORE_EXECUTION' | 'OUTCOME';
  readonly capability_id: CapabilityId;
  readonly capability_version: CapabilityVersion;
  readonly authority_decision?: AuthorityDecision;
  readonly executor_ref?: CapabilityExecutorRef;
  readonly outcome?: CapabilityExecutionOutcome;
}

/** 最小观察器（全部可选；W3-2 可在此挂载，不导入 W3-2 文件）。 */
export interface CapabilityExecutionObserver {
  readonly observe?: (event: CapabilityExecutionObservationEvent) => void;
}
