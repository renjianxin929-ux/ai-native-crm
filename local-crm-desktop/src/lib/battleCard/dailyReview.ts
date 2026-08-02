/**
 * Battle Card Backend V1 — 每日复盘队列（确定性）。
 * 排序只使用确定性 CRM 规则；模型仅可生成带证据的教练说明（可选注入），不控制排序。
 */

import type { DatabaseLike } from '../db';
import type { Customer, CustomerStage } from '../types';
import { getStageRule } from './stageRules';
import { createBattleCardRepositories, type BattleCardRepositories } from './repository';
import { parsePayload } from './stageCardEngine';

export interface BattleReviewQueueFilters {
  readonly customer_id?: string;
  readonly limit?: number;
  /** 测试注入用固定 now。 */
  readonly now?: string;
}

export interface BattleReviewQueueItem {
  readonly customer_id: string;
  readonly customer_name: string;
  readonly stage: CustomerStage;
  readonly priority: string;
  readonly reasons: readonly string[];
  readonly current_goal: string;
  readonly key_hypotheses: readonly string[];
  readonly next_best_action: string;
  readonly card_age_days: number | null;
  readonly evidence_changes: readonly string[];
  readonly urgency_score: number;
  /** 模型教练说明（可选）；排序从不依赖它。 */
  readonly coach_note: string | null;
}

export interface BattleReviewQueueResult {
  readonly generated_at: string;
  readonly items: readonly BattleReviewQueueItem[];
  /** 确定性排序的可解释说明。 */
  readonly sort_explanation: string;
  readonly model_coaching: 'DETERMINISTIC_ONLY' | 'MODEL_COACHED';
}

export interface DailyReviewEngineDeps {
  readonly db: DatabaseLike;
  readonly repos?: BattleCardRepositories;
  readonly clock?: () => string;
  /** 可选模型教练：仅显式注入时调用；输出只作为说明，不参与排序。 */
  readonly coach_with_model?: (items: readonly BattleReviewQueueItem[]) => Promise<Readonly<Record<string, string>>>;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function createDailyReviewEngine(deps: DailyReviewEngineDeps) {
  const repos = deps.repos ?? createBattleCardRepositories(deps.db, deps.clock);

  return {
    async buildDailyBattleReviewQueue(filters: BattleReviewQueueFilters = {}): Promise<BattleReviewQueueResult> {
      const nowIso = filters.now ?? deps.clock?.() ?? new Date().toISOString();
      const nowMs = Date.parse(nowIso);
      if (!Number.isFinite(nowMs)) throw new Error('Daily review clock must return a valid timestamp.');

      const customers = filters.customer_id
        ? (await deps.db.select<Customer>('SELECT * FROM customers WHERE id = ?', [filters.customer_id]))
        : (await deps.db.select<Customer>('SELECT * FROM customers'));

      const items: BattleReviewQueueItem[] = [];
      for (const customer of customers) {
        const evaluated = await evaluateCustomer(customer, nowIso, nowMs);
        if (evaluated) items.push(evaluated);
      }

      // 确定性排序：urgency_score 降序 → 客户等级（A>B>C>D）→ 阶段停滞时长 → 名称
      const gradeRank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
      const sorted = [...items].sort((left, right) => {
        if (right.urgency_score !== left.urgency_score) return right.urgency_score - left.urgency_score;
        const gradeDiff = (gradeRank[left.priority] ?? 9) - (gradeRank[right.priority] ?? 9);
        if (gradeDiff !== 0) return gradeDiff;
        return left.customer_name.localeCompare(right.customer_name);
      });

      const limited = filters.limit && filters.limit > 0 ? sorted.slice(0, filters.limit) : sorted;

      let modelCoaching: 'DETERMINISTIC_ONLY' | 'MODEL_COACHED' = 'DETERMINISTIC_ONLY';
      let coachNotes: Readonly<Record<string, string>> = {};
      if (deps.coach_with_model) {
        coachNotes = await deps.coach_with_model(limited);
        modelCoaching = 'MODEL_COACHED';
      }
      const withNotes = limited.map(item => ({ ...item, coach_note: coachNotes[item.customer_id] ?? null }));

      return {
        generated_at: nowIso,
        items: withNotes,
        sort_explanation: `按确定性规则排序：urgency_score 降序（${limited.length} 位客户进入队列）；同分按客户等级 A>B>C>D；再按名称。模型说明不参与排序。`,
        model_coaching: modelCoaching,
      };
    },
  };

  async function evaluateCustomer(
    customer: Customer,
    _nowIso: string,
    nowMs: number,
  ): Promise<BattleReviewQueueItem | null> {
    const reasons: string[] = [];
    const evidenceChanges: string[] = [];
    const customerId = customer.id;
    let score = 0;

    // ── 规则 1：P0/P1（A/B 级）客户没有下一步动作 ──
    const isHighGrade = customer.customer_grade === 'A' || customer.customer_grade === 'B';
    const isActiveStage = !['WON', 'LOST', 'PAID'].includes(customer.stage);
    if (isHighGrade && isActiveStage && !customer.next_action) {
      reasons.push('P0/P1 客户没有下一步动作');
      score += 30;
    }

    // ── 规则 2：Next follow-up 到期或逾期 ──
    if (customer.next_follow_up_at) {
      const dueMs = Date.parse(customer.next_follow_up_at);
      if (Number.isFinite(dueMs)) {
        const overdueDays = (nowMs - dueMs) / DAY_MS;
        if (overdueDays > 0) {
          reasons.push(`Next follow-up 已逾期 ${Math.round(overdueDays)} 天`);
          score += 25;
        } else if (overdueDays > -1) {
          reasons.push('Next follow-up 今天到期');
          score += 20;
        }
      }
    }

    // ── 规则 3：最近互动发生在当前作战卡之后 ──
    const currentCard = customer.current_stage_card_id
      ? await repos.cards.get(customer.current_stage_card_id)
      : null;
    let cardAgeDays: number | null = null;
    if (currentCard?.confirmed_at) {
      const confirmedMs = Date.parse(currentCard.confirmed_at);
      if (Number.isFinite(confirmedMs)) {
        cardAgeDays = Math.max(0, Math.round((nowMs - confirmedMs) / DAY_MS));
      }
      const latestInteractions = await deps.db.select<{ created_at: string }>(
        `SELECT created_at FROM follow_up_records WHERE customer_id = ?
         UNION ALL SELECT created_at FROM visit_records WHERE customer_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [customerId, customerId],
      );
      const latestInteraction = latestInteractions[0];
      if (latestInteraction && Number.isFinite(Date.parse(latestInteraction.created_at))
        && Date.parse(latestInteraction.created_at) > Date.parse(currentCard.confirmed_at)) {
        reasons.push('最近互动发生在当前作战卡之后（卡片信息可能滞后）');
        evidenceChanges.push(`最新互动 ${latestInteraction.created_at.slice(0, 10)} 晚于卡片确认时间`);
        score += 20;
      }
    }

    // ── 规则 4：当前阶段停滞超过阈值 ──
    const stageRule = getStageRule(customer.stage);
    const lastSignalAt = customer.last_contacted_at ?? customer.updated_at;
    if (lastSignalAt && isActiveStage) {
      const lastMs = Date.parse(lastSignalAt);
      if (Number.isFinite(lastMs)) {
        const stagnantDays = (nowMs - lastMs) / DAY_MS;
        if (stagnantDays > stageRule.stagnation_threshold_days) {
          reasons.push(`当前阶段停滞 ${Math.round(stagnantDays)} 天（阈值 ${stageRule.stagnation_threshold_days} 天）`);
          score += 15;
        }
      }
    }

    // ── 规则 5：三个关键假设长期未验证 ──
    const openHypotheses = await repos.hypotheses.listOpen(customerId);
    const staleHypotheses = openHypotheses.filter(hypothesis => {
      const createdMs = Date.parse(hypothesis.created_at);
      return Number.isFinite(createdMs) && (nowMs - createdMs) / DAY_MS > 7;
    });
    if (staleHypotheses.length >= 3) {
      reasons.push(`${staleHypotheses.length} 个关键假设超过 7 天未验证`);
      score += 15;
    }

    // ── 规则 6：新事实与旧事实冲突 ──
    const conflictedFacts = await repos.facts.listByCustomer(customerId, { verification_status: 'CONFLICTED' });
    if (conflictedFacts.length > 0) {
      reasons.push(`${conflictedFacts.length} 条事实存在冲突（CONFLICTED）`);
      evidenceChanges.push(...conflictedFacts.slice(0, 3).map(fact => `冲突事实: ${fact.statement.slice(0, 40)}`));
      score += 20;
    }

    // ── 规则 7：作战卡过期（超过 7 天未复核） ──
    if (customer.battle_card_status === 'CONFIRMED' && customer.last_battle_review_at) {
      const reviewMs = Date.parse(customer.last_battle_review_at);
      if (Number.isFinite(reviewMs)) {
        const reviewAgeDays = (nowMs - reviewMs) / DAY_MS;
        if (reviewAgeDays > 7) {
          reasons.push(`作战卡超过 7 天未复核（${Math.round(reviewAgeDays)} 天）`);
          score += 10;
        }
      }
    } else if (customer.battle_card_status === 'DRAFT') {
      reasons.push('存在未确认的作战卡草稿（Pending 处理）');
      score += 10;
    }

    // ── 规则 8：当前阶段与互动状态明显不一致 ──
    const stageConsistency = await stageConsistencyIssue(customerId, customer);
    if (stageConsistency) {
      reasons.push(stageConsistency);
      score += 15;
    }

    // 无信号不误报
    if (reasons.length === 0 || score <= 0) return null;

    const keyHypotheses = openHypotheses.slice(0, 3).map(hypothesis => hypothesis.statement);
    const nextBestAction = currentCard
      ? parsePayload(currentCard.payload_json).action_card.next_best_action.objective
      : '尚未生成作战卡，建议先生成阶段作战卡';
    const currentGoal = currentCard
      ? parsePayload(currentCard.payload_json).action_card.stage_goal
      : getStageRule(customer.stage).stage_goal;

    const priority = customer.customer_grade;

    return {
      customer_id: customerId,
      customer_name: customer.name,
      stage: customer.stage,
      priority,
      reasons,
      current_goal: currentGoal,
      key_hypotheses: keyHypotheses,
      next_best_action: nextBestAction,
      card_age_days: cardAgeDays,
      evidence_changes: evidenceChanges,
      urgency_score: score,
      coach_note: null,
    };
  }

  async function stageConsistencyIssue(customerId: string, customer: Customer): Promise<string | null> {
    if (customer.stage === 'WON' || customer.stage === 'LOST') return null;
    const latest = await deps.db.select<{ contact_result: string | null; feedback_notes: string | null; created_at: string }>(
      'SELECT contact_result, feedback_notes, created_at FROM follow_up_records WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [customerId],
    );
    const row = latest[0];
    if (!row) return null;
    const negative = row.contact_result === 'negative' || (row.feedback_notes?.includes('拒绝') ?? false)
      || (row.feedback_notes?.includes('不需要') ?? false);
    const forwardStages: CustomerStage[] = ['VISIT_READY', 'VISITED', 'CONTRACTING', 'PAYMENT_PENDING', 'PAID'];
    if (negative && forwardStages.includes(customer.stage)) {
      return `阶段 ${customer.stage} 与最近一次负反馈（${row.created_at.slice(0, 10)}）不一致，需人工确认`;
    }
    return null;
  }
}
