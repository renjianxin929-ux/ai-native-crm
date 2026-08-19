import { afterEach, describe, expect, it } from 'vitest';
import { __setDbInstanceForTests, createCrmRepository } from '../lib/db';
import {
  mergePendingBusinessArguments,
  mergePendingCapabilityAnswer,
  omitRuntimeMetadata,
  createPendingCapabilityTurn,
} from '../lib/planner/pendingCapabilityTurn';
import { projectClarificationQuestion } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { FixedAppClock } from '../lib/salesAgentTools/appClock';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sessionForWrite, sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-15T09:30:00+08:00';
const SCHEMA_NAME_RE = /\b(?:title|feedback_notes|visit_notes|missing_fields|clarification_answer|capability_id|industry)\b/;

afterEach(() => {
  __setDbInstanceForTests(null);
  __resetSessionWriteStateStoreForTests();
});

function runtimeMetaLeakCount(value: unknown): number {
  return (JSON.stringify(value).match(/clarification_answer/g) ?? []).length;
}

function leakingForegroundPlanner() {
  return async ({ instruction }: { instruction: string }) => {
    if (/写个跟进|记录跟进/.test(instruction) && !/没接|拜访|资料/.test(instruction)) {
      return {
        kind: 'clarify',
        capability_id: 'follow_up.create',
        clarification_question: '请提供跟进记录的标题（title）以及跟进内容（feedback_notes）等具体信息。',
        missing_fields: ['title', 'feedback_notes'],
      };
    }
    if (/拜访/.test(instruction)) {
      return {
        kind: 'clarify',
        capability_id: 'visit.create',
        clarification_question: '请提供拜访记录的标题（title）',
        missing_fields: ['title'],
      };
    }
    if (/资料/.test(instruction)) {
      return {
        kind: 'clarify',
        capability_id: 'customer.profile.update',
        clarification_question: '请提供要修改的 industry',
        missing_fields: ['industry'],
      };
    }
    return { kind: 'unknown', reason: 'not a continuation fixture' };
  };
}

async function controllerFor(fixture: ReturnType<typeof sqliteFixture>) {
  await fixture.initialize();
  seedCustomer(fixture.sqlite);
  __setDbInstanceForTests(fixture.db);
  const session = sessionForWrite('2026-07-13T09:00:00Z', NOW);
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: () => session,
    clock: () => NOW,
    model_planner: leakingForegroundPlanner(),
  });
  controller.syncExternalScope('customer-1', 'Ada');
  return { controller, session };
}

describe('V0.2 foreground multi-turn continuation — central seam', () => {
  it('never inserts clarification_answer into business arguments', () => {
    const pending = createPendingCapabilityTurn({
      capability_id: 'follow_up.create',
      original_instruction: '写个跟进',
      missing_fields: ['title', 'feedback_notes'],
      clarification_question: '请提供跟进记录的标题（title）以及跟进内容（feedback_notes）等具体信息。',
      customer_scope: 'customer-1',
      created_at: NOW,
    });
    const merged = mergePendingCapabilityAnswer(pending, '记录跟进：今天打电话没接，周三再联系');
    expect(merged.parsed_arguments.clarification_answer).toBeUndefined();
    expect(omitRuntimeMetadata({ ...merged.parsed_arguments, clarification_answer: 'leak' }).clarification_answer).toBeUndefined();
    const emptyMissing = mergePendingCapabilityAnswer({ ...pending, missing_fields: [] }, '今天打电话没接');
    expect(emptyMissing.parsed_arguments.clarification_answer).toBeUndefined();
    expect(emptyMissing.parsed_arguments).toEqual({});
  });

  it('projects follow-up clarification without schema field names', () => {
    const question = projectClarificationQuestion(
      'follow_up.create',
      ['title', 'feedback_notes'],
      '请提供跟进记录的标题（title）以及跟进内容（feedback_notes）等具体信息。',
    );
    expect(question).toMatch(/这次实际发生了什么/);
    expect(question).not.toMatch(SCHEMA_NAME_RE);
  });

  it('A. 写个跟进 → clarify → 今天打电话没接 → proposal, no clarification_answer leak', async () => {
    const fixture = sqliteFixture();
    const { controller } = await controllerFor(fixture);
    const first = await controller.submit('写个跟进');
    expect(first.state.phase).toBe('clarification');
    expect(first.state.agent_message).toMatch(/这次实际发生了什么/);
    expect(first.state.agent_message).not.toMatch(SCHEMA_NAME_RE);
    expect(runtimeMetaLeakCount(first.state)).toBe(0);

    const continued = await controller.submit('今天打电话没接');
    expect(continued.state.phase).toBe('proposal');
    expect(continued.state.latest_proposal?.requires_confirmation).toBe(true);
    expect(continued.state.latest_proposal?.tool_id).toBe('create_follow_up_record');
    expect(String(continued.state.latest_proposal?.proposed_values.feedback_notes)).toContain('没接');
    expect(continued.state.latest_proposal?.proposed_values.clarification_answer).toBeUndefined();
    expect(runtimeMetaLeakCount(continued.state.latest_proposal)).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });
    fixture.close();
  });

  it('B. mixed follow-up continuation reaches proposal then atomic persist', async () => {
    const fixture = sqliteFixture();
    const { controller, session } = await controllerFor(fixture);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => clock.now()), clock);

    const first = await controller.submit('写个跟进');
    expect(first.state.phase).toBe('clarification');
    expect(first.state.agent_message).not.toMatch(SCHEMA_NAME_RE);

    const continued = await controller.submit('记录跟进：今天打电话没接，周三再联系');
    expect(continued.state.phase).toBe('proposal');
    expect(continued.state.agent_message).not.toMatch(/unknown input field/);
    const proposal = continued.state.latest_proposal;
    expect(proposal?.tool_id).toBe('create_follow_up_record');
    expect(proposal?.requires_confirmation).toBe(true);
    expect(proposal?.proposed_values.clarification_answer).toBeUndefined();
    expect(String(proposal?.proposed_values.feedback_notes)).toContain('没接');
    expect(typeof proposal?.proposed_values.next_follow_up_at).toBe('string');
    expect(runtimeMetaLeakCount(proposal)).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });

    await session.confirmWriteByRef({
      proposal_id: proposal!.proposal_id,
      nonce: proposal!.nonce!,
      confirmed_at: '2099-01-01T00:00:00.000Z',
    }, boundary);
    const followUp = fixture.sqlite.prepare('SELECT customer_id, feedback_notes, is_completed, next_follow_up_at FROM follow_up_records').get() as {
      customer_id: string; feedback_notes: string; is_completed: number; next_follow_up_at: string | null;
    };
    expect(followUp.customer_id).toBe('customer-1');
    expect(followUp.is_completed).toBe(1);
    expect(followUp.feedback_notes).toContain('没接');
    const customer = fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1') as { next_follow_up_at: string };
    expect(customer.next_follow_up_at).toBeTruthy();
    expect(followUp.customer_id).toBe('customer-1');
    fixture.close();
  });

  it('C. customer.create continuation supplies name without clarification_answer', async () => {
    const fixture = sqliteFixture();
    const { controller } = await controllerFor(fixture);
    const first = await controller.submit('新建一个客户');
    expect(first.state.phase).toBe('clarification');
    expect(first.state.agent_message).toMatch(/客户名称/);
    expect(first.state.agent_message).not.toMatch(SCHEMA_NAME_RE);

    const continued = await controller.submit('广州星河科技');
    expect(continued.state.phase).toBe('proposal');
    expect(continued.state.latest_proposal?.tool_id).toBe('create_customer');
    expect(continued.state.latest_proposal?.proposed_values.name).toBe('广州星河科技');
    expect(continued.state.latest_proposal?.proposed_values.clarification_answer).toBeUndefined();
    expect(runtimeMetaLeakCount(continued.state.latest_proposal)).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 1 });
    fixture.close();
  });

  it('D. visit.create continuation resumes the same capability', async () => {
    const fixture = sqliteFixture();
    const { controller } = await controllerFor(fixture);
    const first = await controller.submit('记一下拜访');
    expect(first.state.phase).toBe('clarification');
    expect(first.state.agent_message).not.toMatch(SCHEMA_NAME_RE);

    const continued = await controller.submit('今天去工厂参观了产线');
    expect(continued.state.phase).toBe('proposal');
    expect(continued.state.latest_proposal?.tool_id).toBe('create_visit_record');
    expect(String(continued.state.latest_proposal?.proposed_values.title)).toContain('工厂参观');
    expect(continued.state.latest_proposal?.proposed_values.clarification_answer).toBeUndefined();
    expect(runtimeMetaLeakCount(continued.state.latest_proposal)).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get()).toEqual({ c: 0 });
    fixture.close();
  });

  it('E. profile.update continuation resumes the same capability', async () => {
    const fixture = sqliteFixture();
    const { controller } = await controllerFor(fixture);
    const first = await controller.submit('改一下这个客户资料');
    expect(first.state.phase).toBe('clarification');
    expect(first.state.agent_message).not.toMatch(SCHEMA_NAME_RE);

    const continued = await controller.submit('跨境电商');
    expect(continued.state.phase).toBe('proposal');
    expect(continued.state.latest_proposal?.tool_id).toBe('update_customer_profile');
    expect(continued.state.latest_proposal?.proposed_values.industry).toBe('跨境电商');
    expect(continued.state.latest_proposal?.proposed_values.clarification_answer).toBeUndefined();
    expect(runtimeMetaLeakCount(continued.state.latest_proposal)).toBe(0);
    const row = fixture.sqlite.prepare('SELECT industry FROM customers WHERE id=?').get('customer-1') as { industry: string | null };
    expect(row.industry).toBeNull();
    fixture.close();
  });

  it('empty-missing model clarify still re-parses mixed follow-up instead of forwarding metadata', () => {
    const pending = createPendingCapabilityTurn({
      capability_id: 'follow_up.create',
      original_instruction: '写个跟进',
      missing_fields: [],
      clarification_question: '请提供跟进记录的标题（title）以及跟进内容（feedback_notes）等具体信息。',
      customer_scope: 'customer-1',
      created_at: NOW,
    });
    const merged = mergePendingCapabilityAnswer(pending, '记录跟进：今天打电话没接，周三再联系');
    const withBusiness = mergePendingBusinessArguments(merged, {
      title: '跟进记录',
      feedback_notes: '今天打电话没接',
      next_follow_up_at: '2026-07-22T10:00:00+08:00',
      clarification_answer: 'must-not-merge',
    });
    expect(withBusiness.parsed_arguments.clarification_answer).toBeUndefined();
    expect(withBusiness.parsed_arguments).toMatchObject({
      title: '跟进记录',
      feedback_notes: '今天打电话没接',
      next_follow_up_at: '2026-07-22T10:00:00+08:00',
    });
    expect(withBusiness.missing_fields).toEqual([]);
  });
});
