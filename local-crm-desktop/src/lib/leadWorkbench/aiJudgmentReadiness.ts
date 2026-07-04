import type { VerticalRuleProfile } from '../verticalProfiles';
import type { LeadImportDecision, LeadImportRow } from './types';

export interface AIJudgmentEvidenceReference {
  type: string;
  id: string;
}

export interface AIJudgmentCandidateInput {
  importRow: LeadImportRow;
  profile: VerticalRuleProfile;
  evidenceReferences: AIJudgmentEvidenceReference[];
}

export interface AIJudgmentCandidate {
  kind: 'AI_JUDGMENT_CANDIDATE';
  persisted: false;
  source_type: 'lead_import_row';
  source_id: string;
  profile_id: string;
  decision: LeadImportDecision;
  recommended_action: string;
  evidence_references: AIJudgmentEvidenceReference[];
  model_id: null;
  prompt_id: null;
  confidence: null;
}

export function buildAIJudgmentCandidate(input: AIJudgmentCandidateInput): AIJudgmentCandidate {
  return {
    kind: 'AI_JUDGMENT_CANDIDATE',
    persisted: false,
    source_type: 'lead_import_row',
    source_id: input.importRow.id,
    profile_id: input.profile.key,
    decision: input.importRow.decision,
    recommended_action: `lookup_goal:${input.profile.decision.lookupGoal}`,
    evidence_references: input.evidenceReferences,
    model_id: null,
    prompt_id: null,
    confidence: null,
  };
}
