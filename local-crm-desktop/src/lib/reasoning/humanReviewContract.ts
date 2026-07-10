import type { AIReasoningResultRecord } from '../aiJobs/types';

export type HumanReviewDecision = 'retain_for_reference' | 'reject';

export interface HumanReviewItem {
  reviewId: string;
  resultId: string;
  state: 'pending_human_review' | 'retained_for_reference' | 'rejected';
  createdAt: string;
  reviewedAt: string | null;
  reviewerId: string | null;
  decision: HumanReviewDecision | null;
  writesCRM: false;
  executesAction: false;
}

export function createHumanReviewItem(
  result: AIReasoningResultRecord,
  input: { reviewId: string; now: string },
): HumanReviewItem {
  if (result.reasoningResult.requiresHumanReview !== true || result.executable !== false) {
    throw new Error('Only non-executable reasoning results can enter human review.');
  }
  return {
    reviewId: input.reviewId,
    resultId: result.resultId,
    state: 'pending_human_review',
    createdAt: input.now,
    reviewedAt: null,
    reviewerId: null,
    decision: null,
    writesCRM: false,
    executesAction: false,
  };
}

export function recordHumanReviewDecision(
  item: HumanReviewItem,
  input: { decision: HumanReviewDecision; reviewerId: string; now: string },
): HumanReviewItem {
  if (item.state !== 'pending_human_review') throw new Error('Human review item is already resolved.');
  if (!input.reviewerId.trim()) throw new Error('Human reviewer id is required.');
  return {
    ...item,
    state: input.decision === 'retain_for_reference' ? 'retained_for_reference' : 'rejected',
    reviewedAt: input.now,
    reviewerId: input.reviewerId,
    decision: input.decision,
  };
}
