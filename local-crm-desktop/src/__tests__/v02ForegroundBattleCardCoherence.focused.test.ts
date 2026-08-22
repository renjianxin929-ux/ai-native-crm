import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { confirmSalesAgentProposal } from '../lib/salesAgentTools/confirmSalesAgentProposal';
import { createStageCardEngine } from '../lib/battleCard/stageCardEngine';
import { evaluateBattleCardCoherence } from '../lib/battleCardUi/battleCardViewModels';
import { __setDbInstanceForTests, createCrmRepository, getCustomer, listVisits } from '../lib/db';
import { planCapability } from '../lib/planner/runtimePlanner';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-08-17T21:00:00+08:00';

afterEach(() => {
  __setDbInstanceForTests(null);
  __resetSessionWriteStateStoreForTests();
});

describe('evaluateBattleCardCoherence', () => {
  it('marks a first-contact card stale after a visit even if CustomerStage is unchanged', () => {
    expect(evaluateBattleCardCoherence({
      customerStage: 'NEW_LEAD',
      cardStageCode: 'NEW_LEAD',
      hasVisit: false,
    }).kind).toBe('current');
    const stale = evaluateBattleCardCoherence({
      customerStage: 'NEW_LEAD',
      cardStageCode: 'NEW_LEAD',
      hasVisit: true,
    });
    expect(stale.kind).toBe('stale');
    if (stale.kind === 'stale') {
      expect(stale.reason).toBe('visit_past_card_stage');
      expect(stale.user_message).toMatch(/面访|首次触达|重新生成/);
    }
  });

  it('marks a card stale when CustomerStage has moved past the snapshot', () => {
    const stale = evaluateBattleCardCoherence({
      customerStage: 'VISITED',
      cardStageCode: 'NEW_LEAD',
      hasVisit: true,
    });
    expect(stale.kind).toBe('stale');
    if (stale.kind === 'stale') expect(stale.reason).toBe('stage_mismatch');
  });
});

describe('V0.2 foreground — visit / Battle Card coherence', () => {
  it('visit.create through the production path leaves historical card intact and marks first-contact card stale', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    __setDbInstanceForTests(fixture.db);

    const engine = createStageCardEngine({ db: fixture.db, clock: () => NOW });
    const draft = await engine.generateStageCardDraft('customer-1', 'NEW_LEAD');
    await engine.confirmStageCard(draft.id, 'HUMAN');
    const beforeCard = await engine.getCurrentStageCard('customer-1');
    expect(beforeCard?.stage_code).toBe('NEW_LEAD');
    expect(beforeCard?.version).toBe(1);
    const beforePayload = beforeCard?.payload_json;

    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => SALES_AGENT_APP_CLOCK.now()));
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => null,
      clock: () => NOW,
      capability_planner: (utterance, scopedCustomerId) => planCapability(utterance, NOW, scopedCustomerId, {
        db: fixture.db,
        modelSelect: async () => ({
          kind: 'invoke',
          capability_id: 'visit.create',
          arguments: { title: '参观工厂' },
        }),
      }),
    });
    controller.syncExternalScope('customer-1', 'Ada');
    const turn = await controller.submit('记录今天拜访：参观工厂');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_visit_record');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get()).toEqual({ c: 0 });

    const proposal = turn.state.latest_proposal!;
    const session = new SalesAgentSession(proposal.customer_id, null, () => SALES_AGENT_APP_CLOCK.now());
    await confirmSalesAgentProposal(session, proposal, async () => undefined, boundary);

    const visits = await listVisits('customer-1');
    expect(visits).toHaveLength(1);
    const customer = await getCustomer('customer-1');
    expect(customer?.stage).toBe('NEW_LEAD');
    const currentCard = await engine.getCurrentStageCard('customer-1');
    expect(currentCard?.id).toBe(beforeCard?.id);
    expect(currentCard?.payload_json).toBe(beforePayload);
    expect(currentCard?.stage_code).toBe('NEW_LEAD');

    const coherence = evaluateBattleCardCoherence({
      customerStage: customer!.stage,
      cardStageCode: currentCard?.stage_code ?? null,
      hasVisit: visits.length > 0,
    });
    expect(coherence.kind).toBe('stale');
    if (coherence.kind === 'stale') {
      expect(coherence.user_message).not.toMatch(/等待首次|电话联系/);
      expect(coherence.user_message).toMatch(/过时|面访|重新生成/);
    }

    const pageSource = readFileSync('src/pages/CustomerBattleCardPage.tsx', 'utf8');
    expect(pageSource).toContain('bc-stale-banner');
    expect(pageSource).toContain('evaluateBattleCardCoherence');
    const entrySource = readFileSync('src/components/aiNative/SalesAgentBattleCardEntry.tsx', 'utf8');
    expect(entrySource).toContain('data-card-stale');
    fixture.close();
  });
});

describe('V0.2 foreground — Feishu-specific visible copy', () => {
  it('does not expose Feishu-specific talk-track labels in user-visible Battle Card copy', () => {
    const source = readFileSync('src/components/battleCard/FeishuTalkTrackBlock.tsx', 'utf8');
    expect(source).toContain('价值复述');
    expect(source).toContain('暂无价值表达材料');
    expect(source).not.toContain('飞书价值复述');
    expect(source).not.toContain('暂无飞书话术材料');
  });
});
