import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  READ_ONLY_SNAPSHOT_LOADER_VERSION,
  buildReadOnlySnapshotLoaderPlan,
  buildReadOnlySnapshotLoaderTrace,
  loadReadOnlySnapshotFromDb,
  mapCollectedLeadSyncStatusForSnapshot,
  mapLeadSyncLogStatusForSnapshot,
  mapTaskStatusForSnapshot,
  type DatabaseLike,
} from '../lib/readOnlySnapshotLoaderReadiness';
import {
  buildReadOnlySnapshotLoaderDbFixtureV1,
  buildReadOnlySnapshotLoaderRequestFixtureV1,
  LOADER_TEST_PII_VALUES,
} from '../lib/readOnlySnapshotLoader/readOnlySnapshotLoaderFixturesV1';

const FORBIDDEN_OPERATIONS = [
  'write_db',
  'insert',
  'update',
  'delete',
  'create_customer',
  'update_customer',
  'sync',
  'update_status',
  'call_provider',
  'execute_action',
  'generate_proposal',
  'emit_envelope',
];

const FORBIDDEN_SOURCE_TERMS = [
  'getDb',
  'db.execute',
  '.execute(',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
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
  'confirmAndExecute',
  'sendMessage',
  'voice',
  '已发送',
  '已执行',
  '已更新客户',
  '已创建客户',
  '已同步',
  '已写入 CRM',
  'writes_database: true',
  'represents_executed_action: true',
  'no_provider_calls: false',
  'no_network: false',
  "synthetic: true",
  "load_source: 'fixture'",
];

const FORBIDDEN_CHANGED_FILES = [
  'src/lib/readOnlyAgentReadiness.ts',
  'src/lib/readOnlyAgent/readOnlyAgentFixturesV1.ts',
  'src/lib/suggestOnlyAgentReadiness.ts',
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

describe('Read-only Snapshot Loader readiness gate', () => {
  it('builds a non-executable, non-persisted loader plan with a strict safety boundary', () => {
    const plan = buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1());

    expect(READ_ONLY_SNAPSHOT_LOADER_VERSION).toBe('v1');
    expect(plan).toMatchObject({
      kind: 'READ_ONLY_SNAPSHOT_LOADER_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'read_only_snapshot_loader_readiness_only',
      allowed_operations: ['select_db', 'map_snapshot'],
      safety: {
        reads_database: true,
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        executable: false,
        persisted: false,
        represents_true_agent: false,
        represents_executed_action: false,
        pii_redacted: true,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining(FORBIDDEN_OPERATIONS));
    expect(plan.forbidden_operations).toHaveLength(FORBIDDEN_OPERATIONS.length);
  });

  it('loads a persisted sqlite read-only snapshot using db.select only', async () => {
    const fixture = buildReadOnlySnapshotLoaderDbFixtureV1({ ignoreSelectLimit: true });
    const execute = vi.fn();
    const db = { select: fixture.select, execute } as DatabaseLike & { execute: typeof execute };
    const plan = buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1());

    const result = await loadReadOnlySnapshotFromDb(db, plan);
    const trace = await buildReadOnlySnapshotLoaderTrace(db, plan);

    expect(fixture.selectMock).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'READ_ONLY_SNAPSHOT_LOADER_RESULT',
      version: 'v1',
      represents_executed_action: false,
      snapshot: {
        kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
        version: 'v1',
        synthetic: false,
        persisted: true,
        load_source: 'sqlite_read_only',
        prompt_plans: [],
        model_invocations: [],
        eval_summaries: [],
      },
    });
    expect(result.snapshot.snapshot_id).toMatch(/^LOADED_SNAPSHOT_/);
    expect(trace).toMatchObject({
      kind: 'READ_ONLY_SNAPSHOT_LOADER_TRACE',
      persisted: false,
      plan,
      result,
    });
  });

  it('honors includes, limits, and target filters without unbounded snapshot reads', async () => {
    const request = buildReadOnlySnapshotLoaderRequestFixtureV1({
      limits: { customers: 1, tasks: 1, lead_workbench: 1 },
      filters: {
        target_customer_id: 'LOADER_TEST_CUSTOMER_A',
        target_work_item_id: 'LOADER_TEST_WORK_ITEM_A',
      },
    });
    const fixture = buildReadOnlySnapshotLoaderDbFixtureV1({ ignoreSelectLimit: true });
    const result = await loadReadOnlySnapshotFromDb(fixture, buildReadOnlySnapshotLoaderPlan(request));

    expect(result.snapshot.customers).toHaveLength(1);
    expect(result.snapshot.tasks).toHaveLength(1);
    expect(result.snapshot.work_items).toHaveLength(1);
    expect(result.snapshot.collected_leads).toHaveLength(1);
    expect(result.snapshot.replay_evidence).toHaveLength(1);
    expect(result.snapshot.import_rows).toHaveLength(1);
    expect(result.snapshot.capture_events).toHaveLength(1);
    expect(result.snapshot.customers[0].id).toBe('LOADER_TEST_CUSTOMER_A');
    expect(result.snapshot.tasks[0].customer_id).toBe('LOADER_TEST_CUSTOMER_A');
    expect(result.snapshot.work_items[0].id).toBe('LOADER_TEST_WORK_ITEM_A');
    expect(result.snapshot.collected_leads[0].work_item_id).toBe('LOADER_TEST_WORK_ITEM_A');
    expect(result.snapshot.capture_events[0].work_item_id).toBe('LOADER_TEST_WORK_ITEM_A');

    const unfilteredLimitResult = await loadReadOnlySnapshotFromDb(
      buildReadOnlySnapshotLoaderDbFixtureV1({ ignoreSelectLimit: true }),
      buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1({
        limits: { customers: 1, tasks: 1, lead_workbench: 1 },
      })),
    );
    expect(unfilteredLimitResult.snapshot.customers).toHaveLength(1);
    expect(unfilteredLimitResult.snapshot.tasks).toHaveLength(1);
    expect(unfilteredLimitResult.snapshot.work_items).toHaveLength(1);

    for (const call of fixture.selectMock.mock.calls) {
      expect(call[0].toUpperCase()).toContain('LIMIT');
      expect(call[1]).toEqual(expect.arrayContaining([1]));
    }

    const excluded = buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1({
      includes: { customers: false, tasks: false, lead_workbench: false },
    }));
    const excludedResult = await loadReadOnlySnapshotFromDb(buildReadOnlySnapshotLoaderDbFixtureV1(), excluded);
    expect(excludedResult.snapshot.customers).toEqual([]);
    expect(excludedResult.snapshot.tasks).toEqual([]);
    expect(excludedResult.snapshot.work_items).toEqual([]);
    expect(excludedResult.snapshot.collected_leads).toEqual([]);
    expect(excludedResult.snapshot.replay_evidence).toEqual([]);
    expect(excludedResult.snapshot.import_rows).toEqual([]);
    expect(excludedResult.snapshot.capture_events).toEqual([]);
  });

  it('redacts raw and PII fields from the loaded snapshot allowlist', async () => {
    const result = await loadReadOnlySnapshotFromDb(
      buildReadOnlySnapshotLoaderDbFixtureV1(),
      buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1()),
    );
    const serialized = JSON.stringify(result.snapshot);

    for (const pii of LOADER_TEST_PII_VALUES) {
      expect(serialized).not.toContain(pii);
    }
    expect(Object.keys(result.snapshot.customers[0]).sort()).toEqual([
      'customer_grade',
      'evidence_ref',
      'id',
      'intent_level',
      'name',
    ]);
    expect(Object.keys(result.snapshot.collected_leads[0]).sort()).toEqual([
      'company_name',
      'customer_id',
      'evidence_ref',
      'id',
      'sync_status',
      'work_item_id',
    ]);
    expect(Object.keys(result.snapshot.capture_events[0]).sort()).toEqual([
      'action',
      'created_at',
      'evidence_ref',
      'id',
      'summary',
      'work_item_id',
    ]);
    expect(Object.keys(result.snapshot.import_rows[0]).sort()).toEqual([
      'company_name',
      'customer_id',
      'decision',
      'decision_status',
      'evidence_ref',
      'id',
    ]);
    expect(result.safety.pii_redacted).toBe(true);
  });

  it('maps persisted DB statuses into read-only snapshot enums deterministically', () => {
    expect(mapCollectedLeadSyncStatusForSnapshot('UNSYNCED')).toBe('PENDING');
    expect(mapCollectedLeadSyncStatusForSnapshot('SYNCED')).toBe('CREATED');
    expect(mapCollectedLeadSyncStatusForSnapshot('FAILED')).toBe('FAILED');
    expect(mapCollectedLeadSyncStatusForSnapshot('IGNORED')).toBe('SKIPPED');
    expect(mapLeadSyncLogStatusForSnapshot('SUCCESS')).toBe('OK');
    expect(mapLeadSyncLogStatusForSnapshot('FAILED')).toBe('FAILED');
    expect(mapLeadSyncLogStatusForSnapshot('SKIPPED')).toBe('SKIPPED');
    expect(mapTaskStatusForSnapshot('OPEN')).toBe('TODO');
    expect(mapTaskStatusForSnapshot('DONE')).toBe('DONE');
    expect(mapTaskStatusForSnapshot('CANCELLED')).toBe('DONE');
  });

  it('keeps evidence source refs stable and null-safe for future read-only evidence use', async () => {
    const result = await loadReadOnlySnapshotFromDb(
      buildReadOnlySnapshotLoaderDbFixtureV1({ includeNullSources: true }),
      buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1()),
    );
    const collections = [
      result.snapshot.work_items,
      result.snapshot.collected_leads,
      result.snapshot.replay_evidence,
      result.snapshot.import_rows,
      result.snapshot.capture_events,
      result.snapshot.customers,
      result.snapshot.tasks,
    ];

    for (const collection of collections) {
      expect(collection.length).toBeGreaterThan(0);
      for (const item of collection) {
        expect(item.evidence_ref.id.trim().length).toBeGreaterThan(0);
        expect(item.evidence_ref.label.trim().length).toBeGreaterThan(0);
        expect(item.evidence_ref.persisted).toBe(true);
        expect(item.evidence_ref.synthetic).toBe(false);
      }
    }
    expect(result.snapshot.work_items.some(item => item.customer_id === null)).toBe(true);
    expect(result.snapshot.collected_leads.some(item => item.customer_id === null)).toBe(true);
  });

  it('keeps loaded snapshots distinct from synthetic read-only agent and eval fixtures', async () => {
    const result = await loadReadOnlySnapshotFromDb(
      buildReadOnlySnapshotLoaderDbFixtureV1(),
      buildReadOnlySnapshotLoaderPlan(buildReadOnlySnapshotLoaderRequestFixtureV1()),
    );
    const serialized = JSON.stringify(result.snapshot);

    expect(result.snapshot.synthetic).toBe(false);
    expect(result.snapshot.persisted).toBe(true);
    expect(result.snapshot.load_source).toBe('sqlite_read_only');
    expect(serialized).not.toContain('READONLY_EVAL_');
  });

  it('keeps production loader source free of writes, agent chains, providers, env, and fake execution claims', () => {
    const source = readFileSync('src/lib/readOnlySnapshotLoaderReadiness.ts', 'utf8');

    expect(source).toContain('SELECT');
    for (const term of FORBIDDEN_SOURCE_TERMS) {
      expect(source).not.toContain(term);
    }
  });

  it('does not modify existing agent, runtime, eval, Workbench, database, schema, UI, provider, or Tauri files', () => {
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
