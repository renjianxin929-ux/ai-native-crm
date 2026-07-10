import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import { buildContextSnapshot } from './contextBuilder';
import type { ContextSnapshot, CRMInteractionFact } from './types';

const WORKSPACE_HISTORY_DAYS = 90;

export function buildWorkspaceContextSnapshot(snapshot: LoadedReadOnlyAgentSnapshot): ContextSnapshot {
  const capturedAt = Date.parse(snapshot.loaded_at);
  if (!Number.isFinite(capturedAt)) throw new Error('Loaded snapshot timestamp is invalid.');
  const windowStart = new Date(capturedAt - WORKSPACE_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const interactions: CRMInteractionFact[] = [
    ...snapshot.tasks.map(task => ({
      interactionId: task.id,
      customerId: task.customer_id,
      kind: 'task' as const,
      summary: `${task.title} (${task.status})`,
      occurredAt: task.due_at ?? snapshot.loaded_at,
      evidenceIds: [task.evidence_ref.id],
    })),
    ...snapshot.work_items.map(item => ({
      interactionId: item.id,
      customerId: item.customer_id,
      kind: 'work_item' as const,
      summary: `${item.company_name} (${item.status})`,
      occurredAt: item.updated_at,
      evidenceIds: [item.evidence_ref.id],
    })),
    ...snapshot.capture_events.map(event => ({
      interactionId: event.id,
      customerId: null,
      kind: 'capture_event' as const,
      summary: event.summary,
      occurredAt: event.created_at,
      evidenceIds: [event.evidence_ref.id],
    })),
    ...snapshot.replay_evidence.map(event => ({
      interactionId: event.id,
      customerId: null,
      kind: 'sync_evidence' as const,
      summary: event.message,
      occurredAt: event.created_at,
      evidenceIds: [event.evidence_ref.id],
    })),
  ];

  return buildContextSnapshot({
    snapshotId: `stage2:${snapshot.snapshot_id}`,
    capturedAt: snapshot.loaded_at,
    timeWindow: { from: windowStart, to: snapshot.loaded_at },
    customers: snapshot.customers.map(customer => ({
      customerId: customer.id,
      name: customer.name,
      grade: customer.customer_grade,
      intentLevel: customer.intent_level,
      observedAt: snapshot.loaded_at,
      evidenceIds: [customer.evidence_ref.id],
    })),
    accounts: snapshot.work_items.map(item => ({
      accountId: item.id,
      customerId: item.customer_id,
      name: item.company_name,
      status: item.status,
      observedAt: item.updated_at,
      evidenceIds: [item.evidence_ref.id],
    })),
    interactions,
    maxInteractions: 50,
  });
}
