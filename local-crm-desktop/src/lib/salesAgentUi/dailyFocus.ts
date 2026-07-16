/**
 * Deterministic "今日值得关注" tips — local CRM signals only.
 * No provider calls, no CRM writes. UI preference stores dismiss date only.
 */

import type { SearchableCustomer } from '../salesAgentTools/searchCustomers';

export const DAILY_FOCUS_PREF_KEY = 'sales-agent-daily-focus-dismissed-on';
export const DAILY_FOCUS_MAX_ITEMS = 5;

export interface DailyFocusEvidence {
  readonly label: string;
  readonly detail: string;
}

export interface DailyFocusItem {
  readonly customer_id: string;
  readonly customer_name: string;
  readonly why: string;
  readonly evidence: readonly DailyFocusEvidence[];
  readonly score: number;
}

export interface DailyFocusPreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function readDailyFocusDismissedDay(store: DailyFocusPreferenceStore = localStorage): string | null {
  try {
    return store.getItem(DAILY_FOCUS_PREF_KEY);
  } catch {
    return null;
  }
}

export function dismissDailyFocusForToday(now = new Date(), store: DailyFocusPreferenceStore = localStorage): string {
  const day = localDayKey(now);
  store.setItem(DAILY_FOCUS_PREF_KEY, day);
  return day;
}

export function shouldAutoOpenDailyFocus(now = new Date(), store: DailyFocusPreferenceStore = localStorage): boolean {
  return readDailyFocusDismissedDay(store) !== localDayKey(now);
}

function gradeScore(grade: string | null | undefined): number {
  switch ((grade ?? '').toUpperCase()) {
    case 'A': return 40;
    case 'B': return 25;
    case 'C': return 10;
    default: return 0;
  }
}

function intentScore(intent: string | null | undefined): number {
  switch ((intent ?? '').toUpperCase()) {
    case 'HIGH': return 35;
    case 'MEDIUM': return 18;
    case 'LOW': return 4;
    default: return 0;
  }
}

function overdueFollowUp(next: string | null | undefined, nowMs: number): boolean {
  if (!next) return false;
  const then = Date.parse(next);
  return !Number.isNaN(then) && then < nowMs;
}

function staleContact(last: string | null | undefined, nowMs: number): number {
  if (!last) return 20;
  const then = Date.parse(last);
  if (Number.isNaN(then)) return 10;
  const days = Math.floor((nowMs - then) / (24 * 60 * 60 * 1000));
  if (days >= 30) return 28;
  if (days >= 14) return 18;
  if (days >= 7) return 10;
  return 0;
}

/**
 * Rank up to 5 high-value customers from local CRM fields only.
 * Deterministic, no model, no writes.
 */
export function buildDailyFocusItems(
  corpus: readonly SearchableCustomer[],
  nowIso = new Date().toISOString(),
): readonly DailyFocusItem[] {
  const nowMs = Date.parse(nowIso);
  const items: DailyFocusItem[] = [];

  for (const customer of corpus) {
    if (!customer.id || !customer.name) continue;
    const evidence: DailyFocusEvidence[] = [];
    let score = gradeScore(customer.customer_grade) + intentScore(customer.intent_level);

    if (customer.customer_grade === 'A' || customer.customer_grade === 'B') {
      evidence.push({ label: '优先级', detail: `${customer.customer_grade} 类客户` });
    }
    if ((customer.intent_level ?? '').toUpperCase() === 'HIGH') {
      evidence.push({ label: '意向', detail: '高意向' });
      score += 5;
    }
    if (overdueFollowUp(customer.next_follow_up_at, nowMs)) {
      evidence.push({ label: '跟进逾期', detail: `下次跟进已过期（${customer.next_follow_up_at}）` });
      score += 32;
    } else if (customer.next_follow_up_at) {
      evidence.push({ label: '下次跟进', detail: customer.next_follow_up_at });
      score += 6;
    }
    const stale = staleContact(customer.last_contacted_at, nowMs);
    if (stale > 0) {
      evidence.push({
        label: '最近互动',
        detail: customer.last_contacted_at ? `上次联系 ${customer.last_contacted_at}` : '尚无最近互动记录',
      });
      score += stale;
    }
    if (customer.stage) {
      evidence.push({ label: '阶段', detail: customer.stage });
      if (['VISIT_READY', 'VISITED', 'CONTRACTING', 'PAYMENT_PENDING'].includes(customer.stage)) score += 12;
    }

    if (evidence.length === 0) continue;

    const whyParts: string[] = [];
    if (overdueFollowUp(customer.next_follow_up_at, nowMs)) whyParts.push('跟进已逾期');
    if ((customer.intent_level ?? '').toUpperCase() === 'HIGH') whyParts.push('高意向');
    if (customer.customer_grade === 'A') whyParts.push('A 类优先');
    else if (customer.customer_grade === 'B') whyParts.push('B 类关注');
    if (stale >= 18) whyParts.push('互动偏久');
    if (whyParts.length === 0) whyParts.push('综合优先级较高');

    items.push({
      customer_id: customer.id,
      customer_name: customer.name,
      why: whyParts.join(' · '),
      evidence,
      score,
    });
  }

  items.sort((a, b) => b.score - a.score || a.customer_name.localeCompare(b.customer_name, 'zh'));
  return items.slice(0, DAILY_FOCUS_MAX_ITEMS);
}
