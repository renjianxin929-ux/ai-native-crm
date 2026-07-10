import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildModelSuggestionReviewDraftGatePlan,
  projectBoundaryCandidatesToReviewDrafts,
  runModelSuggestionReviewDraftGate,
  validateModelSuggestionReviewDraftCandidate,
  validateModelSuggestionReviewDraftGateRequest,
  validateModelSuggestionReviewDraftGateResult,
  validateSourceAdapterBoundaryResult,
  validateSourceBoundaryCandidate,
  type ModelSuggestionReviewDraftCandidate,
  type ModelSuggestionReviewDraftGateBlockedReason,
  type ModelSuggestionReviewDraftGateResult,
  type ModelSuggestionReviewDraftStatus,
} from '../lib/modelSuggestionReviewDraftGateReadiness';
import {
  buildModelSuggestionReviewDraftGateRequestFixtureV1,
  buildSafeModelSuggestionAdapterBoundaryResultFixtureV1,
} from '../lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1';
import type {
  AdaptedModelSuggestionBoundaryCandidate,
  ModelSuggestionAdapterBoundaryResult,
} from '../lib/modelSuggestionAdapterBoundaryReadiness';

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

const LOOP_47_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
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

const LOOP_47_REQUIRED_CHANGED_FILES = [
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
];

const LOOP_48_REQUIRED_CHANGED_FILES = [
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
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
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
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
  'runModelSuggestionAdapterBoundary',
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

const FORBIDDEN_REVIEW_DRAFT_STATUS_VALUES = [
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

const FORBIDDEN_QUEUE_STATE_TOKENS = [
  'queue_item_id',
  'enqueued:true',
  'ready_for_review:true',
  'executes_queue_items:true',
];

const ALLOWED_REVIEW_DRAFT_STATUS_VALUES: ModelSuggestionReviewDraftStatus[] = [
  'draft_requires_human_review',
  'draft_blocked_source',
  'draft_policy_only',
];

const DANGEROUS_TRUE_STATE_KEYS = [
  'allow_enqueue',
  'allow_review_queue_entry',
  'allow_confirmed_action',
  'allow_confirmed_action_envelope',
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
  'confirmed_action_envelope',
  'human_confirmed',
  'approval_recorded',
  'produces_confirmed_action',
  'produces_executable_proposal',
  'emits_confirmed_action_envelope',
  'emits_review_queue_candidate',
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
  'enqueued',
  'enqueues_review_items',
  'executes_review_items',
  'executes_queue_items',
  'ready_for_review',
];

describe('Model suggestion review draft gate readiness', () => {
  it('projects caller-provided adapter boundary candidates to review-draft-only candidates', () => {
    const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
    const request = buildModelSuggestionReviewDraftGateRequestFixtureV1({
      source_adapter_boundary_result: sourceResult,
    });
    const result = runWithRequest(request);
    const sourceCandidates = sourceResult.answer.boundary_candidates;

    expect(validateModelSuggestionReviewDraftGateRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(result.answer).toMatchObject({
      review_draft_gate_blocked: false,
      blocked_reason: null,
      generated_review_draft_candidates: true,
      emits_review_draft_surface_only: true,
      enqueues_review_items: false,
      executes_review_items: false,
      contract_only: true,
      review_draft_gate_only: true,
      review_draft_only: true,
      suggestion_only: true,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      produces_confirmed_action: false,
      produces_executable_proposal: false,
      emits_confirmed_action_envelope: false,
      executes_action: false,
      calls_runner: false,
      reads_database: false,
      writes_database: false,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      persists_output: false,
    });
    expect(result.answer.review_draft_candidates).toHaveLength(sourceCandidates.length);
    result.answer.review_draft_candidates.forEach((candidate, index) => {
      expect(candidate).toMatchObject({
        kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_CANDIDATE',
        version: 'v1',
        review_draft_id: `MODEL_SUGGESTION_REVIEW_DRAFT_${String(index + 1).padStart(3, '0')}`,
        source_boundary_candidate_id: sourceCandidates[index]?.boundary_candidate_id,
        source_suggestion_candidate_id: sourceCandidates[index]?.source_suggestion_candidate_id,
        source_output_id: sourceCandidates[index]?.source_output_id,
        review_draft_status: 'draft_requires_human_review',
        review_draft_only: true,
        suggestion_only: true,
        dry_run_only: true,
        requires_human_review: true,
        enqueued: false,
        executable: false,
        confirmed_action: false,
        confirmed_action_envelope: false,
        human_confirmed: false,
        approval_recorded: false,
        enters_review_queue: false,
        enters_human_confirmation: false,
        enters_write_plan: false,
        emits_confirmed_action_envelope: false,
        emits_review_queue_candidate: false,
        produces_confirmed_action: false,
        produces_executable_proposal: false,
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
        candidate.review_draft_status === 'draft_requires_human_review'
          || candidate.review_draft_status.startsWith('draft_blocked'),
      ).toBe(true);
    });
    expect(validateModelSuggestionReviewDraftGateResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it('preserves source references and leaves caller-provided objects unchanged', () => {
    const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
    const request = buildModelSuggestionReviewDraftGateRequestFixtureV1({
      source_adapter_boundary_result: sourceResult,
    });
    const requestBefore = JSON.stringify(request);
    const sourceBefore = JSON.stringify(sourceResult);
    const first = runWithRequest(request);

    expect(first.answer.source_adapter_boundary_result).toBe(sourceResult);
    expect(JSON.stringify(request)).toBe(requestBefore);
    expect(JSON.stringify(sourceResult)).toBe(sourceBefore);
  });

  it('is deterministic and uses stable review draft ids', () => {
    const request = buildModelSuggestionReviewDraftGateRequestFixtureV1();
    const first = runWithRequest(request);
    const second = runWithRequest(request);

    expect(first).toEqual(second);
    expect(first.answer.review_draft_candidates[0]?.review_draft_id).toBe('MODEL_SUGGESTION_REVIEW_DRAFT_001');
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const term of FORBIDDEN_UNSTABLE_TERMS) {
        expect(source).not.toContain(term);
      }
    }
  });

  it.each([
    ['invalid_request_kind', { kind: 'WRONG_KIND' }],
    ['illegal_enqueue_allowed', { allow_enqueue: true }],
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_confirmed_action_allowed', { allow_confirmed_action: true }],
    ['illegal_confirmed_action_envelope_allowed', { allow_confirmed_action_envelope: true }],
    ['illegal_human_confirmation_allowed', { allow_human_confirmation: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_model_call_allowed', { allow_model_call: true }],
  ] satisfies [
    ModelSuggestionReviewDraftGateBlockedReason,
    Parameters<typeof buildModelSuggestionReviewDraftGateRequestFixtureV1>[0],
  ][])('blocks unsafe request permission: %s', (expectedReason, options) => {
    const result = runWithRequest(buildModelSuggestionReviewDraftGateRequestFixtureV1(options));

    expect(result.answer).toMatchObject({
      review_draft_gate_blocked: true,
      blocked_reason: expectedReason,
      generated_review_draft_candidates: false,
      review_draft_candidates: [],
      enqueues_review_items: false,
      executes_review_items: false,
      calls_real_provider: false,
      uses_network: false,
      produces_executable_proposal: false,
      enters_review_queue: false,
      enters_write_plan: false,
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'WRONG_KIND' }],
    ['source_answer_missing', { answer: undefined }],
    ['source_adapter_boundary_blocked', { answer: { adapter_boundary_blocked: true } }],
    ['source_boundary_candidates_missing', { answer: { generated_boundary_candidates: false } }],
    ['source_boundary_candidates_empty', { answer: { boundary_candidates: [] } }],
    ['illegal_source_called_real_provider', { calls_real_provider: true }],
    ['illegal_source_used_network', { uses_network: true }],
    ['illegal_source_reads_database', { reads_database: true }],
    ['illegal_source_writes_database', { writes_database: true }],
    ['illegal_source_entered_review_queue', { answer: { enters_review_queue: true } }],
    ['illegal_source_entered_human_confirmation', { answer: { enters_human_confirmation: true } }],
    ['illegal_source_entered_write_plan', { answer: { enters_write_plan: true } }],
    ['illegal_source_produced_confirmed_action', { answer: { produces_confirmed_action: true } }],
    ['illegal_source_produced_executable_proposal', { answer: { produces_executable_proposal: true } }],
  ] satisfies [
    ModelSuggestionReviewDraftGateBlockedReason,
    Partial<ModelSuggestionAdapterBoundaryResult>,
  ][])('blocks unsafe caller-provided source result: %s', (expectedReason, override) => {
    const request = buildModelSuggestionReviewDraftGateRequestFixtureV1({
      source_adapter_boundary_result: mergeSourceResult(override),
    });

    expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
  });

  it.each([
    ['illegal_source_candidate_executable', { executable: true }],
    ['illegal_source_candidate_confirmed_action', { confirmed_action: true }],
    ['illegal_source_candidate_human_confirmed', { human_confirmed: true }],
    ['illegal_source_candidate_emits_confirmed_action_envelope', { emits_confirmed_action_envelope: true }],
    ['illegal_source_candidate_enters_review_queue', { enters_review_queue: true }],
    ['illegal_source_candidate_enters_write_plan', { enters_write_plan: true }],
    ['illegal_output_text_propagated', { output_text: 'copied source text' }],
  ] satisfies [
    ModelSuggestionReviewDraftGateBlockedReason,
    Partial<AdaptedModelSuggestionBoundaryCandidate> & { output_text?: string },
  ][])('blocks unsafe source boundary candidate mutation: %s', (expectedReason, override) => {
    const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
    const candidate = sourceResult.answer.boundary_candidates[0];

    expect(validateSourceAdapterBoundaryResult(mergeSourceResult({
      answer: {
        boundary_candidates: [
          { ...candidate, ...override },
        ],
      },
    }))).toEqual({
      ok: false,
      blocked_reason: expectedReason,
    });
  });

  it.each([
    ['illegal_draft_candidate_enqueued', { enqueued: true }],
    ['illegal_draft_candidate_executable', { executable: true }],
    ['illegal_draft_candidate_confirmed_action', { confirmed_action: true }],
    ['illegal_draft_candidate_confirmed_action_envelope', { confirmed_action_envelope: true }],
    ['illegal_draft_candidate_emits_review_queue_candidate', { emits_review_queue_candidate: true }],
    ['illegal_draft_candidate_emits_confirmed_action_envelope', { emits_confirmed_action_envelope: true }],
    ['illegal_draft_candidate_enters_review_queue', { enters_review_queue: true }],
    ['illegal_draft_candidate_enters_write_plan', { enters_write_plan: true }],
    ['illegal_output_text_propagated', { output_text: 'copied source text' }],
  ] satisfies [
    ModelSuggestionReviewDraftGateBlockedReason,
    Partial<ModelSuggestionReviewDraftCandidate> & { output_text?: string },
  ][])('blocks unsafe draft candidate mutation: %s', (expectedReason, override) => {
    const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
    const candidate = projectBoundaryCandidatesToReviewDrafts(sourceResult)[0];

    expect(validateModelSuggestionReviewDraftCandidate({ ...candidate, ...override }, sourceResult)).toEqual({
      ok: false,
      blocked_reason: expectedReason,
    });
  });

  it('prevents output_text propagation outside the source result reference', () => {
    const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
    const sourceText = sourceResult
      .answer
      .source_suggest_only_output_gate_result
      .answer
      .source_model_output_envelope
      .output_text;
    const result = runWithRequest(buildModelSuggestionReviewDraftGateRequestFixtureV1({
      source_adapter_boundary_result: sourceResult,
    }));
    const candidate = result.answer.review_draft_candidates[0];

    expect(JSON.stringify(candidate)).not.toContain('output_text');
    expect(JSON.stringify(result.answer.review_draft_candidates)).not.toContain('output_text');
    expect(result.answer.source_adapter_boundary_result).toBe(sourceResult);
    expect(stripSourceResultFromAnswer(result)).not.toContain(sourceText);
    expect(candidate?.title).not.toBe(sourceText);
    expect(candidate?.summary).not.toBe(sourceText);
    expect(candidate?.evidence_summary).not.toBe(sourceText);
    expect(candidate?.risk_summary).not.toBe(sourceText);
    expect(validateModelSuggestionReviewDraftCandidate({
      ...candidate,
      summary: sourceText,
    }, sourceResult)).toEqual({
      ok: false,
      blocked_reason: 'illegal_output_text_propagated',
    });
  });

  it('guards review_draft_status exact enum values', () => {
    const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
    const candidate = projectBoundaryCandidatesToReviewDrafts(sourceResult)[0];

    for (const review_draft_status of ALLOWED_REVIEW_DRAFT_STATUS_VALUES) {
      expect(validateModelSuggestionReviewDraftCandidate({
        ...candidate,
        review_draft_status,
      }, sourceResult)).toEqual({ ok: true, blocked_reason: null });
    }
    for (const review_draft_status of FORBIDDEN_REVIEW_DRAFT_STATUS_VALUES) {
      expect(validateModelSuggestionReviewDraftCandidate({
        ...candidate,
        review_draft_status,
      }, sourceResult)).toEqual({
        ok: false,
        blocked_reason: 'illegal_source_candidate_status',
      });
    }
  });

  it('does not emit downstream chain shapes or executable states', () => {
    const result = runWithRequest(buildModelSuggestionReviewDraftGateRequestFixtureV1());
    const serialized = JSON.stringify(result);

    expect(result.answer).toMatchObject({
      enqueues_review_items: false,
      executes_review_items: false,
      produces_executable_proposal: false,
      produces_confirmed_action: false,
      emits_confirmed_action_envelope: false,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      calls_runner: false,
    });
    expect(serialized).not.toContain('CONFIRMED_ACTION_ENVELOPE');
    expect(serialized).not.toContain('CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE');
    expect(serialized).not.toContain('CONFIRMED_ACTION_REVIEW_QUEUE_RESULT');
    expect(serialized).not.toContain('queue_item_id');
    expect(serialized).not.toContain('HumanConfirmation');
    expect(serialized).not.toContain('ActionRunner');
    expect(serialized).not.toContain('DB Write Plan');
    expect(serialized).not.toContain('executes_queue_items');
    expect(findDangerousTrueStates(result)).toEqual([]);
  });

  it('keeps production and fixture source free of live provider, DB, runner, UI, upstream, and unstable APIs', () => {
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      const compactSource = source.replace(/\s+/g, '');

      for (const term of [
        ...FORBIDDEN_LIVE_PROVIDER_TERMS,
        ...FORBIDDEN_DB_RUNNER_UI_UPSTREAM_TERMS,
        ...FORBIDDEN_UNSTABLE_TERMS,
        ...FORBIDDEN_KIND_STRINGS,
      ]) {
        expect(source).not.toContain(term);
      }
      for (const token of FORBIDDEN_QUEUE_STATE_TOKENS) {
        expect(compactSource).not.toContain(token);
      }
    }
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      caller_provided_only: true,
      review_draft_gate_only: true,
      review_draft_only: true,
      contract_only: true,
      suggestion_only: true,
      dry_run_only: true,
      requires_human_review: true,
      required: true,
      blocking: true,
      emits_review_draft_surface_only: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    expect(findDangerousTrueStates({ enqueued: false })).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });

  it('keeps the file-scope guard limited to complete Loop 47, Loop 48, Loop 49, or Loop 50 file sets', () => {
    expect(isLoop47FileScopeGuardSatisfied(LOOP_47_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_48_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_49_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_50_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES)).toBe(true);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES)).toBe(true);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_47_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_48_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_49_REQUIRED_CHANGED_FILES.slice(0, 3))).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_50_REQUIRED_CHANGED_FILES.slice(0, 2))).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied(LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES.slice(0, 8))).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied([
      LOOP_47_REQUIRED_CHANGED_FILES[0],
      LOOP_48_REQUIRED_CHANGED_FILES[0],
      LOOP_49_REQUIRED_CHANGED_FILES[0],
      LOOP_50_REQUIRED_CHANGED_FILES[0],
    ])).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/liveProviderSandboxCallLoop50Readiness.ts',
    ])).toBe(false);
    expect(isLoop47FileScopeGuardSatisfied([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/foo.ts',
    ])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], [])).toBe(true);
    expect(isProvenCleanGitBaselineFromParts([' M x'], [], [])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], ['x'], [])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], ['x'])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], [])).toBe(true);
    expect(LOOP_47_ALLOWED_CHANGED_FILES.has('src/lib/**')).toBe(false);
    expect(LOOP_47_ALLOWED_CHANGED_FILES.has('src/lib/manualLiveProviderSmokeGate/**')).toBe(false);
  });

  it('does not modify files outside the Loop 47 allowed change set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    if (hasExactStage3StabilizationChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(41);
      return;
    }
    if (hasExactStage2ChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(46);
      return;
    }

    expect(isLoop47FileScopeGuardSatisfied(changedFiles)).toBe(true);
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
  request: Parameters<typeof buildModelSuggestionReviewDraftGatePlan>[0],
): ModelSuggestionReviewDraftGateResult {
  return runModelSuggestionReviewDraftGate(buildModelSuggestionReviewDraftGatePlan(request));
}

function mergeSourceResult(
  override: Partial<ModelSuggestionAdapterBoundaryResult>,
): ModelSuggestionAdapterBoundaryResult {
  const base = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1() as unknown as Record<string, unknown>;
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
  } as unknown as ModelSuggestionAdapterBoundaryResult;
}

function stripSourceResultFromAnswer(result: ModelSuggestionReviewDraftGateResult): string {
  const { source_adapter_boundary_result, ...answerWithoutSourceResult } = result.answer;
  void source_adapter_boundary_result;
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

function isLoop47FileScopeGuardSatisfied(changedFiles: readonly string[]): boolean {
  if (changedFiles.length === 0) return isProvenCleanGitBaseline();
  if (hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES)) return true;

  return changedFiles.every(file => LOOP_47_ALLOWED_CHANGED_FILES.has(file))
    && (
      hasCompleteChangedFileSet(changedFiles, LOOP_47_REQUIRED_CHANGED_FILES)
      || hasCompleteChangedFileSet(changedFiles, LOOP_48_REQUIRED_CHANGED_FILES)
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
import { hasExactStage3StabilizationChangedFileSet } from './stage3StabilizationChangedFileCohort';
