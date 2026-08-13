/**
 * Live DeepSeek provider contract evidence for the V0.1 Golden Journey Fix (BUG B).
 *
 * Skipped unless DEEPSEEK_LIVE_KEY is provided in the environment — never reads,
 * writes, or persists the key anywhere. This is the production-equivalent path:
 * the exact system prompt built by trusted_host.rs build_provider_request (closed
 * schema spec injected from OUTPUT_SCHEMA_SPECS) + the envelope user payload, then
 * the raw content is parsed with the same fence/prose-tolerant, object-only rules
 * as Rust parse_provider_json_payload, and finally runs the unchanged closed
 * validateModelOutputSchema. A legal real-provider answer must be accepted.
 */
import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { validateModelOutputSchema, OUTPUT_SCHEMA_SPECS } from '../lib/productionAi/modelOutputSchemas';

const NOW = '2026-07-15T12:00:00.000Z';

/**
 * Mirrors Rust parse_provider_json_payload (trusted_host.rs): fence tolerant,
 * object-only, fail-closed. Order matters: a successful whole-text parse of a
 * non-object (e.g. an array) fails closed WITHOUT the span fallback — the
 * fallback only runs when the whole text is not valid JSON at all.
 */
function parseProviderJsonPayload(content: string): unknown {
  let text = content.trim();
  for (const fence of ['```json', '```']) {
    if (text.startsWith(fence)) text = text.slice(fence.length).trim();
  }
  if (text.endsWith('```')) text = text.slice(0, -3).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('host_provider_invalid_json');
    parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('host_provider_invalid_json');
  }
  return parsed;
}

describe('live DeepSeek provider contract (BUG B real-provider evidence)', () => {
  it('parser mirror fails closed on whole-text non-object JSON, exactly like Rust', () => {
    expect(() => parseProviderJsonPayload('[{"customer_understanding":"x"}]')).toThrow('host_provider_invalid_json');
    expect(() => parseProviderJsonPayload('not json at all')).toThrow('host_provider_invalid_json');
    const fenced = parseProviderJsonPayload('```json\n{"customer_understanding":"x"}\n```');
    expect(fenced).toEqual({ customer_understanding: 'x' });
    const prose = parseProviderJsonPayload('好的,以下是结果:{"customer_understanding":"x"}');
    expect(prose).toEqual({ customer_understanding: 'x' });
  });

  it.skipIf(!process.env.DEEPSEEK_LIVE_KEY)('real customer_summary_v1 answer passes the closed validator through the production parser rules', { timeout: 90_000 }, async () => {
    const key = process.env.DEEPSEEK_LIVE_KEY as string;
    const context = buildContextSnapshot({
      snapshotId: 'live-gj', capturedAt: NOW, timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
      customers: [{ customerId: 'e2e-gzabc-01', name: '广州ABC科技有限公司', grade: 'A', intentLevel: 'HIGH', observedAt: NOW, evidenceIds: ['ev-1'] }],
      accounts: [], interactions: [],
    });
    const envelope = buildModelContextEnvelope({
      request_id: 'gj-live-1',
      intent: 'CUSTOMER_SUMMARY',
      output_schema: 'customer_summary_v1',
      user_instruction: '总结一下广州ABC科技有限公司',
      customer_id: 'e2e-gzabc-01',
      context,
      tool_trace: [{ tool_id: 'get_customer_context', records: [{ customer_id: 'e2e-gzabc-01' }], evidence_refs: ['ev-1'], read_only: true, writes_crm: false }],
    });
    expect(envelope.output_schema_spec).toContain('customer_understanding');
    const input = {
      model_context_envelope: envelope,
      required_schema: 'customer_summary_v1',
      attempt: 'initial',
      validation_errors: [],
    };
    const shapeInstruction = `Return only valid JSON matching this closed schema: ${OUTPUT_SCHEMA_SPECS['customer_summary_v1']}.`;
    const system = `${shapeInstruction} Cite only provided evidence_ids. Never execute actions, write CRM data, generate SQL, or invent evidence.`;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: false,
        temperature: 0,
        user: 'gj-live-1',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });
    expect(response.ok, `provider HTTP ${response.status}`).toBe(true);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    expect(typeof content).toBe('string');

    // The exact parser contract the production host applies (trusted_host.rs).
    const parsed = parseProviderJsonPayload(content as string);
    // The unchanged closed validator (modelOutputSchemas.ts).
    const validation = validateModelOutputSchema('customer_summary_v1', parsed);
    expect(validation.errors.join(' | ')).toBe('');
    expect(validation.valid).toBe(true);
    expect(validation.output?.schema).toBe('customer_summary_v1');
  });
});
