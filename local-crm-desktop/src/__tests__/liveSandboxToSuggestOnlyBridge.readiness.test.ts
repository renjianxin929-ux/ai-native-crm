import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  runLiveSandboxToSuggestOnlyBridge,
  validateLiveSandboxToSuggestOnlyBridgeRequest,
  type LiveSandboxToSuggestOnlyBridgeBlockedReason,
  type LiveSandboxToSuggestOnlyBridgeRequest,
  type LiveSandboxToSuggestOnlyBridgeResult,
} from '../lib/liveSandboxToSuggestOnlyBridgeReadiness';
import {
  buildLiveProviderSandboxCallResultFixtureV1,
  buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1,
  buildManualLiveProviderSmokeResultFixtureV1,
} from '../lib/liveSandboxToSuggestOnlyBridge/liveSandboxToSuggestOnlyBridgeFixturesV1';
import type { LiveProviderSandboxCallResult } from '../lib/liveProviderSandboxCallReadiness';
import type { ManualLiveProviderSmokeResult } from '../lib/manualLiveProviderSmokeGateReadiness';

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

const LOOP_51_ALLOWED_CHANGED_FILES = new Set([
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
  'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
]);

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
  'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
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
  'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
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

const CORE_FILE = 'src/lib/liveSandboxToSuggestOnlyBridgeReadiness.ts';
const FIXTURE_FILE = 'src/lib/liveSandboxToSuggestOnlyBridge/liveSandboxToSuggestOnlyBridgeFixturesV1.ts';
const TEST_FILE = 'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts';
const LOOP_51_FILES = [CORE_FILE, FIXTURE_FILE, TEST_FILE];

const LOOP_51_FORBIDDEN_IMPORT_TERMS = [
  'createLiveProviderSandboxTransport',
  'liveProviderSandboxTransport',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'getDb',
  'runModelSuggestionAdapterBoundary',
  'runModelSuggestionReviewDraftGate',
  'runReviewDraftQueueBoundary',
  'runConfirmedActionReviewQueue',
  'ConfirmedAction',
  'ActionRunner',
  'WriteRunner',
  'db.select',
  'db.execute',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
];

const LOOP_51_FORBIDDEN_RUNTIME_TERMS = [
  'fetch',
  'process.env',
  'import.meta.env',
  'API_KEY',
  'Authorization',
  'Bearer',
  'sk-',
];

const DANGEROUS_TRUE_STATE_KEYS = [
  'allow_network',
  'allow_model_call',
  'allow_env_read',
  'allow_db',
  'allow_runner',
  'allow_execution',
  'allow_review_queue_entry',
  'allow_confirmed_action',
  'allow_human_confirmation',
  'allow_write_plan_entry',
  'contains_pii',
  'contains_secret',
  'trusted_for_action',
  'raw_output_stored',
  'raw_output_available',
  'persisted',
  'reads_database',
  'writes_database',
  'reads_env',
  'represents_executed_action',
  'represents_confirmed_action',
  'represents_review_queue_entry',
  'represents_human_confirmation',
  'represents_write_plan',
  'enters_review_queue',
  'produces_confirmed_action',
  'produces_executable_proposal',
  'calls_runner',
  'executable',
  'produces_proposal',
  'from_live_provider',
  'from_network',
  'from_database',
  'represents_model_call',
  'calls_real_provider',
  'uses_network',
  'trusted_for_action',
];

describe('Live sandbox to suggest-only bridge readiness', () => {
  it('maps a manual smoke source into the suggest-only bridge happy path', () => {
    const request = buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1();
    const result = runLiveSandboxToSuggestOnlyBridge(request);

    expect(validateLiveSandboxToSuggestOnlyBridgeRequest(request)).toMatchObject({
      ok: true,
      blocked_reason: null,
    });
    expect(result).toMatchObject({
      kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_RESULT',
      version: 'v1',
      bridge_only: true,
      suggest_only: true,
      caller_provided_only: true,
      uses_network: false,
      calls_real_provider: false,
      reads_env: false,
      reads_database: false,
      writes_database: false,
      trusted_for_action: false,
      persisted: false,
      enters_review_queue: false,
      represents_live_model_call: false,
    });
    expect(result.answer).toMatchObject({
      bridge_blocked: false,
      blocked_reason: null,
      source_kind: 'manual_live_provider_smoke',
      source_request_id: 'MANUAL_SMOKE_SOURCE_REQUEST_A',
      source_provider_kind: 'openai_compatible',
      source_model_name: 'manual-smoke-readiness-model',
      source_was_live_sandbox: true,
      generated_model_output_envelope: true,
      output_text_redacted: 'Manual smoke redacted bridge output for suggestion review.',
      trusted_for_action: false,
      enters_review_queue: false,
      writes_database: false,
      persisted: false,
      uses_network: false,
      calls_real_provider: false,
      represents_live_model_call: false,
    });
    expect(result.answer.suggest_only_result?.answer.suggestions_count).toBe(1);
    expect(findDangerousTrueStates(result.answer.model_output_envelope)).toEqual([]);
    expect(findDangerousTrueStates(result.answer.suggest_only_result?.answer.suggestion_candidates)).toEqual([]);
  });

  it('maps a live sandbox source into the suggest-only bridge happy path', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1({
      source_kind: 'live_provider_sandbox_call',
    }));

    expect(result.answer.bridge_blocked).toBe(false);
    expect(result.answer.source_kind).toBe('live_provider_sandbox_call');
    expect(result.answer.source_request_id).toBe('SANDBOX_SOURCE_REQUEST_A');
    expect(result.answer.source_provider_kind).toBe('local_fake');
    expect(result.answer.source_model_name).toBe('sandbox-readiness-model');
    expect(result.answer.output_text_redacted).toBe('Sandbox redacted bridge output for suggestion review.');
    expect(result.answer.suggest_only_result?.answer.generated_suggestion_candidates).toBe(true);
  });

  it('implements Scheme B by running the existing suggest-only dry-run and stopping there', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1());

    expect(result.answer.suggest_only_result).toMatchObject({
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT',
      uses_network: false,
      calls_real_provider: false,
      reads_env: false,
      reads_database: false,
      writes_database: false,
      persisted: false,
      represents_live_model_call: false,
      represents_executed_action: false,
    });
    expect(result.answer.suggest_only_result?.answer).toMatchObject({
      suggestion_only: true,
      fixture_output_only: true,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      writes_database: false,
      produces_confirmed_action: false,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      persists_output: false,
    });
  });

  it('keeps generated candidates suggestion-only and non-executable', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1());
    const candidates = result.answer.suggest_only_result?.answer.suggestion_candidates ?? [];

    expect(candidates).toHaveLength(1);
    for (const candidate of candidates) {
      expect(candidate).toMatchObject({
        suggestion_only: true,
        executable: false,
        confirmed_action: false,
        human_confirmed: false,
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
    }
  });

  it('builds a Loop 45-compatible envelope with live, network, and action flags false', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1());

    expect(result.answer.model_output_envelope).toEqual({
      kind: 'CALLER_PROVIDED_MODEL_OUTPUT_ENVELOPE',
      version: 'v1',
      output_id: 'LOOP_51_BRIDGE_FIXTURE_REQUEST_A:loop51-caller-provided-output',
      source: 'caller_provided',
      output_text: 'Manual smoke redacted bridge output for suggestion review.',
      output_text_redacted: true,
      contains_secret: false,
      contains_pii: false,
      from_live_provider: false,
      from_network: false,
      from_database: false,
      persisted: false,
      trusted_for_action: false,
      executable: false,
      produces_proposal: false,
      represents_model_call: false,
      calls_real_provider: false,
      uses_network: false,
    });
  });

  it('keeps live provenance only in bridge metadata, not Loop 45 safety flags', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1());
    const envelope = result.answer.model_output_envelope;
    const suggestOnlyAnswer = result.answer.suggest_only_result?.answer;

    expect(result.answer.source_was_live_sandbox).toBe(true);
    expect(result.answer.source_provider_kind).toBe('openai_compatible');
    expect(envelope?.from_live_provider).toBe(false);
    expect(envelope?.calls_real_provider).toBe(false);
    expect(envelope?.uses_network).toBe(false);
    expect(suggestOnlyAnswer?.output_safety_summary).toMatchObject({
      from_live_provider: false,
      from_network: false,
      from_database: false,
      trusted_for_action: false,
      executable: false,
    });
  });

  it.each([
    ['source_empty_output_text_redacted', mutateManualSource({ response_envelope: { output_text_redacted: '' } })],
    ['source_raw_output_available', mutateManualSource({ raw_output_available: true })],
    ['source_raw_output_stored', mutateManualSource({ raw_output_stored: true })],
    ['source_trusted_for_action', mutateManualSource({ response_envelope: { trusted_for_action: true } })],
    ['source_enters_review_queue', mutateManualSource({ enters_review_queue: true })],
    ['source_writes_database', mutateManualSource({ writes_database: true })],
    ['source_contains_secret', mutateManualSource({ response_envelope: { contains_secret: true } })],
    ['source_contains_pii', mutateManualSource({ response_envelope: { contains_pii: true } })],
    ['source_represents_executed_action', { represents_executed_action: true }],
    ['source_represents_confirmed_action', { represents_confirmed_action: true }],
    ['source_represents_review_queue_entry', { represents_review_queue_entry: true }],
    ['source_unsafe_output_marker', mutateManualSource({ response_envelope: { output_text_redacted: 'Authorization header redacted' } })],
    ['source_unsafe_output_marker', mutateManualSource({ response_envelope: { output_text_redacted: 'Bearer marker redacted' } })],
    ['source_unsafe_output_marker', mutateManualSource({ response_envelope: { output_text_redacted: 'API_KEY marker redacted' } })],
    ['source_unsafe_output_marker', mutateManualSource({ response_envelope: { output_text_redacted: 'sk-redactedmarker' } })],
  ] satisfies [LiveSandboxToSuggestOnlyBridgeBlockedReason, Partial<ManualLiveProviderSmokeResult>][])(
    'blocks unsafe manual source: %s',
    (expectedReason, override) => {
      const request = buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1({
        source_manual_smoke_result: mergeManualResult(buildManualLiveProviderSmokeResultFixtureV1(), override),
      });
      const result = runLiveSandboxToSuggestOnlyBridge(request);

      expect(result.answer.bridge_blocked).toBe(true);
      expect(result.answer.blocked_reason).toBe(expectedReason);
      expect(result.answer.suggest_only_result).toBeNull();
      expect(result.answer.model_output_envelope).toBeNull();
      expect(result).toMatchObject(nonActionableExpectation());
    },
  );

  it.each([
    ['source_empty_output_text_redacted', mutateSandboxSource({ response_envelope: { output_text_redacted: '' } })],
    ['source_raw_output_available', mutateSandboxSource({ raw_output_available: true })],
    ['source_raw_output_stored', mutateSandboxSource({ response_envelope: { raw_output_stored: true } })],
    ['source_trusted_for_action', mutateSandboxSource({ response_envelope: { trusted_for_action: true } })],
    ['source_enters_review_queue', mutateSandboxSource({ response_envelope: { enters_review_queue: true } })],
    ['source_writes_database', mutateSandboxSource({ writes_database: true })],
    ['source_contains_secret', mutateSandboxSource({ response_envelope: { contains_secret: true } })],
    ['source_contains_pii', mutateSandboxSource({ response_envelope: { contains_pii: true } })],
  ] satisfies [LiveSandboxToSuggestOnlyBridgeBlockedReason, Partial<LiveProviderSandboxCallResult>][])(
    'blocks unsafe sandbox source: %s',
    (expectedReason, override) => {
      const request = buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1({
        source_kind: 'live_provider_sandbox_call',
        source_sandbox_call_result: mergeSandboxResult(buildLiveProviderSandboxCallResultFixtureV1(), override),
      });
      const result = runLiveSandboxToSuggestOnlyBridge(request);

      expect(result.answer.bridge_blocked).toBe(true);
      expect(result.answer.blocked_reason).toBe(expectedReason);
      expect(result.answer.suggest_only_result).toBeNull();
    },
  );

  it.each([
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_model_call_allowed', { allow_model_call: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_confirmed_action_allowed', { allow_confirmed_action: true }],
    ['illegal_human_confirmation_allowed', { allow_human_confirmation: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
  ] satisfies [LiveSandboxToSuggestOnlyBridgeBlockedReason, Partial<LiveSandboxToSuggestOnlyBridgeRequest>][])(
    'blocks unsafe bridge request permission: %s',
    (expectedReason, override) => {
      const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1(override));

      expect(result.answer.bridge_blocked).toBe(true);
      expect(result.answer.blocked_reason).toBe(expectedReason);
      expect(result.answer.suggest_only_result).toBeNull();
      expect(result).toMatchObject(nonActionableExpectation());
    },
  );

  it('does not call or import live transports or providers', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('fetch');
    expect(serialized).not.toContain('createLiveProviderSandboxTransport');
    expect(serialized).not.toContain('liveProviderSandboxTransport');
    expect(serialized).not.toContain('textAIProvider');
    expect(serialized).not.toContain('multimodalProvider');
    expect(serialized).not.toContain('aiDraft');

    for (const file of [CORE_FILE, FIXTURE_FILE]) {
      const source = readFileSync(file, 'utf8');
      for (const term of [
        'createLiveProviderSandboxTransport',
        'liveProviderSandboxTransport',
        'aiDraft',
        'textAIProvider',
        'multimodalProvider',
      ]) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('does not enter downstream adapter, review, action, runner, or write chains', () => {
    const result = runLiveSandboxToSuggestOnlyBridge(buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1());
    expect(JSON.stringify(result)).not.toContain('REVIEW_DRAFT_QUEUE_BOUNDARY');
    expect(JSON.stringify(result)).not.toContain('CONFIRMED_ACTION');

    for (const file of [CORE_FILE, FIXTURE_FILE]) {
      const source = readFileSync(file, 'utf8');
      for (const term of LOOP_51_FORBIDDEN_IMPORT_TERMS) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('keeps static guards around file scope and exact allowlists', () => {
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

    const matchesLoop54 = hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES);
    expect(changedFiles.filter(file => !LOOP_51_ALLOWED_CHANGED_FILES.has(file) && !matchesLoop54)).toEqual([]);
    if (changedFiles.length === 0) {
      expect(isProvenCleanGitBaseline()).toBe(true);
    } else {
      expect(
        hasCompleteChangedFileSet(changedFiles, LOOP_52_READ_ONLY_AI_SUGGESTION_SERVICE_CHANGED_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53_READ_ONLY_AI_SUGGESTION_PANEL_CHANGED_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_READINESS_CLEAN_BASELINE_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES),
      ).toBe(true);
    }
    expect(LOOP_51_ALLOWED_CHANGED_FILES.has('src/lib/**')).toBe(false);
    expect(LOOP_51_ALLOWED_CHANGED_FILES.has('src/lib/liveSandboxToSuggestOnlyBridge/**')).toBe(false);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => (
      file.startsWith('src/components/')
      && file !== 'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx'
      && file !== 'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts'
      && !(matchesLoop54 && file === 'src/components/aiNative/AINativeCRMWorkspace.tsx')
    ))).toEqual([]);
  });

  it('keeps forbidden runtime terms out of sources except the explicit marker list and assertions', () => {
    const coreSource = withoutUnsafeMarkerList(readFileSync(CORE_FILE, 'utf8'));
    const fixtureSource = readFileSync(FIXTURE_FILE, 'utf8');
    for (const term of LOOP_51_FORBIDDEN_RUNTIME_TERMS) {
      expect(coreSource).not.toContain(term);
      expect(fixtureSource).not.toContain(term);
    }

    for (const file of [CORE_FILE, FIXTURE_FILE]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('process.env');
      expect(source).not.toContain('import.meta.env');
      expect(source).not.toContain('getDb');
      expect(source).not.toContain('db.execute');
    }
  });

  it('has mutation sentinels for exactly one source and source kind matching', () => {
    const manual = buildManualLiveProviderSmokeResultFixtureV1();
    const sandbox = buildLiveProviderSandboxCallResultFixtureV1();

    expect(validateLiveSandboxToSuggestOnlyBridgeRequest({
      ...buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1(),
      source_manual_smoke_result: manual,
      source_sandbox_call_result: sandbox,
    })).toMatchObject({ ok: false, blocked_reason: 'invalid_source_selection' });
    expect(validateLiveSandboxToSuggestOnlyBridgeRequest({
      ...buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1(),
      source_manual_smoke_result: undefined,
      source_sandbox_call_result: undefined,
    })).toMatchObject({ ok: false, blocked_reason: 'invalid_source_selection' });
    expect(validateLiveSandboxToSuggestOnlyBridgeRequest({
      ...buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1(),
      source_kind: 'live_provider_sandbox_call',
    })).toMatchObject({ ok: false, blocked_reason: 'source_kind_mismatch' });
  });

  it('has mutation sentinels for every bridge permission flag', () => {
    for (const key of [
      'allow_network',
      'allow_model_call',
      'allow_env_read',
      'allow_db',
      'allow_runner',
      'allow_execution',
      'allow_review_queue_entry',
      'allow_confirmed_action',
      'allow_human_confirmation',
      'allow_write_plan_entry',
    ] satisfies (keyof LiveSandboxToSuggestOnlyBridgeRequest)[]) {
      expect(validateLiveSandboxToSuggestOnlyBridgeRequest({
        ...buildLiveSandboxToSuggestOnlyBridgeRequestFixtureV1(),
        [key]: true,
      })).toMatchObject({ ok: false });
    }
  });
});

function mutateManualSource(
  answerOverride: Partial<ManualLiveProviderSmokeResult['answer']>,
): Partial<ManualLiveProviderSmokeResult> {
  return { answer: answerOverride as ManualLiveProviderSmokeResult['answer'] };
}

function mutateSandboxSource(
  answerOverride: Partial<LiveProviderSandboxCallResult['answer']>,
): Partial<LiveProviderSandboxCallResult> {
  return { answer: answerOverride as LiveProviderSandboxCallResult['answer'] };
}

function mergeManualResult(
  base: ManualLiveProviderSmokeResult,
  override: Partial<ManualLiveProviderSmokeResult>,
): ManualLiveProviderSmokeResult {
  return {
    ...base,
    ...override,
    answer: {
      ...base.answer,
      ...override.answer,
      response_envelope: {
        ...base.answer.response_envelope,
        ...override.answer?.response_envelope,
      } as ManualLiveProviderSmokeResult['answer']['response_envelope'],
    },
  } as ManualLiveProviderSmokeResult;
}

function mergeSandboxResult(
  base: LiveProviderSandboxCallResult,
  override: Partial<LiveProviderSandboxCallResult>,
): LiveProviderSandboxCallResult {
  return {
    ...base,
    ...override,
    answer: {
      ...base.answer,
      ...override.answer,
      response_envelope: {
        ...base.answer.response_envelope,
        ...override.answer?.response_envelope,
      },
    },
  } as LiveProviderSandboxCallResult;
}

function nonActionableExpectation(): Partial<LiveSandboxToSuggestOnlyBridgeResult> {
  return {
    bridge_only: true,
    suggest_only: true,
    caller_provided_only: true,
    uses_network: false,
    calls_real_provider: false,
    reads_env: false,
    reads_database: false,
    writes_database: false,
    trusted_for_action: false,
    persisted: false,
    enters_review_queue: false,
    represents_live_model_call: false,
    represents_executed_action: false,
    represents_confirmed_action: false,
    represents_review_queue_entry: false,
  };
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

function withoutUnsafeMarkerList(source: string): string {
  return source.replace(/const UNSAFE_OUTPUT_MARKERS = \[[\s\S]*?\];/, '');
}

function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
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
