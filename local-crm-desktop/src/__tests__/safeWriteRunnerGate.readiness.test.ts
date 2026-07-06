import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildSafeWriteRunnerGatePlan,
  buildSafeWriteRunnerGateSummary,
  buildSafeWriteRunnerGateTrace,
  projectWritePlanCandidateToSafeWriteRunnerCandidate,
  runSafeWriteRunnerGate,
  validateSafeWriteRunnerGateInput,
  type SafeWriteRunnerGateBlockedReason,
} from '../lib/safeWriteRunnerGateReadiness';
import {
  buildSafeWriteRunnerGateRequestFixtureV1,
  buildSafeWriteRunnerGateSourceCandidateFixtureV1,
} from '../lib/safeWriteRunnerGate/safeWriteRunnerGateFixturesV1';

const ALLOWED_CHANGED_FILES = new Set([
  'src/lib/safeWriteRunnerGateReadiness.ts',
  'src/lib/safeWriteRunnerGate/safeWriteRunnerGateFixturesV1.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/lib/dashboardDataProjectionReadiness.ts',
  'src/lib/dashboardDataProjection/dashboardDataProjectionFixturesV1.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
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
  'usable_for_execution',
];

describe('Safe write runner gate readiness', () => {
  it('projects caller-provided write plan dry-run candidates into blocked gate candidates', () => {
    const sourceCandidate = buildSafeWriteRunnerGateSourceCandidateFixtureV1(1);
    const request = buildSafeWriteRunnerGateRequestFixtureV1({
      answer: { write_plan_candidates: [sourceCandidate] },
    });
    const plan = buildSafeWriteRunnerGatePlan(request);
    const result = runSafeWriteRunnerGate(plan);

    expect(validateSafeWriteRunnerGateInput(request.source_db_write_plan_dry_run_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(plan).toMatchObject({
      kind: 'SAFE_WRITE_RUNNER_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'safe_write_runner_gate_readiness_only',
      allowed_operations: [
        'validate_db_write_plan_dry_run_result',
        'project_blocked_safe_write_runner_candidates',
        'build_safe_write_runner_gate_summary',
      ],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        generates_executable_sql: false,
        executes_sql: false,
        opens_transaction: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'read_db',
      'write_db',
      'rerun_db_write_plan_dry_run',
      'generate_executable_statement',
      'open_transaction_boundary',
      'close_transaction_boundary',
      'persist_write_plan',
      'run_write_candidate',
      'resolve_real_operator',
      'record_real_confirmation',
    ]));
    expect(result).toMatchObject({
      kind: 'SAFE_WRITE_RUNNER_GATE_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      writes_database: false,
      answer: {
        kind: 'SAFE_WRITE_RUNNER_GATE_ANSWER',
        contract_only: true,
        dry_run_only: true,
        gate_only: true,
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
        commits_transaction: false,
        rolls_back_transaction: false,
        represents_db_write: false,
        represents_executed_action: false,
        represents_write_runner_execution: false,
        runner_gate_blocked: false,
        blocked_reason: null,
        generated_safe_write_runner_candidates: true,
      },
    });
    expect(result.answer.source_db_write_plan_dry_run_result).toBe(request.source_db_write_plan_dry_run_result);
    expect(result.answer.safe_write_runner_candidates_count).toBe(1);

    const candidate = result.answer.safe_write_runner_candidates[0];
    expect(candidate).toMatchObject({
      kind: 'SAFE_WRITE_RUNNER_CANDIDATE',
      version: 'v1',
      safe_write_runner_candidate_id: 'SAFE_WRITE_RUNNER_GATE_LIVE_001',
      source_write_plan_candidate_id: sourceCandidate.write_plan_candidate_id,
      source_runner_boundary_candidate_id: sourceCandidate.source_runner_boundary_candidate_id,
      source_confirmation_candidate_id: sourceCandidate.source_confirmation_candidate_id,
      source_action_id: sourceCandidate.source_action_id,
      source_proposal_id: sourceCandidate.source_proposal_id,
      source_proposal_type: sourceCandidate.source_proposal_type,
      action_type: sourceCandidate.action_type,
      title: sourceCandidate.title,
      runner_gate_status: 'blocked_requires_real_confirmation',
      blocked_reason: 'requires_real_human_confirmation_before_safe_write_gate',
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
      commits_transaction: false,
      rolls_back_transaction: false,
      represents_db_write: false,
      represents_executed_action: false,
      represents_write_runner_execution: false,
      requires_real_human_confirmation: true,
      requires_resolved_operator: true,
      requires_executable_write_plan: true,
      requires_safe_write_runner: true,
    });
    expect(candidate.evidence_refs).toBe(sourceCandidate.evidence_refs);
    expect(candidate.risk_flags).toBe(sourceCandidate.risk_flags);
  });

  it('blocks the whole result when the source write plan is blocked', () => {
    const result = runSafeWriteRunnerGate(buildSafeWriteRunnerGatePlan(
      buildSafeWriteRunnerGateRequestFixtureV1({ answer: { write_plan_blocked: true } }),
    ));

    expect(result.answer).toMatchObject({
      runner_gate_blocked: true,
      blocked_reason: 'source_write_plan_blocked',
      safe_write_runner_candidates: [],
      safe_write_runner_candidates_count: 0,
      generated_safe_write_runner_candidates: false,
      ready_to_write: false,
      ready_for_runner: false,
      executable: false,
      writes_database: false,
      executes_sql: false,
      opens_transaction: false,
    });
  });

  it.each([
    ['blocked_source_confirmation_candidate', 'blocked_source_write_plan_candidate'],
    ['blocked_requires_real_confirmation', 'blocked_requires_real_confirmation'],
  ] as const)(
    'projects blocked write plan candidate status %s instead of filtering it',
    (sourceStatus, gateStatus) => {
      const blockedSource = buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, {
        write_plan_status: sourceStatus,
        blocked_reason: 'Source write plan remains blocked',
      });
      const result = runSafeWriteRunnerGate(buildSafeWriteRunnerGatePlan(
        buildSafeWriteRunnerGateRequestFixtureV1({ answer: { write_plan_candidates: [blockedSource] } }),
      ));

      expect(result.answer.runner_gate_blocked).toBe(false);
      expect(result.answer.safe_write_runner_candidates_count).toBe(1);
      expect(result.answer.safe_write_runner_candidates[0]).toMatchObject({
        source_write_plan_candidate_id: blockedSource.write_plan_candidate_id,
        runner_gate_status: gateStatus,
        ready_to_write: false,
        ready_for_runner: false,
        executable: false,
        writes_database: false,
      });
    },
  );

  it('keeps denial, prohibition, and requirement substructures explicit', () => {
    const sourceCandidate = buildSafeWriteRunnerGateSourceCandidateFixtureV1(1);
    const candidate = projectWritePlanCandidateToSafeWriteRunnerCandidate(sourceCandidate, 0);

    expect(candidate.write_execution_denial).toMatchObject({
      kind: 'WRITE_EXECUTION_DENIAL',
      denial_only: true,
      executes_write: false,
      writes_database: false,
    });
    expect(candidate.write_execution_denial.missing_requirements.map(requirement => requirement.name)).toEqual([
      'requires_real_human_confirmation',
      'requires_resolved_operator',
      'requires_executable_write_plan',
      'requires_safe_write_runner_policy',
      'requires_resolved_idempotency_key',
      'requires_transaction_policy',
      'requires_rollback_strategy',
      'requires_db_write_test_harness',
    ]);
    for (const requirement of candidate.missing_execution_requirements) {
      expect(requirement).toMatchObject({
        kind: 'MISSING_EXECUTION_REQUIREMENT',
        required: true,
        satisfied: false,
        blocking: true,
      });
    }
    expect(candidate.db_write_prohibition).toEqual({
      kind: 'DB_WRITE_PROHIBITION',
      reads_database: false,
      writes_database: false,
      opens_connection: false,
      uses_db_handle: false,
      executes_statement: false,
      mutates_state: false,
    });
    expect(candidate.transaction_prohibition).toEqual({
      kind: 'TRANSACTION_PROHIBITION',
      opens_transaction: false,
      commits_transaction: false,
      rolls_back_transaction: false,
      uses_transaction_handle: false,
      usable_for_execution: false,
    });
    expect(candidate.sql_execution_prohibition).toEqual({
      kind: 'SQL_EXECUTION_PROHIBITION',
      generates_sql: false,
      generates_executable_sql: false,
      executable_sql: '',
      executes_sql: false,
      usable_for_execution: false,
    });
    expect(candidate.idempotency_resolution_requirement).toEqual({
      kind: 'IDEMPOTENCY_RESOLUTION_REQUIREMENT',
      required: true,
      resolved: false,
      usable_for_execution: false,
      source_placeholder_id: sourceCandidate.idempotency.value,
      requires_future_persistence: true,
    });
  });

  it('builds summary and trace while keeping every candidate blocked', () => {
    const request = buildSafeWriteRunnerGateRequestFixtureV1();
    const trace = buildSafeWriteRunnerGateTrace(buildSafeWriteRunnerGatePlan(request));
    const summary = buildSafeWriteRunnerGateSummary(trace.result.answer.safe_write_runner_candidates);

    expect(trace).toMatchObject({
      kind: 'SAFE_WRITE_RUNNER_GATE_TRACE',
      persisted: false,
      writes_database: false,
      result: {
        kind: 'SAFE_WRITE_RUNNER_GATE_RESULT',
        persisted: false,
        writes_database: false,
        answer: {
          generated_safe_write_runner_candidates: true,
          ready_to_write: false,
          ready_for_runner: false,
          executable: false,
          writes_database: false,
        },
      },
    });
    expect(summary).toEqual({
      kind: 'SAFE_WRITE_RUNNER_GATE_SUMMARY',
      version: 'v1',
      total: 2,
      blocked_requires_real_confirmation: 1,
      blocked_requires_executable_write_plan: 0,
      blocked_source_write_plan_candidate: 1,
      blocked_missing_safe_write_runner_policy: 0,
      by_action_type: {
        CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
        CONFIRM_REVIEW_EVIDENCE_GAP: 1,
      },
      by_runner_gate_status: {
        blocked_requires_real_confirmation: 1,
        blocked_source_write_plan_candidate: 1,
      },
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_DB_WRITE_PLAN_DRY_RUN_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_write_plan_blocked', { answer: { write_plan_blocked: true } }],
    ['source_candidates_empty', { answer: { write_plan_candidates: [], write_plan_candidates_count: 0 } }],
    ['illegal_source_not_contract_only', { answer: { contract_only: false } }],
    ['illegal_source_not_dry_run_only', { answer: { dry_run_only: false } }],
    ['illegal_source_not_write_plan_only', { answer: { write_plan_only: false } }],
    ['illegal_source_not_generated_write_plan_candidates', {
      answer: { generated_write_plan_candidates: false },
    }],
    ['illegal_source_ready_to_write', { answer: { ready_to_write: true } }],
    ['illegal_source_ready_for_runner', { answer: { ready_for_runner: true } }],
    ['illegal_source_executable', { answer: { executable: true } }],
    ['illegal_source_executed', { answer: { executed: true } }],
    ['illegal_source_persisted', { answer: { persisted: true } }],
    ['illegal_source_reads_database', { answer: { reads_database: true } }],
    ['illegal_source_writes_database', { answer: { writes_database: true } }],
    ['illegal_source_generates_executable_sql', { answer: { generates_executable_sql: true } }],
    ['illegal_source_executes_sql', { answer: { executes_sql: true } }],
    ['illegal_source_opens_transaction', { answer: { opens_transaction: true } }],
    ['illegal_source_commits_transaction', { answer: { commits_transaction: true } }],
    ['illegal_source_rolls_back_transaction', { answer: { rolls_back_transaction: true } }],
    ['illegal_source_represents_db_write', { answer: { represents_db_write: true } }],
    ['illegal_source_represents_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_candidate_status_not_blocked', {
      answer: {
        write_plan_candidates: [
          { ...buildSafeWriteRunnerGateSourceCandidateFixtureV1(1), write_plan_status: 'pending' },
        ],
      },
    }],
    ['illegal_candidate_not_contract_only', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { contract_only: false })] },
    }],
    ['illegal_candidate_not_dry_run_only', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { dry_run_only: false })] },
    }],
    ['illegal_candidate_not_write_plan_only', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { write_plan_only: false })] },
    }],
    ['illegal_candidate_ready_to_write', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { ready_to_write: true })] },
    }],
    ['illegal_candidate_executable', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { executable: true })] },
    }],
    ['illegal_candidate_executed', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { executed: true })] },
    }],
    ['illegal_candidate_persisted', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { persisted: true })] },
    }],
    ['illegal_candidate_reads_database', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { reads_database: true })] },
    }],
    ['illegal_candidate_writes_database', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { writes_database: true })] },
    }],
    ['illegal_candidate_generates_executable_sql', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { generates_executable_sql: true }),
        ],
      },
    }],
    ['illegal_candidate_executes_sql', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { executes_sql: true })] },
    }],
    ['illegal_candidate_opens_transaction', {
      answer: { write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { opens_transaction: true })] },
    }],
    ['illegal_candidate_commits_transaction', {
      answer: {
        write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { commits_transaction: true })],
      },
    }],
    ['illegal_candidate_rolls_back_transaction', {
      answer: {
        write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { rolls_back_transaction: true })],
      },
    }],
    ['illegal_candidate_represents_db_write', {
      answer: {
        write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { represents_db_write: true })],
      },
    }],
    ['illegal_candidate_represents_executed_action', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { represents_executed_action: true }),
        ],
      },
    }],
    ['illegal_candidate_idempotency_usable_for_execution', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { idempotency_usable_for_execution: true }),
        ],
      },
    }],
    ['illegal_candidate_idempotency_resolved', {
      answer: {
        write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { idempotency_resolved: true })],
      },
    }],
    ['illegal_candidate_idempotency_persisted', {
      answer: {
        write_plan_candidates: [buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, { idempotency_persisted: true })],
      },
    }],
    ['illegal_candidate_sql_generation_executable', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, {
            sql_generation_generates_executable_sql: true,
          }),
        ],
      },
    }],
    ['illegal_candidate_sql_generation_executable', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, {
            sql_generation_executes_sql: true,
          }),
        ],
      },
    }],
    ['illegal_candidate_transaction_usable_for_execution', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, {
            transaction_boundary_usable_for_execution: true,
          }),
        ],
      },
    }],
    ['illegal_candidate_transaction_usable_for_execution', {
      answer: {
        write_plan_candidates: [
          buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, {
            transaction_boundary_opens_transaction: true,
          }),
        ],
      },
    }],
  ] satisfies [
    SafeWriteRunnerGateBlockedReason,
    Parameters<typeof buildSafeWriteRunnerGateRequestFixtureV1>[0],
  ][])(
    'blocks unsafe write plan source: %s',
    (expectedReason, override) => {
      const plan = buildSafeWriteRunnerGatePlan(buildSafeWriteRunnerGateRequestFixtureV1(override));
      const result = runSafeWriteRunnerGate(plan);

      expect(validateSafeWriteRunnerGateInput(plan.request.source_db_write_plan_dry_run_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        writes_database: false,
        answer: {
          runner_gate_blocked: true,
          blocked_reason: expectedReason,
          safe_write_runner_candidates: [],
          safe_write_runner_candidates_count: 0,
          generated_safe_write_runner_candidates: false,
          ready_to_write: false,
          ready_for_runner: false,
          executable: false,
          writes_database: false,
          executes_sql: false,
          opens_transaction: false,
          summary: {
            total: 0,
            blocked_requires_real_confirmation: 0,
            blocked_requires_executable_write_plan: 0,
            blocked_source_write_plan_candidate: 0,
            blocked_missing_safe_write_runner_policy: 0,
            by_action_type: {},
            by_runner_gate_status: {},
          },
        },
      });
    },
  );

  it('is deterministic and avoids clock or random identifiers', () => {
    const plan = buildSafeWriteRunnerGatePlan(buildSafeWriteRunnerGateRequestFixtureV1());
    const first = runSafeWriteRunnerGate(plan);
    const second = runSafeWriteRunnerGate(plan);

    expect(first).toEqual(second);
    expect(first.answer.safe_write_runner_candidates.map(candidate => candidate.safe_write_runner_candidate_id)).toEqual([
      'SAFE_WRITE_RUNNER_GATE_LIVE_001',
      'SAFE_WRITE_RUNNER_GATE_LIVE_002',
    ]);

    const source = readFileSync('src/lib/safeWriteRunnerGateReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'crypto.randomUUID', 'randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('preserves the source reference and does not mutate source candidates', () => {
    const request = buildSafeWriteRunnerGateRequestFixtureV1();
    const source = request.source_db_write_plan_dry_run_result;
    const before = JSON.stringify(source);
    const firstSourceCandidate = source.answer.write_plan_candidates[0];
    const result = runSafeWriteRunnerGate(buildSafeWriteRunnerGatePlan(request));

    expect(result.answer.source_db_write_plan_dry_run_result).toBe(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.answer.safe_write_runner_candidates[0].evidence_refs).toBe(firstSourceCandidate.evidence_refs);
    expect(result.answer.safe_write_runner_candidates[0].risk_flags).toBe(firstSourceCandidate.risk_flags);
  });

  it('keeps output and fixture output free of active true states', () => {
    const request = buildSafeWriteRunnerGateRequestFixtureV1();
    const result = runSafeWriteRunnerGate(buildSafeWriteRunnerGatePlan(request));

    expect(findActiveTrueStates(request)).toEqual([]);
    expect(findActiveTrueStates(result)).toEqual([]);
  });

  it('keeps production free of upstream calls, storage access, UI hooks, runtime hooks, and executable statements', () => {
    const productionSource = readFileSync('src/lib/safeWriteRunnerGateReadiness.ts', 'utf8');
    const forbiddenTerms = [
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
    ];

    for (const term of forbiddenTerms) {
      expect(productionSource).not.toContain(term);
    }
    expect(productionSource).not.toMatch(/\bUI\b/);
    expect(productionSource).not.toMatch(/(?<!Safe)(?<!safe)WriteRunner/);
    expect(productionSource).toContain('SqlExecutionProhibition');
    expect(productionSource).toContain('generates_sql: BoolFalse');
    expect(productionSource).toContain("executable_sql: ''");
    expect(productionSource).toContain('executes_sql: BoolFalse');
  });

  it('keeps fixture file free of upstream calls, storage access, UI hooks, runtime hooks, and runner hooks', () => {
    const fixtureSource = readFileSync(
      'src/lib/safeWriteRunnerGate/safeWriteRunnerGateFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
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

  it('does not modify files outside the Loop 39 allowed change set', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean)
      .map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/'));

    expect(changedFiles.filter(file => !ALLOWED_CHANGED_FILES.has(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
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
