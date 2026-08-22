import { describe, expect, it, vi } from 'vitest';
import { createProductionRefreshCoordinator } from '../lib/salesAgentTools/productionRefreshCoordinator';

describe('production post-confirmation refresh coordinator', () => {
  it('uses the production selected-context reload exactly once and explicitly suppresses copilot reruns', async () => {
    const reload = vi.fn(async () => undefined);
    await createProductionRefreshCoordinator(reload)();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith({ runCopilot: false });
  });
});
