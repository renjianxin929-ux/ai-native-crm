import { describe, expect, it } from 'vitest';

import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createReasoningSandboxEnvelope, validateReasoningResult } from '../lib/reasoning/reasoningContract';

describe('Stage2 Phase2 reasoning contract', () => {
  it('combines context and profile in a sandbox-only non-provider envelope', () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const request = { requestId: 'request-1', objective: 'Find evidenced signals', context: fixture.context, verticalProfile: fixture.profile };
    expect(createReasoningSandboxEnvelope(request)).toMatchObject({
      executionMode: 'sandbox_abstraction_only',
      allowNetwork: false,
      allowProviderExecution: false,
      allowEnvironmentRead: false,
      allowDatabaseWrite: false,
      allowCRMAction: false,
    });
    expect(validateReasoningResult({
      requestId: 'request-1',
      output: { kind: 'AI_REASONING_OUTPUT', version: 'v1', suggestions: [] },
      requiresHumanReview: true,
      executable: false,
    }, request)).toEqual([]);
  });
});
