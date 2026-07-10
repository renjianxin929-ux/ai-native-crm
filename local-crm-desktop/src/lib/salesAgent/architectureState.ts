export const STAGE3_SALES_AGENT_ARCHITECTURE_STATE = Object.freeze({
  stage: 'Stage3',
  canonical_reasoning_path: [
    'ContextSnapshot',
    'VerticalAIProfile',
    'SalesAgentRuntime',
    'ReasoningProvider',
    'AIReasoningResult',
    'EvidenceValidation',
    'HumanReviewContract',
  ] as const,
  current_provider_execution: {
    provider_kind: 'MOCK',
    execution_mode: 'MOCK',
    live_enabled: false,
  } as const,
  future_trigger_path: [
    'CRMEvent',
    'AgentTriggerBoundary',
    'SalesAgentRuntimeActivationRequest',
    'explicit_context_and_profile_resolution',
    'SalesAgentRuntime',
    'HumanReviewContract',
  ] as const,
  product_control: {
    read_only: true,
    suggest_only: true,
    human_controlled: true,
    automatic_invocation: false,
    automatic_execution: false,
    writes_crm: false,
  } as const,
});

