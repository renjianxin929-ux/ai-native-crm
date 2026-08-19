import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Clipboard, PhoneOff, RefreshCw, Search, SkipForward } from 'lucide-react';

import {
  createSystemClipboardAdapter,
  type ClipboardWriter,
} from '../lib/clipboard';
import { getDb } from '../lib/db';
import { compareInstant } from '../lib/time/instantCompare';
import {
  listLeadCaptureEventsByWorkItemId,
  type LeadCaptureEvent,
} from '../lib/leadWorkbench/captureEvents';
import {
  createEmptyCollectedLeadSyncStatusCounts,
  getCollectedLeadSyncStatusCounts,
  listCollectedLeadsByWorkItemId,
  type CollectedLead,
  type CollectedLeadSyncStatusCounts,
} from '../lib/leadWorkbench/collectedLeads';
import {
  getLeadWorkItemStatusCounts,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { parseLeadContactText } from '../lib/leadWorkbench/parser';
import {
  readLeadClipboard,
  saveCollectedLeadWorkflow,
  saveLeadCaptureWorkflow,
  startLeadQueryWorkflow,
  type CollectedLeadSaveEvidence,
  type LeadCaptureSaveEvidence,
} from '../lib/leadWorkbench/workflow';
import {
  createEmptyLeadSyncLogStatusCounts,
  getLeadSyncLogStatusCounts,
  listLeadSyncReplayEvidence,
  syncCollectedLeadCreateCustomer,
  syncCollectedLeadEnrichCustomer,
  type LeadSyncReplayEvidence,
  type LeadSyncLogStatusCounts,
  type SyncCollectedLeadCreateCustomerResult,
  type SyncCollectedLeadEnrichCustomerResult,
} from '../lib/leadWorkbench/syncAdapter';
import { updateLeadWorkItemStatus } from '../lib/leadWorkbench/workItemActions';
import type { LeadSyncStatus, LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../lib/verticalProfiles';

export const LEAD_WORKBENCH_STATUS_FILTERS: LeadWorkStatus[] = [
  'TODO',
  'SEARCHING',
  'STAGED',
  'COLLECTED',
  'NO_PHONE',
  'SKIPPED',
  'DONE',
];

const COLLECTED_LEAD_SYNC_STATUSES: CollectedLead['sync_status'][] = [
  'UNSYNCED',
  'SYNCED',
  'FAILED',
  'IGNORED',
];

const LEAD_SYNC_LOG_STATUSES: LeadSyncStatus[] = [
  'SUCCESS',
  'FAILED',
  'SKIPPED',
];

type LeadWorkbenchPresentationOptions = {
  profile?: VerticalRuleProfile;
};

function resolveWorkbenchProfile(options: LeadWorkbenchPresentationOptions = {}): VerticalRuleProfile {
  return options.profile ?? getActiveVerticalProfile();
}

export function formatLeadWorkStatusLabel(
  status: LeadWorkStatus,
  options: LeadWorkbenchPresentationOptions = {},
): string {
  return resolveWorkbenchProfile(options).workItem.statusLabels[status];
}

export function formatCollectedLeadSyncStatusLabel(status: CollectedLead['sync_status']): string {
  switch (status) {
    case 'UNSYNCED':
      return '未同步';
    case 'SYNCED':
      return '已同步';
    case 'FAILED':
      return '同步失败';
    case 'IGNORED':
      return '已忽略';
  }
}

export function getLeadWorkbenchActionLabels(
  options: LeadWorkbenchPresentationOptions = {},
): string[] {
  const labels = resolveWorkbenchProfile(options).workItem.actionLabels;
  return [
    labels.copySearchKeyword,
    labels.startSearch,
    labels.noPhone,
    labels.skip,
  ];
}

export type LeadWorkbenchRealityStatRow = {
  label: string;
  count: number;
};

export type LeadSyncReplayEvidenceDisplayRow = {
  logId: string;
  collectedLeadId: string;
  title: string;
  details: string[];
};

export function buildLeadWorkbenchRealityStatRows(input: {
  collectedLeadSyncCounts: CollectedLeadSyncStatusCounts;
  syncLogStatusCounts: LeadSyncLogStatusCounts;
}): LeadWorkbenchRealityStatRow[] {
  return [
    ...COLLECTED_LEAD_SYNC_STATUSES.map(status => ({
      label: `collected_leads ${status}`,
      count: input.collectedLeadSyncCounts[status],
    })),
    ...LEAD_SYNC_LOG_STATUSES.map(status => ({
      label: `lead_sync_logs ${status}`,
      count: input.syncLogStatusCounts[status],
    })),
  ];
}

export function filterLeadSyncReplayEvidenceForWorkItem(
  rows: LeadSyncReplayEvidence[],
  workItemId: string | null,
): LeadSyncReplayEvidence[] {
  if (!workItemId) return [];
  return rows.filter(row => row.work_item_id === workItemId);
}

export function formatLeadSyncReplayEvidenceRows(
  rows: LeadSyncReplayEvidence[],
): LeadSyncReplayEvidenceDisplayRow[] {
  return rows.map(row => {
    const details = [
      `sync status: ${row.status}`,
      `sync action: ${row.action}`,
      `sync message: ${formatReplayEvidenceValue(row.message, 'No sync message')}`,
      `collected lead sync status: ${row.collected_sync_status}`,
      `linked work item: ${formatReplayEvidenceValue(row.work_item_id, 'Not linked')}`,
      `linked work item status: ${formatReplayEvidenceValue(row.work_item_status, 'Not linked')}`,
      `collected raw text: ${formatReplayEvidenceValue(row.collected_raw_text, 'No collected raw text')}`,
      `capture_event_id: ${formatReplayEvidenceValue(row.capture_event_id, 'Not linked')}`,
      `capture raw text: ${formatReplayEvidenceValue(row.capture_raw_text, 'No capture source')}`,
      `import row: ${formatReplayEvidenceValue(row.import_row_id, 'Not linked')}`,
      `import row decision status: ${formatReplayEvidenceValue(row.import_row_decision_status, 'Not linked')}`,
      `target_customer_id: ${formatReplayEvidenceValue(row.target_customer_id, 'Not linked')}`,
      `created_customer_id: ${formatReplayEvidenceValue(row.created_customer_id, 'Not linked')}`,
      `updated_customer_id: ${formatReplayEvidenceValue(row.updated_customer_id, 'Not linked')}`,
      `created_at: ${row.created_at}`,
    ];
    const errorReason = row.import_row_error_message?.trim()
      || (row.status === 'SUCCESS' ? '' : row.message.trim());
    if (errorReason) {
      details.push(`error reason: ${errorReason}`);
    }

    return {
      logId: row.log_id,
      collectedLeadId: row.collected_lead_id,
      title: `${row.status} / ${row.action} / ${row.created_at}`,
      details,
    };
  });
}

function formatReplayEvidenceValue(value: string | number | null | undefined, empty: string): string {
  const normalized = typeof value === 'number' ? String(value) : value?.trim() || '';
  return normalized || empty;
}

export type LeadWorkItemStatusAction = {
  label: string;
  nextStatus: LeadWorkStatus;
  icon: 'search' | 'phone-off' | 'skip';
};

type ConfirmFn = (message: string) => boolean;

export type LeadPastePreviewResult = {
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

export type LeadPastePreviewState = {
  text: string;
  result: LeadPastePreviewResult | null;
};

export type CollectedLeadDraftForm = {
  work_item_id: string;
  import_row_id: string | null;
  customer_id: string | null;
  company_name: string;
  contact_name: string;
  position: string;
  mobile: string;
  tel: string;
  website: string;
  email: string;
  raw_text: string;
  note: string;
  contactNameSuggestion: string;
};

export function filterLeadWorkItemsByStatus(
  items: LeadWorkItem[],
  status: LeadWorkStatus,
): LeadWorkItem[] {
  return items.filter(item => item.status === status);
}

export function sortLeadWorkItemsForDisplay(items: LeadWorkItem[]): LeadWorkItem[] {
  return [...items].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    return compareInstant(left.created_at, right.created_at);
  });
}

export function getLeadWorkbenchListEmptyMessage(
  totalTaskCount: number,
  _status: LeadWorkStatus,
): string {
  if (totalTaskCount === 0) {
    return '暂无获客任务，请先在导入分流中心执行分流。';
  }
  return '当前状态下暂无任务。';
}

export function getLeadWorkbenchDetailEmptyMessage(): string {
  return '请选择左侧任务查看详情。';
}

export function getLeadCaptureHistoryEmptyMessage(): string {
  return '暂无捕获记录。';
}

export function getLeadCaptureSaveSuccessMessage(): string {
  return '捕获记录已保存';
}

export function getLeadCaptureSaveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getCollectedLeadDraftSaveSuccessMessage(): string {
  return '采集线索草稿已保存';
}

export function getCollectedLeadDraftSaveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getCollectedLeadDraftHistoryEmptyMessage(): string {
  return '暂无采集线索草稿。';
}

export function isCollectedLeadDraftHistoryVisible(item: LeadWorkItem | null): boolean {
  return Boolean(item);
}

export function getCollectedLeadDraftDisplayValue(value: string | number | null): string {
  const normalized = typeof value === 'number' ? String(value) : value?.trim() || '';
  return normalized || '-';
}

export function getCollectedLeadDraftNoteSummary(note: string | null): string {
  const value = note?.trim() || '';
  if (!value) return '-';
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

export function getCollectedLeadCreateCustomerActionLabel(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status'>,
): string | null {
  if (draft.customer_id) return null;
  if (draft.sync_status === 'UNSYNCED') return '创建 CRM 客户';
  if (draft.sync_status === 'FAILED') return '重试创建 CRM 客户';
  return null;
}

export function getCollectedLeadCreateCustomerStateLabel(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status'>,
): string | null {
  if (draft.sync_status === 'SYNCED') return '已同步';
  if (draft.sync_status === 'IGNORED') return '已忽略';
  return null;
}

export function getCollectedLeadEnrichCustomerActionLabel(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status'>,
): string | null {
  if (!draft.customer_id) return null;
  if (draft.sync_status === 'UNSYNCED') return '补充已有客户';
  if (draft.sync_status === 'FAILED') return '重试补充已有客户';
  return null;
}

export function getCollectedLeadEnrichCustomerStateLabel(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status'>,
): string | null {
  if (!draft.customer_id) return null;
  if (draft.sync_status === 'SYNCED') return '已同步';
  if (draft.sync_status === 'IGNORED') return '已忽略';
  return null;
}

export function getCollectedLeadCreateCustomerConfirmationMessage(
  draft: Pick<CollectedLead, 'company_name' | 'contact_name' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>,
): string {
  return [
    '确认创建 CRM 客户？',
    `company_name: ${getCollectedLeadDraftDisplayValue(draft.company_name)}`,
    `contact_name: ${getCollectedLeadDraftDisplayValue(draft.contact_name)}`,
    `mobile / tel: ${getCollectedLeadDraftDisplayValue(draft.mobile)} / ${getCollectedLeadDraftDisplayValue(draft.tel)}`,
    `website: ${getCollectedLeadDraftDisplayValue(draft.website)}`,
    `email: ${getCollectedLeadDraftDisplayValue(draft.email)}`,
    `note 摘要: ${getCollectedLeadDraftNoteSummary(draft.note)}`,
    '将创建新的 CRM 客户，不会补充已有客户。',
  ].join('\n');
}

export function shouldRunCollectedLeadCreateCustomer(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status' | 'company_name' | 'contact_name' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>,
  confirm: ConfirmFn,
): boolean {
  if (!getCollectedLeadCreateCustomerActionLabel(draft)) return false;
  return confirm(getCollectedLeadCreateCustomerConfirmationMessage(draft));
}

export type WorkbenchCollectedLeadCreateCustomerSyncResult =
  | { status: 'CANCELLED' }
  | { status: 'EXECUTED'; result: SyncCollectedLeadCreateCustomerResult; message: string };

export async function syncCollectedLeadCreateCustomerFromWorkbench(input: {
  draft: CollectedLead;
  confirm: ConfirmFn;
  sync: (collectedLeadId: string) => Promise<SyncCollectedLeadCreateCustomerResult>;
  refreshDrafts: (workItemId: string) => Promise<void>;
  refreshItems: (status: LeadWorkStatus) => Promise<void>;
  selectedStatus?: LeadWorkStatus;
  fallbackWorkItemId?: string | null;
  onConfirmed?: () => void;
}): Promise<WorkbenchCollectedLeadCreateCustomerSyncResult> {
  if (!shouldRunCollectedLeadCreateCustomer(input.draft, input.confirm)) {
    return { status: 'CANCELLED' };
  }

  input.onConfirmed?.();
  const result = await input.sync(input.draft.id);
  const workItemId = input.draft.work_item_id ?? input.fallbackWorkItemId;
  if (workItemId) {
    await input.refreshDrafts(workItemId);
  }
  await input.refreshItems(input.selectedStatus ?? 'COLLECTED');

  return {
    status: 'EXECUTED',
    result,
    message: getCollectedLeadCreateCustomerResultMessage(result),
  };
}

export function getCollectedLeadCreateCustomerResultMessage(
  result: SyncCollectedLeadCreateCustomerResult,
): string {
  if (result.status === 'SUCCESS') {
    return `CRM 客户创建成功：${getCollectedLeadDraftDisplayValue(result.targetCustomerId ?? null)}`;
  }
  if (result.status === 'DUPLICATE_PHONE' || result.status === 'DUPLICATE_NAME') {
    return `发现重复客户，未创建 CRM 客户：${result.message}`;
  }
  return result.message;
}

export function getCollectedLeadCreateCustomerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getCollectedLeadEnrichCustomerConfirmationMessage(
  draft: Pick<CollectedLead, 'company_name' | 'customer_id' | 'contact_name' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>,
): string {
  return [
    '确认补充已有客户？将补充已有 CRM 客户。',
    `company_name: ${getCollectedLeadDraftDisplayValue(draft.company_name)}`,
    `customer_id: ${getCollectedLeadDraftDisplayValue(draft.customer_id)}`,
    `contact_name: ${getCollectedLeadDraftDisplayValue(draft.contact_name)}`,
    `mobile / tel: ${getCollectedLeadDraftDisplayValue(draft.mobile)} / ${getCollectedLeadDraftDisplayValue(draft.tel)}`,
    `website: ${getCollectedLeadDraftDisplayValue(draft.website)}`,
    `email: ${getCollectedLeadDraftDisplayValue(draft.email)}`,
    `note 摘要: ${getCollectedLeadDraftNoteSummary(draft.note)}`,
    '只补充空字段。只补充已有客户的空字段，不覆盖已有电话、联系人、等级、阶段、source。',
  ].join('\n');
}

export function shouldRunCollectedLeadEnrichCustomer(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status' | 'company_name' | 'contact_name' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>,
  confirm: ConfirmFn,
): boolean {
  if (!getCollectedLeadEnrichCustomerActionLabel(draft)) return false;
  return confirm(getCollectedLeadEnrichCustomerConfirmationMessage(draft));
}

export function getCollectedLeadEnrichCustomerResultMessage(
  result: SyncCollectedLeadEnrichCustomerResult,
): string {
  if (result.status === 'SUCCESS') {
    return `已有客户补充成功：${getCollectedLeadDraftDisplayValue(result.targetCustomerId ?? null)}`;
  }
  return result.message;
}

export function getCollectedLeadEnrichCustomerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isLeadCaptureHistoryVisible(item: LeadWorkItem | null): boolean {
  return Boolean(item);
}

export function getLeadCaptureRawTextSummary(rawText: string): string {
  return rawText.length > 120 ? `${rawText.slice(0, 120)}...` : rawText;
}

export function getLeadCaptureParsedSummary(parsedJson: string): string {
  try {
    const parsed = JSON.parse(parsedJson) as Record<string, unknown>;
    const values = [
      ...stringArrayFromUnknown(parsed.mobiles),
      ...stringArrayFromUnknown(parsed.tels),
      ...stringArrayFromUnknown(parsed.urls),
      ...stringArrayFromUnknown(parsed.emails),
      ...stringArrayFromUnknown(parsed.possibleContact),
      ...stringArrayFromUnknown(parsed.possibleContacts),
    ];
    return values.length > 0 ? values.join(' / ') : '-';
  } catch {
    return '-';
  }
}

export function isLeadPastePreviewVisible(item: LeadWorkItem | null): boolean {
  return Boolean(item);
}

export function getEmptyLeadPastePreviewState(): LeadPastePreviewState {
  return { text: '', result: null };
}

export function getNoStructuredLeadPastePreviewMessage(): string {
  return '未识别到电话、网址或邮箱，可作为备注参考。';
}

export function buildLeadPastePreviewResult(rawText: string): LeadPastePreviewResult {
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
    hasStructuredInfo: parsed.mobiles.length > 0
      || parsed.tels.length > 0
      || parsed.urls.length > 0
      || parsed.emails.length > 0,
  };
}

export function buildCollectedLeadDraftForm(
  item: LeadWorkItem,
  rawText: string,
  previewResult: LeadPastePreviewResult,
): CollectedLeadDraftForm {
  return {
    work_item_id: item.id,
    import_row_id: item.import_row_id,
    customer_id: item.customer_id,
    company_name: item.company_name?.trim() || '',
    contact_name: '',
    position: '',
    mobile: previewResult.mobiles[0] || '',
    tel: previewResult.tels[0] || '',
    website: previewResult.urls[0] || '',
    email: previewResult.emails[0] || '',
    raw_text: rawText,
    note: previewResult.note,
    contactNameSuggestion: previewResult.possibleContact[0] || '',
  };
}

export function shouldEnableCollectedLeadDraftSave(
  item: LeadWorkItem | null,
  previewResult: LeadPastePreviewResult | null,
  draft: CollectedLeadDraftForm | null,
): boolean {
  if (!item || !previewResult || !draft) return false;
  return [
    draft.mobile,
    draft.tel,
    draft.website,
    draft.email,
    draft.contact_name,
    draft.note,
  ].some(value => value.trim());
}

export function getCollectedLeadDraftSaveConfirmationMessage(
  item: Pick<LeadWorkItem, 'company_name'>,
): string {
  const companyName = item.company_name?.trim() || '未命名公司';
  return `确认将「${companyName}」保存为采集线索草稿吗？`;
}

export function shouldRunCollectedLeadDraftSave(
  item: Pick<LeadWorkItem, 'company_name'>,
  confirm: ConfirmFn,
): boolean {
  return confirm(getCollectedLeadDraftSaveConfirmationMessage(item));
}

export function shouldEnableLeadCaptureSave(
  item: LeadWorkItem | null,
  rawText: string,
  previewResult: LeadPastePreviewResult | null,
): boolean {
  return Boolean(
    item
    && rawText.trim()
    && previewResult
    && (previewResult.mobiles.length > 0 || previewResult.emails.length > 0),
  );
}

export function getLeadCaptureSaveConfirmationMessage(
  item: Pick<LeadWorkItem, 'company_name'>,
): string {
  const companyName = item.company_name?.trim() || '未命名公司';
  return `确认将「${companyName}」的当前粘贴内容保存为捕获记录吗？`;
}

export function shouldRunLeadCaptureSave(
  item: Pick<LeadWorkItem, 'company_name'>,
  confirm: ConfirmFn,
): boolean {
  return confirm(getLeadCaptureSaveConfirmationMessage(item));
}

export function getSuggestedTanjiSearchKeyword(
  item: Pick<LeadWorkItem, 'tanji_search_keyword' | 'company_name'>,
): string {
  const configuredKeyword = item.tanji_search_keyword?.trim();
  return configuredKeyword || item.company_name?.trim() || '';
}

export function hasConfiguredTanjiSearchKeyword(
  item: Pick<LeadWorkItem, 'tanji_search_keyword'>,
): boolean {
  return Boolean(item.tanji_search_keyword?.trim());
}

export function isLeadWorkItemTerminalStatus(status: LeadWorkStatus): boolean {
  return status === 'NO_PHONE' || status === 'SKIPPED' || status === 'DONE';
}

export function getLeadWorkItemTerminalMessage(
  status: LeadWorkStatus,
  options: LeadWorkbenchPresentationOptions = {},
): string | null {
  return resolveWorkbenchProfile(options).workItem.terminalMessages[status] ?? null;
}

export function getLeadWorkItemStatusActions(
  status: LeadWorkStatus,
  options: LeadWorkbenchPresentationOptions = {},
): LeadWorkItemStatusAction[] {
  if (isLeadWorkItemTerminalStatus(status)) return [];
  const labels = resolveWorkbenchProfile(options).workItem.actionLabels;

  if (status === 'TODO') {
    return [
      { label: labels.startSearch, nextStatus: 'SEARCHING', icon: 'search' },
      { label: labels.noPhone, nextStatus: 'NO_PHONE', icon: 'phone-off' },
      { label: labels.skip, nextStatus: 'SKIPPED', icon: 'skip' },
    ];
  }

  if (status === 'SEARCHING') {
    return [
      { label: labels.noPhone, nextStatus: 'NO_PHONE', icon: 'phone-off' },
      { label: labels.skip, nextStatus: 'SKIPPED', icon: 'skip' },
    ];
  }

  if (status === 'STAGED') {
    return [{ label: labels.skip, nextStatus: 'SKIPPED', icon: 'skip' }];
  }

  return [];
}

export function getStatusActionConfirmationMessage(
  item: Pick<LeadWorkItem, 'company_name'>,
  nextStatus: LeadWorkStatus,
  options: LeadWorkbenchPresentationOptions = {},
): string | null {
  const companyName = item.company_name?.trim() || '未命名公司';
  const template = resolveWorkbenchProfile(options).workItem.confirmationMessages[nextStatus];
  return template ? template.replace('{{companyName}}', companyName) : null;
}

export function shouldRunLeadWorkItemStatusUpdate(
  item: Pick<LeadWorkItem, 'company_name' | 'status'>,
  nextStatus: LeadWorkStatus,
  confirm: ConfirmFn,
): boolean {
  if (isLeadWorkItemTerminalStatus(item.status)) return false;

  const confirmationMessage = getStatusActionConfirmationMessage(item, nextStatus);
  if (!confirmationMessage) return true;

  return confirm(confirmationMessage);
}

export function getLeadWorkItemStatusUpdateSuccessMessage(
  nextStatus: LeadWorkStatus,
  options: LeadWorkbenchPresentationOptions = {},
): string {
  const profile = resolveWorkbenchProfile(options);
  return `${profile.workItem.statusUpdateSuccessPrefix} ${formatLeadWorkStatusLabel(nextStatus, { profile })}`;
}

export async function copyLeadSearchKeyword(
  item: Pick<LeadWorkItem, 'tanji_search_keyword' | 'company_name'>,
  clipboard?: ClipboardWriter,
): Promise<{ ok: boolean; message: string }> {
  const keyword = getSuggestedTanjiSearchKeyword(item);
  try {
    if (!clipboard || !keyword) {
      throw new Error('Clipboard unavailable');
    }
    await clipboard.writeText(keyword);
    return { ok: true, message: '已复制搜索词' };
  } catch {
    return { ok: false, message: '复制失败，请手动复制' };
  }
}

function emptyStatusCounts(): Record<LeadWorkStatus, number> {
  return {
    TODO: 0,
    SEARCHING: 0,
    STAGED: 0,
    COLLECTED: 0,
    NO_PHONE: 0,
    SKIPPED: 0,
    DONE: 0,
  };
}

function getTotalStatusCount(counts: Record<LeadWorkStatus, number>): number {
  return LEAD_WORKBENCH_STATUS_FILTERS.reduce((total, status) => total + counts[status], 0);
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

export default function LeadWorkbenchPage() {
  const [statusFilter, setStatusFilter] = useState<LeadWorkStatus>('TODO');
  const [items, setItems] = useState<LeadWorkItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<LeadWorkStatus, number>>(emptyStatusCounts);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSavingCapture, setIsSavingCapture] = useState(false);
  const [isSavingCollectedLead, setIsSavingCollectedLead] = useState(false);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [isSyncingCollectedLeadId, setIsSyncingCollectedLeadId] = useState<string | null>(null);
  const [collectedLeadSyncCounts, setCollectedLeadSyncCounts] = useState(createEmptyCollectedLeadSyncStatusCounts);
  const [syncLogStatusCounts, setSyncLogStatusCounts] = useState(createEmptyLeadSyncLogStatusCounts);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pastePreviewState, setPastePreviewState] = useState<LeadPastePreviewState>(getEmptyLeadPastePreviewState);
  const [collectedLeadDraft, setCollectedLeadDraft] = useState<CollectedLeadDraftForm | null>(null);
  const [captureEvents, setCaptureEvents] = useState<LeadCaptureEvent[]>([]);
  const [collectedLeadDrafts, setCollectedLeadDrafts] = useState<CollectedLead[]>([]);
  const [leadSyncReplayEvidence, setLeadSyncReplayEvidence] = useState<LeadSyncReplayEvidence[]>([]);
  const [isLoadingReplayEvidence, setIsLoadingReplayEvidence] = useState(false);
  const [replayEvidenceError, setReplayEvidenceError] = useState<string | null>(null);
  const [captureSaveEvidence, setCaptureSaveEvidence] = useState<LeadCaptureSaveEvidence | null>(null);
  const [collectedLeadSaveEvidence, setCollectedLeadSaveEvidence] = useState<CollectedLeadSaveEvidence | null>(null);

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedItemId) || null,
    [items, selectedItemId],
  );

  const totalTaskCount = useMemo(() => getTotalStatusCount(counts), [counts]);
  const visibleItems = useMemo(() => sortLeadWorkItemsForDisplay(items), [items]);
  const workbenchActionLabels = getLeadWorkbenchActionLabels();
  const realityStatRows = useMemo(() => buildLeadWorkbenchRealityStatRows({
    collectedLeadSyncCounts,
    syncLogStatusCounts,
  }), [collectedLeadSyncCounts, syncLogStatusCounts]);
  const selectedLeadSyncReplayEvidence = useMemo(
    () => filterLeadSyncReplayEvidenceForWorkItem(leadSyncReplayEvidence, selectedItemId),
    [leadSyncReplayEvidence, selectedItemId],
  );

  const loadItems = useCallback(async (status: LeadWorkStatus) => {
    setIsLoading(true);
    setError(null);
    try {
      const db = await getDb();
      const [
        nextItems,
        nextCounts,
        nextCollectedLeadSyncCounts,
        nextSyncLogStatusCounts,
      ] = await Promise.all([
        listLeadWorkItemsByStatus(db, status),
        getLeadWorkItemStatusCounts(db),
        getCollectedLeadSyncStatusCounts(db),
        getLeadSyncLogStatusCounts(db),
      ]);
      const sortedItems = sortLeadWorkItemsForDisplay(nextItems);
      setItems(sortedItems);
      setCounts(nextCounts);
      setCollectedLeadSyncCounts(nextCollectedLeadSyncCounts);
      setSyncLogStatusCounts(nextSyncLogStatusCounts);
      setSelectedItemId(current => {
        if (current && sortedItems.some(item => item.id === current)) return current;
        return sortedItems[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setSelectedItemId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(statusFilter);
  }, [loadItems, statusFilter]);

  useEffect(() => {
    setPastePreviewState(getEmptyLeadPastePreviewState());
    setCollectedLeadDraft(null);
    setCaptureSaveEvidence(null);
    setCollectedLeadSaveEvidence(null);
  }, [selectedItemId]);

  const loadCaptureEvents = useCallback(async (workItemId: string) => {
    const db = await getDb();
    const events = await listLeadCaptureEventsByWorkItemId(db, workItemId);
    setCaptureEvents(events);
  }, []);

  const loadCollectedLeadDrafts = useCallback(async (workItemId: string) => {
    const db = await getDb();
    const drafts = await listCollectedLeadsByWorkItemId(db, workItemId);
    setCollectedLeadDrafts(drafts);
  }, []);

  const loadLeadSyncReplayEvidence = useCallback(async () => {
    setIsLoadingReplayEvidence(true);
    setReplayEvidenceError(null);
    try {
      const db = await getDb();
      const rows = await listLeadSyncReplayEvidence(db);
      setLeadSyncReplayEvidence(rows);
    } catch (err) {
      setReplayEvidenceError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingReplayEvidence(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedItemId) {
      setCaptureEvents([]);
      return;
    }

    setCaptureEvents([]);
    void loadCaptureEvents(selectedItemId).catch(err => {
      setError(getLeadCaptureSaveErrorMessage(err));
    });
  }, [loadCaptureEvents, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) {
      setCollectedLeadDrafts([]);
      setLeadSyncReplayEvidence([]);
      setReplayEvidenceError(null);
      return;
    }

    setCollectedLeadDrafts([]);
    void loadCollectedLeadDrafts(selectedItemId).catch(err => {
      setError(getCollectedLeadDraftSaveErrorMessage(err));
    });
    void loadLeadSyncReplayEvidence();
  }, [loadCollectedLeadDrafts, loadLeadSyncReplayEvidence, selectedItemId]);

  const handleRefreshTasks = useCallback(async () => {
    setMessage(null);
    await loadItems(statusFilter);
  }, [loadItems, statusFilter]);

  const handleCopySearchKeyword = useCallback(async () => {
    if (!selectedItem) return;
    const result = await copyLeadSearchKeyword(selectedItem, createSystemClipboardAdapter());
    setMessage(result.message);
    if (!result.ok) {
      setError(result.message);
    } else {
      setError(null);
    }
  }, [selectedItem]);

  const handleStatusAction = useCallback(async (nextStatus: LeadWorkStatus) => {
    if (!selectedItem) return;
    if (!shouldRunLeadWorkItemStatusUpdate(selectedItem, nextStatus, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsUpdating(true);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      if (nextStatus === 'SEARCHING') {
        const result = await startLeadQueryWorkflow(
          db,
          selectedItem.id,
          createSystemClipboardAdapter(),
        );
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setMessage(result.message);
        setStatusFilter('SEARCHING');
        await loadItems('SEARCHING');
        setSelectedItemId(selectedItem.id);
        return;
      }
      await updateLeadWorkItemStatus(db, selectedItem.id, nextStatus);
      setMessage(getLeadWorkItemStatusUpdateSuccessMessage(nextStatus));
      await loadItems(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdating(false);
    }
  }, [loadItems, selectedItem, statusFilter]);

  const handleReadClipboard = useCallback(async () => {
    if (!selectedItem) return;
    setIsReadingClipboard(true);
    setError(null);
    setMessage(null);
    try {
      const result = await readLeadClipboard(createSystemClipboardAdapter());
      setPastePreviewState({ text: result.text, result: result.preview });
      setCollectedLeadDraft(buildCollectedLeadDraftForm(selectedItem, result.text, result.preview));
      if (result.ok) {
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    } finally {
      setIsReadingClipboard(false);
    }
  }, [selectedItem]);

  const handleParsePastePreview = useCallback(() => {
    if (!selectedItem) return;
    setPastePreviewState(current => {
      const result = buildLeadPastePreviewResult(current.text);
      setCollectedLeadDraft(buildCollectedLeadDraftForm(selectedItem, current.text, result));
      return {
        ...current,
        result,
      };
    });
  }, [selectedItem]);

  const handleClearPastePreview = useCallback(() => {
    setPastePreviewState(getEmptyLeadPastePreviewState());
    setCollectedLeadDraft(null);
  }, []);

  const handleSaveLeadCaptureEvent = useCallback(async () => {
    if (!selectedItem || !pastePreviewState.result) return;
    if (!shouldRunLeadCaptureSave(selectedItem, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsSavingCapture(true);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      const evidence = await saveLeadCaptureWorkflow(db, {
        workItemId: selectedItem.id,
        rawText: pastePreviewState.text,
      });
      setCaptureSaveEvidence(evidence);
      await loadCaptureEvents(selectedItem.id);
      setMessage(`捕获记录已保存，任务已进入待整理（${evidence.capture_event_id}）`);
      setStatusFilter('STAGED');
      await loadItems('STAGED');
      setSelectedItemId(selectedItem.id);
    } catch (err) {
      setError(getLeadCaptureSaveErrorMessage(err));
    } finally {
      setIsSavingCapture(false);
    }
  }, [loadCaptureEvents, loadItems, pastePreviewState.result, pastePreviewState.text, selectedItem]);

  const handleSaveCollectedLeadDraft = useCallback(async () => {
    if (!selectedItem || !collectedLeadDraft) return;
    const captureEventId = captureSaveEvidence?.capture_event_id ?? captureEvents[0]?.id;
    if (!captureEventId) {
      setError('请先保存捕获记录，再保存为采集线索草稿');
      return;
    }
    if (!shouldRunCollectedLeadDraftSave(selectedItem, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsSavingCollectedLead(true);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      const evidence = await saveCollectedLeadWorkflow(db, {
        workItemId: selectedItem.id,
        captureEventId,
        draft: collectedLeadDraft,
      });
      setCollectedLeadSaveEvidence(evidence);
      await loadCollectedLeadDrafts(selectedItem.id);
      setMessage(evidence.existing
        ? `采集线索草稿已存在，已复用 ${evidence.collected_lead_id}`
        : `采集线索草稿已保存，任务已进入已采集（${evidence.collected_lead_id}）`);
      setStatusFilter('COLLECTED');
      await loadItems('COLLECTED');
      setSelectedItemId(selectedItem.id);
    } catch (err) {
      setError(getCollectedLeadDraftSaveErrorMessage(err));
    } finally {
      setIsSavingCollectedLead(false);
    }
  }, [
    captureEvents,
    captureSaveEvidence,
    collectedLeadDraft,
    loadCollectedLeadDrafts,
    loadItems,
    selectedItem,
  ]);

  const handleSyncCollectedLeadCreateCustomer = useCallback(async (draft: CollectedLead) => {
    try {
      const run = await syncCollectedLeadCreateCustomerFromWorkbench({
        draft,
        confirm: messageToConfirm => window.confirm(messageToConfirm),
        sync: async collectedLeadId => {
          const db = await getDb();
          return syncCollectedLeadCreateCustomer(db, collectedLeadId);
        },
        refreshDrafts: loadCollectedLeadDrafts,
        refreshItems: loadItems,
        selectedStatus: statusFilter,
        fallbackWorkItemId: selectedItemId,
        onConfirmed: () => {
          setIsSyncingCollectedLeadId(draft.id);
          setError(null);
          setMessage(null);
        },
      });
      if (run.status === 'CANCELLED') {
        return;
      }
      if (run.result.status === 'SUCCESS') {
        setMessage(run.message);
      } else {
        setError(run.message);
      }
      await loadLeadSyncReplayEvidence();
    } catch (err) {
      setError(getCollectedLeadCreateCustomerErrorMessage(err));
      const workItemId = draft.work_item_id ?? selectedItemId;
      if (workItemId) {
        await loadCollectedLeadDrafts(workItemId).catch(() => undefined);
      }
      await loadLeadSyncReplayEvidence();
    } finally {
      setIsSyncingCollectedLeadId(null);
    }
  }, [loadCollectedLeadDrafts, loadItems, loadLeadSyncReplayEvidence, selectedItemId, statusFilter]);

  const handleSyncCollectedLeadEnrichCustomer = useCallback(async (draft: CollectedLead) => {
    if (!shouldRunCollectedLeadEnrichCustomer(draft, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsSyncingCollectedLeadId(draft.id);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      const result = await syncCollectedLeadEnrichCustomer(db, draft.id);
      const workItemId = draft.work_item_id ?? selectedItemId;
      if (workItemId) {
        await loadCollectedLeadDrafts(workItemId);
      }
      const resultMessage = getCollectedLeadEnrichCustomerResultMessage(result);
      await loadItems(statusFilter);
      if (result.status === 'SUCCESS') {
        setMessage(resultMessage);
      } else {
        setError(resultMessage);
      }
      await loadLeadSyncReplayEvidence();
    } catch (err) {
      setError(getCollectedLeadEnrichCustomerErrorMessage(err));
      const workItemId = draft.work_item_id ?? selectedItemId;
      if (workItemId) {
        await loadCollectedLeadDrafts(workItemId).catch(() => undefined);
      }
      await loadLeadSyncReplayEvidence();
    } finally {
      setIsSyncingCollectedLeadId(null);
    }
  }, [loadCollectedLeadDrafts, loadItems, loadLeadSyncReplayEvidence, selectedItemId, statusFilter]);

  const statusActions = selectedItem ? getLeadWorkItemStatusActions(selectedItem.status) : [];
  const searchKeyword = selectedItem ? getSuggestedTanjiSearchKeyword(selectedItem) : '';
  const searchKeywordFallback = Boolean(selectedItem && !hasConfiguredTanjiSearchKeyword(selectedItem));
  const terminalMessage = selectedItem ? getLeadWorkItemTerminalMessage(selectedItem.status) : null;
  const canSaveLeadCapture = shouldEnableLeadCaptureSave(selectedItem, pastePreviewState.text, pastePreviewState.result);
  const canSaveCollectedLeadDraft = shouldEnableCollectedLeadDraftSave(selectedItem, pastePreviewState.result, collectedLeadDraft);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="page-kicker">LEAD WORKBENCH</p>
          <h2>获客作业台</h2>
          <p className="page-subtitle">数据导入、线索获取、筛选、导入分流与客户升级确认，统一在同一作业台完成。</p>
        </div>
      </div>

      <div className="page-body lead-workbench">
        <div className="workbench-entry-row" aria-label="获客作业台入口">
          <a className="btn btn-primary" href="#lead-workbench-tasks">线索筛选</a>
          <Link className="btn" to="/import">数据导入</Link>
          <Link className="btn" to="/lead-import-center">导入分流</Link>
          <a className="btn" href="#lead-workbench-detail">线索获取 / 客户升级</a>
          <span className="status-pill info">确认后升级客户</span>
        </div>

        {error && (
          <div className="lead-alert lead-alert-danger">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        {message && !error && (
          <div className="lead-alert lead-alert-success">
            <span>{message}</span>
          </div>
        )}

        <section className="card" id="lead-workbench-tasks">
          <div className="lead-section-header">
            <div className="section-title">任务统计</div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { void handleRefreshTasks(); }}
              disabled={isLoading || isUpdating}
            >
              <RefreshCw size={14} />
              {isLoading ? '加载中' : '刷新任务'}
            </button>
          </div>
          <div className="lead-workbench-status-tabs">
            {LEAD_WORKBENCH_STATUS_FILTERS.map(status => (
              <button
                type="button"
                key={status}
                className={`lead-workbench-status-tab ${status === statusFilter ? 'active' : ''}`}
                onClick={() => setStatusFilter(status)}
                disabled={isLoading || isUpdating}
              >
                <span>{formatLeadWorkStatusLabel(status)}</span>
                <strong>{counts[status]}</strong>
              </button>
            ))}
          </div>
          <div className="lead-workbench-status-tabs">
            {realityStatRows.map(row => (
              <div className="lead-workbench-status-tab" key={row.label}>
                <span>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="lead-workbench-layout">
          <section className="card">
            <div className="section-title">任务列表</div>
            {visibleItems.length === 0 ? (
              <div className="empty-state">{getLeadWorkbenchListEmptyMessage(totalTaskCount, statusFilter)}</div>
            ) : (
              <div className="table-container lead-workbench-table">
                <table>
                  <thead>
                    <tr>
                      <th>公司名称</th>
                      <th>城市</th>
                      <th>行业</th>
                      <th>任务类型</th>
                      <th>查询目标</th>
                      <th>状态</th>
                      <th>优先级</th>
                      <th>搜索词</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map(item => (
                      <tr
                        key={item.id}
                        className={`clickable ${item.id === selectedItemId ? 'lead-workbench-selected-row' : ''}`}
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        <td>
                          <div className="import-preview-name">{item.company_name || '-'}</div>
                        </td>
                        <td>{item.city || '-'}</td>
                        <td>{item.industry || '-'}</td>
                        <td><span className="badge badge-info">{item.work_type}</span></td>
                        <td>{item.lookup_goal}</td>
                        <td><span className="badge badge-warning">{formatLeadWorkStatusLabel(item.status)}</span></td>
                        <td>{item.priority}</td>
                        <td>{getSuggestedTanjiSearchKeyword(item) || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" id="lead-workbench-detail">
            <div className="section-title">任务详情 · 线索获取 / 客户升级</div>
            {!selectedItem ? (
              <div className="empty-state">{getLeadWorkbenchDetailEmptyMessage()}</div>
            ) : (
              <>
                <div className="lead-workbench-search-panel">
                  <div className="lead-workbench-search-copy-zone">
                    <div className="label">探迹搜索词</div>
                    <textarea
                      className="lead-workbench-search-keyword"
                      readOnly
                      value={searchKeyword || '-'}
                      rows={2}
                    />
                    {searchKeywordFallback && (
                      <div className="lead-workbench-search-hint">未配置探迹搜索词，已使用公司名</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => { void handleCopySearchKeyword(); }}
                    disabled={isLoading || isUpdating || !searchKeyword}
                  >
                    <Clipboard size={14} />
                    {workbenchActionLabels[0]}
                  </button>
                </div>

                {terminalMessage && (
                  <div className="lead-alert lead-alert-info">
                    <span>{terminalMessage}</span>
                  </div>
                )}

                {statusActions.length > 0 && (
                  <div className="lead-workbench-action-row">
                    {statusActions.map(action => (
                      <button
                        type="button"
                        key={action.nextStatus}
                        className="btn btn-sm"
                        onClick={() => { void handleStatusAction(action.nextStatus); }}
                        disabled={isLoading || isUpdating}
                      >
                        {action.icon === 'search' && <Search size={14} />}
                        {action.icon === 'phone-off' && <PhoneOff size={14} />}
                        {action.icon === 'skip' && <SkipForward size={14} />}
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}

                {isLeadPastePreviewVisible(selectedItem) && (
                  <section className="lead-workbench-paste-preview">
                    <div className="lead-section-header">
                      <div className="section-title">粘贴解析预览</div>
                      <div className="lead-workbench-action-row">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => { void handleReadClipboard(); }}
                          disabled={isReadingClipboard}
                        >
                          <Clipboard size={14} />
                          {isReadingClipboard ? '读取中' : '读取剪贴板'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={handleClearPastePreview}
                          disabled={!pastePreviewState.text && !pastePreviewState.result}
                        >
                          清空粘贴内容
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="lead-workbench-paste-input"
                      value={pastePreviewState.text}
                      onChange={event => {
                        setPastePreviewState({ text: event.target.value, result: null });
                        setCollectedLeadDraft(null);
                      }}
                      placeholder="手动粘贴从探迹复制的文本，仅用于本页解析预览"
                      rows={6}
                    />
                    <div className="lead-workbench-action-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={handleParsePastePreview}
                        disabled={!pastePreviewState.text.trim()}
                      >
                        解析预览
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { void handleSaveLeadCaptureEvent(); }}
                        disabled={!canSaveLeadCapture || isSavingCapture}
                      >
                        {isSavingCapture ? '保存中' : '保存捕获记录'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { void handleSaveCollectedLeadDraft(); }}
                        disabled={
                          !canSaveCollectedLeadDraft
                          || isSavingCollectedLead
                          || (!captureSaveEvidence && captureEvents.length === 0)
                        }
                      >
                        {isSavingCollectedLead ? '保存中' : '保存为采集线索草稿'}
                      </button>
                    </div>

                    {pastePreviewState.result && (
                      <div className="lead-workbench-paste-result">
                        {!pastePreviewState.result.hasStructuredInfo && (
                          <div className="lead-alert lead-alert-info">
                            <span>{getNoStructuredLeadPastePreviewMessage()}</span>
                          </div>
                        )}
                        <PreviewList label="手机号候选" values={pastePreviewState.result.mobiles} />
                        <PreviewList label="座机候选" values={pastePreviewState.result.tels} />
                        <PreviewList label="URL 候选" values={pastePreviewState.result.urls} />
                        <PreviewList label="邮箱候选" values={pastePreviewState.result.emails} />
                        <PreviewList label="possibleContact / 可能联系人" values={pastePreviewState.result.possibleContact} />
                        <PreviewText label="note / 备注文本" value={pastePreviewState.result.note} />
                        <PreviewText label="raw_text 原文" value={pastePreviewState.result.raw_text} />
                      </div>
                    )}

                    {collectedLeadDraft && (
                      <div className="lead-workbench-draft-form">
                        {collectedLeadDraft.contactNameSuggestion && (
                          <div className="lead-workbench-search-hint">
                            可能联系人建议：{collectedLeadDraft.contactNameSuggestion}
                          </div>
                        )}
                        <DraftInput label="联系人" field="contact_name" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="职位" field="position" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="手机号" field="mobile" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="座机" field="tel" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="官网" field="website" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="邮箱" field="email" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="备注" field="note" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} multiline />
                      </div>
                    )}

                    {captureSaveEvidence && (
                      <div className="lead-workbench-paste-result">
                        <div className="section-title">捕获记录入库证据</div>
                        <PreviewText label="capture_event_id" value={captureSaveEvidence.capture_event_id} />
                        <PreviewText label="saved_to" value={captureSaveEvidence.saved_to} />
                        <PreviewText label="work_item_id" value={captureSaveEvidence.work_item_id} />
                        <PreviewText label="company_name" value={captureSaveEvidence.company_name} />
                        <PreviewText label="phone / email" value={[captureSaveEvidence.phone, captureSaveEvidence.email].filter(Boolean).join(' / ')} />
                        <PreviewText label="new_status" value={captureSaveEvidence.new_status} />
                        <PreviewText label="next_actions" value={captureSaveEvidence.next_actions.join(' / ')} />
                      </div>
                    )}

                    {collectedLeadSaveEvidence && (
                      <div className="lead-workbench-paste-result">
                        <div className="section-title">采集线索草稿入库证据</div>
                        <PreviewText label="collected_lead_id" value={collectedLeadSaveEvidence.collected_lead_id} />
                        <PreviewText label="capture_event_id" value={collectedLeadSaveEvidence.capture_event_id} />
                        <PreviewText label="saved_to" value={collectedLeadSaveEvidence.saved_to} />
                        <PreviewText label="new_status" value={collectedLeadSaveEvidence.new_status} />
                        <PreviewText label="existing" value={String(collectedLeadSaveEvidence.existing)} />
                      </div>
                    )}
                  </section>
                )}

                {isLeadCaptureHistoryVisible(selectedItem) && (
                  <section className="lead-workbench-capture-history">
                    <div className="section-title">历史捕获记录</div>
                    {captureEvents.length === 0 ? (
                      <div className="empty-state lead-workbench-history-empty">{getLeadCaptureHistoryEmptyMessage()}</div>
                    ) : (
                      <div className="lead-workbench-history-list">
                        {captureEvents.map(event => (
                          <details className="lead-workbench-history-item" key={event.id}>
                            <summary>
                              <span>{event.created_at}</span>
                              <span className="badge badge-info">{event.action}</span>
                              <span>{getLeadCaptureRawTextSummary(event.raw_text)}</span>
                            </summary>
                             <div className="lead-workbench-history-summary">
                               {getLeadCaptureParsedSummary(event.parsed_json)}
                             </div>
                             <PreviewText label="capture_event_id" value={event.id} />
                             <PreviewText label="saved_to" value="lead_capture_events" />
                             <PreviewText label="work_item_id" value={event.work_item_id} />
                             <PreviewText label="company_name" value={selectedItem.company_name || ''} />
                             <PreviewText label="完整 raw_text" value={event.raw_text} />
                             <PreviewText label="完整 parsed_json" value={event.parsed_json} />
                          </details>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {isCollectedLeadDraftHistoryVisible(selectedItem) && (
                  <section className="lead-workbench-capture-history">
                    <div className="section-title">采集线索草稿</div>
                    {collectedLeadDrafts.length === 0 ? (
                      <div className="empty-state lead-workbench-history-empty">{getCollectedLeadDraftHistoryEmptyMessage()}</div>
                    ) : (
                      <div className="lead-workbench-history-list">
                        {collectedLeadDrafts.map(draft => {
                          const createCustomerLabel = getCollectedLeadCreateCustomerActionLabel(draft);
                          const createCustomerStateLabel = getCollectedLeadCreateCustomerStateLabel(draft);
                          const enrichCustomerLabel = getCollectedLeadEnrichCustomerActionLabel(draft);
                          const enrichCustomerStateLabel = getCollectedLeadEnrichCustomerStateLabel(draft);
                          const isCurrentDraftSyncing = isSyncingCollectedLeadId === draft.id;
                          const collectedLeadStateLabel = createCustomerStateLabel ?? enrichCustomerStateLabel;
                          const replayRows = formatLeadSyncReplayEvidenceRows(
                            selectedLeadSyncReplayEvidence.filter(row => row.collected_lead_id === draft.id),
                          );

                          return (
                            <details className="lead-workbench-history-item" key={draft.id}>
                              <summary className="lead-workbench-collected-summary">
                                <span>{draft.created_at}</span>
                                <span className="badge badge-info">{formatCollectedLeadSyncStatusLabel(draft.sync_status)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.contact_name)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.position)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.mobile)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.tel)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.website)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.email)}</span>
                                <span>{getCollectedLeadDraftNoteSummary(draft.note)}</span>
                              </summary>
                               <PreviewText label="公司名称" value={draft.company_name || ''} />
                               <PreviewText label="collected_lead_id" value={draft.id} />
                               <PreviewText label="saved_to" value="collected_leads" />
                               <PreviewText label="完整 raw_text" value={draft.raw_text || ''} />
                              <PreviewText label="完整 note" value={draft.note || ''} />
                               <PreviewText label="work_item_id" value={draft.work_item_id || ''} />
                               <PreviewText label="capture_event_id" value={draft.capture_event_id || ''} />
                               <PreviewText label="import_row_id" value={draft.import_row_id || ''} />
                              <PreviewText label="customer_id" value={draft.customer_id || ''} />
                              <PreviewText label="created_customer_id" value={draft.created_customer_id || ''} />
                              <PreviewText label="updated_customer_id" value={draft.updated_customer_id || ''} />
                              <div className="lead-workbench-collected-actions">
                                {createCustomerLabel ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    onClick={() => { void handleSyncCollectedLeadCreateCustomer(draft); }}
                                    disabled={isCurrentDraftSyncing}
                                  >
                                    {isCurrentDraftSyncing ? '创建中' : createCustomerLabel}
                                  </button>
                                ) : enrichCustomerLabel ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    onClick={() => { void handleSyncCollectedLeadEnrichCustomer(draft); }}
                                    disabled={isCurrentDraftSyncing}
                                  >
                                    {isCurrentDraftSyncing ? '补充中' : enrichCustomerLabel}
                                  </button>
                                ) : (
                                  collectedLeadStateLabel && (
                                    <span className="lead-workbench-collected-state">{collectedLeadStateLabel}</span>
                                  )
                                )}
                              </div>
                              <section className="lead-workbench-capture-history">
                                <div className="section-title">Replay Evidence</div>
                                {isLoadingReplayEvidence ? (
                                  <div className="empty-state lead-workbench-history-empty">Loading replay evidence...</div>
                                ) : replayEvidenceError ? (
                                  <div className="lead-alert lead-alert-danger">
                                    <span>{replayEvidenceError}</span>
                                  </div>
                                ) : replayRows.length === 0 ? (
                                  <div className="empty-state lead-workbench-history-empty">No replay evidence linked to this collected lead.</div>
                                ) : (
                                  <div className="lead-workbench-history-list">
                                    {replayRows.map(row => (
                                      <details className="lead-workbench-history-item" key={row.logId}>
                                        <summary>
                                          <span>{row.title}</span>
                                        </summary>
                                        <PreviewText label="Replay Evidence" value={row.details.join('\n')} />
                                      </details>
                                    ))}
                                  </div>
                                )}
                              </section>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                <div className="lead-workbench-detail-grid">
                  <DetailItem label="id" value={selectedItem.id} />
                  <DetailItem label="导入行 ID" value={selectedItem.import_row_id} />
                  <DetailItem label="客户 ID" value={selectedItem.customer_id} />
                  <DetailItem label="公司名称" value={selectedItem.company_name} />
                  <DetailItem label="城市" value={selectedItem.city} />
                  <DetailItem label="行业" value={selectedItem.industry} />
                  <DetailItem label="任务类型" value={selectedItem.work_type} />
                  <DetailItem label="查询目标" value={selectedItem.lookup_goal} />
                  <DetailItem label="tanji_search_keyword" value={searchKeyword} />
                  <DetailItem label="状态" value={formatLeadWorkStatusLabel(selectedItem.status)} />
                  <DetailItem label="note" value={selectedItem.note} />
                  <DetailItem label="created_at" value={selectedItem.created_at} />
                  <DetailItem label="updated_at" value={selectedItem.updated_at} />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="detail-item">
      <div className="label">{label}</div>
      <div className="value">{value ?? '-'}</div>
    </div>
  );
}

function PreviewList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="lead-workbench-preview-row">
      <div className="label">{label}</div>
      <div className="lead-workbench-preview-values">
        {values.length === 0 ? '-' : values.map(value => (
          <span className="badge badge-info" key={value}>{value}</span>
        ))}
      </div>
    </div>
  );
}

function PreviewText({ label, value }: { label: string; value: string }) {
  return (
    <div className="lead-workbench-preview-row">
      <div className="label">{label}</div>
      <pre className="lead-workbench-preview-text">{value || '-'}</pre>
    </div>
  );
}

function DraftInput({
  label,
  field,
  draft,
  onChange,
  multiline = false,
}: {
  label: string;
  field: keyof Pick<CollectedLeadDraftForm, 'contact_name' | 'position' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>;
  draft: CollectedLeadDraftForm;
  onChange: (next: CollectedLeadDraftForm) => void;
  multiline?: boolean;
}) {
  const value = draft[field];
  const handleChange = (nextValue: string) => {
    onChange({ ...draft, [field]: nextValue });
  };

  return (
    <label className="lead-workbench-draft-field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={event => handleChange(event.target.value)} rows={3} />
      ) : (
        <input value={value} onChange={event => handleChange(event.target.value)} />
      )}
    </label>
  );
}
