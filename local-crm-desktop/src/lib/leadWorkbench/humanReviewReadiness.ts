export type HumanReviewDecision = 'accepted' | 'cancelled' | 'modified';

export interface HumanReviewCandidateInput {
  target_type: string;
  target_id: string;
  proposed_action: string;
  accepted: boolean;
  note?: string | null;
}

export interface HumanReviewCandidate {
  kind: 'HUMAN_REVIEW_CANDIDATE';
  persisted: false;
  target_type: string;
  target_id: string;
  proposed_action: string;
  user_decision: HumanReviewDecision;
  resulting_action: string | null;
  note: string | null;
}

export function buildHumanReviewCandidate(input: HumanReviewCandidateInput): HumanReviewCandidate {
  if (!input.target_id.trim()) {
    throw new Error('target_id is required');
  }

  const userDecision: HumanReviewDecision = input.accepted ? 'accepted' : 'cancelled';
  return {
    kind: 'HUMAN_REVIEW_CANDIDATE',
    persisted: false,
    target_type: input.target_type,
    target_id: input.target_id,
    proposed_action: input.proposed_action,
    user_decision: userDecision,
    resulting_action: input.accepted ? input.proposed_action : null,
    note: input.note ?? null,
  };
}
