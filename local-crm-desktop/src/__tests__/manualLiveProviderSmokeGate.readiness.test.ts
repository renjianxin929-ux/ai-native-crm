import { execFileSync } from 'node:child_process';
import { hasExactFinalUsabilityChangedFileSet } from './finalUsabilityChangedFileCohort';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import {
  MANUAL_LIVE_PROVIDER_SMOKE_AUTHORIZATION_PHRASE,
  runManualLiveProviderSmokeGate,
  validateManualLiveProviderSmokeRequest,
  validateManualLiveProviderSmokeResult,
  type ManualLiveProviderSmokeBlockedReason,
  type ManualLiveProviderSmokeRequest,
  type ManualLiveProviderSmokeResult,
} from '../lib/manualLiveProviderSmokeGateReadiness';
import {
  buildFakeManualLiveProviderSmokeTransportV1,
  buildFakeManualResolvedProviderSecretV1,
  buildManualLiveProviderSmokeRequestFixtureV1,
  fakeManualProviderSecretResolverV1,
} from '../lib/manualLiveProviderSmokeGate/manualLiveProviderSmokeGateFixturesV1';
import type { LiveProviderSandboxTransportResult } from '../lib/liveProviderSandboxCallReadiness';

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

const LOOP_50_ALLOWED_CHANGED_FILES = new Set([
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

const CORE_FILE = 'src/lib/manualLiveProviderSmokeGateReadiness.ts';
const FIXTURE_FILE = 'src/lib/manualLiveProviderSmokeGate/manualLiveProviderSmokeGateFixturesV1.ts';
const TEST_FILE = 'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts';

const LOOP_50_PRODUCTION_AND_FIXTURE_FILES = [
  CORE_FILE,
  FIXTURE_FILE,
];

const TERMS_BANNED_IN_LOOP_50_PRODUCTION = [
  'fetch',
  'Authorization',
  'Bearer',
  'process.env',
  'import.meta.env',
  'API_KEY',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'getDb',
  'db.select',
  'db.execute',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
  'ConfirmedActionEnvelope',
  'ConfirmedActionReviewQueueCandidate',
  'runConfirmedActionReviewQueue',
  'ActionRunner',
  'WriteRunner',
  'createLiveProviderSandboxTransport',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport',
];

const TERMS_FORBIDDEN_IN_SAFE_OUTPUT = [
  'Authorization',
  'Bearer',
  'API_KEY',
  'manual-smoke-test-value',
  'CONFIRMED_ACTION_ENVELOPE',
  'CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE',
  'runConfirmedActionReviewQueue',
  'getDb',
  'ActionRunner',
];

const DANGEROUS_TRUE_STATE_KEYS = [
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
  'from_database',
  'from_crm_customer',
  'trusted_for_action',
  'exposes_secret',
  'prints_secret',
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
];

describe('Manual live provider smoke gate readiness', () => {
  it.each([
    ['manual_live_call_not_authorized', { user_explicitly_authorized_live_call: false }],
    ['manual_live_call_wrong_phrase', { authorization_phrase: 'wrong phrase' }],
    ['manual_live_network_not_allowed', { allow_network: false }],
    ['manual_live_provider_not_allowed', { allow_live_provider: false }],
  ] satisfies [ManualLiveProviderSmokeBlockedReason, Partial<ManualLiveProviderSmokeRequest>][])(
    'blocks by default or missing manual authorization: %s',
    async (expectedReason, override) => {
      let transportInvoked = false;
      const transport = buildFakeManualLiveProviderSmokeTransportV1();
      const guardedTransport = {
        ...transport,
        invokeSandboxCall: (...args: Parameters<typeof transport.invokeSandboxCall>) => {
          transportInvoked = true;
          return transport.invokeSandboxCall(...args);
        },
      };

      const result = await runManualLiveProviderSmokeGate(
        buildManualLiveProviderSmokeRequestFixtureV1(override),
        {
          secret_resolver: fakeManualProviderSecretResolverV1,
          transport: guardedTransport,
        },
      );

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.answer.authorization_accepted).toBe(false);
      expect(result.manual_live_smoke_attempted).toBe(false);
      expect(result.uses_network).toBe(false);
      expect(result.calls_real_provider).toBe(false);
      expect(transportInvoked).toBe(false);
    },
  );

  it('runs the fake manual smoke happy path without a live provider request', async () => {
    const request = buildManualLiveProviderSmokeRequestFixtureV1();
    let transportInvoked = false;
    const transport = buildFakeManualLiveProviderSmokeTransportV1();
    const guardedTransport = {
      ...transport,
      invokeSandboxCall: (...args: Parameters<typeof transport.invokeSandboxCall>) => {
        transportInvoked = true;
        return transport.invokeSandboxCall(...args);
      },
    };

    const result = await runManualLiveProviderSmokeGate(request, {
      secret_resolver: fakeManualProviderSecretResolverV1,
      transport: guardedTransport,
    });
    const serialized = JSON.stringify(result);

    expect(validateManualLiveProviderSmokeRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(result).toMatchObject({
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESULT',
      version: 'v1',
      persisted: false,
      reads_database: false,
      writes_database: false,
      reads_env: false,
      uses_network: false,
      calls_real_provider: false,
      manual_live_smoke_attempted: true,
      manual_live_smoke_succeeded: true,
      represents_model_output: true,
      represents_live_model_call: false,
      represents_executed_action: false,
      represents_confirmed_action: false,
      represents_review_queue_entry: false,
      represents_human_confirmation: false,
      represents_write_plan: false,
    });
    expect(result.answer).toMatchObject({
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_ANSWER',
      smoke_gate_only: true,
      manual_only: true,
      sandbox_only: true,
      authorization_accepted: true,
      provider_kind: 'openai_compatible',
      model_name: 'manual-smoke-readiness-model',
      output_text_redacted: 'Manual smoke fake output: no live provider request was sent.',
      raw_output_available: false,
      raw_output_stored: false,
      persisted: false,
      enters_review_queue: false,
      produces_confirmed_action: false,
      produces_executable_proposal: false,
      writes_database: false,
      calls_runner: false,
    });
    expect(result.answer.response_envelope).toMatchObject({
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESPONSE_ENVELOPE',
      sandbox_only: true,
      manual_smoke_only: true,
      live_provider_response: false,
      raw_output_stored: false,
      contains_secret: false,
      contains_pii: false,
      trusted_for_action: false,
      executable: false,
      produces_proposal: false,
      enters_review_queue: false,
      persisted: false,
    });
    expect(result.answer.error_envelope).toBeNull();
    expect(result.answer.trace_summary).toMatchObject({
      secret_resolved: true,
      secret_resolved_by: 'injected_secret_resolver',
      transport_mode: 'fake',
      sandbox_only: true,
      manual_only: true,
      persisted: false,
    });
    expect(transportInvoked).toBe(true);
    expect(serialized).toContain('no live provider request was sent');
    for (const term of TERMS_FORBIDDEN_IN_SAFE_OUTPUT) {
      expect(serialized).not.toContain(term);
    }
    expect(findDangerousTrueStates(result)).toEqual([]);
    expect(validateManualLiveProviderSmokeResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_confirmed_action_allowed', { allow_confirmed_action: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
  ] satisfies [ManualLiveProviderSmokeBlockedReason, Partial<ManualLiveProviderSmokeRequest>][])(
    'blocks unsafe permission: %s',
    async (expectedReason, override) => {
      const result = await runWithRequest(buildManualLiveProviderSmokeRequestFixtureV1(override));

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.manual_live_smoke_attempted).toBe(false);
      expect(result.answer.enters_review_queue).toBe(false);
      expect(result.answer.produces_confirmed_action).toBe(false);
    },
  );

  it.each([
    ['illegal_provider_kind_local_fake', { provider_kind: 'local_fake' }],
    ['provider_secret_unresolved', { api_key_resolved: false }],
    ['illegal_provider_resolved_by', { resolved_by: 'test_fake' }],
    ['illegal_provider_resolved_by', { resolved_by: 'manual_runtime_only' }],
    ['illegal_provider_config_exposes_secret', { exposes_secret: true }],
    ['illegal_provider_config_prints_secret', { prints_secret: true }],
    ['provider_secret_unresolved', { endpoint_url_redacted: 'credential leak in endpoint' }],
    ['provider_secret_unresolved', { model_name: 'raw_secret model marker' }],
  ] satisfies [
    ManualLiveProviderSmokeBlockedReason,
    Partial<ManualLiveProviderSmokeRequest['provider_config']>,
  ][])('blocks unsafe provider config: %s', async (expectedReason, providerOverride) => {
    const result = await runWithRequest(buildManualLiveProviderSmokeRequestFixtureV1({
      provider_config: providerOverride,
    }));

    expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
    expect(JSON.stringify(result)).not.toContain('manual-smoke-test-value');
    expect(result.answer.error_envelope?.includes_secret).toBe(false);
    expect(result.answer.error_envelope?.includes_api_key).toBe(false);
  });

  it.each([
    ['illegal_prompt_contains_secret', { contains_secret: true }],
    ['illegal_prompt_contains_pii', { contains_pii: true }],
    ['illegal_prompt_from_database', { from_database: true }],
    ['illegal_prompt_from_crm_customer', { from_crm_customer: true }],
    ['illegal_prompt_trusted_for_action', { trusted_for_action: true }],
  ] satisfies [ManualLiveProviderSmokeBlockedReason, Partial<ManualLiveProviderSmokeRequest['prompt_input']>][])(
    'blocks unsafe prompt input: %s',
    async (expectedReason, promptOverride) => {
      const result = await runWithRequest(buildManualLiveProviderSmokeRequestFixtureV1({
        prompt_input: promptOverride,
      }));

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.manual_live_smoke_attempted).toBe(false);
    },
  );

  it.each([
    ['illegal_safety_policy_allows_persistence', { allow_persistence: true }],
    ['illegal_safety_policy_allows_action_generation', { allow_action_generation: true }],
    ['illegal_safety_policy_allows_review_queue_entry', { allow_review_queue_entry: true }],
    ['illegal_safety_policy_allows_db_write', { allow_db_write: true }],
  ] satisfies [ManualLiveProviderSmokeBlockedReason, Partial<ManualLiveProviderSmokeRequest['safety_policy']>][])(
    'blocks unsafe safety policy: %s',
    async (expectedReason, safetyOverride) => {
      const result = await runWithRequest(buildManualLiveProviderSmokeRequestFixtureV1({
        safety_policy: safetyOverride,
      }));

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.manual_live_smoke_attempted).toBe(false);
    },
  );

  it('blocks missing or unsafe injected secret resolver results', async () => {
    const missing = await runManualLiveProviderSmokeGate(
      buildManualLiveProviderSmokeRequestFixtureV1(),
      { transport: buildFakeManualLiveProviderSmokeTransportV1() },
    );
    const exposes = await runManualLiveProviderSmokeGate(
      buildManualLiveProviderSmokeRequestFixtureV1(),
      {
        secret_resolver: () => buildFakeManualResolvedProviderSecretV1({ exposes_secret: true }),
        transport: buildFakeManualLiveProviderSmokeTransportV1(),
      },
    );
    const prints = await runManualLiveProviderSmokeGate(
      buildManualLiveProviderSmokeRequestFixtureV1(),
      {
        secret_resolver: () => buildFakeManualResolvedProviderSecretV1({ prints_secret: true }),
        transport: buildFakeManualLiveProviderSmokeTransportV1(),
      },
    );

    expect(missing.answer.error_envelope?.error_code).toBe('provider_secret_resolver_missing');
    expect(exposes.answer.error_envelope?.error_code).toBe('illegal_resolved_secret_exposes_secret');
    expect(prints.answer.error_envelope?.error_code).toBe('illegal_resolved_secret_prints_secret');
    expect(JSON.stringify([missing, exposes, prints])).not.toContain('manual-smoke-test-value');
  });

  it.each([
    ['illegal_transport_output_contains_secret', { contains_secret: true }],
    ['illegal_transport_output_contains_pii', { contains_pii: true }],
    ['illegal_response_trusted_for_action', { trusted_for_action: true }],
    ['illegal_response_executable', { executable: true }],
    ['illegal_response_produces_proposal', { produces_proposal: true }],
    ['illegal_response_enters_review_queue', { enters_review_queue: true }],
    ['illegal_response_persisted', { persisted: true }],
    ['illegal_transport_output_contains_secret', { output_text_redacted: 'raw_secret marker' }],
  ] satisfies [ManualLiveProviderSmokeBlockedReason, Partial<LiveProviderSandboxTransportResult>][])(
    'blocks unsafe response from fake manual transport: %s',
    async (expectedReason, transportOverride) => {
      const result = await runWithRequest(
        buildManualLiveProviderSmokeRequestFixtureV1(),
        buildFakeManualLiveProviderSmokeTransportV1(transportOverride),
      );

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.answer.response_envelope).toBeNull();
      expect(result.answer.enters_review_queue).toBe(false);
      expect(result.answer.produces_confirmed_action).toBe(false);
    },
  );

  it.each([
    ['illegal_result_writes_database', { writes_database: true }],
    ['illegal_result_represents_confirmed_action', { represents_confirmed_action: true }],
    ['illegal_result_represents_review_queue_entry', { represents_review_queue_entry: true }],
    ['illegal_result_represents_review_queue_entry', { answer: { enters_review_queue: true } }],
    ['illegal_result_represents_confirmed_action', { answer: { produces_confirmed_action: true } }],
  ] satisfies [ManualLiveProviderSmokeBlockedReason, Partial<ManualLiveProviderSmokeResult>][])(
    'validates unsafe final result mutation: %s',
    async (expectedReason, override) => {
      const result = await runWithRequest(buildManualLiveProviderSmokeRequestFixtureV1());
      const mutated = mergeResult(result, override);

      expect(validateManualLiveProviderSmokeResult(mutated)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('keeps transport isolation static guards precise', () => {
    for (const file of LOOP_50_PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const term of TERMS_BANNED_IN_LOOP_50_PRODUCTION) {
        expect(source).not.toContain(term);
      }
    }

    const testSource = readFileSync(TEST_FILE, 'utf8');
    expect(testSource).not.toMatch(/from ['"]\.\.\/lib\/liveProviderSandboxCall\/liveProviderSandboxTransport['"]/);
    expect(testSource).not.toMatch(/import\s+\{[^}]*createLiveProviderSandboxTransport/);
  });

  it('keeps Loop 50 files out of CRM action and write chains', () => {
    for (const file of LOOP_50_PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const term of [
        'ConfirmedActionEnvelope',
        'ConfirmedActionReviewQueueCandidate',
        'runConfirmedActionReviewQueue',
        'getDb',
        'INSERT',
        'UPDATE',
        'DELETE',
        'SELECT',
        'ActionRunner',
        'ReviewDraftQueueBoundaryResult',
        'runReviewDraftQueueBoundary',
      ]) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('does not modify files outside the Loop 50 allowed file set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    if (hasExactFinalUsabilityChangedFileSet(changedFiles)) return;
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
    const matchesLoop54 = hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES);
    expect(changedFiles.filter(file => !LOOP_50_ALLOWED_CHANGED_FILES.has(file) && !matchesLoop54)).toEqual([]);
    expect(isAcceptedLoop50ChangedFileSet(changedFiles)).toBe(true);
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

  it('has mutation sentinels for the manual smoke gate', () => {
    const safeRequest = buildManualLiveProviderSmokeRequestFixtureV1();
    expect(validateManualLiveProviderSmokeRequest({
      ...safeRequest,
      user_explicitly_authorized_live_call: false,
    }).ok).toBe(false);
    expect(validateManualLiveProviderSmokeRequest({
      ...safeRequest,
      authorization_phrase: 'wrong phrase',
    }).ok).toBe(false);
    expect(validateManualLiveProviderSmokeRequest({
      ...safeRequest,
      prompt_input: { ...safeRequest.prompt_input, contains_secret: true },
    }).ok).toBe(false);
    expect(validateManualLiveProviderSmokeRequest({
      ...safeRequest,
      provider_config: { ...safeRequest.provider_config, exposes_secret: true },
    }).ok).toBe(false);
    expect(validateManualLiveProviderSmokeRequest({
      ...safeRequest,
      provider_config: { ...safeRequest.provider_config, provider_kind: 'local_fake' },
    }).ok).toBe(false);
    expect(validateManualLiveProviderSmokeRequest({
      ...safeRequest,
      provider_config: { ...safeRequest.provider_config, resolved_by: 'test_fake' },
    }).ok).toBe(false);
    expect(validateManualLiveProviderSmokeRequest(safeRequest).ok).toBe(true);
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      user_explicitly_authorized_live_call: true,
      allow_network: true,
      allow_live_provider: true,
      api_key_resolved: true,
      dry_run_default: true,
      redact_prompt: true,
      redact_response: true,
      sandbox_only: true,
      manual_only: true,
      smoke_gate_only: true,
      represents_model_output: true,
      manual_live_smoke_attempted: true,
      manual_live_smoke_succeeded: true,
      authorization_accepted: true,
      secret_resolved: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });
});

async function runWithRequest(
  request: ManualLiveProviderSmokeRequest,
  transport = buildFakeManualLiveProviderSmokeTransportV1(),
): Promise<ManualLiveProviderSmokeResult> {
  return runManualLiveProviderSmokeGate(request, {
    secret_resolver: fakeManualProviderSecretResolverV1,
    transport,
  });
}

function mergeResult(
  base: ManualLiveProviderSmokeResult,
  override: Partial<ManualLiveProviderSmokeResult>,
): ManualLiveProviderSmokeResult {
  return {
    ...base,
    ...override,
    answer: {
      ...base.answer,
      ...override.answer,
    },
  } as ManualLiveProviderSmokeResult;
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

function isAcceptedLoop50ChangedFileSet(changedFiles: readonly string[]): boolean {
  if (changedFiles.length === 0) return isProvenCleanGitBaseline();

  const loop50Allowed = [...LOOP_50_ALLOWED_CHANGED_FILES];
  const loop51GuardUpdate = LOOP_51_BRIDGE_WITH_GUARD_UPDATE_CHANGED_FILES;
  const loop52ReadOnlySuggestionService = LOOP_52_READ_ONLY_AI_SUGGESTION_SERVICE_CHANGED_FILES;
  const loop53ReadOnlySuggestionPanel = LOOP_53_READ_ONLY_AI_SUGGESTION_PANEL_CHANGED_FILES;
  return hasCompleteChangedFileSet(changedFiles, loop50Allowed)
    || hasCompleteChangedFileSet(changedFiles, loop51GuardUpdate)
    || hasCompleteChangedFileSet(changedFiles, loop52ReadOnlySuggestionService)
    || hasCompleteChangedFileSet(changedFiles, loop53ReadOnlySuggestionPanel)
    || hasCompleteChangedFileSet(changedFiles, LOOP_53A_READINESS_CLEAN_BASELINE_PATCH_FILES)
    || hasCompleteChangedFileSet(changedFiles, LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES)
    || hasCompleteChangedFileSet(changedFiles, LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES)
    || hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES);
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
