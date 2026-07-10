export const SALES_AGENT_CANONICAL_AI_PATH = Object.freeze({
  entry_point: 'runSalesAgentRuntime',
  status: 'canonical_future_ai_reasoning_entry_point',
  owns: ['context_input', 'profile_resolution', 'provider_invocation', 'result_validation'] as const,
  legacy_read_only_path: 'ReadOnlyAgent/SuggestOnly rules remain available as legacy non-provider suggestions',
  current_execution_mode: 'MOCK',
  future_trigger_entry: 'AgentTriggerBoundary creates requests but never invokes SalesAgentRuntime',
  automatic_execution: false,
  writes_crm: false,
});
