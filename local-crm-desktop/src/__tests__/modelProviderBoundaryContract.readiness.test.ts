import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildBlockedLiveProviderAdapterCandidate,
  buildModelProviderBoundaryContractPlan,
  runModelProviderBoundaryContract,
  validateLiveProviderAdapterCandidate,
  validateModelProviderBoundaryContractRequest,
  validateModelProviderBoundaryContractResult,
  type LiveProviderAdapterCandidate,
  type ModelProviderBoundaryBlockedReason,
  type ModelProviderBoundaryContractResult,
} from '../lib/modelProviderBoundaryContractReadiness';
import { buildModelProviderBoundaryContractRequestFixtureV1 } from '../lib/modelProviderBoundaryContract/modelProviderBoundaryContractFixturesV1';
import type { ModelProviderReadOnlySandboxResult } from '../lib/modelProviderReadOnlySandboxReadiness';

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

const LOOP_43_ALLOWED_CHANGED_FILES = new Set([
  'src/lib/modelProviderBoundaryContractReadiness.ts',
  'src/lib/modelProviderBoundaryContract/modelProviderBoundaryContractFixturesV1.ts',
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/lib/modelReadOnlyInvocationGateReadiness.ts',
  'src/lib/modelReadOnlyInvocationGate/modelReadOnlyInvocationGateFixturesV1.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/lib/modelSuggestOnlyOutputGateReadiness.ts',
  'src/lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
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
  'src/lib/modelProviderBoundaryContractReadiness.ts',
  'src/lib/modelProviderBoundaryContract/modelProviderBoundaryContractFixturesV1.ts',
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
  'runModelProviderReadOnlySandbox',
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
  'React',
  'pages',
  'components',
];

const FORBIDDEN_UNSTABLE_TERMS = [
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
];

const DANGEROUS_TRUE_STATE_KEYS = [
  'allow_live_call',
  'allow_network',
  'allow_env_read',
  'allow_secret_material',
  'allow_db',
  'allow_runner',
  'allow_execution',
  'resolved',
  'has_api_key',
  'contains_secret',
  'reads_env',
  'reads_settings',
  'usable_for_live_call',
  'adapter_enabled',
  'live_call_ready',
  'calls_real_provider',
  'uses_network',
  'reads_database',
  'writes_database',
  'executable',
  'produces_proposal',
  'enters_review_queue',
  'enters_write_plan',
  'persists_request',
  'persists_response',
  'represents_live_model_call',
  'represents_executed_action',
  'persisted',
  'exposes_secret',
];

describe('Model provider boundary contract readiness', () => {
  it('builds a boundary-only blocked adapter candidate from caller-provided inputs', () => {
    const request = buildModelProviderBoundaryContractRequestFixtureV1({
      source_sandbox_result: buildSafeSourceSandboxResult(),
    });
    const plan = buildModelProviderBoundaryContractPlan(request);
    const result = runModelProviderBoundaryContract(plan);

    expect(validateModelProviderBoundaryContractRequest(request)).toEqual({ ok: true, blocked_reason: null });
    expect(plan).toMatchObject({
      kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_provider_boundary_contract_readiness_only',
      allowed_operations: [
        'validate_caller_provided_boundary_contract_request',
        'build_blocked_live_provider_adapter_candidate',
        'build_boundary_contract_result',
      ],
    });
    expect(result).toMatchObject({
      kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_RESULT',
      version: 'v1',
      persisted: false,
      reads_database: false,
      writes_database: false,
      reads_env: false,
      uses_network: false,
      calls_real_provider: false,
      represents_live_model_call: false,
      represents_executed_action: false,
      answer: {
        kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_ANSWER',
        boundary_blocked: false,
        blocked_reason: null,
        generated_boundary_contract: true,
        contract_only: true,
        boundary_only: true,
        defines_live_adapter_boundary: true,
        live_call_ready: false,
        calls_real_provider: false,
        uses_network: false,
        reads_env: false,
        exposes_secret: false,
        reads_database: false,
        writes_database: false,
        executes_action: false,
        calls_runner: false,
        persists_request: false,
        persists_response: false,
        produces_executable_proposal: false,
        enters_review_queue: false,
        enters_human_confirmation: false,
        enters_write_plan: false,
      },
    });
    expect(result.answer.source_sandbox_result).toBe(request.source_sandbox_result);
    expect(result.answer).not.toHaveProperty('model_output');
    expect(result.answer).not.toHaveProperty('provider_response');
    expect(result.answer.live_adapter_candidate).toMatchObject({
      kind: 'LIVE_PROVIDER_ADAPTER_CANDIDATE',
      adapter_candidate_id: 'MODEL_PROVIDER_BOUNDARY_CANDIDATE_001',
      provider_kind: 'future_provider_placeholder',
      model_id: 'future-model-placeholder',
      adapter_status: 'blocked_boundary_contract_only',
      adapter_enabled: false,
      live_call_ready: false,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      contains_secret: false,
      exposes_secret: false,
      persists_request: false,
      persists_response: false,
      executable: false,
      represents_live_model_call: false,
      produces_proposal: false,
      enters_review_queue: false,
      enters_write_plan: false,
    });
    expect(result.answer.live_adapter_candidate?.adapter_status.startsWith('blocked_')).toBe(true);
    expect(validateModelProviderBoundaryContractResult(result)).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['illegal_live_call_allowed', { allow_live_call: true }],
    ['illegal_network_allowed', { allow_network: true }],
    ['illegal_env_read_allowed', { allow_env_read: true }],
    ['illegal_secret_material_allowed', { allow_secret_material: true }],
    ['illegal_db_allowed', { allow_db: true }],
    ['illegal_runner_allowed', { allow_runner: true }],
    ['illegal_execution_allowed', { allow_execution: true }],
  ] satisfies [
    ModelProviderBoundaryBlockedReason,
    Parameters<typeof buildModelProviderBoundaryContractRequestFixtureV1>[0],
  ][])(
    'blocks unsafe permission: %s',
    (expectedReason, options) => {
      const result = runWithRequest(buildModelProviderBoundaryContractRequestFixtureV1(options));

      expect(result.answer).toMatchObject({
        boundary_blocked: true,
        blocked_reason: expectedReason,
        generated_boundary_contract: false,
        live_adapter_candidate: null,
        live_call_ready: false,
        calls_real_provider: false,
        uses_network: false,
        enters_review_queue: false,
        enters_write_plan: false,
      });
    },
  );

  it.each([
    ['illegal_provider_config_resolved', { config_resolved: true }],
    ['illegal_provider_config_has_api_key', { config_has_api_key: true }],
    ['illegal_provider_config_reads_env', { config_reads_env: true }],
    ['illegal_provider_config_reads_settings', { config_reads_settings: true }],
    ['illegal_provider_config_contains_secret', { config_contains_secret: true }],
    ['illegal_provider_config_usable_for_live_call', { config_usable_for_live_call: true }],
  ] satisfies [
    ModelProviderBoundaryBlockedReason,
    Parameters<typeof buildModelProviderBoundaryContractRequestFixtureV1>[0],
  ][])(
    'blocks unsafe config placeholder: %s',
    (expectedReason, options) => {
      const request = buildModelProviderBoundaryContractRequestFixtureV1(options);

      expect(validateModelProviderBoundaryContractRequest(request)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_policy_allows_live_call', { policy_allow_live_call: true }],
    ['illegal_policy_allows_network', { policy_allow_network: true }],
    ['illegal_policy_allows_env_read', { policy_allow_env_read: true }],
  ] satisfies [
    ModelProviderBoundaryBlockedReason,
    Parameters<typeof buildModelProviderBoundaryContractRequestFixtureV1>[0],
  ][])(
    'blocks unsafe policy: %s',
    (expectedReason, options) => {
      expect(runWithRequest(buildModelProviderBoundaryContractRequestFixtureV1(options)).answer.blocked_reason)
        .toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_source_sandbox_called_real_provider', { calls_real_provider: true }],
    ['illegal_source_sandbox_used_network', { uses_network: true }],
  ] satisfies [
    ModelProviderBoundaryBlockedReason,
    Partial<ModelProviderReadOnlySandboxResult>,
  ][])(
    'blocks unsafe caller-provided source sandbox result: %s',
    (expectedReason, override) => {
      const request = buildModelProviderBoundaryContractRequestFixtureV1({
        source_sandbox_result: { ...buildSafeSourceSandboxResult(), ...override } as ModelProviderReadOnlySandboxResult,
      });

      expect(runWithRequest(request).answer.blocked_reason).toBe(expectedReason);
    },
  );

  it.each([
    ['illegal_live_adapter_ready', { live_call_ready: true }],
    ['illegal_live_adapter_ready', { adapter_enabled: true }],
    ['illegal_live_adapter_ready', { executable: true }],
    ['illegal_live_adapter_calls_provider', { calls_real_provider: true }],
    ['illegal_live_adapter_uses_network', { uses_network: true }],
    ['illegal_output_contains_secret', { contains_secret: true }],
    ['illegal_output_contains_secret', { exposes_secret: true }],
    ['illegal_output_persisted', { persists_request: true }],
    ['illegal_output_persisted', { persists_response: true }],
    ['illegal_output_enters_review_queue', { enters_review_queue: true }],
    ['illegal_output_enters_write_plan', { enters_write_plan: true }],
  ] satisfies [
    ModelProviderBoundaryBlockedReason,
    Partial<LiveProviderAdapterCandidate>,
  ][])(
    'blocks unsafe candidate mutation: %s',
    (expectedReason, override) => {
      const candidate = buildBlockedLiveProviderAdapterCandidate(
        buildModelProviderBoundaryContractPlan(buildModelProviderBoundaryContractRequestFixtureV1()).request,
      );

      expect(validateLiveProviderAdapterCandidate({ ...candidate, ...override })).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
    },
  );

  it('guards adapter status exact enum values without banning safe field names', () => {
    const candidate = buildBlockedLiveProviderAdapterCandidate(
      buildModelProviderBoundaryContractPlan(buildModelProviderBoundaryContractRequestFixtureV1()).request,
    );

    expect(candidate.adapter_status.startsWith('blocked_')).toBe(true);
    for (const adapter_status of [
      'ready',
      'enabled',
      'live',
      'connected',
      'authenticated',
      'callable',
      'executable',
      'success',
    ]) {
      expect(validateLiveProviderAdapterCandidate({ ...candidate, adapter_status })).toEqual({
        ok: false,
        blocked_reason: 'illegal_live_adapter_ready',
      });
    }
    expect(validateLiveProviderAdapterCandidate({
      ...candidate,
      adapter_status: 'blocked_live_call_not_approved',
      live_call_ready: false,
      adapter_enabled: false,
    })).toEqual({ ok: true, blocked_reason: null });
  });

  it('keeps output free of executable and live-ready states', () => {
    const result = runWithRequest(buildModelProviderBoundaryContractRequestFixtureV1());
    const candidate = result.answer.live_adapter_candidate;

    expect(candidate).toMatchObject({
      adapter_enabled: false,
      live_call_ready: false,
      executable: false,
      produces_proposal: false,
      enters_review_queue: false,
      enters_write_plan: false,
    });
    expect(findDangerousTrueStates(result)).toEqual([]);
  });

  it('active true-state scan fails only dangerous true states', () => {
    const safeTrueStates = {
      caller_provided_only: true,
      boundary_contract_only: true,
      placeholder_only: true,
      api_key_redacted: true,
      require_redaction: true,
      require_timeout_policy: true,
      require_cost_limit: true,
      require_rate_limit: true,
      require_audit_trace: true,
      require_user_approval_before_live_call: true,
      requires_future_network_approval: true,
      live_call_blocked: true,
      blocks_live_call: true,
      denial_only: true,
      required: true,
      blocking: true,
      contract_only: true,
      boundary_only: true,
      read_only: true,
    };

    expect(findDangerousTrueStates(safeTrueStates)).toEqual([]);
    for (const key of DANGEROUS_TRUE_STATE_KEYS) {
      expect(findDangerousTrueStates({ [key]: true })).toEqual([`$.${key}`]);
    }
  });

  it('is deterministic and preserves caller-provided object references', () => {
    const request = buildModelProviderBoundaryContractRequestFixtureV1({
      source_sandbox_result: buildSafeSourceSandboxResult(),
    });
    const before = JSON.stringify(request);
    const placeholder = request.provider_config_placeholder;
    const sourceSandbox = request.source_sandbox_result;
    const plan = buildModelProviderBoundaryContractPlan(request);
    const first = runModelProviderBoundaryContract(plan);
    const second = runModelProviderBoundaryContract(plan);

    expect(first).toEqual(second);
    expect(first.answer.live_adapter_candidate?.adapter_candidate_id).toBe('MODEL_PROVIDER_BOUNDARY_CANDIDATE_001');
    expect(JSON.stringify(request)).toBe(before);
    expect(request.provider_config_placeholder).toBe(placeholder);
    expect(first.answer.live_adapter_candidate?.config_placeholder).toBe(placeholder);
    expect(first.answer.source_sandbox_result).toBe(sourceSandbox);
  });

  it('keeps production and fixture source free of live provider, DB, runner, UI, and unstable APIs', () => {
    for (const file of PRODUCTION_AND_FIXTURE_FILES) {
      const source = readFileSync(file, 'utf8');

      for (const term of [
        ...FORBIDDEN_LIVE_PROVIDER_TERMS,
        ...FORBIDDEN_DB_RUNNER_UI_TERMS,
        ...FORBIDDEN_UNSTABLE_TERMS,
      ]) {
        expect(source).not.toContain(term);
      }
      expect(source).not.toMatch(/\b(invoke|call|complete|generate|assess)\s*\(/);
    }
  });

  it('does not modify files outside the Loop 43 allowed change set', () => {
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
    expect(changedFiles.filter(file => !LOOP_43_ALLOWED_CHANGED_FILES.has(file) && !matchesLoop54)).toEqual([]);
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
  request: Parameters<typeof buildModelProviderBoundaryContractPlan>[0],
): ModelProviderBoundaryContractResult {
  return runModelProviderBoundaryContract(buildModelProviderBoundaryContractPlan(request));
}

function buildSafeSourceSandboxResult(): ModelProviderReadOnlySandboxResult {
  return {
    kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_RESULT',
    version: 'v1',
    persisted: false,
    reads_database: false,
    writes_database: false,
    calls_real_provider: false,
    uses_network: false,
    represents_live_model_call: false,
    represents_executed_action: false,
  } as ModelProviderReadOnlySandboxResult;
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
