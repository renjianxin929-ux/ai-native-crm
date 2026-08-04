/**
 * Battle Card UI — 视图模型与选择器（纯函数，只读）。
 * 输入为冻结后端类型；输出为 UI 展示模型。不包含任何写逻辑。
 */

import { parsePayload } from '../battleCard/stageCardEngine';
import { parseJsonArray } from '../battleCard/repository';
import type {
  ActionCard,
  BattleCardPayload,
  CustomerHypothesisRow,
  CustomerStageCardRow,
  FactEvidenceRef,
  FeishuValueStatement,
  PeerReference,
  ReviewedFactRow,
  SolutionReferenceCard,
} from '../battleCard/types';
import { KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER } from '../battleCard/types';
import { daysBetween } from './battleCardLabels';

export type CardViewState =
  | { readonly kind: 'no_card' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string };

export interface StageCardViewBundle {
  readonly card: CustomerStageCardRow;
  readonly payload: BattleCardPayload;
  readonly action: ActionCard;
  readonly solution: SolutionReferenceCard;
}

export function toStageCardBundle(card: CustomerStageCardRow): StageCardViewBundle {
  const payload = parsePayload(card.payload_json);
  return {
    card,
    payload,
    action: payload.action_card,
    solution: payload.solution_reference_card,
  };
}

export function isInsufficientHypothesisPlaceholder(statement: string): boolean {
  return statement === KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER;
}

export interface KeyHypothesisView {
  readonly hypothesis_id: string;
  readonly statement: string;
  readonly status: string;
  readonly applicability: string;
  readonly why_it_matters: string | null;
  readonly validation_question: string | null;
  readonly disconfirm_condition: string | null;
  readonly evidence_count: number;
  readonly is_placeholder: boolean;
}

export function toKeyHypothesisViews(action: ActionCard): KeyHypothesisView[] {
  return action.key_hypotheses.map(hypothesis => ({
    hypothesis_id: hypothesis.hypothesis_id,
    statement: hypothesis.statement,
    status: hypothesis.status,
    applicability: hypothesis.applicability,
    why_it_matters: hypothesis.why_it_matters,
    validation_question: hypothesis.validation_question,
    disconfirm_condition: hypothesis.disconfirm_condition,
    evidence_count: hypothesis.evidence_refs.length,
    is_placeholder: isInsufficientHypothesisPlaceholder(hypothesis.statement),
  }));
}

export interface NextBestActionView {
  readonly target_role: string;
  readonly channel: string;
  readonly recommended_time: string;
  readonly objective: string;
  readonly opening: string;
  readonly questions: readonly string[];
  readonly success_signal: string;
  readonly failure_signal: string;
  readonly fallback_action: string;
}

export function toNextBestActionView(action: ActionCard): NextBestActionView {
  return { ...action.next_best_action };
}

export interface TalkTrackView {
  readonly original: string;
  readonly current: string;
  readonly short_spoken_version: string | null;
  readonly full_spoken_version: string | null;
  readonly wechat_version: string | null;
  readonly original_is_current: boolean;
  readonly version_count: number;
  readonly paragraphs: readonly string[];
}

/** 完整话术段落：优先 value_statement.current；无内容时回退原始原文段落（只读展示）。 */
export function toTalkTrackView(statement: FeishuValueStatement, paragraphs: readonly string[] = []): TalkTrackView {
  const current = statement.current?.trim() ? statement.current : statement.original;
  return {
    original: statement.original,
    current,
    short_spoken_version: statement.short_spoken_version,
    full_spoken_version: statement.full_spoken_version,
    wechat_version: statement.wechat_version,
    original_is_current: statement.current === statement.original || !statement.current?.trim(),
    version_count: statement.version_history.length,
    paragraphs: current ? current.split('\n').filter(line => line.trim().length > 0) : paragraphs,
  };
}

export interface PeerReferenceView {
  readonly company_name: string;
  readonly comparison_level: string;
  readonly why_comparable: string;
  readonly reusable_pattern: string;
  readonly non_transferable_boundary: string;
  readonly source_refs: readonly string[];
}

export function toPeerReferenceViews(peers: readonly PeerReference[]): PeerReferenceView[] {
  return peers.map(peer => ({ ...peer }));
}

export interface EvidenceSummary {
  readonly refs: readonly string[];
  readonly import_refs: readonly string[];
  readonly crm_refs: readonly string[];
  readonly derived_refs: readonly string[];
}

export function splitEvidenceRefs(refs: readonly string[]): EvidenceSummary {
  const importRefs: string[] = [];
  const crmRefs: string[] = [];
  const derivedRefs: string[] = [];
  for (const ref of refs) {
    if (ref.startsWith('import:')) importRefs.push(ref);
    else if (/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):/.test(ref)) crmRefs.push(ref);
    else derivedRefs.push(ref);
  }
  return { refs, import_refs: importRefs, crm_refs: crmRefs, derived_refs: derivedRefs };
}

export function parseFactEvidenceRefs(rawJson: string): FactEvidenceRef[] {
  return parseJsonArray<FactEvidenceRef>(rawJson);
}

export interface HypothesisRowView {
  readonly id: string;
  readonly statement: string;
  readonly category: string;
  readonly status: string;
  readonly applicability: string;
  readonly why_it_matters: string | null;
  readonly validation_question: string | null;
  readonly disconfirm_condition: string | null;
  readonly evidence_count: number;
  readonly updated_at: string;
  readonly audit_count: number;
}

export function toHypothesisRowViews(rows: readonly CustomerHypothesisRow[]): HypothesisRowView[] {
  return rows.map(row => ({
    id: row.id,
    statement: row.statement,
    category: row.category,
    status: row.status,
    applicability: row.applicability,
    why_it_matters: row.why_it_matters,
    validation_question: row.validation_question,
    disconfirm_condition: row.disconfirm_condition,
    evidence_count: parseJsonArray<FactEvidenceRef>(row.evidence_refs_json).length,
    updated_at: row.updated_at,
    audit_count: parseJsonArray<unknown>(row.status_audit_json).length,
  }));
}

export interface FactRowView {
  readonly id: string;
  readonly statement: string;
  readonly category: string;
  readonly verification_status: string;
  readonly applicability: string;
  readonly confidence: number;
  readonly source_import_id: string;
  readonly evidence_count: number;
  readonly created_at: string;
}

export function toFactRowViews(rows: readonly ReviewedFactRow[]): FactRowView[] {
  return rows.map(row => ({
    id: row.id,
    statement: row.statement,
    category: row.fact_category,
    verification_status: row.verification_status,
    applicability: row.applicability,
    confidence: row.confidence,
    source_import_id: row.source_import_id,
    evidence_count: parseJsonArray<FactEvidenceRef>(row.evidence_refs_json).length,
    created_at: row.created_at,
  }));
}

export interface VersionHistoryRow {
  readonly id: string;
  readonly version: number;
  readonly stage_code: string;
  readonly card_status: string;
  readonly generated_by: string;
  readonly supersedes_card_id: string | null;
  readonly confirmed_at: string | null;
  readonly created_at: string;
  readonly is_current: boolean;
  readonly change_summary: string;
}

export function toVersionHistoryRows(
  cards: readonly CustomerStageCardRow[],
  currentCardId: string | null,
): VersionHistoryRow[] {
  return cards.map(card => {
    let changeSummary = '';
    try {
      const payload = parsePayload(card.payload_json);
      changeSummary = payload.action_card.changes_since_previous_card.slice(0, 2).join('；');
    } catch {
      changeSummary = '';
    }
    return {
      id: card.id,
      version: card.version,
      stage_code: card.stage_code,
      card_status: card.card_status,
      generated_by: card.generated_by,
      supersedes_card_id: card.supersedes_card_id,
      confirmed_at: card.confirmed_at,
      created_at: card.created_at,
      is_current: currentCardId === card.id,
      change_summary: changeSummary,
    };
  }).reverse();
}

export interface DailyReviewRowView {
  readonly customer_id: string;
  readonly customer_name: string;
  readonly stage: string;
  readonly priority: string;
  readonly reasons: readonly string[];
  readonly current_goal: string;
  readonly key_hypotheses: readonly string[];
  readonly next_best_action: string;
  readonly card_age_days: number | null;
  readonly evidence_changes: readonly string[];
  readonly urgency_score: number;
  readonly coach_note: string | null;
  readonly is_overdue: boolean;
  readonly is_due_today: boolean;
}

export function toDailyReviewRowViews(
  items: readonly import('../battleCard/dailyReview').BattleReviewQueueItem[],
  _nowIso: string,
): DailyReviewRowView[] {
  return items.map(item => ({
    customer_id: item.customer_id,
    customer_name: item.customer_name,
    stage: item.stage,
    priority: item.priority,
    reasons: item.reasons,
    current_goal: item.current_goal,
    key_hypotheses: item.key_hypotheses,
    next_best_action: item.next_best_action,
    card_age_days: item.card_age_days,
    evidence_changes: item.evidence_changes,
    urgency_score: item.urgency_score,
    coach_note: item.coach_note,
    is_overdue: item.reasons.some(reason => reason.includes('逾期')),
    is_due_today: item.reasons.some(reason => reason.includes('今天到期')),
  }));
}

/** 卡片年龄（天）。null 表示无确认时间。 */
export function cardAgeDays(card: CustomerStageCardRow, nowIso: string): number | null {
  return card.confirmed_at ? daysBetween(card.confirmed_at, nowIso) : null;
}

/** Evidence 新鲜度：当前卡确认后是否出现过互动。返回可读文案。 */
export function evidenceFreshnessLabel(evidenceChanges: readonly string[]): string {
  if (evidenceChanges.length > 0) return '有变化';
  return '无变化';
}
