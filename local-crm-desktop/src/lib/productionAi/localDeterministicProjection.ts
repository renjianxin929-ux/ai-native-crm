import type { SalesAgentToolResult } from '../salesAgentTools/registry';
import type { SalesAgentResponseProjection } from '../salesAgentTools/operatingLayer';
import type { GroundedClaim, ValidatedGroundedResult } from './evidenceGrounding';

/** Honest local field aggregation — never labeled as AI reasoning. */
export function projectLocalDeterministicResponse(input: {
  readonly tool_trace: readonly SalesAgentToolResult[];
  readonly evidence_refs: readonly string[];
  readonly intent: string;
}): SalesAgentResponseProjection {
  const customer = input.tool_trace.find(item => item.tool_id === 'get_customer')?.records[0] as Record<string, unknown> | undefined;
  const timeline = input.tool_trace.find(item => item.tool_id === 'get_customer_timeline');
  const memory = input.tool_trace.find(item => item.tool_id === 'get_active_memory');
  const name = typeof customer?.name === 'string' ? customer.name : '当前客户';
  const grade = typeof customer?.customer_grade === 'string' ? customer.customer_grade
    : typeof customer?.grade === 'string' ? customer.grade : '未知';
  const intentLevel = typeof customer?.intent_level === 'string' ? customer.intent_level
    : typeof customer?.intentLevel === 'string' ? customer.intentLevel : '未知';

  return {
    customer_understanding: `【本地字段汇总·非 AI 推理】${name}，等级 ${grade}，意向 ${intentLevel}。`,
    recent_changes: `【本地字段汇总】时间线记录 ${timeline?.records.length ?? 0} 条；ACTIVE Memory ${memory?.records.length ?? 0} 条。`,
    risks_and_opportunities: '【本地字段汇总】未调用大模型，不生成风险/机会推理。',
    recommended_next_step: intentRequiresModel(input.intent)
      ? '大模型当前未配置或不可用，本次未生成 AI 分析。可查看结构化 CRM 数据后重试。'
      : '根据本地 CRM 字段继续跟进；如需 AI 分析请配置 Trusted Host 模型。',
    evidence_refs: input.evidence_refs,
  };
}

function intentRequiresModel(intent: string): boolean {
  return /SUMMARY|RISK|NEXT_ACTION|FOLLOW_UP_DRAFT|INTERACTION|COMPARE|REVIEWED_FACT|EMAIL/i.test(intent);
}

export function projectValidatedModelResponse(
  result: ValidatedGroundedResult,
): SalesAgentResponseProjection {
  if (!result.valid || result.blocked) throw new Error('Invalid grounded result cannot be projected.');
  const facts = result.claims.filter(item => item.claim_type === 'crm_fact');
  const inferences = result.claims.filter(item => item.claim_type === 'model_inference');
  const recommendations = result.claims.filter(item => item.claim_type === 'recommendation');
  const drafts = result.claims.filter(item => item.claim_type === 'draft_content');
  return {
    customer_understanding: renderClaims(facts.length ? facts.slice(0, 1) : inferences.slice(0, 1)) || '无已验证客户事实',
    recent_changes: renderClaims(facts.slice(1)) || '无额外已验证变化',
    risks_and_opportunities: renderClaims(inferences) || '无模型判断',
    recommended_next_step: renderClaims(drafts.length ? drafts : recommendations) || '请人工复核后再决定下一步',
    evidence_refs: result.evidence_refs,
  };
}

function renderClaims(claims: readonly GroundedClaim[]): string {
  return claims.map(claim => {
    if (claim.grounding_status === 'UNSUPPORTED_INFERENCE') return `【模型推测 / 待确认】${claim.text}`;
    if (claim.grounding_status === 'SUPPORTED_INFERENCE') return `【有依据的模型判断】${claim.text}`;
    return `【有依据】${claim.text}`;
  }).join('；');
}

export const MODEL_UNAVAILABLE_MESSAGE = '大模型当前未配置或不可用，本次未生成 AI 分析。';
