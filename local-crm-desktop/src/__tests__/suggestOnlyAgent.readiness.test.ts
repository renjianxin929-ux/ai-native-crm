import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import {
  buildSuggestOnlyAgentPlan,
  buildSuggestOnlyAgentTrace,
  proposeFromReadOnlyFindings,
  type SuggestOnlyAgentProposal,
  type SuggestOnlyAgentProposalType,
} from '../lib/suggestOnlyAgentReadiness';
import { buildSuggestOnlyAgentRequestFixtureV1 } from '../lib/suggestOnlyAgent/suggestOnlyAgentFixturesV1';

const PROPOSAL_TYPES: SuggestOnlyAgentProposalType[] = [
  'REVIEW_CUSTOMER_PRIORITY',
  'REVIEW_GRADE_CHANGE',
  'REVIEW_SYNC_FAILURE',
  'REVIEW_FOLLOW_UP_TASK',
  'REVIEW_EVIDENCE_GAP',
  'REVIEW_STUCK_WORK_ITEM',
  'REVIEW_NEXT_BEST_ACTION',
];

const FORBIDDEN_ACTION_CODES = [
  'CREATE_CUSTOMER',
  'UPDATE_CUSTOMER',
  'UPDATE_GRADE',
  'CREATE_TASK',
  'UPDATE_WORK_ITEM',
  'SYNC_LEAD',
  'SEND_MESSAGE',
  'EXECUTE',
];

const FORBIDDEN_RESULT_PHRASES = [
  '已发送',
  '已执行',
  '已更新客户',
  '已创建客户',
  '已同步',
  '已写入 CRM',
  '自动创建客户',
  '自动升级等级',
];

describe('Suggest-only Agent readiness gate', () => {
  it('builds a non-executable, non-persisted plan with a strict proposal boundary', () => {
    const plan = buildSuggestOnlyAgentPlan(buildSuggestOnlyAgentRequestFixtureV1());

    expect(plan).toMatchObject({
      kind: 'SUGGEST_ONLY_AGENT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'suggest_only_agent_readiness_only',
      allowed_operations: ['read_findings', 'emit_proposals'],
      safety: {
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        requires_confirmation_for_all_proposals: true,
        represents_true_agent: false,
        represents_confirmed_action_agent: false,
        represents_executed_action: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'write_db',
      'sync',
      'update_status',
      'create_customer',
      'update_customer',
      'update_grade',
      'create_task',
      'call_provider',
      'send_message',
      'execute_proposal',
      'persist_proposal',
    ]));
    expect(plan.safety.forbidden_proposal_phrases).toEqual(expect.arrayContaining(FORBIDDEN_RESULT_PHRASES));
  });

  it('maps read-only findings into all seven proposal types', () => {
    const plan = buildSuggestOnlyAgentPlan(buildSuggestOnlyAgentRequestFixtureV1());
    const proposals = proposeFromReadOnlyFindings(plan);

    expect(new Set(proposals.map(proposal => proposal.proposal_type))).toEqual(new Set(PROPOSAL_TYPES));
    for (const proposal of proposals) {
      expectValidProposal(proposal);
    }
  });

  it('keeps evidence gaps low-confidence and read-only', () => {
    const plan = buildSuggestOnlyAgentPlan(buildSuggestOnlyAgentRequestFixtureV1());
    const proposals = proposeFromReadOnlyFindings(plan);
    const gap = proposals.find(proposal => proposal.proposal_type === 'REVIEW_EVIDENCE_GAP');

    expect(gap).toBeDefined();
    expect(gap?.evidence_refs).toEqual([]);
    expect(gap?.risk_flags).toContain('insufficient_evidence');
    expect(gap?.confidence_level).toBe('low');
    expect(gap?.summary).toContain('evidence review required');
  });

  it('builds a suggest-only answer and trace without claiming execution', () => {
    const plan = buildSuggestOnlyAgentPlan(buildSuggestOnlyAgentRequestFixtureV1());
    const trace = buildSuggestOnlyAgentTrace(plan);

    expect(trace).toMatchObject({
      kind: 'SUGGEST_ONLY_AGENT_TRACE',
      persisted: false,
      answer: {
        kind: 'SUGGEST_ONLY_AGENT_ANSWER',
        represents_executed_action: false,
        safety: {
          requires_confirmation_for_all_proposals: true,
        },
      },
    });
    expect(trace.answer.proposals.length).toBeGreaterThan(0);
    expect(trace.answer.suggest_only_summary).not.toMatch(forbiddenResultPattern());
    for (const proposal of trace.answer.proposals) {
      expectValidProposal(proposal);
    }
  });

  it('ships a synthetic fixture request with safe entity prefixes and all proposal scenarios', () => {
    const request = buildSuggestOnlyAgentRequestFixtureV1();
    const serialized = JSON.stringify(request);

    expect(request.synthetic).toBe(true);
    expect(request.fixture_only).toBe(true);
    expect(serialized).toMatch(/READONLY_EVAL_|SUGGEST_EVAL_|EVAL_/);
    expect(serialized).not.toMatch(/\b1[3-9]\d{9}\b/);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(serialized).not.toMatch(/\bwxid_[A-Za-z0-9_-]{6,}\b/);
    expect(serialized).not.toMatch(/真实/);

    const plan = buildSuggestOnlyAgentPlan(request);
    const proposals = proposeFromReadOnlyFindings(plan);
    expect(new Set(proposals.map(proposal => proposal.proposal_type))).toEqual(new Set(PROPOSAL_TYPES));
  });

  it('keeps suggest-only source free of DB, provider, runtime, UI, and execution hooks', () => {
    const source = [
      readFileSync('src/lib/suggestOnlyAgentReadiness.ts', 'utf8'),
      readFileSync('src/lib/suggestOnlyAgent/suggestOnlyAgentFixturesV1.ts', 'utf8'),
    ].join('\n');
    const forbiddenTerms = [
      'getDb',
      'INSERT',
      'UPDATE',
      'DELETE',
      'createCustomer',
      'updateCustomer',
      'insertCustomer',
      'updateGrade',
      'createTask',
      'syncCollectedLead',
      'updateLeadWorkItemStatus',
      'executeLeadImport',
      'insertLeadWorkItem',
      'answerReadOnlyAgentQuery',
      'buildReadOnlyAgentPlan',
      'buildPromptRuntimePlan',
      'invokeWithFixtureAdapter',
      'runEvalDatasetV1',
      'fetch(',
      'axios',
      'process.env',
      'import.meta.env',
      'API_KEY',
      'apiKey',
      'localStorage',
      'AISettingsPage',
      'textAIProvider',
      'multimodalProvider',
      'aiDraft',
      'analyzeWechatScreenshot',
      'analyzeCallTranscript',
      'OpenAI',
      'DeepSeek',
      'Qwen',
      'Claude',
      'Gemini',
      'Ollama',
      'tool_call',
      'executeAction',
      'executeTool',
      'executeProposal',
      'confirmProposal',
      'sendMessage',
      'voice',
      ...FORBIDDEN_RESULT_PHRASES,
      'requires_confirmation: false',
      'executable: true',
      'represents_executed_action: true',
      'writes_database: true',
      'no_provider_calls: false',
      'no_network: false',
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
    if (hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles)) return;
    const forbiddenFiles = [
      'src/lib/readOnlyAgent/readOnlyAgentFixturesV1.ts',
      'src/lib/promptRuntimeReadiness.ts',
      'src/lib/modelRouterRuntimeReadiness.ts',
      'src/lib/modelRouterRuntime/modelInvocationFixturesV1.ts',
      'src/lib/aiRuntimeReadiness.ts',
      'src/lib/evalRunnerReadiness.ts',
      'src/lib/evalDatasetReadiness.ts',
      'src/lib/evalDataset/salesAiEvalDatasetV1.ts',
      'src/lib/evalDataset/evalCandidateFixturesV1.ts',
      'src/lib/aiDraft.ts',
      'src/lib/textAIProvider.ts',
      'src/lib/multimodalProvider.ts',
      'src/lib/db.ts',
    ];

    expect(changedFiles.filter(file => forbiddenFiles.includes(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/') && file !== 'src-tauri/src/lib.rs')).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
  });
});

function expectValidProposal(proposal: SuggestOnlyAgentProposal) {
  expect(proposal.kind).toBe('SUGGEST_ONLY_AGENT_PROPOSAL');
  expect(proposal.proposal_id).toMatch(/^SUGGEST_EVAL_/);
  expect(PROPOSAL_TYPES).toContain(proposal.proposal_type);
  expect(proposal.title.trim().length).toBeGreaterThan(0);
  expect(proposal.summary.trim().length).toBeGreaterThan(0);
  expect(proposal.recommended_action_label.trim().length).toBeGreaterThan(0);
  if (proposal.proposal_type === 'REVIEW_EVIDENCE_GAP') {
    expect(proposal.evidence_refs).toEqual([]);
  } else {
    expect(proposal.evidence_refs.length).toBeGreaterThan(0);
  }
  expect(proposal.risk_flags.length).toBeGreaterThan(0);
  expect(proposal.risk_flags).toContain('fixture_only_signal');
  expect(proposal.requires_confirmation).toBe(true);
  expect(proposal.executable).toBe(false);
  expect(proposal.persisted).toBe(false);
  expect(proposal.represents_executed_action).toBe(false);
  expect(proposal.forbidden_without_confirmation).toBe(true);
  expect(proposal.source_finding_intent.trim().length).toBeGreaterThan(0);
  expect(proposal.summary).not.toMatch(forbiddenResultPattern());
  expect(proposal.recommended_action_label).not.toMatch(new RegExp(FORBIDDEN_ACTION_CODES.join('|')));
}

function forbiddenResultPattern() {
  return new RegExp(FORBIDDEN_RESULT_PHRASES.join('|'));
}
