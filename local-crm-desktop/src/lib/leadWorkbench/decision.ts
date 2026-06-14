import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import {
  buildCustomerInputFromImportRow,
  findCustomerByPhoneNumber,
  findCustomersByName,
  insertCustomerWithDb,
} from './customerAdapter';
import {
  getLeadImportRowById,
  insertLeadWorkItem,
  listLeadImportRowsByBatchId,
  listLeadWorkItemsByImportRowId,
  updateLeadImportRowDecisionStatus,
} from './db';
import type { LeadImportRow, LeadWorkItem } from './types';

export type LeadDecisionExecutionResult =
  | { status: 'DONE'; importRowId: string; workItemId?: string }
  | { status: 'FAILED'; importRowId: string; errorMessage: string }
  | { status: 'ALREADY_DONE'; importRowId: string; workItemId?: string | null; customerId?: string | null };

export async function executeLeadImportRowDecision(
  db: DatabaseLike,
  importRowId: string,
): Promise<LeadDecisionExecutionResult> {
  const row = await getLeadImportRowById(db, importRowId);
  if (!row) {
    throw new Error(`Lead import row not found: ${importRowId}`);
  }

  if (row.decision_status === 'DONE') {
    return { status: 'ALREADY_DONE', importRowId, workItemId: row.created_work_item_id };
  }

  if (row.decision_status !== 'PENDING' && row.decision_status !== 'FAILED') {
    throw new Error(`Lead import row ${importRowId} is not executable from status ${row.decision_status}`);
  }

  if (row.decision === 'CRM_WITH_LOOKUP') {
    throw new Error(`Unsupported lead import decision: ${row.decision}`);
  }

  if (row.decision === 'DIRECT_TO_CRM') {
    return executeDirectToCrm(db, row);
  }

  if (row.decision === 'LOOKUP_FIRST') {
    return executeLookupFirst(db, row);
  }

  if (row.decision === 'RESERVE' || row.decision === 'IGNORE') {
    return executeNoopDecision(db, row);
  }

  throw new Error(`Unsupported lead import decision: ${row.decision}`);
}

export async function executeLeadImportBatchDecisions(
  db: DatabaseLike,
  batchId: string,
): Promise<LeadDecisionExecutionResult[]> {
  const rows = await listLeadImportRowsByBatchId(db, batchId);
  const results: LeadDecisionExecutionResult[] = [];

  for (const row of rows) {
    results.push(await executeLeadImportRowDecision(db, row.id));
  }

  return results;
}

async function executeDirectToCrm(
  db: DatabaseLike,
  row: LeadImportRow,
): Promise<LeadDecisionExecutionResult> {
  if (row.created_customer_id) {
    return { status: 'ALREADY_DONE', importRowId: row.id, customerId: row.created_customer_id };
  }

  await db.execute('BEGIN');
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');

    const customerInput = buildCustomerInputFromImportRow(row);
    const duplicatePhoneCustomer = await findCustomerByPhoneNumber(db, customerInput.phone_number);
    if (duplicatePhoneCustomer) {
      const errorMessage = `Duplicate customer phone_number: ${customerInput.phone_number}`;
      await updateLeadImportRowDecisionStatus(db, row.id, 'FAILED', { errorMessage });
      await db.execute('COMMIT');
      return { status: 'FAILED', importRowId: row.id, errorMessage };
    }

    const duplicateNameCustomers = await findCustomersByName(db, customerInput.name);
    if (duplicateNameCustomers.length > 0) {
      const errorMessage = `Duplicate customer name: ${customerInput.name}`;
      await updateLeadImportRowDecisionStatus(db, row.id, 'FAILED', { errorMessage });
      await db.execute('COMMIT');
      return { status: 'FAILED', importRowId: row.id, errorMessage };
    }

    const customerId = await insertCustomerWithDb(db, customerInput);
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
      createdCustomerId: customerId,
      errorMessage: null,
    });
    await db.execute('COMMIT');

    return { status: 'DONE', importRowId: row.id };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

async function executeLookupFirst(
  db: DatabaseLike,
  row: LeadImportRow,
): Promise<LeadDecisionExecutionResult> {
  await db.execute('BEGIN');
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');

    const existingWorkItems = await listLeadWorkItemsByImportRowId(db, row.id);
    if (row.created_work_item_id || existingWorkItems.length > 0) {
      await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
        createdWorkItemId: row.created_work_item_id ?? existingWorkItems[0].id,
      });
      await db.execute('COMMIT');
      return {
        status: 'ALREADY_DONE',
        importRowId: row.id,
        workItemId: row.created_work_item_id ?? existingWorkItems[0].id,
      };
    }

    const workItem = createLookupFirstWorkItem(row);
    await insertLeadWorkItem(db, workItem);
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
      createdWorkItemId: workItem.id,
    });
    await db.execute('COMMIT');

    return { status: 'DONE', importRowId: row.id, workItemId: workItem.id };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

async function executeNoopDecision(
  db: DatabaseLike,
  row: LeadImportRow,
): Promise<LeadDecisionExecutionResult> {
  await db.execute('BEGIN');
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE');
    await db.execute('COMMIT');
    return { status: 'DONE', importRowId: row.id };
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

function createLookupFirstWorkItem(row: LeadImportRow): LeadWorkItem {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    import_row_id: row.id,
    customer_id: null,
    work_type: 'NEW_CUSTOMER_LOOKUP',
    company_name: row.company_name,
    city: row.city,
    industry: row.industry,
    priority: getLookupPriority(row),
    lookup_goal: 'FIND_PHONE',
    tanji_search_keyword: row.tanji_search_keyword || row.company_name,
    status: 'TODO',
    note: null,
    created_at: now,
    updated_at: now,
  };
}

function getLookupPriority(row: LeadImportRow): number {
  if (row.grade === 'A') return 100;
  if (row.grade === 'B') return 80;
  if (row.grade === 'C') return 60;
  if (row.score !== null) return Math.max(0, Math.min(100, Math.round(row.score)));
  return 50;
}
