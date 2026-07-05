import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION,
  adaptLoadedSnapshot,
  buildReadOnlyAgentSnapshotAdapterPlan,
  buildReadOnlyAgentSnapshotAdapterTrace,
  recheckReadOnlyAgentSnapshotAdapterPii,
} from '../lib/readOnlyAgentSnapshotAdapterReadiness';
import {
  buildAdapterTestLoadedSnapshotV1,
  buildAdapterTestPiiPollutedLoadedSnapshotV1,
} from '../lib/readOnlyAgentSnapshotAdapter/readOnlyAgentSnapshotAdapterFixturesV1';

const ALLOWED_OPERATIONS = [
  'validate_loaded_snapshot',
  'map_snapshot_candidate',
  'build_request_candidate',
];

const FORBIDDEN_OPERATIONS = [
  'read_db',
  'write_db',
  'load_snapshot',
  'invoke_read_only_agent',
  'generate_findings',
  'generate_proposals',
  'emit_envelopes',
  'call_provider',
  'execute_action',
];

const FORBIDDEN_SOURCE_TERMS = [
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
  'loadReadOnlySnapshotFromDb',
  'answerReadOnlyAgentQuery',
  'buildReadOnlyAgentPlan',
  'proposeFromReadOnlyFindings',
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
  'kind: \'READ_ONLY_AGENT_SNAPSHOT\'',
  'kind: "READ_ONLY_AGENT_SNAPSHOT"',
  'synthetic: true',
  'persisted: false',
  'invokes_read_only_agent: true',
  'reads_database: true',
  'writes_database: true',
  'represents_executed_action: true',
];

const FORBIDDEN_CHANGED_FILES = [
  'src/lib/readOnlySnapshotLoaderReadiness.ts',
  'src/lib/readOnlySnapshotLoader/readOnlySnapshotLoaderFixturesV1.ts',
  'src/lib/readOnlyAgent/readOnlyAgentFixturesV1.ts',
  'src/lib/suggestOnlyAgent/suggestOnlyAgentFixturesV1.ts',
  'src/lib/confirmedActionContractReadiness.ts',
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

function requestFixture() {
  return {
    kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_REQUEST',
    version: 'v1',
    request_id: 'ADAPTER_TEST_REQUEST_A',
    intent: 'evidence_for_customer',
    loaded_snapshot: buildAdapterTestLoadedSnapshotV1(),
    target_customer_id: 'LOADER_TEST_CUSTOMER_A',
    target_work_item_id: 'LOADER_TEST_WORK_ITEM_A',
  } as const;
}

describe('Read-only Agent Snapshot Adapter readiness gate', () => {
  it('builds a non-executable, non-persisted adapter plan with strict safety', () => {
    const plan = buildReadOnlyAgentSnapshotAdapterPlan(requestFixture());

    expect(READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION).toBe('v1');
    expect(plan).toMatchObject({
      kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'read_only_agent_snapshot_adapter_readiness_only',
      allowed_operations: ALLOWED_OPERATIONS,
      safety: {
        reads_database: false,
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        executable: false,
        persisted: false,
        represents_executed_action: false,
        invokes_read_only_agent: false,
        pii_recheck_required: true,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining(FORBIDDEN_OPERATIONS));
    expect(plan.forbidden_operations).toHaveLength(FORBIDDEN_OPERATIONS.length);
  });

  it('adapts only the caller-provided loaded snapshot into adapter candidates', () => {
    const loaded = buildAdapterTestLoadedSnapshotV1();
    const before = structuredClone(loaded);
    const plan = buildReadOnlyAgentSnapshotAdapterPlan({
      ...requestFixture(),
      loaded_snapshot: loaded,
    });

    const result = adaptLoadedSnapshot(plan);

    expect(loaded).toEqual(before);
    expect(result).toMatchObject({
      kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_RESULT',
      version: 'v1',
      represents_executed_action: false,
      adaptation_blocked: false,
      blocked_reason: null,
      snapshot_candidate: {
        kind: 'ADAPTED_READ_ONLY_AGENT_SNAPSHOT_CANDIDATE',
        source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
        source_snapshot_id: loaded.snapshot_id,
        load_source: 'sqlite_read_only',
        synthetic: false,
        persisted: true,
      },
      request_candidate: {
        kind: 'READ_ONLY_AGENT_REQUEST_CANDIDATE',
        version: 'v1',
        intent: 'evidence_for_customer',
        source_is_loaded_snapshot: true,
        target_customer_id: 'LOADER_TEST_CUSTOMER_A',
        target_work_item_id: 'LOADER_TEST_WORK_ITEM_A',
      },
    });
    expect(result.request_candidate).not.toHaveProperty('kind', 'READ_ONLY_AGENT_REQUEST');
    expect(result.snapshot_candidate).not.toHaveProperty('kind', 'READ_ONLY_AGENT_SNAPSHOT');
    expect(result.snapshot_candidate.synthetic).toBe(false);
    expect(result.snapshot_candidate.persisted).toBe(true);
  });

  it('maps loaded collections and keeps prompt/model/eval collections empty', () => {
    const result = adaptLoadedSnapshot(buildReadOnlyAgentSnapshotAdapterPlan(requestFixture()));
    const snapshot = result.snapshot_candidate;

    expect(snapshot.work_items).toHaveLength(2);
    expect(snapshot.collected_leads).toHaveLength(2);
    expect(snapshot.replay_evidence).toHaveLength(2);
    expect(snapshot.import_rows).toHaveLength(2);
    expect(snapshot.customers).toHaveLength(2);
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.capture_events).toHaveLength(2);
    expect(snapshot.prompt_plans).toEqual([]);
    expect(snapshot.model_invocations).toEqual([]);
    expect(snapshot.eval_summaries).toEqual([]);
  });

  it('supplements fields and derives cross references without fabricating missing ids', () => {
    const result = adaptLoadedSnapshot(buildReadOnlyAgentSnapshotAdapterPlan(requestFixture()));
    const snapshot = result.snapshot_candidate;

    expect(snapshot.work_items.find(item => item.id === 'LOADER_TEST_WORK_ITEM_A')).toMatchObject({
      collected_lead_id: 'LOADER_TEST_COLLECTED_A',
      due_at: null,
    });
    expect(snapshot.work_items.find(item => item.id === 'LOADER_TEST_WORK_ITEM_ORPHAN')).toMatchObject({
      collected_lead_id: null,
      due_at: null,
    });
    expect(snapshot.collected_leads[0]).toMatchObject({
      intent_level: 'UNKNOWN',
      lead_grade: 'UNKNOWN',
    });
    expect(snapshot.import_rows[0]).toMatchObject({
      intent_level: 'UNKNOWN',
      lead_grade: 'UNKNOWN',
    });
    expect(snapshot.replay_evidence.find(item => item.id === 'LOADER_TEST_SYNC_LOG_A')).toMatchObject({
      customer_id: 'LOADER_TEST_CUSTOMER_A',
    });
    expect(snapshot.capture_events.find(item => item.id === 'LOADER_TEST_CAPTURE_A')).toMatchObject({
      customer_id: 'LOADER_TEST_CUSTOMER_A',
    });
    expect(snapshot.tasks.find(item => item.id === 'LOADER_TEST_TASK_B')).toMatchObject({
      due_at: '',
    });
    expect(result.validation_warnings).toEqual(expect.arrayContaining([
      'missing_collected_lead_for_work_item:LOADER_TEST_WORK_ITEM_ORPHAN',
      'missing_customer_for_replay_evidence:LOADER_TEST_SYNC_LOG_ORPHAN',
      'missing_customer_for_capture_event:LOADER_TEST_CAPTURE_ORPHAN',
    ]));
  });

  it('preserves source ids and evidence refs as persisted non-model candidates', () => {
    const result = adaptLoadedSnapshot(buildReadOnlyAgentSnapshotAdapterPlan(requestFixture()));
    const evidenceRefs = result.snapshot_candidate.evidence_refs;

    expect(evidenceRefs.map(ref => `${ref.type}:${ref.id}`)).toEqual(expect.arrayContaining([
      'lead_work_item:LOADER_TEST_WORK_ITEM_A',
      'collected_lead:LOADER_TEST_COLLECTED_A',
      'lead_sync_log:LOADER_TEST_SYNC_LOG_A',
      'import_row:LOADER_TEST_IMPORT_ROW_A',
      'capture_event:LOADER_TEST_CAPTURE_A',
      'customer:LOADER_TEST_CUSTOMER_A',
      'task:LOADER_TEST_TASK_A',
    ]));
    for (const evidence of evidenceRefs) {
      expect(evidence.synthetic).toBe(false);
      expect(evidence.persisted).toBe(true);
      expect(evidence.represents_real_model_output).toBe(false);
    }
  });

  it('blocks adaptation when the required PII recheck finds polluted loaded snapshot markers', () => {
    const clean = adaptLoadedSnapshot(buildReadOnlyAgentSnapshotAdapterPlan(requestFixture()));
    expect(clean.pii_check.passed).toBe(true);
    expect(clean.adaptation_blocked).toBe(false);

    const pollutedPlan = buildReadOnlyAgentSnapshotAdapterPlan({
      ...requestFixture(),
      loaded_snapshot: buildAdapterTestPiiPollutedLoadedSnapshotV1(),
    });
    const polluted = adaptLoadedSnapshot(pollutedPlan);

    expect(polluted.pii_check.passed).toBe(false);
    expect(polluted.pii_check.violations.length).toBeGreaterThan(0);
    expect(polluted.adaptation_blocked).toBe(true);
    expect(polluted.blocked_reason).toBe('pii_recheck_failed');
    expect(recheckReadOnlyAgentSnapshotAdapterPii(
      pollutedPlan.request.loaded_snapshot,
      polluted.snapshot_candidate,
    ).passed).toBe(false);
  });

  it('builds an adapter trace without claiming an agent run happened', () => {
    const plan = buildReadOnlyAgentSnapshotAdapterPlan(requestFixture());
    const trace = buildReadOnlyAgentSnapshotAdapterTrace(plan);

    expect(trace).toMatchObject({
      kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_TRACE',
      plan,
      persisted: false,
      result: {
        represents_executed_action: false,
        safety: {
          invokes_read_only_agent: false,
        },
      },
    });
  });

  it('keeps adapter source free of DB, loader, agent, downstream, provider, UI, and execution hooks', () => {
    const source = readFileSync('src/lib/readOnlyAgentSnapshotAdapterReadiness.ts', 'utf8');

    for (const term of FORBIDDEN_SOURCE_TERMS) {
      expect(source).not.toContain(term);
    }
  });

  it('keeps adapter fixture source free of loader, DB, agent, and READONLY_EVAL fixture writes', () => {
    const source = readFileSync('src/lib/readOnlyAgentSnapshotAdapter/readOnlyAgentSnapshotAdapterFixturesV1.ts', 'utf8');

    for (const term of [
      'getDb',
      'loadReadOnlySnapshotFromDb',
      'answerReadOnlyAgentQuery',
      'buildReadOnlyAgentPlan',
      'READONLY_EVAL',
      'fetch(',
      'process.env',
      'import.meta.env',
    ]) {
      expect(source).not.toContain(term);
    }
  });

  it('does not modify existing loader, agent, runtime, eval, Workbench, database, schema, UI, provider, or Tauri files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean).map(file => file.replace(/^local-crm-desktop\//, ''));

    expect(changedFiles.filter(file => FORBIDDEN_CHANGED_FILES.includes(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
  });
});
