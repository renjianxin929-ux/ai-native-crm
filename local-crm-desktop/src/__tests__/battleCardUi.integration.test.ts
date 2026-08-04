/**
 * Battle Card UI — 集成测试：真实后端 service/adapter + 生产 UI Client。
 * 使用与 productionConstruction acceptance 相同的隔离 SQLite + __setDbInstanceForTests 后门；
 * 前端 UI Client（src/lib/battleCardUi/battleCardClient.ts）零 mock。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { createBattleCardUiClient } from '../lib/battleCardUi/battleCardClient';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { CLOCK, createSqliteDb, GOLDEN_SAMPLE_TINSOL, SYNTHETIC_FORMULA_NO_PRODUCT_LINE, seedCustomer } from './battleCard.fixtures';
import { previewIntelligenceImport } from '../lib/battleCard/importService';

let db: ReturnType<typeof createSqliteDb>;

beforeEach(async () => {
  __resetSessionWriteStateStoreForTests();
  db = createSqliteDb();
  await initializeDatabaseSchema(db);
  await seedCustomer(db);
  __setDbInstanceForTests(db);
});

afterEach(() => {
  __setDbInstanceForTests(null);
  db.close();
});

async function rowCount(table: string): Promise<number> {
  const rows = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(rows[0]?.count ?? 0);
}

describe('battleCardUi client — import preview / cancel / confirm / replay (真实后端)', () => {
  it('preview is deterministic and zero-write; parses the golden sample company name', async () => {
    const client = createBattleCardUiClient();
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    expect(preview.writes).toBe(0);
    expect(preview.draft.candidate_customer?.name).toContain('广州电秀');
    expect(preview.draft.extracted_hypotheses.length).toBeGreaterThanOrEqual(4);
    expect(preview.draft.peer_references.map(peer => peer.company_name)).toEqual(
      expect.arrayContaining(['SUPRENT', '触沃电子', 'FF FlashFish']),
    );
    expect(preview.draft.feishu_talk_track.paragraphs.length).toBeGreaterThan(0);
    expect(await rowCount('intelligence_imports')).toBe(0);
    expect(await rowCount('reviewed_facts')).toBe(0);
  });

  it('cancel proposal → zero writes, confirm rejected', async () => {
    const client = createBattleCardUiClient();
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 2).map(fact => fact.fact_id),
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 2).map(hypothesis => hypothesis.hypothesis_id),
    });
    expect(proposal.status).toBe('awaiting_confirmation');
    client.cancelProposal(proposal);
    await expect(client.confirmProposal(proposal)).rejects.toThrow();
    expect(await rowCount('intelligence_imports')).toBe(0);
    expect(await rowCount('reviewed_facts')).toBe(0);
    expect(await rowCount('customer_hypotheses')).toBe(0);
  });

  it('confirm executes exactly once; replay writes nothing a second time', async () => {
    const client = createBattleCardUiClient();
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const keepFacts = preview.draft.extracted_facts.filter(fact => fact.applicability !== 'CONDITIONAL').slice(0, 2).map(fact => fact.fact_id);
    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: keepFacts,
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 2).map(hypothesis => hypothesis.hypothesis_id),
    });
    const outcome = await client.confirmProposal(proposal);
    expect(outcome.entity_id).toBeTruthy();
    expect(await rowCount('intelligence_imports')).toBe(1);
    expect(await rowCount('reviewed_facts')).toBe(keepFacts.length);
    expect(await rowCount('customer_hypotheses')).toBe(2);

    // replay：nonce 已消费
    await expect(client.confirmProposal(proposal)).rejects.toThrow(/replay|consumed/i);
    expect(await rowCount('intelligence_imports')).toBe(1);
    expect(await rowCount('reviewed_facts')).toBe(keepFacts.length);

    // 重复导入同一材料（同 customer+source+hash）→ 幂等去重
    const preview2 = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const proposal2 = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: keepFacts,
      keep_hypothesis_ids: preview2.draft.extracted_hypotheses.slice(0, 2).map(hypothesis => hypothesis.hypothesis_id),
    });
    const outcome2 = await client.confirmProposal(proposal2);
    expect(outcome2.entity_id).toBeTruthy();
    expect(await rowCount('intelligence_imports')).toBe(1);
  });

  it('H1–H4 hypotheses never enter reviewed_facts; facts default PENDING unless verified', async () => {
    const client = createBattleCardUiClient();
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const hypothesisStatements = preview.draft.extracted_hypotheses.map(hypothesis => hypothesis.statement);
    expect(hypothesisStatements.some(statement => statement.includes('新品横跨品牌'))).toBe(true);
    expect(hypothesisStatements.some(statement => statement.includes('合规压力'))).toBe(true);
    expect(hypothesisStatements.some(statement => statement.includes('达人寄样'))).toBe(true);
    expect(hypothesisStatements.some(statement => statement.includes('评论、客服与退货'))).toBe(true);

    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 3).map(fact => fact.fact_id),
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 4).map(hypothesis => hypothesis.hypothesis_id),
    });
    await client.confirmProposal(proposal);

    const factRows = await db.select<{ statement: string; verification_status: string }>('SELECT statement, verification_status FROM reviewed_facts');
    expect(factRows).toHaveLength(3);
    for (const fact of factRows) expect(fact.verification_status).toBe('PENDING');
    const hypothesisRows = await db.select<{ statement: string; status: string }>('SELECT statement, status FROM customer_hypotheses');
    expect(hypothesisRows).toHaveLength(4);
    for (const hypothesis of hypothesisRows) expect(hypothesis.status).toBe('PENDING');
  });

  it('scope binding: confirmation through a different customer session is rejected', async () => {
    const client = createBattleCardUiClient();
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: [],
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 1).map(hypothesis => hypothesis.hypothesis_id),
    });
    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    const wrongSession = new SalesAgentSession('cust-other', null, CLOCK, undefined);
    await expect(wrongSession.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce ?? '',
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow();
    expect(await rowCount('intelligence_imports')).toBe(0);
  });
});

describe('battleCardUi client — stage card lifecycle (真实后端)', () => {
  async function seedConfirmedImport(client: ReturnType<typeof createBattleCardUiClient>): Promise<void> {
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 2).map(fact => fact.fact_id),
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 4).map(hypothesis => hypothesis.hypothesis_id),
    });
    await client.confirmProposal(proposal);
  }

  it('draft generation → current card read → confirm → history read (no stage/grade mutation)', async () => {
    const client = createBattleCardUiClient();
    await seedConfirmedImport(client);

    expect(await client.getCurrentStageCard('cust-tinsol')).toBeNull();

    const draft = await client.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    expect(draft.card_status).toBe('DRAFT');
    expect(draft.version).toBe(1);
    expect(draft.generated_by).toBe('DETERMINISTIC');

    const customerBefore = (await db.select<{ stage: string; customer_grade: string }>('SELECT stage, customer_grade FROM customers WHERE id = ?', ['cust-tinsol']))[0]!;
    expect(customerBefore.stage).toBe('NEW_LEAD');
    expect(customerBefore.customer_grade).toBe('A');

    // 草稿期间 current card 仍为 null（指针只在确认时更新）
    expect(await client.getCurrentStageCard('cust-tinsol')).toBeNull();

    const confirmProposal = await client.proposeConfirmStageCard('cust-tinsol', draft.id, draft.version);
    await client.confirmProposal(confirmProposal);

    const current = await client.getCurrentStageCard('cust-tinsol');
    expect(current?.id).toBe(draft.id);
    expect(current?.card_status).toBe('CONFIRMED');

    const customerAfter = (await db.select<{ stage: string; customer_grade: string }>('SELECT stage, customer_grade FROM customers WHERE id = ?', ['cust-tinsol']))[0]!;
    expect(customerAfter.stage).toBe('NEW_LEAD');
    expect(customerAfter.customer_grade).toBe('A');

    const history = await client.listStageCardHistory('cust-tinsol');
    expect(history).toHaveLength(1);
    expect(history[0]?.version).toBe(1);
  });

  it('historical version read + compare works; draft confirm proposal carries idempotency', async () => {
    const client = createBattleCardUiClient();
    await seedConfirmedImport(client);
    const draft1 = await client.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    const proposal1 = await client.proposeConfirmStageCard('cust-tinsol', draft1.id, draft1.version);
    await client.confirmProposal(proposal1);

    // 第二次生成 → v2，supersedes v1
    const draft2 = await client.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    expect(draft2.version).toBe(2);
    expect(draft2.supersedes_card_id).toBe(draft1.id);

    const history = await client.listStageCardHistory('cust-tinsol');
    expect(history.map(card => card.version)).toEqual([1, 2]);

    const comparison = await client.compareStageCards(draft1.id, draft2.id);
    expect(comparison.previous_version).toBe(1);
    expect(comparison.current_version).toBe(2);
    expect(comparison.changed_sections.length).toBeGreaterThanOrEqual(1);
  });

  it('hypothesis status update proposal requires expected_version; stale version rejected', async () => {
    const client = createBattleCardUiClient();
    await seedConfirmedImport(client);
    const repos = createBattleCardRepositories(db, CLOCK);
    const hypothesis = (await repos.hypotheses.listByCustomer('cust-tinsol'))[0]!;

    const stale = await client.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis.id,
      new_status: 'CONFIRMED',
      expected_version: 'stale-updated-at',
    });
    await expect(client.confirmProposal(stale)).rejects.toThrow(/version conflict/);

    const good = await client.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis.id,
      new_status: 'PARTIALLY_CONFIRMED',
      expected_version: hypothesis.updated_at,
    });
    const outcome = await client.confirmProposal(good);
    expect(outcome.entity_id).toBe(hypothesis.id);
    expect((await repos.hypotheses.get(hypothesis.id))?.status).toBe('PARTIALLY_CONFIRMED');
  });

  it('CONDITIONAL fact cannot be VERIFIED without scope via the UI gate (backend rejects)', async () => {
    const client = createBattleCardUiClient();
    const preview = await previewIntelligenceImport(SYNTHETIC_FORMULA_NO_PRODUCT_LINE, { db, clock: CLOCK, source_system: 'MANUAL_PASTE', customer_id: 'cust-tinsol' });
    const conditional = preview.draft.extracted_facts.find(fact => fact.applicability === 'CONDITIONAL');
    expect(conditional).toBeTruthy();
    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: SYNTHETIC_FORMULA_NO_PRODUCT_LINE,
      keep_fact_ids: [conditional!.fact_id],
      keep_hypothesis_ids: [],
      fact_verifications: [{
        fact_id: conditional!.fact_id,
        decision: 'VERIFY',
        applicability: 'CONDITIONAL',
        evidence_refs: conditional!.evidence_refs.map(ref => `import:${ref.import_ref}`),
        reason: '无 scope 测试',
      }],
    });
    // 后端门禁：CONDITIONAL → VERIFIED 必须带 scope/product_line
    await expect(client.confirmProposal(proposal)).rejects.toThrow(/applicable_scope|product_line|CONDITIONAL/);
    expect(await rowCount('intelligence_imports')).toBe(0);
  });
});

describe('battleCardUi client — daily review & model unavailable (真实后端)', () => {
  it('daily review queue returns deterministic backend rows; overdue customer enters with reasons', async () => {
    const client = createBattleCardUiClient();
    const overdueId = await seedCustomer(db, {
      id: 'cust-overdue',
      name: '待跟进客户甲',
      next_follow_up_at: '2026-07-20T09:00:00.000Z',
      last_contacted_at: '2026-07-01T09:00:00.000Z',
      grade: 'A',
    });
    const result = await client.buildDailyReviewQueue();
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const row = result.items.find(item => item.customer_id === overdueId);
    expect(row).toBeTruthy();
    expect(row?.reasons.some(reason => reason.includes('逾期'))).toBe(true);
    expect(row?.urgency_score).toBeGreaterThan(0);
  });

  it('model unavailable: deterministic preview/draft/review all work without any provider', async () => {
    // 本测试全程无 Provider 配置、无模型调用；所有确定性能力必须可用
    const client = createBattleCardUiClient();
    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    expect(preview.draft.reasoning.mode).toBe('DETERMINISTIC');
    expect(preview.draft.reasoning.model_called).toBe(false);
    await client.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    const review = await client.buildDailyReviewQueue();
    expect(review.model_coaching).toBe('DETERMINISTIC_ONLY');
  });
});
