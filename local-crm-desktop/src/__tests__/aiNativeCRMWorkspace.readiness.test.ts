import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AI_NATIVE_CRM_PHASE_1_2_FILE_ALLOWLIST,
  AI_NATIVE_CRM_WORKSPACE_VERSION,
  buildCustomerCatalogRequest,
  buildSelectedCRMContextRequest,
  isStrictReadOnlyWorkspaceSafety,
  projectCRMContextSummary,
} from '../lib/aiNativeCRMWorkspaceReadiness';
import type {
  LoadedReadOnlyAgentSnapshot,
  ReadOnlySnapshotLoaderSafety,
} from '../lib/readOnlySnapshotLoaderReadiness';

const STRICT_SAFETY: ReadOnlySnapshotLoaderSafety = {
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
};

const SNAPSHOT = {
  kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
  version: 'v1',
  snapshot_id: 'LOADED_SNAPSHOT_PROFILE_2026_07_10',
  synthetic: false,
  persisted: true,
  load_source: 'sqlite_read_only',
  loaded_at: '2026-07-10T08:00:00.000Z',
  context: { active_profile_id: 'profile_a', now: '2026-07-10T08:00:00.000Z' },
  work_items: [{ evidence_ref: {} }],
  collected_leads: [{ evidence_ref: {} }],
  replay_evidence: [],
  import_rows: [],
  capture_events: [],
  customers: [{ id: 'customer-1', evidence_ref: {} }],
  tasks: [{ status: 'TODO', evidence_ref: {} }, { status: 'DONE', evidence_ref: {} }],
  prompt_plans: [],
  model_invocations: [],
  eval_summaries: [],
} as unknown as LoadedReadOnlyAgentSnapshot;

describe('AI Native CRM workspace Target Phase 1-2 readiness', () => {
  it('records an exact four-file phase allowlist', () => {
    expect(AI_NATIVE_CRM_PHASE_1_2_FILE_ALLOWLIST).toEqual([
      'src/App.tsx',
      'src/components/aiNative/AINativeCRMWorkspace.tsx',
      'src/lib/aiNativeCRMWorkspaceReadiness.ts',
      'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
    ]);
    expect(AI_NATIVE_CRM_PHASE_1_2_FILE_ALLOWLIST).toHaveLength(4);
  });

  it('builds bounded catalog and selected-customer requests through the existing loader', () => {
    expect(buildCustomerCatalogRequest('profile_a', '2026-07-10T08:00:00.000Z')).toMatchObject({
      active_profile_id: 'profile_a',
      limits: { customers: 100, tasks: 0, lead_workbench: 0 },
      includes: { customers: true, tasks: false, lead_workbench: false },
    });

    expect(buildSelectedCRMContextRequest('profile_a', ' customer-1 ', '2026-07-10T08:00:00.000Z')).toMatchObject({
      active_profile_id: 'profile_a',
      limits: { customers: 1, tasks: 50, lead_workbench: 50 },
      includes: { customers: true, tasks: true, lead_workbench: true },
      filters: { target_customer_id: 'customer-1' },
    });
    expect(() => buildSelectedCRMContextRequest('profile_a', ' ', '2026-07-10T08:00:00.000Z')).toThrow('customer id');
  });

  it('accepts only the existing strict read-only loader safety contract', () => {
    expect(isStrictReadOnlyWorkspaceSafety(STRICT_SAFETY)).toBe(true);
    expect(isStrictReadOnlyWorkspaceSafety({ ...STRICT_SAFETY, no_provider_calls: false } as ReadOnlySnapshotLoaderSafety)).toBe(false);
    expect(isStrictReadOnlyWorkspaceSafety({ ...STRICT_SAFETY, writes_database: true } as unknown as ReadOnlySnapshotLoaderSafety)).toBe(false);
  });

  it('projects provenance, freshness, evidence, and no-persistence status', () => {
    const summary = projectCRMContextSummary(SNAPSHOT, 'customer-1', '2026-07-10T08:04:59.000Z');
    expect(summary).toEqual({
      snapshot_id: 'LOADED_SNAPSHOT_PROFILE_2026_07_10',
      captured_at: '2026-07-10T08:00:00.000Z',
      freshness: 'fresh',
      source: 'sqlite_read_only',
      source_records_persisted: true,
      snapshot_persisted: false,
      redaction_status: 'pii_allowlist_redacted',
      read_only: true,
      selected_customer_id: 'customer-1',
      customer_count: 1,
      open_task_count: 1,
      work_item_count: 1,
      evidence_count: 5,
    });
    expect(projectCRMContextSummary(SNAPSHOT, 'customer-1', '2026-07-10T08:05:01.000Z').freshness).toBe('stale');
  });

  it('exposes one production workspace with a visible Trusted Host safety boundary', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    const source = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');

    expect(AI_NATIVE_CRM_WORKSPACE_VERSION).toBe('target-phase-v1');
    expect(appSource).toContain('/ai-workspace');
    expect(appSource).toContain('AINativeCRMWorkspace');
    expect(source).toContain('SalesAgentInteractionWorkspace');
    expect(source).toContain('createTrustedHostSalesAgentAdapter');
    expect(source).toContain('controlled-mode-panel');
    expect(source).not.toContain('ReadOnlyAISuggestionPanel');
    expect(source).not.toContain('runReadOnlySnapshotAISuggestionService');
    expect(source).not.toContain('createMockReasoningProvider');
    expect(source).not.toContain('runSalesCopilotWorkflow');

    for (const forbidden of [
      'createAIDraft',
      'analyzeWechatScreenshot',
      'analyzeCallTranscript',
      'fetch(',
      'process.env',
      'import.meta.env',
      'apiKey',
      'db.execute',
      '.execute(',
      'writes_database: true',
      'represents_executed_action: true',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
