import { describe, expect, it } from 'vitest';

import { createHumanReviewItem, recordHumanReviewDecision } from '../lib/reasoning/humanReviewContract';
import type { AIReasoningResultRecord } from '../lib/aiJobs/types';

describe('Stage2 Phase4 human review contract', () => {
  it('starts pending and requires an identified human decision', () => {
    const result = {
      resultId: 'result-1', jobId: 'job-1', createdAt: '2026-07-10T00:00:00.000Z', persistedToCRM: false, executable: false,
      reasoningResult: { requestId: 'request-1', output: { kind: 'AI_REASONING_OUTPUT', version: 'v1', suggestions: [] }, requiresHumanReview: true, executable: false },
    } satisfies AIReasoningResultRecord;
    const item = createHumanReviewItem(result, { reviewId: 'review-1', now: '2026-07-10T00:01:00.000Z' });
    expect(item).toMatchObject({ state: 'pending_human_review', writesCRM: false, executesAction: false });
    expect(() => recordHumanReviewDecision(item, { decision: 'retain_for_reference', reviewerId: '', now: '2026-07-10T00:02:00.000Z' })).toThrow('reviewer');
    expect(recordHumanReviewDecision(item, { decision: 'retain_for_reference', reviewerId: 'human-1', now: '2026-07-10T00:02:00.000Z' })).toMatchObject({
      state: 'retained_for_reference', reviewerId: 'human-1', writesCRM: false, executesAction: false,
    });
  });
});
