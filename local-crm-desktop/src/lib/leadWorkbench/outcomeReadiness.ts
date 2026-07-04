import type { LeadSyncReplayEvidence } from './syncAdapter';
import type { LeadSyncAction, LeadSyncStatus } from './types';

export interface OutcomeEvidenceReference {
  type: string;
  id: string;
}

export interface OutcomeCandidateInput {
  replayEvidence: LeadSyncReplayEvidence;
}

export interface OutcomeCandidate {
  kind: 'OUTCOME_CANDIDATE';
  persisted: false;
  source_log_id: string;
  target_type: 'customer';
  target_id: string | null;
  action: LeadSyncAction;
  status: LeadSyncStatus;
  error_reason: string | null;
  evidence_references: OutcomeEvidenceReference[];
}

export function buildOutcomeCandidate(input: OutcomeCandidateInput): OutcomeCandidate {
  const row = input.replayEvidence;
  return {
    kind: 'OUTCOME_CANDIDATE',
    persisted: false,
    source_log_id: row.log_id,
    target_type: 'customer',
    target_id: row.target_customer_id,
    action: row.action,
    status: row.status,
    error_reason: row.status === 'SUCCESS' ? null : row.message,
    evidence_references: buildEvidenceReferences(row),
  };
}

function buildEvidenceReferences(row: LeadSyncReplayEvidence): OutcomeEvidenceReference[] {
  return [
    { type: 'lead_sync_log', id: row.log_id },
    { type: 'collected_lead', id: row.collected_lead_id },
    row.work_item_id ? { type: 'lead_work_item', id: row.work_item_id } : null,
    row.capture_event_id ? { type: 'lead_capture_event', id: row.capture_event_id } : null,
    row.import_row_id ? { type: 'lead_import_row', id: row.import_row_id } : null,
  ].filter((reference): reference is OutcomeEvidenceReference => reference !== null);
}
