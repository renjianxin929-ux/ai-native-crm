import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildDbWritePlanDryRunPlan,
  buildDbWritePlanDryRunTrace,
  buildDbWritePlanSummary,
  projectRunnerBoundaryCandidateToDbWritePlanCandidate,
  runDbWritePlanDryRun,
  validateDbWritePlanDryRunInput,
  type DbWritePlanDryRunBlockedReason,
} from '../lib/dbWritePlanDryRunReadiness';
import {
  buildDbWritePlanDryRunRequestFixtureV1,
  buildDbWritePlanSourceCandidateFixtureV1,
} from '../lib/dbWritePlanDryRun/dbWritePlanDryRunFixturesV1';

const ALLOWED_CHANGED_FILES = new Set([
  'src/lib/dbWritePlanDryRunReadiness.ts',
  'src/lib/dbWritePlanDryRun/dbWritePlanDryRunFixturesV1.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
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
]);

const ACTIVE_TRUE_STATE_KEYS = [
  'ready_to_write',
  'ready_for_runner',
  'executable',
  'executed',
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
  'usable_for_execution',
];

describe('DB write plan transaction dry-run readiness gate', () => {
  it('projects caller-provided runner boundary candidates into blocked write plan candidates', () => {
    const sourceCandidate = buildDbWritePlanSourceCandidateFixtureV1(1);
    const request = buildDbWritePlanDryRunRequestFixtureV1({
      answer: { runner_boundary_candidates: [sourceCandidate] },
    });
    const plan = buildDbWritePlanDryRunPlan(request);
    const result = runDbWritePlanDryRun(plan);

    expect(validateDbWritePlanDryRunInput(request.source_action_runner_boundary_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(plan).toMatchObject({
      kind: 'DB_WRITE_PLAN_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'db_write_plan_dry_run_readiness_only',
      allowed_operations: [
        'validate_action_runner_boundary_contract_result',
        'project_db_write_plan_candidates',
        'build_db_write_plan_summary',
      ],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        generates_executable_sql: false,
        executes_sql: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'read_db',
      'write_db',
      'rerun_action_runner_boundary_contract',
      'generate_executable_statement',
      'open_transaction_boundary',
      'close_transaction_boundary',
      'persist_write_plan',
      'execute_write_plan',
      'call_provider',
      'render_surface',
    ]));
    expect(result).toMatchObject({
      kind: 'DB_WRITE_PLAN_DRY_RUN_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      answer: {
        kind: 'DB_WRITE_PLAN_DRY_RUN_ANSWER',
        contract_only: true,
        dry_run_only: true,
        write_plan_only: true,
        ready_to_write: false,
        executable: false,
        executed: false,
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
        requires_real_human_confirmation: true,
        requires_safe_write_runner: true,
        generated_write_plan_candidates: true,
        write_plan_blocked: false,
        blocked_reason: null,
      },
    });
    expect(result.answer.source_action_runner_boundary_result).toBe(request.source_action_runner_boundary_result);
    expect(result.answer.write_plan_candidates_count).toBe(1);

    const candidate = result.answer.write_plan_candidates[0];
    expect(candidate).toMatchObject({
      kind: 'DB_WRITE_PLAN_DRY_RUN_CANDIDATE',
      version: 'v1',
      write_plan_candidate_id: 'DB_WRITE_PLAN_DRY_RUN_LIVE_001',
      source_runner_boundary_candidate_id: sourceCandidate.runner_boundary_candidate_id,
      source_confirmation_candidate_id: sourceCandidate.source_confirmation_candidate_id,
      source_action_id: sourceCandidate.source_action_id,
      source_proposal_id: sourceCandidate.source_proposal_id,
      source_proposal_type: sourceCandidate.source_proposal_type,
      action_type: sourceCandidate.action_type,
      title: sourceCandidate.title,
      write_plan_status: 'blocked_requires_real_confirmation',
      blocked_reason: 'requires_real_human_confirmation_before_write_plan',
      ready_to_write: false,
      executable: false,
      executed: false,
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
      requires_real_human_confirmation: true,
      requires_safe_write_runner: true,
    });
    expect(candidate.evidence_refs).toBe(sourceCandidate.evidence_refs);
    expect(candidate.risk_flags).toBe(sourceCandidate.risk_flags);
  });

  it('blocks the whole result when the source runner boundary result is blocked', () => {
    const result = runDbWritePlanDryRun(buildDbWritePlanDryRunPlan(
      buildDbWritePlanDryRunRequestFixtureV1({ answer: { runner_boundary_blocked: true } }),
    ));

    expect(result.answer).toMatchObject({
      write_plan_blocked: true,
      blocked_reason: 'source_runner_boundary_blocked',
      write_plan_candidates: [],
      write_plan_candidates_count: 0,
      generated_write_plan_candidates: false,
      ready_to_write: false,
      executable: false,
      writes_database: false,
      executes_sql: false,
    });
  });

  it('projects blocked runner boundary candidates instead of filtering them', () => {
    const blockedSource = buildDbWritePlanSourceCandidateFixtureV1(1, {
      runner_status: 'blocked_source_confirmation_candidate',
      blocked_reason: 'Source confirmation candidate lacks evidence',
    });
    const result = runDbWritePlanDryRun(buildDbWritePlanDryRunPlan(
      buildDbWritePlanDryRunRequestFixtureV1({ answer: { runner_boundary_candidates: [blockedSource] } }),
    ));

    expect(result.answer.write_plan_blocked).toBe(false);
    expect(result.answer.write_plan_candidates_count).toBe(1);
    expect(result.answer.write_plan_candidates[0]).toMatchObject({
      source_runner_boundary_candidate_id: blockedSource.runner_boundary_candidate_id,
      write_plan_status: 'blocked_source_confirmation_candidate',
      blocked_reason: 'Source confirmation candidate lacks evidence',
      ready_to_write: false,
      executable: false,
      writes_database: false,
    });
  });

  it('keeps placeholder substructures explicit and unusable for execution', () => {
    const sourceCandidate = buildDbWritePlanSourceCandidateFixtureV1(1);
    const candidate = projectRunnerBoundaryCandidateToDbWritePlanCandidate(sourceCandidate, 0);

    expect(candidate.target_entity_projection).toEqual({
      kind: 'TARGET_ENTITY_PROJECTION_PLACEHOLDER',
      schema_only: true,
      resolved: false,
      persisted: false,
      reads_database: false,
      writes_database: false,
      target_entity_kind: 'follow_up_task_placeholder',
      target_entity_id_placeholder: `UNRESOLVED_TARGET_ENTITY_${sourceCandidate.source_action_id}`,
      represents_existing_db_row: false,
      requires_future_lookup: true,
    });
    expect(candidate.transaction_boundary).toEqual({
      kind: 'TRANSACTION_BOUNDARY_PLACEHOLDER',
      placeholder_only: true,
      resolved: false,
      opens_transaction: false,
      commits_transaction: false,
      rolls_back_transaction: false,
      usable_for_execution: false,
    });
    expect(candidate.rollback).toEqual({
      kind: 'ROLLBACK_PLACEHOLDER',
      placeholder_only: true,
      resolved: false,
      rollback_plan_recorded: false,
      usable_for_execution: false,
    });
    expect(candidate.sql_generation).toEqual({
      kind: 'SQL_GENERATION_PLACEHOLDER',
      schema_only: true,
      generates_sql: false,
      generates_executable_sql: false,
      executable_sql: '',
      executes_sql: false,
      usable_for_execution: false,
    });
    expect(candidate.idempotency).toEqual({
      kind: 'DB_WRITE_PLAN_IDEMPOTENCY_PLACEHOLDER',
      version: 'v1',
      placeholder_only: true,
      resolved: false,
      persisted: false,
      usable_for_execution: false,
      value: `DB_WRITE_PLAN_IDEMPOTENCY_${sourceCandidate.source_action_id}`,
    });
    expect(candidate.intended_mutation_summary).toMatchObject({
      kind: 'INTENDED_MUTATION_SUMMARY_PLACEHOLDER',
      schema_only: true,
      executable: false,
      writes_database: false,
    });
  });

  it('keeps execution prohibition explicit across storage, statement, and transaction actions', () => {
    const result = runDbWritePlanDryRun(buildDbWritePlanDryRunPlan(
      buildDbWritePlanDryRunRequestFixtureV1({
        answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1)] },
      }),
    ));
    const prohibition = result.answer.write_plan_candidates[0].execution_prohibition;

    expect(prohibition).toMatchObject({
      kind: 'WRITE_EXECUTION_PROHIBITION',
      executes_write: false,
      writes_database: false,
      reads_database: false,
      executes_sql: false,
      generates_executable_sql: false,
      opens_transaction: false,
      commits_transaction: false,
      rolls_back_transaction: false,
    });
    expect(prohibition.explicit_non_actions.length).toBeGreaterThan(0);
  });

  it('builds summary and trace without creating a writable candidate', () => {
    const request = buildDbWritePlanDryRunRequestFixtureV1();
    const trace = buildDbWritePlanDryRunTrace(buildDbWritePlanDryRunPlan(request));
    const summary = buildDbWritePlanSummary(trace.result.answer.write_plan_candidates);

    expect(trace).toMatchObject({
      kind: 'DB_WRITE_PLAN_DRY_RUN_TRACE',
      persisted: false,
      result: {
        kind: 'DB_WRITE_PLAN_DRY_RUN_RESULT',
        persisted: false,
        answer: {
          generated_write_plan_candidates: true,
          ready_to_write: false,
          executable: false,
          writes_database: false,
        },
      },
    });
    expect(summary).toEqual({
      kind: 'DB_WRITE_PLAN_DRY_RUN_SUMMARY',
      version: 'v1',
      total: 2,
      blocked_requires_real_confirmation: 1,
      blocked_source_confirmation_candidate: 1,
      by_action_type: {
        CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
        CONFIRM_REVIEW_EVIDENCE_GAP: 1,
      },
      by_write_plan_status: {
        blocked_requires_real_confirmation: 1,
        blocked_source_confirmation_candidate: 1,
      },
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_runner_boundary_blocked', { answer: { runner_boundary_blocked: true } }],
    ['source_candidates_empty', { answer: { runner_boundary_candidates: [], runner_boundary_candidates_count: 0 } }],
    ['illegal_source_not_contract_only', { answer: { contract_only: false } }],
    ['illegal_source_not_dry_run_only', { answer: { dry_run_only: false } }],
    ['illegal_source_ready_for_runner', { answer: { ready_for_runner: true } }],
    ['illegal_source_executable', { answer: { executable: true } }],
    ['illegal_source_executed', { answer: { executed: true } }],
    ['illegal_source_persisted', { answer: { persisted: true } }],
    ['illegal_source_reads_database', { answer: { reads_database: true } }],
    ['illegal_source_writes_database', { answer: { writes_database: true } }],
    ['illegal_source_represents_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_source_represents_runner_execution', { answer: { represents_runner_execution: true } }],
    ['illegal_source_human_confirmed', { answer: { human_confirmed: true } }],
    ['illegal_source_confirmed', { answer: { confirmed: true } }],
    ['illegal_source_approved', { answer: { approved: true } }],
    ['illegal_candidate_ready_for_runner', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { ready_for_runner: true })] },
    }],
    ['illegal_candidate_executable', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { executable: true })] },
    }],
    ['illegal_candidate_executed', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { executed: true })] },
    }],
    ['illegal_candidate_persisted', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { persisted: true })] },
    }],
    ['illegal_candidate_reads_database', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { reads_database: true })] },
    }],
    ['illegal_candidate_writes_database', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { writes_database: true })] },
    }],
    ['illegal_candidate_represents_executed_action', {
      answer: {
        runner_boundary_candidates: [
          buildDbWritePlanSourceCandidateFixtureV1(1, { represents_executed_action: true }),
        ],
      },
    }],
    ['illegal_candidate_represents_runner_execution', {
      answer: {
        runner_boundary_candidates: [
          buildDbWritePlanSourceCandidateFixtureV1(1, { represents_runner_execution: true }),
        ],
      },
    }],
    ['illegal_candidate_human_confirmed', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { human_confirmed: true })] },
    }],
    ['illegal_candidate_confirmed', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { confirmed: true })] },
    }],
    ['illegal_candidate_approved', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { approved: true })] },
    }],
    ['illegal_candidate_not_contract_only', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { contract_only: false })] },
    }],
    ['illegal_candidate_not_dry_run_only', {
      answer: { runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { dry_run_only: false })] },
    }],
    ['illegal_candidate_idempotency_usable_for_execution', {
      answer: {
        runner_boundary_candidates: [
          buildDbWritePlanSourceCandidateFixtureV1(1, { idempotency_usable_for_execution: true }),
        ],
      },
    }],
    ['illegal_candidate_idempotency_resolved', {
      answer: {
        runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { idempotency_resolved: true })],
      },
    }],
    ['illegal_candidate_idempotency_persisted', {
      answer: {
        runner_boundary_candidates: [buildDbWritePlanSourceCandidateFixtureV1(1, { idempotency_persisted: true })],
      },
    }],
  ] satisfies [DbWritePlanDryRunBlockedReason, Parameters<typeof buildDbWritePlanDryRunRequestFixtureV1>[0]][])(
    'blocks unsafe runner boundary source: %s',
    (expectedReason, override) => {
      const plan = buildDbWritePlanDryRunPlan(buildDbWritePlanDryRunRequestFixtureV1(override));
      const result = runDbWritePlanDryRun(plan);

      expect(validateDbWritePlanDryRunInput(plan.request.source_action_runner_boundary_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        answer: {
          write_plan_blocked: true,
          blocked_reason: expectedReason,
          write_plan_candidates: [],
          write_plan_candidates_count: 0,
          generated_write_plan_candidates: false,
          ready_to_write: false,
          executable: false,
          writes_database: false,
          executes_sql: false,
          summary: {
            total: 0,
            blocked_requires_real_confirmation: 0,
            blocked_source_confirmation_candidate: 0,
            by_action_type: {},
            by_write_plan_status: {},
          },
        },
      });
    },
  );

  it('is deterministic and avoids clock or random identifiers', () => {
    const plan = buildDbWritePlanDryRunPlan(buildDbWritePlanDryRunRequestFixtureV1());
    const first = runDbWritePlanDryRun(plan);
    const second = runDbWritePlanDryRun(plan);

    expect(first).toEqual(second);
    expect(first.answer.write_plan_candidates.map(candidate => candidate.write_plan_candidate_id)).toEqual([
      'DB_WRITE_PLAN_DRY_RUN_LIVE_001',
      'DB_WRITE_PLAN_DRY_RUN_LIVE_002',
    ]);

    const source = readFileSync('src/lib/dbWritePlanDryRunReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'crypto.randomUUID', 'randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('preserves the source reference and does not mutate source candidates', () => {
    const request = buildDbWritePlanDryRunRequestFixtureV1();
    const source = request.source_action_runner_boundary_result;
    const before = JSON.stringify(source);
    const firstSourceCandidate = source.answer.runner_boundary_candidates[0];
    const result = runDbWritePlanDryRun(buildDbWritePlanDryRunPlan(request));

    expect(result.answer.source_action_runner_boundary_result).toBe(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.answer.write_plan_candidates[0].evidence_refs).toBe(firstSourceCandidate.evidence_refs);
    expect(result.answer.write_plan_candidates[0].risk_flags).toBe(firstSourceCandidate.risk_flags);
  });

  it('keeps output and fixture output free of active true states', () => {
    const request = buildDbWritePlanDryRunRequestFixtureV1();
    const result = runDbWritePlanDryRun(buildDbWritePlanDryRunPlan(request));

    expect(findActiveTrueStates(request)).toEqual([]);
    expect(findActiveTrueStates(result)).toEqual([]);
  });

  it('keeps production free of upstream calls, storage access, UI hooks, concrete runtime hooks, and execution hooks', () => {
    const productionSource = readFileSync('src/lib/dbWritePlanDryRunReadiness.ts', 'utf8');
    const forbiddenTerms = [
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
      'WriteRunner',
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
      'usable_for_execution: true',
    ];

    for (const term of forbiddenTerms) {
      expect(productionSource).not.toContain(term);
    }
    expect(productionSource).not.toMatch(/\bUI\b/);
    expect(productionSource).toContain('SqlGenerationPlaceholder');
    expect(productionSource).toContain('generates_sql: BoolFalse');
    expect(productionSource).toContain("executable_sql: ''");
    expect(productionSource).toContain('executes_sql: BoolFalse');
  });

  it('keeps fixture file free of upstream calls, storage access, UI hooks, concrete runtime hooks, and runner hooks', () => {
    const fixtureSource = readFileSync(
      'src/lib/dbWritePlanDryRun/dbWritePlanDryRunFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
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
      'WriteRunner',
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
  });

  it('does not modify files outside the Loop 38 allowed change set', () => {
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
