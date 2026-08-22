import { beforeEach, describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { confirmationFor, seedCustomer, sessionForWrite, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const intent = (message: string) => createAgentIntentEnvelope(message, '2026-07-14T12:00:00.000Z');

describe('Sales Agent proposal ownership (session registry)', () => {
  beforeEach(() => {
    __resetSessionWriteStateStoreForTests();
  });

  it('survives SalesAgentSession remount: clarify on A, confirm on B', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));

    const sessionA = sessionForWrite();
    await sessionA.submit(intent('帮我写一条跟进，下周一联系'));
    expect(sessionA.getPendingDraft()).not.toBeNull();

    // Simulate React remount: brand-new Session instance, same customer id.
    const sessionB = sessionForWrite();
    expect(sessionB.getPendingDraft()).not.toBeNull();
    const proposalTurn = await sessionB.submit(intent('上午10:00'));
    expect(proposalTurn.kind).toBe('write_proposal');
    if (proposalTurn.kind !== 'write_proposal') throw new Error('proposal');

    const sessionC = sessionForWrite();
    await sessionC.confirmWriteByRef({
      proposal_id: proposalTurn.proposal.proposal_id,
      nonce: proposalTurn.proposal.nonce!,
      confirmed_at: '2026-07-12T00:06:00.000Z',
    }, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });
    expect(String((fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1') as { next_follow_up_at: string }).next_follow_up_at)).toMatch(/T10:00/);
    fixture.close();
  });

  it('clarification sets pendingDraft without registry entry', async () => {
    const session = sessionForWrite();
    const first = await session.submit(intent('帮我写一条跟进，下周一联系'));
    expect(first.kind).toBe('clarification_required');
    expect(session.getPendingDraft()).not.toBeNull();
    expect(session.getRegisteredProposal('nonexistent')).toBeNull();
    const draft = session.getPendingDraft()!;
    expect(draft.missing_fields.length).toBeGreaterThan(0);
    expect(draft.question).toMatch(/几点/);
  });

  it('after clarification completes, proposal is generated once and registered', async () => {
    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const second = await session.submit(intent('上午10:00'));
    expect(second.kind).toBe('write_proposal');
    if (second.kind !== 'write_proposal') throw new Error('expected proposal');
    expect(session.getPendingDraft()).toBeNull();
    const canonical = session.getRegisteredProposal(second.proposal.proposal_id);
    // 新契约（Canonical Snapshot）：返回等价重建副本，绝不共享内部引用
    expect(canonical).not.toBe(second.proposal);
    expect(canonical?.proposal_id).toBe(second.proposal.proposal_id);
    expect(canonical?.proposal_hash).toBe(second.proposal.proposal_hash);
    expect(canonical?.nonce).toBeTruthy();
    expect(canonical?.requires_confirmation).toBe(true);
  });

  it('confirmWriteByRef succeeds after updateRuntime simulates React rerender', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));

    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const proposalTurn = await session.submit(intent('上午10:00'));
    expect(proposalTurn.kind).toBe('write_proposal');
    if (proposalTurn.kind !== 'write_proposal') throw new Error('proposal');

    const refreshedSnapshot: LoadedReadOnlyAgentSnapshot = {
      kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
      version: 'v1',
      snapshot_id: 'write-fixture-rerender',
      synthetic: false,
      persisted: true,
      load_source: 'sqlite_read_only',
      loaded_at: '2026-07-12T00:05:00.000Z',
      context: { active_profile_id: 'foreign_trade_geo', now: '2026-07-12T00:05:00.000Z' },
      customers: [{
        id: 'customer-1',
        name: 'Ada',
        customer_grade: 'A',
        intent_level: 'HIGH',
        evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true },
      }],
      tasks: [],
      work_items: [],
      collected_leads: [],
      replay_evidence: [],
      import_rows: [],
      capture_events: [],
      prompt_plans: [],
      model_invocations: [],
      eval_summaries: [],
    };
    const refreshedContext = buildContextSnapshot({
      snapshotId: 'write-fixture-rerender',
      capturedAt: '2026-07-12T00:05:00.000Z',
      timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-12T00:05:00.000Z' },
      customers: [{
        customerId: 'customer-1',
        name: 'Ada',
        grade: 'A',
        intentLevel: 'HIGH',
        observedAt: '2026-07-12T00:05:00.000Z',
        evidenceIds: ['customer-1'],
      }],
      accounts: [],
      interactions: [],
    });
    session.updateRuntime({
      dependencies: {
        snapshot: refreshedSnapshot,
        context: refreshedContext,
        profile_id: 'foreign_trade_geo',
        planning_mode: 'deterministic',
        loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-13T09:00:00Z' }),
      },
    });

    await session.confirmWriteByRef({
      proposal_id: proposalTurn.proposal.proposal_id,
      nonce: proposalTurn.proposal.nonce!,
      confirmed_at: '2026-07-12T00:06:00.000Z',
    }, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });
    expect(String((fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1') as { next_follow_up_at: string }).next_follow_up_at)).toMatch(/T10:00/);
    fixture.close();
  });

  it('tampered UI proposal rejected by confirmWrite; confirmWriteByRef with id+nonce still works', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));

    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const proposalTurn = await session.submit(intent('上午10:00'));
    expect(proposalTurn.kind).toBe('write_proposal');
    if (proposalTurn.kind !== 'write_proposal') throw new Error('proposal');

    const tampered = {
      ...proposalTurn.proposal,
      proposed_values: { ...proposalTurn.proposal.proposed_values, feedback_notes: '恶意篡改内容' },
    };
    const confirmation = confirmationFor(proposalTurn.proposal);
    await expect(session.confirmWrite(tampered, confirmation, boundary)).rejects.toThrow(/Unknown or modified/i);
    expect(formatUserFacingErrorMessage(new Error('Unknown or modified session-owned write proposal.'))).toBe(
      '这项待确认操作已经失效，请重新生成后再确认。',
    );

    await session.confirmWriteByRef({
      proposal_id: proposalTurn.proposal.proposal_id,
      nonce: proposalTurn.proposal.nonce!,
      confirmed_at: '2026-07-12T00:06:00.000Z',
    }, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });
    expect(String((fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1') as { next_follow_up_at: string }).next_follow_up_at)).toMatch(/T10:00/);
    fixture.close();
  });

  it('cancel invalidates proposal; replay rejected with Chinese-facing message', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));

    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const proposalTurn = await session.submit(intent('上午10:00'));
    expect(proposalTurn.kind).toBe('write_proposal');
    if (proposalTurn.kind !== 'write_proposal') throw new Error('proposal');

    session.cancelPendingWrite(proposalTurn.proposal);
    expect(session.getRegisteredProposal(proposalTurn.proposal.proposal_id)).toBeNull();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });

    const confirmation = confirmationFor(proposalTurn.proposal);
    await expect(session.confirmWrite(proposalTurn.proposal, confirmation, boundary)).rejects.toThrow(/Unknown or modified/i);
    expect(formatUserFacingErrorMessage(new Error('Unknown or modified session-owned write proposal.'))).toBe(
      '这项待确认操作已经失效，请重新生成后再确认。',
    );

    const session2 = sessionForWrite();
    await session2.submit(intent('帮我写一条跟进，下周一联系'));
    const again = await session2.submit(intent('上午10:00'));
    if (again.kind !== 'write_proposal') throw new Error('proposal');
    await session2.confirmWriteByRef({
      proposal_id: again.proposal.proposal_id,
      nonce: again.proposal.nonce!,
      confirmed_at: '2026-07-12T00:06:00.000Z',
    }, boundary);
    await expect(session2.confirmWriteByRef({
      proposal_id: again.proposal.proposal_id,
      nonce: again.proposal.nonce!,
      confirmed_at: '2026-07-12T00:07:00.000Z',
    }, boundary)).rejects.toThrow(/replay|Unknown/i);
    expect(formatUserFacingErrorMessage(new Error('Confirmation replay rejected.'))).toBe('该操作已经处理过，未再次写入。');
    fixture.close();
  });

  it('invalidateAllPendingWrites clears registry and pending draft', async () => {
    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    expect(session.getPendingDraft()).not.toBeNull();
    session.invalidateAllPendingWrites('scope_or_conversation_reset');
    expect(session.getPendingDraft()).toBeNull();

    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const proposalTurn = await session.submit(intent('上午10:00'));
    expect(proposalTurn.kind).toBe('write_proposal');
    if (proposalTurn.kind !== 'write_proposal') throw new Error('proposal');
    expect(session.getRegisteredProposal(proposalTurn.proposal.proposal_id)).toBeTruthy();

    session.invalidateAllPendingWrites('new_conversation');
    expect(session.getRegisteredProposal(proposalTurn.proposal.proposal_id)).toBeNull();
    expect(session.getPendingDraft()).toBeNull();
  });
});
