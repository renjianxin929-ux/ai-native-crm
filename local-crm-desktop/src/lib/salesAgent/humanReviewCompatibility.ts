import type { HumanReviewItem } from '../reasoning/humanReviewContract';
import type { SalesAgentRuntimeResult } from './types';

export function adaptSalesAgentResultToHumanReviewContract(
  runtime: SalesAgentRuntimeResult,
  input: { review_id: string; created_at: string },
): HumanReviewItem {
  if (
    runtime.review_status !== 'pending_human_review'
    || runtime.result.requires_human_review !== true
    || runtime.result.executable !== false
    || runtime.result.writes_crm !== false
  ) {
    throw new Error('Sales Agent result violates the HumanReviewContract safety boundary.');
  }
  if (!input.review_id.trim() || !Number.isFinite(Date.parse(input.created_at))) {
    throw new Error('Human review compatibility requires review identity and timestamp.');
  }
  return {
    reviewId: input.review_id,
    resultId: runtime.request_id,
    state: 'pending_human_review',
    createdAt: input.created_at,
    reviewedAt: null,
    reviewerId: null,
    decision: null,
    writesCRM: false,
    executesAction: false,
  };
}

