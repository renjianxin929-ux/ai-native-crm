import { afterEach, describe, expect, it } from 'vitest';
import { confirmSalesAgentProposal } from '../components/aiNative/SalesAgentInteractionWorkspace';
import { __setDbInstanceForTests, createCrmRepository } from '../lib/db';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import {
  cancelCanonicalProposal,
  getCanonicalProposal,
  __resetSessionWriteStateStoreForTests,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { sqliteFixture } from './salesAgentProductionHarness';
import { projectConfirmationCard } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';

const NOW = '2026-08-17T21:00:00+08:00';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

afterEach(() => {
  __setDbInstanceForTests(null);
  __resetSessionWriteStateStoreForTests();
});

describe('V0.2 foreground — customer.create confirmation lifecycle', () => {
  it('unscoped create → proposal → human-scale delay → confirm writes exactly once; replay and expired still rejected', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => SALES_AGENT_APP_CLOCK.now()));
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => null,
      clock: () => NOW,
    });

    const turn = await controller.submit('新建一个客户，广州星河科技E2E，联系人张总');
    expect(turn.state.phase).toBe('proposal');
    const proposal = turn.state.latest_proposal;
    expect(proposal?.tool_id).toBe('create_customer');
    expect(proposal?.proposed_values.name).toBe('广州星河科技E2E');
    expect(proposal?.proposed_values.contact_person).toBe('张总');
    expect(getCanonicalProposal(proposal!.proposal_id)).not.toBeNull();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 0 });

    await new Promise(resolve => setTimeout(resolve, 40));

    const confirmSession = new SalesAgentSession(proposal!.customer_id, null, () => SALES_AGENT_APP_CLOCK.now());
    await confirmSalesAgentProposal(confirmSession, proposal!, async () => undefined, boundary);
    const rows = fixture.sqlite.prepare('SELECT id, name, contact_person FROM customers').all() as {
      id: string; name: string; contact_person: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('广州星河科技E2E');
    expect(rows[0]?.contact_person).toBe('张总');
    expect(rows[0]?.id).toBe(proposal!.customer_id);

    await expect(confirmSalesAgentProposal(confirmSession, proposal!, async () => undefined, boundary))
      .rejects.toThrow(/replay|Unknown/i);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 1 });

    const expiredTurn = await controller.submit('新建一个客户，过期提案客户，联系人李总');
    const expiredProposal = expiredTurn.state.latest_proposal;
    expect(expiredProposal?.tool_id).toBe('create_customer');
    cancelCanonicalProposal(expiredProposal);
    const expiredSession = new SalesAgentSession(expiredProposal!.customer_id, null, () => SALES_AGENT_APP_CLOCK.now());
    await expect(confirmSalesAgentProposal(expiredSession, expiredProposal!, async () => undefined, boundary))
      .rejects.toThrow(/Unknown or modified|replay|timestamp/i);
    expect(formatUserFacingErrorMessage(new Error('Unknown or modified session-owned write proposal.')))
      .toBe('这项待确认操作已经失效，请重新生成后再确认。');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 1 });

    const timed = await controller.submit('新建一个客户，时间戳过期客户，联系人王总');
    const timedProposal = timed.state.latest_proposal!;
    const timedSession = new SalesAgentSession(timedProposal.customer_id, null, () => SALES_AGENT_APP_CLOCK.now());
    await expect(timedSession.confirmWriteByRef({
      proposal_id: timedProposal.proposal_id,
      nonce: timedProposal.nonce!,
      confirmed_at: '2020-01-01T00:00:00.000Z',
    }, boundary)).rejects.toThrow(/timestamp|invalid/i);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 1 });
    fixture.close();
  });

  it('create_customer can be confirmed from a session bound to a different customer without a snapshot', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    fixture.sqlite.prepare("INSERT INTO customers (id,name,customer_grade,stage,intent_level,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run('customer-1', 'Ada', 'A', 'NEW_LEAD', 'HIGH', NOW, NOW);
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => SALES_AGENT_APP_CLOCK.now()));
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => null,
      clock: () => NOW,
    });
    controller.syncExternalScope('customer-1', 'Ada');
    const turn = await controller.submit('新建一个客户，广州星河科技E2E，联系人张总');
    const proposal = turn.state.latest_proposal!;
    expect(proposal.customer_id).not.toBe('customer-1');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 1 });

    const scopedSession = new SalesAgentSession('customer-1', null, () => SALES_AGENT_APP_CLOCK.now());
    await confirmSalesAgentProposal(scopedSession, proposal, async () => undefined, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 2 });
    fixture.close();
  });
});

describe('V0.2 foreground — confirmation projection', () => {
  it('customer.create shows name/contact and hides UUID, capability, empty dumps', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => null,
      clock: () => NOW,
    });
    const turn = await controller.submit('新建一个客户，广州星河科技E2E，联系人张总');
    const proposal = turn.state.latest_proposal!;
    expect(proposal.proposed_values.address).toBeNull();
    expect(proposal.proposed_values.is_key_decision_maker).toBe(0);
    const visible = projectConfirmationCard(proposal);
    const text = [visible.title, visible.headline, ...visible.summary_lines, visible.footnote, visible.confirm_label, visible.cancel_label]
      .filter(Boolean)
      .join('\n');
    expect(visible.title).toBe('新建客户');
    expect(visible.headline).toBe('广州星河科技E2E');
    expect(visible.summary_lines).toContain('联系人：张总');
    expect(visible.footnote).toBe('其他资料暂未填写，可稍后补充。');
    expect(visible.confirm_label).toBe('确认创建');
    expect(visible.strength).toBe('normal');
    expect(text).not.toMatch(UUID_RE);
    expect(text).not.toContain('create_customer');
    expect(text).not.toContain('capability_id');
    expect(text).not.toContain('address');
    expect(text).not.toContain('is_key_decision_maker');
    expect(text).not.toContain('qualification_reason');
    expect(text).not.toContain('intent_level');
    expect(text).not.toContain('nonce');
    expect(text).not.toContain('（空）');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 0 });
    fixture.close();
  });

  it('normal profile update stays restrained; customer.delete stays STRONG', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    fixture.sqlite.prepare("INSERT INTO customers (id,name,customer_grade,stage,intent_level,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run('customer-1', 'Ada', 'A', 'NEW_LEAD', 'HIGH', NOW, NOW);
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => null,
      clock: () => NOW,
      capability_planner: async () => ({
        kind: 'invoke',
        selection: { capability_id: 'customer.profile.update', arguments: { industry: '跨境电商' } },
      }),
    });
    controller.syncExternalScope('customer-1', 'Ada');
    const update = await controller.submit('把这个客户行业改成跨境电商');
    const updateProjection = projectConfirmationCard(update.state.latest_proposal!);
    expect(updateProjection.strength).toBe('normal');
    expect(updateProjection.summary_lines.join('\n')).toContain('行业：跨境电商');
    expect(updateProjection.summary_lines.join('\n')).not.toMatch(UUID_RE);
    expect(updateProjection.summary_lines.join('\n')).not.toContain('update_customer_profile');

    const deleteController = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => null,
      clock: () => NOW,
    });
    deleteController.syncExternalScope('customer-1', 'Ada');
    const deletion = await deleteController.submit('删除这个客户');
    const deleteProjection = projectConfirmationCard(deletion.state.latest_proposal!);
    expect(deleteProjection.strength).toBe('strong');
    expect(deleteProjection.title).toMatch(/永久删除/);
    expect(deleteProjection.destructive_note).toMatch(/不可恢复/);
    expect(deleteProjection.confirm_label).toBe('确认永久删除');
    fixture.close();
  });
});
