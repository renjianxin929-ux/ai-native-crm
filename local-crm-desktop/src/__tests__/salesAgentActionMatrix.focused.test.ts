import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SALES_AGENT_TOOL_REGISTRY } from '../lib/salesAgentTools/registry';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';
import { seedCustomer, sessionForWrite, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const NOW = '2026-07-14T12:00:00.000Z';
const intent = (message: string) => createAgentIntentEnvelope(message, NOW);

function sessionFor(customerId: string, name: string) {
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: `snap-${customerId}`,
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [{
      id: customerId,
      name,
      customer_grade: 'A',
      intent_level: 'HIGH',
      evidence_ref: { type: 'customer', id: customerId, label: name, synthetic: false, persisted: true },
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
  const context = buildContextSnapshot({
    snapshotId: `snap-${customerId}`,
    capturedAt: NOW,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
    customers: [{
      customerId,
      name,
      grade: 'A',
      intentLevel: 'HIGH',
      observedAt: NOW,
      evidenceIds: [customerId],
    }],
    accounts: [],
    interactions: [],
  });
  return new SalesAgentSession(customerId, null, () => NOW, {
    snapshot,
    context,
    profile_id: 'foreign_trade_geo',
    planning_mode: 'deterministic',
  });
}

/**
 * Matrix-style routing documentation — each action_id maps to a controller/session path.
 * | class   | action_id                  | route |
 * | READ    | search_customers_portfolio | portfolio_browse |
 * | READ    | search_customers_resolution| awaiting_candidate_selection |
 * | READ    | customer_summary           | scoped reasoning_result |
 * | WRITE   | create_follow_up_record    | clarification → proposal |
 * | CAPTURE | multimodal_capture_review  | host required (blocked without host) |
 * | CONTROL | cancel_pending_write       | zero DB rows |
 * | CONTROL | clear_customer_scope       | unscoped, pending cleared |
 * | CONTROL | format_blocked_error       | Chinese user-facing message |
 */
describe('Sales Agent action matrix', () => {
  describe('READ action_ids', () => {
    it('search_customers_portfolio → portfolio_browse via controller', async () => {
      const fixture = await openSalesAgentSqliteFixture();
      try {
        const controller = new SalesAgentInteractionController({
          db: fixture.db,
          createSession: () => null,
          clock: () => NOW,
        });
        const turn = await controller.submit('帮我找一下广州的客户');
        expect(SALES_AGENT_TOOL_REGISTRY.search_customers.access).toBe('read');
        expect(turn.state.phase).toBe('portfolio_browse');
        expect(turn.state.latest_search?.list_kind).toBe('portfolio');
      } finally {
        fixture.close();
      }
    });

    it('search_customers_resolution → awaiting_candidate_selection', async () => {
      const fixture = await openSalesAgentSqliteFixture();
      try {
        const controller = new SalesAgentInteractionController({
          db: fixture.db,
          createSession: () => null,
          clock: () => NOW,
        });
        const turn = await controller.submit('找一下华南生物');
        expect(turn.state.phase).toBe('awaiting_candidate_selection');
        expect(turn.state.latest_search?.list_kind).toBe('resolution');
      } finally {
        fixture.close();
      }
    });

    it('customer_summary → scoped reasoning_result', async () => {
      const fixture = await openSalesAgentSqliteFixture();
      try {
        const activeSession = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
        const controller = new SalesAgentInteractionController({
          db: fixture.db,
          createSession: () => activeSession,
          clock: () => NOW,
        });
        controller.syncExternalScope('dg-a-jm', '东莞 JM 新能源科技有限公司');
        const turn = await controller.submit('总结客户现状');
        expect(turn.state.phase).toBe('scoped');
        expect(turn.outcome?.kind).toBe('reasoning_result');
      } finally {
        fixture.close();
      }
    });
  });

  describe('WRITE action_ids', () => {
    it('create_follow_up_record → clarification then proposal', async () => {
      const session = sessionForWrite();
      const first = await session.submit(intent('帮我写一条跟进，下周一联系'));
      expect(first.kind).toBe('clarification_required');
      const second = await session.submit(intent('上午10:00'));
      expect(second.kind).toBe('write_proposal');
      if (second.kind !== 'write_proposal') throw new Error('proposal');
      expect(second.proposal.tool_id).toBe('create_follow_up_record');
      expect(second.proposal.requires_confirmation).toBe(true);
    });
  });

  describe('CAPTURE action_ids', () => {
    it('multimodal_capture_review uses deterministic local text extraction without a host', async () => {
      const session = new SalesAgentSession('customer-1', null, () => NOW, {
        snapshot: {
          kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
          version: 'v1',
          snapshot_id: 'capture-fixture',
          synthetic: false,
          persisted: true,
          load_source: 'sqlite_read_only',
          loaded_at: NOW,
          context: { active_profile_id: 'foreign_trade_geo', now: NOW },
          customers: [],
          tasks: [],
          work_items: [],
          collected_leads: [],
          replay_evidence: [],
          import_rows: [],
          capture_events: [],
          prompt_plans: [],
          model_invocations: [],
          eval_summaries: [],
        },
        context: buildContextSnapshot({
          snapshotId: 'capture-fixture',
          capturedAt: NOW,
          timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
          customers: [],
          accounts: [],
          interactions: [],
        }),
        profile_id: 'foreign_trade_geo',
        planning_mode: 'deterministic',
      });
      await expect(session.capture('text', '客户发来报价单')).resolves.toMatchObject({
        provider_kind: 'DETERMINISTIC_LOCAL',
        writes_crm: false,
        facts: [expect.objectContaining({ content: '客户发来报价单', review_status: 'pending' })],
      });
      expect(formatUserFacingErrorMessage(new Error('Trusted-host adapter is blocked.'))).toBe(
        '当前未配置可用的分析服务，请检查设置后再试。',
      );
    });
  });

  describe('CONTROL action_ids', () => {
    it('cancel_pending_write → zero CRM rows via harness', async () => {
      const fixture = sqliteFixture();
      await fixture.initialize();
      seedCustomer(fixture.sqlite);
      const session = sessionForWrite();
      await session.submit(intent('帮我写一条跟进，下周一联系'));
      const proposalTurn = await session.submit(intent('上午10:00'));
      if (proposalTurn.kind !== 'write_proposal') throw new Error('proposal');
      session.cancelPendingWrite(proposalTurn.proposal);
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });
      fixture.close();
    });

    it('clear_customer_scope → unscoped with resolution message', async () => {
      const fixture = await openSalesAgentSqliteFixture();
      try {
        const activeSession = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
        const controller = new SalesAgentInteractionController({
          db: fixture.db,
          createSession: () => activeSession,
          clock: () => NOW,
        });
        controller.syncExternalScope('dg-a-jm', '东莞 JM 新能源科技有限公司');
        controller.clearCustomerScope();
        expect(controller.getState().phase).toBe('unscoped');
        expect(controller.getState().scoped_customer_id).toBeNull();
        expect(controller.getState().agent_message).toMatch(/清除/);
      } finally {
        fixture.close();
      }
    });

    it('format_blocked_error → Chinese via formatUserFacingErrorMessage', () => {
      expect(formatUserFacingErrorMessage('上一条请求仍在处理中，请稍候。')).toBe('上一条请求仍在处理中，请稍候。');
      expect(formatUserFacingErrorMessage(new Error('Confirmation replay rejected.'))).toBe('该操作已经处理过，未再次写入。');
      expect(formatUserFacingErrorMessage(new Error('cancelled'))).toBe('已取消本次模型请求。');
      expect(formatUserFacingErrorMessage({ weird: true })).not.toBe('[object Object]');
    });
  });
});
