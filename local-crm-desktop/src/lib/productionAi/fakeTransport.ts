import type { ModelContextEnvelope } from './modelContextEnvelope';
import type { ProductionModelCallResult, ProductionModelCaller } from './productionReasoningPath';

export type FakeTransportResponse =
  | { readonly kind: 'success'; readonly output: unknown; readonly latency_ms?: number; readonly usage?: ProductionModelCallResult['token_usage'] }
  | { readonly kind: 'error'; readonly status: number; readonly message: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'abort' };

export interface FakeTransportCall {
  readonly envelope: ModelContextEnvelope;
  readonly capability: 'TEXT_REASONING' | 'VISION_ANALYSIS';
  readonly headers_created_in_host: true;
  readonly authorization_present_in_request: false;
}

/**
 * Test-only Fake Network Transport for the production Trusted Host adapter path.
 * React never sees headers or secrets; calls are recorded for assertions.
 */
export function createFakeTrustedHostTransport(handler: (call: FakeTransportCall) => Promise<FakeTransportResponse> | FakeTransportResponse): {
  readonly calls: FakeTransportCall[];
  readonly caller: ProductionModelCaller;
} {
  const calls: FakeTransportCall[] = [];
  return {
    calls,
    caller: async ({ envelope, capability, signal }) => {
      if (signal?.aborted) throw Object.assign(new Error('cancelled'), { reason: 'cancelled' });
      const call: FakeTransportCall = {
        envelope,
        capability,
        headers_created_in_host: true,
        authorization_present_in_request: false,
      };
      calls.push(call);
      const response = await handler(call);
      if (response.kind === 'timeout') throw Object.assign(new Error('timeout'), { reason: 'timeout' });
      if (response.kind === 'abort') throw Object.assign(new Error('cancelled'), { reason: 'cancelled' });
      if (response.kind === 'error') {
        const reason = response.status === 401 || response.status === 403 ? 'unauthorized'
          : response.status === 429 ? 'rate_limited'
            : response.message;
        throw Object.assign(new Error(reason), { reason, status: response.status });
      }
      return {
        output: response.output,
        provider_kind: capability === 'VISION_ANALYSIS' ? 'QWEN_VISION_COMPATIBLE' : 'DEEPSEEK_COMPATIBLE',
        model_id: capability === 'VISION_ANALYSIS' ? 'qwen-vl-plus' : 'deepseek-chat',
        request_id: envelope.request_id,
        latency_ms: response.latency_ms ?? 12,
        token_usage: response.usage ?? { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };
    },
  };
}
