import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import type { Customer } from '../types';
import {
  getCollectedLeadById,
  updateCollectedLeadSyncState,
  type CollectedLead,
} from './collectedLeads';
import {
  applyCustomerEnrichmentPatchWithDb,
  buildCustomerEnrichmentPatchFromCollectedLead,
  buildCustomerInputFromCollectedLead,
  findCustomerByPhoneNumber,
  findCustomersByName,
  insertCustomerWithDb,
} from './customerAdapter';
import { getLeadWorkItemById } from './db';
import type { LeadSyncAction, LeadSyncStatus, LeadWorkItem, LeadWorkStatus } from './types';
import { updateLeadWorkItemStatus } from './workItemActions';

export type LeadSyncLogStatusCounts = Record<LeadSyncStatus, number>;

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

export interface LeadSyncReplayEvidence {
  log_id: string;
  collected_lead_id: string;
  action: LeadSyncAction;
  target_customer_id: string | null;
  status: LeadSyncStatus;
  message: string;
  created_at: string;
  work_item_id: string | null;
  work_item_status: LeadWorkStatus | null;
  import_row_id: string | null;
  import_row_decision_status: string | null;
  import_row_error_message: string | null;
  collected_sync_status: CollectedLead['sync_status'];
  collected_raw_text: string | null;
  capture_event_id: string | null;
  capture_raw_text: string | null;
  created_customer_id: string | null;
  updated_customer_id: string | null;
}

export type SyncCollectedLeadCreateCustomerStatus =
  | 'SUCCESS'
  | 'ALREADY_SYNCED'
  | 'DUPLICATE_PHONE'
  | 'DUPLICATE_NAME'
  | 'INVALID_STATUS'
  | 'INVALID_MODE'
  | 'FAILED';

export interface SyncCollectedLeadCreateCustomerResult {
  collectedLeadId: string;
  targetCustomerId?: string | null;
  status: SyncCollectedLeadCreateCustomerStatus;
  message: string;
}

export type SyncCollectedLeadEnrichCustomerStatus =
  | 'SUCCESS'
  | 'ALREADY_SYNCED'
  | 'INVALID_STATUS'
  | 'INVALID_MODE'
  | 'CUSTOMER_NOT_FOUND'
  | 'NO_ENRICHABLE_FIELDS'
  | 'FAILED';

export interface SyncCollectedLeadEnrichCustomerResult {
  collectedLeadId: string;
  targetCustomerId?: string | null;
  status: SyncCollectedLeadEnrichCustomerStatus;
  message: string;
}

export function createEmptyLeadSyncLogStatusCounts(): LeadSyncLogStatusCounts {
  return {
    SUCCESS: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
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

export async function getLeadSyncLogStatusCounts(
  db: DatabaseLike,
): Promise<LeadSyncLogStatusCounts> {
  const rows = await db.select<{ status: LeadSyncStatus; count: number | string }>(
    'SELECT status, COUNT(*) as count FROM lead_sync_logs GROUP BY status',
  );
  const counts = createEmptyLeadSyncLogStatusCounts();
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status] = Number(row.count);
    }
  }
  return counts;
}

export async function listLeadSyncReplayEvidence(db: DatabaseLike): Promise<LeadSyncReplayEvidence[]> {
  return db.select<LeadSyncReplayEvidence>(
    `SELECT
      log.id AS log_id,
      log.collected_lead_id,
      log.action,
      log.target_customer_id,
      log.status,
      log.message,
      log.created_at,
      collected.work_item_id,
      work.status AS work_item_status,
      collected.import_row_id,
      import_row.decision_status AS import_row_decision_status,
      import_row.error_message AS import_row_error_message,
      collected.sync_status AS collected_sync_status,
      collected.raw_text AS collected_raw_text,
      collected.capture_event_id,
      capture.raw_text AS capture_raw_text,
      collected.created_customer_id,
      collected.updated_customer_id
     FROM lead_sync_logs log
     INNER JOIN collected_leads collected ON collected.id = log.collected_lead_id
     LEFT JOIN lead_work_items work ON work.id = collected.work_item_id
     LEFT JOIN lead_capture_events capture ON capture.id = collected.capture_event_id
     LEFT JOIN lead_import_rows import_row ON import_row.id = collected.import_row_id
     ORDER BY log.created_at DESC, log.rowid DESC`,
  );
}

export async function syncCollectedLeadCreateCustomer(
  db: DatabaseLike,
  collectedLeadId: string,
): Promise<SyncCollectedLeadCreateCustomerResult> {
  const id = collectedLeadId.trim();
  if (!id) {
    return {
      collectedLeadId: '',
      status: 'FAILED',
      message: 'collectedLeadId is required',
    };
  }

  let collectedLead: CollectedLead | null = null;
  let createdCustomerId: string | null = null;
  let createdLogId: string | null = null;
  try {
    collectedLead = await getCollectedLeadById(db, id);
    if (!collectedLead) {
      return {
        collectedLeadId: id,
        status: 'FAILED',
        message: `Collected lead not found: ${id}`,
      };
    }

    const precheckResult = validateCreateCustomerMode(collectedLead);
    if (precheckResult) {
      return precheckResult;
    }

    const customerInput = buildCustomerInputFromCollectedLead(collectedLead);
    const duplicatePhoneCustomer = await findCustomerByPhoneNumber(db, customerInput.phone_number);
    if (duplicatePhoneCustomer) {
      const message = `Duplicate customer phone_number: ${customerInput.phone_number}`;
      await updateCollectedLeadSyncState(db, {
        id,
        fromStatus: collectedLead.sync_status,
        toStatus: 'FAILED',
        created_customer_id: null,
        updated_customer_id: null,
        message,
        updated_at: new Date().toISOString(),
      });
      const log = await insertLeadSyncLog(db, {
        collected_lead_id: id,
        action: 'SKIP_DUPLICATE',
        target_customer_id: duplicatePhoneCustomer.id,
        status: 'SKIPPED',
        message,
      });
      createdLogId = log.id;
      return {
        collectedLeadId: id,
        targetCustomerId: duplicatePhoneCustomer.id,
        status: 'DUPLICATE_PHONE',
        message,
      };
    }

    const duplicateNameCustomers = await findCustomersByName(db, customerInput.name);
    if (duplicateNameCustomers.length > 0) {
      const duplicateNameCustomer = duplicateNameCustomers[0];
      const message = `Duplicate customer name: ${customerInput.name}`;
      await updateCollectedLeadSyncState(db, {
        id,
        fromStatus: collectedLead.sync_status,
        toStatus: 'FAILED',
        created_customer_id: null,
        updated_customer_id: null,
        message,
        updated_at: new Date().toISOString(),
      });
      const log = await insertLeadSyncLog(db, {
        collected_lead_id: id,
        action: 'SKIP_DUPLICATE',
        target_customer_id: duplicateNameCustomer.id,
        status: 'SKIPPED',
        message,
      });
      createdLogId = log.id;
      return {
        collectedLeadId: id,
        targetCustomerId: duplicateNameCustomer.id,
        status: 'DUPLICATE_NAME',
        message,
      };
    }

    createdCustomerId = await insertCustomerWithDb(db, customerInput);
    const now = new Date().toISOString();
    await updateCollectedLeadSyncState(db, {
      id,
      fromStatus: collectedLead.sync_status,
      toStatus: 'SYNCED',
      created_customer_id: createdCustomerId,
      updated_customer_id: null,
      message: 'Created customer from collected lead',
      updated_at: now,
    });
    const log = await insertLeadSyncLog(db, {
      collected_lead_id: id,
      action: 'CREATE_CUSTOMER',
      target_customer_id: createdCustomerId,
      status: 'SUCCESS',
      message: 'Created customer from collected lead',
    });
    createdLogId = log.id;
    await closeCollectedLeadWorkItem(db, collectedLead);

    return {
      collectedLeadId: id,
      targetCustomerId: createdCustomerId,
      status: 'SUCCESS',
      message: 'Created customer from collected lead',
    };
  } catch (error) {
    throw await compensateCreateSyncFailure(db, collectedLead, error, {
      customerId: createdCustomerId,
      logId: createdLogId,
    });
  }
}

export async function syncCollectedLeadEnrichCustomer(
  db: DatabaseLike,
  collectedLeadId: string,
): Promise<SyncCollectedLeadEnrichCustomerResult> {
  const id = collectedLeadId.trim();
  if (!id) {
    return {
      collectedLeadId: '',
      status: 'FAILED',
      message: 'collectedLeadId is required',
    };
  }

  let collectedLead: CollectedLead | null = null;
  let existingCustomer: Customer | null = null;
  let createdLogId: string | null = null;
  try {
    collectedLead = await getCollectedLeadById(db, id);
    if (!collectedLead) {
      return {
        collectedLeadId: id,
        status: 'FAILED',
        message: `Collected lead not found: ${id}`,
      };
    }

    const precheckResult = validateEnrichCustomerMode(collectedLead);
    if (precheckResult) {
      return precheckResult;
    }

    const customerId = collectedLead.customer_id!;
    existingCustomer = await getCustomerByIdWithDb(db, customerId);
    if (!existingCustomer) {
      const message = `Customer not found: ${customerId}`;
      await updateCollectedLeadSyncState(db, {
        id,
        fromStatus: collectedLead.sync_status,
        toStatus: 'FAILED',
        created_customer_id: null,
        updated_customer_id: null,
        message,
        updated_at: new Date().toISOString(),
      });
      const log = await insertLeadSyncLog(db, {
        collected_lead_id: id,
        action: 'ENRICH_CUSTOMER',
        target_customer_id: null,
        status: 'FAILED',
        message,
      });
      createdLogId = log.id;
      return {
        collectedLeadId: id,
        targetCustomerId: customerId,
        status: 'CUSTOMER_NOT_FOUND',
        message,
      };
    }

    const { patch } = buildCustomerEnrichmentPatchFromCollectedLead(existingCustomer, collectedLead);
    if (Object.keys(patch).length === 0) {
      const message = 'No enrichable fields for collected lead';
      await updateCollectedLeadSyncState(db, {
        id,
        fromStatus: collectedLead.sync_status,
        toStatus: 'FAILED',
        created_customer_id: null,
        updated_customer_id: null,
        message,
        updated_at: new Date().toISOString(),
      });
      const log = await insertLeadSyncLog(db, {
        collected_lead_id: id,
        action: 'ENRICH_CUSTOMER',
        target_customer_id: customerId,
        status: 'FAILED',
        message,
      });
      createdLogId = log.id;
      return {
        collectedLeadId: id,
        targetCustomerId: customerId,
        status: 'NO_ENRICHABLE_FIELDS',
        message,
      };
    }

    await applyCustomerEnrichmentPatchWithDb(db, customerId, patch);
    await updateCollectedLeadSyncState(db, {
      id,
      fromStatus: collectedLead.sync_status,
      toStatus: 'SYNCED',
      created_customer_id: null,
      updated_customer_id: customerId,
      message: 'Enriched customer from collected lead',
      updated_at: new Date().toISOString(),
    });
    const log = await insertLeadSyncLog(db, {
      collected_lead_id: id,
      action: 'ENRICH_CUSTOMER',
      target_customer_id: customerId,
      status: 'SUCCESS',
      message: 'Enriched customer from collected lead',
    });
    createdLogId = log.id;
    await closeCollectedLeadWorkItem(db, collectedLead);

    return {
      collectedLeadId: id,
      targetCustomerId: customerId,
      status: 'SUCCESS',
      message: 'Enriched customer from collected lead',
    };
  } catch (error) {
    throw await compensateEnrichSyncFailure(db, collectedLead, existingCustomer, error, {
      logId: createdLogId,
    });
  }
}

async function closeCollectedLeadWorkItem(db: DatabaseLike, collectedLead: CollectedLead): Promise<void> {
  if (!collectedLead.work_item_id) return;
  const workItem = await getLeadWorkItemById(db, collectedLead.work_item_id);
  if (workItem?.status !== 'COLLECTED') return;
  if (!isCollectedLeadLinkedToWorkItem(collectedLead, workItem)) return;
  await updateLeadWorkItemStatus(db, collectedLead.work_item_id, 'DONE');
}

function isCollectedLeadLinkedToWorkItem(collectedLead: CollectedLead, workItem: LeadWorkItem): boolean {
  if (collectedLead.import_row_id !== workItem.import_row_id) return false;
  if (collectedLead.customer_id !== workItem.customer_id) return false;
  return true;
}

async function compensateCreateSyncFailure(
  db: DatabaseLike,
  collectedLead: CollectedLead | null,
  originalError: unknown,
  created: { customerId?: string | null; logId?: string | null },
): Promise<Error> {
  const cleanupErrors: string[] = [];
  await tryDeleteSyncLog(db, created.logId, cleanupErrors);
  await tryRestoreCollectedLead(db, collectedLead, cleanupErrors);
  if (created.customerId) {
    try {
      await db.execute('DELETE FROM customers WHERE id = ?', [created.customerId]);
    } catch (error) {
      cleanupErrors.push(`customer cleanup failed: ${formatError(error)}`);
    }
  }
  return buildCompensatedSyncError(originalError, cleanupErrors);
}

async function compensateEnrichSyncFailure(
  db: DatabaseLike,
  collectedLead: CollectedLead | null,
  existingCustomer: Customer | null,
  originalError: unknown,
  created: { logId?: string | null },
): Promise<Error> {
  const cleanupErrors: string[] = [];
  await tryDeleteSyncLog(db, created.logId, cleanupErrors);
  await tryRestoreCollectedLead(db, collectedLead, cleanupErrors);
  if (existingCustomer) {
    try {
      await restoreCustomerSnapshot(db, existingCustomer);
    } catch (error) {
      cleanupErrors.push(`customer restore failed: ${formatError(error)}`);
    }
  }
  return buildCompensatedSyncError(originalError, cleanupErrors);
}

async function tryDeleteSyncLog(
  db: DatabaseLike,
  logId: string | null | undefined,
  cleanupErrors: string[],
): Promise<void> {
  if (!logId) return;
  try {
    await db.execute('DELETE FROM lead_sync_logs WHERE id = ?', [logId]);
  } catch (error) {
    cleanupErrors.push(`sync log cleanup failed: ${formatError(error)}`);
  }
}

async function tryRestoreCollectedLead(
  db: DatabaseLike,
  collectedLead: CollectedLead | null,
  cleanupErrors: string[],
): Promise<void> {
  if (!collectedLead) return;
  try {
    await db.execute(
      `UPDATE collected_leads
       SET sync_status = ?, created_customer_id = ?, updated_customer_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        collectedLead.sync_status,
        collectedLead.created_customer_id,
        collectedLead.updated_customer_id,
        collectedLead.updated_at,
        collectedLead.id,
      ],
    );
  } catch (error) {
    cleanupErrors.push(`collected lead restore failed: ${formatError(error)}`);
  }
}

async function restoreCustomerSnapshot(db: DatabaseLike, customer: Customer): Promise<void> {
  const fields = Object.keys(customer).filter(field => field !== 'id');
  await db.execute(
    `UPDATE customers SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ?`,
    [
      ...fields.map(field => customer[field as keyof Customer] ?? null),
      customer.id,
    ],
  );
}

function buildCompensatedSyncError(originalError: unknown, cleanupErrors: string[]): Error {
  const cleanupSuffix = cleanupErrors.length > 0
    ? `; cleanup errors: ${cleanupErrors.join('; ')}`
    : '';
  return new Error(`${formatError(originalError)}${cleanupSuffix}`, { cause: originalError });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateCreateCustomerMode(
  collectedLead: CollectedLead,
): SyncCollectedLeadCreateCustomerResult | null {
  if (collectedLead.customer_id) {
    return {
      collectedLeadId: collectedLead.id,
      targetCustomerId: collectedLead.customer_id,
      status: 'INVALID_MODE',
      message: 'Collected lead is linked to an existing customer',
    };
  }

  if (collectedLead.sync_status === 'SYNCED') {
    return {
      collectedLeadId: collectedLead.id,
      targetCustomerId: collectedLead.created_customer_id,
      status: 'ALREADY_SYNCED',
      message: 'Collected lead is already synced',
    };
  }

  if (collectedLead.sync_status === 'IGNORED') {
    return {
      collectedLeadId: collectedLead.id,
      status: 'INVALID_STATUS',
      message: 'Ignored collected lead cannot be synced',
    };
  }

  if (collectedLead.sync_status !== 'UNSYNCED' && collectedLead.sync_status !== 'FAILED') {
    return {
      collectedLeadId: collectedLead.id,
      status: 'INVALID_STATUS',
      message: `Collected lead cannot be synced from status ${collectedLead.sync_status}`,
    };
  }

  if (!normalizeOptional(collectedLead.company_name)) {
    return {
      collectedLeadId: collectedLead.id,
      status: 'FAILED',
      message: 'company_name is required',
    };
  }

  const usefulFields = [
    collectedLead.mobile,
    collectedLead.tel,
    collectedLead.website,
    collectedLead.email,
    collectedLead.contact_name,
    collectedLead.note,
  ];
  if (usefulFields.every(value => !normalizeOptional(value))) {
    return {
      collectedLeadId: collectedLead.id,
      status: 'FAILED',
      message: 'At least one collected lead field is required',
    };
  }

  return null;
}

function validateEnrichCustomerMode(
  collectedLead: CollectedLead,
): SyncCollectedLeadEnrichCustomerResult | null {
  if (!collectedLead.customer_id) {
    return {
      collectedLeadId: collectedLead.id,
      status: 'INVALID_MODE',
      message: 'Collected lead is not linked to an existing customer',
    };
  }

  if (collectedLead.sync_status === 'SYNCED') {
    return {
      collectedLeadId: collectedLead.id,
      targetCustomerId: collectedLead.updated_customer_id ?? collectedLead.customer_id,
      status: 'ALREADY_SYNCED',
      message: 'Collected lead is already synced',
    };
  }

  if (collectedLead.sync_status === 'IGNORED') {
    return {
      collectedLeadId: collectedLead.id,
      targetCustomerId: collectedLead.customer_id,
      status: 'INVALID_STATUS',
      message: 'Ignored collected lead cannot be synced',
    };
  }

  if (collectedLead.sync_status !== 'UNSYNCED' && collectedLead.sync_status !== 'FAILED') {
    return {
      collectedLeadId: collectedLead.id,
      targetCustomerId: collectedLead.customer_id,
      status: 'INVALID_STATUS',
      message: `Collected lead cannot be synced from status ${collectedLead.sync_status}`,
    };
  }

  return null;
}

async function getCustomerByIdWithDb(db: DatabaseLike, customerId: string): Promise<Customer | null> {
  const rows = await db.select<Customer>(
    'SELECT * FROM customers WHERE id = ?',
    [customerId],
  );
  return rows[0] || null;
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  return normalized || null;
}
