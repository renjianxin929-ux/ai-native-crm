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

  if (row.decision === 'DIRECT_TO_CRM') {
    return executeDirectToCrm(db, row);
  }

  if (row.decision === 'CRM_WITH_LOOKUP') {
    return executeCrmWithLookup(db, row);
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

  let createdCustomerId: string | null = null;
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');

    const customerInput = buildCustomerInputFromImportRow(row);
    const duplicatePhoneCustomer = await findCustomerByPhoneNumber(db, customerInput.phone_number);
    if (duplicatePhoneCustomer) {
      const errorMessage = `Duplicate customer phone_number: ${customerInput.phone_number}`;
      await updateLeadImportRowDecisionStatus(db, row.id, 'FAILED', { errorMessage });
      return { status: 'FAILED', importRowId: row.id, errorMessage };
    }

    const duplicateNameCustomers = await findCustomersByName(db, customerInput.name);
    if (duplicateNameCustomers.length > 0) {
      const errorMessage = `Duplicate customer name: ${customerInput.name}`;
      await updateLeadImportRowDecisionStatus(db, row.id, 'FAILED', { errorMessage });
      return { status: 'FAILED', importRowId: row.id, errorMessage };
    }

    createdCustomerId = await insertCustomerWithDb(db, customerInput);
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
      createdCustomerId,
      errorMessage: null,
    });

    return { status: 'DONE', importRowId: row.id };
  } catch (error) {
    throw await compensateDecisionFailure(db, row, error, {
      customerId: createdCustomerId,
    });
  }
}

async function executeCrmWithLookup(
  db: DatabaseLike,
  row: LeadImportRow,
): Promise<LeadDecisionExecutionResult> {
  if (row.created_customer_id || row.created_work_item_id) {
    return {
      status: 'ALREADY_DONE',
      importRowId: row.id,
      customerId: row.created_customer_id,
      workItemId: row.created_work_item_id,
    };
  }

  let createdCustomerId: string | null = null;
  let createdWorkItemId: string | null = null;
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');

    const customerInput = buildCustomerInputFromImportRow(row);
    const duplicatePhoneCustomer = await findCustomerByPhoneNumber(db, customerInput.phone_number);
    if (duplicatePhoneCustomer) {
      const errorMessage = `Duplicate customer phone_number: ${customerInput.phone_number}`;
      await updateLeadImportRowDecisionStatus(db, row.id, 'FAILED', { errorMessage });
      return { status: 'FAILED', importRowId: row.id, errorMessage };
    }

    const duplicateNameCustomers = await findCustomersByName(db, customerInput.name);
    if (duplicateNameCustomers.length > 0) {
      const errorMessage = `Duplicate customer name: ${customerInput.name}`;
      await updateLeadImportRowDecisionStatus(db, row.id, 'FAILED', { errorMessage });
      return { status: 'FAILED', importRowId: row.id, errorMessage };
    }

    createdCustomerId = await insertCustomerWithDb(db, customerInput);
    const workItem = createCrmWithLookupWorkItem(row, createdCustomerId);
    await insertLeadWorkItem(db, workItem);
    createdWorkItemId = workItem.id;
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
      createdCustomerId,
      createdWorkItemId: workItem.id,
      errorMessage: null,
    });

    return { status: 'DONE', importRowId: row.id, workItemId: workItem.id };
  } catch (error) {
    throw await compensateDecisionFailure(db, row, error, {
      customerId: createdCustomerId,
      workItemId: createdWorkItemId,
    });
  }
}

async function executeLookupFirst(
  db: DatabaseLike,
  row: LeadImportRow,
): Promise<LeadDecisionExecutionResult> {
  let createdWorkItemId: string | null = null;
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');

    const existingWorkItems = await listLeadWorkItemsByImportRowId(db, row.id);
    if (row.created_work_item_id || existingWorkItems.length > 0) {
      await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
        createdWorkItemId: row.created_work_item_id ?? existingWorkItems[0].id,
      });
      return {
        status: 'ALREADY_DONE',
        importRowId: row.id,
        workItemId: row.created_work_item_id ?? existingWorkItems[0].id,
      };
    }

    const workItem = createLookupFirstWorkItem(row);
    await insertLeadWorkItem(db, workItem);
    createdWorkItemId = workItem.id;
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE', {
      createdWorkItemId: workItem.id,
    });

    return { status: 'DONE', importRowId: row.id, workItemId: workItem.id };
  } catch (error) {
    throw await compensateDecisionFailure(db, row, error, {
      workItemId: createdWorkItemId,
    });
  }
}

async function executeNoopDecision(
  db: DatabaseLike,
  row: LeadImportRow,
): Promise<LeadDecisionExecutionResult> {
  try {
    await updateLeadImportRowDecisionStatus(db, row.id, 'EXECUTING');
    await updateLeadImportRowDecisionStatus(db, row.id, 'DONE');
    return { status: 'DONE', importRowId: row.id };
  } catch (error) {
    throw await compensateDecisionFailure(db, row, error);
  }
}

async function compensateDecisionFailure(
  db: DatabaseLike,
  row: LeadImportRow,
  originalError: unknown,
  created: { customerId?: string | null; workItemId?: string | null } = {},
): Promise<Error> {
  const cleanupErrors: string[] = [];

  if (created.workItemId) {
    try {
      await db.execute('DELETE FROM lead_work_items WHERE id = ?', [created.workItemId]);
    } catch (error) {
      cleanupErrors.push(`work item cleanup failed: ${formatError(error)}`);
    }
  }
  if (created.customerId) {
    try {
      await db.execute('DELETE FROM customers WHERE id = ?', [created.customerId]);
    } catch (error) {
      cleanupErrors.push(`customer cleanup failed: ${formatError(error)}`);
    }
  }
  try {
    await db.execute(
      `UPDATE lead_import_rows
       SET decision_status = 'PENDING',
           created_customer_id = NULL,
           created_work_item_id = NULL,
           error_message = NULL,
           updated_at = ?
       WHERE id = ?`,
      [new Date().toISOString(), row.id],
    );
  } catch (error) {
    cleanupErrors.push(`import row reset failed: ${formatError(error)}`);
  }

  const originalMessage = formatError(originalError);
  const cleanupSuffix = cleanupErrors.length > 0
    ? `; cleanup errors: ${cleanupErrors.join('; ')}`
    : '';
  return new Error(
    `Lead import decision failed for row ${row.id} (${row.company_name}): ${originalMessage}${cleanupSuffix}`,
    { cause: originalError },
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function createCrmWithLookupWorkItem(row: LeadImportRow, customerId: string): LeadWorkItem {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    import_row_id: row.id,
    customer_id: customerId,
    work_type: 'CRM_CUSTOMER_ENRICHMENT',
    company_name: row.company_name,
    city: row.city,
    industry: row.industry,
    priority: getLookupPriority(row),
    lookup_goal: 'FIND_PHONE',
    tanji_search_keyword: row.tanji_search_keyword || row.company_name,
    status: 'TODO',
    note: 'CRM_WITH_LOOKUP auto task',
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
