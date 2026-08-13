import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext } from '../customerMemory';
import type { SalesAgentToolResult } from '../salesAgentTools/registry';
import type { SalesAgentResponseProjection } from '../salesAgentTools/operatingLayer';
import { resolveCapabilityRoute, type CapabilityRoutingEntry } from './capabilityRoutingMatrix';
import { buildModelContextEnvelope, type ModelContextEnvelope } from './modelContextEnvelope';
import { validateModelOutputSchema, type SchemaValidationResult, type ValidatedModelOutput } from './modelOutputSchemas';
import { validateGroundedClaims, type ValidatedGroundedResult } from './evidenceGrounding';
import { mapProviderError, buildRedactedProviderLog, type ProviderErrorCategory } from './providerErrorMapping';
import { buildRuntimeDetails, type ProductionRuntimeDetails, type ProductionRuntimeMode } from './runtimeMode';
import { MODEL_UNAVAILABLE_MESSAGE, projectLocalDeterministicResponse, projectValidatedModelResponse } from './localDeterministicProjection';

export interface ProductionModelCallResult {
  readonly output: unknown;
  readonly provider_kind: string;
  readonly model_id: string;
  readonly request_id: string;
  readonly latency_ms: number | null;
  readonly token_usage: ProductionRuntimeDetails['token_usage'];
}

export type ProductionModelCaller = (input: {
  readonly envelope: ModelContextEnvelope;
  readonly capability: 'TEXT_REASONING' | 'VISION_ANALYSIS';
  readonly attempt: 'initial' | 'repair';
  readonly validation_errors: readonly string[];
  readonly signal?: AbortSignal;
}) => Promise<ProductionModelCallResult>;

export interface ProductionReasoningPathInput {
  readonly request_id: string;
  readonly intent: string;
  readonly message: string;
  readonly customer_id: string;
  readonly customer_allowlist?: readonly string[];
  readonly context: ContextSnapshot;
  readonly memory?: CustomerMemoryContext;
  readonly tool_trace: readonly SalesAgentToolResult[];
  readonly callModel?: ProductionModelCaller;
  readonly signal?: AbortSignal;
  readonly clock?: () => number;
}

export interface ProductionReasoningPathResult {
  readonly structured: SalesAgentResponseProjection;
  readonly evidence_refs: readonly string[];
  readonly runtime: ProductionRuntimeDetails;
  readonly validated_output: ValidatedModelOutput | null;
  readonly grounded_result: ValidatedGroundedResult | null;
  readonly blocked_message: string | null;
  readonly log: ReturnType<typeof buildRedactedProviderLog>;
}

const MODEL_LOCKS = new Map<string, string>();

export function acquireSessionModelLock(sessionKey: string, requestId: string): boolean {
  const existing = MODEL_LOCKS.get(sessionKey);
  if (existing && existing !== requestId) return false;
  MODEL_LOCKS.set(sessionKey, requestId);
  return true;
}

export function releaseSessionModelLock(sessionKey: string, requestId: string): void {
  if (MODEL_LOCKS.get(sessionKey) === requestId) MODEL_LOCKS.delete(sessionKey);
}

export async function runProductionReasoningPath(input: ProductionReasoningPathInput): Promise<ProductionReasoningPathResult> {
  const route = resolveCapabilityRoute(input.intent);
  const toolEvidence = [...new Set(input.tool_trace.flatMap(item => item.evidence_refs))];
  const started = input.clock?.() ?? Date.now();

  if (!route.requires_real_model) {
    return finish({
      input, route,
      structured: projectLocalDeterministicResponse({ tool_trace: input.tool_trace, evidence_refs: toolEvidence, intent: route.intent }),
      evidence_refs: toolEvidence,
      runtime_mode: 'LOCAL_DETERMINISTIC', model_called: false, provider: null, model: null,
      latency_ms: elapsed(input, started), token_usage: null, degraded: false, degradation_reason: null,
      validation_status: 'not_applicable', evidence_validation_status: 'not_applicable', cancellation_status: 'not_requested',
      validated_output: null, blocked_message: null, success: true, failure_category: null,
    });
  }

  if (!input.callModel) return unavailable(input, route, toolEvidence, started, mapProviderError('unconfigured'));
  if (input.signal?.aborted) return unavailable(input, route, toolEvidence, started, mapProviderError('cancelled'));

  let envelope: ModelContextEnvelope;
  try {
    envelope = buildModelContextEnvelope({
      request_id: input.request_id,
      intent: route.intent,
      output_schema: route.output_schema,
      user_instruction: input.message,
      customer_id: input.customer_id,
      customer_allowlist: input.customer_allowlist,
      context: input.context,
      memory: input.memory,
      tool_trace: input.tool_trace,
    });
  } catch (error) {
    return unavailable(input, route, toolEvidence, started, mapProviderError(error));
  }

  const capability = route.model_capability === 'VISION_ANALYSIS' ? 'VISION_ANALYSIS' as const : 'TEXT_REASONING' as const;
  try {
    let call = await input.callModel({ envelope, capability, attempt: 'initial', validation_errors: [], signal: input.signal });
    assertUiCommitAllowed(input.signal);
    let schema = validateModelOutputSchema(route.output_schema, call.output);
    assertUiCommitAllowed(input.signal);

    // Exactly one controlled repair. It keeps the same intent, context and evidence set.
    if (!schema.valid) {
      const repairEnvelope: ModelContextEnvelope = { ...envelope, request_id: `${input.request_id}:repair-1` };
      call = await input.callModel({
        envelope: repairEnvelope,
        capability,
        attempt: 'repair',
        validation_errors: schema.errors.slice(0, 12),
        signal: input.signal,
      });
      assertUiCommitAllowed(input.signal);
      schema = validateModelOutputSchema(route.output_schema, call.output);
      assertUiCommitAllowed(input.signal);
    }

    if (!schema.valid || !schema.output) {
      return invalidResult(input, route, toolEvidence, started, call, 'invalid_schema', schema, []);
    }

    const grounding = validateGroundedClaims({
      output: schema.output,
      envelope,
      scoped_customer_id: input.customer_id,
      allowed_customer_ids: route.intent === 'COMPLEX_CUSTOMER_COMPARE'
        ? [...(input.customer_allowlist ?? [])]
        : [input.customer_id],
    });
    assertUiCommitAllowed(input.signal);
    if (!grounding.valid) {
      return invalidResult(input, route, toolEvidence, started, call, 'invalid_evidence', schema, grounding.errors);
    }

    const structured = projectValidatedModelResponse(grounding);
    assertUiCommitAllowed(input.signal);
    return finish({
      input, route, structured, evidence_refs: grounding.evidence_refs,
      runtime_mode: 'REAL_MODEL', model_called: true, provider: call.provider_kind, model: call.model_id,
      latency_ms: call.latency_ms ?? elapsed(input, started), token_usage: call.token_usage,
      degraded: false, degradation_reason: null, validation_status: 'passed', evidence_validation_status: 'passed',
      cancellation_status: 'not_requested', validated_output: schema.output, grounded_result: grounding, blocked_message: null,
      success: true, failure_category: null, request_id_override: call.request_id,
    });
  } catch (error) {
    return unavailable(input, route, toolEvidence, started, mapProviderError(error));
  }
}

function assertUiCommitAllowed(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('cancelled');
}

function invalidResult(
  input: ProductionReasoningPathInput,
  route: CapabilityRoutingEntry,
  toolEvidence: readonly string[],
  started: number,
  call: ProductionModelCallResult,
  category: 'invalid_schema' | 'invalid_evidence',
  schema: SchemaValidationResult,
  evidenceErrors: readonly string[],
): ProductionReasoningPathResult {
  const mapped = mapProviderError(category);
  const structured = projectLocalDeterministicResponse({ tool_trace: input.tool_trace, evidence_refs: toolEvidence, intent: route.intent });
  return finish({
    input, route, structured, evidence_refs: [], runtime_mode: 'REAL_MODEL', model_called: true,
    provider: call.provider_kind, model: call.model_id, latency_ms: call.latency_ms ?? elapsed(input, started), token_usage: call.token_usage,
    degraded: true, degradation_reason: `${category}:${[...schema.errors, ...evidenceErrors].slice(0, 6).join('|')}`,
    validation_status: category === 'invalid_schema' ? 'failed' : 'passed',
    evidence_validation_status: category === 'invalid_evidence' ? 'failed' : 'not_applicable',
    cancellation_status: 'not_requested', validated_output: null, blocked_message: mapped.user_message,
    success: false, failure_category: category, request_id_override: call.request_id,
  });
}

function unavailable(
  input: ProductionReasoningPathInput,
  route: CapabilityRoutingEntry,
  evidence: readonly string[],
  started: number,
  mapped: ReturnType<typeof mapProviderError>,
): ProductionReasoningPathResult {
  return finish({
    input, route,
    structured: projectLocalDeterministicResponse({ tool_trace: input.tool_trace, evidence_refs: evidence, intent: route.intent }),
    evidence_refs: evidence, runtime_mode: 'MODEL_UNAVAILABLE', model_called: false, provider: null, model: null,
    latency_ms: elapsed(input, started), token_usage: null, degraded: true, degradation_reason: mapped.category,
    validation_status: 'skipped_no_model', evidence_validation_status: 'skipped_no_model',
    cancellation_status: mapped.category === 'cancelled' ? 'cancelled_at_host' : 'not_requested',
    validated_output: null, blocked_message: mapped.user_message || MODEL_UNAVAILABLE_MESSAGE,
    success: false, failure_category: mapped.category,
  });
}

function finish(args: {
  readonly input: ProductionReasoningPathInput;
  readonly route: CapabilityRoutingEntry;
  readonly structured: SalesAgentResponseProjection;
  readonly evidence_refs: readonly string[];
  readonly runtime_mode: ProductionRuntimeMode;
  readonly model_called: boolean;
  readonly provider: string | null;
  readonly model: string | null;
  readonly latency_ms: number | null;
  readonly token_usage: ProductionRuntimeDetails['token_usage'];
  readonly degraded: boolean;
  readonly degradation_reason: string | null;
  readonly validation_status: ProductionRuntimeDetails['validation_status'];
  readonly evidence_validation_status: ProductionRuntimeDetails['evidence_validation_status'];
  readonly cancellation_status: ProductionRuntimeDetails['cancellation_status'];
  readonly validated_output: ValidatedModelOutput | null;
  readonly grounded_result?: ValidatedGroundedResult | null;
  readonly blocked_message: string | null;
  readonly success: boolean;
  readonly failure_category: ProviderErrorCategory | null;
  readonly request_id_override?: string;
}): ProductionReasoningPathResult {
  const requestId = args.request_id_override ?? args.input.request_id;
  const runtime = buildRuntimeDetails({
    runtime_mode: args.runtime_mode, provider: args.provider, model: args.model, model_called: args.model_called,
    request_id: requestId, latency_ms: args.latency_ms, token_usage: args.token_usage,
    tools_used: args.input.tool_trace.map(item => item.tool_id), evidence_count: args.evidence_refs.length,
    degraded: args.degraded, degradation_reason: args.degradation_reason, validation_status: args.validation_status,
    evidence_validation_status: args.evidence_validation_status, cancellation_status: args.cancellation_status,
    requires_real_model: args.route.requires_real_model, failure_category: args.failure_category,
  });
  const structured = args.blocked_message
    ? { ...args.structured, recommended_next_step: args.blocked_message }
    : args.structured;
  return {
    structured,
    evidence_refs: args.evidence_refs,
    runtime,
    validated_output: args.validated_output,
    grounded_result: args.grounded_result ?? null,
    blocked_message: args.blocked_message,
    log: buildRedactedProviderLog({
      request_id: requestId, provider_kind: args.provider, model: args.model, intent: args.route.intent,
      latency_ms: args.latency_ms, token_usage: args.token_usage, success: args.success, failure_category: args.failure_category,
    }),
  };
}

function elapsed(input: ProductionReasoningPathInput, started: number): number {
  return (input.clock?.() ?? Date.now()) - started;
}
