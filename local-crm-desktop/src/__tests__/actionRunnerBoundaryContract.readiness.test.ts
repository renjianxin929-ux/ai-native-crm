import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildRunnerBoundaryContractPlan,
  buildRunnerBoundaryContractTrace,
  buildRunnerBoundarySummary,
  projectConfirmationCandidateToRunnerBoundaryCandidate,
  runRunnerBoundaryContract,
  validateRunnerBoundaryContractInput,
  type RunnerBoundaryBlockedReason,
} from '../lib/actionRunnerBoundaryContractReadiness';
import {
  buildRunnerBoundaryContractRequestFixtureV1,
  buildRunnerBoundarySourceCandidateFixtureV1,
} from '../lib/actionRunnerBoundaryContract/actionRunnerBoundaryContractFixturesV1';

const ALLOWED_CHANGED_FILES = new Set([
  'src/lib/actionRunnerBoundaryContractReadiness.ts',
  'src/lib/actionRunnerBoundaryContract/actionRunnerBoundaryContractFixturesV1.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/lib/dbWritePlanDryRunReadiness.ts',
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
]);

const ACTIVE_TRUE_STATE_KEYS = [
  'human_confirmed',
  'confirmed',
  'approved',
  'executable',
  'executed',
  'ready_for_runner',
  'persisted',
  'writes_database',
  'reads_database',
  'represents_executed_action',
  'usable_for_execution',
];

describe('Action runner boundary contract readiness gate', () => {
  it('projects caller-provided human confirmation candidates into blocked runner boundary candidates', () => {
    const sourceCandidate = buildRunnerBoundarySourceCandidateFixtureV1(1);
    const request = buildRunnerBoundaryContractRequestFixtureV1({
      answer: { candidates: [sourceCandidate] },
    });
    const plan = buildRunnerBoundaryContractPlan(request);
    const result = runRunnerBoundaryContract(plan);

    expect(validateRunnerBoundaryContractInput(request.source_human_confirmation_contract_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(plan).toMatchObject({
      kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'action_runner_boundary_contract_readiness_only',
      allowed_operations: [
        'validate_human_confirmation_contract_result',
        'project_runner_boundary_candidates',
        'build_runner_boundary_summary',
      ],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        calls_provider: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'read_db',
      'write_db',
      'render_ui',
      'record_real_human_confirmation',
      'resolve_operator_identity',
      'call_provider',
      'send_message',
      'mutate_state',
    ]));
    expect(result).toMatchObject({
      kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      represents_runner_execution: false,
      answer: {
        kind: 'ACTION_RUNNER_BOUNDARY_ANSWER',
        contract_only: true,
        dry_run_only: true,
        ready_for_runner: false,
        executable: false,
        executed: false,
        persisted: false,
        reads_database: false,
        writes_database: false,
        human_confirmed: false,
        confirmed: false,
        approved: false,
        represents_executed_action: false,
        represents_runner_execution: false,
        requires_real_human_confirmation: true,
        generated_runner_boundary_candidates: true,
        runner_boundary_blocked: false,
        blocked_reason: null,
      },
    });
    expect(result.answer.source_human_confirmation_contract_result)
      .toBe(request.source_human_confirmation_contract_result);
    expect(result.answer.runner_boundary_candidates_count).toBe(1);

    const candidate = result.answer.runner_boundary_candidates[0];
    expect(candidate).toMatchObject({
      kind: 'ACTION_RUNNER_BOUNDARY_CANDIDATE',
      version: 'v1',
      runner_boundary_candidate_id: 'ACTION_RUNNER_BOUNDARY_LIVE_001',
      source_confirmation_candidate_id: sourceCandidate.confirmation_candidate_id,
      source_queue_item_id: sourceCandidate.source_queue_item_id,
      source_action_id: sourceCandidate.source_action_id,
      source_proposal_id: sourceCandidate.source_proposal_id,
      source_proposal_type: sourceCandidate.source_proposal_type,
      action_type: sourceCandidate.action_type,
      title: sourceCandidate.title,
      summary: sourceCandidate.summary,
      runner_status: 'blocked_requires_real_confirmation',
      blocked_reason: 'requires_real_human_confirmation',
      ready_for_runner: false,
      executable: false,
      executed: false,
      human_confirmed: false,
      confirmed: false,
      approved: false,
      writes_database: false,
      represents_executed_action: false,
      represents_runner_execution: false,
      requires_real_human_confirmation: true,
    });
    expect(candidate.evidence_refs).toBe(sourceCandidate.evidence_refs);
    expect(candidate.risk_flags).toBe(sourceCandidate.risk_flags);
  });

  it('blocks the whole result when the source human confirmation contract is blocked', () => {
    const result = runRunnerBoundaryContract(buildRunnerBoundaryContractPlan(
      buildRunnerBoundaryContractRequestFixtureV1({ answer: { contract_blocked: true } }),
    ));

    expect(result.answer).toMatchObject({
      runner_boundary_blocked: true,
      blocked_reason: 'source_contract_blocked',
      runner_boundary_candidates: [],
      runner_boundary_candidates_count: 0,
      generated_runner_boundary_candidates: false,
      ready_for_runner: false,
      executable: false,
      executed: false,
    });
  });

  it('projects blocked source confirmation candidates instead of filtering them', () => {
    const blockedSource = buildRunnerBoundarySourceCandidateFixtureV1(1, {
      confirmation_status: 'blocked',
      blocked_reason: 'Source confirmation candidate lacks evidence',
    });
    const result = runRunnerBoundaryContract(buildRunnerBoundaryContractPlan(
      buildRunnerBoundaryContractRequestFixtureV1({ answer: { candidates: [blockedSource] } }),
    ));

    expect(result.answer.runner_boundary_blocked).toBe(false);
    expect(result.answer.runner_boundary_candidates_count).toBe(1);
    expect(result.answer.runner_boundary_candidates[0]).toMatchObject({
      source_confirmation_candidate_id: blockedSource.confirmation_candidate_id,
      runner_status: 'blocked_source_confirmation_candidate',
      blocked_reason: 'Source confirmation candidate lacks evidence',
      ready_for_runner: false,
      executable: false,
    });
  });

  it('keeps required confirmation proof schema-only and idempotency unusable for execution', () => {
    const sourceCandidate = buildRunnerBoundarySourceCandidateFixtureV1(1);
    const candidate = projectConfirmationCandidateToRunnerBoundaryCandidate(sourceCandidate, 0);

    expect(candidate.required_confirmation_proof).toEqual({
      kind: 'REQUIRED_CONFIRMATION_PROOF_SCHEMA',
      schema_only: true,
      requires_real_human_confirmation: true,
      requires_operator_resolution: true,
      requires_confirmation_metadata_resolution: true,
      represents_recorded_confirmation: false,
      recorded_confirmation_proof: [],
    });
    expect(JSON.stringify(candidate.required_confirmation_proof)).not.toContain('confirmed_at');
    expect(JSON.stringify(candidate.required_confirmation_proof)).not.toContain('approved_at');
    expect(candidate.required_operator_confirmation_dependency).toEqual({
      kind: 'REQUIRED_OPERATOR_CONFIRMATION_DEPENDENCY',
      version: 'v1',
      dependency_only: true,
      resolved: false,
      represents_real_operator: false,
      persisted: false,
    });
    expect(candidate.idempotency).toEqual({
      kind: 'RUNNER_IDEMPOTENCY_PLACEHOLDER',
      version: 'v1',
      placeholder_only: true,
      resolved: false,
      persisted: false,
      usable_for_execution: false,
      value: `RUNNER_BOUNDARY_IDEMPOTENCY_${sourceCandidate.source_action_id}`,
    });
  });

  it('keeps execution prohibition explicit, including calls_provider false', () => {
    const result = runRunnerBoundaryContract(buildRunnerBoundaryContractPlan(
      buildRunnerBoundaryContractRequestFixtureV1({
        answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1)] },
      }),
    ));
    const prohibition = result.answer.runner_boundary_candidates[0].execution_prohibition;

    expect(prohibition).toMatchObject({
      kind: 'RUNNER_EXECUTION_PROHIBITION',
      executes_action: false,
      writes_database: false,
      mutates_state: false,
      sends_message: false,
      calls_provider: false,
    });
    expect(prohibition.explicit_non_actions.length).toBeGreaterThan(0);
  });

  it('builds summary and trace without creating a runnable candidate', () => {
    const request = buildRunnerBoundaryContractRequestFixtureV1();
    const trace = buildRunnerBoundaryContractTrace(buildRunnerBoundaryContractPlan(request));
    const summary = buildRunnerBoundarySummary(trace.result.answer.runner_boundary_candidates);

    expect(trace).toMatchObject({
      kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_TRACE',
      persisted: false,
      result: {
        kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT',
        persisted: false,
        answer: {
          generated_runner_boundary_candidates: true,
          ready_for_runner: false,
          executable: false,
          executed: false,
        },
      },
    });
    expect(summary).toEqual({
      kind: 'ACTION_RUNNER_BOUNDARY_SUMMARY',
      version: 'v1',
      total: 2,
      blocked_requires_real_confirmation: 1,
      blocked_source_confirmation_candidate: 1,
      by_action_type: {
        CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
        CONFIRM_REVIEW_EVIDENCE_GAP: 1,
      },
      by_runner_status: {
        blocked_requires_real_confirmation: 1,
        blocked_source_confirmation_candidate: 1,
      },
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_HUMAN_CONFIRMATION_CONTRACT_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_contract_blocked', { answer: { contract_blocked: true } }],
    ['source_candidates_empty', { answer: { candidates: [], candidates_count: 0 } }],
    ['illegal_source_executes_confirmation', { answer: { executes_confirmation: true } }],
    ['illegal_source_not_contract_only', { answer: { contract_only: false } }],
    ['illegal_source_executable', { answer: { executable: true } }],
    ['illegal_source_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_source_human_confirmed', { answer: { human_confirmed: true } }],
    ['illegal_source_reads_database', { answer: { safety: { reads_database: true } } }],
    ['illegal_source_writes_database', { answer: { safety: { writes_database: true } } }],
    ['illegal_candidate_human_confirmed', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { human_confirmed: true })] },
    }],
    ['illegal_candidate_confirmed', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { confirmed: true })] },
    }],
    ['illegal_candidate_approved', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { approved: true })] },
    }],
    ['illegal_candidate_executable', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { executable: true })] },
    }],
    ['illegal_candidate_executed', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { executed: true })] },
    }],
    ['illegal_candidate_persisted', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { persisted: true })] },
    }],
    ['illegal_candidate_writes_database', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { writes_database: true })] },
    }],
    ['illegal_candidate_represents_executed_action', {
      answer: {
        candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { represents_executed_action: true })],
      },
    }],
    ['illegal_candidate_represents_recorded_confirmation', {
      answer: {
        candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, {
          represents_recorded_confirmation: true,
        })],
      },
    }],
    ['illegal_candidate_not_contract_only', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { contract_only: false })] },
    }],
    ['illegal_candidate_missing_human_review', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { requires_human_review: false })] },
    }],
    ['illegal_candidate_operator_resolved', {
      answer: { candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, { operator_resolved: true })] },
    }],
    ['illegal_candidate_operator_real', {
      answer: {
        candidates: [buildRunnerBoundarySourceCandidateFixtureV1(1, {
          operator_represents_real_operator: true,
        })],
      },
    }],
  ] satisfies [RunnerBoundaryBlockedReason, Parameters<typeof buildRunnerBoundaryContractRequestFixtureV1>[0]][])(
    'blocks unsafe human confirmation source: %s',
    (expectedReason, override) => {
      const plan = buildRunnerBoundaryContractPlan(buildRunnerBoundaryContractRequestFixtureV1(override));
      const result = runRunnerBoundaryContract(plan);

      expect(validateRunnerBoundaryContractInput(plan.request.source_human_confirmation_contract_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        represents_runner_execution: false,
        answer: {
          runner_boundary_blocked: true,
          blocked_reason: expectedReason,
          runner_boundary_candidates: [],
          runner_boundary_candidates_count: 0,
          generated_runner_boundary_candidates: false,
          ready_for_runner: false,
          executable: false,
          executed: false,
          summary: {
            total: 0,
            blocked_requires_real_confirmation: 0,
            blocked_source_confirmation_candidate: 0,
            by_action_type: {},
            by_runner_status: {},
          },
        },
      });
    },
  );

  it('is deterministic and avoids clock or random identifiers', () => {
    const plan = buildRunnerBoundaryContractPlan(buildRunnerBoundaryContractRequestFixtureV1());
    const first = runRunnerBoundaryContract(plan);
    const second = runRunnerBoundaryContract(plan);

    expect(first).toEqual(second);
    expect(first.answer.runner_boundary_candidates.map(candidate => candidate.runner_boundary_candidate_id)).toEqual([
      'ACTION_RUNNER_BOUNDARY_LIVE_001',
      'ACTION_RUNNER_BOUNDARY_LIVE_002',
    ]);

    const source = readFileSync('src/lib/actionRunnerBoundaryContractReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'crypto.randomUUID', 'randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('preserves the source reference and does not mutate source candidates', () => {
    const request = buildRunnerBoundaryContractRequestFixtureV1();
    const source = request.source_human_confirmation_contract_result;
    const before = JSON.stringify(source);
    const firstSourceCandidate = source.answer.candidates[0];
    const result = runRunnerBoundaryContract(buildRunnerBoundaryContractPlan(request));

    expect(result.answer.source_human_confirmation_contract_result).toBe(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.answer.runner_boundary_candidates[0].evidence_refs).toBe(firstSourceCandidate.evidence_refs);
    expect(result.answer.runner_boundary_candidates[0].risk_flags).toBe(firstSourceCandidate.risk_flags);
  });

  it('keeps output and fixture output free of active true states', () => {
    const request = buildRunnerBoundaryContractRequestFixtureV1();
    const result = runRunnerBoundaryContract(buildRunnerBoundaryContractPlan(request));

    expect(findActiveTrueStates(request)).toEqual([]);
    expect(findActiveTrueStates(result)).toEqual([]);
  });

  it('keeps production free of upstream calls, storage access, UI hooks, concrete runtime hooks, and execution hooks', () => {
    const productionSource = readFileSync('src/lib/actionRunnerBoundaryContractReadiness.ts', 'utf8');
    const forbiddenTerms = [
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
      'INSERT',
      'UPDATE',
      'DELETE',
      'React',
      'pages',
      'executeAction',
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
    ];
    const activeTrueStateLiterals = [
      'executable: true',
      'human_confirmed: true',
      'confirmed: true',
      'approved: true',
      'ready_for_runner: true',
      'executed: true',
      'writable_for_execution: true',
      'writes_database: true',
      'reads_database: true',
      'represents_executed_action: true',
      'usable_for_execution: true',
    ];

    for (const term of [...forbiddenTerms, ...activeTrueStateLiterals]) {
      expect(productionSource).not.toContain(term);
    }
    expect(productionSource).not.toMatch(/\bUI\b/);
    expect(productionSource).not.toMatch(/\bActionRunner\b/);
    expect(productionSource).toContain('calls_provider: BoolFalse');
    expect(productionSource).toContain('calls_provider: FALSE_VALUE');
  });

  it('keeps fixture file free of upstream calls, storage access, UI hooks, concrete runtime hooks, and runner hooks', () => {
    const fixtureSource = readFileSync(
      'src/lib/actionRunnerBoundaryContract/actionRunnerBoundaryContractFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
      'runHumanConfirmationContract',
      'runConfirmedActionReviewQueue',
      'runConfirmedActionLiveDryRun',
      'runSuggestOnlyLiveDryRun',
      'getDb',
      'db.select',
      'INSERT',
      'UPDATE',
      'DELETE',
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
  });

  it('does not modify files outside the Loop 37 allowed change set', () => {
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
