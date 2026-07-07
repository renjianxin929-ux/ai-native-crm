import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildModelSuggestOnlyCandidatesFromFixtureOutput,
  buildModelSuggestOnlyOutputGatePlan,
  runModelSuggestOnlyOutputGate,
  validateCallerProvidedModelOutputEnvelope,
  validateModelSuggestOnlyCandidate,
  validateModelSuggestOnlyOutputGateRequest,
  validateModelSuggestOnlyOutputGateResult,
  type ModelSuggestOnlyCandidate,
  type ModelSuggestOnlyOutputGateBlockedReason,
  type ModelSuggestOnlyOutputGateResult,
} from '../lib/modelSuggestOnlyOutputGateReadiness';
import { buildModelSuggestOnlyOutputGateRequestFixtureV1 } from '../lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1';
import type { ModelReadOnlyInvocationGateResult } from '../lib/modelReadOnlyInvocationGateReadiness';

const LOOP_45_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/modelSuggestOnlyOutputGateReadiness.ts',
  'src/lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1.ts',
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/lib/liveProviderSandboxCallReadiness.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxCallFixturesV1.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/lib/manualLiveProviderSmokeGateReadiness.ts',
  'src/lib/manualLiveProviderSmokeGate/manualLiveProviderSmokeGateFixturesV1.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/lib/liveSandboxToSuggestOnlyBridgeReadiness.ts',
  'src/lib/liveSandboxToSuggestOnlyBridge/liveSandboxToSuggestOnlyBridgeFixturesV1.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/lib/readOnlyAISuggestionServiceReadiness.ts',
  'src/lib/readOnlyAISuggestionService/readOnlyAISuggestionServiceFixturesV1.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
]);

const LOOP_45_REQUIRED_CHANGED_FILES = [
  'src/lib/modelSuggestOnlyOutputGateReadiness.ts',
  'src/lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
];

const LOOP_49_REQUIRED_CHANGED_FILES = [
  'src/lib/liveProviderSandboxCallReadiness.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxCallFixturesV1.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
];

const LOOP_50_REQUIRED_CHANGED_FILES = [
  'src/lib/manualLiveProviderSmokeGateReadiness.ts',
  'src/lib/manualLiveProviderSmokeGate/manualLiveProviderSmokeGateFixturesV1.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
];

const LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES = [
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/lib/manualLiveProviderSmokeGateReadiness.ts',
  'src/lib/manualLiveProviderSmokeGate/manualLiveProviderSmokeGateFixturesV1.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
];

const LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/lib/liveSandboxToSuggestOnlyBridgeReadiness.ts',
  'src/lib/liveSandboxToSuggestOnlyBridge/liveSandboxToSuggestOnlyBridgeFixturesV1.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/lib/readOnlyAISuggestionServiceReadiness.ts',
  'src/lib/readOnlyAISuggestionService/readOnlyAISuggestionServiceFixturesV1.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
];

const LOOP_52_READ_ONLY_AI_SUGGESTION_SERVICE_CHANGED_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/lib/readOnlyAISuggestionServiceReadiness.ts',
  'src/lib/readOnlyAISuggestionService/readOnlyAISuggestionServiceFixturesV1.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
];

const LOOP_53_READ_ONLY_AI_SUGGESTION_PANEL_CHANGED_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
];

const PRODUCTION_AND_FIXTURE_FILES = [
  'src/lib/modelSuggestOnlyOutputGateReadiness.ts',
  'src/lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1.ts',
];

const FORBIDDEN_LIVE_PROVIDER_TERMS = [
  'fetch',
  'axios',
  'OpenAI',
  'Anthropic',
  'Gemini',
  'Qwen',
  'DeepSeek',
  'process.env',
  'import.meta.env',
  'API_KEY',
  'Authorization',
  'Bearer',
  'curl',
  'http://',
  'https://',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'modelRouterRuntime',
  'PromptRuntime',
  'ModelRouterRuntime',
  'invokeWithFixtureAdapter',
];

const FORBIDDEN_DB_RUNNER_UI_UPSTREAM_TERMS = [
  'getDb',
  'db.select',
  'db.execute',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
  'runModelReadOnlyInvocationGate',
  'runModelProviderBoundaryContract',
  'runModelProviderReadOnlySandbox',
  'runDashboardDataProjection',
  'runSafeWriteRunnerGate',
  'runDbWritePlanDryRun',
  'runSuggestOnlyLiveDryRun',
  'runConfirmedActionReviewQueue',
  'SuggestOnlyAgentProposal',
  'ConfirmedActionEnvelope',
  'ActionRunner',
  'WriteRunner',
  'executeAction',
  'React',
  'pages',
  'components',
];

const FORBIDDEN_UNSTABLE_TERMS = [
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
];

const FORBIDDEN_STATUS_VALUES = [
  'ready',
  'approved',
  'confirmed',
  'executable',
  'queued',
  'sent_to_review',
  'runnable',
  'success',
  'completed',
  'written',
];

const DANGEROUS_TRUE_STATE_KEYS = [
  'allow_model_call',
  'allow_network',
  'allow_env_read',
  'allow_secret_material',
  'allow_db',
  'allow_runner',
  'allow_execution',
  'allow_review_queue_entry',
  'allow_confirmed_action',
  'allow_human_confirmation',
  'allow_write_plan_entry',
  'model_call_performed',
  'calls_real_provider',
  'uses_network',
  'reads_env',
  'reads_database',
  'writes_database',
  'contains_secret',
  'contains_pii',
  'exposes_secret',
  'from_live_provider',
  'from_network',
  'from_database',
  'trusted_for_action',
  'executable',
  'produces_proposal',
  'produces_executable_proposal',
  'produces_confirmed_action',
  'confirmed_action',
  'human_confirmed',
  'approval_recorded',
  'enters_review_queue',
  'enters_human_confirmation',
  'enters_write_plan',
  'represents_model_call',
  'represents_live_model_call',
  'represents_executed_action',
  'persisted',
  'persists_output',
];

describe('Model suggest-only output gate readiness', () => {
  it('builds suggestion-only candidates from caller-provided fixture output', () => {
    const request = buildModelSuggestOnlyOutputGateRequestFixtureV1({
      source_invocation_gate_result: buildSafeSourceInvocationGateResult(),
    });
    const plan = buildModelSuggestOnlyOutputGatePlan(request);
    const result = runModelSuggestOnlyOutputGate(plan);
    const candidate = result.answer.suggestion_candidates[0];

    expect(validateModelSuggestOnlyOutputGateRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(plan).toMatchObject({
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_suggest_only_output_gate_readiness_only',
      allowed_operations: [
        'validate_caller_provided_fixture_output_envelope',
        'build_suggest_only_candidates',
        'build_suggest_only_output_gate_result',
      ],
    });
    expect(result).toMatchObject({
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT',
      version: 'v1',
      persisted: false,
      reads_database: false,
      writes_database: false,
      reads_env: false,
      uses_network: false,
      calls_real_provider: false,
      represents_live_model_call: false,
      represents_model_output: false,
      source_contains_fixture_model_output: true,
      represents_executed_action: false,
      answer: {
        kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_ANSWER',
        suggestion_gate_blocked: false,
        blocked_reason: null,
        generated_suggestion_candidates: true,
        suggestions_count: 1,
        contract_only: true,
        gate_only: true,
        suggestion_only: true,
        fixture_output_only: true,
        source_contains_fixture_model_output: true,
        model_call_performed: false,
        calls_real_provider: false,
        uses_network: false,
        reads_env: false,
        exposes_secret: false,
        reads_database: false,
        writes_database: false,
        executes_action: false,
        calls_runner: false,
        produces_executable_proposal: false,
        produces_confirmed_action: false,
        enters_review_queue: false,
        enters_human_confirmation: false,
        enters_write_plan: false,
        persists_output: false,
      },
    });
    expect(result.answer.source_invocation_gate_result).toBe(request.source_invocation_gate_result);
    expect(result.answer.source_model_output_envelope).toBe(request.model_output_envelope);
    expect(candidate).toMatchObject({
      kind: 'MODEL_SUGGEST_ONLY_CANDIDATE',
      version: 'v1',
      suggestion_candidate_id: 'MODEL_SUGGEST_ONLY_CANDIDATE_001',
      source_output_id: 'MODEL_SUGGEST_ONLY_OUTPUT_FIXTURE_A',
      source_invocation_candidate_id: 'MODEL_INVOCATION_GATE_CANDIDATE_001',
      suggestion_status: 'requires_human_review',
      required_human_review: true,
      contract_only: true,
      suggestion_only: true,
      fixture_output_only: true,
      executable: false,
      confirmed_action: false,
      human_confirmed: false,
      approval_recorded: false,
      writes_database: false,
      reads_database: false,
      calls_runner: false,
      calls_real_provider: false,
      uses_network: false,
      contains_secret: false,
      contains_pii: false,
      produces_executable_proposal: false,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      represents_executed_action: false,
    });
    expect(candidate?.suggestion_status === 'requires_human_review' || candidate?.suggestion_status.startsWith('blocked_')).toBe(true);
    expect(validateModelSuggestOnlyOutputGateResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['illegal_model_call_allowed', { allow_model_call: true }],
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_secret_material_allowed', { allow_secret_material: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_confirmed_action_allowed', { allow_confirmed_action: true }],
    ['illegal_human_confirmation_allowed', { allow_human_confirmation: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
  ] satisfies [
    ModelSuggestOnlyOutputGateBlockedReason,
    Parameters<typeof buildModelSuggestOnlyOutputGateRequestFixtureV1>[0],
  ][])(
    'blocks unsafe request permission: %s',
    (expectedReason, options) => {
      const result = runWithRequest(buildModelSuggestOnlyOutputGateRequestFixtureV1(options));

      expect(result.answer).toMatchObject({
        suggestion_gate_blocked: true,
        blocked_reason: expectedReason,
        generated_suggestion_candidates: false,
        suggestion_candidates: [],
        model_call_performed: false,
        calls_real_provider: false,
        uses_network: false,
        produces_executable_proposal: false,
        enters_review_queue: false,
        enters_write_plan: false,
      });
    },
  );

  it.each([
    ['illegal_source_invocation_called_real_provider', { calls_real_provider: true }],
    ['illegal_source_invocation_used_network', { uses_network: true }],
    ['illegal_source_invocation_produced_model_output', { answer: { produces_model_output: true } }],
    ['illegal_source_invocation_produced_suggestion', { answer: { produces_suggestion: true } }],
    ['illegal_source_invocation_entered_review_queue', { answer: { enters_review_queue: true } }],
    ['illegal_source_invocation_entered_write_plan', { answer: { enters_write_plan: true } }],
    ['illegal_source_invocation_candidate_not_blocked', { answer: { invocation_candidate: { invocation_status: 'ready' } } }],
  ] satisfies [
    ModelSuggestOnlyOutputGateBlockedReason,
    Partial<ModelReadOnlyInvocationGateResult>,
  ][])(
    'blocks unsafe caller-provided source invocation result: %s',
    (expectedReason, override) => {
      const request = buildModelSuggestOnlyOutputGateRequestFixtureV1({
        source_invocation_gate_result: mergeSourceInvocationGateResult(override),
      });

      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_model_output_from_live_provider', { output_from_live_provider: true }],
    ['illegal_model_output_from_network', { output_from_network: true }],
    ['illegal_model_output_from_database', { output_from_database: true }],
    ['illegal_model_output_contains_secret', { output_contains_secret: true }],
    ['illegal_model_output_contains_pii', { output_contains_pii: true }],
    ['illegal_model_output_trusted_for_action', { output_trusted_for_action: true }],
    ['illegal_model_output_executable', { output_executable: true }],
    ['illegal_model_output_produces_proposal', { output_produces_proposal: true }],
  ] satisfies [
    ModelSuggestOnlyOutputGateBlockedReason,
    Parameters<typeof buildModelSuggestOnlyOutputGateRequestFixtureV1>[0],
  ][])(
    'blocks unsafe model output envelope: %s',
    (expectedReason, options) => {
      const request = buildModelSuggestOnlyOutputGateRequestFixtureV1(options);

      expect(validateCallerProvidedModelOutputEnvelope(request.model_output_envelope)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_candidate_executable', { executable: true }],
    ['illegal_candidate_confirmed_action', { confirmed_action: true }],
    ['illegal_candidate_human_confirmed', { human_confirmed: true }],
    ['illegal_candidate_enters_review_queue', { enters_review_queue: true }],
    ['illegal_candidate_enters_write_plan', { enters_write_plan: true }],
    ['illegal_output_text_propagated', { output_text: 'copied source text' }],
  ] satisfies [
    ModelSuggestOnlyOutputGateBlockedReason,
    Partial<ModelSuggestOnlyCandidate> & { output_text?: string },
  ][])(
    'blocks unsafe candidate mutation: %s',
    (expectedReason, override) => {
      const request = buildModelSuggestOnlyOutputGatePlan(buildModelSuggestOnlyOutputGateRequestFixtureV1()).request;
      const candidate = buildModelSuggestOnlyCandidatesFromFixtureOutput(request)[0];

      expect(validateModelSuggestOnlyCandidate({ ...candidate, ...override }, request.model_output_envelope)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('prevents output_text propagation outside the source envelope reference', () => {
    const request = buildModelSuggestOnlyOutputGateRequestFixtureV1({
      output_text: 'do not copy this fixture model output into candidates',
    });
    const result = runWithRequest(request);
    const candidate = result.answer.suggestion_candidates[0];

    expect(JSON.stringify(candidate)).not.toContain('output_text');
    expect(JSON.stringify(result.answer.suggestion_candidates)).not.toContain('output_text');
    expect(result.answer.source_model_output_envelope.output_text).toBe(request.model_output_envelope.output_text);
    expect(stripSourceEnvelopeFromAnswer(result)).not.toContain(request.model_output_envelope.output_text);
    expect(candidate?.title).not.toBe(request.model_output_envelope.output_text);
    expect(candidate?.summary).not.toBe(request.model_output_envelope.output_text);
    expect(candidate?.summary.includes(request.model_output_envelope.output_text)).toBe(false);
    expect(validateModelSuggestOnlyCandidate({
      ...candidate,
      summary: request.model_output_envelope.output_text,
    }, request.model_output_envelope)).toEqual({
      ok: false,
      blocked_reason: 'illegal_output_text_propagated',
    });
  });

  it('guards suggestion_status exact enum values', () => {
    const request = buildModelSuggestOnlyOutputGatePlan(buildModelSuggestOnlyOutputGateRequestFixtureV1()).request;
    const candidate = buildModelSuggestOnlyCandidatesFromFixtureOutput(request)[0];

    expect(candidate?.suggestion_status).toBe('requires_human_review');
    expect(validateModelSuggestOnlyCandidate({
      ...candidate,
      suggestion_status: 'blocked_output_untrusted',
    }, request.model_output_envelope)).toEqual({ ok: true, blocked_reason: null });
    for (const suggestion_status of FORBIDDEN_STATUS_VALUES) {
      expect(validateModelSuggestOnlyCandidate({ ...candidate, suggestion_status }, request.model_output_envelope)).toEqual({
        ok: false,
        blocked_reason: 'illegal_candidate_executable',
      });
    }
  });

  it('keeps output free of executable proposal and chain entry states', () => {
    const result = runWithRequest(buildModelSuggestOnlyOutputGateRequestFixtureV1());

    expect(result.answer).toMatchObject({
      produces_executable_proposal: false,
      produces_confirmed_action: false,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
    });
    expect(findDangerousTrueStates(result)).toEqual([]);
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      caller_provided_only: true,
      fixture_output_only: true,
      suggestion_gate_only: true,
      policy_only: true,
      allow_suggestion_candidate: true,
      require_human_review_before_any_action: true,
      require_evidence_refs: true,
      require_risk_flags: true,
      require_no_secret: true,
      require_no_pii: true,
      require_trace: true,
      output_text_redacted: true,
      output_fixture_only: true,
      output_redacted: true,
      suggestion_only: true,
      required_human_review: true,
      requires_human_review: true,
      required: true,
      blocking: true,
      blocks_execution: true,
      blocks_action: true,
      contract_only: true,
      gate_only: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    expect(findDangerousTrueStates({ executable: false })).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });

  it('is deterministic and preserves caller-provided object references', () => {
    const request = buildModelSuggestOnlyOutputGateRequestFixtureV1({
      source_invocation_gate_result: buildSafeSourceInvocationGateResult(),
    });
    const before = JSON.stringify(request);
    const envelope = request.model_output_envelope;
    const sourceInvocation = request.source_invocation_gate_result;
    const plan = buildModelSuggestOnlyOutputGatePlan(request);
    const first = runModelSuggestOnlyOutputGate(plan);
    const second = runModelSuggestOnlyOutputGate(plan);

    expect(first).toEqual(second);
    expect(first.answer.suggestion_candidates[0]?.suggestion_candidate_id).toBe('MODEL_SUGGEST_ONLY_CANDIDATE_001');
    expect(JSON.stringify(request)).toBe(before);
    expect(request.model_output_envelope).toBe(envelope);
    expect(first.answer.source_model_output_envelope).toBe(envelope);
    expect(first.answer.source_invocation_gate_result).toBe(sourceInvocation);
  });

  it('keeps production and fixture source free of live provider, DB, runner, UI, upstream, and unstable APIs', () => {
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');

      for (const term of [
        ...FORBIDDEN_LIVE_PROVIDER_TERMS,
        ...FORBIDDEN_DB_RUNNER_UI_UPSTREAM_TERMS,
        ...FORBIDDEN_UNSTABLE_TERMS,
      ]) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('keeps the file-scope guard limited to complete Loop 45, Loop 49, or Loop 50 file sets', () => {
    expect(isLoop45FileScopeGuardSatisfied(LOOP_45_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_49_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_50_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES)).toBe(true);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES)).toBe(true);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_45_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_49_REQUIRED_CHANGED_FILES.slice(0, 3))).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_50_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied(LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES.slice(0, 8))).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied([
      LOOP_45_REQUIRED_CHANGED_FILES[0],
      LOOP_49_REQUIRED_CHANGED_FILES[0],
      LOOP_50_REQUIRED_CHANGED_FILES[0],
    ])).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/liveProviderSandboxCallLoop50Readiness.ts',
    ])).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/foo.ts',
    ])).toBe(false);
    expect(isLoop45FileScopeGuardSatisfied([])).toBe(false);
    expect(LOOP_45_ALLOWED_CHANGED_FILES.has('src/lib/**')).toBe(false);
    expect(LOOP_45_ALLOWED_CHANGED_FILES.has('src/lib/manualLiveProviderSmokeGate/**')).toBe(false);
  });

  it('does not modify files outside the Loop 45 allowed change set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    expect(isLoop45FileScopeGuardSatisfied(changedFiles)).toBe(true);
    expect(changedFiles.filter(file => file.startsWith('src/tests/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => (
      file.startsWith('src/components/')
      && file !== 'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx'
      && file !== 'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts'
    ))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
  });
});

function runWithRequest(
  request: Parameters<typeof buildModelSuggestOnlyOutputGatePlan>[0],
): ModelSuggestOnlyOutputGateResult {
  return runModelSuggestOnlyOutputGate(buildModelSuggestOnlyOutputGatePlan(request));
}

function buildSafeSourceInvocationGateResult(): ModelReadOnlyInvocationGateResult {
  return {
    kind: 'MODEL_READ_ONLY_INVOCATION_GATE_RESULT',
    version: 'v1',
    persisted: false,
    reads_database: false,
    writes_database: false,
    reads_env: false,
    uses_network: false,
    calls_real_provider: false,
    represents_live_model_call: false,
    represents_model_output: false,
    represents_executed_action: false,
    answer: {
      produces_model_output: false,
      produces_suggestion: false,
      enters_review_queue: false,
      enters_write_plan: false,
      invocation_candidate: {
        invocation_candidate_id: 'MODEL_INVOCATION_GATE_CANDIDATE_001',
        invocation_status: 'blocked_invocation_policy_only',
      },
    },
  } as ModelReadOnlyInvocationGateResult;
}

function mergeSourceInvocationGateResult(
  override: Partial<ModelReadOnlyInvocationGateResult>,
): ModelReadOnlyInvocationGateResult {
  const base = buildSafeSourceInvocationGateResult() as unknown as Record<string, unknown>;
  const answer = {
    ...((base.answer ?? {}) as Record<string, unknown>),
    ...((override.answer ?? {}) as Record<string, unknown>),
  };
  return {
    ...base,
    ...override,
    answer,
  } as unknown as ModelReadOnlyInvocationGateResult;
}

function stripSourceEnvelopeFromAnswer(result: ModelSuggestOnlyOutputGateResult): string {
  const { source_model_output_envelope, ...answerWithoutSourceEnvelope } = result.answer;
  void source_model_output_envelope;
  return JSON.stringify(answerWithoutSourceEnvelope);
}

function findDangerousTrueStates(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findDangerousTrueStates(item, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, item]) => {
    const currentPath = `${path}.${key}`;
    const self = DANGEROUS_TRUE_STATE_KEYS.includes(key) && item === true ? [currentPath] : [];
    return [...self, ...findDangerousTrueStates(item, currentPath)];
  });
}

function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
}

function isLoop45FileScopeGuardSatisfied(changedFiles: readonly string[]): boolean {
  return changedFiles.length > 0
    && changedFiles.every(file => LOOP_45_ALLOWED_CHANGED_FILES.has(file))
    && (
      hasCompleteChangedFileSet(changedFiles, LOOP_45_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_49_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_50_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_52_READ_ONLY_AI_SUGGESTION_SERVICE_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_53_READ_ONLY_AI_SUGGESTION_PANEL_CHANGED_FILES)
    );
}

function hasCompleteChangedFileSet(changedFiles: readonly string[], expectedFiles: readonly string[]): boolean {
  return changedFiles.length === expectedFiles.length && expectedFiles.every(file => changedFiles.includes(file));
}
