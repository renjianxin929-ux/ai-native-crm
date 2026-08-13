/**
 * V0.2A / A10 — Capability Authority Policy Contract (types only).
 *
 * 纯声明式权限决策契约：定义"一次确定性、fail-closed 的权限决策"的形状，
 * 不包含任何执行、DB、网络、Provider、UI 语义。
 * 本文件是类型边界（types-only）：不得引入 import 或运行时依赖。
 *
 * 架构边界（A10 不变式）：
 * - Capability != Authority：能力可以存在，即使自主执行被禁止。
 * - 决策 = f(CapabilityDefinition)，纯函数、确定性、本地、无副作用。
 * - 决策 != 执行：本模块只产出决策对象，绝不调用执行器/DB/网络。
 * - 决策 != 重放保护 != 幂等执行：三者保持分离（见 policy.ts 文档）。
 */

/**
 * 决策类别（语义等价于 A1 authority 词汇的"决策后"形态）。
 * - ALLOW_AUTO：允许自主执行（仅当无更强安全条件覆盖）。
 * - REQUIRE_CONFIRMATION：要求显式人工确认后方可执行。
 * - REQUIRE_STRONG_CONFIRMATION：要求更强确认语义（防重放精确确认）后方可执行。
 * - DENY_AUTONOMOUS：拒绝一切自主执行；未来人工控制执行必须走独立批准路径，
 *   且 DENY_AUTONOMOUS 绝不等于"能力不存在"。
 */
export type AuthorityDecisionKind =
  | 'ALLOW_AUTO'
  | 'REQUIRE_CONFIRMATION'
  | 'REQUIRE_STRONG_CONFIRMATION'
  | 'DENY_AUTONOMOUS';

/**
 * 稳定机器可读原因码（小集合；拒绝自由文本作为决策语义）。
 * 等价策略输入 → 等价原因码（确定性）。
 */
export type AuthorityDecisionReason =
  /** 无更强安全条件，允许自主执行。 */
  | 'AUTO_ALLOWED'
  /** authority_policy=CONFIRM 或 requires_confirmation=true 显式要求确认。 */
  | 'EXPLICIT_CONFIRMATION_REQUIRED'
  /** authority_policy=STRONG_CONFIRM 显式要求强确认。 */
  | 'STRONG_CONFIRMATION_REQUIRED'
  /** authority_policy=DENY_AUTONOMOUS：禁止自主执行。 */
  | 'AUTONOMY_DENIED'
  /** effect=DELETE / BULK_WRITE 安全楼层：禁止自主，要求强确认。 */
  | 'DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL'
  /** risk_level=DESTRUCTIVE 安全楼层：禁止自主，要求强确认。 */
  | 'DESTRUCTIVE_RISK_REQUIRES_STRONG_CONTROL'
  /** HIGH 风险 WRITE 安全楼层：不得静默自主执行。 */
  | 'HIGH_RISK_WRITE_REQUIRES_CONFIRMATION'
  /** authority_policy=POLICY_CONTROLLED 下写类能力按确定性规则要求确认。 */
  | 'POLICY_CONTROLLED_REQUIRES_CONFIRMATION'
  /** 未知/矛盾/残缺的策略状态：fail closed，拒绝自主。 */
  | 'INVALID_CAPABILITY_POLICY';

/**
 * 权限决策结果（最小契约；结构化，便于 A11 审计：能力身份 + 决策 + 原因码）。
 *
 * 派生字段不变式：
 * - autonomous_allowed === (decision === 'ALLOW_AUTO')
 * - confirmation_required === (decision === 'REQUIRE_CONFIRMATION' || decision === 'REQUIRE_STRONG_CONFIRMATION')
 *
 * DENY_AUTONOMOUS：autonomous_allowed=false、confirmation_required=false——
 * 它不承诺"确认后可执行"，仅表达"无自主执行权限"；未来人工路径需独立批准。
 */
export interface AuthorityDecision {
  readonly capability_id: string;
  readonly capability_version: string;
  readonly decision: AuthorityDecisionKind;
  readonly reason_code: AuthorityDecisionReason;
  readonly confirmation_required: boolean;
  readonly autonomous_allowed: boolean;
}

/** 决策类别常量表（运行时校验用；与类型联合保持一致）。 */
export const AUTHORITY_DECISION_KINDS: readonly AuthorityDecisionKind[] = [
  'ALLOW_AUTO',
  'REQUIRE_CONFIRMATION',
  'REQUIRE_STRONG_CONFIRMATION',
  'DENY_AUTONOMOUS',
] as const;

/** 原因码常量表（运行时校验用；与类型联合保持一致）。 */
export const AUTHORITY_DECISION_REASONS: readonly AuthorityDecisionReason[] = [
  'AUTO_ALLOWED',
  'EXPLICIT_CONFIRMATION_REQUIRED',
  'STRONG_CONFIRMATION_REQUIRED',
  'AUTONOMY_DENIED',
  'DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL',
  'DESTRUCTIVE_RISK_REQUIRES_STRONG_CONTROL',
  'HIGH_RISK_WRITE_REQUIRES_CONFIRMATION',
  'POLICY_CONTROLLED_REQUIRES_CONFIRMATION',
  'INVALID_CAPABILITY_POLICY',
] as const;
