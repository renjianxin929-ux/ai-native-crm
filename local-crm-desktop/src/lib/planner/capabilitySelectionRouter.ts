/**
 * V0.2C / C1.6 — Capability selection routing (model/deterministic → A10 → engine).
 *
 * 单一职责：把 planner 的选择（model 或确定性回退产出的 capability_id + arguments）
 * 校验后交给生产统一执行引擎（PRODUCTION_CAPABILITY_EXECUTION.invoke）。
 *
 * 硬性不变量：
 *   - 选择只"选中"能力，绝不直接执行：所有写/删除都必须经过引擎的
 *     Input validation → Scope validation → A10 → 确认交接 → 现有执行器；
 *   - MODEL_SELECTION_BYPASSES_A10=false；
 *   - MODEL_SELECTION_BYPASSES_CONFIRMATION=false（写/删除仍需 REQUIRE_CONFIRMATION /
 *     REQUIRE_STRONG_CONFIRMATION，引擎 A10 保证）；
 *   - 未知 capability_id → fail-closed（INVALID_SELECTION），绝不猜测；
 *   - customer.delete 的 effect=DELETE → 引擎 A10 必产出 REQUIRE_STRONG_CONFIRMATION。
 */

import {
  PRODUCTION_CAPABILITY_EXECUTION,
  PRODUCTION_CAPABILITY_REGISTRY,
  type CapabilityExecutionOutcome,
  type CapabilityInvocationScope,
} from '../capabilities/execution';
import { findPlannerTool } from './plannerToolSurface';

/** 一个被选中的能力：capability_id + 待校验参数（参数形状由引擎 Layer-1 权威校验）。 */
export interface CapabilitySelection {
  readonly capability_id: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** 澄清结果：已知能力但缺必要上下文，或未知意图。 */
export interface CapabilityClarification {
  readonly capability_id: string | null;
  readonly clarification_question: string;
  readonly missing_fields: readonly string[];
  /** Legitimate business fields already known; never runtime metadata. */
  readonly known_arguments?: Readonly<Record<string, unknown>>;
}

export type PlannerSelectionResult =
  | { readonly kind: 'invoke'; readonly selection: CapabilitySelection }
  | { readonly kind: 'clarify'; readonly clarification: CapabilityClarification }
  | { readonly kind: 'unknown'; readonly reason: string };

/**
 * 校验并路由一个能力选择到生产引擎（唯一公开执行面）。
 * 返回引擎 outcome：READ/ANALYZE/DRAFT → 结果；WRITE/DELETE → CONFIRMATION_REQUIRED /
 * STRONG_CONFIRMATION_REQUIRED（业务执行器调用数 = 0）；非法输入 → EXECUTION_ERROR。
 */
export async function routeCapabilitySelection(
  selection: CapabilitySelection,
  scope: CapabilityInvocationScope,
): Promise<CapabilityExecutionOutcome> {
  const tool = findPlannerTool(selection.capability_id);
  if (!tool) {
    throw new Error(`Unknown production capability selected: ${selection.capability_id}`);
  }
  // 生产 Registry 仍为唯一真源：工具面命中后，再从 Registry 校验身份存在。
  PRODUCTION_CAPABILITY_REGISTRY.get(selection.capability_id, tool.version);
  return PRODUCTION_CAPABILITY_EXECUTION.invoke({
    capability_id: selection.capability_id,
    capability_version: tool.version,
    input: selection.arguments,
    scope,
  });
}

/** 预检所选能力的 A10 决策（不执行，只用于路由/测试/UI 展示确认等级）。 */
export function previewAuthorityForSelection(capabilityId: string): 'AUTO' | 'REQUIRE_CONFIRMATION' | 'REQUIRE_STRONG_CONFIRMATION' | 'DENY' {
  const tool = findPlannerTool(capabilityId);
  if (!tool) return 'DENY';
  if (tool.effect === 'DELETE' || tool.effect === 'BULK_WRITE') return 'REQUIRE_STRONG_CONFIRMATION';
  if (tool.requires_confirmation || tool.effect === 'WRITE' || tool.effect === 'DRAFT') {
    return tool.authority_policy === 'AUTO' && tool.effect === 'DRAFT' ? 'AUTO' : 'REQUIRE_CONFIRMATION';
  }
  return 'AUTO';
}
