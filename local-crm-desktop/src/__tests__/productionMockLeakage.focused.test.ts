import { describe, expect, it } from 'vitest';
import { readGraphSources, readProductionBundle } from './productionDependencyGraphHarness';

const BANNED = ['mock_sales_reasoning_v1', 'deterministic_fixture_v1', 'Build Top-', '当前 Mock / Trusted Host', '__salesAgentSubmitPrompt', 'window.__Agent'];

describe('production-mock-leakage suite', () => {
  it('keeps mock fixtures and production test hooks outside the reachable graph', () => {
    const source = readGraphSources();
    for (const marker of BANNED) expect(source).not.toContain(marker);
  });

  it('production-bundle-audit keeps mock fixtures, test hooks, endpoints and secrets outside the browser bundle', () => {
    const bundle = readProductionBundle();
    for (const marker of [...BANNED, 'api.deepseek.com', 'dashscope.aliyuncs.com', 'Authorization: Bearer', 'sk-test']) {
      expect(bundle).not.toContain(marker);
    }
  });
});
