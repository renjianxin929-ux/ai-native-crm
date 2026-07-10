import type { ContextSnapshot } from '../context/types';
import type { VerticalProfile } from '../verticalAIProfiles/types';

export interface EvidenceReference {
  evidenceId: string;
  claim: string;
}

export interface AISuggestion {
  suggestionId: string;
  title: string;
  summary: string;
  evidence: readonly EvidenceReference[];
  requiresHumanReview: true;
  executable: false;
}

export interface AIReasoningOutput {
  kind: 'AI_REASONING_OUTPUT';
  version: 'v1';
  suggestions: readonly AISuggestion[];
}

export interface EvaluationFixture {
  caseId: string;
  context: ContextSnapshot;
  profile: VerticalProfile;
}

export interface OutputValidationResult {
  valid: boolean;
  errors: readonly string[];
}
