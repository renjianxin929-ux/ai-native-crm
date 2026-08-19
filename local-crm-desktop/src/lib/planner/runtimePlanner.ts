/**
 * V0.2C / C1.7 — Runtime planner（唯一中央运行时 planner 接线点）.
 *
 * 把"模型/确定性选择能力"接到真实运行时的唯一入口：
 *   1) 先跑 slim 确定性选择器（模型不可用也安全的高置信捷径）；
 *   2) 未命中且模型可用 → 把 registry 派生的安全工具面交给模型，
 *      模型只返回结构化能力选择（capability_id + arguments / clarification），
 *      绝不执行任何业务；
 *   3) 选择结果经 capabilitySelectionRouter → 生产引擎 A10 → 确认 → 执行器。
 *
 * 硬性不变量：
 *   - 模型只"选"能力，绝不直接执行（MODEL_SELECTION_BYPASSES_A10=false）；
 *   - 未知 capability_id fail-closed；
 *   - 模型输出经闭合校验，绝不信任任意工具名。
 */

import type { DatabaseLike } from '../db';
import { createAgentIntentEnvelope, isReadOnlyReasoningIntent } from '../salesAgentTools/agentIntentEnvelope';
import { selectCapabilityDeterministic } from './deterministicCapabilitySelector';
import type { PlannerSelectionResult, CapabilitySelection } from './capabilitySelectionRouter';
import { PRODUCTION_PLANNER_TOOL_SURFACE, findPlannerTool } from './plannerToolSurface';

/** 模型 planner 的输入：安全工具面 + 用户指令 + 当前客户 scope。 */
export interface ModelPlannerRequest {
  readonly tool_surface: typeof PRODUCTION_PLANNER_TOOL_SURFACE;
  readonly instruction: string;
  readonly customer_id: string | null;
}

/** 模型 planner 调用器（由 Trusted Host adapter 提供；模型只选能力不执行）。 */
export type ModelPlannerCaller = (request: ModelPlannerRequest, signal?: AbortSignal) => Promise<unknown>;

export interface RuntimePlannerDeps {
  readonly db?: DatabaseLike;
  readonly modelSelect?: ModelPlannerCaller;
}

/** 校验模型返回的结构化能力选择（闭合 schema + 未知 id fail-closed）。 */
export function validateModelPlannerOutput(raw: unknown): PlannerSelectionResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'unknown', reason: '模型选择输出无效。' };
  }
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (kind === 'invoke') {
    const capability_id = typeof value.capability_id === 'string' ? value.capability_id : '';
    const tool = findPlannerTool(capability_id);
    if (!tool) return { kind: 'unknown', reason: `未知能力：${capability_id || '(空)'}` };
    const args = value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments)
      ? (value.arguments as Record<string, unknown>)
      : {};
    // 模型可能"选中能力但漏填必填字段"（如"写个跟进"漏 content）→ 转澄清，绝不把缺参当执行。
    const missing = tool.input_schema.required_fields.filter((field) => {
      const slot = args[field];
      return slot === undefined || slot === null || slot === '';
    });
    if (missing.length > 0) {
      return {
        kind: 'clarify',
        clarification: {
          capability_id,
          clarification_question: `请补充缺失信息：${missing.join('、')}。`,
          missing_fields: missing,
          known_arguments: args,
        },
      };
    }
    const selection: CapabilitySelection = { capability_id, arguments: args };
    return { kind: 'invoke', selection };
  }
  if (kind === 'clarify') {
    const known = value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments)
      ? (value.arguments as Record<string, unknown>)
      : value.known_arguments && typeof value.known_arguments === 'object' && !Array.isArray(value.known_arguments)
        ? (value.known_arguments as Record<string, unknown>)
        : undefined;
    return {
      kind: 'clarify',
      clarification: {
        capability_id: typeof value.capability_id === 'string' ? value.capability_id : null,
        clarification_question: typeof value.clarification_question === 'string' ? value.clarification_question : '请补充必要信息。',
        missing_fields: Array.isArray(value.missing_fields) ? value.missing_fields.filter((f): f is string => typeof f === 'string') : [],
        ...(known ? { known_arguments: known } : {}),
      },
    };
  }
  return { kind: 'unknown', reason: '模型选择无法识别。' };
}

/**
 * 运行时规划：确定性捷径优先，未命中则模型（携带 registry 工具面）。
 * 返回 capability 选择 / 澄清 / unknown。
 */
export async function planCapability(
  utterance: string,
  nowIso: string,
  scopedCustomerId: string | null,
  deps: RuntimePlannerDeps,
): Promise<PlannerSelectionResult> {
  const deterministic = selectCapabilityDeterministic({
    utterance,
    now_iso: nowIso,
    scoped_customer_id: scopedCustomerId,
    db: deps.db,
  });
  if (deterministic.kind !== 'unknown') return deterministic;

  // Analysis / review / recommendation is not a CRM capability pick.
  // Do not send safely non-mutating reasoning to the model planner.
  if (isReadOnlyReasoningIntent(createAgentIntentEnvelope(utterance, nowIso))) {
    return { kind: 'unknown', reason: 'read_only_reasoning' };
  }

  if (!deps.modelSelect) {
    return { kind: 'unknown', reason: '当前 AI 模型不可用，无法可靠解释该请求；请配置模型后重试。' };
  }
  try {
    const raw = await deps.modelSelect({
      tool_surface: PRODUCTION_PLANNER_TOOL_SURFACE,
      instruction: utterance,
      customer_id: scopedCustomerId,
    });
    return coerceModelPlannerOutput(raw);
  } catch {
    return { kind: 'unknown', reason: '模型选择失败；请求未执行，CRM 未变更。' };
  }
}

function isValidatedPlannerSelection(raw: unknown): raw is PlannerSelectionResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'invoke') {
    const selection = value.selection;
    return Boolean(
      selection
      && typeof selection === 'object'
      && !Array.isArray(selection)
      && typeof (selection as { capability_id?: unknown }).capability_id === 'string',
    );
  }
  if (value.kind === 'clarify') {
    return Boolean(value.clarification && typeof value.clarification === 'object' && !Array.isArray(value.clarification));
  }
  return value.kind === 'unknown' && typeof value.reason === 'string';
}

/** Accept raw model JSON or an already-validated planner result. Never re-validate the latter. */
function coerceModelPlannerOutput(raw: unknown): PlannerSelectionResult {
  if (isValidatedPlannerSelection(raw)) return raw;
  return validateModelPlannerOutput(raw);
}
