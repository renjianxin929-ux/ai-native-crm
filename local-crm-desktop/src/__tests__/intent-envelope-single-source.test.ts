import { describe, expect, it } from 'vitest';
import { applySemanticIntentResolution, createAgentIntentEnvelope, mergeAgentIntentClarificationAnswer } from '../lib/salesAgentTools/agentIntentEnvelope';
import { deterministicPlanForEnvelope } from '../lib/salesAgentTools/agentSession';
import { intentFromEnvelope, proposeSalesAgentPlan } from '../lib/salesAgentTools/operatingLayer';
import { readFileSync } from 'node:fs';

describe('intent-envelope-single-source', () => {
  it('creates an immutable authoritative envelope and downstream planning preserves its decision', () => {
    const envelope = createAgentIntentEnvelope('  总结这个客户  ', '2026-07-16T00:00:00Z');
    expect(envelope.envelope_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(envelope).toMatchObject({ original_instruction: '  总结这个客户  ', normalized_instruction: '总结这个客户', intent: 'CUSTOMER_SUMMARY' });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(intentFromEnvelope(envelope)).toBe('CUSTOMER_SUMMARY');
    expect(deterministicPlanForEnvelope('c1', envelope).intent).toBe('CUSTOMER_SUMMARY');
    expect(proposeSalesAgentPlan(envelope, 'c1').intent).toBe('CUSTOMER_SUMMARY');
  });

  it('clarification fills only missing fields while preserving envelope id and intent', () => {
    const original = createAgentIntentEnvelope('帮我写一条跟进', '2026-07-16T00:00:00Z');
    const merged = mergeAgentIntentClarificationAnswer(original, '下周一上午十点');
    expect(merged.envelope_id).toBe(original.envelope_id);
    expect(merged.intent).toBe(original.intent);
    expect(merged.original_instruction).toBe(original.original_instruction);
  });

  it('semantic refinement preserves the single turn envelope id', () => {
    const original = createAgentIntentEnvelope('请帮我琢磨一下后续', '2026-07-16T00:00:00Z');
    const refined = applySemanticIntentResolution(original, {
      intent: 'NEXT_ACTION_RECOMMENDATION', filters: {}, entities: [], scope: null, missing_fields: [], confidence: 0.94, clarification_question: null,
    });
    expect(refined.envelope_id).toBe(original.envelope_id);
    expect(refined.intent).toBe('NEXT_ACTION_PREPARATION');
    expect(Object.isFrozen(refined)).toBe(true);
  });

  it('Controller creates once while Session and Operating Layer never reclassify text', () => {
    const controller = readFileSync('src/lib/salesAgentTools/interactionController.ts', 'utf8');
    const session = readFileSync('src/lib/salesAgentTools/agentSession.ts', 'utf8');
    const operating = readFileSync('src/lib/salesAgentTools/operatingLayer.ts', 'utf8');
    expect(controller.match(/createAgentIntentEnvelope\(/g)).toHaveLength(1);
    for (const source of [session, operating]) {
      expect(source).not.toContain('draftWriteFields(');
      expect(source).not.toContain('classifyClosedWriteIntent(');
      expect(source).not.toContain('createAgentIntentEnvelope(');
    }
  });
});
