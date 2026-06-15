import type { DatabaseLike } from '../db';
import { getLeadWorkItemById } from './db';
import { assertLeadWorkStatusTransition } from './stateMachine';
import type { LeadWorkItem, LeadWorkStatus } from './types';

export async function updateLeadWorkItemStatus(
  db: DatabaseLike,
  workItemId: string,
  nextStatus: LeadWorkStatus,
): Promise<LeadWorkItem> {
  const current = await getLeadWorkItemById(db, workItemId);
  if (!current) {
    throw new Error(`Lead work item not found: ${workItemId}`);
  }

  assertLeadWorkStatusTransition(current.status, nextStatus);

  const now = new Date().toISOString();
  await db.execute(
    'UPDATE lead_work_items SET status = ?, updated_at = ? WHERE id = ?',
    [nextStatus, now, workItemId],
  );

  const updated = await getLeadWorkItemById(db, workItemId);
  if (!updated) {
    throw new Error(`Lead work item not found after update: ${workItemId}`);
  }

  return updated;
}
