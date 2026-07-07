import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildLiveProviderSandboxCallPlan,
  runLiveProviderSandboxCall,
  validateLiveProviderSandboxCallRequest,
  validateLiveProviderSandboxCallResult,
  validateLiveProviderSandboxTransportResult,
  type LiveProviderSandboxCallBlockedReason,
  type LiveProviderSandboxCallRequest,
  type LiveProviderSandboxCallResult,
  type LiveProviderSandboxTransportResult,
} from '../lib/liveProviderSandboxCallReadiness';
import {
  buildFakeLiveProviderSandboxTransportV1,
  buildFakeResolvedProviderSecretV1,
  buildLiveProviderSandboxCallRequestFixtureV1,
  fakeProviderSecretResolverV1,
} from '../lib/liveProviderSandboxCall/liveProviderSandboxCallFixturesV1';

const LOOP_49_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/liveProviderSandboxCallReadiness.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxCallFixturesV1.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
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
]);

const LOOP_49_REQUIRED_CHANGED_FILES = [
  'src/lib/liveProviderSandboxCallReadiness.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxCallFixturesV1.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
];

const LOOP_50_REQUIRED_CHANGED_FILES = [
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
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

const ACCEPTED_CHANGED_FILE_SETS = [
  LOOP_49_REQUIRED_CHANGED_FILES,
  LOOP_50_REQUIRED_CHANGED_FILES,
  LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES,
];

const CORE_FILE = 'src/lib/liveProviderSandboxCallReadiness.ts';
const FIXTURE_FILE = 'src/lib/liveProviderSandboxCall/liveProviderSandboxCallFixturesV1.ts';
const TRANSPORT_FILE = 'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts';
const TEST_FILE = 'src/__tests__/liveProviderSandboxCall.readiness.test.ts';

const CORE_AND_FIXTURE_FILES = [
  CORE_FILE,
  FIXTURE_FILE,
];

const LOOP_49_PRODUCTION_AND_FIXTURE_FILES = [
  CORE_FILE,
  FIXTURE_FILE,
  TRANSPORT_FILE,
];

const TERMS_BANNED_OUTSIDE_TRANSPORT = [
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
  'getDb',
  'db.select',
  'db.execute',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
  'runConfirmedActionReviewQueue',
  'runSuggestOnlyLiveDryRun',
  'ConfirmedActionReviewQueueCandidate',
  'ConfirmedActionReviewQueueResult',
  'ConfirmedActionEnvelope',
  'SuggestOnlyAgentProposal',
  'HumanConfirmation',
  'ActionRunner',
  'WriteRunner',
  'executeAction',
  'envelopeFromSuggestOnlyAnswer',
  'ReviewDraftQueueBoundaryResult',
  'runReviewDraftQueueBoundary',
  'React',
  'pages',
  'components',
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
];

const TERMS_ALLOWED_ONLY_IN_TRANSPORT = [
  'fetch',
  'Authorization',
  'Bearer',
];

const TERMS_BANNED_IN_TRANSPORT = [
  'process.env',
  'import.meta.env',
  'API_KEY',
  'raw_secret_literal',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'getDb',
  'ConfirmedActionEnvelope',
  'ConfirmedActionReviewQueueCandidate',
  'runConfirmedActionReviewQueue',
  'ActionRunner',
  'WriteRunner',
  'console.log(headers)',
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

describe('Live provider sandbox call readiness', () => {
  it('runs the fake transport happy path without a live provider request', async () => {
    const request = buildLiveProviderSandboxCallRequestFixtureV1();
    const result = await runWithRequest(request);
    const serialized = JSON.stringify(result);

    expect(validateLiveProviderSandboxCallRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(result).toMatchObject({
      kind: 'LIVE_PROVIDER_SANDBOX_CALL_RESULT',
      version: 'v1',
      persisted: false,
      reads_database: false,
      writes_database: false,
      reads_env: false,
      uses_network: false,
      calls_real_provider: false,
      represents_model_output: true,
      represents_live_model_call: false,
      represents_executed_action: false,
      represents_confirmed_action: false,
      represents_review_queue_entry: false,
      represents_human_confirmation: false,
      represents_write_plan: false,
    });
    expect(result.answer).toMatchObject({
      kind: 'LIVE_PROVIDER_SANDBOX_CALL_ANSWER',
      sandbox_only: true,
      live_call_attempted: true,
      live_call_succeeded: true,
      provider_kind: 'local_fake',
      model_name: 'sandbox-readiness-model',
      output_text_redacted: 'Sandbox fake output: no live provider request was sent.',
      raw_output_available: false,
      persisted: false,
      enters_review_queue: false,
      produces_confirmed_action: false,
      produces_executable_proposal: false,
      writes_database: false,
      calls_runner: false,
    });
    expect(result.answer.response_envelope).toMatchObject({
      kind: 'LIVE_PROVIDER_SANDBOX_RESPONSE_ENVELOPE',
      sandbox_only: true,
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
    expect(result.answer.safety_summary).toMatchObject({
      prompt_redacted: true,
      response_redacted: true,
      persistence_allowed: false,
      action_generation_allowed: false,
      review_queue_entry_allowed: false,
      db_write_allowed: false,
    });
    expect(result.answer.trace_summary).toMatchObject({
      transport_mode: 'fake',
      secret_resolved_by: 'test_fake',
      sandbox_only: true,
      persisted: false,
    });
    expect(serialized).toContain('no live provider request was sent');
    expect(serialized).not.toContain('CONFIRMED_ACTION_ENVELOPE');
    expect(serialized).not.toContain('CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE');
    expect(serialized).not.toContain('runConfirmedActionReviewQueue');
    expect(serialized).not.toContain('getDb');
    expect(serialized).not.toContain('ActionRunner');
    expect(findDangerousTrueStates(result)).toEqual([]);
    expect(validateLiveProviderSandboxCallResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_confirmed_action_allowed', { allow_confirmed_action: true }],
    ['illegal_human_confirmation_allowed', { allow_human_confirmation: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
  ] satisfies [LiveProviderSandboxCallBlockedReason, Partial<LiveProviderSandboxCallRequest>][])(
    'blocks unsafe request permission: %s',
    async (expectedReason, override) => {
      const result = await runWithRequest(buildLiveProviderSandboxCallRequestFixtureV1(override));

      expect(result.answer.error_envelope).toMatchObject({
        error_code: expectedReason,
        includes_secret: false,
        includes_api_key: false,
      });
      expect(result.answer.live_call_attempted).toBe(false);
      expect(result.uses_network).toBe(false);
      expect(result.calls_real_provider).toBe(false);
    },
  );

  it.each([
    ['illegal_prompt_contains_secret', { contains_secret: true }],
    ['illegal_prompt_contains_pii', { contains_pii: true }],
    ['illegal_prompt_from_database', { from_database: true }],
    ['illegal_prompt_from_crm_customer', { from_crm_customer: true }],
    ['illegal_prompt_trusted_for_action', { trusted_for_action: true }],
  ] satisfies [LiveProviderSandboxCallBlockedReason, Partial<LiveProviderSandboxCallRequest['prompt_input']>][])(
    'blocks unsafe prompt input: %s',
    async (expectedReason, promptOverride) => {
      const result = await runWithRequest(buildLiveProviderSandboxCallRequestFixtureV1({
        prompt_input: promptOverride,
      }));

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.answer.live_call_attempted).toBe(false);
      expect(result.answer.enters_review_queue).toBe(false);
      expect(result.answer.produces_confirmed_action).toBe(false);
    },
  );

  it.each([
    ['provider_secret_unresolved', { api_key_resolved: false }],
    ['illegal_provider_config_exposes_secret', { exposes_secret: true }],
    ['illegal_provider_config_prints_secret', { prints_secret: true }],
    ['provider_secret_unresolved', { resolved_by: 'unknown_resolver' }],
    ['provider_secret_unresolved', { endpoint_url_redacted: 'credential leak in endpoint' }],
    ['provider_secret_unresolved', { model_name: 'raw_secret model marker' }],
  ] satisfies [
    LiveProviderSandboxCallBlockedReason,
    Partial<LiveProviderSandboxCallRequest['provider_config']>,
  ][])('blocks unsafe provider config: %s', async (expectedReason, providerOverride) => {
    const result = await runWithRequest(buildLiveProviderSandboxCallRequestFixtureV1({
      provider_config: providerOverride,
    }));

    expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
    expect(JSON.stringify(result)).not.toContain('sandbox-test-value');
    expect(result.answer.error_envelope?.includes_secret).toBe(false);
    expect(result.answer.error_envelope?.includes_api_key).toBe(false);
  });

  it('blocks a live call when the resolver is missing', async () => {
    const request = buildLiveProviderSandboxCallRequestFixtureV1();
    const result = await runLiveProviderSandboxCall(buildLiveProviderSandboxCallPlan(request), {
      transport: buildFakeLiveProviderSandboxTransportV1(),
    });

    expect(result.answer.error_envelope?.error_code).toBe('provider_secret_resolver_missing');
    expect(result.answer.live_call_attempted).toBe(false);
    expect(result.uses_network).toBe(false);
  });

  it.each([
    ['illegal_resolved_secret_exposes_secret', { exposes_secret: true }],
    ['illegal_resolved_secret_prints_secret', { prints_secret: true }],
    ['provider_secret_unresolved', { resolved: false }],
  ] satisfies [LiveProviderSandboxCallBlockedReason, Partial<ReturnType<typeof buildFakeResolvedProviderSecretV1>>][])(
    'blocks unsafe resolved secret: %s',
    async (expectedReason, secretOverride) => {
      const request = buildLiveProviderSandboxCallRequestFixtureV1();
      const result = await runLiveProviderSandboxCall(buildLiveProviderSandboxCallPlan(request), {
        secret_resolver: () => buildFakeResolvedProviderSecretV1(secretOverride),
        transport: buildFakeLiveProviderSandboxTransportV1(),
      });

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.answer.live_call_attempted).toBe(false);
      expect(JSON.stringify(result)).not.toContain('sandbox-test-value');
    },
  );

  it.each([
    ['illegal_transport_output_contains_secret', { contains_secret: true }],
    ['illegal_transport_output_contains_pii', { contains_pii: true }],
    ['illegal_response_trusted_for_action', { trusted_for_action: true }],
    ['illegal_response_executable', { executable: true }],
    ['illegal_response_produces_proposal', { produces_proposal: true }],
    ['illegal_response_enters_review_queue', { enters_review_queue: true }],
    ['illegal_response_persisted', { persisted: true }],
    ['illegal_transport_output_contains_secret', { output_text_redacted: 'raw_secret marker' }],
  ] satisfies [LiveProviderSandboxCallBlockedReason, Partial<LiveProviderSandboxTransportResult>][])(
    'blocks unsafe transport result: %s',
    async (expectedReason, transportOverride) => {
      const result = await runWithRequest(
        buildLiveProviderSandboxCallRequestFixtureV1(),
        buildFakeLiveProviderSandboxTransportV1(transportOverride),
      );

      expect(result.answer.error_envelope?.error_code).toBe(expectedReason);
      expect(result.answer.response_envelope.raw_output_stored).toBe(false);
      expect(result.answer.response_envelope.trusted_for_action).toBe(false);
      expect(result.answer.response_envelope.executable).toBe(false);
      expect(result.answer.response_envelope.produces_proposal).toBe(false);
      expect(result.answer.response_envelope.enters_review_queue).toBe(false);
      expect(result.answer.response_envelope.persisted).toBe(false);
    },
  );

  it('limits output text and keeps raw output unavailable', async () => {
    const result = await runWithRequest(
      buildLiveProviderSandboxCallRequestFixtureV1({
        safety_policy: { max_output_chars: 12 },
      }),
      buildFakeLiveProviderSandboxTransportV1({
        output_text_redacted: 'Sandbox fake output with extra safe text.',
      }),
    );

    expect(result.answer.output_text_redacted).toBe('Sandbox fake');
    expect(result.answer.response_envelope.output_text_redacted).toBe('Sandbox fake');
    expect(result.answer.raw_output_available).toBe(false);
    expect(result.answer.response_envelope.raw_output_stored).toBe(false);
    expect(result.answer.response_envelope.trusted_for_action).toBe(false);
    expect(result.answer.response_envelope.executable).toBe(false);
    expect(result.answer.response_envelope.produces_proposal).toBe(false);
    expect(result.answer.response_envelope.enters_review_queue).toBe(false);
    expect(result.answer.response_envelope.persisted).toBe(false);
  });

  it.each([
    ['illegal_result_writes_database', { writes_database: true }],
    ['illegal_result_represents_confirmed_action', { represents_confirmed_action: true }],
    ['illegal_result_represents_review_queue_entry', { represents_review_queue_entry: true }],
    ['illegal_result_represents_review_queue_entry', { answer: { enters_review_queue: true } }],
    ['illegal_result_represents_confirmed_action', { answer: { produces_confirmed_action: true } }],
  ] satisfies [LiveProviderSandboxCallBlockedReason, Partial<LiveProviderSandboxCallResult>][])(
    'validates unsafe final result mutation: %s',
    async (expectedReason, override) => {
      const result = await runWithRequest(buildLiveProviderSandboxCallRequestFixtureV1());
      const mutated = mergeResult(result, override);

      expect(validateLiveProviderSandboxCallResult(mutated)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('keeps fake transport output, envelopes, and trace free of secret and header markers', async () => {
    const result = await runWithRequest(buildLiveProviderSandboxCallRequestFixtureV1());
    const safeSlices = [
      result.answer.output_text_redacted,
      JSON.stringify(result.answer.response_envelope),
      JSON.stringify(result.answer.error_envelope),
      JSON.stringify(result.answer.trace_summary),
    ];

    for (const slice of safeSlices) {
      expect(slice).not.toContain('sandbox-test-value');
      expect(slice).not.toContain('Authorization');
      expect(slice).not.toContain('Bearer');
      expect(slice).not.toContain('API_KEY');
    }
    expect(validateLiveProviderSandboxTransportResult({
      ...buildSafeTransportResult(),
      output_text_redacted: 'credential leak in output',
    })).toEqual({
      ok: false,
      blocked_reason: 'illegal_transport_output_contains_secret',
    });
  });

  it('keeps production, fixture, and transport isolated from CRM chain code', () => {
    for (const file of LOOP_49_PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const term of [
        'runConfirmedActionReviewQueue',
        'ConfirmedActionReviewQueueCandidate',
        'ConfirmedActionEnvelope',
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

  it('keeps transport isolation static guards precise', () => {
    for (const file of CORE_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const term of TERMS_BANNED_OUTSIDE_TRANSPORT) {
        expect(source).not.toContain(term);
      }
    }

    const transportSource = readFileSync(TRANSPORT_FILE, 'utf8');
    for (const term of TERMS_ALLOWED_ONLY_IN_TRANSPORT) {
      expect(transportSource).toContain(term);
    }
    for (const term of TERMS_BANNED_IN_TRANSPORT) {
      expect(transportSource).not.toContain(term);
    }

    const testSource = readFileSync(TEST_FILE, 'utf8');
    expect(testSource).not.toMatch(/from ['"]\.\.\/lib\/liveProviderSandboxCall\/liveProviderSandboxTransport['"]/);
    expect(testSource).not.toMatch(/import\s+\{[^}]*createLiveProviderSandboxTransport/);
  });

  it('proves only the transport file contains live transport markers in Loop 49 files', () => {
    const loop49Sources = Object.fromEntries(
      [CORE_FILE, FIXTURE_FILE, TRANSPORT_FILE].map(file => [file, readFileSync(file, 'utf8')]),
    );

    for (const term of TERMS_ALLOWED_ONLY_IN_TRANSPORT) {
      expect(Object.entries(loop49Sources)
        .filter(([, source]) => source.includes(term))
        .map(([file]) => file)).toEqual([TRANSPORT_FILE]);
    }
    expect(loop49Sources[CORE_FILE]).not.toContain('process.env');
    expect(loop49Sources[FIXTURE_FILE]).not.toContain('process.env');
    expect(loop49Sources[TRANSPORT_FILE]).not.toContain('process.env');
  });

  it('does not modify files outside the Loop 49 allowed file set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    expect(changedFiles.filter(file => !LOOP_49_ALLOWED_CHANGED_FILES.has(file))).toEqual([]);
    expect(matchesAllowedChangedFileSet(changedFiles)).toBe(true);
    expect(changedFiles).not.toContain('src/lib/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts');
    expect(changedFiles).not.toContain('src/tests/liveProviderSandboxCall.readiness.test.ts');
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/components/'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
  });

  it('keeps changed-file scope helper strict for Loop 49 and Loop 50 cohorts', () => {
    expect(matchesAllowedChangedFileSet(LOOP_49_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(matchesAllowedChangedFileSet(LOOP_50_REQUIRED_CHANGED_FILES)).toBe(true);
    expect(matchesAllowedChangedFileSet(LOOP_50_BATCH_OLD_GUARD_RISK_CLOSE_CHANGED_FILES)).toBe(true);
    expect(matchesAllowedChangedFileSet(LOOP_49_REQUIRED_CHANGED_FILES.slice(0, -1))).toBe(false);
    expect(matchesAllowedChangedFileSet(LOOP_50_REQUIRED_CHANGED_FILES.slice(0, -1))).toBe(false);
    expect(matchesAllowedChangedFileSet([
      'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
      'src/lib/liveProviderSandboxCallReadiness.ts',
      'src/lib/manualLiveProviderSmokeGateReadiness.ts',
    ])).toBe(false);
    expect(matchesAllowedChangedFileSet([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/__tests__/loop51.readiness.test.ts',
    ])).toBe(false);
    expect(matchesAllowedChangedFileSet([
      ...LOOP_50_REQUIRED_CHANGED_FILES,
      'src/lib/foo.ts',
    ])).toBe(false);
    expect(matchesAllowedChangedFileSet([])).toBe(false);
    expect(LOOP_49_ALLOWED_CHANGED_FILES.has('src/lib/**')).toBe(false);
    expect(LOOP_49_ALLOWED_CHANGED_FILES.has('src/lib/manualLiveProviderSmokeGate/**')).toBe(false);
    expect(matchesAllowedChangedFileSet([
      'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
      'src/lib/manualLiveProviderSmokeGate/extraFixture.ts',
      'src/lib/manualLiveProviderSmokeGateReadiness.ts',
      'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
    ])).toBe(false);
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      allow_live_call: true,
      allow_network: true,
      api_key_resolved: true,
      redact_prompt: true,
      redact_response: true,
      sandbox_only: true,
      represents_model_output: true,
      live_call_attempted: true,
      live_call_succeeded: true,
      validation_checked: true,
      resolved: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });
});

async function runWithRequest(
  request: LiveProviderSandboxCallRequest,
  transport = buildFakeLiveProviderSandboxTransportV1(),
): Promise<LiveProviderSandboxCallResult> {
  return runLiveProviderSandboxCall(buildLiveProviderSandboxCallPlan(request), {
    secret_resolver: fakeProviderSecretResolverV1,
    transport,
  });
}

function buildSafeTransportResult(): LiveProviderSandboxTransportResult {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT_RESULT',
    transport_mode: 'fake',
    live_provider_response: false,
    live_call_attempted: true,
    live_call_succeeded: true,
    uses_network: false,
    calls_real_provider: false,
    output_text_redacted: 'safe sandbox text',
    error_envelope: null,
    raw_output_stored: false,
    contains_secret: false,
    contains_pii: false,
    trusted_for_action: false,
    executable: false,
    produces_proposal: false,
    enters_review_queue: false,
    persisted: false,
  };
}

function mergeResult(
  base: LiveProviderSandboxCallResult,
  override: Partial<LiveProviderSandboxCallResult>,
): LiveProviderSandboxCallResult {
  return {
    ...base,
    ...override,
    answer: {
      ...base.answer,
      ...override.answer,
    },
  } as LiveProviderSandboxCallResult;
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

function matchesAllowedChangedFileSet(changedFiles: readonly string[]): boolean {
  if (changedFiles.length === 0) return false;
  if (changedFiles.some(file => !LOOP_49_ALLOWED_CHANGED_FILES.has(file))) return false;

  return ACCEPTED_CHANGED_FILE_SETS.some(requiredFiles => {
    const required = new Set(requiredFiles);
    return changedFiles.length === required.size && changedFiles.every(file => required.has(file));
  });
}
