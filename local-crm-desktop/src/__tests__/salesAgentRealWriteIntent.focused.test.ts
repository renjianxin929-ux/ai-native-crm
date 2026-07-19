import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { confirmSalesAgentProposal } from '../components/aiNative/SalesAgentInteractionWorkspace';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { deterministicPlanForEnvelope, SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { classifyClosedWriteIntent, draftWriteFields, mergeClarificationAnswer, parseRelativeDateTime } from '../lib/salesAgentTools/writeIntent';
import { intentFromEnvelope } from '../lib/salesAgentTools/operatingLayer';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { resolveUnifiedAgentStageMode } from '../lib/salesAgentUi/stageMode';
import { confirmationFor, proposalFor, seedCustomer, sessionForWrite, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';

const interactionSource = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
const intent = (message: string) => createAgentIntentEnvelope(message, '2026-07-15T12:00:00+08:00');

describe('REAL write intent NL closure', () => {
  it('1-3: 写一条跟进 beats summary/draft and customer broad regex', () => {
    expect(classifyClosedWriteIntent('帮我写一条跟进，下周一联系')?.intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    const envelope = createAgentIntentEnvelope('帮我写一条跟进，下周一联系', new Date().toISOString());
    expect(intentFromEnvelope(envelope)).not.toBe('CUSTOMER_SUMMARY');
    expect(intentFromEnvelope(envelope)).not.toBe('FOLLOW_UP_DRAFT');
    expect(deterministicPlanForEnvelope('c1', intent('帮我写一条跟进 下周一联系')).intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    expect(deterministicPlanForEnvelope('c1', intent('总结客户现状')).intent).toBe('CUSTOMER_SUMMARY');
  });

  it('4-5: relative dates use local timezone and compute 下周一 from clock', () => {
    const nowIso = new Date().toISOString();
    const monday = parseRelativeDateTime('下周一联系', nowIso);
    expect(monday).toBeTruthy();
    expect(monday!.has_explicit_time).toBe(false);
    const mondayDate = new Date(`${monday!.iso.slice(0, 10)}T12:00:00`);
    expect(mondayDate.getDay()).toBe(1);
    expect(mondayDate.getTime()).toBeGreaterThan(Date.now() - 86400000);

    const withTime = parseRelativeDateTime('下周五下午三点', nowIso);
    expect(withTime?.has_explicit_time).toBe(true);
    expect(withTime?.iso.includes('15:00')).toBe(true);
    // Local offset form — never silent UTC Z for Chinese relative phrases.
    expect(withTime?.iso.endsWith('Z')).toBe(false);
  });

  it('6-8: missing time enters clarification, keeps pending instruction, resumes after answer', async () => {
    const session = sessionForWrite();
    const first = await session.submit(intent('帮我写一条跟进，下周一联系'));
    expect(first.kind).toBe('clarification_required');
    if (first.kind !== 'clarification_required') throw new Error('expected clarification');
    expect(first.clarification.original_instruction).toContain('写一条跟进');
    expect(first.clarification.question).toMatch(/几点/);
    expect(first.clarification.pending_write_intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    const draft = draftWriteFields('帮我写一条跟进，下周一联系', '2026-07-15T12:00:00+08:00')!;
    const merged = mergeClarificationAnswer(draft, '上午10:00', '2026-07-15T12:00:00+08:00');
    expect(merged.missing_fields).toEqual([]);
    expect(String(merged.parsed_fields.next_follow_up_at)).toContain('10:00');
    const second = await session.submit(intent('上午10:00'));
    expect(second.kind).toBe('write_proposal');
    if (second.kind !== 'write_proposal') throw new Error('expected proposal');
    expect(second.proposal.tool_id).toBe('create_follow_up_record');
    expect(second.proposal.requires_confirmation).toBe(true);
    expect(second.proposal.executable).toBe(false);
  });

  it('9-13: proposal is Session-owned; stage prefers awaiting-confirmation; card is Chinese', async () => {
    expect(interactionSource).not.toContain('createWriteProposal');
    expect(interactionSource).toContain('controller.submit');
    expect(interactionSource).toContain('agent-confirm-card');
    expect(interactionSource).toContain('取消');
    expect(interactionSource).toContain('确认新增');
    expect(interactionSource).toContain('agent-clarification-card');
    expect(interactionSource).toContain('confirmSalesAgentProposal(session, confirmedProposal, async () =>');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false, locatingCustomer: false, phase: 'idle', candidateCount: 0,
      hasProposal: true, hasResult: true, hasWriteSuccess: false, hasClarification: false,
    })).toBe('proposal');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false, locatingCustomer: false, phase: 'idle', candidateCount: 0,
      hasProposal: false, hasResult: true, hasWriteSuccess: false, hasClarification: true,
    })).toBe('clarification');
    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const proposalTurn = await session.submit(intent('下午3:00'));
    expect(proposalTurn.kind).toBe('write_proposal');
  });

  it('14-15: write path never emits English grade mock; visible write flow is Chinese', async () => {
    const session = sessionForWrite();
    const outcome = await session.submit(intent('帮我写一条跟进，下周一联系'));
    expect(JSON.stringify(outcome)).not.toContain('graded A with HIGH intent');
    expect(JSON.stringify(outcome)).not.toMatch(/is currently graded/);
    if (outcome.kind === 'clarification_required') {
      expect(outcome.clarification.question).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('16-20: cancel zero write; confirm once; replay rejected; refresh once runCopilot false path', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));
    const session = sessionForWrite();
    await session.submit(intent('帮我写一条跟进，下周一联系'));
    const proposalOutcome = await session.submit(intent('上午10:00'));
    expect(proposalOutcome.kind).toBe('write_proposal');
    if (proposalOutcome.kind !== 'write_proposal') throw new Error('proposal');
    session.cancelPendingWrite(proposalOutcome.proposal);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });

    const session2 = sessionForWrite();
    await session2.submit(intent('帮我写一条跟进，下周一联系'));
    const again = await session2.submit(intent('上午10:00'));
    if (again.kind !== 'write_proposal') throw new Error('proposal');
    const refresh = vi.fn(async () => undefined);
    await confirmSalesAgentProposal(session2, again.proposal, refresh, boundary);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 1 });
    const row = fixture.sqlite.prepare('SELECT customer_id,title,feedback_notes,next_follow_up_at FROM follow_up_records WHERE customer_id=?').get('customer-1') as {
      customer_id: string; title: string; feedback_notes: string; next_follow_up_at: string;
    };
    expect(row.customer_id).toBe('customer-1');
    expect(row.title).toBe('跟进记录');
    expect(row.feedback_notes).toContain('下周一');
    await expect(confirmSalesAgentProposal(session2, again.proposal, refresh, boundary)).rejects.toThrow(/replay|Confirmation|nonce|Unknown/i);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 1 });
    expect(interactionSource).toContain('onRefresh');
    const workspaceSource = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');
    expect(workspaceSource).toContain('createProductionRefreshCoordinator');
    expect(workspaceSource).not.toContain('runCopilot');
    fixture.close();
  });

  it('21-23: CREATE_TASK / UPDATE_NEXT_FOLLOW_UP / CREATE_FOLLOW_UP past-comms', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));

    const taskSession = sessionForWrite();
    const taskFirst = await taskSession.submit(intent('下周三提醒我给这个客户发报价'));
    expect(taskFirst.kind === 'clarification_required' || taskFirst.kind === 'write_proposal').toBe(true);
    let taskProposal = taskFirst;
    if (taskFirst.kind === 'clarification_required') {
      taskProposal = await taskSession.submit(intent('上午10:00'));
    }
    expect(taskProposal.kind).toBe('write_proposal');
    if (taskProposal.kind !== 'write_proposal') throw new Error('task proposal');
    expect(taskProposal.proposal.tool_id).toBe('create_task');
    await confirmSalesAgentProposal(taskSession, taskProposal.proposal, async () => undefined, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks WHERE customer_id=?').get('customer-1')).toEqual({ c: 1 });

    const updateSession = sessionForWrite('2026-07-16T15:00:00+08:00');
    const updateOutcome = await updateSession.submit(intent('把下一次跟进改到下周五下午三点'));
    expect(updateOutcome.kind).toBe('write_proposal');
    if (updateOutcome.kind !== 'write_proposal') throw new Error('update');
    expect(updateOutcome.proposal.tool_id).toBe('update_next_follow_up_time');
    expect(updateOutcome.proposal.current_values.next_follow_up_at).toBe('2026-07-16T15:00:00+08:00');
    expect(String(updateOutcome.proposal.proposed_values.next_follow_up_at)).toContain('15:00');
    await confirmSalesAgentProposal(updateSession, updateOutcome.proposal, async () => undefined, boundary);
    const next = fixture.sqlite.prepare('SELECT next_follow_up_at,name,customer_grade FROM customers WHERE id=?').get('customer-1') as {
      next_follow_up_at: string; name: string; customer_grade: string;
    };
    expect(next.next_follow_up_at).toContain('15:00');
    expect(next.name).toBe('Ada');
    expect(next.customer_grade).toBe('A');

    const followSession = sessionForWrite();
    const past = await followSession.submit(intent('新增跟进记录：今天和客户确认了报价方案，对方下周给反馈'));
    expect(past.kind).toBe('write_proposal');
    if (past.kind !== 'write_proposal') throw new Error('past follow-up');
    expect(past.proposal.tool_id).toBe('create_follow_up_record');
    expect(String(past.proposal.proposed_values.feedback_notes)).toContain('确认了报价方案');
    fixture.close();
  });

  it('24-25: undisclosed dual-write forbidden; errors never render as [object Object]', async () => {
    const proposal = await proposalFor(sessionForWrite(), 'Log a follow up: customer asked for pricing');
    expect(Object.keys(proposal.proposed_values).every(key => ['title', 'feedback_notes', 'next_follow_up_at'].includes(key))).toBe(true);
    expect(formatUserFacingErrorMessage({ message: 'boom' })).not.toContain('[object Object]');
    expect(formatUserFacingErrorMessage(new Error('x'))).toBe('x');
  });

  it('scoped controller write path reuses scope and never searches', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite, 'customer-1');
    fixture.sqlite.prepare("UPDATE customers SET name=? WHERE id=?").run('广州机械设备股份', 'customer-1');
    let searchCalls = 0;
    const originalExecute = fixture.db.execute.bind(fixture.db);
    const db = {
      ...fixture.db,
      async select<T>(sql: string, bindings: unknown[] = []) {
        if (/FROM customers/i.test(sql) && /LIKE/i.test(sql)) searchCalls += 1;
        return fixture.db.select<T>(sql, bindings);
      },
      execute: originalExecute,
    };
    const session = sessionForWrite();
    const controller = new SalesAgentInteractionController({
      db,
      createSession: () => session,
      clock: () => '2026-07-15T12:00:00+08:00',
    });
    controller.syncExternalScope('customer-1', '广州机械设备股份');
    const turn = await controller.submit('帮我写一条跟进，下周一联系');
    expect(searchCalls).toBe(0);
    expect(turn.state.scoped_customer_id).toBe('customer-1');
    expect(turn.state.phase).toBe('clarification');
    expect(JSON.stringify(turn)).not.toContain('graded A with HIGH intent');
    const continued = await controller.submit('上午10:00');
    expect(continued.state.phase).toBe('proposal');
    expect(continued.state.current_intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    expect(continued.state.latest_proposal?.tool_id).toBe('create_follow_up_record');
    fixture.close();
  });
});
