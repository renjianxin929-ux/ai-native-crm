import { describe, expect, it } from 'vitest';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import type { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';

describe('pending-instruction-resume and customer-bind-auto-resume', () => {
  it('preserves the original write envelope/date and asks only for time after candidate bind', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    let submittedEnvelope: unknown;
    let active: SalesAgentSession | null = null;
    const controller = new SalesAgentInteractionController({ db: fixture.db, clock: () => '2026-07-19T12:00:00+08:00', createSession: () => active });
    try {
      const first = await controller.submit('帮我给这个客户写一条跟进，下周一联系');
      expect(first.state.phase).toBe('awaiting_candidate_selection');
      expect(first.state.pending_session).toMatchObject({ original_instruction: '帮我给这个客户写一条跟进，下周一联系', pending_intent: 'CREATE_FOLLOW_UP_REQUEST', resume_after_scope: true });
      expect(first.state.pending_session.missing_fields).toEqual(expect.arrayContaining(['customer', 'next_follow_up_time']));
      const candidate = first.state.candidate_results[0]!;
      const selected = await controller.selectCandidate(candidate.id);
      expect(selected.event.type).toBe('bind_required');
      active = { submit: async envelope => {
        submittedEnvelope = envelope;
        return { kind: 'clarification_required', clarification: { kind: 'CLARIFICATION_REQUIRED', clarification_id: 'clarify-1', intent: 'CREATE_FOLLOW_UP_REQUEST', tool_id: 'create_follow_up_record', original_instruction: envelope.original_instruction, customer_id: candidate.id, question: '下周一几点联系？', missing_fields: ['next_follow_up_time'], parsed_fields: envelope.write_draft!.parsed_fields, quick_replies: envelope.write_draft!.quick_replies, pending_write_intent: 'CREATE_FOLLOW_UP_REQUEST' } };
      } } as unknown as SalesAgentSession;
      if (selected.event.type !== 'bind_required') throw new Error('expected bind');
      const resumed = await controller.continueAfterBind(selected.event.continue_prompt, candidate.id);
      expect(submittedEnvelope).toMatchObject({ original_instruction: '帮我给这个客户写一条跟进，下周一联系', write_draft: { missing_fields: ['next_follow_up_time'] } });
      expect(resumed.state.pending_session).toMatchObject({ selected_customer_id: candidate.id, missing_fields: ['next_follow_up_time'], clarification_state: 'REQUIRED', resume_after_scope: false });
      expect(resumed.state.agent_message).toBe('下周一几点联系？');
    } finally { fixture.close(); }
  });
});
