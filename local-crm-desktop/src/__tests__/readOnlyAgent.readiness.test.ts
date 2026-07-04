import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  READ_ONLY_AGENT_VERSION,
  answerReadOnlyAgentQuery,
  buildReadOnlyAgentPlan,
  type ReadOnlyAgentIntent,
} from '../lib/readOnlyAgentReadiness';
import { buildReadOnlyAgentSnapshotFixtureV1 } from '../lib/readOnlyAgent/readOnlyAgentFixturesV1';

const INTENTS: ReadOnlyAgentIntent[] = [
  'today_priorities',
  'stuck_work_items',
  'sync_failures',
  'high_intent_leads',
  'evidence_for_customer',
  'next_best_read_only_summary',
];

const FORBIDDEN_RESULT_PHRASES = [
  '已发送',
  '已执行',
  '已更新客户',
  '已创建客户',
  '已同步',
  '已写入 CRM',
];

function requestFor(intent: ReadOnlyAgentIntent) {
  return {
    kind: 'READ_ONLY_AGENT_REQUEST',
    intent,
    snapshot: buildReadOnlyAgentSnapshotFixtureV1(),
    target_customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
    target_work_item_id: 'READONLY_EVAL_WORK_ITEM_SEARCHING',
  } as const;
}

describe('Read-only Agent readiness gate', () => {
  it('builds a non-executable, non-persisted plan with a strict safety boundary', () => {
    const plan = buildReadOnlyAgentPlan(requestFor('today_priorities'));

    expect(READ_ONLY_AGENT_VERSION).toBe('v1');
    expect(plan).toMatchObject({
      kind: 'READ_ONLY_AGENT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'read_only_agent_readiness_only',
      allowed_operations: ['read_snapshot', 'emit_findings'],
      safety: {
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        requires_human_review_for_actions: true,
        represents_true_agent: false,
        represents_executed_action: false,
      },
    });
    expect(plan.forbidden_operations).toEqual(expect.arrayContaining([
      'write_db',
      'sync',
      'update_status',
      'create_customer',
      'call_provider',
      'send_message',
    ]));
    expect(plan.safety.forbidden_answer_phrases).toEqual(expect.arrayContaining(FORBIDDEN_RESULT_PHRASES));
  });

  it('answers all six intents from only the caller-provided snapshot', () => {
    for (const intent of INTENTS) {
      const answer = answerReadOnlyAgentQuery(buildReadOnlyAgentPlan(requestFor(intent)));

      expect(answer).toMatchObject({
        kind: 'READ_ONLY_AGENT_ANSWER',
        version: 'v1',
        intent,
        represents_executed_action: false,
      });
      expect(answer.read_only_summary.trim().length).toBeGreaterThan(0);
      expect(answer.findings.length).toBeGreaterThan(0);
      for (const phrase of FORBIDDEN_RESULT_PHRASES) {
        expect(answer.read_only_summary).not.toContain(phrase);
      }
      for (const finding of answer.findings) {
        expect(finding.represents_executed_action).toBe(false);
        if (finding.evidence_refs.length === 0) {
          expect(finding.uncertainty?.trim().length).toBeGreaterThan(0);
          expect(finding.severity).toBe('info');
        } else {
          expect(finding.uncertainty).toBeUndefined();
        }
      }
    }
  });

  it('keeps every factual finding tied to evidence and never treats fixture output as real model evidence', () => {
    const answers = INTENTS.map(intent => answerReadOnlyAgentQuery(buildReadOnlyAgentPlan(requestFor(intent))));
    const findings = answers.flatMap(answer => answer.findings);

    expect(findings.length).toBeGreaterThanOrEqual(INTENTS.length);
    for (const finding of findings) {
      if (finding.uncertainty) {
        expect(finding.severity).toBe('info');
        expect(finding.evidence_refs).toEqual([]);
      } else {
        expect(finding.evidence_refs.length).toBeGreaterThan(0);
      }
      for (const evidence of finding.evidence_refs) {
        expect(evidence.synthetic).toBe(true);
        expect(evidence.persisted).toBe(false);
        expect(evidence.represents_real_model_output).toBe(false);
      }
    }
  });

  it('ships a synthetic snapshot with safe entity prefixes and allowed read-only collections', () => {
    const snapshot = buildReadOnlyAgentSnapshotFixtureV1();

    expect(snapshot).toMatchObject({
      kind: 'READ_ONLY_AGENT_SNAPSHOT',
      synthetic: true,
      persisted: false,
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      'capture_events',
      'collected_leads',
      'customers',
      'eval_summaries',
      'import_rows',
      'kind',
      'model_invocations',
      'persisted',
      'prompt_plans',
      'replay_evidence',
      'snapshot_id',
      'synthetic',
      'tasks',
      'version',
      'work_items',
    ]);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain('READONLY_EVAL_');
    expect(serialized).not.toMatch(/\b1[3-9]\d{9}\b/);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(serialized).not.toMatch(/\bwxid_[A-Za-z0-9_-]{6,}\b/);
    expect(serialized).not.toContain('真实');
    for (const value of collectStringValues(snapshot)) {
      if (value.includes('COMPANY') || value.includes('CUSTOMER') || value.includes('WORK_ITEM')) {
        expect(value.startsWith('READONLY_EVAL_') || value.startsWith('EVAL_')).toBe(true);
      }
    }
  });

  it('keeps read-only agent source free of live DB, provider, network, UI, and execution hooks', () => {
    const source = [
      readFileSync('src/lib/readOnlyAgentReadiness.ts', 'utf8'),
      readFileSync('src/lib/readOnlyAgent/readOnlyAgentFixturesV1.ts', 'utf8'),
    ].join('\n');
    const forbiddenTerms = [
      'getDb',
      'INSERT',
      'UPDATE',
      'DELETE',
      'createCustomer',
      'updateCustomer',
      'insertCustomer',
      'syncCollectedLead',
      'updateLeadWorkItemStatus',
      'executeLeadImport',
      'insertLeadWorkItem',
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
      'sendMessage',
      'buildPromptRuntimePlan',
      'invokeWithFixtureAdapter',
      'runEvalDatasetV1',
      ...FORBIDDEN_RESULT_PHRASES,
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
    const forbiddenFiles = [
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
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
  });
});

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStringValues);
  }
  return [];
}
