import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import type {
  ContactMethod,
  Customer,
  CustomerGrade,
  CustomerStage,
  FeedbackType,
  IntentLevel,
  PaymentStatus,
  TimeParseStatus,
  WechatAddStatus,
} from '../types';
import type { LeadBatchType, LeadImportRow } from './types';

export interface LeadWorkbenchCustomerInput {
  name: string;
  phone_number: string | null;
  website: string | null;
  region: string | null;
  industry: string | null;
  contact_person: string | null;
  email: string | null;
  source: string | null;
  qualification_reason: string | null;
  notes: string | null;
  customer_grade: CustomerGrade;
  stage: CustomerStage;
  contact_method: ContactMethod | null;
  next_follow_up_at: string | null;
  wechat_add_status: WechatAddStatus;
  intent_level: IntentLevel;
  payment_status: PaymentStatus;
  time_parse_status: TimeParseStatus;
  last_feedback_type: FeedbackType;
}

export interface BuildCustomerInputOptions {
  batchType?: LeadBatchType | null;
  sourceLabel?: string | null;
}

export function buildCustomerInputFromImportRow(
  importRow: LeadImportRow,
  options: BuildCustomerInputOptions = {},
): LeadWorkbenchCustomerInput {
  return {
    name: importRow.company_name || 'Unnamed lead',
    phone_number: importRow.mobile || importRow.tel,
    website: importRow.website,
    region: importRow.city,
    industry: importRow.industry,
    contact_person: importRow.contact_name,
    email: importRow.email,
    source: buildSource(options),
    qualification_reason: importRow.matching_reason,
    notes: buildNotes(importRow),
    customer_grade: mapLeadGradeToCustomerGrade(importRow.grade),
    stage: 'NEW_LEAD',
    contact_method: 'PHONE',
    next_follow_up_at: null,
    wechat_add_status: 'NOT_ADDED',
    intent_level: 'UNKNOWN',
    payment_status: 'NOT_STARTED',
    time_parse_status: 'NOT_PARSED',
    last_feedback_type: 'UNKNOWN',
  };
}

export async function findCustomerByPhoneNumber(
  db: DatabaseLike,
  phoneNumber: string | null | undefined,
): Promise<Customer | null> {
  const normalized = phoneNumber?.trim();
  if (!normalized) return null;

  const rows = await db.select<Customer>(
    'SELECT * FROM customers WHERE phone_number = ?',
    [normalized],
  );
  return rows[0] || null;
}

export async function findCustomersByName(
  db: DatabaseLike,
  name: string | null | undefined,
): Promise<Customer[]> {
  const normalized = name?.trim();
  if (!normalized) return [];

  return db.select<Customer>(
    'SELECT * FROM customers WHERE name = ?',
    [normalized],
  );
}

export async function insertCustomerWithDb(
  db: DatabaseLike,
  input: LeadWorkbenchCustomerInput,
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, contact_method, wechat_id,
     phone_number, wechat_search_status, is_key_decision_maker, wechat_add_status, has_replied,
     intent_level, phone_feedback, can_schedule_visit, visit_scheduled_at,
     rough_visit_time_text, parsed_visit_reminder_at, time_parse_status,
     time_parse_note, next_follow_up_at, last_contacted_at, last_feedback_type,
     next_action, no_show_count, lost_reason, payment_status, deal_amount,
     paid_at, closed_at, website, region, industry,
     contact_person, email, address, pitch_angle, qualification_reason, source,
     notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.customer_grade,
      input.stage,
      input.contact_method,
      null,
      input.phone_number,
      null,
      0,
      input.wechat_add_status,
      0,
      input.intent_level,
      null,
      0,
      null,
      null,
      null,
      input.time_parse_status,
      null,
      input.next_follow_up_at,
      null,
      input.last_feedback_type,
      null,
      0,
      null,
      input.payment_status,
      null,
      null,
      null,
      input.website,
      input.region,
      input.industry,
      input.contact_person,
      input.email,
      null,
      null,
      input.qualification_reason,
      input.source,
      input.notes,
      now,
      now,
    ],
  );

  return id;
}

function mapLeadGradeToCustomerGrade(leadGrade: string | null): CustomerGrade {
  switch (leadGrade) {
    case 'S':
      return 'B';
    case 'A':
    case 'B':
      return 'C';
    case 'C':
      return 'D';
    default:
      return 'C';
  }
}

function buildSource(options: BuildCustomerInputOptions): string | null {
  const parts = [options.batchType, options.sourceLabel]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' / ') : null;
}

function buildNotes(importRow: LeadImportRow): string | null {
  const parts: string[] = [];

  if (importRow.source_evidence) {
    parts.push(importRow.source_evidence);
  }
  if (importRow.raw_data_json) {
    parts.push(importRow.raw_data_json);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
