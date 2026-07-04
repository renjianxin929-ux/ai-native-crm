import type { EvalCandidateOutput, EvalCandidateParsedOutput } from './evalRunnerReadiness';
import type { ModelRouteCapability, NoopModelRoute } from './modelRouterReadiness';
import { getFixtureModelProviderResponse } from './modelRouterRuntime/modelInvocationFixturesV1';
import type { PromptRuntimePlan, PromptRuntimePurpose } from './promptRuntimeReadiness';

export const MODEL_ROUTER_RUNTIME_VERSION = 'v1';

export interface ModelProviderAdapter {
  kind: 'MODEL_PROVIDER_ADAPTER';
  adapter_id: string;
  declared_capabilities: ModelRouteCapability[];
  not_real_provider: true;
  network_allowed: false;
  represents_real_model: false;
  fixture_only: true;
}

export interface FixtureModelProviderAdapter extends ModelProviderAdapter {
  adapter_id: 'fixture_v1';
  fixture_model_id: 'fixture-model-v1';
  fixture_provider_id: 'fixture_provider_v1';
}

export interface ModelInvocationRequest {
  kind: 'MODEL_INVOCATION_REQUEST';
  purpose: PromptRuntimePurpose;
  prompt_id: string;
  prompt_version: PromptRuntimePlan['prompt_version'];
  rendered_prompt_count: number;
  eval_sample_id: string | null;
}

export interface ModelRouteCapabilityMatch {
  matched: boolean;
  required_capabilities: ModelRouteCapability[];
  adapter_capabilities: ModelRouteCapability[];
  missing_capabilities: ModelRouteCapability[];
  error_code: 'capability_mismatch' | null;
  provider_error: false;
}

export interface ModelInvocationPlan {
  kind: 'MODEL_INVOCATION_PLAN';
  runtime_version: typeof MODEL_ROUTER_RUNTIME_VERSION;
  executable: false;
  fixture_execution_allowed: true;
  persisted: false;
  reason: 'model_router_runtime_readiness_only';
  prompt_plan: PromptRuntimePlan;
  request: ModelInvocationRequest;
  adapter_snapshot: FixtureModelProviderAdapter;
  route_snapshot: NoopModelRoute;
  capability_match: ModelRouteCapabilityMatch;
  capability_errors: ModelInvocationError[];
}

export interface ModelProviderResponse {
  kind: 'MODEL_PROVIDER_RESPONSE';
  fixture_source: 'model_invocation_fixture_v1';
  raw_output: string;
  parsed: EvalCandidateParsedOutput | null;
  parse_error?: string;
  represents_real_model_output: false;
}

export interface ModelInvocationSafety {
  network_allowed: false;
  fixture_only: true;
  represents_real_model_call: false;
}

export interface ModelInvocationMetrics {
  token_usage: {
    fixture: true;
    input_tokens: null;
    output_tokens: null;
    total_tokens: null;
  };
  cost_usd: null;
  latency_ms: null;
}

export interface ModelInvocationError {
  code: 'capability_mismatch' | 'fixture_missing';
  message: string;
  provider_error: false;
}

export interface ModelInvocationResult {
  kind: 'MODEL_INVOCATION_RESULT';
  runtime_version: typeof MODEL_ROUTER_RUNTIME_VERSION;
  executable: false;
  persisted: false;
  request: ModelInvocationRequest;
  route_snapshot: NoopModelRoute;
  adapter_snapshot: FixtureModelProviderAdapter;
  response: ModelProviderResponse;
  safety: ModelInvocationSafety;
  metrics: ModelInvocationMetrics;
  error: ModelInvocationError | null;
  represents_model_quality: false;
}

export interface ModelInvocationTrace {
  kind: 'MODEL_INVOCATION_TRACE';
  plan: ModelInvocationPlan;
  result: ModelInvocationResult;
  persisted: false;
}

export function matchRouteCapabilities(
  route: NoopModelRoute,
  adapter: Pick<ModelProviderAdapter, 'declared_capabilities'>,
): ModelRouteCapabilityMatch {
  const missing = route.required_capabilities.filter(
    capability => !adapter.declared_capabilities.includes(capability),
  );

  return {
    matched: missing.length === 0,
    required_capabilities: [...route.required_capabilities],
    adapter_capabilities: [...adapter.declared_capabilities],
    missing_capabilities: missing,
    error_code: missing.length === 0 ? null : 'capability_mismatch',
    provider_error: false,
  };
}

export function buildModelInvocationPlan(
  promptPlan: PromptRuntimePlan,
  adapter: FixtureModelProviderAdapter,
): ModelInvocationPlan {
  const capabilityMatch = matchRouteCapabilities(promptPlan.route, adapter);
  const capabilityErrors = capabilityMatch.matched ? [] : [capabilityMismatchError(capabilityMatch)];

  return {
    kind: 'MODEL_INVOCATION_PLAN',
    runtime_version: MODEL_ROUTER_RUNTIME_VERSION,
    executable: false,
    fixture_execution_allowed: true,
    persisted: false,
    reason: 'model_router_runtime_readiness_only',
    prompt_plan: promptPlan,
    request: {
      kind: 'MODEL_INVOCATION_REQUEST',
      purpose: promptPlan.purpose,
      prompt_id: promptPlan.prompt_id,
      prompt_version: promptPlan.prompt_version,
      rendered_prompt_count: promptPlan.rendered_prompts.length,
      eval_sample_id: promptPlan.eval_sample_id ?? null,
    },
    adapter_snapshot: {
      ...adapter,
      declared_capabilities: [...adapter.declared_capabilities],
    },
    route_snapshot: {
      ...promptPlan.route,
      required_capabilities: [...promptPlan.route.required_capabilities],
      executable: false,
      selected_model_id: null,
      selected_provider: null,
    },
    capability_match: capabilityMatch,
    capability_errors: capabilityErrors,
  };
}

export function invokeWithFixtureAdapter(plan: ModelInvocationPlan): ModelInvocationResult {
  if (!plan.capability_match.matched) {
    return buildResult(plan, emptyFixtureResponse(), capabilityMismatchError(plan.capability_match));
  }

  const response = getFixtureModelProviderResponse(plan);
  if (!response) {
    return buildResult(plan, emptyFixtureResponse(), {
      code: 'fixture_missing',
      message: `No fixture response for ${plan.request.eval_sample_id ?? plan.request.purpose}`,
      provider_error: false,
    });
  }

  return buildResult(plan, response, null);
}

export function modelInvocationResultToEvalCandidateOutput(
  result: ModelInvocationResult,
): EvalCandidateOutput {
  return {
    kind: 'EVAL_CANDIDATE_OUTPUT',
    sample_id: result.request.eval_sample_id ?? result.request.purpose,
    raw_output: result.response.raw_output,
    parsed: result.response.parsed,
    parse_error: result.response.parse_error,
    source: 'fixture_v1',
    synthetic: true,
    fixture_only: true,
    model_output: false,
  };
}

function buildResult(
  plan: ModelInvocationPlan,
  response: ModelProviderResponse,
  error: ModelInvocationError | null,
): ModelInvocationResult {
  return {
    kind: 'MODEL_INVOCATION_RESULT',
    runtime_version: MODEL_ROUTER_RUNTIME_VERSION,
    executable: false,
    persisted: false,
    request: plan.request,
    route_snapshot: plan.route_snapshot,
    adapter_snapshot: plan.adapter_snapshot,
    response,
    safety: {
      network_allowed: false,
      fixture_only: true,
      represents_real_model_call: false,
    },
    metrics: {
      token_usage: {
        fixture: true,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
      },
      cost_usd: null,
      latency_ms: null,
    },
    error,
    represents_model_quality: false,
  };
}

function emptyFixtureResponse(): ModelProviderResponse {
  return {
    kind: 'MODEL_PROVIDER_RESPONSE',
    fixture_source: 'model_invocation_fixture_v1',
    raw_output: '',
    parsed: null,
    represents_real_model_output: false,
  };
}

function capabilityMismatchError(match: ModelRouteCapabilityMatch): ModelInvocationError {
  return {
    code: 'capability_mismatch',
    message: `Missing capabilities: ${match.missing_capabilities.join(', ')}`,
    provider_error: false,
  };
}
