/**
 * V0.2A / A10 — Capability Authority Policy Evaluator.
 *
 * 唯一职责：从冻结的 CapabilityDefinition 产出一个确定性、fail-closed 的
 * AuthorityDecision。本模块：
 * - 不执行任何动作（EXECUTOR_CALLS=0 / DB_WRITE_CALLS=0 / CRM_WRITES=0）
 * - 不调用模型/Provider/网络（MODEL_CALLS=0 / PROVIDER_CALLS=0 / NETWORK_CALLS=0）
 * - 不持久化、不审计（A11 负责 Observation / Audit）
 * - 不修改输入（不可变性：只读字段，返回全新决策对象）
 * - 无 RBAC / 无用户会话 / 无 UI 状态依赖（决策只依赖能力定义本身）
 *
 * 架构关系（保持分离，禁止合并）：
 *   Authority Decision（本模块，确定"是否允许自主/需要何种确认"）
 *   != Replay Protection（现有 confirmedWrite.consumeExactConfirmation / nonce）
 *   != Idempotency Enforcement（现有执行器 + A1 idempotency 元数据）
 * 未来流程：Capability → Authority Policy Decision → 现有 Confirmation /
 * Approved Write Boundary → 现有 Executor → Audit。A10 只拥有第一步。
 */

import type {
  CapabilityAuthorityPolicy,
  CapabilityDefinition,
  CapabilityEffect,
  CapabilityRiskLevel,
} from '../types';
import type {
  AuthorityDecision,
  AuthorityDecisionKind,
  AuthorityDecisionReason,
} from './types';

/* ------------------------------------------------------------------ */
/* 受支持词汇常量（与 A1 类型联合一致；运行时防御性校验用，防注入绕过）  */
/* 重要：A1 若扩展 CapabilityEffect / CapabilityRiskLevel /             */
/* CapabilityAuthorityPolicy 联合，此处常量与下方分类清单必须同步，     */
/* 否则新增词汇会经 AUTO 兜底（fail-closed 依赖此同步不变量）。         */
/* ------------------------------------------------------------------ */

const SUPPORTED_EFFECTS: readonly string[] = [
  'READ',
  'ANALYZE',
  'DRAFT',
  'WRITE',
  'BULK_WRITE',
  'DELETE',
];
const SUPPORTED_RISK_LEVELS: readonly string[] = ['LOW', 'MEDIUM', 'HIGH', 'DESTRUCTIVE'];
const SUPPORTED_AUTHORITY_POLICIES: readonly string[] = [
  'AUTO',
  'POLICY_CONTROLLED',
  'CONFIRM',
  'STRONG_CONFIRM',
  'DENY_AUTONOMOUS',
];

/** 读类/无变更 effect：策略上非变更，DRAFT 只是生成草稿，不等于 CRM 写入执行。 */
const NON_MUTATING_EFFECTS: readonly CapabilityEffect[] = ['READ', 'ANALYZE', 'DRAFT'];

/** 破坏性 effect：A1 词汇内最小的"破坏性动作"集合（不发明业务动作清单）。 */
const DESTRUCTIVE_EFFECTS: readonly CapabilityEffect[] = ['DELETE', 'BULK_WRITE'];

/* ------------------------------------------------------------------ */
/* Fail-closed 输入校验                                                 */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 决策所需的关键字段校验。任何缺失/未知/矛盾的关键状态都产生
 * INVALID_CAPABILITY_POLICY → DENY_AUTONOMOUS（绝不默认 AUTO）。
 * 校验只读取字段一次，不产生副作用。
 */
function validateDecisionInputs(
  value: unknown,
): { effect: CapabilityEffect; risk: CapabilityRiskLevel; authority: CapabilityAuthorityPolicy; requiresConfirmation: boolean } | null {
  if (!isRecord(value)) {
    return null;
  }
  const effect = value.effect;
  const risk = value.risk_level;
  const authority = value.authority_policy;
  const requiresConfirmation = value.requires_confirmation;

  if (typeof effect !== 'string' || !SUPPORTED_EFFECTS.includes(effect)) return null;
  if (typeof risk !== 'string' || !SUPPORTED_RISK_LEVELS.includes(risk)) return null;
  if (typeof authority !== 'string' || !SUPPORTED_AUTHORITY_POLICIES.includes(authority)) return null;
  if (typeof requiresConfirmation !== 'boolean') return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.version)) return null;

  return {
    effect: effect as CapabilityEffect,
    risk: risk as CapabilityRiskLevel,
    authority: authority as CapabilityAuthorityPolicy,
    requiresConfirmation,
  };
}

/* ------------------------------------------------------------------ */
/* 决策构造（纯数据；能力身份来自定义 id+version）                        */
/* ------------------------------------------------------------------ */

function makeDecision(
  definition: unknown,
  decision: AuthorityDecisionKind,
  reason: AuthorityDecisionReason,
): AuthorityDecision {
  // fail-closed：即使输入不是合法定义对象，也必须产出决策而不是抛异常；
  // 身份字段仅在可安全提取时保留，否则为空串（INVALID_CAPABILITY_POLICY 场景）。
  const id = isRecord(definition) && isNonEmptyString(definition.id) ? definition.id : '';
  const version =
    isRecord(definition) && isNonEmptyString(definition.version) ? definition.version : '';
  return {
    capability_id: id,
    capability_version: version,
    decision,
    reason_code: reason,
    confirmation_required:
      decision === 'REQUIRE_CONFIRMATION' || decision === 'REQUIRE_STRONG_CONFIRMATION',
    autonomous_allowed: decision === 'ALLOW_AUTO',
  };
}

/* ------------------------------------------------------------------ */
/* 优先级模型（显式、确定性、fail-closed；更强安全要求先胜）              */
/*                                                                     */
/*   1. 无效/未知/残缺策略状态          → DENY_AUTONOMOUS（fail closed）  */
/*   2. DENY_AUTONOMOUS                → DENY_AUTONOMOUS                */
/*   3. effect 楼层：DELETE/BULK_WRITE  → REQUIRE_STRONG_CONFIRMATION   */
/*   4. risk 楼层：DESTRUCTIVE          → REQUIRE_STRONG_CONFIRMATION   */
/*   5. STRONG_CONFIRM                 → REQUIRE_STRONG_CONFIRMATION    */
/*   6. CONFIRM / requires_confirmation → REQUIRE_CONFIRMATION          */
/*   7. HIGH 风险 WRITE 楼层            → REQUIRE_CONFIRMATION           */
/*   8. POLICY_CONTROLLED              → 确定性规则（见下）              */
/*   9. AUTO                           → ALLOW_AUTO（仅当无更强楼层）    */
/* ------------------------------------------------------------------ */

/**
 * 评估一次权限决策。
 *
 * 纯函数：无副作用、无 IO、不修改输入；等价输入 → 等价输出。
 *
 * POLICY_CONTROLLED 确定性规则（唯一文档化的受控策略）：
 * - effect ∈ {READ, ANALYZE, DRAFT} → ALLOW_AUTO
 *   （非变更能力；DRAFT 只生成草稿/提案，不等于 CRM 写入执行）
 * - effect = WRITE（含楼层未拦截的写）→ REQUIRE_CONFIRMATION
 *   （写是 CRM 状态变更；受控策略下低风险写入也要求人工确认，
 *    与现有 confirmed-write 运行时"提案 → 人工确认"语义一致）
 * - DELETE / BULK_WRITE 已在楼层 3 拦截 → REQUIRE_STRONG_CONFIRMATION
 */
export function evaluateAuthorityPolicy(definition: CapabilityDefinition): AuthorityDecision {
  const inputs = validateDecisionInputs(definition);
  if (inputs === null) {
    // fail closed：未知/矛盾/残缺策略状态 → 拒绝自主 + 稳定原因码
    return makeDecision(definition, 'DENY_AUTONOMOUS', 'INVALID_CAPABILITY_POLICY');
  }

  const { effect, risk, authority, requiresConfirmation } = inputs;

  // 楼层 2：显式禁止自主（最强者，先于一切楼层；更安全的语义永远不被弱化）
  if (authority === 'DENY_AUTONOMOUS') {
    return makeDecision(definition, 'DENY_AUTONOMOUS', 'AUTONOMY_DENIED');
  }

  // 楼层 3：破坏性 effect 禁止自主——即使 authority 被误声明为 AUTO
  if (DESTRUCTIVE_EFFECTS.includes(effect)) {
    return makeDecision(definition, 'REQUIRE_STRONG_CONFIRMATION', 'DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
  }

  // 楼层 4：DESTRUCTIVE 风险禁止自主
  if (risk === 'DESTRUCTIVE') {
    return makeDecision(definition, 'REQUIRE_STRONG_CONFIRMATION', 'DESTRUCTIVE_RISK_REQUIRES_STRONG_CONTROL');
  }

  // 显式要求：强确认 > 普通确认
  if (authority === 'STRONG_CONFIRM') {
    return makeDecision(definition, 'REQUIRE_STRONG_CONFIRMATION', 'STRONG_CONFIRMATION_REQUIRED');
  }
  if (authority === 'CONFIRM' || requiresConfirmation) {
    return makeDecision(definition, 'REQUIRE_CONFIRMATION', 'EXPLICIT_CONFIRMATION_REQUIRED');
  }

  // 楼层 7：HIGH 风险写入不得静默自主执行。
  // 注意：该楼层只拦截"误声明 AUTO"的 HIGH 写入；POLICY_CONTROLLED + HIGH + WRITE
  // 由下方受控策略分支兜底为 REQUIRE_CONFIRMATION，语义等价——此不变量必须保持。
  if (authority === 'AUTO' && effect === 'WRITE' && risk === 'HIGH') {
    return makeDecision(definition, 'REQUIRE_CONFIRMATION', 'HIGH_RISK_WRITE_REQUIRES_CONFIRMATION');
  }

  // 受控策略：确定性规则解析
  if (authority === 'POLICY_CONTROLLED') {
    if (NON_MUTATING_EFFECTS.includes(effect)) {
      return makeDecision(definition, 'ALLOW_AUTO', 'AUTO_ALLOWED');
    }
    // WRITE（DELETE/BULK_WRITE 已被楼层 3 拦截）
    return makeDecision(definition, 'REQUIRE_CONFIRMATION', 'POLICY_CONTROLLED_REQUIRES_CONFIRMATION');
  }

  // AUTO：仅当所有更强安全楼层都不适用
  return makeDecision(definition, 'ALLOW_AUTO', 'AUTO_ALLOWED');
}
