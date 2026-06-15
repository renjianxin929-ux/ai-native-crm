import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import type { LeadSyncAction, LeadSyncStatus } from './types';

export interface LeadSyncLog {
  id: string;
  collected_lead_id: string;
  action: LeadSyncAction;
  target_customer_id: string | null;
  status: LeadSyncStatus;
  message: string;
  created_at: string;
}

export interface InsertLeadSyncLogInput {
  collected_lead_id: string;
  action: LeadSyncAction;
  target_customer_id: string | null;
  status: LeadSyncStatus;
  message: string;
}

export async function insertLeadSyncLog(
  db: DatabaseLike,
  input: InsertLeadSyncLogInput,
): Promise<LeadSyncLog> {
  const collectedLeadId = input.collected_lead_id.trim();
  const message = input.message.trim();

  if (!collectedLeadId) {
    throw new Error('collected_lead_id is required');
  }
  if (!message) {
    throw new Error('message is required');
  }

  const log: LeadSyncLog = {
    id: uuidv4(),
    collected_lead_id: collectedLeadId,
    action: input.action,
    target_customer_id: input.target_customer_id,
    status: input.status,
    message,
    created_at: new Date().toISOString(),
  };

  await db.execute(
    `INSERT INTO lead_sync_logs (
      id, collected_lead_id, action, target_customer_id, status, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.collected_lead_id,
      log.action,
      log.target_customer_id,
      log.status,
      log.message,
      log.created_at,
    ],
  );

  return log;
}
