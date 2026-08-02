/**
 * Agent B — 每日复盘队列 focused tests（测试矩阵 F）。
 * 确定性规则触发 / 无变化不误报 / 排序可解释 / 模型不可用仍工作。
 */
import { describe, expect, it } from 'vitest';

import { createDailyReviewEngine } from '../lib/battleCard/dailyReview';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { confirmIntelligenceImport, previewIntelligenceImport } from '../lib/battleCard/importService';
import { createStageCardEngine } from '../lib/battleCard/stageCardEngine';
import { CLOCK, createSchema, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

const NOW_ISO = '2026-08-01T12:00:00.000Z';
const DAYS = (days: number) => new Date(Date.parse(NOW_ISO) - days * 24 * 60 * 60 * 1000).toISOString();

async function seedImport(db: ReturnType<typeof createSqliteDb>, customerId: string): Promise<void> {
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
  await confirmIntelligenceImport(preview, {
    customer_id: customerId,
    keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
    keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 3).map(hypothesis => hypothesis.hypothesis_id),
  }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
}

describe('daily review queue rules', () => {
  it('P0/P1 customer without next action enters the queue', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-a', grade: 'A', stage: 'NEW_LEAD', next_action: null });
      const review = createDailyReviewEngine({ db, clock: CLOCK });

      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-a');
      expect(item).toBeDefined();
      expect(item?.reasons.some(reason => reason.includes('没有下一步动作'))).toBe(true);
      expect(item?.urgency_score).toBeGreaterThanOrEqual(30);
    } finally {
      db.close();
    }
  });

  it('overdue follow-up enters the queue', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-b', grade: 'C', next_follow_up_at: DAYS(3), next_action: 'CONTACT_AGAIN' });
      const review = createDailyReviewEngine({ db, clock: CLOCK });

      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-b');
      expect(item?.reasons.some(reason => reason.includes('逾期'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('interaction after the current card enters the queue with evidence change', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-c', grade: 'A', next_action: 'CONTACT_AGAIN' });
      await seedImport(db, 'cust-c');
      const engine = createStageCardEngine({ db, clock: CLOCK });
      const card = await engine.generateStageCardDraft('cust-c', 'NEW_LEAD');
      await engine.confirmStageCard(card.id, 'HUMAN');

      // 卡片确认后发生新互动
      await db.execute(
        `INSERT INTO follow_up_records (id, customer_id, title, contact_channel, feedback_notes, is_completed, created_at, updated_at)
         VALUES ('fu-after-card', 'cust-c', '卡片后跟进', 'wechat', '客户询问方案细节', 0, '2026-08-01T12:30:00.000Z', '2026-08-01T12:30:00.000Z')`,
      );

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-c');
      expect(item?.reasons.some(reason => reason.includes('最近互动发生在当前作战卡之后'))).toBe(true);
      expect(item?.evidence_changes.some(change => change.includes('晚于卡片确认时间'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('stagnant stage beyond threshold enters the queue', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      // NEW_LEAD 停滞阈值 7 天；last_contacted_at 12 天前，且有 next_action 避免规则 1 干扰
      await seedCustomer(db, { id: 'cust-d', grade: 'C', stage: 'NEW_LEAD', last_contacted_at: DAYS(12), next_action: 'CONTACT_AGAIN' });
      const review = createDailyReviewEngine({ db, clock: CLOCK });

      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-d');
      expect(item?.reasons.some(reason => reason.includes('停滞'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('three hypotheses stale beyond 7 days enters the queue', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-e', grade: 'C', next_action: 'CONTACT_AGAIN' });
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      // 用 10 天前的时钟创建假设（陈旧）
      const oldClock = () => DAYS(10);
      await confirmIntelligenceImport(preview, {
        customer_id: 'cust-e',
        keep_fact_ids: [],
        keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 3).map(hypothesis => hypothesis.hypothesis_id),
      }, { db, clock: oldClock, source_system: 'FEISHU_BTABLE' });

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-e');
      expect(item?.reasons.some(reason => reason.includes('假设超过 7 天未验证'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('conflicted facts enter the queue as evidence changes', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-f', grade: 'B', next_action: 'CONTACT_AGAIN' });
      const repos = createBattleCardRepositories(db, CLOCK);
      await seedImport(db, 'cust-f');
      const facts = await repos.facts.listByCustomer('cust-f');
      await repos.facts.markConflicted(facts[0]!.id, '冲突测试', NOW_ISO);

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-f');
      expect(item?.reasons.some(reason => reason.includes('事实存在冲突'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('expired card beyond review window enters the queue', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-g', grade: 'C', next_action: 'CONTACT_AGAIN' });
      await seedImport(db, 'cust-g');
      const engine = createStageCardEngine({ db, clock: CLOCK });
      const card = await engine.generateStageCardDraft('cust-g', 'NEW_LEAD');
      await engine.confirmStageCard(card.id, 'HUMAN');
      // 回拨确认时间到 10 天前
      await db.execute('UPDATE customer_stage_cards SET confirmed_at = ? WHERE id = ?', [DAYS(10), card.id]);
      await db.execute('UPDATE customers SET last_battle_review_at = ? WHERE id = ?', [DAYS(10), 'cust-g']);

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-g');
      expect(item?.reasons.some(reason => reason.includes('超过 7 天未复核'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('unconfirmed DRAFT card counts as pending handling', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-h', grade: 'C', next_action: 'CONTACT_AGAIN' });
      await seedImport(db, 'cust-h');
      const engine = createStageCardEngine({ db, clock: CLOCK });
      await engine.generateStageCardDraft('cust-h', 'NEW_LEAD');

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-h');
      expect(item?.reasons.some(reason => reason.includes('未确认的作战卡草稿'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('stage vs interaction mismatch enters the queue', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-i', grade: 'C', stage: 'VISIT_READY', next_action: 'SCHEDULE_VISIT' });
      await db.execute(
        `INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result, feedback_notes, is_completed, created_at, updated_at)
         VALUES ('fu-negative', 'cust-i', '回访', 'wechat', 'negative', '客户明确拒绝', 0, '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z')`,
      );

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const item = result.items.find(candidate => candidate.customer_id === 'cust-i');
      expect(item?.reasons.some(reason => reason.includes('不一致'))).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('queue behavior', () => {
  it('does not report customers without signals', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      // 无逾期、有下一步、刚联系过、非高等级
      await seedCustomer(db, { id: 'cust-calm', grade: 'C', stage: 'NEW_LEAD', next_follow_up_at: DAYS(-1) ? undefined : null, last_contacted_at: '2026-08-01T10:00:00.000Z', next_action: 'CONTACT_AGAIN' });
      await db.execute('UPDATE customers SET next_follow_up_at = ? WHERE id = ?', ['2026-08-05T00:00:00.000Z', 'cust-calm']);

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      expect(result.items.find(candidate => candidate.customer_id === 'cust-calm')).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('sorts deterministically by urgency then grade and explains the order', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      // A 级无下一步（30 分）vs C 级逾期（25 分）
      await seedCustomer(db, { id: 'cust-p0', grade: 'A', next_action: null });
      await seedCustomer(db, { id: 'cust-overdue', grade: 'C', next_action: 'CONTACT_AGAIN', next_follow_up_at: DAYS(2) });

      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      const sorted = result.items.map(item => item.customer_id);
      expect(sorted.indexOf('cust-p0')).toBeLessThan(sorted.indexOf('cust-overdue'));
      expect(result.sort_explanation).toContain('确定性');
      expect(result.model_coaching).toBe('DETERMINISTIC_ONLY');
    } finally {
      db.close();
    }
  });

  it('works without any model (coach injection absent)', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-nomodel', grade: 'A', next_action: null });
      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every(item => item.coach_note === null)).toBe(true);
      expect(result.model_coaching).toBe('DETERMINISTIC_ONLY');
    } finally {
      db.close();
    }
  });

  it('model coach notes do not change ordering', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-p0', grade: 'A', next_action: null });
      await seedCustomer(db, { id: 'cust-overdue', grade: 'C', next_action: 'CONTACT_AGAIN', next_follow_up_at: DAYS(2) });

      const review = createDailyReviewEngine({
        db, clock: CLOCK,
        coach_with_model: async (items) => Object.fromEntries(items.map(item => [item.customer_id, `教练说明 ${item.customer_name}`])),
      });
      const result = await review.buildDailyBattleReviewQueue({ now: NOW_ISO });
      expect(result.model_coaching).toBe('MODEL_COACHED');
      const sorted = result.items.map(item => item.customer_id);
      expect(sorted.indexOf('cust-p0')).toBeLessThan(sorted.indexOf('cust-overdue'));
      const coached = result.items.find(item => item.customer_id === 'cust-p0');
      expect(coached?.coach_note).toContain('教练说明');
    } finally {
      db.close();
    }
  });
});
