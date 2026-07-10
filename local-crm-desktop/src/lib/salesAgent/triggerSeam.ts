export type SalesAgentTriggerEvent =
  | { kind: 'CustomerCreatedEvent'; event_id: string; occurred_at: string; customer_id: string }
  | { kind: 'InteractionAddedEvent'; event_id: string; occurred_at: string; customer_id: string; interaction_id: string }
  | { kind: 'CustomerUpdatedEvent'; event_id: string; occurred_at: string; customer_id: string; changed_fields: readonly string[] };

export interface SalesAgentTriggerIntent {
  kind: 'SALES_AGENT_TRIGGER_INTENT';
  version: 'v1';
  source_event: SalesAgentTriggerEvent;
  target_customer_id: string;
  status: 'not_scheduled';
  requires_explicit_runtime_invocation: true;
  automatic_execution: false;
  background_worker: false;
  sends_notification: false;
  writes_crm: false;
}

export interface SalesAgentRuntimeActivationRequest {
  kind: 'SALES_AGENT_RUNTIME_ACTIVATION_REQUEST';
  version: 'v1';
  request_id: string;
  objective: 'assess_customer_after_crm_event';
  target_customer_id: string;
  source_event_id: string;
  requested_execution_mode: 'MOCK';
  context_resolution: 'required_before_explicit_runtime_invocation';
  profile_resolution: 'required_before_explicit_runtime_invocation';
  requires_human_review: true;
  runtime_invoked: false;
  writes_crm: false;
}

export interface AgentTriggerBoundaryResult {
  kind: 'AGENT_TRIGGER_BOUNDARY_RESULT';
  version: 'v1';
  intent: SalesAgentTriggerIntent;
  runtime_request: SalesAgentRuntimeActivationRequest;
  next_boundary: 'SalesAgentRuntime';
  final_boundary: 'HumanReviewContract';
  status: 'request_created_not_invoked';
}

export function createSalesAgentTriggerIntent(event: SalesAgentTriggerEvent): SalesAgentTriggerIntent {
  if (!event.event_id.trim() || !event.customer_id.trim() || !Number.isFinite(Date.parse(event.occurred_at))) {
    throw new Error('Sales Agent trigger event requires valid identity, customer, and timestamp.');
  }
  return {
    kind: 'SALES_AGENT_TRIGGER_INTENT',
    version: 'v1',
    source_event: event,
    target_customer_id: event.customer_id,
    status: 'not_scheduled',
    requires_explicit_runtime_invocation: true,
    automatic_execution: false,
    background_worker: false,
    sends_notification: false,
    writes_crm: false,
  };
}

export function createAgentTriggerBoundary(event: SalesAgentTriggerEvent): AgentTriggerBoundaryResult {
  const intent = createSalesAgentTriggerIntent(event);
  return {
    kind: 'AGENT_TRIGGER_BOUNDARY_RESULT',
    version: 'v1',
    intent,
    runtime_request: {
      kind: 'SALES_AGENT_RUNTIME_ACTIVATION_REQUEST',
      version: 'v1',
      request_id: `trigger:${event.event_id}`,
      objective: 'assess_customer_after_crm_event',
      target_customer_id: event.customer_id,
      source_event_id: event.event_id,
      requested_execution_mode: 'MOCK',
      context_resolution: 'required_before_explicit_runtime_invocation',
      profile_resolution: 'required_before_explicit_runtime_invocation',
      requires_human_review: true,
      runtime_invoked: false,
      writes_crm: false,
    },
    next_boundary: 'SalesAgentRuntime',
    final_boundary: 'HumanReviewContract',
    status: 'request_created_not_invoked',
  };
}

