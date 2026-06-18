import type { DatabaseLike } from '../db';
import type { ClipboardReader, ClipboardWriter } from '../clipboard';
import { insertLeadCaptureEvent, type LeadCaptureEvent } from './captureEvents';
import { insertCollectedLeadDraft } from './collectedLeads';
import { getLeadWorkItemById } from './db';
import { parseLeadContactText } from './parser';
import type { LeadWorkStatus } from './types';
import { updateLeadWorkItemStatus } from './workItemActions';

export type LeadClipboardPreview = {
  mobiles: string[];
  tels: string[];
  urls: string[];
  emails: string[];
  contacts: string[];
  possibleContact: string[];
  note: string;
  raw_text: string;
  hasStructuredInfo: boolean;
};

export type SaveLeadCaptureInput = {
  workItemId: string;
  rawText: string;
};

export type SaveCollectedLeadInput = {
  workItemId: string;
  captureEventId: string;
  draft?: {
    contact_name?: string | null;
    position?: string | null;
    mobile?: string | null;
    tel?: string | null;
    website?: string | null;
    email?: string | null;
    note?: string | null;
  };
};

export type StartLeadQueryResult = {
  ok: boolean;
  message: string;
  keyword: string;
  new_status: LeadWorkStatus;
};

export type LeadCaptureSaveEvidence = {
  capture_event_id: string;
  saved_to: 'lead_capture_events';
  work_item_id: string;
  company_name: string;
  phone: string | null;
  email: string | null;
  new_status: 'STAGED';
  next_actions: ['保存为采集线索草稿', '继续下一条'];
};

export type CollectedLeadSaveEvidence = {
  collected_lead_id: string;
  capture_event_id: string;
  saved_to: 'collected_leads';
  work_item_id: string;
  company_name: string;
  phone: string | null;
  email: string | null;
  new_status: 'COLLECTED';
  existing: boolean;
};

export async function startLeadQueryWorkflow(
  db: DatabaseLike,
  workItemId: string,
  clipboard: ClipboardWriter,
): Promise<StartLeadQueryResult> {
  const item = await requireWorkItem(db, workItemId);
  const keyword = item.tanji_search_keyword?.trim() || item.company_name?.trim() || '';

  try {
    if (!keyword) throw new Error('Search keyword unavailable');
    await clipboard.writeText(keyword);
  } catch {
    return {
      ok: false,
      message: '复制失败，请手动复制后重试',
      keyword,
      new_status: item.status,
    };
  }

  try {
    const updated = await updateLeadWorkItemStatus(db, item.id, 'SEARCHING');
    return {
      ok: true,
      message: '已复制搜索词，并将任务标记为查询中',
      keyword,
      new_status: updated.status,
    };
  } catch {
    return {
      ok: false,
      message: '搜索词已复制，但任务状态更新失败',
      keyword,
      new_status: item.status,
    };
  }
}

export async function readLeadClipboard(clipboard: ClipboardReader): Promise<{
  ok: boolean;
  message: string;
  text: string;
  preview: LeadClipboardPreview;
}> {
  let text = '';
  try {
    text = await clipboard.readText();
  } catch {
    return {
      ok: false,
      message: '读取剪贴板失败，请检查系统权限',
      text: '',
      preview: buildPreview(''),
    };
  }

  if (!text.trim()) {
    return {
      ok: false,
      message: '剪贴板为空',
      text,
      preview: buildPreview(text),
    };
  }

  const preview = buildPreview(text);
  return {
    ok: preview.hasStructuredInfo,
    message: preview.hasStructuredInfo ? '已读取剪贴板并完成解析预览' : '已读取剪贴板，但未识别到手机号或邮箱',
    text,
    preview,
  };
}

export async function saveLeadCaptureWorkflow(
  db: DatabaseLike,
  input: SaveLeadCaptureInput,
): Promise<LeadCaptureSaveEvidence> {
  const item = await requireWorkItem(db, input.workItemId);
  const preview = buildPreview(input.rawText);
  if (preview.mobiles.length === 0 && preview.emails.length === 0) {
    throw new Error('未识别到有效手机号或邮箱，不能保存捕获记录');
  }

  const event = await insertLeadCaptureEvent(db, {
    work_item_id: item.id,
    raw_text: input.rawText,
    parsed_json: preview,
    confidence_json: {},
    action: 'CAPTURE_SAVED',
  });
  const updated = await requireWorkItem(db, item.id);
  if (updated.status !== 'STAGED') {
    throw new Error(`捕获记录已保存，但任务状态未进入待整理：${updated.status}`);
  }

  return {
    capture_event_id: event.id,
    saved_to: 'lead_capture_events',
    work_item_id: item.id,
    company_name: item.company_name?.trim() || '未命名公司',
    phone: preview.mobiles[0] ?? null,
    email: preview.emails[0] ?? null,
    new_status: 'STAGED',
    next_actions: ['保存为采集线索草稿', '继续下一条'],
  };
}

export async function saveCollectedLeadWorkflow(
  db: DatabaseLike,
  input: SaveCollectedLeadInput,
): Promise<CollectedLeadSaveEvidence> {
  const item = await requireWorkItem(db, input.workItemId);
  const capture = await requireCaptureEvent(db, input.captureEventId, item.id);
  const preview = parseStoredPreview(capture);
  const draft = await insertCollectedLeadDraft(db, {
    work_item_id: item.id,
    capture_event_id: capture.id,
    import_row_id: item.import_row_id,
    customer_id: item.customer_id,
    company_name: item.company_name,
    contact_name: input.draft?.contact_name ?? preview.possibleContact[0] ?? null,
    position: input.draft?.position ?? null,
    mobile: input.draft?.mobile ?? preview.mobiles[0] ?? null,
    tel: input.draft?.tel ?? preview.tels[0] ?? null,
    website: input.draft?.website ?? preview.urls[0] ?? null,
    email: input.draft?.email ?? preview.emails[0] ?? null,
    raw_text: capture.raw_text,
    note: input.draft?.note ?? (preview.note || capture.raw_text),
  });

  const updated = await requireWorkItem(db, item.id);
  if (updated.status !== 'COLLECTED') {
    throw new Error(`采集线索草稿已保存，但任务状态未进入已采集：${updated.status}`);
  }

  return {
    collected_lead_id: draft.id,
    capture_event_id: capture.id,
    saved_to: 'collected_leads',
    work_item_id: item.id,
    company_name: item.company_name?.trim() || '未命名公司',
    phone: draft.mobile ?? draft.tel ?? null,
    email: draft.email,
    new_status: 'COLLECTED',
    existing: draft.existing,
  };
}

function buildPreview(rawText: string): LeadClipboardPreview {
  const parsed = parseLeadContactText(rawText);
  return {
    mobiles: parsed.mobiles,
    tels: parsed.tels,
    urls: parsed.urls,
    emails: parsed.emails,
    contacts: parsed.contacts,
    possibleContact: parsed.possibleContacts,
    note: rawText.trim(),
    raw_text: rawText,
    hasStructuredInfo: parsed.mobiles.length > 0 || parsed.emails.length > 0,
  };
}

async function requireWorkItem(db: DatabaseLike, workItemId: string) {
  const item = await getLeadWorkItemById(db, workItemId.trim());
  if (!item) throw new Error(`Lead work item not found: ${workItemId}`);
  return item;
}

async function requireCaptureEvent(
  db: DatabaseLike,
  captureEventId: string,
  workItemId: string,
): Promise<LeadCaptureEvent> {
  const rows = await db.select<LeadCaptureEvent>(
    'SELECT * FROM lead_capture_events WHERE id = ? AND work_item_id = ? LIMIT 1',
    [captureEventId.trim(), workItemId],
  );
  if (!rows[0]) throw new Error(`Lead capture event not found: ${captureEventId}`);
  return rows[0];
}

function parseStoredPreview(capture: LeadCaptureEvent): LeadClipboardPreview {
  try {
    const parsed = JSON.parse(capture.parsed_json) as Partial<LeadClipboardPreview>;
    return {
      mobiles: stringArray(parsed.mobiles),
      tels: stringArray(parsed.tels),
      urls: stringArray(parsed.urls),
      emails: stringArray(parsed.emails),
      contacts: stringArray(parsed.contacts),
      possibleContact: stringArray(parsed.possibleContact),
      note: typeof parsed.note === 'string' ? parsed.note : capture.raw_text.trim(),
      raw_text: capture.raw_text,
      hasStructuredInfo: true,
    };
  } catch {
    return buildPreview(capture.raw_text);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
