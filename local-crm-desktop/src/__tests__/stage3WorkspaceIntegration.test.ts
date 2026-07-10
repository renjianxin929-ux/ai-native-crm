import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalesAgentResultPanel } from '../components/aiNative/SalesAgentResultPanel';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { runSalesAgentRuntime } from '../lib/salesAgent/runtime';

describe('Stage3 workspace integration', () => {
  it('renders analysis, evidence, confidence, and review without action affordances', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const runtime = await runSalesAgentRuntime({ request_id: 'ui-1', objective: 'Assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider() });
    const markup = renderToStaticMarkup(createElement(SalesAgentResultPanel, { runtime }));
    expect(markup).toContain('AI Sales Agent Analysis');
    expect(markup).toContain('Evidence references');
    expect(markup).toContain('Confidence:');
    expect(markup).toContain('Human review required');
    expect(markup).toContain('No CRM Write');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
  });
});

