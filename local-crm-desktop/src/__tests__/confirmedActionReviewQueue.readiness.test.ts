import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildConfirmedActionReviewQueuePlan,
  buildConfirmedActionReviewQueueTrace,
  buildQueueSummary,
  projectEnvelopeToCandidate,
  runConfirmedActionReviewQueue,
  validateConfirmedActionReviewQueueInput,
  type ConfirmedActionReviewQueueBlockedReason,
} from '../lib/confirmedActionReviewQueueReadiness';
import {
  buildConfirmedActionReviewQueueRequestFixtureV1,
  buildReviewQueueEnvelopeFixtureV1,
} from '../lib/confirmedActionReviewQueue/confirmedActionReviewQueueFixturesV1';

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
  'src/lib/confirmedActionReviewQueueReadiness.ts',
  'src/lib/confirmedActionReviewQueue/confirmedActionReviewQueueFixturesV1.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/lib/humanConfirmationContractReadiness.ts',
  'src/lib/humanConfirmationContract/humanConfirmationContractFixturesV1.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/lib/actionRunnerBoundaryContractReadiness.ts',
  'src/lib/actionRunnerBoundaryContract/actionRunnerBoundaryContractFixturesV1.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/lib/dbWritePlanDryRunReadiness.ts',
  'src/lib/dbWritePlanDryRun/dbWritePlanDryRunFixturesV1.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/lib/safeWriteRunnerGateReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
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

describe('Confirmed Action review queue readiness gate', () => {
  it('projects caller-provided dry-run envelopes into review queue candidates', () => {
    const request = buildConfirmedActionReviewQueueRequestFixtureV1();
    const plan = buildConfirmedActionReviewQueuePlan(request);
    const result = runConfirmedActionReviewQueue(plan);

    expect(validateConfirmedActionReviewQueueInput(request.source_live_dry_run_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(plan).toMatchObject({
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'confirmed_action_review_queue_readiness_only',
      allowed_operations: [
        'validate_confirmed_action_live_dry_run_input',
        'project_review_queue_candidates',
        'build_review_queue_summary',
      ],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'read_db',
      'write_db',
      'rerun_confirmed_action_live_dry_run',
      'execute_queue_item',
      'confirm_queue_item',
      'call_provider',
      'render_ui',
      'persist_queue_item',
    ]));
    expect(result).toMatchObject({
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      answer: {
        kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_ANSWER',
        dry_run_only: true,
        executable: false,
        human_confirmed: false,
        requires_human_review: true,
        represents_executed_action: false,
        generated_review_queue_candidates: true,
        emits_review_surface_only: true,
        executes_queue_items: false,
        queue_blocked: false,
        blocked_reason: null,
        safety: {
          reads_database: false,
          writes_database: false,
          executable: false,
        },
      },
    });
    expect(result.answer.source_live_dry_run_result).toBe(request.source_live_dry_run_result);
    expect(result.answer.candidates_count).toBe(2);
    expect(result.answer.candidates.map(candidate => candidate.queue_item_id)).toEqual([
      'REVIEW_QUEUE_LIVE_001',
      'REVIEW_QUEUE_LIVE_002',
    ]);

    for (const [index, candidate] of result.answer.candidates.entries()) {
      const source = request.source_live_dry_run_result.answer.envelopes[index];
      expect(candidate.source_action_id).toBe(source.action_id);
      expect(candidate.source_proposal_id).toBe(source.source_proposal_id);
      expect(candidate.source_proposal_type).toBe(source.source_proposal_type);
      expect(candidate.evidence_refs).toEqual(source.evidence_refs);
      expect(candidate.risk_flags).toEqual(source.risk_flags);
      expect(candidate.preconditions).toEqual(source.preconditions);
    }
  });

  it('requires clean confirmed action live dry-run source semantics', () => {
    const request = buildConfirmedActionReviewQueueRequestFixtureV1();
    const source = request.source_live_dry_run_result;

    expect(source.answer.generated_confirmed_action_envelopes).toBe(true);
    expect(source.answer.emits_dry_run_envelopes).toBe(true);
    expect(source.answer.executes_generated_envelopes).toBe(false);
    expect(source.answer.represents_executed_action).toBe(false);
    expect(source.answer.human_confirmed).toBe(false);
    expect(source.answer.executable).toBe(false);
    expect(source.answer.safety.reads_database).toBe(false);
    expect(source.answer.safety.writes_database).toBe(false);
    expect(source.answer.source_live_dry_run_result).toBeDefined();
  });

  it('keeps every candidate non-executable, unpersisted, and pending human review', () => {
    const result = runConfirmedActionReviewQueue(buildConfirmedActionReviewQueuePlan(
      buildConfirmedActionReviewQueueRequestFixtureV1(),
    ));

    for (const candidate of result.answer.candidates) {
      expect(candidate).toMatchObject({
        executable: false,
        persisted: false,
        human_confirmed: false,
        writes_database: false,
        represents_executed_action: false,
        requires_human_review: true,
        dry_run_only: true,
        confirmation_required: true,
      });
    }
  });

  it('assigns review status and priority band from envelope risk and evidence shape', () => {
    const blockedPreconditions = [
      {
        name: 'requires_non_empty_evidence' as const,
        required: true,
        satisfied: false,
        blocking: true,
        message: 'Evidence is missing for this queue candidate',
      },
    ];
    const envelopes = [
      buildReviewQueueEnvelopeFixtureV1(1, 'REVIEW_SYNC_FAILURE', { risk_flags: ['sync_failed'] }),
      buildReviewQueueEnvelopeFixtureV1(2, 'REVIEW_FOLLOW_UP_TASK'),
      buildReviewQueueEnvelopeFixtureV1(3, 'REVIEW_EVIDENCE_GAP', {
        evidence_refs: [],
        risk_flags: ['insufficient_evidence'],
      }),
      buildReviewQueueEnvelopeFixtureV1(4, 'REVIEW_NEXT_BEST_ACTION', {
        blocked_reason: 'Manual owner must resolve an upstream review note',
        preconditions: blockedPreconditions,
      }),
    ];
    const result = runConfirmedActionReviewQueue(buildConfirmedActionReviewQueuePlan(
      buildConfirmedActionReviewQueueRequestFixtureV1({ answer: { envelopes } }),
    ));

    expect(result.answer.candidates.map(candidate => candidate.review_status)).toEqual([
      'pending_review',
      'pending_review',
      'blocked',
      'blocked',
    ]);
    expect(result.answer.candidates.map(candidate => candidate.priority_band)).toEqual([
      'high',
      'medium',
      'low',
      'medium',
    ]);
  });

  it('builds queue summary counts by status, risk, evidence, and action type', () => {
    const envelopes = [
      buildReviewQueueEnvelopeFixtureV1(1, 'REVIEW_SYNC_FAILURE', { risk_flags: ['sync_failed'] }),
      buildReviewQueueEnvelopeFixtureV1(2, 'REVIEW_FOLLOW_UP_TASK'),
      buildReviewQueueEnvelopeFixtureV1(3, 'REVIEW_EVIDENCE_GAP', {
        evidence_refs: [],
        risk_flags: ['insufficient_evidence'],
      }),
    ];
    const candidates = envelopes.map(projectEnvelopeToCandidate);
    const summary = buildQueueSummary(candidates);

    expect(summary).toEqual({
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_SUMMARY',
      version: 'v1',
      total: 3,
      ready_for_review: 2,
      blocked: 1,
      high_risk: 1,
      missing_evidence: 1,
      by_action_type: {
        CONFIRM_REVIEW_SYNC_FAILURE: 1,
        CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
        CONFIRM_REVIEW_EVIDENCE_GAP: 1,
      },
      by_risk_flag: {
        sync_failed: 1,
        fixture_only_signal: 1,
        insufficient_evidence: 1,
      },
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_dry_run_blocked', { answer: { dry_run_blocked: true } }],
    ['source_envelopes_empty', { answer: { envelopes: [], envelopes_count: 0 } }],
    ['illegal_source_missing_generated_confirmed_action_envelopes', {
      answer: { generated_confirmed_action_envelopes: false },
    }],
    ['illegal_source_missing_dry_run_envelope_emission', { answer: { emits_dry_run_envelopes: false } }],
    ['illegal_source_executes_generated_envelopes', { answer: { executes_generated_envelopes: true } }],
    ['illegal_source_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_source_human_confirmed', { answer: { human_confirmed: true } }],
    ['illegal_source_writes_database', { answer: { safety: { writes_database: true } } }],
    ['illegal_source_reads_database', { answer: { safety: { reads_database: true } } }],
    ['illegal_envelope_executable', {
      answer: { envelopes: [buildReviewQueueEnvelopeFixtureV1(1, 'REVIEW_FOLLOW_UP_TASK', { executable: true })] },
    }],
    ['illegal_envelope_human_confirmed', {
      answer: { envelopes: [buildReviewQueueEnvelopeFixtureV1(1, 'REVIEW_FOLLOW_UP_TASK', { human_confirmed: true })] },
    }],
    ['illegal_envelope_represents_executed_action', {
      answer: {
        envelopes: [buildReviewQueueEnvelopeFixtureV1(1, 'REVIEW_FOLLOW_UP_TASK', {
          represents_executed_action: true,
        })],
      },
    }],
  ] satisfies [ConfirmedActionReviewQueueBlockedReason, Parameters<typeof buildConfirmedActionReviewQueueRequestFixtureV1>[0]][])(
    'blocks unsafe source result: %s',
    (expectedReason, override) => {
      const plan = buildConfirmedActionReviewQueuePlan(buildConfirmedActionReviewQueueRequestFixtureV1(override));
      const result = runConfirmedActionReviewQueue(plan);

      expect(validateConfirmedActionReviewQueueInput(plan.request.source_live_dry_run_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        answer: {
          queue_blocked: true,
          blocked_reason: expectedReason,
          candidates: [],
          candidates_count: 0,
          generated_review_queue_candidates: false,
          executes_queue_items: false,
          represents_executed_action: false,
          summary: {
            total: 0,
            ready_for_review: 0,
            blocked: 0,
            high_risk: 0,
            missing_evidence: 0,
            by_action_type: {},
            by_risk_flag: {},
          },
        },
      });
    },
  );

  it('is deterministic and avoids clock or random identifiers', () => {
    const plan = buildConfirmedActionReviewQueuePlan(buildConfirmedActionReviewQueueRequestFixtureV1());
    const first = runConfirmedActionReviewQueue(plan);
    const second = runConfirmedActionReviewQueue(plan);

    expect(first).toEqual(second);
    expect(first.answer.candidates.map(candidate => candidate.queue_item_id)).toEqual([
      'REVIEW_QUEUE_LIVE_001',
      'REVIEW_QUEUE_LIVE_002',
    ]);

    const source = readFileSync('src/lib/confirmedActionReviewQueueReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('preserves the source reference and does not mutate source or envelopes', () => {
    const request = buildConfirmedActionReviewQueueRequestFixtureV1();
    const source = request.source_live_dry_run_result;
    const before = JSON.stringify(source);
    const firstEnvelope = source.answer.envelopes[0];
    const result = runConfirmedActionReviewQueue(buildConfirmedActionReviewQueuePlan(request));

    expect(result.answer.source_live_dry_run_result).toBe(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.answer.candidates[0].evidence_refs).toBe(firstEnvelope.evidence_refs);
    expect(result.answer.candidates[0].risk_flags).toBe(firstEnvelope.risk_flags);
    expect(result.answer.candidates[0].preconditions).toBe(firstEnvelope.preconditions);
  });

  it('builds a trace around review queue projection only', () => {
    const trace = buildConfirmedActionReviewQueueTrace(buildConfirmedActionReviewQueuePlan(
      buildConfirmedActionReviewQueueRequestFixtureV1(),
    ));

    expect(trace).toMatchObject({
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_TRACE',
      persisted: false,
      result: {
        kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT',
        persisted: false,
        answer: {
          generated_review_queue_candidates: true,
          emits_review_surface_only: true,
          executes_queue_items: false,
        },
      },
    });
  });

  it('keeps Loop 35 production free of upstream calls, storage access, UI hooks, runtime hooks, and execution hooks', () => {
    const productionSource = readFileSync('src/lib/confirmedActionReviewQueueReadiness.ts', 'utf8');
    const forbiddenTerms = [
      'runConfirmedActionLiveDryRun',
      'runSuggestOnlyLiveDryRun',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'proposeFromReadOnlyAnswer',
      'envelopeFromSuggestOnlyAnswer',
      'getDb',
      'db.select',
      'INSERT',
      'UPDATE',
      'DELETE',
      'React',
      'pages',
      'provider',
      'PromptRuntime',
      'ModelRouterRuntime',
      'EvalRunner',
      'executeAction',
      'confirmAndExecute',
      'ActionRunner',
      'Date.now',
      'Math.random',
      'randomUUID',
    ];

    for (const term of forbiddenTerms) {
      expect(productionSource).not.toContain(term);
    }
  });

  it('keeps Loop 35 fixture free of upstream runner calls', () => {
    const fixtureSource = readFileSync(
      'src/lib/confirmedActionReviewQueue/confirmedActionReviewQueueFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
      'runConfirmedActionLiveDryRun',
      'runSuggestOnlyLiveDryRun',
      'runReadOnlyAgentLiveDryRun',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'proposeFromReadOnlyAnswer',
    ];

    for (const term of forbiddenTerms) {
      expect(fixtureSource).not.toContain(term);
    }
  });

  it('does not modify files outside the Loop 35 allowed change set', () => {
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
