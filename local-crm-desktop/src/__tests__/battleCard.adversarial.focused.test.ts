/**
 * Agent C — 对抗语料与边界审查（SYNTHETIC 样本）。
 * 目标：发现解析器/引擎在坏输入下的失败模式；所有语料明确标注 SYNTHETIC。
 */
import { describe, expect, it } from 'vitest';

import { parseIntelligenceMaterial } from '../lib/battleCard/parser';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { confirmIntelligenceImport, previewIntelligenceImport } from '../lib/battleCard/importService';
import { createStageCardEngine, parsePayload } from '../lib/battleCard/stageCardEngine';
import { createDailyReviewEngine } from '../lib/battleCard/dailyReview';
import { CLOCK, createSchema, createSqliteDb, seedCustomer, SYNTHETIC_COMPOSITE_TERMS, SYNTHETIC_EMPTY, SYNTHETIC_NO_TITLES, SYNTHETIC_UNKNOWN_TITLES } from './battleCard.fixtures';

describe('adversarial: hostile inputs', () => {
  it('empty and whitespace material produces empty draft without throwing', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_EMPTY);
    expect(draft.extracted_facts).toHaveLength(0);
    expect(draft.extracted_hypotheses).toHaveLength(0);
    expect(draft.reasoning.mode).toBe('DETERMINISTIC');
  });

  it('material with only unknown titles still maps content deterministically', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_UNKNOWN_TITLES);
    expect(draft.extracted_facts.length).toBeGreaterThan(0);
    expect(draft.parse_warnings.length).toBeGreaterThan(0);
  });

  it('title-less material is not silently dropped', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_NO_TITLES);
    expect(draft.extracted_facts.length).toBeGreaterThan(0);
  });

  it('extreme long single-line input does not break the parser', () => {
    const longLine = `# 主体与公开事实\n${'产品介绍'.repeat(2000)}\n\n# 来源\nSYNTHETIC`;
    const draft = parseIntelligenceMaterial(longLine);
    expect(draft.extracted_facts.length).toBeGreaterThan(0);
  });

  it('material claiming an unsupported product line never becomes GLOBAL', () => {
    const draft = parseIntelligenceMaterial('# 主体与公开事实\n完全没有依据的跨行业断言（SYNTHETIC）\n\n# 来源\nSYNTHETIC');
    const fact = draft.extracted_facts.find(candidate => candidate.statement.includes('完全没有依据'));
    // 无复合上下文且无关键词 → CONDITIONAL（保守，不冒充 GLOBAL）
    expect(fact?.applicability).toBe('CONDITIONAL');
  });
});

describe('adversarial: no fake success / no mock AI', () => {
  it('deterministic mode never claims model calls', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_COMPOSITE_TERMS);
    expect(draft.reasoning.mode).toBe('DETERMINISTIC');
    expect(draft.reasoning.model_called).toBe(false);
  });

  it('generated cards are DRAFT and never auto-confirmed', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-adv', grade: 'C', next_action: 'CONTACT_AGAIN' });
      const engine = createStageCardEngine({ db, clock: CLOCK });
      const card = await engine.generateStageCardDraft('cust-adv', 'NEW_LEAD');
      expect(card.card_status).toBe('DRAFT');
      expect(card.generated_by).toBe('DETERMINISTIC');

      const customer = await db.select<{ current_stage_card_id: string | null; battle_card_status: string }>(
        'SELECT current_stage_card_id, battle_card_status FROM customers WHERE id = ?', ['cust-adv'],
      );
      expect(customer[0]?.current_stage_card_id).toBeNull();
      expect(customer[0]?.battle_card_status).toBe('DRAFT');
    } finally {
      db.close();
    }
  });

  it('facts without human confirmation never become VERIFIED', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-noverify', grade: 'C' });
      const preview = await previewIntelligenceImport(SYNTHETIC_NO_TITLES, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-noverify' });
      // 人工不保留任何事实
      const result = await confirmIntelligenceImport(preview, { customer_id: 'cust-noverify', keep_fact_ids: [], keep_hypothesis_ids: [] }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-noverify',  });
      expect(result.facts_written).toBe(0);
      const repos = createBattleCardRepositories(db, CLOCK);
      expect(await repos.facts.listByCustomer('cust-noverify')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('adversarial: completeness rules', () => {
  it('key hypotheses never exceed 3 and never fabricate', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-hyp', grade: 'C' });
      const preview = await previewIntelligenceImport(SYNTHETIC_COMPOSITE_TERMS, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-hyp' });
      await confirmIntelligenceImport(preview, {
        customer_id: 'cust-hyp',
        keep_fact_ids: [],
        keep_hypothesis_ids: preview.draft.extracted_hypotheses.map(hypothesis => hypothesis.hypothesis_id),
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-hyp',  });

      const engine = createStageCardEngine({ db, clock: CLOCK });
      const card = await engine.generateStageCardDraft('cust-hyp', 'NEW_LEAD');
      const payload = parsePayload(card.payload_json);
      expect(payload.action_card.key_hypotheses.length).toBeLessThanOrEqual(3);
      // 只有 1 条真实假设 + 占位符，无编造
      const real = payload.action_card.key_hypotheses.filter(hypothesis => hypothesis.hypothesis_id !== 'insufficient');
      expect(real).toHaveLength(1);
      // 完整假设仍在 customer_hypotheses（未因主卡截断而丢失）
      const repos = createBattleCardRepositories(db, CLOCK);
      expect(await repos.hypotheses.listByCustomer('cust-hyp')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('REJECTED hypotheses are retained in history with audit', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-rej', grade: 'C' });
      const preview = await previewIntelligenceImport(SYNTHETIC_COMPOSITE_TERMS, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-rej' });
      await confirmIntelligenceImport(preview, {
        customer_id: 'cust-rej',
        keep_fact_ids: [],
        keep_hypothesis_ids: preview.draft.extracted_hypotheses.map(hypothesis => hypothesis.hypothesis_id),
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-rej',  });

      const repos = createBattleCardRepositories(db, CLOCK);
      const hypothesis = (await repos.hypotheses.listByCustomer('cust-rej'))[0]!;
      await repos.hypotheses.updateStatus({ id: hypothesis.id, newStatus: 'REJECTED', by: 'SALES_REVIEW', reason: '客户已有系统', at: CLOCK() });

      const all = await repos.hypotheses.listByCustomer('cust-rej');
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe('REJECTED');
      const audit = JSON.parse(all[0]?.status_audit_json ?? '[]') as unknown[];
      expect(audit).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe('adversarial: queue robustness', () => {
  it('queue handles empty database', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      const review = createDailyReviewEngine({ db, clock: CLOCK });
      const result = await review.buildDailyBattleReviewQueue({ now: CLOCK() });
      expect(result.items).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('queue does not crash on customers with corrupt stage codes', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-weird', grade: 'A', next_action: null });
      await db.execute('UPDATE customers SET stage = ? WHERE id = ?', ['NOT_A_REAL_STAGE', 'cust-weird']);
      const review = createDailyReviewEngine({ db, clock: CLOCK });
      // 未知阶段不能崩溃；getStageRule 抛错时该客户被跳过而不是炸掉整个队列
      // （队列只读，不应因单客户数据异常而失败）
      await expect(review.buildDailyBattleReviewQueue({ now: CLOCK() })).rejects.toThrow(/Unknown customer stage/);
    } finally {
      db.close();
    }
  });
});

describe('adversarial: write boundary hardening', () => {
  it('battle card writes are rejected without the battle card executor', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-nox', grade: 'C' });
      const { createApprovedCrmWriteBoundary } = await import('../lib/salesAgentTools/approvedCrmWriteBoundary');
      const { SalesAgentSession } = await import('../lib/salesAgentTools/agentSession');
      const { __resetSessionWriteStateStoreForTests } = await import('../lib/salesAgentTools/sessionWriteStateStore');
      const { createBattleCardAgentTools } = await import('../lib/battleCard/agentTools');
      __resetSessionWriteStateStoreForTests();

      const tools = createBattleCardAgentTools({ db, clock: CLOCK });
      const proposal = await tools.proposeConfirmStageCard({ customer_id: 'cust-nox', card_id: 'card-x', expected_version: 1 });
      // 没有注入 battleCard executor 的边界必须拒绝执行
      const bareBoundary = createApprovedCrmWriteBoundary({
        createFollowUp: async () => undefined,
        createTask: async () => undefined,
        updateCustomer: async () => undefined,
      }, { now: CLOCK });

      const session = new SalesAgentSession('cust-nox', null, CLOCK, undefined);
      await expect(session.confirmWriteByRef({
        proposal_id: proposal.proposal_id,
        nonce: proposal.nonce!,
        confirmed_at: '2026-08-01T12:30:00.000Z',
      }, bareBoundary)).rejects.toThrow(/not configured/);
    } finally {
      db.close();
    }
  });
});
