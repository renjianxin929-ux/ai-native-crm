/**
 * Trusted Host model planner caller.
 * Models only select a capability; they never execute business writes.
 * API keys stay in the Trusted Host / provider boundary — never in frontend source.
 */

import type { ModelPlannerCaller, ModelPlannerRequest } from './runtimePlanner';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from './plannerToolSurface';

export function compactPlannerToolSurface() {
  return PRODUCTION_PLANNER_TOOL_SURFACE.map((descriptor) => ({
    capability_id: descriptor.capability_id,
    effect: descriptor.effect,
    scope: descriptor.scope_requirement,
    semantic_hint: descriptor.semantic_hint,
    required_fields: descriptor.input_schema.required_fields,
    allowed_fields: descriptor.input_schema.allowed_fields,
    fields: Object.values(descriptor.input_schema.fields).map((field) => ({
      name: field.name,
      required: field.required,
      type: field.type,
      ...(field.nullable !== undefined ? { nullable: field.nullable } : {}),
      ...(field.enum_values ? { enum_values: field.enum_values } : {}),
      ...(field.boolean_values ? { boolean_values: field.boolean_values } : {}),
      ...(field.numeric_constraint ? { numeric_constraint: field.numeric_constraint } : {}),
      ...(field.format ? { format: field.format } : {}),
    })),
  }));
}

export const PRODUCTION_PLANNER_SYSTEM_PROMPT = [
  '你是 CRM 能力选择器。根据用户指令，从工具清单中选择恰好一个能力。',
  '只返回严格 JSON（不要 markdown 代码块、不要多余文字）：',
  '  选中执行：{"kind":"invoke","capability_id":"<id>","arguments":{...}}',
  '  信息缺失：{"kind":"clarify","capability_id":"<id或null>","clarification_question":"...","missing_fields":["..."]}',
  '规则：写/删除能力只选不执行；arguments 只在用户明确给出时填写，绝不编造金额/时间/ID/事实；',
  '“广州客户有哪些”表示名称包含广州，不是 region=广州；只有“广州地区/位于广州”才是地区过滤。',
  '新建客户时：公司名是 name，老板/对接人/联系人是 contact_person；名称里出现的城市不是 region。',
  'follow_up.create 只用于已经发生的跟进；纯未来安排用 customer.next_follow_up_time.update。',
  '上次联系/什么时候联系 选 timeline.customer.read，不要选客户分析摘要。',
  '字段约束：enum_values 只能取其中之一；必填缺失必须 clarify。',
].join('\n');

export function buildPlannerUserPrompt(request: ModelPlannerRequest): string {
  return `当前客户ID=${request.customer_id ?? '(无)'}。\n工具清单=${JSON.stringify(compactPlannerToolSurface())}\n\n指令：${request.instruction}`;
}

export function parsePlannerModelText(content: string): unknown {
  const stripped = content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`无法解析模型 JSON: ${stripped.slice(0, 120)}`);
  }
}

export function createTrustedHostModelPlannerCaller(
  completeText: (prompt: { readonly system: string; readonly user: string }, signal?: AbortSignal) => Promise<string>,
): ModelPlannerCaller {
  return async (request, signal) => {
    const content = await completeText({
      system: PRODUCTION_PLANNER_SYSTEM_PROMPT,
      user: buildPlannerUserPrompt(request),
    }, signal);
    return parsePlannerModelText(content);
  };
}
