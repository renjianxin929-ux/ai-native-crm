import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCrmAiRuntimeCatalog,
  buildLeadWorkbenchRuntimeTrace,
} from '../lib/aiRuntimeReadiness';
import { buildAIJudgmentCandidate } from '../lib/leadWorkbench/aiJudgmentReadiness';
import { buildHumanReviewCandidate } from '../lib/leadWorkbench/humanReviewReadiness';
import { buildOutcomeCandidate } from '../lib/leadWorkbench/outcomeReadiness';
import type { LeadSyncReplayEvidence } from '../lib/leadWorkbench/syncAdapter';
import type { LeadImportRow } from '../lib/leadWorkbench/types';
import { getActiveVerticalProfile } from '../lib/verticalProfiles';

function makeImportRow(overrides: Partial<LeadImportRow> = {}): LeadImportRow {
  return {
    id: 'import-row-1',
    batch_id: 'batch-1',
    row_index: 0,
    raw_data_json: JSON.stringify({ company_name: 'Readiness Co' }),
    company_name: 'Readiness Co',
    city: 'Foshan',
    industry: 'Manufacturing',
    website: null,
    contact_name: 'Alice',
    mobile: null,
    tel: null,
    email: null,
    score: 86,
    grade: 'S',
    tanji_search_keyword: 'Readiness Co phone',
    matching_reason: 'high score and no direct phone',
    priority_contact_role: 'buyer',
    source_evidence: 'expo booth card and website crawl',
    decision: 'CRM_WITH_LOOKUP',
    decision_status: 'PENDING',
    created_customer_id: null,
    created_work_item_id: null,
    error_message: null,
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

function makeReplayEvidence(overrides: Partial<LeadSyncReplayEvidence> = {}): LeadSyncReplayEvidence {
  return {
    log_id: 'sync-log-1',
    collected_lead_id: 'collected-1',
    action: 'CREATE_CUSTOMER',
    target_customer_id: 'customer-1',
    status: 'SUCCESS',
    message: 'Created customer from collected lead',
    created_at: '2026-07-03T00:00:00.000Z',
    work_item_id: 'work-1',
    work_item_status: 'DONE',
    import_row_id: 'import-row-1',
    import_row_decision_status: 'DONE',
    import_row_error_message: null,
    collected_sync_status: 'SYNCED',
    collected_raw_text: 'raw collected lead',
    capture_event_id: 'capture-1',
    capture_raw_text: 'raw capture text',
    created_customer_id: 'customer-1',
    updated_customer_id: null,
    ...overrides,
  };
}

describe('AI Runtime readiness orchestration gate', () => {
  it('combines Lead Workbench readiness candidates into a non-executable trace', () => {
    const profile = getActiveVerticalProfile();
    const judgment = buildAIJudgmentCandidate({
      importRow: makeImportRow(),
      profile,
      evidenceReferences: [
        { type: 'lead_import_row', id: 'import-row-1' },
      ],
    });
    const humanReview = buildHumanReviewCandidate({
      target_type: 'collected_lead',
      target_id: 'collected-1',
      proposed_action: 'CREATE_CUSTOMER',
      accepted: true,
    });
    const outcome = buildOutcomeCandidate({
      replayEvidence: makeReplayEvidence(),
    });

    const trace = buildLeadWorkbenchRuntimeTrace({
      judgment,
      human_review: humanReview,
      outcome,
    });

    expect(trace).toMatchObject({
      kind: 'AI_RUNTIME_PLAN',
      scope: 'lead_workbench',
      executable: false,
      persisted: false,
      reason: 'runtime_readiness_only',
    });
    expect(trace.stages).toEqual({
      judgment,
      human_review: humanReview,
      outcome,
    });
    expect(trace.stages.judgment.persisted).toBe(false);
    expect(trace.stages.judgment.model_id).toBeNull();
    expect(trace.stages.judgment.prompt_id).toBeNull();
    expect(trace.stages.human_review.persisted).toBe(false);
    expect(trace.stages.human_review.user_decision).toBe('accepted');
    expect(trace.stages.outcome.persisted).toBe(false);
    expect(trace.stages.outcome.status).toBe('SUCCESS');
  });

  it('projects prompt definitions and no-op model routes into a CRM AI catalog', () => {
    const profile = getActiveVerticalProfile();
    const catalog = buildCrmAiRuntimeCatalog(profile);

    expect(catalog).toMatchObject({
      kind: 'AI_RUNTIME_PLAN',
      scope: 'crm_ai',
      executable: false,
      persisted: false,
      reason: 'runtime_readiness_only',
    });
    expect(catalog.prompts).toHaveLength(4);
    expect(catalog.prompts.every(prompt => prompt.source === 'VerticalRuleProfile.aiDraft')).toBe(true);
    expect(catalog.prompts.every(prompt => prompt.runtime_editable === false)).toBe(true);
    expect(catalog.prompts.every(prompt => prompt.model_id === null)).toBe(true);

    const promptIdsByPurpose = new Map(catalog.prompts.map(prompt => [prompt.purpose, prompt.prompt_id]));
    expect(catalog.routes.map(route => route.purpose)).toEqual([
      'wechat_screenshot_analysis',
      'call_transcript_analysis',
      'next_action_suggestion',
    ]);
    expect(catalog.routes.map(route => route.prompt_id)).toEqual([
      promptIdsByPurpose.get('wechat_screenshot'),
      promptIdsByPurpose.get('call_transcript'),
      promptIdsByPurpose.get('next_action_suggestion'),
    ]);

    for (const route of catalog.routes) {
      expect(route.kind).toBe('NOOP_MODEL_ROUTE');
      expect(route.executable).toBe(false);
      expect(route.status).toBe('not_configured');
      expect(route.reason).toBe('router_readiness_only');
      expect(route.selected_model_id).toBeNull();
      expect(route.selected_provider).toBeNull();
    }
  });

  it('keeps the orchestration source free of runtime, storage, and network behavior', () => {
    const source = readFileSync(resolve(__dirname, '../lib/aiRuntimeReadiness.ts'), 'utf8');
    const forbiddenTerms = [
      'fetch(',
      'axios',
      'process.env',
      'import.meta.env',
      'API_KEY',
      'apiKey',
      'OpenAI',
      'DeepSeek',
      'Qwen',
      'Claude',
      'Gemini',
      'Ollama',
      'CREATE TABLE',
      'ai_judgments',
      'human_reviews',
      'outcomes',
      'ai_runtime',
      'defaultGeoExportProfile',
      'agent',
      'voice',
    ];

    for (const term of forbiddenTerms) {
      expect(source).not.toContain(term);
    }
  });

  it('does not modify forbidden runtime, UI, database, or provider files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean);
    const forbiddenFiles = [
      'src/pages/LeadWorkbenchPage.tsx',
      'src/lib/leadWorkbench/syncAdapter.ts',
      'src/lib/leadWorkbench/stateMachine.ts',
      'src/lib/leadWorkbench/schema.ts',
      'src/lib/db.ts',
      'src/lib/aiDraft.ts',
      'src/lib/textAIProvider.ts',
      'src/lib/multimodalProvider.ts',
    ];

    expect(changedFiles.filter(file => forbiddenFiles.includes(file))).toEqual([]);
  });
});
