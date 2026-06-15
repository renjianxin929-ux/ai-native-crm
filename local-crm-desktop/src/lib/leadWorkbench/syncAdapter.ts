import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import {
  getCollectedLeadById,
  updateCollectedLeadSyncState,
  type CollectedLead,
} from './collectedLeads';
import {
  buildCustomerInputFromCollectedLead,
  findCustomerByPhoneNumber,
  findCustomersByName,
  insertCustomerWithDb,
} from './customerAdapter';
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

  await db.execute('BEGIN');
  try {
    const collectedLead = await getCollectedLeadById(db, id);
    if (!collectedLead) {
      await db.execute('COMMIT');
      return {
        collectedLeadId: id,
        status: 'FAILED',
        message: `Collected lead not found: ${id}`,
      };
    }

    const precheckResult = validateCreateCustomerMode(collectedLead);
    if (precheckResult) {
      await db.execute('COMMIT');
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
      await insertLeadSyncLog(db, {
        collected_lead_id: id,
        action: 'SKIP_DUPLICATE',
        target_customer_id: duplicatePhoneCustomer.id,
        status: 'SKIPPED',
        message,
      });
      await db.execute('COMMIT');
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
      await insertLeadSyncLog(db, {
        collected_lead_id: id,
        action: 'SKIP_DUPLICATE',
        target_customer_id: duplicateNameCustomer.id,
        status: 'SKIPPED',
        message,
      });
      await db.execute('COMMIT');
      return {
        collectedLeadId: id,
        targetCustomerId: duplicateNameCustomer.id,
        status: 'DUPLICATE_NAME',
        message,
      };
    }

    const customerId = await insertCustomerWithDb(db, customerInput);
    const now = new Date().toISOString();
    await updateCollectedLeadSyncState(db, {
      id,
      fromStatus: collectedLead.sync_status,
      toStatus: 'SYNCED',
      created_customer_id: customerId,
      updated_customer_id: null,
      message: 'Created customer from collected lead',
      updated_at: now,
    });
    await insertLeadSyncLog(db, {
      collected_lead_id: id,
      action: 'CREATE_CUSTOMER',
      target_customer_id: customerId,
      status: 'SUCCESS',
      message: 'Created customer from collected lead',
    });
    await db.execute('COMMIT');

    return {
      collectedLeadId: id,
      targetCustomerId: customerId,
      status: 'SUCCESS',
      message: 'Created customer from collected lead',
    };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
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

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  return normalized || null;
}
