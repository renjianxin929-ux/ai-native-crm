import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Stage2ArchitectureStatus } from '../components/aiNative/Stage2ArchitectureStatus';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';

describe('Stage2 Phase5 readonly workspace integration', () => {
  it('renders context, vertical profile, and explicit safety boundaries without actions', () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const markup = renderToStaticMarkup(createElement(Stage2ArchitectureStatus, {
      context: fixture.context,
      profile: fixture.profile,
    }));
    expect(markup).toContain('foreign_trade_geo');
    expect(markup).toContain('Sandbox abstraction only; no provider or network');
    expect(markup).toContain('Human review required; not executable');
    expect(markup).toContain('No CRM Write');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
  });
});
