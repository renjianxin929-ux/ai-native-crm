import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildSuggestOnlyLiveDryRunPlan,
  buildSuggestOnlyLiveDryRunTrace,
  runSuggestOnlyLiveDryRun,
  validateLiveDryRunInput,
} from '../lib/suggestOnlyLiveDryRunReadiness';
import {
  buildSuggestOnlyLiveDryRunRequestFixtureV1,
} from '../lib/suggestOnlyLiveDryRun/suggestOnlyLiveDryRunFixturesV1';
import {
  buildSuggestOnlyAgentPlan,
  proposeFromReadOnlyAnswer,
  proposeFromReadOnlyFindings,
  type SuggestOnlyAgentProposal,
} from '../lib/suggestOnlyAgentReadiness';
import { buildSuggestOnlyAgentRequestFixtureV1 } from '../lib/suggestOnlyAgent/suggestOnlyAgentFixturesV1';

describe('Suggest-only live dry-run readiness gate', () => {
  it('exports a narrow SuggestOnlyAgent API and keeps the fixture request boundary unchanged', () => {
    const request = buildSuggestOnlyAgentRequestFixtureV1();
    const plan = buildSuggestOnlyAgentPlan(request);

    expect(request.synthetic).toBe(true);
    expect(request.fixture_only).toBe(true);
    expect(proposeFromReadOnlyFindings(plan)).toEqual(proposeFromReadOnlyAnswer(request.read_only_answer));
    expect(buildSuggestOnlyAgentPlan(request)).toMatchObject({
      kind: 'SUGGEST_ONLY_AGENT_PLAN',
      allowed_operations: ['read_findings', 'emit_proposals'],
      safety: {
        writes_database: false,
        no_provider_calls: true,
        no_network: true,
        represents_executed_action: false,
      },
    });
  });

  it('builds a non-executable live dry-run plan with strict safety and operations', () => {
    const plan = buildSuggestOnlyLiveDryRunPlan(buildSuggestOnlyLiveDryRunRequestFixtureV1());

    expect(plan).toMatchObject({
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'suggest_only_live_dry_run_readiness_only',
      allowed_operations: ['validate_live_dry_run_input', 'emit_review_proposals'],
      safety: {
        reads_database: false,
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        executable: false,
        persisted: false,
        dry_run_only: true,
        represents_executed_action: false,
        represents_confirmed_action_agent: false,
        generated_envelopes: false,
        invokes_suggest_only_agent: false,
        generated_proposals: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'read_db',
      'write_db',
      'rerun_read_only_agent',
      'load_snapshot',
      'generate_envelopes',
      'execute_proposal',
      'call_provider',
      'persist_proposal',
    ]));
  });

  it('validates clean caller-provided read-only live dry-run input', () => {
    const request = buildSuggestOnlyLiveDryRunRequestFixtureV1();
    const validation = validateLiveDryRunInput(request.source_live_dry_run_result);

    expect(validation).toEqual({ ok: true, blocked_reason: null });
  });

  it.each([
    ['read_only_dry_run_blocked', { answer: { dry_run_blocked: true } }],
    ['read_only_answer_missing', { answer: { read_only_answer: null } }],
    ['illegal_source_generated_proposals', { answer: { generated_proposals: true } }],
    ['illegal_source_generated_envelopes', { answer: { generated_envelopes: true } }],
    ['illegal_source_executed_action', { answer: { represents_executed_action: true } }],
    ['illegal_source_reads_database', { answer: { safety: { reads_database: true } } }],
    ['illegal_source_writes_database', { answer: { safety: { writes_database: true } } }],
    ['illegal_source_not_loaded_snapshot', { answer: { source_is_loaded_snapshot: false } }],
    ['adapter_adaptation_blocked', { answer: { adapter_result: { adaptation_blocked: true } } }],
    ['adapter_pii_check_failed', { answer: { adapter_result: { pii_check: { passed: false } } } }],
  ])('blocks unsafe source result: %s', (expectedReason, override) => {
    const plan = buildSuggestOnlyLiveDryRunPlan(buildSuggestOnlyLiveDryRunRequestFixtureV1(override));
    const result = runSuggestOnlyLiveDryRun(plan);

    expect(validateLiveDryRunInput(plan.request.source_live_dry_run_result)).toEqual({
      ok: false,
      blocked_reason: expectedReason,
    });
    expect(result.answer).toMatchObject({
      suggest_only_answer: null,
      proposals_count: 0,
      dry_run_blocked: true,
      blocked_reason: expectedReason,
      invokes_suggest_only_agent: false,
      generated_proposals: false,
      generated_envelopes: false,
      represents_executed_action: false,
    });
  });

  it('runs clean caller-provided read-only answer into live review proposals', () => {
    const plan = buildSuggestOnlyLiveDryRunPlan(buildSuggestOnlyLiveDryRunRequestFixtureV1());
    const result = runSuggestOnlyLiveDryRun(plan);

    expect(result).toMatchObject({
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_RESULT',
      version: 'v1',
      persisted: false,
      represents_executed_action: false,
      answer: {
        kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_ANSWER',
        version: 'v1',
        dry_run_only: true,
        source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
        source_snapshot_id: 'SUGGEST_LIVE_TEST_SNAPSHOT_A',
        source_is_loaded_snapshot: true,
        load_source: 'sqlite_read_only',
        read_only_answer_metadata: {
          intent: 'evidence_for_customer',
          version: 'v1',
          findings_count: 1,
        },
        dry_run_blocked: false,
        blocked_reason: null,
        invokes_suggest_only_agent: true,
        generated_envelopes: false,
        represents_executed_action: false,
      },
    });
    expect(result.answer.source_live_dry_run_result).toBe(plan.request.source_live_dry_run_result);
    expect(result.answer.suggest_only_answer).not.toBeNull();
    expect(result.answer.proposals_count).toBe(result.answer.suggest_only_answer?.proposals.length);
    expect(result.answer.generated_proposals).toBe(result.answer.proposals_count > 0);
    expect(result.answer.suggest_only_answer?.suggest_only_summary).toContain('live dry-run');
    expect(result.answer.suggest_only_answer?.suggest_only_summary).toContain('confirmation is required');
    for (const proposal of result.answer.suggest_only_answer?.proposals ?? []) {
      expectValidLiveProposal(proposal);
    }
  });

  it('builds a trace around the caller-provided source result without persistence', () => {
    const trace = buildSuggestOnlyLiveDryRunTrace(buildSuggestOnlyLiveDryRunPlan(
      buildSuggestOnlyLiveDryRunRequestFixtureV1(),
    ));

    expect(trace).toMatchObject({
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_TRACE',
      persisted: false,
      result: {
        persisted: false,
        answer: {
          dry_run_only: true,
          generated_envelopes: false,
          represents_executed_action: false,
        },
      },
    });
  });

  it('keeps suggest-only live dry-run source free of DB, upstream calls, providers, envelopes, and execution hooks', () => {
    const source = [
      readFileSync('src/lib/suggestOnlyLiveDryRunReadiness.ts', 'utf8'),
      readFileSync('src/lib/suggestOnlyLiveDryRun/suggestOnlyLiveDryRunFixturesV1.ts', 'utf8'),
    ].join('\n');
    const productionSource = readFileSync('src/lib/suggestOnlyLiveDryRunReadiness.ts', 'utf8');
    const forbiddenProductionTerms = [
      'getDb',
      'select(',
      'db.select',
      'execute(',
      'INSERT',
      'UPDATE',
      'DELETE',
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'runReadOnlyAgentLiveDryRun',
      'buildReadOnlyAgentLiveDryRunPlan',
      'loadReadOnlySnapshotFromDb',
      'adaptLoadedSnapshot',
      'answerReadOnlyAgentQuery',
      'answerReadOnlyAgentQueryForCollections',
      'envelopeFromProposals',
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
      'confirmAndExecute',
      'sendMessage',
      'voice',
      '已发送',
      '已执行',
      '已更新客户',
      '已创建客户',
      '已同步',
      '已写入 CRM',
      'generated_envelopes: true',
      'represents_executed_action: true',
      'writes_database: true',
      'reads_database: true',
      'CONFIRMED_ACTION',
      'ConfirmedActionEnvelope',
    ];
    const forbiddenAllTerms = [
      'envelopeFromProposals',
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
      'confirmAndExecute',
      'sendMessage',
      'voice',
      '已发送',
      '已执行',
      '已更新客户',
      '已创建客户',
      '已同步',
      '已写入 CRM',
      'generated_envelopes: true',
      'represents_executed_action: true',
      'writes_database: true',
      'reads_database: true',
      'CONFIRMED_ACTION',
      'ConfirmedActionEnvelope',
    ];

    for (const term of forbiddenProductionTerms) {
      expect(productionSource).not.toContain(term);
    }
    for (const term of forbiddenAllTerms) {
      expect(source).not.toContain(term);
    }
  });
});

function expectValidLiveProposal(proposal: SuggestOnlyAgentProposal) {
  expect(proposal.kind).toBe('SUGGEST_ONLY_AGENT_PROPOSAL');
  expect(proposal.proposal_id).toMatch(/^SUGGEST_LIVE_/);
  expect(proposal.proposal_id).not.toMatch(/^SUGGEST_EVAL_/);
  expect(proposal.proposal_type).toMatch(/^REVIEW_/);
  expect(proposal.requires_confirmation).toBe(true);
  expect(proposal.executable).toBe(false);
  expect(proposal.persisted).toBe(false);
  expect(proposal.represents_executed_action).toBe(false);
  expect(proposal.forbidden_without_confirmation).toBe(true);
  expect(proposal.risk_flags.length).toBeGreaterThan(0);
  if (proposal.proposal_type === 'REVIEW_EVIDENCE_GAP') {
    expect(proposal.evidence_refs).toEqual([]);
  } else {
    expect(proposal.evidence_refs.length).toBeGreaterThan(0);
  }
  for (const ref of proposal.evidence_refs) {
    expect(ref.synthetic).toBe(true);
    expect(ref.persisted).toBe(false);
    expect(ref.represents_real_model_output).toBe(false);
  }
  expect(proposal).not.toHaveProperty('envelope');
}
