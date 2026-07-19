import { execFileSync } from 'node:child_process';
import { hasExactFinalUsabilityChangedFileSet } from './finalUsabilityChangedFileCohort';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import {
  runReadOnlyAISuggestionService,
  runReadOnlySnapshotAISuggestionService,
  validateReadOnlyAISuggestionServiceRequest,
  type ReadOnlyAISuggestionServiceBlockedReason,
  type ReadOnlyAISuggestionServiceRequest,
} from '../lib/readOnlyAISuggestionServiceReadiness';
import {
  buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1,
  buildModelSuggestOnlyCandidateFixtureV1,
  buildReadOnlyAISuggestionServiceRequestFixtureV1,
} from '../lib/readOnlyAISuggestionService/readOnlyAISuggestionServiceFixturesV1';
import {
  buildLiveDryRunLoadedSnapshotFixtureV1,
  buildLiveDryRunPiiPollutedLoadedSnapshotFixtureV1,
} from '../lib/readOnlyAgentLiveDryRun/readOnlyAgentLiveDryRunFixturesV1';
import type { LiveSandboxToSuggestOnlyBridgeResult } from '../lib/liveSandboxToSuggestOnlyBridgeReadiness';
import type { ModelSuggestOnlyCandidate } from '../lib/modelSuggestOnlyOutputGateReadiness';

const CORE_FILE = 'src/lib/readOnlyAISuggestionServiceReadiness.ts';
const FIXTURE_FILE = 'src/lib/readOnlyAISuggestionService/readOnlyAISuggestionServiceFixturesV1.ts';
const TEST_FILE = 'src/__tests__/readOnlyAISuggestionService.readiness.test.ts';
const LOOP_52_FILES = [
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
  'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  CORE_FILE,
  FIXTURE_FILE,
  TEST_FILE,
];

const LOOP_52_ALLOWED_CHANGED_FILES = new Set(LOOP_52_FILES);

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

const AI_NATIVE_CRM_TARGET_PHASE_FILES = [
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

for (const file of AI_NATIVE_CRM_TARGET_PHASE_FILES) {
  LOOP_52_ALLOWED_CHANGED_FILES.add(file);
}

const FORBIDDEN_IMPORT_TERMS = [
  'createLiveProviderSandboxTransport',
  'liveProviderSandboxTransport',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'getDb',
  'runReviewDraftQueueBoundary',
  'runConfirmedActionReviewQueue',
  'ActionRunner',
  'WriteRunner',
  'runDbWritePlanDryRun',
  'runSafeWriteRunnerGate',
  'React',
  'pages',
  'components',
  'runLiveSandboxToSuggestOnlyBridge',
  'runModelSuggestOnlyOutputGate',
];

const FORBIDDEN_RUNTIME_TERMS = [
  'fetch',
  'process.env',
  'import.meta.env',
  '.env',
  'api_key',
  'API_KEY',
  'Authorization',
  'Bearer',
  'sk-',
];

const DISALLOWED_SOURCE_FIELDS = [
  'source_manual_smoke_result',
  'source_sandbox_call_result',
  'bridge_request',
  'provider_request',
  'model_request',
  'crm_record_id',
  'db_query',
  'review_queue_request',
  'confirmed_action_request',
  'write_plan_request',
];

const DISALLOWED_CARD_PAYLOAD_FIELDS = [
  'output_text',
  'output_text_redacted',
  'raw_output',
  'provider_output',
  'model_output',
  'action_payload',
  'write_payload',
  'review_payload',
  'confirmed_action_payload',
  'db_payload',
  'task_payload',
  'followup_payload',
  'customer_status_payload',
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
  'allow_database_write',
  'allow_task_create',
  'allow_followup_create',
  'allow_customer_status_change',
  'allow_ui',
  'trusted_for_action',
  'executable',
  'confirmed_action',
  'human_confirmed',
  'enters_review_queue',
  'writes_database',
  'persisted',
  'uses_network',
  'calls_real_provider',
  'reads_env',
  'reads_database',
  'represents_review_queue_entry',
  'represents_confirmed_action',
  'represents_human_confirmation',
  'represents_executed_action',
  'represents_write_plan',
  'touches_action_runner',
  'touches_write_runner',
];

describe('Read-only AI suggestion service readiness', () => {
  it('projects a real loaded CRM snapshot through existing read-only and suggest-only dry-runs', () => {
    const response = runReadOnlySnapshotAISuggestionService(buildSnapshotServiceRequest());

    expect(response).toMatchObject({
      source_reference_only: true,
      bridge_reference_only: false,
      uses_network: false,
      calls_real_provider: false,
      reads_database: false,
      writes_database: false,
      executable: false,
      persisted: false,
      answer: {
        service_blocked: false,
        source_reference_only: true,
        bridge_reference_only: false,
        source_kind: 'read_only_crm_snapshot',
        source_provider_kind: 'none_rule_based',
        source_model_name: 'none',
        source_was_live_sandbox: false,
        safety_summary: {
          source_bridge_checked: false,
          source_snapshot_dry_run_checked: true,
          source_reference_only: true,
          bridge_reference_only: false,
        },
      },
    });
    expect(response.answer.suggestion_cards.length).toBeGreaterThan(0);
    for (const card of response.answer.suggestion_cards) {
      expect(card).toMatchObject({
        source_kind: 'read_only_crm_snapshot',
        source_provider_kind: 'none_rule_based',
        requires_human_review: true,
        trusted_for_action: false,
        executable: false,
        writes_database: false,
        persisted: false,
      });
    }
  });

  it('fails closed when the existing snapshot adapter detects PII', () => {
    const response = runReadOnlySnapshotAISuggestionService(buildSnapshotServiceRequest(
      buildLiveDryRunPiiPollutedLoadedSnapshotFixtureV1(),
    ));

    expect(response.answer.service_blocked).toBe(true);
    expect(response.answer.blocked_reason).toBe('snapshot_dry_run_blocked');
    expect(response.answer.suggestion_cards).toEqual([]);
    expect(response).toMatchObject(inactiveResponseExpectation());
  });

  it('projects an unblocked Loop 51 bridge fixture into read-only cards', () => {
    const request = buildReadOnlyAISuggestionServiceRequestFixtureV1();
    const response = runReadOnlyAISuggestionService(request);

    expect(validateReadOnlyAISuggestionServiceRequest(request)).toEqual({ ok: true, blocked_reason: null, metadata: expect.any(Object) });
    expect(response).toMatchObject({
      kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_RESPONSE',
      version: 'v1',
      request_id: 'READ_ONLY_AI_SUGGESTION_SERVICE_FIXTURE_REQUEST_A',
      service_read_only: true,
      caller_provided_only: true,
      bridge_reference_only: true,
      source_reference_only: true,
      suggest_only: true,
      requires_human_review: true,
      trusted_for_action: false,
      executable: false,
      uses_network: false,
      calls_real_provider: false,
      reads_env: false,
      reads_database: false,
      writes_database: false,
      persisted: false,
      enters_review_queue: false,
      represents_review_queue_entry: false,
      represents_confirmed_action: false,
      represents_human_confirmation: false,
      represents_executed_action: false,
      represents_write_plan: false,
      touches_action_runner: false,
      touches_write_runner: false,
    });
    expect(response.answer).toMatchObject({
      service_blocked: false,
      blocked_reason: null,
      generated_suggestion_cards: true,
      cards_count: 1,
      source_kind: 'manual_live_provider_smoke',
      source_request_id: 'MANUAL_SMOKE_SOURCE_REQUEST_A',
      source_provider_kind: 'openai_compatible',
      source_model_name: 'manual-smoke-readiness-model',
      source_was_live_sandbox: true,
      trusted_for_action: false,
      executable: false,
      enters_review_queue: false,
      writes_database: false,
      persisted: false,
    });
  });

  it('preserves provenance only as metadata', () => {
    const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1());
    const card = response.answer.suggestion_cards[0];

    expect(response.answer.source_provider_kind).toBe('openai_compatible');
    expect(response.answer.source_model_name).toBe('manual-smoke-readiness-model');
    expect(card).toMatchObject({
      source_kind: 'manual_live_provider_smoke',
      source_request_id: 'MANUAL_SMOKE_SOURCE_REQUEST_A',
      source_provider_kind: 'openai_compatible',
    });
    expect(JSON.stringify(card)).not.toContain('manual-smoke-readiness-model');
  });

  it('uses candidate title and summary metadata only', () => {
    const candidate = buildModelSuggestOnlyCandidateFixtureV1({
      title: 'Candidate metadata title',
      summary: 'Candidate metadata summary.',
    });
    const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1({
      source_bridge_result: buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1([candidate]),
    }));
    const card = response.answer.suggestion_cards[0];

    expect(card?.title).toBe('Candidate metadata title');
    expect(card?.summary).toBe('Candidate metadata summary.');
    expect(card?.title).not.toBe(response.answer.source_model_name);
    expect(card?.summary).not.toContain('Redacted bridge provenance');
  });

  it('does not include raw or downstream payload fields in cards', () => {
    const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1());
    const card = response.answer.suggestion_cards[0] as Record<string, unknown>;

    for (const field of DISALLOWED_CARD_PAYLOAD_FIELDS) {
      expect(field in card).toBe(false);
      expect(JSON.stringify(response.answer.suggestion_cards)).not.toContain(field);
    }
  });

  it('keeps suggestion cards non-executable and human-review-only', () => {
    const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1());

    for (const card of response.answer.suggestion_cards) {
      expect(card).toMatchObject({
        requires_human_review: true,
        trusted_for_action: false,
        executable: false,
        confirmed_action: false,
        human_confirmed: false,
        enters_review_queue: false,
        writes_database: false,
        persisted: false,
      });
    }
  });

  it.each([
    ['source_bridge_blocked', { answer: { bridge_blocked: true } }],
    ['source_suggest_only_gate_blocked', { answer: { suggest_only_result: { answer: { suggestion_gate_blocked: true } } } }],
    ['source_suggest_only_candidates_empty', { answer: { suggest_only_result: { answer: { suggestion_candidates: [] } } } }],
    ['source_bridge_writes_database', { answer: { writes_database: true } }],
    ['source_bridge_enters_review_queue', { answer: { enters_review_queue: true } }],
    ['source_bridge_trusted_for_action', { answer: { trusted_for_action: true } }],
    ['source_bridge_persisted', { answer: { persisted: true } }],
    ['source_bridge_missing_provenance', { answer: { source_provider_kind: null } }],
  ] satisfies [ReadOnlyAISuggestionServiceBlockedReason, PartialDeep<LiveSandboxToSuggestOnlyBridgeResult>][])(
    'blocks unsafe bridge result: %s',
    (expectedReason, override) => {
      const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1({
        source_bridge_result: mergeBridgeResult(override),
      }));

      expect(response.answer.service_blocked).toBe(true);
      expect(response.answer.blocked_reason).toBe(expectedReason);
      expect(response.answer.suggestion_cards).toEqual([]);
      expect(response.answer.cards_count).toBe(0);
      expect(response).toMatchObject(inactiveResponseExpectation());
    },
  );

  it.each([
    ['source_candidate_executable', { executable: true }],
    ['source_candidate_confirmed_action', { confirmed_action: true }],
    ['source_candidate_human_confirmed', { human_confirmed: true }],
    ['source_candidate_enters_review_queue', { enters_review_queue: true }],
    ['source_candidate_writes_database', { writes_database: true }],
    ['source_candidate_persisted', { persisted: true }],
    ['source_candidate_trusted_for_action', { trusted_for_action: true }],
  ] satisfies [ReadOnlyAISuggestionServiceBlockedReason, Partial<ModelSuggestOnlyCandidate>][])(
    'blocks dangerous candidate flag: %s',
    (expectedReason, override) => {
      const candidate = buildModelSuggestOnlyCandidateFixtureV1(override);
      const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1({
        source_bridge_result: buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1([candidate]),
      }));

      expect(response.answer.service_blocked).toBe(true);
      expect(response.answer.blocked_reason).toBe(expectedReason);
      expect(response.answer.suggestion_cards).toEqual([]);
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
    ['illegal_database_write_allowed', { allow_database_write: true }],
    ['illegal_task_create_allowed', { allow_task_create: true }],
    ['illegal_followup_create_allowed', { allow_followup_create: true }],
    ['illegal_customer_status_change_allowed', { allow_customer_status_change: true }],
    ['illegal_ui_allowed', { allow_ui: true }],
  ] satisfies [ReadOnlyAISuggestionServiceBlockedReason, Partial<ReadOnlyAISuggestionServiceRequest>][])(
    'blocks unsafe request permission: %s',
    (expectedReason, override) => {
      const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1(override));

      expect(response.answer.service_blocked).toBe(true);
      expect(response.answer.blocked_reason).toBe(expectedReason);
      expect(response.answer.suggestion_cards).toEqual([]);
    },
  );

  it('blocks disallowed source fields dynamically', () => {
    for (const field of DISALLOWED_SOURCE_FIELDS) {
      const validation = validateReadOnlyAISuggestionServiceRequest({
        ...buildReadOnlyAISuggestionServiceRequestFixtureV1(),
        [field]: {},
      });

      expect(validation).toMatchObject({
        ok: false,
        blocked_reason: 'disallowed_source_field',
      });
    }
  });

  it('blocks dangerous card payload fields on source candidates', () => {
    for (const field of DISALLOWED_CARD_PAYLOAD_FIELDS) {
      const candidate = {
        ...buildModelSuggestOnlyCandidateFixtureV1(),
        [field]: 'blocked payload',
      } as ModelSuggestOnlyCandidate;
      const response = runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1({
        source_bridge_result: buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1([candidate]),
      }));

      expect(response.answer.service_blocked).toBe(true);
      expect(response.answer.blocked_reason).toBe('source_candidate_raw_payload');
      expect(response.answer.suggestion_cards).toEqual([]);
    }
  });

  it('has active mutation coverage for dangerous true states', () => {
    const safeTrueStates = {
      service_read_only: true,
      caller_provided_only: true,
      bridge_reference_only: true,
      suggest_only: true,
      requires_human_review: true,
      source_bridge_checked: true,
      source_candidates_checked: true,
      validation_checked: true,
      projection_only: true,
      required_human_review: true,
      generated_suggestion_cards: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
    expect(findDangerousTrueStates(runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1()))).toEqual([]);
  });

  it('keeps production and fixture source free of forbidden imports and runtime access', () => {
    for (const file of [CORE_FILE, FIXTURE_FILE]) {
      const source = withoutAllowedLists(readFileSync(file, 'utf8'));
      for (const term of [...FORBIDDEN_IMPORT_TERMS, ...FORBIDDEN_RUNTIME_TERMS]) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('keeps the test source from importing or calling upstream bridge or gate runners', () => {
    const source = readFileSync(TEST_FILE, 'utf8');

    expect(source).not.toMatch(/import\s+\{[^}]*runLiveSandboxToSuggestOnlyBridge/);
    expect(source).not.toMatch(/import\s+\{[^}]*runModelSuggestOnlyOutputGate/);
    expect(source).not.toMatch(/\brunLiveSandboxToSuggestOnlyBridge\(/);
    expect(source).not.toMatch(/\brunModelSuggestOnlyOutputGate\(/);
  });

  it('keeps file scope limited to exact Loop 52 paths', () => {
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
    expect(changedFiles.filter(file => !LOOP_52_ALLOWED_CHANGED_FILES.has(file))).toEqual([]);
    if (changedFiles.length === 0) {
      expect(isProvenCleanGitBaseline()).toBe(true);
    } else {
      expect(
        hasCompleteChangedFileSet(changedFiles, LOOP_52_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53_READ_ONLY_AI_SUGGESTION_PANEL_CHANGED_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_READINESS_CLEAN_BASELINE_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, AI_NATIVE_CRM_TARGET_PHASE_FILES),
      ).toBe(true);
    }
    expect(LOOP_52_ALLOWED_CHANGED_FILES.has('src/lib/**')).toBe(false);
    expect(LOOP_52_ALLOWED_CHANGED_FILES.has('src/__tests__/**')).toBe(false);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => (
      file.startsWith('src/components/')
      && file !== 'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx'
      && file !== 'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts'
      && file !== 'src/components/aiNative/AINativeCRMWorkspace.tsx'
    ))).toEqual([]);
  });
});

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? PartialDeep<T[K]> : T[K];
};

function mergeBridgeResult(
  override: PartialDeep<LiveSandboxToSuggestOnlyBridgeResult>,
): LiveSandboxToSuggestOnlyBridgeResult {
  const base = buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1();
  return {
    ...base,
    ...override,
    answer: {
      ...base.answer,
      ...override.answer,
      suggest_only_result: mergeSuggestOnlyResult(
        base.answer.suggest_only_result,
        override.answer?.suggest_only_result,
      ),
    },
  } as LiveSandboxToSuggestOnlyBridgeResult;
}

function buildSnapshotServiceRequest(
  loadedSnapshot = buildLiveDryRunLoadedSnapshotFixtureV1(),
) {
  return {
    kind: 'READ_ONLY_SNAPSHOT_AI_SUGGESTION_SERVICE_REQUEST' as const,
    version: 'v1' as const,
    request_id: 'SNAPSHOT_SERVICE_TEST_REQUEST_A',
    loaded_snapshot: loadedSnapshot,
    intent: 'evidence_for_customer' as const,
    context: loadedSnapshot.context,
    target_customer_id: 'LIVE_DRY_RUN_TEST_CUSTOMER_A',
    service_read_only: true as const,
    caller_provided_only: true as const,
    source_reference_only: true as const,
    allow_network: false as const,
    allow_model_call: false as const,
    allow_env_read: false as const,
    allow_db: false as const,
    allow_runner: false as const,
    allow_execution: false as const,
    allow_review_queue_entry: false as const,
    allow_confirmed_action: false as const,
    allow_human_confirmation: false as const,
    allow_write_plan_entry: false as const,
    allow_database_write: false as const,
    allow_task_create: false as const,
    allow_followup_create: false as const,
    allow_customer_status_change: false as const,
    allow_ui: false as const,
  };
}

function mergeSuggestOnlyResult(
  base: LiveSandboxToSuggestOnlyBridgeResult['answer']['suggest_only_result'],
  override: unknown,
): LiveSandboxToSuggestOnlyBridgeResult['answer']['suggest_only_result'] {
  if (override === undefined) return base;
  const overrideRecord = override as Record<string, unknown>;
  return {
    ...base,
    ...overrideRecord,
    answer: {
      ...base?.answer,
      ...((overrideRecord.answer ?? {}) as Record<string, unknown>),
    },
  } as LiveSandboxToSuggestOnlyBridgeResult['answer']['suggest_only_result'];
}

function inactiveResponseExpectation() {
  return {
    trusted_for_action: false,
    executable: false,
    uses_network: false,
    calls_real_provider: false,
    reads_env: false,
    reads_database: false,
    writes_database: false,
    persisted: false,
    enters_review_queue: false,
    represents_review_queue_entry: false,
    represents_confirmed_action: false,
    represents_human_confirmation: false,
    represents_executed_action: false,
    represents_write_plan: false,
    touches_action_runner: false,
    touches_write_runner: false,
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

function withoutAllowedLists(source: string): string {
  return source
    .replace(/const DISALLOWED_SOURCE_FIELDS = \[[\s\S]*?\];/, '')
    .replace(/const DISALLOWED_CARD_PAYLOAD_FIELDS = \[[\s\S]*?\];/, '');
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
