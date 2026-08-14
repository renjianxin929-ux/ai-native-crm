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
 *
 * ── Closure 2：调用关联身份（invocation_id）─────────────────────────────
 * - 一次进入统一执行的调用 → 恰好一个 invocation_id（由执行边界在入口生成并
 *   拥有；调用方不能经业务输入覆盖）。同一调用的全部生命周期观察事件与终态
 *   结果共享同一个 invocation_id（W3-2 生命周期关联）。
 * - invocation_id 只标识"一次被尝试的调用"：不充当幂等键 / 确认 nonce /
 *   提案 id / 重放 token（这些身份各自独立，禁止复用）。
 * - 前置授权失败（CAPABILITY_NOT_FOUND / INVALID_INPUT / INVALID_SCOPE /
 *   EXECUTOR_NOT_BOUND）同样携带 invocation_id（身份在注册表查找前已存在）。
 */

import type { AuthorityDecision } from '../authority/types';
import type {
  CapabilityExecutorRef,
  CapabilityId,
  CapabilityIdempotency,
  CapabilityScopeRequirement,
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
  /**
   * 调用关联身份（Closure 2）：标识"一次被尝试的 Capability 调用"。
   * 由统一执行边界在入口生成并拥有；同一调用的全部生命周期事件与终态结果
   * 共享该值。只用于生命周期关联，绝不充当幂等键 / 确认 nonce / 重放 token。
   */
  readonly invocation_id: string;
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

/**
 * 确认交接元数据（GAP-F）：统一执行结果中保留的最小信息，让调用方知道——
 * - 确认是必需的（由 outcome.status 表达）
 * - 哪个 capability/请求正在等待确认（proposal_id，指向现有确认机制中的提案）
 * - 哪个现有确认机制拥有后续（mechanism 身份字符串）
 * 刻意不携带业务敏感负载（客户载荷 / 原始 notes / prompt / 模型输出 / secret）：
 * 不把执行结果变成第二个提案存储；提案本体永远留在现有机制（如
 * sessionWriteStateStore 的 canonical snapshot）中，这里只保留引用。
 */
export interface CapabilityConfirmationHandoff {
  /** 现有确认机制身份（如 'salesAgentConfirmedWrite' / 'battleCardConfirmedWrite'）。 */
  readonly mechanism: string;
  /** 现有确认机制中的提案 ID（等待人工确认；经现有 getCanonicalProposal 可读回）。 */
  readonly proposal_id: string;
}

/** A10 要求确认：不执行执行器，返回结构化确认结果。 */
export interface CapabilityExecutionConfirmationRequired extends CapabilityExecutionOutcomeBase {
  readonly status: 'CONFIRMATION_REQUIRED';
  readonly authority_decision: AuthorityDecision;
  readonly executor_ref: CapabilityExecutorRef;
  readonly idempotency: CapabilityIdempotency;
  /** GAP-F：当绑定声明了确认交接适配器时，携带现有确认机制的提案引用（无敏感负载）。 */
  readonly confirmation_handoff?: CapabilityConfirmationHandoff;
}

/** A10 要求强确认：不执行执行器，返回结构化强确认结果。 */
export interface CapabilityExecutionStrongConfirmationRequired extends CapabilityExecutionOutcomeBase {
  readonly status: 'STRONG_CONFIRMATION_REQUIRED';
  readonly authority_decision: AuthorityDecision;
  readonly executor_ref: CapabilityExecutorRef;
  readonly idempotency: CapabilityIdempotency;
  /** GAP-F：当绑定声明了确认交接适配器时，携带现有确认机制的提案引用（无敏感负载）。 */
  readonly confirmation_handoff?: CapabilityConfirmationHandoff;
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
 * 观察集成缝（W3-2 Observation/Audit 的挂载点；Closure 2 已通过
 * observationBridge.ts 挂载真实 W3-2 事件生成）。
 *
 * 语义（本层实现，见 engine.ts）：
 * - INVOCATION_STARTED：定义解析成功后（executor_ref / scope_requirement 已知）
 *   发出；CAPABILITY_NOT_FOUND 路径无定义、不发此事件（无真实执行器身份）。
 * - AUTHORITY_DECIDED：A10 决策产出后发出。
 * - BEFORE_EXECUTION：ALLOW_AUTO 执行器调用前发出（W3-2 无对应词汇，桥忽略）。
 * - OUTCOME：每个调用恰好一个终态事件（始终发出）。
 *
 * 事件携带结构字段（capability 身份 / 显式 scope / 定义解析后的 executor_ref /
 * scope_requirement / A10 决策 / 终态结果）+ invocation_id；绝不携带业务载荷。
 * 观察失败（observer/emitter 抛错）在引擎接缝处被包含：绝不影响业务结果、
 * 绝不触发业务执行器重试、绝不伪装成第二次执行（见 engine.ts 语义）。
 */
export type CapabilityExecutionObservationPhase =
  | 'INVOCATION_STARTED'
  | 'AUTHORITY_DECIDED'
  | 'BEFORE_EXECUTION'
  | 'OUTCOME';

/** 观察事件（全部字段只读；scope 恒为入口作用域原样，不做改写）。 */
export interface CapabilityExecutionObservationEvent {
  readonly phase: CapabilityExecutionObservationPhase;
  /** 调用关联身份：与终态结果共享；同一调用的全部事件精确保留。 */
  readonly invocation_id: string;
  readonly capability_id: CapabilityId;
  readonly capability_version: CapabilityVersion;
  /** 显式调用作用域（入口原样；CUSTOMER 能力由引擎 scope 门控保证非空）。 */
  readonly scope: CapabilityInvocationScope;
  /** 定义声明的执行器引用（定义解析后可用；CAPABILITY_NOT_FOUND 路径缺失）。 */
  readonly executor_ref?: CapabilityExecutorRef;
  /** 定义声明的 scope_requirement（定义解析后可用；桥据此派生事件 scope 字段）。 */
  readonly scope_requirement?: CapabilityScopeRequirement;
  readonly authority_decision?: AuthorityDecision;
  readonly outcome?: CapabilityExecutionOutcome;
}

/** 最小观察器（全部可选；W3-2 桥经此挂载，观察失败被引擎包含）。 */
export interface CapabilityExecutionObserver {
  readonly observe?: (event: CapabilityExecutionObservationEvent) => void;
}
