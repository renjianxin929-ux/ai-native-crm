import { SALES_AGENT_TOOL_REGISTRY, type SalesAgentCustomerScopedToolId, type SalesAgentReadToolContext, type SalesAgentToolResult } from './registry';
import type { SalesAgentRuntimeResult } from '../salesAgent/types';
import type { AgentIntentEnvelope } from './agentIntentEnvelope';

export interface SalesAgentPlanStep { readonly tool_id: SalesAgentCustomerScopedToolId; readonly customer_id: string; }
export type SalesAgentIntent = 'CUSTOMER_SUMMARY' | 'CUSTOMER_RISK_ANALYSIS' | 'CUSTOMER_TIMELINE_REVIEW' | 'NEXT_ACTION_PREPARATION' | 'FOLLOW_UP_DRAFT' | 'INTERACTION_SUMMARY' | 'COMPLEX_CUSTOMER_COMPARE' | 'SAFE_FALLBACK';
export interface SalesAgentPlan { readonly kind: 'SALES_AGENT_PLAN'; readonly intent: SalesAgentIntent; readonly steps: readonly SalesAgentPlanStep[]; readonly max_steps: 5; readonly safe_fallback: boolean; }
export interface SalesAgentResponseProjection { readonly customer_understanding: string; readonly recent_changes: string; readonly risks_and_opportunities: string; readonly recommended_next_step: string; readonly evidence_refs: readonly string[]; }
export interface SalesAgentInteractionResult {
  readonly plan: SalesAgentPlan;
  readonly trace: readonly SalesAgentToolResult[];
  readonly runtime: SalesAgentRuntimeResult;
  readonly response: SalesAgentResponseProjection;
  readonly evidence_refs: readonly string[];
  readonly requires_human_review: true;
  readonly executable: false;
  readonly writes_crm: false;
}

export function validateSalesAgentPlan(plan: SalesAgentPlan, customerId: string): void {
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > 5) {
    throw new Error('Sales Agent plan must contain one to five steps.');
  }
  plan.steps.forEach(step => {
    const toolId: SalesAgentCustomerScopedToolId = step.tool_id;
    if (!SALES_AGENT_TOOL_REGISTRY[toolId]) throw new Error('Sales Agent plan contains an unknown tool.');
    if (step.customer_id !== customerId) throw new Error('Sales Agent plan arguments must preserve current customer scope.');
  });
}

export function intentFromEnvelope(envelope: AgentIntentEnvelope): SalesAgentIntent {
  const intent = envelope.intent;
  return intent === 'CUSTOMER_SUMMARY' || intent === 'CUSTOMER_RISK_ANALYSIS' || intent === 'CUSTOMER_TIMELINE_REVIEW'
    || intent === 'NEXT_ACTION_PREPARATION' || intent === 'FOLLOW_UP_DRAFT' || intent === 'INTERACTION_SUMMARY'
    || intent === 'COMPLEX_CUSTOMER_COMPARE' ? intent : 'SAFE_FALLBACK';
}

export function proposeSalesAgentPlan(envelope: AgentIntentEnvelope, customerId: string): SalesAgentPlan {
  if (!envelope.normalized_instruction) throw new Error('A user message is required before Sales Agent reasoning.');
  const intent = intentFromEnvelope(envelope);
  const tools: Record<SalesAgentIntent, readonly SalesAgentCustomerScopedToolId[]> = {
    CUSTOMER_SUMMARY: ['get_customer', 'get_customer_context', 'get_active_memory'],
    CUSTOMER_RISK_ANALYSIS: ['get_customer_context', 'get_customer_timeline', 'get_active_memory', 'get_today_priority'],
    CUSTOMER_TIMELINE_REVIEW: ['get_customer', 'get_customer_timeline', 'list_customer_followups', 'list_customer_visits'],
    NEXT_ACTION_PREPARATION: ['get_customer_context', 'get_customer_timeline', 'list_customer_tasks', 'get_active_memory'],
    FOLLOW_UP_DRAFT: ['get_customer', 'get_customer_timeline', 'get_active_memory', 'get_existing_ai_results'],
    INTERACTION_SUMMARY: ['get_customer_timeline', 'get_active_memory'],
    COMPLEX_CUSTOMER_COMPARE: ['get_customer_context', 'get_customer_timeline', 'get_active_memory'],
    SAFE_FALLBACK: ['get_customer_context', 'get_active_memory'],
  };
  return {
    kind: 'SALES_AGENT_PLAN',
    intent,
    max_steps: 5,
    safe_fallback: intent === 'SAFE_FALLBACK',
    steps: tools[intent].map(tool_id => ({ tool_id, customer_id: customerId })),
  };
}

/** Retired legacy runtime helper. Production execution is SalesAgentSession -> ProductionReasoningPath. */
export async function runSalesAgentInteraction(
  message: string,
  input: SalesAgentReadToolContext & { profile_id: string },
): Promise<SalesAgentInteractionResult> {
  void message;
  void input;
  throw new Error('Legacy Sales Agent runtime was retired; use SalesAgentSession production path.');
}

export function projectSalesAgentResponse(
  runtime: SalesAgentRuntimeResult,
  trace: readonly SalesAgentToolResult[],
  evidence_refs: readonly string[],
): SalesAgentResponseProjection {
  return {
    customer_understanding: runtime.result.customer_summary.value,
    recent_changes: `${trace.find(item => item.tool_id === 'get_customer_timeline')?.records.length ?? 0} bounded timeline record(s) reviewed.`,
    risks_and_opportunities: [...runtime.result.opportunities, ...runtime.result.risks].map(item => item.summary).join(' ') || 'No additional evidence-backed risk or opportunity was returned.',
    recommended_next_step: runtime.result.next_actions[0]?.summary ?? 'Human review is required before any next step.',
    evidence_refs,
  };
}

export type DraftKind = 'follow_up_wording' | 'customer_summary' | 'call_preparation' | 'visit_preparation';
export function createSalesAgentDraft(kind: DraftKind, interaction: SalesAgentInteractionResult) {
  return {
    kind,
    content: interaction.runtime.result.customer_summary.value,
    evidence_refs: interaction.evidence_refs,
    requires_human_review: true as const,
    sent: false as const,
    written: false as const,
  };
}
export function proposeConfirmedCrmAction(interaction: SalesAgentInteractionResult) {
  return {
    proposal_only: true as const,
    requires_human_confirmation: true as const,
    executable: false as const,
    writes_crm: false as const,
    evidence_refs: interaction.evidence_refs,
  };
}
