/**
 * Agent B — Sales Agent 写入契约 focused tests（测试矩阵 E）。
 * 走真实 SalesAgentSession.confirmWriteByRef + approvedCrmWriteBoundary（含 Battle Card executor）。
 * Proposal 前零写入 / Cancel 零写入 / Confirm 精确一次 / Replay 零二次写入 / Scope 失效 / expected_version / idempotency。
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { __resetSessionWriteStateStoreForTests, invalidateCustomerWriteState } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { createBattleCardAgentTools, createBattleCardWriteExecutor } from '../lib/battleCard/agentTools';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { previewIntelligenceImport } from '../lib/battleCard/importService';
import { CLOCK, createSchema, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

let db: ReturnType<typeof createSqliteDb>;

beforeEach(() => {
  __resetSessionWriteStateStoreForTests();
});

async function setup(): Promise<{ db: ReturnType<typeof createSqliteDb>; tools: ReturnType<typeof createBattleCardAgentTools>; boundary: ReturnType<typeof createApprovedCrmWriteBoundary> }> {
  db = createSqliteDb();
  await createSchema(db);
  await seedCustomer(db);
  const tools = createBattleCardAgentTools({ db, clock: CLOCK });
  const boundary = createApprovedCrmWriteBoundary({
    createFollowUp: async () => undefined,
    createTask: async () => undefined,
    updateCustomer: async () => undefined,
    battleCard: createBattleCardWriteExecutor({ db, clock: CLOCK }),
  }, { now: CLOCK });
  return { db, tools, boundary };
}

async function confirmViaSession(customerId: string, proposal: AgentWriteProposal, boundary: ReturnType<typeof createApprovedCrmWriteBoundary>) {
  const session = new SalesAgentSession(customerId, null, CLOCK, undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce!,
    confirmed_at: '2026-08-01T12:30:00.000Z',
  }, boundary);
}

describe('battle card write tools honor Proposal/Confirm/Replay', () => {
  it('proposal precedes any write: zero rows before confirm', async () => {
    const { db, tools, boundary } = await setup();
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const proposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
    });

    // Proposal 契约字段
    expect(proposal.status).toBe('awaiting_confirmation');
    expect(proposal.executable).toBe(false);
    expect(proposal.requires_confirmation).toBe(true);
    expect(proposal.customer_id).toBe('cust-tinsol');
    expect(proposal.current_values).toBeDefined();
    expect(proposal.proposed_values.idempotency_key).toContain('confirm-import');
    expect(proposal.evidence_refs).toContain('customer:cust-tinsol');

    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);

    void boundary;
  });

  it('confirm executes exactly once with effect output', async () => {
    const { db, tools, boundary } = await setup();
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const proposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
    });

    const outcome = await confirmViaSession('cust-tinsol', proposal, boundary);
    expect(outcome.entity_id).toBeTruthy();

    const imports = await db.select('SELECT id FROM intelligence_imports');
    const facts = await db.select('SELECT id FROM reviewed_facts');
    expect(imports).toHaveLength(1);
    expect(facts).toHaveLength(1);
  });

  it('replay of the same confirmation writes nothing a second time', async () => {
    const { db, tools, boundary } = await setup();
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const proposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
    });

    await confirmViaSession('cust-tinsol', proposal, boundary);
    await expect(confirmViaSession('cust-tinsol', proposal, boundary)).rejects.toThrow(/replay|Replay|consumed/i);

    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(1);
  });

  it('scope switch invalidates pending proposals', async () => {
    const { db, tools, boundary } = await setup();
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const proposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
    });

    // 切走客户（现有控制器在 scope 切换时调用 invalidateCustomerWriteState）
    invalidateCustomerWriteState('cust-tinsol');

    await expect(confirmViaSession('cust-tinsol', proposal, boundary)).rejects.toThrow(/replay|unknown|modified/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('cancelled proposal cannot be confirmed (zero writes)', async () => {
    const { db, tools, boundary } = await setup();
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const proposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
    });

    const { cancelCanonicalProposal } = await import('../lib/salesAgentTools/sessionWriteStateStore');
    cancelCanonicalProposal(proposal);

    await expect(confirmViaSession('cust-tinsol', proposal, boundary)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });
});

describe('hypothesis status updates through the boundary', () => {
  it('writes status with audit and blocks stale expected_version', async () => {
    const { db, tools, boundary } = await setup();
    const repos = createBattleCardRepositories(db, CLOCK);
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const importProposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: [],
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 1).map(hypothesis => hypothesis.hypothesis_id),
    });
    await confirmViaSession('cust-tinsol', importProposal, boundary);

    const hypothesis = (await repos.hypotheses.listByCustomer('cust-tinsol'))[0];

    // 版本冲突阻断
    const staleProposal = await tools.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis!.id,
      new_status: 'CONFIRMED',
      expected_version: 'stale-updated-at',
    });
    await expect(confirmViaSession('cust-tinsol', staleProposal, boundary)).rejects.toThrow(/version conflict/);

    // 正确版本通过
    const goodProposal = await tools.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis!.id,
      new_status: 'PARTIALLY_CONFIRMED',
      reason: '首轮挖需已部分验证',
      expected_version: hypothesis!.updated_at,
    });
    const outcome = await confirmViaSession('cust-tinsol', goodProposal, boundary);
    expect(outcome.entity_id).toBe(hypothesis!.id);

    const updated = await repos.hypotheses.get(hypothesis!.id);
    expect(updated?.status).toBe('PARTIALLY_CONFIRMED');
    const audit = JSON.parse(updated?.status_audit_json ?? '[]') as unknown[];
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe('stage card confirmation through the boundary', () => {
  it('confirms exactly once with expected_version guard', async () => {
    const { db, tools, boundary } = await setup();
    const repos = createBattleCardRepositories(db, CLOCK);
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const importProposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: [],
    });
    await confirmViaSession('cust-tinsol', importProposal, boundary);

    const card = await tools.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');

    // 版本冲突阻断
    const wrongVersionProposal = await tools.proposeConfirmStageCard({
      customer_id: 'cust-tinsol',
      card_id: card.id,
      expected_version: card.version + 99,
    });
    await expect(confirmViaSession('cust-tinsol', wrongVersionProposal, boundary)).rejects.toThrow(/version conflict/);

    const goodProposal = await tools.proposeConfirmStageCard({
      customer_id: 'cust-tinsol',
      card_id: card.id,
      expected_version: card.version,
    });
    const outcome = await confirmViaSession('cust-tinsol', goodProposal, boundary);
    expect(outcome.entity_id).toBe(card.id);

    const confirmed = await repos.cards.get(card.id);
    expect(confirmed?.card_status).toBe('CONFIRMED');

    // 二次确认：同一卡不能再次确认（不再是 DRAFT）
    const againProposal = await tools.proposeConfirmStageCard({
      customer_id: 'cust-tinsol',
      card_id: card.id,
      expected_version: card.version,
    });
    await expect(confirmViaSession('cust-tinsol', againProposal, boundary)).rejects.toThrow();
  });
});

describe('idempotency across repeated confirmations', () => {
  it('domain-level dedup keeps the second import confirm at zero writes', async () => {
    const { db, tools, boundary } = await setup();
    const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    const keepFactIds = preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id);

    const first = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: keepFactIds,
      keep_hypothesis_ids: [],
    });
    const firstOutcome = await confirmViaSession('cust-tinsol', first, boundary);

    // 新会话、新 proposal（新 nonce），但同内容 → 领域幂等
    const second = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: keepFactIds,
      keep_hypothesis_ids: [],
    });
    const secondOutcome = await confirmViaSession('cust-tinsol', second, boundary);

    expect(firstOutcome.entity_id).toBe(secondOutcome.entity_id);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(1);
  });
});
