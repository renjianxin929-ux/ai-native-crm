/**
 * V0.1 FINAL REAL APP GOLDEN JOURNEY FIX — regression suite.
 * Locks the three real-app blockers found during human smoke testing:
 *   A. named customer scope resolution ("总结一下广州ABC科技有限公司" must auto-resolve the entity before the scope gate)
 *   B. structured model output acceptance (production DeepSeek response shape vs closed parser contract)
 *   C. runtime UI status semantics (schema-invalid must never surface as "模型不可用")
 */
import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { normalizeCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { runProductionReasoningPath } from '../lib/productionAi/productionReasoningPath';
import { validateModelOutputSchema, OUTPUT_SCHEMA_SPECS } from '../lib/productionAi/modelOutputSchemas';
import { buildModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { resolveRuntimeModeUiLabel, resolveProductionRuntimeOutcome } from '../lib/productionAi/runtimeMode';
import { insertSeededCustomer, openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';

const NOW = '2026-07-14T12:00:00.000Z';

const context = buildContextSnapshot({
  snapshotId: 'golden', capturedAt: NOW, timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
  customers: [{ customerId: 'c1', name: '广州ABC科技有限公司', grade: 'A', intentLevel: 'HIGH', observedAt: NOW, evidenceIds: ['ev1'] }],
  accounts: [], interactions: [],
});
const tool = (evidence: string) => ({ tool_id: 'get_customer_context' as const, records: [{ customer_id: 'c1' }], evidence_refs: [evidence], read_only: true as const, writes_crm: false as const });

const DEEPSEEK_CUSTOMER_SUMMARY = {
  customer_understanding: '该客户为 A 类高意向客户，主做外贸。',
  recent_changes: '近期完成一次拜访，客户表达明确采购意向。',
  risks: ['决策周期较长'],
  opportunities: ['下季度批量采购'],
  recommended_next_steps: ['确认关键决策人后安排下一次沟通'],
  evidence_refs: ['ev1'],
  uncertainty: ['预算上限待确认'],
  speculative_claims: [],
  requires_human_review: true,
};

describe('GOLDEN A — named customer scope resolution', () => {
  it('A0: normalize "总结一下广州ABC科技有限公司" → clean name_query without verb prefix', () => {
    const norm = normalizeCustomerSearchFilters('总结一下广州ABC科技有限公司', NOW);
    expect(norm.filters).toMatchObject({ name_query: '广州ABC科技有限公司' });
    expect(norm.filters.region).toBeUndefined();
    expect(norm.filters.industry).toBeUndefined();
    expect(norm.is_customer_lookup).toBe(true);
    expect(norm.is_portfolio_query).toBe(false);
  });

  it('A0b: real company names starting with analysis-verb characters are never stripped', () => {
    const norm = normalizeCustomerSearchFilters('分析测试技术有限公司', NOW);
    expect(norm.filters).toMatchObject({ name_query: '分析测试技术有限公司' });
    const withComma = normalizeCustomerSearchFilters('请帮我总结一下广州ABC科技有限公司', NOW);
    expect(withComma.filters).toMatchObject({ name_query: '广州ABC科技有限公司' });
  });

  it('A1: unscoped "总结一下广州ABC科技有限公司" auto-resolves the unique customer before the scope gate', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      insertSeededCustomer(fixture.sqlite, {
        id: 'gz-abc-tech', name: '广州ABC科技有限公司', region: '广州', industry: '贸易',
        customer_grade: 'A', stage: 'CONTACTED', intent_level: 'HIGH',
        last_contacted_at: '2026-07-01T00:00:00.000Z', next_follow_up_at: '2026-07-20T00:00:00.000Z',
      });
      const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => null, clock: () => NOW });
      const turn = await controller.submit('总结一下广州ABC科技有限公司');
      expect(turn.event.type).toBe('bind_required');
      expect(turn.state.scoped_customer_id).toBe('gz-abc-tech');
      expect(turn.state.scoped_customer_name).toBe('广州ABC科技有限公司');
      expect(turn.state.phase).toBe('resolving_customer');
      // The continuation keeps the analysis objective; it must NOT be a blocked "请先定位客户" turn.
      expect(turn.outcome).toBeUndefined();
      expect(turn.state.resolution_reason).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('A2: bare unique company name still resolves as a unique exact match', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      insertSeededCustomer(fixture.sqlite, {
        id: 'gz-abc-tech', name: '广州ABC科技有限公司', region: '广州', industry: '贸易',
        customer_grade: 'A', stage: 'CONTACTED', intent_level: 'HIGH',
        last_contacted_at: '2026-07-01T00:00:00.000Z', next_follow_up_at: '2026-07-20T00:00:00.000Z',
      });
      const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => null, clock: () => NOW });
      const turn = await controller.submit('广州ABC科技有限公司');
      expect(turn.event.type).toBe('bind_required');
      expect(turn.state.scoped_customer_id).toBe('gz-abc-tech');
    } finally {
      fixture.close();
    }
  });

  it('A3: ambiguous named analysis utterance clarifies without auto-binding scope', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      insertSeededCustomer(fixture.sqlite, {
        id: 'gz-abc-tech', name: '广州ABC科技有限公司', region: '广州', industry: '贸易',
        customer_grade: 'A', stage: 'CONTACTED', intent_level: 'HIGH',
        last_contacted_at: '2026-07-01T00:00:00.000Z', next_follow_up_at: '2026-07-20T00:00:00.000Z',
      });
      insertSeededCustomer(fixture.sqlite, {
        id: 'gz-abc-stock', name: '广州ABC科技股份', region: '广州', industry: '贸易',
        customer_grade: 'B', stage: 'CONTACTED', intent_level: 'MEDIUM',
        last_contacted_at: '2026-07-01T00:00:00.000Z', next_follow_up_at: '2026-07-20T00:00:00.000Z',
      });
      const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => null, clock: () => NOW });
      const turn = await controller.submit('总结一下广州ABC科技');
      expect(turn.state.phase).toBe('awaiting_candidate_selection');
      expect(turn.state.scoped_customer_id).toBeNull();
      expect(turn.state.candidate_results.length).toBeGreaterThan(1);
    } finally {
      fixture.close();
    }
  });
});

describe('GOLDEN B — structured model output contract', () => {
  it('B1: production-like DeepSeek customer_summary_v1 output is accepted by the closed validator', () => {
    const result = validateModelOutputSchema('customer_summary_v1', DEEPSEEK_CUSTOMER_SUMMARY);
    expect(result.valid).toBe(true);
    expect(result.output?.schema).toBe('customer_summary_v1');
  });

  it('B2: envelope carries the closed-schema field spec (single source of truth for the provider prompt)', () => {
    const envelope = buildModelContextEnvelope({
      request_id: 'b2', intent: 'CUSTOMER_SUMMARY', output_schema: 'customer_summary_v1',
      user_instruction: '总结客户现状', customer_id: 'c1', context, tool_trace: [tool('ev1')],
    });
    expect(envelope.output_schema_spec).toContain('customer_understanding');
    expect(envelope.output_schema_spec).toContain('requires_human_review');
    // Field-for-field parity with the closed validators: every spec must name
    // every field its validator requires (and none of the spec is empty).
    const FIELD_PARITY: Readonly<Record<string, readonly string[]>> = {
      customer_summary_v1: ['customer_understanding', 'recent_changes', 'risks', 'opportunities', 'recommended_next_steps', 'evidence_refs', 'uncertainty', 'speculative_claims', 'requires_human_review'],
      follow_up_draft_v1: ['draft_text', 'tone', 'objective', 'evidence_refs', 'unsupported_assumptions', 'requires_human_review'],
      risk_analysis_v1: ['risk_items', 'severity', 'reasoning_summary', 'evidence_refs', 'mitigation', 'uncertainty', 'requires_human_review'],
      next_action_v1: ['recommended_next_steps', 'reasoning_summary', 'evidence_refs', 'uncertainty', 'requires_human_review'],
      interaction_summary_v1: ['interaction_summary', 'key_points', 'evidence_refs', 'uncertainty', 'requires_human_review'],
      image_capture_analysis_v1: ['extracted_facts', 'source_reference', 'confidence', 'evidence_regions', 'unsupported_assumptions', 'requires_fact_review'],
      complex_customer_compare_v1: ['comparison_summary', 'ranked_customers', 'evidence_refs', 'uncertainty', 'requires_human_review'],
    };
    for (const [schema, fields] of Object.entries(FIELD_PARITY)) {
      const spec = OUTPUT_SCHEMA_SPECS[schema]!;
      expect(spec.length).toBeGreaterThan(40);
      for (const field of fields) expect(spec, `${schema} spec must name ${field}`).toContain(field);
    }
  });

  it('B3: malformed / partial responses fail closed (strict validation unchanged)', () => {
    expect(validateModelOutputSchema('customer_summary_v1', 'not json').valid).toBe(false);
    expect(validateModelOutputSchema('customer_summary_v1', { ...DEEPSEEK_CUSTOMER_SUMMARY, requires_human_review: false }).valid).toBe(false);
    const missingEvidence = { ...DEEPSEEK_CUSTOMER_SUMMARY, evidence_refs: [] };
    expect(validateModelOutputSchema('customer_summary_v1', missingEvidence).valid).toBe(false);
    const extraField = { ...DEEPSEEK_CUSTOMER_SUMMARY, invented_field: 'x' };
    expect(validateModelOutputSchema('customer_summary_v1', extraField).valid).toBe(false);
  });

  it('B4: schema-invalid model output never writes CRM and falls back to local projection', async () => {
    const fake = createFakeTrustedHostTransport(async () => ({ kind: 'success', output: { wrong_shape: true } }));
    const result = await runProductionReasoningPath({
      request_id: 'b4', intent: 'CUSTOMER_SUMMARY', message: '总结客户现状', customer_id: 'c1',
      context, tool_trace: [tool('ev1')], callModel: fake.caller,
    });
    expect(result.log.failure_category).toBe('invalid_schema');
    expect(result.validated_output).toBeNull();
    expect(result.runtime.validation_status).toBe('failed');
    expect(result.structured.recommended_next_step).toContain('未通过结构校验');
    expect(result.structured.customer_understanding).toContain('本地字段汇总');
  });
});

describe('GOLDEN C — runtime UI status semantics', () => {
  it('C1: provider unavailable → PROVIDER_UNAVAILABLE label', () => {
    const outcome = resolveProductionRuntimeOutcome({
      runtime_mode: 'MODEL_UNAVAILABLE', model_called: false, degraded: true,
      validation_status: 'skipped_no_model', evidence_validation_status: 'skipped_no_model', failure_category: 'unconfigured',
    });
    expect(outcome).toBe('PROVIDER_UNAVAILABLE');
    expect(resolveRuntimeModeUiLabel({ runtime_mode: 'MODEL_UNAVAILABLE', model_called: false, degraded: true, requires_real_model: true, failure_category: 'unconfigured' })).toBe('模型不可用，未进行 AI 推理');
  });

  it('C2: provider success + schema invalid → MODEL_OUTPUT_INVALID, never "provider unavailable"', () => {
    const outcome = resolveProductionRuntimeOutcome({
      runtime_mode: 'REAL_MODEL', model_called: true, degraded: true,
      validation_status: 'failed', evidence_validation_status: 'not_applicable', failure_category: 'invalid_schema',
    });
    expect(outcome).toBe('MODEL_OUTPUT_INVALID');
    const label = resolveRuntimeModeUiLabel({
      runtime_mode: 'REAL_MODEL', model_called: true, degraded: true, requires_real_model: true,
      validation_status: 'failed', evidence_validation_status: 'not_applicable', failure_category: 'invalid_schema',
    });
    expect(label).toBe('AI 返回结果未通过结构校验，已使用本地数据回退。');
    expect(label).not.toMatch(/模型不可用/);
  });

  it('C3: provider success + valid output → MODEL_OUTPUT_VALID', () => {
    const outcome = resolveProductionRuntimeOutcome({
      runtime_mode: 'REAL_MODEL', model_called: true, degraded: false,
      validation_status: 'passed', evidence_validation_status: 'passed', failure_category: null,
    });
    expect(outcome).toBe('MODEL_OUTPUT_VALID');
    expect(resolveRuntimeModeUiLabel({ runtime_mode: 'REAL_MODEL', model_called: true, degraded: false, requires_real_model: true })).toBe('已使用真实模型');
  });

  it('C1b: provider request failure (network/timeout) is distinct from provider unavailable', () => {
    const outcome = resolveProductionRuntimeOutcome({
      runtime_mode: 'MODEL_UNAVAILABLE', model_called: false, degraded: true,
      validation_status: 'skipped_no_model', evidence_validation_status: 'skipped_no_model', failure_category: 'timeout',
    });
    expect(outcome).toBe('PROVIDER_REQUEST_FAILED');
    expect(resolveRuntimeModeUiLabel({ runtime_mode: 'MODEL_UNAVAILABLE', model_called: false, degraded: true, requires_real_model: true, failure_category: 'timeout' })).toBe('模型请求失败，未生成 AI 分析');
  });
});
