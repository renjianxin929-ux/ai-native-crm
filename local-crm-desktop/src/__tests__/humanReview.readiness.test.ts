import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildHumanReviewCandidate,
  type HumanReviewCandidateInput,
} from '../lib/leadWorkbench/humanReviewReadiness';

function makeInput(overrides: Partial<HumanReviewCandidateInput> = {}): HumanReviewCandidateInput {
  return {
    target_type: 'collected_lead',
    target_id: 'collected-1',
    proposed_action: 'CREATE_CUSTOMER',
    accepted: true,
    note: null,
    ...overrides,
  };
}

describe('HumanReview readiness contract', () => {
  it('builds a non-persisted accepted review candidate from a confirmation result', () => {
    const candidate = buildHumanReviewCandidate(makeInput());

    expect(candidate.kind).toBe('HUMAN_REVIEW_CANDIDATE');
    expect(candidate.persisted).toBe(false);
    expect(candidate.target_type).toBe('collected_lead');
    expect(candidate.target_id).toBe('collected-1');
    expect(candidate.proposed_action).toBe('CREATE_CUSTOMER');
    expect(candidate.user_decision).toBe('accepted');
    expect(candidate.resulting_action).toBe('CREATE_CUSTOMER');
    expect(candidate.note).toBeNull();
  });

  it('keeps cancelled confirmation separate from accepted execution', () => {
    const candidate = buildHumanReviewCandidate(makeInput({ accepted: false }));

    expect(candidate.user_decision).toBe('cancelled');
    expect(candidate.resulting_action).toBeNull();
  });

  it('requires target identity and keeps the existing confirm flow as the current human gate', () => {
    expect(() => buildHumanReviewCandidate(makeInput({ target_id: '' }))).toThrow('target_id is required');

    const pageSource = readFileSync(resolve(__dirname, '../pages/LeadWorkbenchPage.tsx'), 'utf8');
    expect(pageSource).toContain('window.confirm');
    expect(pageSource).toContain('shouldRunCollectedLeadCreateCustomer');
  });

  it('does not create a persisted HumanReview object, table, or permission system', () => {
    const source = readFileSync(resolve(__dirname, '../lib/leadWorkbench/humanReviewReadiness.ts'), 'utf8');

    expect(source).toContain('HUMAN_REVIEW_CANDIDATE');
    expect(source).not.toContain('human_reviews');
    expect(source).not.toContain('CREATE TABLE');
    expect(source).not.toContain('permission');
    expect(source).not.toContain('agent');
  });
});
