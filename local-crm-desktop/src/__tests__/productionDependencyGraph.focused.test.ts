import { describe, expect, it } from 'vitest';
import { buildProductionDependencyGraph, readGraphSources } from './productionDependencyGraphHarness';

describe('production-dependency-graph suite', () => {
  it('walks the complete browser production entry graph', () => {
    const graph = buildProductionDependencyGraph();
    expect(graph.length).toBeGreaterThan(30);
    expect(graph.some(file => file.endsWith('src\\App.tsx') || file.endsWith('src/App.tsx'))).toBe(true);
    expect(graph.some(file => file.endsWith('AINativeCRMWorkspace.tsx'))).toBe(true);
    expect(graph.some(file => file.endsWith('productionReasoningPath.ts'))).toBe(true);
    expect(graph.some(file => file.endsWith('trustedHostAdapter.ts'))).toBe(true);
  });

  it('contains no reachable legacy mock/provider runtime', () => {
    const graph = buildProductionDependencyGraph();
    const forbiddenFiles = ['salesAgent/provider.ts', 'fakeTransport.ts', 'AIAssistantPage.tsx', 'textAIProvider.ts', 'multimodalProvider.ts', 'liveProviderSandboxTransport.ts'];
    for (const suffix of forbiddenFiles) expect(graph.some(file => file.replaceAll('\\', '/').endsWith(suffix))).toBe(false);
    const source = readGraphSources();
    for (const marker of ['createMockReasoningProvider(', 'mock_sales_reasoning_v1', 'deterministic_fixture_v1', '__salesAgentSubmitPrompt', 'window.__Agent']) {
      expect(source).not.toContain(marker);
    }
  });
});
