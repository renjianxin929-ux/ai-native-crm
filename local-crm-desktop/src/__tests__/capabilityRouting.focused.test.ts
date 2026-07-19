import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX,
  listDeterministicIntents,
  listModelRequiredIntents,
  listMultimodalIntents,
  resolveCapabilityRoute,
} from '../lib/productionAi/capabilityRoutingMatrix';

describe('capability-routing suite', () => {
  it('covers the formal production matrix with typed fields', () => {
    expect(PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX.length).toBeGreaterThanOrEqual(20);
    for (const entry of PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX) {
      expect(entry.intent).toBeTruthy();
      expect(entry.execution_mode).toBeTruthy();
      expect(typeof entry.requires_customer_scope).toBe('boolean');
      expect(Array.isArray(entry.deterministic_tools)).toBe(true);
      expect(entry.model_capability).toBeTruthy();
      expect(typeof entry.requires_real_model).toBe('boolean');
      expect(typeof entry.allows_local_fallback).toBe('boolean');
      expect(entry.output_schema).toBeTruthy();
      expect(typeof entry.evidence_required).toBe('boolean');
      expect(entry.write_policy).toBeTruthy();
      expect(entry.failure_policy).toBeTruthy();
    }
  });

  it('keeps deterministic CRM capabilities off the model path', () => {
    for (const intent of ['PORTFOLIO_SEARCH', 'ENTITY_RESOLUTION', 'TASK_FOLLOWUP_WRITE', 'CANCEL_CONFIRM_REPLAY', 'COUNT_PAGINATION', 'DATE_TIMEZONE_PARSE']) {
      const route = resolveCapabilityRoute(intent);
      expect(route.requires_real_model).toBe(false);
      expect(route.execution_mode).toBe('DETERMINISTIC');
    }
    expect(listDeterministicIntents()).toContain('PORTFOLIO_SEARCH');
  });

  it('routes summary/risk/draft intents to real text model', () => {
    for (const intent of ['CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'FOLLOW_UP_DRAFT', 'NEXT_ACTION_RECOMMENDATION']) {
      const route = resolveCapabilityRoute(intent);
      expect(route.requires_real_model).toBe(true);
      expect(route.execution_mode).toBe('REAL_TEXT_MODEL');
      expect(route.write_policy).toBe('none');
    }
    expect(listModelRequiredIntents()).toContain('CUSTOMER_SUMMARY');
  });

  it('routes image analysis to multimodal and blocks silent local fake vision', () => {
    const route = resolveCapabilityRoute('IMAGE_CAPTURE_ANALYSIS');
    expect(route.execution_mode).toBe('REAL_MULTIMODAL');
    expect(route.failure_policy).toBe('block_multimodal_allow_manual_entry');
    expect(listMultimodalIntents()).toContain('IMAGE_CAPTURE_ANALYSIS');
  });

  it('production chat session does not hardcode createMockReasoningProvider', () => {
    const session = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/agentSession.ts'), 'utf8');
    expect(session).not.toContain('createMockReasoningProvider()');
    expect(session).toContain('runProductionReasoningPath');
    expect(session).not.toContain('reasoning_profile');
  });
});
