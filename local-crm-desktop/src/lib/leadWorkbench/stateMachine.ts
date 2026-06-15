import type { CollectedLeadSyncStatus, LeadDecisionStatus, LeadWorkStatus } from './types';

const LEAD_DECISION_TRANSITIONS: Record<LeadDecisionStatus, LeadDecisionStatus[]> = {
  PENDING: ['PENDING', 'EXECUTING'],
  EXECUTING: ['EXECUTING', 'DONE', 'FAILED'],
  DONE: ['DONE'],
  FAILED: ['FAILED', 'EXECUTING'],
};

const LEAD_WORK_TRANSITIONS: Record<LeadWorkStatus, LeadWorkStatus[]> = {
  TODO: ['TODO', 'SEARCHING', 'NO_PHONE', 'SKIPPED'],
  SEARCHING: ['SEARCHING', 'STAGED', 'COLLECTED', 'NO_PHONE', 'SKIPPED'],
  STAGED: ['STAGED', 'COLLECTED', 'SKIPPED'],
  COLLECTED: ['COLLECTED', 'DONE'],
  NO_PHONE: ['NO_PHONE'],
  SKIPPED: ['SKIPPED'],
  DONE: ['DONE'],
};

const COLLECTED_LEAD_SYNC_TRANSITIONS: Record<CollectedLeadSyncStatus, CollectedLeadSyncStatus[]> = {
  UNSYNCED: ['UNSYNCED', 'SYNCED', 'FAILED', 'IGNORED'],
  FAILED: ['FAILED', 'UNSYNCED', 'SYNCED', 'IGNORED'],
  SYNCED: ['SYNCED'],
  IGNORED: ['IGNORED'],
};

export function isLeadDecisionStatusTransitionAllowed(
  from: LeadDecisionStatus,
  to: LeadDecisionStatus,
): boolean {
  return LEAD_DECISION_TRANSITIONS[from].includes(to);
}

export function assertLeadDecisionStatusTransition(
  from: LeadDecisionStatus,
  to: LeadDecisionStatus,
): void {
  if (!isLeadDecisionStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid lead decision status transition: ${from} -> ${to}`);
  }
}

export function isLeadWorkStatusTransitionAllowed(from: LeadWorkStatus, to: LeadWorkStatus): boolean {
  return LEAD_WORK_TRANSITIONS[from].includes(to);
}

export function assertLeadWorkStatusTransition(from: LeadWorkStatus, to: LeadWorkStatus): void {
  if (!isLeadWorkStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid lead work status transition: ${from} -> ${to}`);
  }
}

export function isCollectedLeadSyncStatusTransitionAllowed(
  from: CollectedLeadSyncStatus,
  to: CollectedLeadSyncStatus,
): boolean {
  return COLLECTED_LEAD_SYNC_TRANSITIONS[from].includes(to);
}

export function assertCollectedLeadSyncStatusTransition(
  from: CollectedLeadSyncStatus,
  to: CollectedLeadSyncStatus,
): void {
  if (!isCollectedLeadSyncStatusTransitionAllowed(from, to)) {
    throw new Error(`Invalid collected lead sync status transition: ${from} -> ${to}`);
  }
}
