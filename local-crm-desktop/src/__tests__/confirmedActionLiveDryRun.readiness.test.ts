import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildConfirmedActionLiveDryRunPlan,
  buildConfirmedActionLiveDryRunTrace,
  runConfirmedActionLiveDryRun,
  validateConfirmedActionLiveDryRunInput,
  type ConfirmedActionLiveDryRunBlockedReason,
} from '../lib/confirmedActionLiveDryRunReadiness';
import {
  buildConfirmedActionLiveDryRunRequestFixtureV1,
} from '../lib/confirmedActionLiveDryRun/confirmedActionLiveDryRunFixturesV1';

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

const ALLOWED_CHANGED_FILES = new Set([
  'src/lib/confirmedActionContractReadiness.ts',
  'src/lib/confirmedActionLiveDryRunReadiness.ts',
  'src/lib/confirmedActionLiveDryRun/confirmedActionLiveDryRunFixturesV1.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/readOnlySnapshotLoader.readiness.test.ts',
  'src/__tests__/readOnlyAgentSnapshotAdapter.readiness.test.ts',
  'src/__tests__/readOnlyAgentLiveDryRun.readiness.test.ts',
  'src/lib/confirmedActionReviewQueueReadiness.ts',
  'src/lib/confirmedActionReviewQueue/confirmedActionReviewQueueFixturesV1.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/lib/humanConfirmationContractReadiness.ts',
  'src/lib/humanConfirmationContract/humanConfirmationContractFixturesV1.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/lib/actionRunnerBoundaryContractReadiness.ts',
  'src/lib/actionRunnerBoundaryContract/actionRunnerBoundaryContractFixturesV1.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/lib/dbWritePlanDryRunReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/lib/dbWritePlanDryRun/dbWritePlanDryRunFixturesV1.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/lib/safeWriteRunnerGateReadiness.ts',
  'src/lib/safeWriteRunnerGate/safeWriteRunnerGateFixturesV1.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/lib/dashboardDataProjectionReadiness.ts',
  'src/lib/dashboardDataProjection/dashboardDataProjectionFixturesV1.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/components/dashboard/DashboardProjectionPanel.tsx',
  'src/components/dashboard/dashboardProjectionViewModel.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/lib/modelProviderReadOnlySandboxReadiness.ts',
  'src/lib/modelProviderReadOnlySandbox/modelProviderReadOnlySandboxFixturesV1.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/lib/modelProviderBoundaryContractReadiness.ts',
  'src/lib/modelProviderBoundaryContract/modelProviderBoundaryContractFixturesV1.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/lib/modelReadOnlyInvocationGateReadiness.ts',
  'src/lib/modelReadOnlyInvocationGate/modelReadOnlyInvocationGateFixturesV1.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/lib/modelSuggestOnlyOutputGateReadiness.ts',
  'src/lib/modelSuggestOnlyOutputGate/modelSuggestOnlyOutputGateFixturesV1.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/lib/modelSuggestionReviewDraftGateReadiness.ts',
  'src/lib/modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/lib/reviewDraftQueueBoundaryReadiness.ts',
  'src/lib/reviewDraftQueueBoundary/reviewDraftQueueBoundaryFixturesV1.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
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

describe('Confirmed Action live dry-run readiness gate', () => {
  it('builds pending human confirmation envelopes from a caller-provided suggest-only live dry-run result', () => {
    const request = buildConfirmedActionLiveDryRunRequestFixtureV1();
    const plan = buildConfirmedActionLiveDryRunPlan(request);
    const result = runConfirmedActionLiveDryRun(plan);
    const sourceAnswer = request.source_live_dry_run_result.answer.suggest_only_answer;

    expect(validateConfirmedActionLiveDryRunInput(request.source_live_dry_run_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(result).toMatchObject({
      kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      answer: {
        kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_ANSWER',
        dry_run_only: true,
        executable: false,
        human_confirmed: false,
        confirmation_required: true,
        pending_human_confirmation: true,
        represents_executed_action: false,
        generated_confirmed_action_envelopes: true,
        emits_dry_run_envelopes: true,
        executes_generated_envelopes: false,
        dry_run_blocked: false,
        blocked_reason: null,
        safety: {
          reads_database: false,
          writes_database: false,
          executable: false,
        },
      },
    });
    expect(result.answer.source_live_dry_run_result).toBe(request.source_live_dry_run_result);
    expect(request.source_live_dry_run_result.answer.generated_envelopes).toBe(false);
    expect(result.answer.envelopes_count).toBe(sourceAnswer?.proposals.length);
    expect(result.answer.envelopes.map(envelope => envelope.action_id)).toEqual([
      'CONFIRM_LIVE_001',
      'CONFIRM_LIVE_002',
    ]);
    for (const [index, envelope] of result.answer.envelopes.entries()) {
      const source = sourceAnswer?.proposals[index];
      expect(source).toBeDefined();
      expect(envelope.source_proposal_id).toBe(source?.proposal_id);
      expect(envelope.source_proposal_type).toBe(source?.proposal_type);
      expect(envelope.evidence_refs).toEqual(source?.evidence_refs);
      expect(envelope.risk_flags).toEqual(source?.risk_flags);
      expect(envelope.title).toContain(source?.title);
      expect(envelope.summary).toContain(source?.summary);
      expect(envelope.preconditions.length).toBeGreaterThan(0);
      expect(envelope.confirmation_required).toBe(true);
      expect(envelope.human_confirmed).toBe(false);
      expect(envelope.dry_run_only).toBe(true);
      expect(envelope.executable).toBe(false);
      expect(envelope.represents_executed_action).toBe(false);
    }
  });

  it('is deterministic for identical input and stable action ids', () => {
    const plan = buildConfirmedActionLiveDryRunPlan(buildConfirmedActionLiveDryRunRequestFixtureV1());
    const first = runConfirmedActionLiveDryRun(plan);
    const second = runConfirmedActionLiveDryRun(plan);

    expect(first).toEqual(second);
    expect(first.answer.envelopes.map(envelope => envelope.action_id)).toEqual([
      'CONFIRM_LIVE_001',
      'CONFIRM_LIVE_002',
    ]);

    const source = readFileSync('src/lib/confirmedActionLiveDryRunReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'crypto.randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('keeps the result non-executable and unpersisted', () => {
    const result = runConfirmedActionLiveDryRun(buildConfirmedActionLiveDryRunPlan(
      buildConfirmedActionLiveDryRunRequestFixtureV1(),
    ));

    expect(result.persisted).toBe(false);
    expect(result.represents_executed_action).toBe(false);
    expect(result.answer).toMatchObject({
      dry_run_only: true,
      executable: false,
      human_confirmed: false,
      confirmation_required: true,
      pending_human_confirmation: true,
      represents_executed_action: false,
      executes_generated_envelopes: false,
    });
  });

  it('does not mutate source proposals or rewrite action ids after envelope creation', () => {
    const request = buildConfirmedActionLiveDryRunRequestFixtureV1();
    const source = request.source_live_dry_run_result;
    const sourceProposalsBefore = structuredClone(source.answer.suggest_only_answer?.proposals);
    const result = runConfirmedActionLiveDryRun(buildConfirmedActionLiveDryRunPlan(request));

    expect(result.answer.source_live_dry_run_result).toBe(source);
    expect(source.answer.suggest_only_answer?.proposals).toEqual(sourceProposalsBefore);
    expect(source.answer.generated_envelopes).toBe(false);
    expect(result.answer.envelopes.every(envelope => envelope.action_id.startsWith('CONFIRM_LIVE_'))).toBe(true);
    expect(result.answer.envelopes.every(envelope => !envelope.action_id.startsWith('CONFIRM_EVAL_'))).toBe(true);

    const productionSource = readFileSync('src/lib/confirmedActionLiveDryRunReadiness.ts', 'utf8');
    expect(productionSource).not.toContain('CONFIRM_EVAL_');
    expect(productionSource).not.toContain('replace(');
    expect(productionSource).not.toContain('action_id =');
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_SUGGEST_ONLY_LIVE_DRY_RUN_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_dry_run_blocked', { answer: { dry_run_blocked: true } }],
    ['suggest_only_answer_missing', { answer: { suggest_only_answer: null } }],
    ['illegal_source_generated_envelopes', { answer: { generated_envelopes: true } }],
    ['illegal_source_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_source_not_loaded_snapshot', { answer: { source_is_loaded_snapshot: false } }],
    ['illegal_source_reads_database', { answer: { safety: { reads_database: true } } }],
    ['illegal_source_writes_database', { answer: { safety: { writes_database: true } } }],
    ['source_live_dry_run_result_missing', { answer: { remove_source_live_dry_run_result: true } }],
    ['nested_source_live_dry_run_blocked', {
      answer: { source_live_dry_run_result: { answer: { dry_run_blocked: true } } },
    }],
    ['illegal_source_action_state', { answer: { safety: { executable: true } } }],
    ['illegal_source_action_state', { answer: { source_generated_structure: { represents_executed_action: true } } }],
    ['illegal_source_action_state', {
      answer: { source_generated_structure: { generated_items: [{ human_confirmed: true }] } },
    }],
  ] satisfies [ConfirmedActionLiveDryRunBlockedReason, Parameters<typeof buildConfirmedActionLiveDryRunRequestFixtureV1>[0]][])(
    'blocks unsafe source result: %s',
    (expectedReason, override) => {
      const plan = buildConfirmedActionLiveDryRunPlan(buildConfirmedActionLiveDryRunRequestFixtureV1(override));
      const result = runConfirmedActionLiveDryRun(plan);

      expect(validateConfirmedActionLiveDryRunInput(plan.request.source_live_dry_run_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        answer: {
          dry_run_blocked: true,
          blocked_reason: expectedReason,
          envelopes_count: 0,
          envelopes: [],
          generated_confirmed_action_envelopes: false,
          emits_dry_run_envelopes: false,
          executes_generated_envelopes: false,
          represents_executed_action: false,
        },
      });
    },
  );

  it('builds a trace around the caller-provided source result without persistence', () => {
    const trace = buildConfirmedActionLiveDryRunTrace(buildConfirmedActionLiveDryRunPlan(
      buildConfirmedActionLiveDryRunRequestFixtureV1(),
    ));

    expect(trace).toMatchObject({
      kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_TRACE',
      persisted: false,
      result: {
        persisted: false,
        answer: {
          dry_run_only: true,
          generated_confirmed_action_envelopes: true,
          executes_generated_envelopes: false,
        },
      },
    });
  });

  it('keeps Loop 34 production free of upstream calls, storage access, runtime hooks, UI hooks, and execution hooks', () => {
    const productionSource = readFileSync('src/lib/confirmedActionLiveDryRunReadiness.ts', 'utf8');
    const forbiddenTerms = [
      'runSuggestOnlyLiveDryRun',
      'runReadOnlyAgentLiveDryRun',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'proposeFromReadOnlyAnswer',
      'buildConfirmedActionPlan',
      'ConfirmedActionRequest',
      'synthetic: true',
      'fixture_only: true',
      'envelopeFromProposals',
      'getDb',
      'db.select',
      'INSERT',
      'UPDATE',
      'DELETE',
      'executeAction',
      'confirmAndExecute',
      'execute_proposal',
      'provider',
      'model router',
      'prompt runtime',
      'React',
      'pages',
      'UI',
      'fetch',
      'axios',
      'process.env',
      'import.meta.env',
    ];

    for (const term of forbiddenTerms) {
      expect(productionSource).not.toContain(term);
    }
  });

  it('keeps Loop 34 fixture free of upstream calls, storage access, UI hooks, and execution hooks', () => {
    const fixtureSource = readFileSync(
      'src/lib/confirmedActionLiveDryRun/confirmedActionLiveDryRunFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
      'runSuggestOnlyLiveDryRun',
      'runReadOnlyAgentLiveDryRun',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'proposeFromReadOnlyAnswer',
      'getDb',
      'db.select',
      'INSERT',
      'UPDATE',
      'DELETE',
      'executeAction',
      'confirmAndExecute',
      'execute_proposal',
      'provider',
      'prompt runtime',
      'React',
      'pages',
      'UI',
      'fetch',
      'axios',
      'process.env',
      'import.meta.env',
    ];

    for (const term of forbiddenTerms) {
      expect(fixtureSource).not.toContain(term);
    }
  });

  it('does not modify files outside the Loop 34 allowed change set', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean)
      .map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/'));

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
    expect(changedFiles.filter(file => !ALLOWED_CHANGED_FILES.has(file) && !matchesLoop54)).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
  });
});
import { hasExactStage2ChangedFileSet } from './stage2ChangedFileCohort';
import { hasExactStage3StabilizationChangedFileSet } from './stage3StabilizationChangedFileCohort';
