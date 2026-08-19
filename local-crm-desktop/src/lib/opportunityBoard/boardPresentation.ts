/**
 * V0.2C / C1 — Board presentation helpers.
 *
 * UI-only. Consumes C0 projection truth. Does not reclassify stages,
 * recompute open-pipeline amounts, or invent missing aggregates.
 */

import type {
  BoardStage,
  OpportunityBoardProjection,
  OpportunityBoardRow,
} from './opportunityBoardProjection';
import { getAppLocale, t } from '../i18n/appLocale';

export const BOARD_COLUMN_ORDER: readonly BoardStage[] = ['NEW', 'ACTIVE', 'PENDING', 'WON', 'LOST'];

export const BOARD_COLUMN_LABELS: Record<BoardStage, string> = {
  get NEW() { return t('board.column.new'); },
  get ACTIVE() { return t('board.column.active'); },
  get PENDING() { return t('board.column.pending'); },
  get WON() { return t('board.column.won'); },
  get LOST() { return t('board.column.lost'); },
};

/** NULL / non-finite → 未录入. Never ¥0 for unknown. */
export function formatOpportunityAmount(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return t('board.amountUnknown');
  return `¥${Math.round(amount).toLocaleString(getAppLocale())}`;
}

export function formatOpenPipelineMetric(projection: OpportunityBoardProjection): string {
  const { open_pipeline_amount, open_pipeline_count, unknown_amount_count } = projection.summary;
  if (open_pipeline_count === 0) return '—';
  if (open_pipeline_amount === 0 && unknown_amount_count > 0) return t('board.amountUnknown');
  return formatOpportunityAmount(open_pipeline_amount);
}

export function rowsForBoardStage(
  rows: readonly OpportunityBoardRow[],
  stage: BoardStage,
): readonly OpportunityBoardRow[] {
  return rows.filter(row => row.board_stage === stage);
}

function startOfLocalWeek(now: Date): Date {
  const start = new Date(now);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + diff);
  return start;
}

/** Count open-pipeline rows whose real next_follow_up_at falls in the current local week. */
export function countThisWeekFollowUps(
  rows: readonly OpportunityBoardRow[],
  now: Date = new Date(),
): number {
  const start = startOfLocalWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return rows.filter(row => {
    if (!row.open_pipeline || !row.next_follow_up_at) return false;
    const at = new Date(row.next_follow_up_at);
    if (Number.isNaN(at.getTime())) return false;
    return at >= start && at < end;
  }).length;
}

export function formatFollowUpDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(getAppLocale(), { month: 'numeric', day: 'numeric', weekday: 'short' });
}
