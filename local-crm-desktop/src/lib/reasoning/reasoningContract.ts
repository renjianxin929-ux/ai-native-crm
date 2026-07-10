import { validateAIReasoningOutput, validateEvidenceReferences } from '../eval/evidenceValidator';
import type { ReasoningRequest, ReasoningResult, ReasoningSandboxEnvelope } from './types';

export function createReasoningSandboxEnvelope(request: ReasoningRequest): ReasoningSandboxEnvelope {
  if (!request.requestId.trim()) throw new Error('Reasoning request id is required.');
  if (!request.objective.trim()) throw new Error('Reasoning objective is required.');
  return {
    kind: 'REASONING_SANDBOX_ENVELOPE',
    version: 'v1',
    request,
    promptExtension: request.verticalProfile.promptExtension,
    executionMode: 'sandbox_abstraction_only',
    allowNetwork: false,
    allowProviderExecution: false,
    allowEnvironmentRead: false,
    allowDatabaseWrite: false,
    allowCRMAction: false,
  };
}

export function validateReasoningResult(result: ReasoningResult, request: ReasoningRequest): readonly string[] {
  const errors: string[] = [];
  if (result.requestId !== request.requestId) errors.push('reasoning result request id mismatch');
  if (result.requiresHumanReview !== true) errors.push('reasoning result must require human review');
  if (result.executable !== false) errors.push('reasoning result must be non-executable');
  const schema = validateAIReasoningOutput(result.output);
  const evidence = schema.valid
    ? validateEvidenceReferences(result.output, request.context)
    : { valid: false, errors: ['evidence validation skipped because schema is invalid'] };
  return [...errors, ...schema.errors, ...evidence.errors];
}
