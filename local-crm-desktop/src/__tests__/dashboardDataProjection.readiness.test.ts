import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import {
  buildDashboardDataProjectionPlan,
  buildDashboardDataProjectionSummary,
  buildDashboardDataProjectionTrace,
  projectSafeWriteRunnerCandidateToDashboardRow,
  runDashboardDataProjection,
  validateDashboardDataProjectionInput,
  type DashboardDataProjectionBlockedReason,
} from '../lib/dashboardDataProjectionReadiness';
import {
  buildDashboardDataProjectionRequestFixtureV1,
  buildDashboardDataProjectionSourceCandidateFixtureV1,
} from '../lib/dashboardDataProjection/dashboardDataProjectionFixturesV1';

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
  'src/lib/dashboardDataProjectionReadiness.ts',
  'src/lib/dashboardDataProjection/dashboardDataProjectionFixturesV1.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/components/dashboard/DashboardProjectionPanel.tsx',
  'src/components/dashboard/dashboardProjectionViewModel.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/lib/modelSuggestionAdapterBoundaryReadiness.ts',
  'src/lib/modelSuggestionAdapterBoundary/modelSuggestionAdapterBoundaryFixturesV1.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
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

const ACTIVE_TRUE_STATE_KEYS = [
  'ready_to_write',
  'ready_for_runner',
  'executable',
  'executed',
  'write_executed',
  'persisted',
  'reads_database',
  'writes_database',
  'generates_executable_sql',
  'executes_sql',
  'opens_transaction',
  'commits_transaction',
  'rolls_back_transaction',
  'represents_db_write',
  'represents_executed_action',
  'represents_write_runner_execution',
  'renders_surface',
  'usable_for_execution',
  'resolved',
];

describe('Dashboard data projection readiness gate', () => {
  it('projects caller-provided safe write runner candidates into dashboard data rows', () => {
    const sourceCandidate = buildDashboardDataProjectionSourceCandidateFixtureV1(1);
    const request = buildDashboardDataProjectionRequestFixtureV1({
      answer: { safe_write_runner_candidates: [sourceCandidate] },
    });
    const plan = buildDashboardDataProjectionPlan(request);
    const result = runDashboardDataProjection(plan);

    expect(validateDashboardDataProjectionInput(request.source_safe_write_runner_gate_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(plan).toMatchObject({
      kind: 'DASHBOARD_DATA_PROJECTION_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'dashboard_data_projection_readiness_only',
      allowed_operations: [
        'validate_safe_write_runner_gate_result',
        'project_dashboard_data_rows',
        'build_dashboard_data_projection_summary',
      ],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        generates_executable_sql: false,
        executes_sql: false,
        opens_transaction: false,
        renders_surface: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'read_db',
      'write_db',
      'rerun_safe_write_runner_gate',
      'render_surface',
      'mount_dashboard',
      'execute_row',
      'confirm_row',
      'persist_projection',
      'generate_executable_statement',
      'open_transaction_boundary',
    ]));
    expect(result).toMatchObject({
      kind: 'DASHBOARD_DATA_PROJECTION_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      writes_database: false,
      answer: {
        kind: 'DASHBOARD_DATA_PROJECTION_ANSWER',
        contract_only: true,
        projection_only: true,
        source_gate_only: true,
        dashboard_data_only: true,
        generated_dashboard_rows: true,
        projection_blocked: false,
        blocked_reason: null,
        ready_to_write: false,
        ready_for_runner: false,
        executable: false,
        executed: false,
        write_executed: false,
        persisted: false,
        reads_database: false,
        writes_database: false,
        generates_executable_sql: false,
        executes_sql: false,
        opens_transaction: false,
        represents_db_write: false,
        represents_executed_action: false,
        represents_write_runner_execution: false,
        renders_surface: false,
      },
    });
    expect(result.answer.source_safe_write_runner_gate_result).toBe(request.source_safe_write_runner_gate_result);
    expect(result.answer.dashboard_rows_count).toBe(1);

    const row = result.answer.dashboard_rows[0];
    expect(row).toMatchObject({
      kind: 'DASHBOARD_DATA_PROJECTION_ROW',
      version: 'v1',
      projection_row_id: 'DASHBOARD_DATA_PROJECTION_LIVE_001',
      source_safe_write_runner_candidate_id: sourceCandidate.safe_write_runner_candidate_id,
      source_write_plan_candidate_id: sourceCandidate.source_write_plan_candidate_id,
      source_runner_boundary_candidate_id: sourceCandidate.source_runner_boundary_candidate_id,
      source_confirmation_candidate_id: sourceCandidate.source_confirmation_candidate_id,
      source_action_id: sourceCandidate.source_action_id,
      source_proposal_id: sourceCandidate.source_proposal_id,
      source_proposal_type: sourceCandidate.source_proposal_type,
      action_type: sourceCandidate.action_type,
      title: sourceCandidate.title,
      row_status: 'blocked_requires_real_confirmation',
      attention_level: 'review_required',
      blocked_reason: sourceCandidate.blocked_reason,
      evidence_ref_count: sourceCandidate.evidence_refs.length,
      risk_flag_count: sourceCandidate.risk_flags.length,
      contract_only: true,
      projection_only: true,
      source_gate_only: true,
      executable: false,
      persisted: false,
      writes_database: false,
      represents_executed_action: false,
      renders_surface: false,
    });
    expect(row.evidence_refs).toBe(sourceCandidate.evidence_refs);
    expect(row.risk_flags).toBe(sourceCandidate.risk_flags);
    expect(row.missing_requirement_names).toEqual([
      'requires_real_human_confirmation',
      'requires_resolved_operator',
      'requires_executable_write_plan',
    ]);
  });

  it('blocks the whole projection when the source safe write runner gate is blocked', () => {
    const result = runDashboardDataProjection(buildDashboardDataProjectionPlan(
      buildDashboardDataProjectionRequestFixtureV1({ answer: { runner_gate_blocked: true } }),
    ));

    expect(result.answer).toMatchObject({
      projection_blocked: true,
      blocked_reason: 'source_gate_blocked',
      dashboard_rows: [],
      dashboard_rows_count: 0,
      generated_dashboard_rows: false,
      executable: false,
      writes_database: false,
      renders_surface: false,
      summary: {
        total: 0,
        review_required: 0,
        source_blocked: 0,
        policy_blocked: 0,
      },
    });
  });

  it.each([
    ['blocked_source_write_plan_candidate', 'source_blocked'],
    ['blocked_missing_safe_write_runner_policy', 'policy_blocked'],
    ['blocked_requires_executable_write_plan', 'review_required'],
  ] as const)(
    'keeps blocked source status %s visible in the projected row',
    (rowStatus, attentionLevel) => {
      const sourceCandidate = buildDashboardDataProjectionSourceCandidateFixtureV1(1, {
        runner_gate_status: rowStatus,
        blocked_reason: `Blocked for ${rowStatus}`,
      });
      const result = runDashboardDataProjection(buildDashboardDataProjectionPlan(
        buildDashboardDataProjectionRequestFixtureV1({ answer: { safe_write_runner_candidates: [sourceCandidate] } }),
      ));

      expect(result.answer.projection_blocked).toBe(false);
      expect(result.answer.dashboard_rows_count).toBe(1);
      expect(result.answer.dashboard_rows[0]).toMatchObject({
        source_safe_write_runner_candidate_id: sourceCandidate.safe_write_runner_candidate_id,
        row_status: rowStatus,
        attention_level: attentionLevel,
        executable: false,
        writes_database: false,
        renders_surface: false,
      });
    },
  );

  it('builds summary and trace without rendering or persistence', () => {
    const request = buildDashboardDataProjectionRequestFixtureV1();
    const trace = buildDashboardDataProjectionTrace(buildDashboardDataProjectionPlan(request));
    const summary = buildDashboardDataProjectionSummary(trace.result.answer.dashboard_rows);

    expect(trace).toMatchObject({
      kind: 'DASHBOARD_DATA_PROJECTION_TRACE',
      persisted: false,
      writes_database: false,
      result: {
        kind: 'DASHBOARD_DATA_PROJECTION_RESULT',
        persisted: false,
        writes_database: false,
        answer: {
          generated_dashboard_rows: true,
          projection_only: true,
          renders_surface: false,
          writes_database: false,
        },
      },
    });
    expect(summary).toEqual({
      kind: 'DASHBOARD_DATA_PROJECTION_SUMMARY',
      version: 'v1',
      total: 2,
      review_required: 1,
      source_blocked: 1,
      policy_blocked: 0,
      missing_evidence: 1,
      high_risk: 1,
      by_action_type: {
        CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
        CONFIRM_REVIEW_EVIDENCE_GAP: 1,
      },
      by_row_status: {
        blocked_requires_real_confirmation: 1,
        blocked_source_write_plan_candidate: 1,
      },
      by_attention_level: {
        review_required: 1,
        source_blocked: 1,
      },
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_SAFE_WRITE_RUNNER_GATE_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_gate_blocked', { answer: { runner_gate_blocked: true } }],
    ['source_candidates_empty', { answer: { safe_write_runner_candidates: [], safe_write_runner_candidates_count: 0 } }],
    ['illegal_source_not_contract_only', { answer: { contract_only: false } }],
    ['illegal_source_not_dry_run_only', { answer: { dry_run_only: false } }],
    ['illegal_source_not_gate_only', { answer: { gate_only: false } }],
    ['illegal_source_missing_generated_safe_write_runner_candidates', {
      answer: { generated_safe_write_runner_candidates: false },
    }],
    ['illegal_source_ready_to_write', { answer: { ready_to_write: true } }],
    ['illegal_source_ready_for_runner', { answer: { ready_for_runner: true } }],
    ['illegal_source_executable', { answer: { executable: true } }],
    ['illegal_source_executed', { answer: { executed: true } }],
    ['illegal_source_write_executed', { answer: { write_executed: true } }],
    ['illegal_source_persisted', { answer: { persisted: true } }],
    ['illegal_source_reads_database', { answer: { reads_database: true } }],
    ['illegal_source_writes_database', { answer: { writes_database: true } }],
    ['illegal_source_generates_executable_sql', { answer: { generates_executable_sql: true } }],
    ['illegal_source_executes_sql', { answer: { executes_sql: true } }],
    ['illegal_source_opens_transaction', { answer: { opens_transaction: true } }],
    ['illegal_source_represents_db_write', { answer: { represents_db_write: true } }],
    ['illegal_source_represents_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_source_represents_write_runner_execution', {
      answer: { represents_write_runner_execution: true },
    }],
    ['illegal_candidate_status_not_blocked', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { runner_gate_status: 'pending' as never }),
        ],
      },
    }],
    ['illegal_candidate_not_contract_only', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { contract_only: false }),
        ],
      },
    }],
    ['illegal_candidate_not_dry_run_only', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { dry_run_only: false }),
        ],
      },
    }],
    ['illegal_candidate_not_gate_only', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { gate_only: false }),
        ],
      },
    }],
    ['illegal_candidate_ready_to_write', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { ready_to_write: true }),
        ],
      },
    }],
    ['illegal_candidate_executable', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { executable: true }),
        ],
      },
    }],
    ['illegal_candidate_write_executed', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { write_executed: true }),
        ],
      },
    }],
    ['illegal_candidate_writes_database', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { writes_database: true }),
        ],
      },
    }],
    ['illegal_candidate_idempotency_usable_for_execution', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { idempotency_usable_for_execution: true }),
        ],
      },
    }],
    ['illegal_candidate_idempotency_resolved', {
      answer: {
        safe_write_runner_candidates: [
          buildDashboardDataProjectionSourceCandidateFixtureV1(1, { idempotency_resolved: true }),
        ],
      },
    }],
  ] satisfies [
    DashboardDataProjectionBlockedReason,
    Parameters<typeof buildDashboardDataProjectionRequestFixtureV1>[0],
  ][])(
    'blocks unsafe safe write runner source: %s',
    (expectedReason, override) => {
      const plan = buildDashboardDataProjectionPlan(buildDashboardDataProjectionRequestFixtureV1(override));
      const result = runDashboardDataProjection(plan);

      expect(validateDashboardDataProjectionInput(plan.request.source_safe_write_runner_gate_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        writes_database: false,
        answer: {
          projection_blocked: true,
          blocked_reason: expectedReason,
          dashboard_rows: [],
          dashboard_rows_count: 0,
          generated_dashboard_rows: false,
          executable: false,
          writes_database: false,
          renders_surface: false,
          summary: {
            total: 0,
            review_required: 0,
            source_blocked: 0,
            policy_blocked: 0,
            missing_evidence: 0,
            high_risk: 0,
            by_action_type: {},
            by_row_status: {},
            by_attention_level: {},
          },
        },
      });
    },
  );

  it('is deterministic and avoids clock or random identifiers', () => {
    const plan = buildDashboardDataProjectionPlan(buildDashboardDataProjectionRequestFixtureV1());
    const first = runDashboardDataProjection(plan);
    const second = runDashboardDataProjection(plan);

    expect(first).toEqual(second);
    expect(first.answer.dashboard_rows.map(row => row.projection_row_id)).toEqual([
      'DASHBOARD_DATA_PROJECTION_LIVE_001',
      'DASHBOARD_DATA_PROJECTION_LIVE_002',
    ]);

    const source = readFileSync('src/lib/dashboardDataProjectionReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'crypto.randomUUID', 'randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('preserves the source reference and does not mutate source candidates', () => {
    const request = buildDashboardDataProjectionRequestFixtureV1();
    const source = request.source_safe_write_runner_gate_result;
    const before = JSON.stringify(source);
    const firstSourceCandidate = source.answer.safe_write_runner_candidates[0];
    const result = runDashboardDataProjection(buildDashboardDataProjectionPlan(request));

    expect(result.answer.source_safe_write_runner_gate_result).toBe(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.answer.dashboard_rows[0].evidence_refs).toBe(firstSourceCandidate.evidence_refs);
    expect(result.answer.dashboard_rows[0].risk_flags).toBe(firstSourceCandidate.risk_flags);
  });

  it('keeps row projection helper pure and non-rendering', () => {
    const sourceCandidate = buildDashboardDataProjectionSourceCandidateFixtureV1(1, {
      risk_flags: ['message_send_requires_review'],
    });
    const row = projectSafeWriteRunnerCandidateToDashboardRow(sourceCandidate, 0);

    expect(row).toMatchObject({
      projection_row_id: 'DASHBOARD_DATA_PROJECTION_LIVE_001',
      evidence_ref_count: 1,
      risk_flag_count: 1,
      renders_surface: false,
      reads_database: false,
      writes_database: false,
      executable: false,
    });
    expect(row.evidence_refs).toBe(sourceCandidate.evidence_refs);
    expect(row.risk_flags).toBe(sourceCandidate.risk_flags);
  });

  it('keeps output and fixture output free of active true states', () => {
    const request = buildDashboardDataProjectionRequestFixtureV1();
    const result = runDashboardDataProjection(buildDashboardDataProjectionPlan(request));

    expect(findActiveTrueStates(request)).toEqual([]);
    expect(findActiveTrueStates(result)).toEqual([]);
    expect(findUnsafeMissingRequirementStates(request)).toEqual([]);
  });

  it('keeps production free of upstream calls, storage access, rendering hooks, runtime hooks, and execution hooks', () => {
    const productionSource = readFileSync('src/lib/dashboardDataProjectionReadiness.ts', 'utf8');
    const forbiddenTerms = [
      'runSafeWriteRunnerGate',
      'runDbWritePlanDryRun',
      'runActionRunnerBoundaryContract',
      'runHumanConfirmationContract',
      'runConfirmedActionReviewQueue',
      'runConfirmedActionLiveDryRun',
      'runSuggestOnlyLiveDryRun',
      'runReadOnlyAgentLiveDryRun',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'getDb',
      'db.select',
      'db.execute',
      'db.run',
      'tx.execute',
      'transaction(',
      'SELECT ',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'BEGIN TRANSACTION',
      'COMMIT;',
      'ROLLBACK;',
      'React',
      'pages',
      'components',
      'executeAction',
      'ActionRunner',
      'confirmAndExecute',
      'execute_queue_item',
      'execute_confirmation',
      'fetch',
      'axios',
      'process.env',
      'import.meta.env',
      'textAIProvider',
      'multimodalProvider',
      'Provider',
      'ModelRouterRuntime',
      'PromptRuntime',
      'providerRuntime',
      'callProvider',
      'invokeWithFixtureAdapter',
      'runEvalDataset',
      'EvalRunner',
      'ready_to_write: true',
      'ready_for_runner: true',
      'executable: true',
      'executed: true',
      'write_executed: true',
      'persisted: true',
      'reads_database: true',
      'writes_database: true',
      'generates_executable_sql: true',
      'executes_sql: true',
      'opens_transaction: true',
      'commits_transaction: true',
      'rolls_back_transaction: true',
      'represents_db_write: true',
      'represents_executed_action: true',
      'represents_write_runner_execution: true',
      'renders_surface: true',
    ];

    for (const term of forbiddenTerms) {
      expect(productionSource).not.toContain(term);
    }
    expect(productionSource).not.toMatch(/\bUI\b/);
    expect(productionSource).not.toMatch(/(?<!Safe)(?<!safe)WriteRunner/);
    expect(productionSource).toContain('renders_surface: BoolFalse');
    expect(productionSource).toContain('renders_surface: FALSE_VALUE');
  });

  it('keeps fixture file free of upstream calls, storage access, rendering hooks, runtime hooks, and runner hooks', () => {
    const fixtureSource = readFileSync(
      'src/lib/dashboardDataProjection/dashboardDataProjectionFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
      'runSafeWriteRunnerGate',
      'runDbWritePlanDryRun',
      'runActionRunnerBoundaryContract',
      'runHumanConfirmationContract',
      'runConfirmedActionReviewQueue',
      'runConfirmedActionLiveDryRun',
      'runSuggestOnlyLiveDryRun',
      'getDb',
      'db.select',
      'db.execute',
      'db.run',
      'React',
      'pages',
      'components',
      'ActionRunner',
      'executeAction',
      'confirmAndExecute',
      'textAIProvider',
      'multimodalProvider',
      'Provider',
      'ModelRouterRuntime',
      'PromptRuntime',
      'providerRuntime',
      'callProvider',
    ];

    for (const term of forbiddenTerms) {
      expect(fixtureSource).not.toContain(term);
    }
    expect(fixtureSource).not.toMatch(/\bUI\b/);
    expect(fixtureSource).not.toMatch(/(?<!Safe)(?<!safe)WriteRunner/);
  });

  it('does not modify files outside the Loop 40 allowed change set', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean)
      .map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/'));

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

    const loop54Files = new Set(LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES);
    if (hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles)) return;
    const matchesLoop54 = changedFiles.length === loop54Files.size
      && changedFiles.every(file => loop54Files.has(file));
    expect(changedFiles.filter(file => !ALLOWED_CHANGED_FILES.has(file) && !matchesLoop54)).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => (
      file.startsWith('src/components/')
      && !ALLOWED_CHANGED_FILES.has(file)
      && !(matchesLoop54 && file === 'src/components/aiNative/AINativeCRMWorkspace.tsx')
    ))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
  });
});

function findActiveTrueStates(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findActiveTrueStates(item, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, item]) => {
    const currentPath = `${path}.${key}`;
    const self = ACTIVE_TRUE_STATE_KEYS.includes(key) && item === true ? [currentPath] : [];
    return [...self, ...findActiveTrueStates(item, currentPath)];
  });
}

function findUnsafeMissingRequirementStates(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUnsafeMissingRequirementStates(item, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const current = record.kind === 'MISSING_EXECUTION_REQUIREMENT'
    && (record.required !== true || record.satisfied !== false || record.blocking !== true)
    ? [path]
    : [];
  return [
    ...current,
    ...Object.entries(record).flatMap(([key, item]) => (
      findUnsafeMissingRequirementStates(item, `${path}.${key}`)
    )),
  ];
}
import { hasExactStage2ChangedFileSet } from './stage2ChangedFileCohort';
import { hasExactLiveReasoningActivationChangedFileSet, hasExactStage3StabilizationChangedFileSet, hasExactStage4CopilotChangedFileSet } from './stage3StabilizationChangedFileCohort';
