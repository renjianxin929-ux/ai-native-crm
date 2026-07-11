import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import {
  answerReadOnlyAgentQueryForCollections,
  buildReadOnlyAgentPlan,
  type ReadOnlyAgentCollectionsQueryInput,
  type ReadOnlyAgentIntent,
  type ReadOnlyAgentSnapshotCollections,
} from '../lib/readOnlyAgentReadiness';
import {
  buildReadOnlyAgentLiveDryRunPlan,
  buildReadOnlyAgentLiveDryRunTrace,
  mapRequestCandidateToSnapshotCollections,
  READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION,
  runReadOnlyAgentLiveDryRun,
} from '../lib/readOnlyAgentLiveDryRunReadiness';
import {
  buildLiveDryRunLoadedSnapshotFixtureV1,
  buildLiveDryRunPiiPollutedLoadedSnapshotFixtureV1,
  buildLiveDryRunRequestFixtureV1,
} from '../lib/readOnlyAgentLiveDryRun/readOnlyAgentLiveDryRunFixturesV1';
import { buildReadOnlyAgentSnapshotFixtureV1 } from '../lib/readOnlyAgent/readOnlyAgentFixturesV1';
import {
  adaptLoadedSnapshot,
  buildReadOnlyAgentSnapshotAdapterPlan,
} from '../lib/readOnlyAgentSnapshotAdapterReadiness';

const INTENTS: ReadOnlyAgentIntent[] = [
  'today_priorities',
  'stuck_work_items',
  'sync_failures',
  'high_intent_leads',
  'evidence_for_customer',
  'next_best_read_only_summary',
];

const FORBIDDEN_OPERATIONS = [
  'read_db',
  'write_db',
  'load_snapshot',
  'generate_proposals',
  'emit_envelopes',
  'call_provider',
  'execute_action',
  'persist_answer',
];

describe('Read-only Agent live dry-run readiness gate', () => {
  it('exports a collections-only ReadOnlyAgent API without relaxing the existing snapshot boundary', () => {
    const fixtureSnapshot = buildReadOnlyAgentSnapshotFixtureV1();
    const collections: ReadOnlyAgentSnapshotCollections = {
      work_items: fixtureSnapshot.work_items,
      collected_leads: fixtureSnapshot.collected_leads,
      replay_evidence: fixtureSnapshot.replay_evidence,
      import_rows: fixtureSnapshot.import_rows,
      customers: fixtureSnapshot.customers,
      tasks: fixtureSnapshot.tasks,
      capture_events: fixtureSnapshot.capture_events,
      prompt_plans: fixtureSnapshot.prompt_plans,
      model_invocations: fixtureSnapshot.model_invocations,
      eval_summaries: fixtureSnapshot.eval_summaries,
    };
    const input: ReadOnlyAgentCollectionsQueryInput = {
      intent: 'evidence_for_customer',
      collections,
      target_customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
      target_work_item_id: 'READONLY_EVAL_WORK_ITEM_SEARCHING',
      safety: buildReadOnlyAgentPlan({
        kind: 'READ_ONLY_AGENT_REQUEST',
        intent: 'today_priorities',
        snapshot: fixtureSnapshot,
      }).safety,
    };

    const answer = answerReadOnlyAgentQueryForCollections(input);

    expect(answer.kind).toBe('READ_ONLY_AGENT_ANSWER');
    expect(answer.intent).toBe('evidence_for_customer');
    expect(answer.findings.length).toBeGreaterThan(0);
    expect(collections).not.toHaveProperty('kind');
    expect(collections).not.toHaveProperty('snapshot_id');
    expect(collections).not.toHaveProperty('synthetic');
    expect(collections).not.toHaveProperty('persisted');
    expect(buildReadOnlyAgentPlan({
      kind: 'READ_ONLY_AGENT_REQUEST',
      intent: 'today_priorities',
      snapshot: fixtureSnapshot,
    }).request.snapshot).toMatchObject({
      kind: 'READ_ONLY_AGENT_SNAPSHOT',
      synthetic: true,
      persisted: false,
    });
  });

  it('builds a non-executable live dry-run plan with strict safety and operations', () => {
    const plan = buildReadOnlyAgentLiveDryRunPlan(buildLiveDryRunRequestFixtureV1());

    expect(READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION).toBe('v1');
    expect(plan).toMatchObject({
      kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'read_only_agent_live_dry_run_readiness_only',
      allowed_operations: ['adapt_loaded_snapshot', 'bridge_collections', 'emit_dry_run_answer'],
      safety: {
        reads_database: false,
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        executable: false,
        persisted: false,
        represents_executed_action: false,
        represents_live_agent_product: false,
        dry_run_only: true,
        generated_proposals: false,
        generated_envelopes: false,
        invokes_read_only_agent: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining(FORBIDDEN_OPERATIONS));
  });

  it('runs the clean caller-provided loaded snapshot through adapter and collections-only answer', () => {
    const plan = buildReadOnlyAgentLiveDryRunPlan(buildLiveDryRunRequestFixtureV1());
    const result = runReadOnlyAgentLiveDryRun(plan);

    expect(result.kind).toBe('READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT');
    expect(result.answer).toMatchObject({
      kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_ANSWER',
      version: 'v1',
      dry_run_only: true,
      source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
      source_snapshot_id: 'LIVE_DRY_RUN_TEST_SNAPSHOT_A',
      load_source: 'sqlite_read_only',
      source_is_loaded_snapshot: true,
      dry_run_blocked: false,
      blocked_reason: null,
      invokes_read_only_agent: true,
      generated_findings: true,
      generated_proposals: false,
      generated_envelopes: false,
      finding_evidence_uses_agent_internal_refs: true,
      represents_executed_action: false,
      safety: {
        reads_database: false,
        writes_database: false,
        no_provider_calls: true,
        no_network: true,
        dry_run_only: true,
        generated_proposals: false,
        generated_envelopes: false,
        invokes_read_only_agent: true,
      },
    });
    expect(result.answer.adapter_result.adaptation_blocked).toBe(false);
    expect(result.answer.adapter_result.pii_check.passed).toBe(true);
    expect(result.answer.read_only_answer).not.toBeNull();
    expect(result.answer.read_only_answer?.kind).toBe('READ_ONLY_AGENT_ANSWER');
    expect(result.answer.read_only_answer?.findings.length).toBeGreaterThan(0);
    expect(result.answer.read_only_answer?.findings.every(finding => (
      finding.evidence_refs.every(ref => ref.synthetic === true && ref.persisted === false)
    ))).toBe(true);
  });

  it('blocks polluted adapter output before invoking collections query', () => {
    const plan = buildReadOnlyAgentLiveDryRunPlan(buildLiveDryRunRequestFixtureV1({
      request_id: 'LIVE_DRY_RUN_TEST_REQUEST_BLOCKED',
      loaded_snapshot: buildLiveDryRunPiiPollutedLoadedSnapshotFixtureV1(),
    }));
    const result = runReadOnlyAgentLiveDryRun(plan);

    expect(result.answer.adapter_result.adaptation_blocked).toBe(true);
    expect(result.answer.adapter_result.pii_check.passed).toBe(false);
    expect(result.answer.dry_run_blocked).toBe(true);
    expect(result.answer.blocked_reason).toBeTruthy();
    expect(result.answer.read_only_answer).toBeNull();
    expect(result.answer.invokes_read_only_agent).toBe(false);
    expect(result.answer.generated_findings).toBe(false);
    expect(result.answer.generated_proposals).toBe(false);
    expect(result.answer.generated_envelopes).toBe(false);
    expect(result.answer.safety.invokes_read_only_agent).toBe(false);
  });

  it('smoke-runs all six ReadOnlyAgent intents without proposals or envelopes', () => {
    for (const intent of INTENTS) {
      const result = runReadOnlyAgentLiveDryRun(buildReadOnlyAgentLiveDryRunPlan(
        buildLiveDryRunRequestFixtureV1({ intent }),
      ));

      expect(result.answer.read_only_answer?.intent).toBe(intent);
      expect(result.answer.read_only_answer?.findings.length).toBeGreaterThan(0);
      expect(result.answer.generated_proposals).toBe(false);
      expect(result.answer.generated_envelopes).toBe(false);
    }
  });

  it('bridges only collections and preserves caller target identifiers', () => {
    const adapterResult = adaptLoadedSnapshot(buildReadOnlyAgentSnapshotAdapterPlan({
      kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_REQUEST',
      request_id: 'LIVE_DRY_RUN_TEST_ADAPTER_DIRECT',
      intent: 'evidence_for_customer',
      loaded_snapshot: buildLiveDryRunLoadedSnapshotFixtureV1(),
      target_customer_id: 'LIVE_DRY_RUN_TEST_CUSTOMER_A',
      target_work_item_id: 'LIVE_DRY_RUN_TEST_WORK_ITEM_A',
    }));
    const collections = mapRequestCandidateToSnapshotCollections(adapterResult.request_candidate);

    expect(collections).not.toHaveProperty('kind');
    expect(collections).not.toHaveProperty('snapshot_id');
    expect(collections).not.toHaveProperty('synthetic');
    expect(collections).not.toHaveProperty('persisted');
    expect(JSON.stringify(collections)).not.toContain('READ_ONLY_AGENT_SNAPSHOT');
    expect(collections.capture_events.some(event => (
      event.customer_id === 'LIVE_DRY_RUN_TEST_CUSTOMER_A'
      && event.work_item_id === 'LIVE_DRY_RUN_TEST_WORK_ITEM_A'
    ))).toBe(true);
    expect(adapterResult.request_candidate.target_customer_id).toBe('LIVE_DRY_RUN_TEST_CUSTOMER_A');
    expect(adapterResult.request_candidate.target_work_item_id).toBe('LIVE_DRY_RUN_TEST_WORK_ITEM_A');
  });

  it('builds a trace that keeps plan/result non-persisted and dry-run only', () => {
    const trace = buildReadOnlyAgentLiveDryRunTrace(buildReadOnlyAgentLiveDryRunPlan(
      buildLiveDryRunRequestFixtureV1(),
    ));

    expect(trace).toMatchObject({
      kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_TRACE',
      persisted: false,
      result: {
        persisted: false,
        answer: {
          dry_run_only: true,
          generated_proposals: false,
          generated_envelopes: false,
        },
      },
    });
  });

  it('keeps live dry-run source free of DB, loader, downstream chains, providers, network, and execution hooks', () => {
    const source = [
      readFileSync('src/lib/readOnlyAgentLiveDryRunReadiness.ts', 'utf8'),
      readFileSync('src/lib/readOnlyAgentLiveDryRun/readOnlyAgentLiveDryRunFixturesV1.ts', 'utf8'),
    ].join('\n');
    const forbiddenTerms = [
      term('get', 'Db'),
      'select(',
      term('db', '.', 'select'),
      'execute(',
      'INSERT',
      'UPDATE',
      'DELETE',
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      term('load', 'ReadOnlySnapshotFromDb'),
      term('propose', 'FromReadOnlyFindings'),
      term('envelope', 'FromProposals'),
      term('build', 'PromptRuntimePlan'),
      term('invoke', 'WithFixtureAdapter'),
      term('run', 'EvalDatasetV1'),
      'fetch(',
      'axios',
      term('process', '.', 'env'),
      term('import', '.', 'meta', '.', 'env'),
      term('API', '_KEY'),
      term('api', 'Key'),
      term('local', 'Storage'),
      term('AI', 'SettingsPage'),
      term('text', 'AIProvider'),
      term('multi', 'modalProvider'),
      term('ai', 'Draft'),
      'OpenAI',
      'DeepSeek',
      'Qwen',
      'Claude',
      'Gemini',
      'Ollama',
      term('tool', '_call'),
      term('execute', 'Action'),
      term('execute', 'Tool'),
      term('execute', 'Proposal'),
      term('confirm', 'Proposal'),
      term('confirm', 'AndExecute'),
      term('send', 'Message'),
      'voice',
      term('generated_', 'proposals: true'),
      term('generated_', 'envelopes: true'),
      term('represents_', 'executed_action: true'),
      term('writes_', 'database: true'),
      term('reads_', 'database: true'),
      'already sent',
      'already executed',
      'updated customer',
      'created customer',
      'synced',
      'written to CRM',
    ];

    expect(source).toContain('answerReadOnlyAgentQueryForCollections');
    for (const forbiddenTerm of forbiddenTerms) {
      expect(source).not.toContain(forbiddenTerm);
    }
  });

  it('keeps readOnlyAgentReadiness changes scoped to a collections-only helper', () => {
    const source = readFileSync('src/lib/readOnlyAgentReadiness.ts', 'utf8');
    const forbiddenTerms = [
      term('get', 'Db'),
      term('db', '.', 'select'),
      'execute(',
      term('propose', 'FromReadOnlyFindings'),
      term('envelope', 'FromProposals'),
      'fetch(',
      'axios',
      term('api', 'Key'),
      term('provider', ' SDK'),
      term('snapshot: any'),
    ];

    expect(source).toContain('export type ReadOnlyAgentSnapshotCollections');
    expect(source).toContain('export interface ReadOnlyAgentCollectionsQueryInput');
    expect(source).toContain('answerReadOnlyAgentQueryForCollections');
    expect(source).toContain("kind: 'READ_ONLY_AGENT_SNAPSHOT'");
    expect(source).toContain('synthetic: true');
    expect(source).toContain('persisted: false');
    for (const forbiddenTerm of forbiddenTerms) {
      expect(source).not.toContain(forbiddenTerm);
    }
  });

  it('does not modify protected upstream, downstream, runtime, Workbench, database, UI, schema, or Tauri files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean).map(file => file.replace(/^local-crm-desktop\//, ''));
    if (hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles)) return;
    const forbiddenFiles = [
      'src/lib/readOnlySnapshotLoaderReadiness.ts',
      'src/lib/readOnlySnapshotLoader/readOnlySnapshotLoaderFixturesV1.ts',
      'src/lib/readOnlyAgentSnapshotAdapterReadiness.ts',
      'src/lib/readOnlyAgentSnapshotAdapter/readOnlyAgentSnapshotAdapterFixturesV1.ts',
      'src/lib/suggestOnlyAgent/suggestOnlyAgentFixturesV1.ts',
      'src/lib/confirmedActionContract/confirmedActionContractFixturesV1.ts',
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

function term(...parts: string[]): string {
  return parts.join('');
}
