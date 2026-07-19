import { describe, expect, it, vi } from 'vitest';
import { createTrustedHostSalesAgentAdapter } from '../lib/salesAgentTools/trustedHostAdapter';

describe('capture-cancellation', () => {
  it('drops a late Capture response after AbortSignal and invokes the host registry cancel path', async () => {
    let release!: () => void;
    const responseGate = new Promise<void>(resolve => { release = resolve; });
    const cancel = vi.fn(async () => true);
    const adapter = createTrustedHostSalesAgentAdapter({
      context_snapshot_id: 'snapshot-1', profile_id: 'foreign_trade_geo', cancel,
      authorize: async () => ({ authorizationId: 'capture-race-1', providerKind: 'QWEN_VISION_COMPATIBLE', modelId: 'qwen-vl-plus' }),
      execute: async () => {
        await responseGate;
        return { state: 'completed', providerKind: 'QWEN_VISION_COMPATIBLE', modelId: 'qwen-vl-plus', output: { extracted_facts: [] }, requestId: 'capture-race-1', latencyMs: 1, tokenUsage: null };
      },
    });
    const abort = new AbortController();
    const pending = adapter.capture({ customer_id: 'customer-1', source_type: 'image', source: 'data:image/png;base64,iVBORw0KGgo=', signal: abort.signal });
    abort.abort();
    release();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(cancel).toHaveBeenCalledWith('capture-race-1');
  });
});
