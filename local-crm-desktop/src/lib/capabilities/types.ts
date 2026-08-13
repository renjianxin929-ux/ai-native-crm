/**
 * V0.2A / A1 — Capability Contract (types only).
 *
 * 纯声明式能力契约：定义"能力是什么"，不包含任何执行、DB、网络、Provider 语义。
 * 本文件是类型边界（types-only）：不得引入 import 或运行时依赖。
 *
 * 关键架构规则：
 * - Intent 不是 Effect（SEARCH/SUMMARIZE/COMPARE 等业务意图不得作为 effect）。
 * - Capability != Authority（能力可以存在，即使自主执行被禁止）。
 * - 身份 = id + version，与描述/展示文本无关。
 * - DataTarget 区分 CRM_FACT / CRM_STATE / EVIDENCE：未来外部 Web 信息
 *   必须能指向 EVIDENCE 而不成为 CRM_FACT。
 */

/** 能力身份标识（snake_case / dotted id，如未来 'customer.read'；A1 仅用 fixture id）。 */
export type CapabilityId = string;

/** 能力版本标识（如 '1.0.0'）。身份 = id + version。 */
export type CapabilityVersion = string;

/** 能力所属领域（如未来 'customer' / 'task' / 'battle-card' / 'evidence'；A1 仅用 fixture 域）。 */
export type CapabilityDomain = string;

/**
 * 能力效果词汇（最小集合）。
 * 禁止把业务意图（SEARCH / SUMMARIZE / COMPARE / REASON / CUSTOMER_SUMMARY ...）作为 effect。
 */
export type CapabilityEffect =
  | 'READ'
  | 'ANALYZE'
  | 'DRAFT'
  | 'WRITE'
  | 'BULK_WRITE'
  | 'DELETE';

/**
 * 数据目标词汇（架构上重要）。
 * - NONE：不触及数据
 * - CRM_FACT：事实性 CRM 数据（客户事实、证据化记录）
 * - CRM_STATE：CRM 状态（任务、跟进、工作项等可变状态）
 * - EVIDENCE：证据（未来外部 Web 信息可指向 EVIDENCE，不成为 CRM_FACT）
 */
export type CapabilityDataTarget =
  | 'NONE'
  | 'CRM_FACT'
  | 'CRM_STATE'
  | 'EVIDENCE';

/** 风险词汇（刻意保持小集合；A1 只定义词汇，不做评分框架）。 */
export type CapabilityRiskLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'DESTRUCTIVE';

/**
 * 授权词汇（A1 只定义词汇与契约字段；Policy Engine / 具体映射属于后续分支）。
 * - AUTO：可自主执行
 * - POLICY_CONTROLLED：受策略控制
 * - CONFIRM：需要人工确认
 * - STRONG_CONFIRM：需要强确认（如精确防重放确认）
 * - DENY_AUTONOMOUS：禁止自主执行
 */
export type CapabilityAuthorityPolicy =
  | 'AUTO'
  | 'POLICY_CONTROLLED'
  | 'CONFIRM'
  | 'STRONG_CONFIRM'
  | 'DENY_AUTONOMOUS';

/**
 * 操作范围要求（最小可扩展）。
 * 未来示例：customer 范围、全局范围。A1 不注册真实 Customer 能力。
 */
export type CapabilityScopeRequirement =
  | 'NONE'
  | 'CUSTOMER'
  | 'GLOBAL';

/**
 * 幂等期望（仅声明式元数据；A1 不实现幂等存储/执行）。
 * - NONE：不承诺幂等（重复执行可能产生不同结果/副作用）
 * - SAFE：重复执行安全（典型：READ / ANALYZE）
 * - REQUIRED：执行器必须保证幂等（典型：写类能力）
 */
export type CapabilityIdempotency =
  | 'NONE'
  | 'SAFE'
  | 'REQUIRED';

/**
 * Schema 引用（依赖无关的字符串表示；未来由 schema registry 解析，
 * 如 'customer_summary_v1'。A1 不引入 Zod/Ajv/JSON Schema 依赖）。
 */
export type CapabilitySchemaRef = string;

/** 执行器引用（声明/引用边界；A1 不实现执行器，仅声明未来引用，如 'salesAgentTool:get_customer'）。 */
export type CapabilityExecutorRef = string;

/**
 * 错误契约声明（能力对其错误行为的声明）。
 * - UNSPECIFIED：未承诺稳定错误语义
 * - DISTINGUISHABLE：承诺稳定可区分的错误类别
 */
export type CapabilityErrorContract =
  | 'UNSPECIFIED'
  | 'DISTINGUISHABLE';

/**
 * 审计契约声明（仅声明审计性；不实现审计存储/UI/trace——属于后续分支）。
 */
export interface CapabilityAuditContract {
  /** 该能力是否要求审计记录。 */
  readonly audit_required: boolean;
  /** 是否记录输入。 */
  readonly record_input: boolean;
  /** 是否记录输出。 */
  readonly record_output: boolean;
  /** 是否记录效果（副作用结果）。 */
  readonly record_effect: boolean;
}

/**
 * 能力定义契约（V0.2A / A1 的唯一权威契约形状）。
 * 所有语义字段必须显式声明，禁止静默默认 effect / risk / authority / data_target。
 */
export interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly version: CapabilityVersion;
  readonly domain: CapabilityDomain;
  readonly description: string;
  /** 输入边界声明（schema 引用）。 */
  readonly input_schema: CapabilitySchemaRef;
  /** 输出边界声明（schema 引用）。 */
  readonly output_schema: CapabilitySchemaRef;
  readonly effect: CapabilityEffect;
  readonly data_target: CapabilityDataTarget;
  readonly risk_level: CapabilityRiskLevel;
  readonly authority_policy: CapabilityAuthorityPolicy;
  /** 确认要求显式声明；不得从 risk/effect 自动推断。 */
  readonly requires_confirmation: boolean;
  readonly scope_requirement: CapabilityScopeRequirement;
  readonly idempotency: CapabilityIdempotency;
  readonly executor_ref: CapabilityExecutorRef;
  readonly audit_contract: CapabilityAuditContract;
  readonly error_contract: CapabilityErrorContract;
}

/**
 * 稳定身份：id + version（确定性；不依赖描述/展示文本）。
 */
export interface CapabilityIdentity {
  readonly id: CapabilityId;
  readonly version: CapabilityVersion;
}
