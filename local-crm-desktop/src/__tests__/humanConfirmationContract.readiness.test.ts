import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildHumanConfirmationContractPlan,
  buildHumanConfirmationContractSummary,
  buildHumanConfirmationContractTrace,
  projectReviewQueueCandidateToHumanConfirmationCandidate,
  runHumanConfirmationContract,
  validateHumanConfirmationContractInput,
  type HumanConfirmationContractBlockedReason,
} from '../lib/humanConfirmationContractReadiness';
import {
  buildHumanConfirmationContractRequestFixtureV1,
  buildHumanConfirmationSourceCandidateFixtureV1,
} from '../lib/humanConfirmationContract/humanConfirmationContractFixturesV1';

const ALLOWED_CHANGED_FILES = new Set([
  'src/lib/humanConfirmationContractReadiness.ts',
  'src/lib/humanConfirmationContract/humanConfirmationContractFixturesV1.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/lib/actionRunnerBoundaryContractReadiness.ts',
  'src/lib/actionRunnerBoundaryContract/actionRunnerBoundaryContractFixturesV1.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/lib/dbWritePlanDryRunReadiness.ts',
  'src/lib/dbWritePlanDryRun/dbWritePlanDryRunFixturesV1.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/lib/safeWriteRunnerGateReadiness.ts',
  'src/lib/safeWriteRunnerGate/safeWriteRunnerGateFixturesV1.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
]);

const ACTIVE_TRUE_STATE_KEYS = [
  'executable',
  'human_confirmed',
  'confirmed',
  'approved',
  'persisted',
  'writes_database',
  'reads_database',
  'represents_executed_action',
  'executes_queue_items',
  'executes_confirmation',
];

describe('Human Confirmation Contract readiness gate', () => {
  it('projects review queue candidates into contract-only human confirmation candidates', () => {
    const request = buildHumanConfirmationContractRequestFixtureV1();
    const plan = buildHumanConfirmationContractPlan(request);
    const result = runHumanConfirmationContract(plan);

    expect(validateHumanConfirmationContractInput(request.source_review_queue_result)).toEqual({
      ok: true,
      blocked_reason: null,
    });
    expect(plan).toMatchObject({
      kind: 'HUMAN_CONFIRMATION_CONTRACT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'human_confirmation_contract_readiness_only',
      allowed_operations: [
        'validate_review_queue_result',
        'project_confirmation_contract_candidates',
        'build_confirmation_contract_summary',
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
      'render_ui',
      'resolve_operator',
      'record_human_confirmation',
      'execute_confirmation',
      'execute_queue_item',
      'persist_confirmation',
      'call_provider',
      'send_message',
      'mutate_state',
    ]));
    expect(result).toMatchObject({
      kind: 'HUMAN_CONFIRMATION_CONTRACT_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      answer: {
        kind: 'HUMAN_CONFIRMATION_CONTRACT_ANSWER',
        contract_only: true,
        executable: false,
        persisted: false,
        human_confirmed: false,
        represents_executed_action: false,
        generated_confirmation_contract_candidates: true,
        executes_confirmation: false,
        contract_blocked: false,
        blocked_reason: null,
        safety: {
          reads_database: false,
          writes_database: false,
          executable: false,
        },
      },
    });
    expect(result.answer.source_review_queue_result).toBe(request.source_review_queue_result);
    expect(result.answer.candidates_count).toBe(2);
    expect(result.answer.candidates.map(candidate => candidate.confirmation_candidate_id)).toEqual([
      'HUMAN_CONFIRM_LIVE_001',
      'HUMAN_CONFIRM_LIVE_002',
    ]);

    for (const [index, candidate] of result.answer.candidates.entries()) {
      const source = request.source_review_queue_result.answer.candidates[index];
      expect(candidate.source_queue_item_id).toBe(source.queue_item_id);
      expect(candidate.source_action_id).toBe(source.source_action_id);
      expect(candidate.source_proposal_id).toBe(source.source_proposal_id);
      expect(candidate.source_proposal_type).toBe(source.source_proposal_type);
      expect(candidate.evidence_refs).toBe(source.evidence_refs);
      expect(candidate.risk_flags).toBe(source.risk_flags);
      expect(candidate.preconditions).toBe(source.preconditions);
    }
  });

  it('uses an unresolved future UI/session operator placeholder without fixture-only identity', () => {
    const result = runHumanConfirmationContract(buildHumanConfirmationContractPlan(
      buildHumanConfirmationContractRequestFixtureV1(),
    ));

    for (const candidate of result.answer.candidates) {
      expect(candidate.operator).toEqual({
        kind: 'HUMAN_CONFIRMATION_OPERATOR_PLACEHOLDER',
        version: 'v1',
        contract_only: true,
        resolved: false,
        source: 'future_ui_or_session',
        represents_real_operator: false,
        persisted: false,
      });
      expect(candidate.confirmation_metadata).toEqual({
        kind: 'HUMAN_CONFIRMATION_METADATA_PLACEHOLDER',
        version: 'v1',
        contract_only: true,
        resolved: false,
        source: 'future_ui_or_session',
        persisted: false,
      });
      expect(JSON.stringify(candidate.operator)).not.toContain('fixture_only');
    }
  });

  it('keeps every confirmation candidate non-executable, unpersisted, and unconfirmed', () => {
    const result = runHumanConfirmationContract(buildHumanConfirmationContractPlan(
      buildHumanConfirmationContractRequestFixtureV1(),
    ));

    for (const candidate of result.answer.candidates) {
      expect(candidate).toMatchObject({
        executable: false,
        persisted: false,
        human_confirmed: false,
        confirmed: false,
        approved: false,
        writes_database: false,
        represents_executed_action: false,
        requires_human_review: true,
        contract_only: true,
      });
    }
  });

  it('distinguishes whole source queue blocking from blocked review candidates', () => {
    const blockedCandidate = buildHumanConfirmationSourceCandidateFixtureV1(1, {
      review_status: 'blocked',
      blocked_reason: 'Review queue candidate is blocked by missing evidence',
    });
    const candidateResult = runHumanConfirmationContract(buildHumanConfirmationContractPlan(
      buildHumanConfirmationContractRequestFixtureV1({ answer: { candidates: [blockedCandidate] } }),
    ));

    expect(candidateResult.answer.contract_blocked).toBe(false);
    expect(candidateResult.answer.candidates_count).toBe(1);
    expect(candidateResult.answer.candidates[0]).toMatchObject({
      confirmation_status: 'blocked',
      blocked_reason: 'Review queue candidate is blocked by missing evidence',
      source_queue_item_id: blockedCandidate.queue_item_id,
    });

    const sourceBlockedResult = runHumanConfirmationContract(buildHumanConfirmationContractPlan(
      buildHumanConfirmationContractRequestFixtureV1({ answer: { queue_blocked: true } }),
    ));

    expect(sourceBlockedResult.answer).toMatchObject({
      contract_blocked: true,
      blocked_reason: 'source_queue_blocked',
      candidates: [],
      candidates_count: 0,
      generated_confirmation_contract_candidates: false,
      executes_confirmation: false,
      represents_executed_action: false,
    });
  });

  it('builds confirmation summary by status, priority, and action type', () => {
    const candidates = [
      projectReviewQueueCandidateToHumanConfirmationCandidate(
        buildHumanConfirmationSourceCandidateFixtureV1(1, { priority_band: 'high' }),
        0,
      ),
      projectReviewQueueCandidateToHumanConfirmationCandidate(
        buildHumanConfirmationSourceCandidateFixtureV1(2, { review_status: 'blocked', priority_band: 'low' }),
        1,
      ),
    ];
    const summary = buildHumanConfirmationContractSummary(candidates);

    expect(summary).toEqual({
      kind: 'HUMAN_CONFIRMATION_CONTRACT_SUMMARY',
      version: 'v1',
      total: 2,
      awaiting_human_confirmation: 1,
      blocked: 1,
      high_priority: 1,
      by_action_type: {
        CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
        CONFIRM_REVIEW_EVIDENCE_GAP: 1,
      },
      by_confirmation_status: {
        awaiting_human_confirmation: 1,
        blocked: 1,
      },
    });
  });

  it.each([
    ['invalid_source_result_kind', { kind: 'NOT_REVIEW_QUEUE_RESULT' }],
    ['source_answer_missing', { answer: null }],
    ['source_queue_blocked', { answer: { queue_blocked: true } }],
    ['source_candidates_empty', { answer: { candidates: [], candidates_count: 0 } }],
    ['illegal_source_executes_queue_items', { answer: { executes_queue_items: true } }],
    ['illegal_source_executable', { answer: { executable: true } }],
    ['illegal_source_human_confirmed', { answer: { human_confirmed: true } }],
    ['illegal_source_reads_database', { answer: { safety: { reads_database: true } } }],
    ['illegal_source_writes_database', { answer: { safety: { writes_database: true } } }],
    ['illegal_candidate_executable', {
      answer: { candidates: [buildHumanConfirmationSourceCandidateFixtureV1(1, { executable: true })] },
    }],
    ['illegal_candidate_human_confirmed', {
      answer: { candidates: [buildHumanConfirmationSourceCandidateFixtureV1(1, { human_confirmed: true })] },
    }],
    ['illegal_candidate_confirmed', {
      answer: { candidates: [withAliasState(buildHumanConfirmationSourceCandidateFixtureV1(1), 'confirmed')] },
    }],
    ['illegal_candidate_approved', {
      answer: { candidates: [withAliasState(buildHumanConfirmationSourceCandidateFixtureV1(1), 'approved')] },
    }],
    ['illegal_candidate_represents_executed_action', {
      answer: {
        candidates: [buildHumanConfirmationSourceCandidateFixtureV1(1, { represents_executed_action: true })],
      },
    }],
    ['illegal_candidate_writes_database', {
      answer: { candidates: [buildHumanConfirmationSourceCandidateFixtureV1(1, { writes_database: true })] },
    }],
  ] satisfies [HumanConfirmationContractBlockedReason, Parameters<typeof buildHumanConfirmationContractRequestFixtureV1>[0]][])(
    'blocks unsafe review queue source: %s',
    (expectedReason, override) => {
      const plan = buildHumanConfirmationContractPlan(buildHumanConfirmationContractRequestFixtureV1(override));
      const result = runHumanConfirmationContract(plan);

      expect(validateHumanConfirmationContractInput(plan.request.source_review_queue_result)).toEqual({
        ok: false,
        blocked_reason: expectedReason,
      });
      expect(result).toMatchObject({
        persisted: false,
        represents_executed_action: false,
        answer: {
          contract_blocked: true,
          blocked_reason: expectedReason,
          candidates: [],
          candidates_count: 0,
          generated_confirmation_contract_candidates: false,
          executes_confirmation: false,
          represents_executed_action: false,
          summary: {
            total: 0,
            awaiting_human_confirmation: 0,
            blocked: 0,
            high_priority: 0,
            by_action_type: {},
            by_confirmation_status: {},
          },
        },
      });
    },
  );

  it('is deterministic and avoids clock or random identifiers', () => {
    const plan = buildHumanConfirmationContractPlan(buildHumanConfirmationContractRequestFixtureV1());
    const first = runHumanConfirmationContract(plan);
    const second = runHumanConfirmationContract(plan);

    expect(first).toEqual(second);
    expect(first.answer.candidates.map(candidate => candidate.confirmation_candidate_id)).toEqual([
      'HUMAN_CONFIRM_LIVE_001',
      'HUMAN_CONFIRM_LIVE_002',
    ]);

    const source = readFileSync('src/lib/humanConfirmationContractReadiness.ts', 'utf8');
    for (const term of ['Date.now', 'Math.random', 'randomUUID']) {
      expect(source).not.toContain(term);
    }
  });

  it('preserves source reference and does not mutate review queue result or candidates', () => {
    const request = buildHumanConfirmationContractRequestFixtureV1();
    const source = request.source_review_queue_result;
    const before = JSON.stringify(source);
    const result = runHumanConfirmationContract(buildHumanConfirmationContractPlan(request));

    expect(result.answer.source_review_queue_result).toBe(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.answer.candidates[0].evidence_refs).toBe(source.answer.candidates[0].evidence_refs);
    expect(result.answer.candidates[0].risk_flags).toBe(source.answer.candidates[0].risk_flags);
    expect(result.answer.candidates[0].preconditions).toBe(source.answer.candidates[0].preconditions);
  });

  it('builds a trace around confirmation contract projection only', () => {
    const trace = buildHumanConfirmationContractTrace(buildHumanConfirmationContractPlan(
      buildHumanConfirmationContractRequestFixtureV1(),
    ));

    expect(trace).toMatchObject({
      kind: 'HUMAN_CONFIRMATION_CONTRACT_TRACE',
      persisted: false,
      result: {
        kind: 'HUMAN_CONFIRMATION_CONTRACT_RESULT',
        persisted: false,
        answer: {
          generated_confirmation_contract_candidates: true,
          executes_confirmation: false,
          contract_blocked: false,
        },
      },
    });
  });

  it('keeps production free of upstream calls, storage access, UI hooks, runtime hooks, and execution hooks', () => {
    const productionSource = readFileSync('src/lib/humanConfirmationContractReadiness.ts', 'utf8');
    const forbiddenTerms = [
      'runConfirmedActionReviewQueue',
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
      'fixture_only: true',
    ];
    const activeTrueStateLiterals = [
      'executable: true',
      'human_confirmed: true',
      'confirmed: true',
      'approved: true',
      'persisted: true',
      'writes_database: true',
      'reads_database: true',
      'represents_executed_action: true',
      'executes_confirmation: true',
    ];

    for (const term of [...forbiddenTerms, ...activeTrueStateLiterals]) {
      expect(productionSource).not.toContain(term);
    }
  });

  it('keeps fixture output free of active true states and fixture-only operator identity', () => {
    const request = buildHumanConfirmationContractRequestFixtureV1();
    const result = runHumanConfirmationContract(buildHumanConfirmationContractPlan(request));

    expect(findActiveTrueStates(request)).toEqual([]);
    expect(findActiveTrueStates(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('"fixture_only":true');
    expect(JSON.stringify(result)).not.toContain('"fixture_only": true');
  });

  it('keeps fixture file free of upstream runner calls', () => {
    const fixtureSource = readFileSync(
      'src/lib/humanConfirmationContract/humanConfirmationContractFixturesV1.ts',
      'utf8',
    );
    const forbiddenTerms = [
      'runConfirmedActionReviewQueue',
      'runConfirmedActionLiveDryRun',
      'runSuggestOnlyLiveDryRun',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'proposeFromReadOnlyAnswer',
    ];

    for (const term of forbiddenTerms) {
      expect(fixtureSource).not.toContain(term);
    }
  });

  it('does not modify files outside the Loop 36 allowed change set', () => {
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

function withAliasState(
  candidate: ReturnType<typeof buildHumanConfirmationSourceCandidateFixtureV1>,
  key: 'confirmed' | 'approved',
) {
  return {
    ...candidate,
    [key]: true,
  } as unknown as ReturnType<typeof buildHumanConfirmationSourceCandidateFixtureV1>;
}
