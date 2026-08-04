/**
 * P0-B — 生产构造 acceptance：正式默认 composition root 已接线 Battle Card 写能力。
 * 使用与 UI 相同的默认导出 approvedCrmWriteBoundary + 真实 SalesAgentSession.confirmWriteByRef；
 * 不手工注入 BattleCardWriteExecutor（executor 只来自默认 composition root）。
 * DB 通过 db.ts 测试后门指向隔离内存库（生产路径永不调用该后门）。
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { __resetSessionWriteStateStoreForTests, cancelCanonicalProposal, invalidateCustomerWriteState } from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { createBattleCardAgentTools } from '../lib/battleCard/agentTools';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { previewIntelligenceImport } from '../lib/battleCard/importService';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { CLOCK, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

let db: ReturnType<typeof createSqliteDb>;

beforeEach(async () => {
  __resetSessionWriteStateStoreForTests();
  db = createSqliteDb();
  await initializeDatabaseSchema(db);
  await seedCustomer(db);
  // 默认 composition root 的惰性 executor 通过 getDb() 拿到这个隔离 DB
  __setDbInstanceForTests(db);
});

afterEach(() => {
  __setDbInstanceForTests(null);
  db.close();
});

async function confirmViaSession(customerId: string, proposal: AgentWriteProposal) {
  const session = new SalesAgentSession(customerId, null, CLOCK, undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce!,
    confirmed_at: '2026-08-01T12:30:00.000Z',
  }, approvedCrmWriteBoundary);
}

async function importProposal(tools: ReturnType<typeof createBattleCardAgentTools>, keepFacts = 1) {
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
  return tools.proposeConfirmIntelligenceImport({
    customer_id: 'cust-tinsol',
    raw_content: GOLDEN_SAMPLE_TINSOL,
    keep_fact_ids: preview.draft.extracted_facts.slice(0, keepFacts).map(fact => fact.fact_id),
    keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 2).map(hypothesis => hypothesis.hypothesis_id),
  });
}

describe('production composition root (default approvedCrmWriteBoundary)', () => {
  it('proposal precedes any write: zero rows before confirm', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);

    expect(proposal.status).toBe('awaiting_confirmation');
    expect(proposal.executable).toBe(false);
    expect(proposal.proposed_values.idempotency_key).toBeTruthy();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('cancel produces zero writes and blocks later confirm', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);

    cancelCanonicalProposal(proposal);
    await expect(confirmViaSession('cust-tinsol', proposal)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
  });

  it('confirm executes exactly once with import/facts/hypotheses', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);

    const outcome = await confirmViaSession('cust-tinsol', proposal);
    expect(outcome.entity_id).toBeTruthy();

    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(1);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(2);
  });

  it('replay of the same confirmation writes nothing a second time', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);

    await confirmViaSession('cust-tinsol', proposal);
    await expect(confirmViaSession('cust-tinsol', proposal)).rejects.toThrow(/replay|consumed/i);

    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(1);
  });

  it('scope mismatch rejects the confirmation', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);

    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    await expect(confirmViaSession('cust-other', proposal)).rejects.toThrow(/match|Unknown|modified/i);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);

    // scope 切换使旧 proposal 失效
    invalidateCustomerWriteState('cust-tinsol');
    await expect(confirmViaSession('cust-tinsol', proposal)).rejects.toThrow();
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('expected_version conflict blocks hypothesis status writes', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const repos = createBattleCardRepositories(db, CLOCK);
    const importWriteProposal = await importProposal(tools);
    await confirmViaSession('cust-tinsol', importWriteProposal);

    const hypothesis = (await repos.hypotheses.listByCustomer('cust-tinsol'))[0]!;
    const stale = await tools.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis.id,
      new_status: 'CONFIRMED',
      expected_version: 'stale-updated-at',
    });
    await expect(confirmViaSession('cust-tinsol', stale)).rejects.toThrow(/version conflict/);

    const good = await tools.proposeUpdateHypothesisStatus({
      customer_id: 'cust-tinsol',
      hypothesis_id: hypothesis.id,
      new_status: 'PARTIALLY_CONFIRMED',
      expected_version: hypothesis.updated_at,
    });
    await confirmViaSession('cust-tinsol', good);
    expect((await repos.hypotheses.get(hypothesis.id))?.status).toBe('PARTIALLY_CONFIRMED');
  });

  it('transaction failure rolls back the whole confirm (zero residue)', async () => {
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);

    // 在 hypothesis 写入时注入失败（仅测试环境通过 db 后门控制 SQL 行为，不注入 executor）
    const failingHypothesisInsert = async (sql: string, bindings: unknown[] = []) => {
      if (/INSERT INTO customer_hypotheses/i.test(sql)) {
        throw new Error('mid-transaction failure');
      }
      return db.execute(sql, bindings);
    };
    const failingDb: DatabaseLike = {
      execute: failingHypothesisInsert,
      select: (sql, bindings) => db.select(sql, bindings),
    };
    __setDbInstanceForTests(failingDb);

    await expect(confirmViaSession('cust-tinsol', proposal)).rejects.toThrow('mid-transaction failure');

    // 回滚：导入行/事实/假设全部为零
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
    expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
    expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
  });

  it('confirm never triggers any model/provider call', async () => {
    // 源码级：默认 composition root 与 executor 不含模型调用路径
    const boundarySource = await import('../lib/salesAgentTools/approvedCrmWriteBoundary?raw');
    const executorSource = await import('../lib/battleCard/agentTools?raw');
    const combined = `${boundarySource.default}\n${executorSource.default}`;
    expect(combined).not.toMatch(/\bfetch\(/);
    expect(combined).not.toMatch(/provider|reasoning|model_caller/i);

    // 行为级：确认后只有预期业务写入，无任何附加副作用
    const tools = createBattleCardAgentTools({ db, clock: CLOCK });
    const proposal = await importProposal(tools);
    const outcome = await confirmViaSession('cust-tinsol', proposal);
    expect(outcome.entity_id).toBeTruthy();
    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    for (const table of tables) {
      const count = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table.name}`);
      const n = Number(count[0]?.count ?? 0);
      if (['intelligence_imports', 'reviewed_facts', 'customer_hypotheses'].includes(table.name)) {
        expect(n).toBeGreaterThan(0);
      } else if (['customers'].includes(table.name)) {
        expect(n).toBe(1);
      } else {
        expect(n).toBe(0); // 其余表零写入
      }
    }
  });
});
