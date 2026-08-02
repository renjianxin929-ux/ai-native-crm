/**
 * Agent B — 阶段作战卡引擎 focused tests（测试矩阵 D）。
 * append-only / version 单调 / supersedes / 旧卡不覆盖 / 双卡完整 / 话术 original 不覆盖 /
 * 同行边界 / 阶段不自动变 / Evidence ownership / 与上一卡差异。
 */
import { describe, expect, it } from 'vitest';

import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { confirmIntelligenceImport, previewIntelligenceImport } from '../lib/battleCard/importService';
import { createStageCardEngine, parsePayload } from '../lib/battleCard/stageCardEngine';
import { KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER } from '../lib/battleCard/types';
import { CLOCK, createSchema, createSqliteDb, GOLDEN_SAMPLE_TINSOL, NOW, seedCustomer } from './battleCard.fixtures';

async function seedTinsolWithImport(db: ReturnType<typeof createSqliteDb>): Promise<void> {
  await createSchema(db);
  await seedCustomer(db);
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
  const keepFactIds = preview.draft.extracted_facts.slice(0, 4).map(fact => fact.fact_id);
  // 显式核实（新契约：keep 仅 PENDING；卡片只读 VERIFIED）
  const factVerifications = keepFactIds.map(factId => ({
    fact_id: factId,
    decision: 'VERIFY' as const,
    applicable_scope: '80+ 国家版本',
    evidence_refs: ['import:官方活动案例'],
  }));
  await confirmIntelligenceImport(preview, {
    customer_id: 'cust-tinsol',
    keep_fact_ids: keepFactIds,
    keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 3).map(hypothesis => hypothesis.hypothesis_id),
    fact_verifications: factVerifications,
  }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
}

describe('stage card generation', () => {
  it('generates a complete DRAFT with both cards intact', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      expect(card.card_status).toBe('DRAFT');
      expect(card.version).toBe(1);
      expect(card.stage_code).toBe('NEW_LEAD');
      expect(card.generated_by).toBe('DETERMINISTIC');
      expect(card.evidence_snapshot_hash.length).toBe(64);

      const payload = parsePayload(card.payload_json);
      // A. action_card 闭合字段
      expect(payload.action_card.stage_goal.length).toBeGreaterThan(0);
      expect(payload.action_card.stage_entry_criteria.length).toBeGreaterThan(0);
      expect(payload.action_card.stage_exit_criteria.length).toBeGreaterThan(0);
      expect(payload.action_card.confirmed_facts.length).toBe(3);
      expect(payload.action_card.next_best_action.objective.length).toBeGreaterThan(0);
      expect(payload.action_card.next_best_action.opening.length).toBeGreaterThan(0);
      expect(payload.action_card.next_best_action.success_signal.length).toBeGreaterThan(0);
      expect(payload.action_card.next_best_action.fallback_action.length).toBeGreaterThan(0);
      // B. solution_reference_card 闭合字段
      expect(payload.solution_reference_card.feishu_value_statement.original).toContain('根据我目前看到的公开信息');
      expect(payload.solution_reference_card.peer_references.length).toBe(3);
      expect(payload.solution_reference_card.solution_scenarios.length).toBeGreaterThan(0);
      expect(payload.solution_reference_card.poc_path.length).toBe(1);
      expect(payload.solution_reference_card.human_review_boundaries.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('keeps stage unchanged and customer grade unchanged', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const before = await db.select<{ stage: string; customer_grade: string }>('SELECT stage, customer_grade FROM customers WHERE id = ?', ['cust-tinsol']);
      await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const after = await db.select<{ stage: string; customer_grade: string; battle_card_status: string }>('SELECT stage, customer_grade, battle_card_status FROM customers WHERE id = ?', ['cust-tinsol']);

      expect(after[0]?.stage).toBe(before[0]?.stage);
      expect(after[0]?.customer_grade).toBe(before[0]?.customer_grade);
      expect(after[0]?.battle_card_status).toBe('DRAFT');
    } finally {
      db.close();
    }
  });

  it('shows exactly 3 key hypotheses and the insufficiency placeholder when short', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const payload = parsePayload(card.payload_json);
      const realHypotheses = payload.action_card.key_hypotheses.filter(hypothesis => hypothesis.hypothesis_id !== 'insufficient');
      expect(realHypotheses).toHaveLength(3);
      // 完整假设仍保存在 customer_hypotheses
      const repos = createBattleCardRepositories(db, CLOCK);
      expect(await repos.hypotheses.listByCustomer('cust-tinsol')).toHaveLength(3);

      // 假设不足时不编造：构造只有 1 条假设的客户
      await seedCustomer(db, { id: 'cust-sparse', name: '稀疏假设客户' });
      const preview = await previewIntelligenceImport(`# 当前问题假设\nH1：只有一条假设（SYNTHETIC）\n\n# 来源\nSYNTHETIC`, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      await confirmIntelligenceImport(preview, {
        customer_id: 'cust-sparse',
        keep_fact_ids: [],
        keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 1).map(hypothesis => hypothesis.hypothesis_id),
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      const sparseCard = await engine.generateStageCardDraft('cust-sparse', 'NEW_LEAD');
      const sparsePayload = parsePayload(sparseCard.payload_json);
      expect(sparsePayload.action_card.key_hypotheses).toHaveLength(2);
      expect(sparsePayload.action_card.key_hypotheses[1]?.statement).toBe(KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER);
    } finally {
      db.close();
    }
  });

  it('key hypotheses carry full fields including disconfirm condition', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const payload = parsePayload(card.payload_json);
      const first = payload.action_card.key_hypotheses[0];
      expect(first?.hypothesis_id).toBeTruthy();
      expect(first?.statement).toBeTruthy();
      expect(first?.why_it_matters).toBeDefined();
      expect(first?.validation_question).toBeDefined();
      expect(first?.disconfirm_condition).toBeDefined();
    } finally {
      db.close();
    }
  });
});

describe('append-only versioning', () => {
  it('versions increase monotonically and old cards are never overwritten', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const v1 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const v2 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      expect(v2.version).toBe(v1.version + 1);
      expect(v2.supersedes_card_id).toBe(v1.id);

      const history = await engine.listStageCardHistory('cust-tinsol');
      expect(history).toHaveLength(2);
      expect(history.map(card => card.version)).toEqual([1, 2]);

      // v1 内容未被覆盖
      const v1Payload = parsePayload(v1.payload_json);
      expect(v1Payload.action_card.current_situation).toContain('广州电秀');
    } finally {
      db.close();
    }
  });

  it('confirm transitions and updates the customer pointer; old confirmed card is not overwritten', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });
      const repos = createBattleCardRepositories(db, CLOCK);

      const v1 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const confirmed1 = await engine.confirmStageCard(v1.id, 'HUMAN');
      expect(confirmed1.card_status).toBe('CONFIRMED');

      let customer = await db.select<{ current_stage_card_id: string | null }>('SELECT current_stage_card_id FROM customers WHERE id = ?', ['cust-tinsol']);
      expect(customer[0]?.current_stage_card_id).toBe(v1.id);

      // 生成 v2 并确认 → 指针切换，v1 仍保留在历史
      const v2 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      await engine.confirmStageCard(v2.id, 'HUMAN');
      customer = await db.select<{ current_stage_card_id: string | null }>('SELECT current_stage_card_id FROM customers WHERE id = ?', ['cust-tinsol']);
      expect(customer[0]?.current_stage_card_id).toBe(v2.id);

      const history = await repos.cards.listByCustomer('cust-tinsol');
      expect(history).toHaveLength(2);
      expect(history[0]?.card_status).toBe('CONFIRMED');
      expect(history[1]?.card_status).toBe('CONFIRMED');
    } finally {
      db.close();
    }
  });

  it('getCurrentStageCard returns null before any confirmation', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });
      expect(await engine.getCurrentStageCard('cust-tinsol')).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('feishu talk preservation in cards', () => {
  it('original talk statement is never overwritten across versions', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const v1 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const v2 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');

      const v1Talk = parsePayload(v1.payload_json).solution_reference_card.feishu_value_statement;
      const v2Talk = parsePayload(v2.payload_json).solution_reference_card.feishu_value_statement;
      expect(v2Talk.original).toBe(v1Talk.original);
      expect(v2Talk.original).toContain('能很快判断飞书到底有没有价值');
      expect(v2Talk.current).toBe(v1Talk.original);
      expect(v2Talk.version_history).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('peer references in cards', () => {
  it('peers keep why-comparable and non-transferable boundaries', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const payload = parsePayload(card.payload_json);
      const peers = payload.solution_reference_card.peer_references;

      const supr = peers.find(peer => peer.company_name === 'SUPRENT');
      expect(supr?.why_comparable).toContain('参照型号');
      expect(supr?.non_transferable_boundary).toContain('不宣称其使用飞书');

      const flashfish = peers.find(peer => peer.company_name === 'FF FlashFish');
      expect(flashfish?.why_comparable).toContain('参照型号');
      expect(flashfish?.non_transferable_boundary).toContain('不宣称其使用飞书');
    } finally {
      db.close();
    }
  });
});

describe('evidence ownership', () => {
  it('card evidence refs point to facts, hypotheses and the customer', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const payload = parsePayload(card.payload_json);

      const allRefs = [...payload.action_card.evidence_refs, ...payload.solution_reference_card.evidence_refs];
      expect(allRefs.some(ref => ref.startsWith('reviewed_fact:'))).toBe(true);
      expect(allRefs.some(ref => ref.startsWith('customer:'))).toBe(true);

      const repos = createBattleCardRepositories(db, CLOCK);
      const facts = await repos.facts.listByCustomer('cust-tinsol');
      const factIds = new Set(facts.map(fact => fact.id));
      const cardFactRefs = payload.action_card.confirmed_facts.map(fact => fact.fact_id);
      expect(cardFactRefs.every(id => factIds.has(id))).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('compare stage cards', () => {
  it('reports section and field-level differences between versions', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const v1 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      // 制造差异：新增一条事实后生成 v2
      const repos = createBattleCardRepositories(db, CLOCK);
      const importRow = (await repos.imports.listByCustomer('cust-tinsol'))[0];
      await repos.facts.insert({
        id: 'fact-extra', customer_id: 'cust-tinsol', source_import_id: importRow!.id,
        fact_category: 'MARKET', statement: '新增事实：覆盖拉美市场（SYNTHETIC）', verification_status: 'VERIFIED',
        confidence: 0.9, applicability: 'GLOBAL', evidence_refs: [{ import_ref: '主体与公开事实:1' }], created_at: NOW,
      });
      const v2 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');

      const comparison = await engine.compareStageCards(v1.id, v2.id);
      expect(comparison.previous_version).toBe(1);
      expect(comparison.current_version).toBe(2);
      expect(comparison.changed_sections).toContain('action_card');
      expect(comparison.changes.some(change => String(change.to).includes('拉美市场'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('changes_since_previous_card explains the delta', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const v1 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      expect(parsePayload(v1.payload_json).action_card.changes_since_previous_card).toEqual(['首张作战卡（无上一张可比）']);

      const v2 = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      const changes = parsePayload(v2.payload_json).action_card.changes_since_previous_card;
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some(change => change.includes('互动状态'))).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('card generation without provider', () => {
  it('generates a deterministic skeleton clearly marked', async () => {
    const db = createSqliteDb();
    try {
      await seedTinsolWithImport(db);
      const engine = createStageCardEngine({ db, clock: CLOCK });

      const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
      expect(card.generated_by).toBe('DETERMINISTIC');
      const payload = parsePayload(card.payload_json);
      // 无证据时明确写待验证
      expect(payload.action_card.confidence).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
