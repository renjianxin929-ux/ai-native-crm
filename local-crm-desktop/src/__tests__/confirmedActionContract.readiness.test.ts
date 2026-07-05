import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildConfirmedActionPlan,
  buildConfirmedActionTrace,
  envelopeFromProposals,
  type ConfirmedActionEnvelope,
  type ConfirmedActionPreconditionName,
  type ConfirmedActionType,
} from '../lib/confirmedActionContractReadiness';
import { buildConfirmedActionRequestFixtureV1 } from '../lib/confirmedActionContract/confirmedActionContractFixturesV1';

const ACTION_TYPES: ConfirmedActionType[] = [
  'CONFIRM_REVIEW_CUSTOMER_PRIORITY',
  'CONFIRM_REVIEW_GRADE_CHANGE',
  'CONFIRM_REVIEW_SYNC_FAILURE',
  'CONFIRM_REVIEW_FOLLOW_UP_TASK',
  'CONFIRM_REVIEW_EVIDENCE_GAP',
  'CONFIRM_REVIEW_STUCK_WORK_ITEM',
  'CONFIRM_REVIEW_NEXT_BEST_ACTION',
];

const PRECONDITIONS: ConfirmedActionPreconditionName[] = [
  'requires_human_confirmation',
  'requires_non_empty_evidence',
  'requires_risk_acknowledgement',
  'requires_no_fake_execution_phrase',
  'requires_no_executable_action_code',
  'requires_no_db_write',
  'requires_no_provider_call',
];

const FORBIDDEN_OPERATIONS = [
  ['write', '_db'].join(''),
  ['read', '_db'].join(''),
  'sync',
  'update_status',
  'create_customer',
  'update_customer',
  'update_grade',
  'create_task',
  'call_provider',
  'send_message',
  'execute_action',
  'execute_proposal',
  'confirm_and_execute',
  'persist_envelope',
];

const FORBIDDEN_PAYLOAD_TERMS = [
  ['SEL', 'ECT'].join(''),
  ['INS', 'ERT'].join(''),
  ['UPD', 'ATE'].join(''),
  ['DEL', 'ETE'].join(''),
  ['Lead', 'Sync', 'Action'].join(''),
  ['Customer', 'Input'].join(''),
  ['Customer', 'Enrichment', 'Patch'].join(''),
  ['Lead', 'Workbench', 'Customer', 'Input'].join(''),
  ['sync', 'Collected', 'Lead'].join(''),
  ['insert', 'Customer'].join(''),
  ['update', 'Customer'].join(''),
];

const FORBIDDEN_ACTION_CODES = [
  ['CREATE', '_CUSTOMER'].join(''),
  ['UPD', 'ATE', '_CUSTOMER'].join(''),
  ['UPD', 'ATE', '_GRADE'].join(''),
  ['CREATE', '_TASK'].join(''),
  ['UPD', 'ATE', '_WORK_ITEM'].join(''),
  ['SYNC', '_LEAD'].join(''),
  ['SEND', '_MESSAGE'].join(''),
  ['EXE', 'CUTE'].join(''),
];

const FORBIDDEN_RESULT_PHRASES = [
  ['已', '发送'].join(''),
  ['已', '执行'].join(''),
  ['已更新', '客户'].join(''),
  ['已创建', '客户'].join(''),
  ['已', '同步'].join(''),
  ['已写入', ' CRM'].join(''),
];

describe('Confirmed Action Contract readiness gate', () => {
  it('builds a non-executable, non-persisted plan with a strict dry-run boundary', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());

    expect(plan).toMatchObject({
      kind: 'CONFIRMED_ACTION_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'confirmed_action_contract_readiness_only',
      allowed_operations: ['read_proposals', 'emit_dry_run_envelopes'],
      safety: {
        writes_database: false,
        reads_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        dry_run_only: true,
        represents_true_agent: false,
        represents_confirmed_action_agent: false,
        represents_executed_action: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining(FORBIDDEN_OPERATIONS));
    expect(plan.safety.forbidden_envelope_phrases).toEqual(expect.arrayContaining(FORBIDDEN_RESULT_PHRASES));
  });

  it('maps all seven proposal types into dry-run envelopes', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());
    const envelopes = envelopeFromProposals(plan);

    expect(new Set(envelopes.map(envelope => envelope.action_type))).toEqual(new Set(ACTION_TYPES));
    expect(envelopes.length).toBe(plan.request.suggest_only_answer.proposals.length);
    for (const envelope of envelopes) {
      expectValidEnvelope(envelope);
      const source = plan.request.suggest_only_answer.proposals.find(
        proposal => proposal.proposal_id === envelope.source_proposal_id,
      );
      expect(source).toBeDefined();
      expect(envelope.evidence_refs).toEqual(source?.evidence_refs);
      expect(envelope.risk_flags).toEqual(source?.risk_flags);
    }
  });

  it('blocks evidence-gap envelopes while keeping them dry-run only', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());
    const gap = envelopeFromProposals(plan).find(
      envelope => envelope.action_type === 'CONFIRM_REVIEW_EVIDENCE_GAP',
    );

    expect(gap).toBeDefined();
    expect(gap?.blocked_reason?.trim()).toBeTruthy();
    expect(gap?.preconditions.find(item => item.name === 'requires_non_empty_evidence')).toMatchObject({
      satisfied: false,
      blocking: true,
    });
    expect(gap?.dry_run.future_human_guidance.join(' ')).toMatch(/collect|evidence|补充|证据/i);
    expect(gap?.dry_run.explicit_non_actions).toContain('Does not create customer');
    expect(gap?.executable).toBe(false);
    expect(gap?.dry_run_only).toBe(true);
  });

  it('keeps human confirmation unrecorded and never turns that into execution', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());
    const envelopes = envelopeFromProposals(plan);

    for (const envelope of envelopes) {
      expect(envelope.human_confirmed).toBe(false);
      expect(envelope.executable).toBe(false);
      expect(envelope.preconditions.find(item => item.name === 'requires_human_confirmation')).toMatchObject({
        satisfied: false,
        required: true,
        blocking: false,
        message: 'Human confirmation not recorded in contract readiness',
      });
    }
  });

  it('requires human risk acknowledgement for high-risk proposals without executing them', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());
    const highRisk = envelopeFromProposals(plan).filter(envelope => (
      envelope.risk_flags.some(flag => [
        'sync_failed',
        'grade_upgrade_requires_review',
        'customer_creation_requires_review',
        'message_send_requires_review',
      ].includes(flag))
    ));

    expect(highRisk.length).toBeGreaterThan(0);
    for (const envelope of highRisk) {
      expect(envelope.preconditions.find(item => item.name === 'requires_risk_acknowledgement')).toMatchObject({
        satisfied: false,
        blocking: false,
      });
      expect(envelope.dry_run.future_human_guidance.join(' ')).toMatch(/risk|风险|confirm|确认/i);
      expect(envelope.executable).toBe(false);
    }
  });

  it('emits only text guidance and never business payloads in dry-runs', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());
    const serializedDryRuns = JSON.stringify(envelopeFromProposals(plan).map(envelope => envelope.dry_run));

    for (const term of [...FORBIDDEN_PAYLOAD_TERMS, ...FORBIDDEN_ACTION_CODES]) {
      expect(serializedDryRuns).not.toContain(term);
    }
    for (const dryRun of envelopeFromProposals(plan).map(envelope => envelope.dry_run)) {
      expect(dryRun).toMatchObject({
        dry_run_only: true,
        no_side_effects: true,
        writes_database: false,
        no_business_function_call: true,
        represents_executed_action: false,
      });
      expect(Array.isArray(dryRun.future_human_guidance)).toBe(true);
      expect(Array.isArray(dryRun.explicit_non_actions)).toBe(true);
      expect(Object.keys(dryRun).sort()).toEqual([
        'dry_run_only',
        'explicit_non_actions',
        'future_human_guidance',
        'no_business_function_call',
        'no_side_effects',
        'represents_executed_action',
        'writes_database',
      ]);
    }
  });

  it('builds a contract answer and trace without claiming agent or execution behavior', () => {
    const plan = buildConfirmedActionPlan(buildConfirmedActionRequestFixtureV1());
    const trace = buildConfirmedActionTrace(plan);

    expect(trace).toMatchObject({
      kind: 'CONFIRMED_ACTION_TRACE',
      persisted: false,
      answer: {
        kind: 'CONFIRMED_ACTION_ANSWER',
        represents_executed_action: false,
        represents_confirmed_action_agent: false,
      },
    });
    expect(trace.answer.envelopes).toHaveLength(plan.request.suggest_only_answer.proposals.length);
    expect(trace.answer.contract_summary).not.toMatch(forbiddenResultPattern());
  });

  it('ships a synthetic fixture request with safe prefixes and all action scenarios', () => {
    const request = buildConfirmedActionRequestFixtureV1();
    const serialized = JSON.stringify(request);
    const plan = buildConfirmedActionPlan(request);

    expect(request.synthetic).toBe(true);
    expect(request.fixture_only).toBe(true);
    expect(serialized).toMatch(/CONFIRM_EVAL_|SUGGEST_EVAL_|READONLY_EVAL_|EVAL_/);
    expect(serialized).not.toMatch(/\b1[3-9]\d{9}\b/);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(serialized).not.toMatch(/\bwxid_[A-Za-z0-9_-]{6,}\b/);
    expect(serialized).not.toMatch(/真实/);
    expect(new Set(envelopeFromProposals(plan).map(envelope => envelope.action_type))).toEqual(new Set(ACTION_TYPES));
  });

  it('keeps confirmed action source free of DB, provider, runtime, UI, and execution hooks', () => {
    const source = [
      readFileSync('src/lib/confirmedActionContractReadiness.ts', 'utf8'),
      readFileSync('src/lib/confirmedActionContract/confirmedActionContractFixturesV1.ts', 'utf8'),
    ].join('\n');
    const forbiddenTerms = [
      ['get', 'Db'].join(''),
      ...FORBIDDEN_PAYLOAD_TERMS,
      ['create', 'Customer'].join(''),
      ['update', 'Customer'].join(''),
      ['insert', 'Customer'].join(''),
      ['update', 'Grade'].join(''),
      ['create', 'Task'].join(''),
      ['sync', 'Collected', 'Lead'].join(''),
      ['update', 'Lead', 'Work', 'Item', 'Status'].join(''),
      ['execute', 'Lead', 'Import'].join(''),
      ['insert', 'Lead', 'Work', 'Item'].join(''),
      ['propose', 'From', 'Read', 'Only', 'Findings'].join(''),
      ['answer', 'Read', 'Only', 'Agent', 'Query'].join(''),
      ['build', 'Prompt', 'Runtime', 'Plan'].join(''),
      ['invoke', 'With', 'Fixture', 'Adapter'].join(''),
      ['run', 'Eval', 'Dataset', 'V1'].join(''),
      ['fetch', '('].join(''),
      ['ax', 'ios'].join(''),
      ['process', '.', 'env'].join(''),
      ['import', '.', 'meta', '.', 'env'].join(''),
      ['API', '_KEY'].join(''),
      ['api', 'Key'].join(''),
      ['local', 'Storage'].join(''),
      ['AI', 'Settings', 'Page'].join(''),
      ['text', 'AI', 'Provider'].join(''),
      ['multimodal', 'Provider'].join(''),
      ['ai', 'Draft'].join(''),
      ['analyze', 'Wechat', 'Screenshot'].join(''),
      ['analyze', 'Call', 'Transcript'].join(''),
      ['Open', 'AI'].join(''),
      ['Deep', 'Seek'].join(''),
      ['Qw', 'en'].join(''),
      ['Cla', 'ude'].join(''),
      ['Gem', 'ini'].join(''),
      ['Oll', 'ama'].join(''),
      ['tool', '_call'].join(''),
      ['execute', 'Action'].join(''),
      ['execute', 'Tool'].join(''),
      ['execute', 'Proposal'].join(''),
      ['confirm', 'Proposal'].join(''),
      ['confirm', 'And', 'Execute'].join(''),
      ['send', 'Message'].join(''),
      ['voi', 'ce'].join(''),
      ...FORBIDDEN_RESULT_PHRASES,
      ['human_confirmed', ': true'].join(''),
      ['dry_run_only', ': false'].join(''),
      ['executable', ': true'].join(''),
      ['writes_database', ': true'].join(''),
      ['represents_executed_action', ': true'].join(''),
    ];

    for (const term of forbiddenTerms) {
      expect(source).not.toContain(term);
    }
  });

  it('does not modify existing runtime, eval, Workbench, database, schema, UI, provider, or Tauri files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean).map(file => file.replace(/^local-crm-desktop\//, ''));
    const forbiddenFiles = [
      'src/lib/suggestOnlyAgentReadiness.ts',
      'src/lib/suggestOnlyAgent/suggestOnlyAgentFixturesV1.ts',
      'src/lib/readOnlyAgentReadiness.ts',
      'src/lib/readOnlyAgent/readOnlyAgentFixturesV1.ts',
      'src/lib/promptRuntimeReadiness.ts',
      'src/lib/modelRouterRuntimeReadiness.ts',
      'src/lib/modelRouterRuntime/modelInvocationFixturesV1.ts',
      'src/lib/aiRuntimeReadiness.ts',
      'src/lib/evalRunnerReadiness.ts',
      'src/lib/evalDatasetReadiness.ts',
      'src/lib/evalDataset/salesAiEvalDatasetV1.ts',
      'src/lib/evalDataset/evalCandidateFixturesV1.ts',
      ['src/lib/ai', 'Draft.ts'].join(''),
      ['src/lib/text', 'AI', 'Provider.ts'].join(''),
      ['src/lib/multimodal', 'Provider.ts'].join(''),
      'src/lib/leadWorkbench/humanReviewReadiness.ts',
      'src/lib/db.ts',
    ];

    expect(changedFiles.filter(file => forbiddenFiles.includes(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
  });
});

function expectValidEnvelope(envelope: ConfirmedActionEnvelope) {
  expect(envelope.kind).toBe('CONFIRMED_ACTION_ENVELOPE');
  expect(envelope.version).toBe('v1');
  expect(envelope.action_id).toMatch(/^CONFIRM_EVAL_/);
  expect(ACTION_TYPES).toContain(envelope.action_type);
  expect(envelope.source_proposal_id.trim().length).toBeGreaterThan(0);
  expect(envelope.source_proposal_type.trim().length).toBeGreaterThan(0);
  expect(envelope.title.trim().length).toBeGreaterThan(0);
  expect(envelope.summary.trim().length).toBeGreaterThan(0);
  expect(envelope.confirmation_required).toBe(true);
  expect(envelope.human_confirmed).toBe(false);
  expect(envelope.dry_run_only).toBe(true);
  expect(envelope.executable).toBe(false);
  expect(envelope.persisted).toBe(false);
  expect(envelope.writes_database).toBe(false);
  expect(envelope.represents_executed_action).toBe(false);
  expect(envelope.preconditions.map(item => item.name).sort()).toEqual([...PRECONDITIONS].sort());
  expect(envelope.dry_run).toMatchObject({
    dry_run_only: true,
    no_side_effects: true,
    writes_database: false,
    no_business_function_call: true,
    represents_executed_action: false,
  });
  expect(envelope.summary).not.toMatch(forbiddenResultPattern());
  expect(envelope.title).not.toMatch(forbiddenResultPattern());
}

function forbiddenResultPattern() {
  return new RegExp(FORBIDDEN_RESULT_PHRASES.join('|'));
}
