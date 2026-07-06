import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildModelProviderReadOnlySandboxPlan,
  buildModelProviderReadOnlySandboxTrace,
  runModelProviderReadOnlySandbox,
  validateModelProviderReadOnlySandboxRequest,
  validateModelProviderReadOnlySandboxResult,
  validateModelProviderReadOnlySandboxTransport,
  validateModelProviderSandboxTransportOutput,
  type ModelProviderReadOnlySandboxBlockedReason,
  type ModelProviderReadOnlySandboxResult,
  type ModelProviderSandboxResponseEnvelope,
} from '../lib/modelProviderReadOnlySandboxReadiness';
import {
  buildModelProviderReadOnlySandboxRequestFixtureV1,
  buildModelSandboxMessageFixtureV1,
  createFixtureModelProviderTransportV1,
} from '../lib/modelProviderReadOnlySandbox/modelProviderReadOnlySandboxFixturesV1';

const LOOP_42_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/modelProviderReadOnlySandboxReadiness.ts',
  'src/lib/modelProviderReadOnlySandbox/modelProviderReadOnlySandboxFixturesV1.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/lib/modelProviderBoundaryContractReadiness.ts',
  'src/lib/modelProviderBoundaryContract/modelProviderBoundaryContractFixturesV1.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/lib/modelReadOnlyInvocationGateReadiness.ts',
  'src/lib/modelReadOnlyInvocationGate/modelReadOnlyInvocationGateFixturesV1.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
]);

const PRODUCTION_AND_FIXTURE_FILES = [
  'src/lib/modelProviderReadOnlySandboxReadiness.ts',
  'src/lib/modelProviderReadOnlySandbox/modelProviderReadOnlySandboxFixturesV1.ts',
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
  'https://',
  'http://',
];

const FORBIDDEN_DB_RUNNER_UI_AND_RUNTIME_TERMS = [
  'getDb',
  'db.select',
  'db.execute',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
  'runDashboardDataProjection',
  'runSafeWriteRunnerGate',
  'runDbWritePlanDryRun',
  'runActionRunnerBoundaryContract',
  'runHumanConfirmationContract',
  'runConfirmedActionReviewQueue',
  'runConfirmedActionLiveDryRun',
  'runSuggestOnlyLiveDryRun',
  'ActionRunner',
  'WriteRunner',
  'executeAction',
  'invokeWithFixtureAdapter',
  'PromptRuntime',
  'ModelRouterRuntime',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'React',
  'pages',
  'components',
];

const FORBIDDEN_UNSTABLE_TERMS = [
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
];

describe('Model provider read-only sandbox readiness', () => {
  it('runs a caller-provided request through sync fixture transport', () => {
    const request = buildModelProviderReadOnlySandboxRequestFixtureV1();
    const plan = buildModelProviderReadOnlySandboxPlan(request);
    const transport = createFixtureModelProviderTransportV1();
    const result = runModelProviderReadOnlySandbox(plan, transport);

    expect(validateModelProviderReadOnlySandboxRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(validateModelProviderReadOnlySandboxTransport(transport)).toEqual({ ok: true, blocked_reason: null });
    expect(plan).toMatchObject({
      kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_provider_read_only_sandbox_readiness_only',
      allowed_operations: [
        'validate_caller_provided_sandbox_request',
        'invoke_fixture_model_provider_transport',
        'build_provider_sandbox_result',
      ],
      safety: {
        read_only: true,
        fixture_transport_only: true,
        calls_real_provider: false,
        uses_network: false,
        reads_database: false,
        writes_database: false,
        executes_action: false,
        calls_runner: false,
      },
    });
    expect(result).toMatchObject({
      kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_RESULT',
      version: 'v1',
      persisted: false,
      reads_database: false,
      writes_database: false,
      calls_real_provider: false,
      uses_network: false,
      represents_live_model_call: false,
      represents_executed_action: false,
      answer: {
        kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_ANSWER',
        sandbox_blocked: false,
        blocked_reason: null,
        generated_provider_envelope: true,
        provider_error: null,
        contract_only: true,
        sandbox_only: true,
        read_only: true,
        fixture_transport_only: true,
        calls_real_provider: false,
        uses_network: false,
        reads_database: false,
        writes_database: false,
        executes_action: false,
        calls_runner: false,
        exposes_secret: false,
        persists_output: false,
        produces_executable_proposal: false,
        enters_review_queue: false,
        enters_human_confirmation: false,
        enters_write_plan: false,
      },
    });
    expect(result.answer.source_request).toBe(plan.request);
    expect(result.answer.provider_response).toMatchObject({
      kind: 'MODEL_PROVIDER_SANDBOX_RESPONSE_ENVELOPE',
      response_id: 'MODEL_SANDBOX_FIXTURE_RESPONSE_001',
      provider_kind: 'fixture_provider_v1',
      model_id: 'fixture-model-v1',
      finish_reason: 'stop',
      source_transport: 'fixture',
      sandbox_fixture_only: true,
      calls_real_provider: false,
      uses_network: false,
      contains_secret: false,
      contains_pii: false,
      persisted: false,
      executable: false,
      represents_executed_action: false,
      produces_proposal: false,
    });
    expect(result.answer.provider_response?.output_text).toContain('Read only sandbox fixture response');
    expect(validateModelProviderReadOnlySandboxResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_tool_calls_allowed', { allow_tool_calls: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
  ] satisfies [
    ModelProviderReadOnlySandboxBlockedReason,
    Parameters<typeof buildModelProviderReadOnlySandboxRequestFixtureV1>[0],
  ][])(
    'blocks unsafe permission: %s',
    (expectedReason, options) => {
      const result = runWithRequest(buildModelProviderReadOnlySandboxRequestFixtureV1(options));

      expect(result.answer).toMatchObject({
        sandbox_blocked: true,
        blocked_reason: expectedReason,
        generated_provider_envelope: false,
        provider_response: null,
        calls_real_provider: false,
        uses_network: false,
        enters_review_queue: false,
        enters_write_plan: false,
      });
      expect(result.answer.provider_error).toMatchObject({
        error_type: expectedReason,
        retryable: false,
        source_transport: 'fixture',
        contains_secret: false,
        contains_pii: false,
        persisted: false,
      });
    },
  );

  it.each([
    ['illegal_secret_in_input', buildModelSandboxMessageFixtureV1('user', 'fixture unsafe marker', {
      contains_secret: true,
    })],
    ['illegal_pii_in_input', buildModelSandboxMessageFixtureV1('user', 'fixture unsafe marker', {
      contains_pii: true,
    })],
  ] satisfies [
    ModelProviderReadOnlySandboxBlockedReason,
    ReturnType<typeof buildModelSandboxMessageFixtureV1>,
  ][])(
    'blocks secret or PII marked input: %s',
    (expectedReason, message) => {
      const request = buildModelProviderReadOnlySandboxRequestFixtureV1({ input_messages: [message] });
      const result = runWithRequest(request);

      expect(result.answer.sandbox_blocked).toBe(true);
      expect(result.answer.blocked_reason).toBe(expectedReason);
      expect(result.answer.provider_response).toBeNull();
      expect(result.answer.exposes_secret).toBe(false);
    },
  );

  it.each([
    ['illegal_live_provider_config_resolved', { provider_config_resolved: true }],
    ['illegal_live_provider_config_reads_env', { provider_config_reads_env: true }],
    ['illegal_live_provider_config_contains_secret', { provider_config_contains_secret: true }],
    ['illegal_live_provider_config_usable_for_live_call', { provider_config_usable_for_live_call: true }],
  ] satisfies [
    ModelProviderReadOnlySandboxBlockedReason,
    Parameters<typeof buildModelProviderReadOnlySandboxRequestFixtureV1>[0],
  ][])(
    'blocks live config placeholder escalation: %s',
    (expectedReason, options) => {
      const request = buildModelProviderReadOnlySandboxRequestFixtureV1(options);

      expect(validateModelProviderReadOnlySandboxRequest(request)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it('builds trace and preserves deterministic response id sequence', () => {
    const request = buildModelProviderReadOnlySandboxRequestFixtureV1();
    const plan = buildModelProviderReadOnlySandboxPlan(request);
    const transport = createFixtureModelProviderTransportV1();
    const first = runModelProviderReadOnlySandbox(plan, transport);
    const second = runModelProviderReadOnlySandbox(plan, transport);
    const trace = buildModelProviderReadOnlySandboxTrace(plan, transport);

    expect(first).toEqual(second);
    expect(first.answer.provider_response?.response_id).toBe('MODEL_SANDBOX_FIXTURE_RESPONSE_001');
    expect(first.answer.provider_response?.response_id).not.toContain('LIVE');
    expect(trace).toMatchObject({
      kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_TRACE',
      persisted: false,
      writes_database: false,
      result: {
        answer: {
          trace_summary: {
            request_id: 'MODEL_SANDBOX_FIXTURE_REQUEST_A',
            transport_kind: 'fixture',
            validation_checked: true,
            result_checked: true,
            persisted: false,
          },
        },
      },
    });
  });

  it('keeps request object and input messages unchanged', () => {
    const request = buildModelProviderReadOnlySandboxRequestFixtureV1();
    const before = JSON.stringify(request);
    const messages = request.input_messages;
    const result = runWithRequest(request);

    expect(JSON.stringify(request)).toBe(before);
    expect(result.answer.source_request.input_messages).toBe(messages);
    expect(result.answer.source_request).toBe(request);
  });

  it.each([
    ['illegal_real_provider_call', { calls_real_provider: true }],
    ['illegal_transport_uses_network', { uses_network: true }],
  ] as const)(
    'blocks unsafe transport flags: %s',
    (expectedReason, override) => {
      const transport = {
        ...createFixtureModelProviderTransportV1(),
        ...override,
      };
      const plan = buildModelProviderReadOnlySandboxPlan(buildModelProviderReadOnlySandboxRequestFixtureV1());
      const result = runModelProviderReadOnlySandbox(plan, transport);

      expect(result.answer.sandbox_blocked).toBe(true);
      expect(result.answer.blocked_reason).toBe(expectedReason);
      expect(result.answer.generated_provider_envelope).toBe(false);
    },
  );

  it.each([
    ['illegal_real_provider_call', { calls_real_provider: true }],
    ['illegal_transport_uses_network', { uses_network: true }],
    ['illegal_output_executable', { executable: true }],
    ['illegal_output_executable', { produces_proposal: true }],
    ['illegal_output_executable', { represents_executed_action: true }],
    ['illegal_output_persisted', { persisted: true }],
    ['illegal_output_contains_secret', { contains_secret: true }],
    ['illegal_output_contains_pii', { contains_pii: true }],
  ] satisfies [
    ModelProviderReadOnlySandboxBlockedReason,
    Partial<ModelProviderSandboxResponseEnvelope>,
  ][])(
    'blocks unsafe transport output mutation: %s',
    (expectedReason, override) => {
      const result = runWithRequest(buildModelProviderReadOnlySandboxRequestFixtureV1());
      const output = { ...result.answer.provider_response, ...override } as ModelProviderSandboxResponseEnvelope;

      expect(validateModelProviderSandboxTransportOutput(output)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it.each([
    ['illegal_output_executable', { produces_executable_proposal: true }],
    ['illegal_output_enters_review_queue', { enters_review_queue: true }],
    ['illegal_output_enters_write_plan', { enters_write_plan: true }],
    ['illegal_output_persisted', { persists_output: true }],
    ['illegal_output_contains_secret', { exposes_secret: true }],
  ] satisfies [
    ModelProviderReadOnlySandboxBlockedReason,
    Partial<ModelProviderReadOnlySandboxResult['answer']>,
  ][])(
    'detects unsafe final answer mutation: %s',
    (expectedReason, override) => {
      const result = runWithRequest(buildModelProviderReadOnlySandboxRequestFixtureV1());
      const mutated = {
        ...result,
        answer: {
          ...result.answer,
          ...override,
        },
      } as ModelProviderReadOnlySandboxResult;

      expect(validateModelProviderReadOnlySandboxResult(mutated)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('keeps error messages redacted and without live transport markers', () => {
    const result = runWithRequest(buildModelProviderReadOnlySandboxRequestFixtureV1({ allow_network: true }));
    const message = result.answer.provider_error?.error_message ?? '';

    for (const forbidden of [
      'API_KEY',
      'Authorization',
      'Bearer',
      'sk-',
      'http://',
      'https://',
    ]) {
      expect(message).not.toContain(forbidden);
    }
    expect(message).not.toMatch(/[A-Za-z0-9_-]{24,}/);
  });

  it('keeps production and fixture source free of live provider, DB, runner, UI, and unstable APIs', () => {
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');

      for (const term of [
        ...FORBIDDEN_LIVE_PROVIDER_TERMS,
        ...FORBIDDEN_DB_RUNNER_UI_AND_RUNTIME_TERMS,
        ...FORBIDDEN_UNSTABLE_TERMS,
      ]) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('does not modify files outside the Loop 42 allowed change set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    expect(changedFiles.filter(file => !LOOP_42_ALLOWED_CHANGED_FILES.has(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/components/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
  });
});

function runWithRequest(
  request: Parameters<typeof buildModelProviderReadOnlySandboxPlan>[0],
): ModelProviderReadOnlySandboxResult {
  return runModelProviderReadOnlySandbox(
    buildModelProviderReadOnlySandboxPlan(request),
    createFixtureModelProviderTransportV1(),
  );
}

function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
}
