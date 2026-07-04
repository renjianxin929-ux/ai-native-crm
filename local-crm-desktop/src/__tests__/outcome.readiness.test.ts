import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildOutcomeCandidate,
  type OutcomeCandidateInput,
} from '../lib/leadWorkbench/outcomeReadiness';
import type { LeadSyncReplayEvidence } from '../lib/leadWorkbench/syncAdapter';

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

function makeInput(overrides: Partial<OutcomeCandidateInput> = {}): OutcomeCandidateInput {
  return {
    replayEvidence: makeReplayEvidence(),
    ...overrides,
  };
}

describe('Outcome readiness contract', () => {
  it('builds a non-persisted candidate from replay evidence and sync log fields', () => {
    const candidate = buildOutcomeCandidate(makeInput());

    expect(candidate.kind).toBe('OUTCOME_CANDIDATE');
    expect(candidate.persisted).toBe(false);
    expect(candidate.source_log_id).toBe('sync-log-1');
    expect(candidate.target_type).toBe('customer');
    expect(candidate.target_id).toBe('customer-1');
    expect(candidate.action).toBe('CREATE_CUSTOMER');
    expect(candidate.status).toBe('SUCCESS');
    expect(candidate.error_reason).toBeNull();
    expect(candidate.evidence_references).toEqual([
      { type: 'lead_sync_log', id: 'sync-log-1' },
      { type: 'collected_lead', id: 'collected-1' },
      { type: 'lead_work_item', id: 'work-1' },
      { type: 'lead_capture_event', id: 'capture-1' },
      { type: 'lead_import_row', id: 'import-row-1' },
    ]);
  });

  it('preserves failed status and error reason instead of treating failures as success', () => {
    const candidate = buildOutcomeCandidate(makeInput({
      replayEvidence: makeReplayEvidence({
        status: 'FAILED',
        message: 'Customer not found: missing-customer',
        target_customer_id: null,
      }),
    }));

    expect(candidate.status).toBe('FAILED');
    expect(candidate.target_id).toBeNull();
    expect(candidate.error_reason).toBe('Customer not found: missing-customer');
  });

  it('does not invent missing linked evidence references', () => {
    const candidate = buildOutcomeCandidate(makeInput({
      replayEvidence: makeReplayEvidence({
        work_item_id: null,
        capture_event_id: null,
        import_row_id: null,
      }),
    }));

    expect(candidate.evidence_references).toEqual([
      { type: 'lead_sync_log', id: 'sync-log-1' },
      { type: 'collected_lead', id: 'collected-1' },
    ]);
  });

  it('does not create a persisted Outcome object or table', () => {
    const source = readFileSync(resolve(__dirname, '../lib/leadWorkbench/outcomeReadiness.ts'), 'utf8');

    expect(source).toContain('OUTCOME_CANDIDATE');
    expect(source).not.toContain('outcomes');
    expect(source).not.toContain('CREATE TABLE');
  });
});
