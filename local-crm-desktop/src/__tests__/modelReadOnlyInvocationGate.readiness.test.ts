import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildBlockedModelReadOnlyInvocationCandidate,
  buildModelReadOnlyInvocationGatePlan,
  runModelReadOnlyInvocationGate,
  validateModelReadOnlyInvocationCandidate,
  validateModelReadOnlyInvocationGateRequest,
  validateModelReadOnlyInvocationGateResult,
  type ModelReadOnlyInvocationCandidate,
  type ModelReadOnlyInvocationGateBlockedReason,
  type ModelReadOnlyInvocationGateResult,
} from '../lib/modelReadOnlyInvocationGateReadiness';
import { buildModelReadOnlyInvocationGateRequestFixtureV1 } from '../lib/modelReadOnlyInvocationGate/modelReadOnlyInvocationGateFixturesV1';
import type { ModelProviderBoundaryContractResult } from '../lib/modelProviderBoundaryContractReadiness';

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

const LOOP_44_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/modelReadOnlyInvocationGateReadiness.ts',
  'src/lib/modelReadOnlyInvocationGate/modelReadOnlyInvocationGateFixturesV1.ts',
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/lib/modelSuggestOnlyOutputGateReadiness.ts',
  'src/lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
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

const PRODUCTION_AND_FIXTURE_FILES = [
  'src/lib/modelReadOnlyInvocationGateReadiness.ts',
  'src/lib/modelReadOnlyInvocationGate/modelReadOnlyInvocationGateFixturesV1.ts',
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

const FORBIDDEN_DB_RUNNER_UI_TERMS = [
  'getDb',
  'db.select',
  'db.execute',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
  'runModelProviderBoundaryContract',
  'runModelProviderReadOnlySandbox',
  'runDashboardDataProjection',
  'runSafeWriteRunnerGate',
  'runDbWritePlanDryRun',
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

const FORBIDDEN_OUTPUT_FIELDS = [
  'output_text',
  'model_response',
  'generated_text',
  'assistant_message',
  'suggestion_text',
];

const DANGEROUS_TRUE_STATE_KEYS = [
  'allow_invocation',
  'allow_live_call',
  'allow_network',
  'allow_env_read',
  'allow_secret_material',
  'allow_db',
  'allow_runner',
  'allow_execution',
  'allow_review_queue_entry',
  'allow_write_plan_entry',
  'allow_tool_calls',
  'invocation_ready',
  'live_call_ready',
  'calls_real_provider',
  'uses_network',
  'reads_env',
  'reads_database',
  'writes_database',
  'contains_secret',
  'contains_pii',
  'exposes_secret',
  'resolved',
  'from_database',
  'from_live_customer_data',
  'usable_for_live_call',
  'executable',
  'produces_model_output',
  'produces_suggestion',
  'produces_proposal',
  'produces_executable_proposal',
  'enters_review_queue',
  'enters_write_plan',
  'represents_live_model_call',
  'represents_model_output',
  'represents_executed_action',
  'persisted',
];

describe('Model read-only invocation gate readiness', () => {
  it('builds a gate-only blocked invocation candidate from caller-provided inputs', () => {
    const request = buildModelReadOnlyInvocationGateRequestFixtureV1({
      source_boundary_result: buildSafeSourceBoundaryResult(),
    });
    const plan = buildModelReadOnlyInvocationGatePlan(request);
    const result = runModelReadOnlyInvocationGate(plan);

    expect(validateModelReadOnlyInvocationGateRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(plan).toMatchObject({
      kind: 'MODEL_READ_ONLY_INVOCATION_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_read_only_invocation_gate_readiness_only',
      allowed_operations: [
        'validate_caller_provided_invocation_gate_request',
        'build_blocked_invocation_candidate',
        'build_invocation_gate_result',
      ],
    });
    expect(result).toMatchObject({
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
        kind: 'MODEL_READ_ONLY_INVOCATION_GATE_ANSWER',
        invocation_gate_blocked: false,
        blocked_reason: null,
        generated_invocation_candidate: true,
        contract_only: true,
        gate_only: true,
        read_only: true,
        invocation_ready: false,
        live_call_ready: false,
        calls_real_provider: false,
        uses_network: false,
        reads_env: false,
        exposes_secret: false,
        reads_database: false,
        writes_database: false,
        executes_action: false,
        calls_runner: false,
        produces_model_output: false,
        produces_suggestion: false,
        produces_executable_proposal: false,
        enters_review_queue: false,
        enters_human_confirmation: false,
        enters_write_plan: false,
      },
    });
    expect(result.answer.source_boundary_result).toBe(request.source_boundary_result);
    expect(result.answer.invocation_candidate).toMatchObject({
      kind: 'MODEL_READ_ONLY_INVOCATION_CANDIDATE',
      invocation_candidate_id: 'MODEL_INVOCATION_GATE_CANDIDATE_001',
      provider_kind: 'future_provider_placeholder',
      model_id: 'future-model-placeholder',
      invocation_status: 'blocked_invocation_policy_only',
      source_boundary_candidate_id: 'MODEL_PROVIDER_BOUNDARY_CANDIDATE_001',
      invocation_ready: false,
      live_call_ready: false,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      contains_secret: false,
      contains_pii: false,
      exposes_secret: false,
      executable: false,
      produces_model_output: false,
      produces_suggestion: false,
      produces_proposal: false,
      enters_review_queue: false,
      enters_write_plan: false,
      represents_live_model_call: false,
      represents_executed_action: false,
    });
    expect(result.answer.invocation_candidate?.invocation_status.startsWith('blocked_')).toBe(true);
    expect(result.answer).not.toHaveProperty('output_text');
    expect(result.answer).not.toHaveProperty('model_response');
    expect(result.answer).not.toHaveProperty('generated_text');
    expect(result.answer).not.toHaveProperty('assistant_message');
    expect(result.answer).not.toHaveProperty('suggestion_text');
    expect(validateModelReadOnlyInvocationGateResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['illegal_invocation_allowed', { allow_invocation: true }],
    ['illegal_live_call_allowed', { allow_live_call: true }],
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_secret_material_allowed', { allow_secret_material: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
    ['illegal_review_queue_entry_allowed', { allow_review_queue_entry: true }],
    ['illegal_write_plan_entry_allowed', { allow_write_plan_entry: true }],
  ] satisfies [
    ModelReadOnlyInvocationGateBlockedReason,
    Parameters<typeof buildModelReadOnlyInvocationGateRequestFixtureV1>[0],
  ][])(
    'blocks unsafe permission: %s',
    (expectedReason, options) => {
      const result = runWithRequest(buildModelReadOnlyInvocationGateRequestFixtureV1(options));

      expect(result.answer).toMatchObject({
        invocation_gate_blocked: true,
        blocked_reason: expectedReason,
        generated_invocation_candidate: false,
        invocation_candidate: null,
        invocation_ready: false,
        live_call_ready: false,
        calls_real_provider: false,
        uses_network: false,
        produces_model_output: false,
        produces_suggestion: false,
        enters_review_queue: false,
        enters_write_plan: false,
      });
    },
  );

  it.each([
    ['illegal_invocation_input_resolved', { input_resolved: true }],
    ['illegal_invocation_input_contains_secret', { input_contains_secret: true }],
    ['illegal_invocation_input_contains_pii', { input_contains_pii: true }],
    ['illegal_invocation_input_from_database', { input_from_database: true }],
    ['illegal_invocation_input_from_live_customer_data', { input_from_live_customer_data: true }],
    ['illegal_invocation_input_usable_for_live_call', { input_usable_for_live_call: true }],
  ] satisfies [
    ModelReadOnlyInvocationGateBlockedReason,
    Parameters<typeof buildModelReadOnlyInvocationGateRequestFixtureV1>[0],
  ][])(
    'blocks unsafe invocation input: %s',
    (expectedReason, options) => {
      const request = buildModelReadOnlyInvocationGateRequestFixtureV1(options);

      expect(validateModelReadOnlyInvocationGateRequest(request)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_source_boundary_called_real_provider', { calls_real_provider: true }],
    ['illegal_source_boundary_used_network', { uses_network: true }],
    ['illegal_source_boundary_live_ready', { answer: { live_call_ready: true } }],
    ['illegal_source_boundary_adapter_ready', { answer: { live_adapter_candidate: { adapter_status: 'ready' } } }],
  ] satisfies [
    ModelReadOnlyInvocationGateBlockedReason,
    Partial<ModelProviderBoundaryContractResult>,
  ][])(
    'blocks unsafe caller-provided source boundary result: %s',
    (expectedReason, override) => {
      const request = buildModelReadOnlyInvocationGateRequestFixtureV1({
        source_boundary_result: mergeSourceBoundaryResult(override),
      });

      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_invocation_allowed', { invocation_ready: true }],
    ['illegal_invocation_allowed', { live_call_ready: true }],
    ['illegal_invocation_allowed', { executable: true }],
    ['illegal_source_boundary_called_real_provider', { calls_real_provider: true }],
    ['illegal_network_allowed', { uses_network: true }],
    ['illegal_env_read_allowed', { reads_env: true }],
    ['illegal_output_contains_secret', { contains_secret: true }],
    ['illegal_output_contains_secret', { contains_pii: true }],
    ['illegal_output_contains_secret', { exposes_secret: true }],
    ['illegal_output_produces_model_output', { produces_model_output: true }],
    ['illegal_output_produces_suggestion', { produces_suggestion: true }],
    ['illegal_output_produces_suggestion', { produces_proposal: true }],
    ['illegal_output_enters_review_queue', { enters_review_queue: true }],
    ['illegal_output_enters_write_plan', { enters_write_plan: true }],
  ] satisfies [
    ModelReadOnlyInvocationGateBlockedReason,
    Partial<ModelReadOnlyInvocationCandidate>,
  ][])(
    'blocks unsafe candidate mutation: %s',
    (expectedReason, override) => {
      const candidate = buildBlockedModelReadOnlyInvocationCandidate(
        buildModelReadOnlyInvocationGatePlan(buildModelReadOnlyInvocationGateRequestFixtureV1()).request,
      );

      expect(validateModelReadOnlyInvocationCandidate({ ...candidate, ...override })).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('guards invocation status exact enum values without banning safe false-state field names', () => {
    const candidate = buildBlockedModelReadOnlyInvocationCandidate(
      buildModelReadOnlyInvocationGatePlan(buildModelReadOnlyInvocationGateRequestFixtureV1()).request,
    );

    expect(candidate.invocation_status.startsWith('blocked_')).toBe(true);
    for (const invocation_status of [
      'ready',
      'enabled',
      'live',
      'connected',
      'callable',
      'invocable',
      'executable',
      'success',
      'invoked',
      'completed',
    ]) {
      expect(validateModelReadOnlyInvocationCandidate({ ...candidate, invocation_status })).toEqual({
        ok: false,
        blocked_reason: 'illegal_source_boundary_adapter_ready',
      });
    }
    expect(validateModelReadOnlyInvocationCandidate({
      ...candidate,
      invocation_status: 'blocked_network_not_allowed',
      invocation_ready: false,
      live_call_ready: false,
    })).toEqual({ ok: true, blocked_reason: null });
  });

  it('keeps output free of model output, suggestion, and chain entry states', () => {
    const result = runWithRequest(buildModelReadOnlyInvocationGateRequestFixtureV1());
    const candidate = result.answer.invocation_candidate;

    expect(candidate).toMatchObject({
      invocation_ready: false,
      live_call_ready: false,
      produces_model_output: false,
      produces_suggestion: false,
      produces_proposal: false,
      enters_review_queue: false,
      enters_write_plan: false,
    });
    expect(findDangerousTrueStates(result)).toEqual([]);
    for (const field of FORBIDDEN_OUTPUT_FIELDS) {
      expect(JSON.stringify(result)).not.toContain(field);
    }
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      required: true,
      blocking: true,
      policy_only: true,
      placeholder_only: true,
      denial_only: true,
      blocks_invocation: true,
      require_redacted_input: true,
      require_boundary_contract: true,
      require_user_approval_before_live_call: true,
      require_timeout_policy: true,
      require_cost_limit: true,
      require_audit_trace: true,
      caller_provided_only: true,
      invocation_gate_only: true,
      contract_only: true,
      gate_only: true,
      read_only: true,
      all_candidates_blocked: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    expect(findDangerousTrueStates({ invocation_ready: false })).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });

  it('is deterministic and preserves caller-provided object references', () => {
    const request = buildModelReadOnlyInvocationGateRequestFixtureV1({
      source_boundary_result: buildSafeSourceBoundaryResult(),
    });
    const before = JSON.stringify(request);
    const placeholder = request.invocation_input_placeholder;
    const sourceBoundary = request.source_boundary_result;
    const plan = buildModelReadOnlyInvocationGatePlan(request);
    const first = runModelReadOnlyInvocationGate(plan);
    const second = runModelReadOnlyInvocationGate(plan);

    expect(first).toEqual(second);
    expect(first.answer.invocation_candidate?.invocation_candidate_id).toBe('MODEL_INVOCATION_GATE_CANDIDATE_001');
    expect(JSON.stringify(request)).toBe(before);
    expect(request.invocation_input_placeholder).toBe(placeholder);
    expect(first.answer.invocation_candidate?.invocation_input_placeholder).toBe(placeholder);
    expect(first.answer.source_boundary_result).toBe(sourceBoundary);
  });

  it('keeps production and fixture source free of live provider, DB, runner, UI, output, and unstable APIs', () => {
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');

      for (const term of [
        ...FORBIDDEN_LIVE_PROVIDER_TERMS,
        ...FORBIDDEN_DB_RUNNER_UI_TERMS,
        ...FORBIDDEN_UNSTABLE_TERMS,
        ...FORBIDDEN_OUTPUT_FIELDS,
      ]) {
        expect(source).not.toContain(term);
      }
      expect(source).not.toMatch(/\b(invoke|call|complete|generate|assess)\s*\(/);
    }
  });

  it('does not modify files outside the Loop 44 allowed change set', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

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

    const loop54Files = new Set(LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES);
    const matchesLoop54 = changedFiles.length === loop54Files.size
      && changedFiles.every(file => loop54Files.has(file));
    expect(changedFiles.filter(file => !LOOP_44_ALLOWED_CHANGED_FILES.has(file) && !matchesLoop54)).toEqual([]);
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
  request: Parameters<typeof buildModelReadOnlyInvocationGatePlan>[0],
): ModelReadOnlyInvocationGateResult {
  return runModelReadOnlyInvocationGate(buildModelReadOnlyInvocationGatePlan(request));
}

function buildSafeSourceBoundaryResult(): ModelProviderBoundaryContractResult {
  return {
    kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_RESULT',
    version: 'v1',
    persisted: false,
    reads_database: false,
    writes_database: false,
    reads_env: false,
    calls_real_provider: false,
    uses_network: false,
    represents_live_model_call: false,
    represents_executed_action: false,
    answer: {
      live_call_ready: false,
      live_adapter_candidate: {
        adapter_candidate_id: 'MODEL_PROVIDER_BOUNDARY_CANDIDATE_001',
        adapter_status: 'blocked_boundary_contract_only',
      },
    },
  } as ModelProviderBoundaryContractResult;
}

function mergeSourceBoundaryResult(
  override: Partial<ModelProviderBoundaryContractResult>,
): ModelProviderBoundaryContractResult {
  const base = buildSafeSourceBoundaryResult() as unknown as Record<string, unknown>;
  const answer = {
    ...((base.answer ?? {}) as Record<string, unknown>),
    ...((override.answer ?? {}) as Record<string, unknown>),
  };
  return {
    ...base,
    ...override,
    answer,
  } as unknown as ModelProviderBoundaryContractResult;
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
import { hasExactStage2ChangedFileSet } from './stage2ChangedFileCohort';
import { hasExactStage3StabilizationChangedFileSet, hasExactStage4CopilotChangedFileSet } from './stage3StabilizationChangedFileCohort';
