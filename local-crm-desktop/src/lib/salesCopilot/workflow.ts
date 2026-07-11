import { runSalesAgentRuntime } from '../salesAgent/runtime';
import type { SalesAgentRuntimeResult } from '../salesAgent/types';
import type {
  SalesCopilotSafetyBoundary,
  SalesCopilotWorkflowRequest,
  SalesCopilotWorkflowResult,
  SalesPriorityItem,
} from './types';

const SAFE_RESULT: SalesCopilotSafetyBoundary = Object.freeze({
  read_only: true,
  requires_human_review: true,
  executable: false,
  writes_crm: false,
  creates_task: false,
  sends_message: false,
  persists_result: false,
});

export async function runSalesCopilotWorkflow(request: SalesCopilotWorkflowRequest): Promise<SalesCopilotWorkflowResult> {
  if (!request.request_id.trim()) throw new Error('Copilot workflow request id is required.');
  if (request.kind === 'sales_priority' && request.provider.capability.executionMode === 'LIVE') throw new Error('Sales Priority remains MOCK-only in the Live Reasoning Activation Gate.');
  if (request.kind === 'customer_intelligence') {
    return {
      kind: request.kind,
      ...SAFE_RESULT,
      runtime: await runRuntime(request, request.context, 'Assess this customer and recommend evidence-backed next actions.'),
    };
  }
  if (request.kind === 'sales_priority') {
    if (request.contexts.length === 0) throw new Error('Sales Priority requires at least one customer context.');
    const candidates = await Promise.all(request.contexts.map((context, index) =>
      runRuntime(
        { ...request, request_id: `${request.request_id}:customer-${index + 1}` },
        context,
        'Assess this customer for explainable frontline-sales priority.',
      )));
    const ranked = candidates
      .map(runtime => ({ runtime, score: priorityScore(runtime) }))
      .toSorted((left, right) => right.score - left.score || left.runtime.request_id.localeCompare(right.runtime.request_id));
    return {
      kind: request.kind,
      ...SAFE_RESULT,
      items: ranked.map(({ runtime, score }, index) => projectPriorityItem(runtime, score, index + 1)),
    };
  }
  if (request.explicitly_activated !== true) throw new Error('Interaction Intelligence requires explicit manual activation.');
  if (request.trigger.status !== 'request_created_not_invoked' || request.trigger.runtime_request.runtime_invoked !== false) {
    throw new Error('Interaction trigger must remain inert before explicit Copilot activation.');
  }
  const sourceEventId = request.trigger.runtime_request.source_event_id;
  const sourceInteractionId = request.trigger.intent.source_event.kind === 'InteractionAddedEvent'
    ? request.trigger.intent.source_event.interaction_id
    : null;
  if (!sourceInteractionId || !request.context.recentInteractions.some(item => item.interactionId === sourceInteractionId)) {
    throw new Error('Interaction activation must resolve its source interaction in the supplied context.');
  }
  return {
    kind: request.kind,
    ...SAFE_RESULT,
    activation_request_id: request.trigger.runtime_request.request_id,
    source_event_id: sourceEventId,
    activation_mode: 'explicit_manual',
    detection_categories: ['new_opportunity_signal', 'elevated_risk', 'follow_up_need', 'stage_change_possibility', 'missing_information'],
    runtime: await runRuntime(request, request.context, `Reassess the customer after interaction ${sourceInteractionId}.`),
  };
}

function runRuntime(
  request: Pick<SalesCopilotWorkflowRequest, 'request_id' | 'profile_id' | 'provider' | 'clock' | 'live_activation'>,
  context: Parameters<typeof runSalesAgentRuntime>[0]['context'],
  objective: string,
) {
  return runSalesAgentRuntime({
    request_id: request.request_id,
    objective,
    context,
    profile_id: request.profile_id,
    provider: request.provider,
    live_activation: request.live_activation,
    clock: request.clock,
  });
}

function priorityScore(runtime: SalesAgentRuntimeResult): number {
  return runtime.result.confidence.value + runtime.result.opportunities.length * 0.1 + runtime.result.risks.length * 0.15;
}

function projectPriorityItem(runtime: SalesAgentRuntimeResult, score: number, rank: number): SalesPriorityItem {
  const customerEvidence = runtime.result.evidence.find(item => item.fact_type === 'customer');
  const nextAction = runtime.result.next_actions[0];
  if (!customerEvidence || !nextAction) throw new Error('Priority projection requires customer evidence and a next action.');
  const name = runtime.result.customer_summary.value.split(' is currently')[0];
  return {
    ...SAFE_RESULT,
    customer_id: customerEvidence.fact_id,
    customer_name: name,
    rank,
    priority_level: score >= 1 ? 'high' : score >= 0.75 ? 'medium' : 'normal',
    priority_reason: `${runtime.result.customer_stage.value} stage with ${runtime.result.opportunities.length} opportunity signal(s) and ${runtime.result.risks.length} risk signal(s).`,
    priority_reason_evidence_ids: runtime.result.customer_stage.evidence_ids,
    opportunities: runtime.result.opportunities,
    risks: runtime.result.risks,
    recommended_next_action: nextAction,
    confidence: runtime.result.confidence,
    evidence: runtime.result.evidence,
    selected_profile_id: runtime.profile_id,
    review_status: 'pending_human_review',
    runtime,
  };
}
