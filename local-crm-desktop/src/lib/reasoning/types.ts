import type { ContextSnapshot } from '../context/types';
import type { AIReasoningOutput } from '../eval/types';
import type { VerticalProfile } from '../verticalAIProfiles/types';

export interface ReasoningRequest {
  requestId: string;
  objective: string;
  context: ContextSnapshot;
  verticalProfile: VerticalProfile;
}

export interface ReasoningSandboxEnvelope {
  kind: 'REASONING_SANDBOX_ENVELOPE';
  version: 'v1';
  request: ReasoningRequest;
  promptExtension: string;
  executionMode: 'sandbox_abstraction_only';
  allowNetwork: false;
  allowProviderExecution: false;
  allowEnvironmentRead: false;
  allowDatabaseWrite: false;
  allowCRMAction: false;
}

export interface ReasoningResult {
  requestId: string;
  output: AIReasoningOutput;
  requiresHumanReview: true;
  executable: false;
}
