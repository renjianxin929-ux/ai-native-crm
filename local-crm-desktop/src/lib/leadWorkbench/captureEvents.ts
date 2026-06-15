import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import type { LeadCaptureAction } from './types';

export interface LeadCaptureEvent {
  id: string;
  work_item_id: string;
  raw_text: string;
  parsed_json: string;
  confidence_json: string;
  action: LeadCaptureAction;
  created_at: string;
}

export interface InsertLeadCaptureEventInput {
  work_item_id: string;
  raw_text: string;
  parsed_json: unknown;
  confidence_json?: unknown;
  action: LeadCaptureAction;
}

export async function insertLeadCaptureEvent(
  db: DatabaseLike,
  input: InsertLeadCaptureEventInput,
): Promise<LeadCaptureEvent> {
  const workItemId = input.work_item_id.trim();
  const rawText = input.raw_text.trim();

  if (!workItemId) {
    throw new Error('work_item_id is required');
  }
  if (!rawText) {
    throw new Error('raw_text is required');
  }

  const parsedJson = serializeJson(input.parsed_json, 'parsed_json');
  const confidenceJson = serializeJson(input.confidence_json ?? {}, 'confidence_json');
  const event: LeadCaptureEvent = {
    id: uuidv4(),
    work_item_id: workItemId,
    raw_text: input.raw_text,
    parsed_json: parsedJson,
    confidence_json: confidenceJson,
    action: input.action,
    created_at: new Date().toISOString(),
  };

  await db.execute(
    `INSERT INTO lead_capture_events (
      id, work_item_id, raw_text, parsed_json, confidence_json, action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.work_item_id,
      event.raw_text,
      event.parsed_json,
      event.confidence_json,
      event.action,
      event.created_at,
    ],
  );

  return event;
}

export async function listLeadCaptureEventsByWorkItemId(
  db: DatabaseLike,
  workItemId: string,
  limit = 50,
): Promise<LeadCaptureEvent[]> {
  return db.select<LeadCaptureEvent>(
    'SELECT * FROM lead_capture_events WHERE work_item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    [workItemId, limit],
  );
}

function serializeJson(value: unknown, fieldName: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new Error(`${fieldName} must be serializable`);
  }
}
