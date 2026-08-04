/**
 * Battle Card UI — Production Construction acceptance。
 * 确认正式页面使用的生产装配：
 * - battleCardClient 引用正式 Battle Card Service（createBattleCardAgentTools / createBattleCardRepositories）
 * - Confirm 走正式 Proposal Boundary（approvedCrmWriteBoundary 默认导出，含 battleCard executor proxy）
 * - 正式 Repository（battleCard/repository）
 * - 正式 Session Scope（SalesAgentSession.confirmWriteByRef 的 customerId 绑定）
 * 不是 Mock Provider 或测试专用 Repository。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { createBattleCardUiClient, getBattleCardUiClient } from '../lib/battleCardUi/battleCardClient';
import { createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

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

describe('battle card UI production construction', () => {
  it('client source wires the frozen production services, never test doubles', async () => {
    const clientSource = await import('../lib/battleCardUi/battleCardClient?raw');
    const source = clientSource.default as string;

    expect(source).toMatch(/createBattleCardAgentTools/);
    expect(source).toMatch(/createBattleCardRepositories/);
    expect(source).toMatch(/approvedCrmWriteBoundary/);
    expect(source).toMatch(/SalesAgentSession/);
    expect(source).toMatch(/from '\.\.\/db'/);

    // 不得引用测试专用仓库 / Mock 传输 / Fake
    expect(source).not.toMatch(/mock/i);
    expect(source).not.toMatch(/fake/i);
    expect(source).not.toMatch(/better-sqlite3/);
    expect(source).not.toMatch(/__setDbInstanceForTests\(/);
  });

  it('battle card page module mounts the production client and real components', async () => {
    const pageSource = await import('../pages/CustomerBattleCardPage?raw');
    const source = pageSource.default as string;
    expect(source).toMatch(/getBattleCardUiClient/);
    expect(source).toMatch(/ActionCardView/);
    expect(source).toMatch(/SolutionReferenceCardView/);
    expect(source).toMatch(/AgentSidecar/);
    expect(source).toMatch(/ImportWizard/);
    expect(source).not.toMatch(/__setDbInstanceForTests/);
  });

  it('client instance is a shared singleton; real confirm hits the real boundary against the isolated db', async () => {
    const client = createBattleCardUiClient();
    expect(getBattleCardUiClient()).toBe(getBattleCardUiClient());

    const preview = await client.previewImport(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const proposal = await client.proposeConfirmImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 1).map(hypothesis => hypothesis.hypothesis_id),
    });

    // 通过生产默认边界确认（含 battleCard executor proxy，经 getDb() 取当前隔离库）
    const outcome = await client.confirmProposal(proposal);
    expect(outcome.entity_id).toBeTruthy();

    const imports = await db.select<{ id: string }>('SELECT id FROM intelligence_imports');
    expect(imports).toHaveLength(1);
    const facts = await db.select<{ id: string }>('SELECT id FROM reviewed_facts');
    expect(facts).toHaveLength(1);
    const hypotheses = await db.select<{ id: string }>('SELECT id FROM customer_hypotheses');
    expect(hypotheses).toHaveLength(1);

    // scope 绑定：另一客户会话无法消费该 proposal
    const { SalesAgentSession } = await import('../lib/salesAgentTools/agentSession');
    const { approvedCrmWriteBoundary } = await import('../lib/salesAgentTools/approvedCrmWriteBoundary');
    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    const wrongSession = new SalesAgentSession('cust-other', null, () => '2026-08-01T12:00:00.000Z', undefined);
    await expect(wrongSession.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      nonce: proposal.nonce ?? '',
      confirmed_at: '2026-08-01T12:30:00.000Z',
    }, approvedCrmWriteBoundary)).rejects.toThrow();
  });

  it('no live provider request: confirm path source contains no fetch/provider calls', async () => {
    const boundarySource = await import('../lib/salesAgentTools/approvedCrmWriteBoundary?raw');
    const clientSource = await import('../lib/battleCardUi/battleCardClient?raw');
    const combined = `${boundarySource.default}\n${clientSource.default}`;
    expect(combined).not.toMatch(/\bfetch\(/);
    expect(combined).not.toMatch(/provider|reasoning|model_caller/i);
  });
});
