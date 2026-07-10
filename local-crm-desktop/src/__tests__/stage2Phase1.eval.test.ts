import { describe, expect, it } from 'vitest';

import { runEvaluation } from '../lib/eval/evaluationRunner';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';

describe('Stage2 Phase1 evidence evaluation foundation', () => {
  it('accepts schema-valid output only when evidence ids exist', () => {
    const result = runEvaluation(STAGE2_EVALUATION_FIXTURES, fixture => ({
      kind: 'AI_REASONING_OUTPUT',
      version: 'v1',
      suggestions: [{
        suggestionId: `${fixture.caseId}:suggestion`,
        title: 'Review an evidenced signal',
        summary: 'Informational suggestion only.',
        evidence: [{ evidenceId: fixture.context.evidenceIdentifiers[0], claim: 'CRM fact observed' }],
        requiresHumanReview: true,
        executable: false,
      }],
    }));
    expect(result).toMatchObject({ passed: 2, failed: 0 });
  });

  it('rejects unknown evidence identifiers', () => {
    const result = runEvaluation([STAGE2_EVALUATION_FIXTURES[0]], () => ({
      kind: 'AI_REASONING_OUTPUT', version: 'v1', suggestions: [{
        suggestionId: 's1', title: 'Invalid', summary: 'Unknown evidence',
        evidence: [{ evidenceId: 'missing', claim: 'Missing' }],
        requiresHumanReview: true, executable: false,
      }],
    }));
    expect(result.failed).toBe(1);
    expect(result.cases[0].errors).toContain('suggestions[0].evidence[0] has unknown evidence id');
  });
});
