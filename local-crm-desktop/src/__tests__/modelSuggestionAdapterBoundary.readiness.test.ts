import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import {
  adaptModelSuggestOnlyCandidatesToBoundary,
  buildModelSuggestionAdapterBoundaryPlan,
  runModelSuggestionAdapterBoundary,
  validateAdaptedModelSuggestionBoundaryCandidate,
  validateModelSuggestionAdapterBoundaryRequest,
  validateModelSuggestionAdapterBoundaryResult,
  validateSourceSuggestOnlyOutputGateResult,
  type AdaptedModelSuggestionBoundaryCandidate,
  type ModelSuggestionAdapterBoundaryBlockedReason,
  type ModelSuggestionAdapterBoundaryResult,
  type ModelSuggestionBoundaryAdaptationStatus,
} from '../lib/modelSuggestionAdapterBoundaryReadiness';
import {
  buildModelSuggestionAdapterBoundaryRequestFixtureV1,
  buildSafeModelSuggestOnlyOutputGateResultFixtureV1,
} from '../lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1';
import type {
  ModelSuggestOnlyCandidate,
  ModelSuggestOnlyOutputGateResult,
} from '../lib/modelSuggestOnlyOutputGateReadiness';

const LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES = [
  'src/App.tsx',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
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
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/lib/aiNativeCRMWorkspaceReadiness.ts',
  'src/lib/readOnlyAISuggestionServiceReadiness.ts',
] as const;

const LOOP_46_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
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

const LOOP_46_REQUIRED_CHANGED_FILES = [
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
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
const LOOP_53A_READINESS_CLEAN_BASELINE_PATCH_FILES = [
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
];
const LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES = [
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
];
const LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES = [
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
];

const PRODUCTION_AND_FIXTURE_FILES = [
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
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
  'runModelSuggestOnlyOutputGate',
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
  'ConfirmedActionReviewQueueResult',
  'ConfirmedActionReviewQueueCandidate',
  'HumanConfirmation',
  'ActionRunner',
  'WriteRunner',
  'executeAction',
  'envelopeFromSuggestOnlyAnswer',
  'React',
  'pages',
  'components',
];

const FORBIDDEN_UNSTABLE_TERMS = [
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
];

const FORBIDDEN_KIND_STRINGS = [
  'SUGGEST_ONLY_AGENT_PROPOSAL',
  'CONFIRMED_ACTION_ENVELOPE',
  'CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE',
  'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT',
];

const FORBIDDEN_ADAPTATION_STATUS_VALUES = [
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
  'enqueued',
];

const ALLOWED_ADAPTATION_STATUS_VALUES: ModelSuggestionBoundaryAdaptationStatus[] = [
  'boundary_requires_human_review',
  'boundary_blocked_source',
  'boundary_policy_only',
];

const DANGEROUS_TRUE_STATE_KEYS = [
  'allow_review_queue_entry',
  'allow_confirmed_action',
  'allow_human_confirmation',
  'allow_runner',
  'allow_execution',
  'allow_write_plan_entry',
  'allow_db',
  'allow_network',
  'allow_env_read',
  'allow_model_call',
  'calls_real_provider',
  'uses_network',
  'reads_env',
  'reads_database',
  'writes_database',
  'contains_secret',
  'contains_pii',
  'executable',
  'confirmed_action',
  'human_confirmed',
  'approval_recorded',
  'produces_confirmed_action',
  'produces_executable_proposal',
  'emits_confirmed_action_envelope',
  'enters_review_queue',
  'enters_human_confirmation',
  'enters_write_plan',
  'represents_executed_action',
  'represents_confirmed_action',
  'represents_review_queue_entry',
  'represents_human_confirmation',
  'represents_write_plan',
  'persisted',
  'persists_output',
];

describe('Model suggestion adapter boundary readiness', () => {
  it('adapts caller-provided suggest-only output gate candidates as boundary-only candidates', () => {
    const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
    const request = buildModelSuggestionAdapterBoundaryRequestFixtureV1({
      source_suggest_only_output_gate_result: sourceResult,
    });
    const result = runWithRequest(request);
    const sourceCandidates = sourceResult.answer.suggestion_candidates;

    expect(validateModelSuggestionAdapterBoundaryRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(result.answer).toMatchObject({
      adapter_boundary_blocked: false,
      blocked_reason: null,
      generated_boundary_candidates: true,
      contract_only: true,
      adapter_boundary_only: true,
      suggestion_only: true,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      produces_confirmed_action: false,
      produces_executable_proposal: false,
      executes_action: false,
      calls_runner: false,
      reads_database: false,
      writes_database: false,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      persists_output: false,
    });
    expect(result.answer.boundary_candidates).toHaveLength(sourceCandidates.length);
    result.answer.boundary_candidates.forEach((candidate, index) => {
      expect(candidate).toMatchObject({
        kind: 'ADAPTED_MODEL_SUGGESTION_BOUNDARY_CANDIDATE',
        version: 'v1',
        boundary_candidate_id: `ADAPTED_MODEL_SUGGESTION_BOUNDARY_${String(index + 1).padStart(3, '0')}`,
        source_suggestion_candidate_id: sourceCandidates[index]?.suggestion_candidate_id,
        source_output_id: sourceCandidates[index]?.source_output_id,
        adaptation_status: 'boundary_requires_human_review',
        contract_only: true,
        adapter_boundary_only: true,
        suggestion_only: true,
        fixture_output_only: true,
        executable: false,
        confirmed_action: false,
        human_confirmed: false,
        approval_recorded: false,
        enters_review_queue: false,
        enters_human_confirmation: false,
        enters_write_plan: false,
        produces_confirmed_action: false,
        produces_executable_proposal: false,
        emits_confirmed_action_envelope: false,
        reads_database: false,
        writes_database: false,
        calls_runner: false,
        calls_real_provider: false,
        uses_network: false,
        reads_env: false,
        contains_secret: false,
        contains_pii: false,
        represents_executed_action: false,
      });
      expect(
        candidate.adaptation_status === 'boundary_requires_human_review'
          || candidate.adaptation_status.startsWith('boundary_blocked'),
      ).toBe(true);
    });
    expect(validateModelSuggestionAdapterBoundaryResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it('preserves source references and leaves caller-provided objects unchanged', () => {
    const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
    const request = buildModelSuggestionAdapterBoundaryRequestFixtureV1({
      source_suggest_only_output_gate_result: sourceResult,
    });
    const requestBefore = JSON.stringify(request);
    const sourceBefore = JSON.stringify(sourceResult);
    const first = runWithRequest(request);

    expect(first.answer.source_suggest_only_output_gate_result).toBe(sourceResult);
    expect(JSON.stringify(request)).toBe(requestBefore);
    expect(JSON.stringify(sourceResult)).toBe(sourceBefore);
    expect(first.answer.boundary_candidates[0]?.evidence_refs).toBe(sourceResult.answer.suggestion_candidates[0]?.evidence_refs);
    expect(first.answer.boundary_candidates[0]?.risk_flags).toBe(sourceResult.answer.suggestion_candidates[0]?.risk_flags);
    expect(first.answer.boundary_candidates[0]?.limitations).toBe(sourceResult.answer.suggestion_candidates[0]?.limitations);
  });

  it('is deterministic and uses stable boundary candidate ids', () => {
    const request = buildModelSuggestionAdapterBoundaryRequestFixtureV1();
    const first = runWithRequest(request);
    const second = runWithRequest(request);

    expect(first).toEqual(second);
    expect(first.answer.boundary_candidates[0]?.boundary_candidate_id).toBe('ADAPTED_MODEL_SUGGESTION_BOUNDARY_001');
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const term of FORBIDDEN_UNSTABLE_TERMS) {
        expect(source).not.toContain(term);
      }
    }
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'WRONG_KIND' }],
    ['source_answer_missing', { answer: undefined }],
    ['source_suggestion_gate_blocked', { answer: { suggestion_gate_blocked: true } }],
    ['source_candidates_missing', { answer: { generated_suggestion_candidates: false } }],
    ['source_candidates_empty', { answer: { suggestion_candidates: [] } }],
    ['illegal_source_called_real_provider', { calls_real_provider: true }],
    ['illegal_source_used_network', { uses_network: true }],
    ['illegal_source_entered_review_queue', { answer: { enters_review_queue: true } }],
    ['illegal_source_produced_confirmed_action', { answer: { produces_confirmed_action: true } }],
  ] satisfies [
    ModelSuggestionAdapterBoundaryBlockedReason,
    Partial<ModelSuggestOnlyOutputGateResult>,
  ][])(
    'blocks unsafe caller-provided source result: %s',
    (expectedReason, override) => {
      const request = buildModelSuggestionAdapterBoundaryRequestFixtureV1({
        source_suggest_only_output_gate_result: mergeSourceResult(override),
      });

      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_confirmed_action_allowed', { allow_confirmed_action: true }],
    ['illegal_human_confirmation_allowed', { allow_human_confirmation: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_model_call_allowed', { allow_model_call: true }],
  ] satisfies [
    ModelSuggestionAdapterBoundaryBlockedReason,
    Parameters<typeof buildModelSuggestionAdapterBoundaryRequestFixtureV1>[0],
  ][])(
    'blocks unsafe request permission: %s',
    (expectedReason, options) => {
      const result = runWithRequest(buildModelSuggestionAdapterBoundaryRequestFixtureV1(options));

      expect(result.answer).toMatchObject({
        adapter_boundary_blocked: true,
        blocked_reason: expectedReason,
        generated_boundary_candidates: false,
        boundary_candidates: [],
        calls_real_provider: false,
        uses_network: false,
        produces_executable_proposal: false,
        enters_review_queue: false,
        enters_write_plan: false,
      });
    },
  );

  it.each([
    ['illegal_source_candidate_executable', { executable: true }],
    ['illegal_source_candidate_confirmed_action', { confirmed_action: true }],
    ['illegal_source_candidate_human_confirmed', { human_confirmed: true }],
    ['illegal_source_candidate_enters_review_queue', { enters_review_queue: true }],
    ['illegal_source_candidate_enters_write_plan', { enters_write_plan: true }],
    ['illegal_output_text_propagated', { output_text: 'copied source text' }],
  ] satisfies [
    ModelSuggestionAdapterBoundaryBlockedReason,
    Partial<ModelSuggestOnlyCandidate> & { output_text?: string },
  ][])(
    'blocks unsafe source candidate mutation: %s',
    (expectedReason, override) => {
      const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
      const candidate = sourceResult.answer.suggestion_candidates[0];

      expect(validateSourceSuggestOnlyOutputGateResult(mergeSourceResult({
        answer: {
          suggestion_candidates: [
            { ...candidate, ...override },
          ],
        },
      }))).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it.each([
    ['illegal_boundary_candidate_executable', { executable: true }],
    ['illegal_boundary_candidate_confirmed_action', { confirmed_action: true }],
    ['illegal_boundary_candidate_enters_review_queue', { enters_review_queue: true }],
    ['illegal_boundary_candidate_enters_write_plan', { enters_write_plan: true }],
    ['illegal_output_text_propagated', { output_text: 'copied source text' }],
  ] satisfies [
    ModelSuggestionAdapterBoundaryBlockedReason,
    Partial<AdaptedModelSuggestionBoundaryCandidate> & { output_text?: string },
  ][])(
    'blocks unsafe boundary candidate mutation: %s',
    (expectedReason, override) => {
      const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
      const candidate = adaptModelSuggestOnlyCandidatesToBoundary(sourceResult)[0];

      expect(validateAdaptedModelSuggestionBoundaryCandidate({ ...candidate, ...override }, sourceResult)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('prevents output_text propagation outside the source result reference', () => {
    const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
    const sourceText = sourceResult.answer.source_model_output_envelope.output_text;
    const result = runWithRequest(buildModelSuggestionAdapterBoundaryRequestFixtureV1({
      source_suggest_only_output_gate_result: sourceResult,
    }));
    const candidate = result.answer.boundary_candidates[0];

    expect(JSON.stringify(candidate)).not.toContain('output_text');
    expect(JSON.stringify(result.answer.boundary_candidates)).not.toContain('output_text');
    expect(result.answer.source_suggest_only_output_gate_result).toBe(sourceResult);
    expect(stripSourceResultFromAnswer(result)).not.toContain(sourceText);
    expect(candidate?.title).not.toBe(sourceText);
    expect(candidate?.summary).not.toBe(sourceText);
    expect(candidate?.summary.includes(sourceText)).toBe(false);
    expect(validateAdaptedModelSuggestionBoundaryCandidate({
      ...candidate,
      summary: sourceText,
    }, sourceResult)).toEqual({
      ok: false,
      blocked_reason: 'illegal_output_text_propagated',
    });
  });

  it('guards adaptation_status exact enum values', () => {
    const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
    const candidate = adaptModelSuggestOnlyCandidatesToBoundary(sourceResult)[0];

    for (const adaptation_status of ALLOWED_ADAPTATION_STATUS_VALUES) {
      expect(validateAdaptedModelSuggestionBoundaryCandidate({
        ...candidate,
        adaptation_status,
      }, sourceResult)).toEqual({ ok: true, blocked_reason: null });
    }
    for (const adaptation_status of FORBIDDEN_ADAPTATION_STATUS_VALUES) {
      expect(validateAdaptedModelSuggestionBoundaryCandidate({
        ...candidate,
        adaptation_status,
      }, sourceResult)).toEqual({
        ok: false,
        blocked_reason: 'illegal_source_candidate_status',
      });
    }
  });

  it('does not emit downstream chain shapes or executable states', () => {
    const result = runWithRequest(buildModelSuggestionAdapterBoundaryRequestFixtureV1());
    const serialized = JSON.stringify(result);

    expect(result.answer).toMatchObject({
      produces_executable_proposal: false,
      produces_confirmed_action: false,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      calls_runner: false,
    });
    expect(serialized).not.toContain('CONFIRMED_ACTION_ENVELOPE');
    expect(serialized).not.toContain('CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE');
    expect(serialized).not.toContain('HumanConfirmation');
    expect(serialized).not.toContain('ActionRunner');
    expect(serialized).not.toContain('DB Write Plan');
    expect(serialized).not.toContain('enqueue');
    expect(serialized).not.toContain('sent_to_review');
    expect(findDangerousTrueStates(result)).toEqual([]);
  });

  it('keeps production and fixture source free of live provider, DB, runner, UI, upstream, and unstable APIs', () => {
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');

      for (const term of [
        ...FORBIDDEN_LIVE_PROVIDER_TERMS,
        ...FORBIDDEN_DB_RUNNER_UI_UPSTREAM_TERMS,
        ...FORBIDDEN_UNSTABLE_TERMS,
        ...FORBIDDEN_KIND_STRINGS,
      ]) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      caller_provided_only: true,
      adapter_boundary_only: true,
      contract_only: true,
      suggestion_only: true,
      fixture_output_only: true,
      required_human_review: true,
      requires_human_review: true,
      required: true,
      blocking: true,
      blocks_execution: true,
      blocks_action: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    expect(findDangerousTrueStates({ executable: false })).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });

  it('keeps the file-scope guard limited to complete Loop 46, Loop 49, or Loop 50 file sets', () => {
    expect(isLoop46FileScopeGuardSatisfied(LOOP_46_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_49_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_50_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES)).toBe(true);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES)).toBe(true);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_46_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_49_REQUIRED_CHANGED_FILES.slice(0, 3))).toBe(false);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_50_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop46FileScopeGuardSatisfied(LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES.slice(0, 8))).toBe(false);
    expect(isLoop46FileScopeGuardSatisfied([
      LOOP_46_REQUIRED_CHANGED_FILES[0],
      LOOP_49_REQUIRED_CHANGED_FILES[0],
      LOOP_50_REQUIRED_CHANGED_FILES[0],
    ])).toBe(false);
    expect(isLoop46FileScopeGuardSatisfied([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/liveProviderSandboxCallLoop50Readiness.ts',
    ])).toBe(false);
    expect(isLoop46FileScopeGuardSatisfied([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/foo.ts',
    ])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], [])).toBe(true);
    expect(isProvenCleanGitBaselineFromParts([' M x'], [], [])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], ['x'], [])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], ['x'])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], [])).toBe(true);
    expect(LOOP_46_ALLOWED_CHANGED_FILES.has('src/lib/**')).toBe(false);
    expect(LOOP_46_ALLOWED_CHANGED_FILES.has('src/lib/manualLiveProviderSmokeGate/**')).toBe(false);
  });

  it('does not modify files outside the Loop 46 allowed change set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    if (hasExactLiveReasoningActivationChangedFileSet(changedFiles)) return;
    if (hasExactStage4CopilotChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(29);
      return;
    }
    if (hasExactStage3StabilizationChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(41);
      return;
    }
    if (hasExactStage2ChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(46);
      return;
    }

    if (hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles)) return;
    expect(isLoop46FileScopeGuardSatisfied(changedFiles)).toBe(true);
    const matchesLoop54 = hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES);
    expect(changedFiles.filter(file => file.startsWith('src/tests/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => (
      file.startsWith('src/components/')
      && file !== 'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx'
      && file !== 'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts'
      && !(matchesLoop54 && file === 'src/components/aiNative/AINativeCRMWorkspace.tsx')
    ))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
  });
});

function runWithRequest(
  request: Parameters<typeof buildModelSuggestionAdapterBoundaryPlan>[0],
): ModelSuggestionAdapterBoundaryResult {
  return runModelSuggestionAdapterBoundary(buildModelSuggestionAdapterBoundaryPlan(request));
}

function mergeSourceResult(
  override: Partial<ModelSuggestOnlyOutputGateResult>,
): ModelSuggestOnlyOutputGateResult {
  const base = buildSafeModelSuggestOnlyOutputGateResultFixtureV1() as unknown as Record<string, unknown>;
  const answer = override.answer === undefined && 'answer' in override
    ? undefined
    : {
        ...((base.answer ?? {}) as Record<string, unknown>),
        ...((override.answer ?? {}) as Record<string, unknown>),
      };
  return {
    ...base,
    ...override,
    answer,
  } as unknown as ModelSuggestOnlyOutputGateResult;
}

function stripSourceResultFromAnswer(result: ModelSuggestionAdapterBoundaryResult): string {
  const { source_suggest_only_output_gate_result, ...answerWithoutSourceResult } = result.answer;
  void source_suggest_only_output_gate_result;
  return JSON.stringify(answerWithoutSourceResult);
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

function isLoop46FileScopeGuardSatisfied(changedFiles: readonly string[]): boolean {
  if (changedFiles.length === 0) return isProvenCleanGitBaseline();
  if (hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES)) return true;

  return changedFiles.every(file => LOOP_46_ALLOWED_CHANGED_FILES.has(file))
    && (
      hasCompleteChangedFileSet(changedFiles, LOOP_46_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_49_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_50_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_52_READ_ONLY_AI_SUGGESTION_SERVICE_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_53_READ_ONLY_AI_SUGGESTION_PANEL_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_53A_READINESS_CLEAN_BASELINE_PATCH_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES)
    );
}

function hasCompleteChangedFileSet(changedFiles: readonly string[], expectedFiles: readonly string[]): boolean {
  return changedFiles.length === expectedFiles.length && expectedFiles.every(file => changedFiles.includes(file));
}

function isProvenCleanGitBaselineFromParts(
  statusLines: readonly string[],
  cachedLines: readonly string[],
  untrackedLines: readonly string[],
): boolean {
  return statusLines.length === 0
    && cachedLines.length === 0
    && untrackedLines.length === 0;
}

function isProvenCleanGitBaseline(): boolean {
  return isProvenCleanGitBaselineFromParts(
    gitLines(['status', '--short']),
    gitLines(['diff', '--cached', '--name-only']),
    gitLines(['ls-files', '--others', '--exclude-standard']),
  );
}
import { hasExactStage2ChangedFileSet } from './stage2ChangedFileCohort';
import { hasExactLiveReasoningActivationChangedFileSet, hasExactStage3StabilizationChangedFileSet, hasExactStage4CopilotChangedFileSet } from './stage3StabilizationChangedFileCohort';
