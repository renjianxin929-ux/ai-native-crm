/**
 * Battle Card Atomic Transactions — 生产构造 acceptance。
 * 正式 UI/Controller → Proposal → confirmWriteByRef → approvedCrmWriteBoundary →
 * BattleCardWriteExecutor → 单次 Tauri atomic invoke。
 * 证明：一次 Confirm 只产生一次事务 invoke；Cancel 零 invoke；Replay 零第二次；
 * Scope mismatch 零 invoke；expected_version 冲突零写入；Confirm 后不调用模型。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetSessionWriteStateStoreForTests, cancelCanonicalProposal } from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { createBattleCardAgentTools } from '../lib/battleCard/agentTools';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';

let db: ReturnType<typeof createSqliteDb>;
let invokeCalls: { command: string; payload: unknown }[];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: { payload?: unknown }) => {
    invokeCalls.push({ command, payload: args.payload });
    if (command === 'confirm_battle_card_import_atomic_v1') {
      const payload = args.payload as { factDecisions: unknown[]; hypothesisCandidateIds: unknown[] };
      return { importId: 'import-mock-1', factsWritten: payload.factDecisions.length, hypothesesWritten: payload.hypothesisCandidateIds.length, duplicatesSkipped: 0, deduped: false };
    }
    if (command === 'confirm_battle_card_stage_card_atomic_v1') {
      const payload = args.payload as { cardId: string; confirmedAt: string };
      return { cardId: payload.cardId, cardStatus: 'CONFIRMED', confirmedAt: payload.confirmedAt, currentStageCardId: payload.cardId };
    }
    throw new Error(`unexpected command ${command}`);
  }),
}));

function payloadKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => Object.keys(item as object).sort()) : Object.keys(value as object).sort();
}

beforeEach(async () => {
  invokeCalls = [];
  __resetSessionWriteStateStoreForTests();
  db = createSqliteDb();
  await initializeDatabaseSchema(db);
  await seedCustomer(db);
  __setDbInstanceForTests(db);
  // 生产环境判定：模拟 Tauri WebView
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setDbInstanceForTests(null);
  db.close();
});

async function confirmViaSession(customerId: string, proposal: AgentWriteProposal) {
  const session = new SalesAgentSession(customerId, null, () => '2026-08-02T12:00:00.000Z', undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce ?? '',
    confirmed_at: '2026-08-02T12:30:00.000Z',
  }, approvedCrmWriteBoundary);
}

async function importProposal(tools: ReturnType<typeof createBattleCardAgentTools>, keepFacts = 1) {
  const preview = await tools.preview(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
  return tools.proposeConfirmIntelligenceImport({
    customer_id: 'cust-tinsol',
    raw_content: GOLDEN_SAMPLE_TINSOL,
    keep_fact_ids: preview.draft.extracted_facts.slice(0, keepFacts).map(fact => fact.fact_id),
    keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 2).map(hypothesis => hypothesis.hypothesis_id),
  });
}

describe('production construction: confirm import is a single atomic invoke', () => {
  it('confirm produces exactly one transactional invoke with a closed payload', async () => {
    const tools = createBattleCardAgentTools({ db, clock: () => '2026-08-02T12:00:00.000Z' });
    const proposal = await importProposal(tools);

    expect(invokeCalls).toHaveLength(0); // Proposal 阶段零 invoke
    const outcome = await confirmViaSession('cust-tinsol', proposal);
    expect(outcome.entity_id).toBeTruthy();

    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]?.command).toBe('confirm_battle_card_import_atomic_v1');
    const payload = invokeCalls[0]?.payload as Record<string, unknown>;
    expect(payloadKeys(payload)).toEqual([
      'customerId', 'factDecisions', 'hypothesisCandidateIds', 'importRow', 'supersedeFactIds',
    ].sort());
    const importRow = payload.importRow as Record<string, unknown>;
    expect(payloadKeys(importRow)).toEqual([
      'contentHash', 'parserVersion', 'rawContent', 'sourceLabel', 'sourceSystem',
    ].sort());
    const fact = (payload.factDecisions as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(payloadKeys(fact)).toEqual(['candidateId', 'decision'].sort());
    expect(fact.decision).toBe('KEEP');
    expect((fact.candidateId as string).length).toBe(64);
    // 危险字段禁止：无 Renderer 正文/状态/预序列化 Evidence / SQL / 路径 / failpoint
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/verificationStatus|evidenceRefsJson|verification_status|evidence_refs_json/i);
    expect(serialized).not.toMatch(/"statement"|"factCategory"|"confidence"|"applicability"/);
    expect(serialized).not.toMatch(/failpoint|tableName|rawSql|dbPath|databasePath/i);
    expect(Array.isArray(payload.hypothesisCandidateIds)).toBe(true);
  });

  it('cancel produces zero invokes and zero writes', async () => {
    const tools = createBattleCardAgentTools({ db, clock: () => '2026-08-02T12:00:00.000Z' });
    const proposal = await importProposal(tools);
    cancelCanonicalProposal(proposal);
    await expect(confirmViaSession('cust-tinsol', proposal)).rejects.toThrow();
    expect(invokeCalls).toHaveLength(0);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('replay of the same confirmation produces zero second invoke', async () => {
    const tools = createBattleCardAgentTools({ db, clock: () => '2026-08-02T12:00:00.000Z' });
    const proposal = await importProposal(tools);
    await confirmViaSession('cust-tinsol', proposal);
    await expect(confirmViaSession('cust-tinsol', proposal)).rejects.toThrow(/replay|consumed/i);
    expect(invokeCalls).toHaveLength(1); // 第二次确认在门禁层被拒，不产生第二次 invoke
  });

  it('scope mismatch produces zero invokes', async () => {
    const tools = createBattleCardAgentTools({ db, clock: () => '2026-08-02T12:00:00.000Z' });
    const proposal = await importProposal(tools);
    await seedCustomer(db, { id: 'cust-other', name: '另一客户' });
    await expect(confirmViaSession('cust-other', proposal)).rejects.toThrow();
    expect(invokeCalls).toHaveLength(0);
    expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
  });

  it('confirm never triggers any model/provider call', async () => {
    const tools = createBattleCardAgentTools({ db, clock: () => '2026-08-02T12:00:00.000Z' });
    const proposal = await importProposal(tools);
    await confirmViaSession('cust-tinsol', proposal);
    const boundarySource = await import('../lib/salesAgentTools/approvedCrmWriteBoundary?raw');
    const agentToolsSource = await import('../lib/battleCard/agentTools?raw');
    const combined = `${boundarySource.default}\n${agentToolsSource.default}`;
    expect(combined).not.toMatch(/\bfetch\(/);
    expect(combined).not.toMatch(/provider|reasoning|model_caller/i);
  });
});

describe('production construction: confirm stage card is a single atomic invoke', () => {
  it('draft → confirm produces exactly one invoke; version conflict zero invokes', async () => {
    const tools = createBattleCardAgentTools({ db, clock: () => '2026-08-02T12:00:00.000Z' });
    const preview = await tools.preview(GOLDEN_SAMPLE_TINSOL, { customer_id: 'cust-tinsol' });
    const importWriteProposal = await tools.proposeConfirmIntelligenceImport({
      customer_id: 'cust-tinsol',
      raw_content: GOLDEN_SAMPLE_TINSOL,
      keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
      keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 1).map(hypothesis => hypothesis.hypothesis_id),
    });
    await confirmViaSession('cust-tinsol', importWriteProposal);

    const draft = await tools.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    expect(draft.card_status).toBe('DRAFT');

    // expected_version 冲突：TS 层先校验（executor 读 card 校验 version），零 invoke
    const stale = await tools.proposeConfirmStageCard({
      customer_id: 'cust-tinsol',
      card_id: draft.id,
      expected_version: 999,
    });
    await expect(confirmViaSession('cust-tinsol', stale)).rejects.toThrow(/version conflict/);
    expect(invokeCalls).toHaveLength(1); // 只有 import 的那一次；card 冲突零 invoke

    // 正确版本 → 单次 invoke
    const good = await tools.proposeConfirmStageCard({
      customer_id: 'cust-tinsol',
      card_id: draft.id,
      expected_version: draft.version,
    });
    await confirmViaSession('cust-tinsol', good);
    expect(invokeCalls).toHaveLength(2);
    expect(invokeCalls[1]?.command).toBe('confirm_battle_card_stage_card_atomic_v1');
    const payload = invokeCalls[1]?.payload as Record<string, unknown>;
    expect(payloadKeys(payload)).toEqual(['cardId', 'confirmedAt', 'confirmedBy', 'customerId', 'expectedVersion'].sort());
    expect(JSON.stringify(payload)).not.toMatch(/sql|path|failpoint/i);
  });
});
