import { validateAIReasoningOutput, validateEvidenceReferences } from './evidenceValidator';
import type { AIReasoningOutput, EvaluationFixture } from './types';

export interface EvaluationCaseResult {
  caseId: string;
  schemaValid: boolean;
  evidenceValid: boolean;
  errors: readonly string[];
}

export interface EvaluationRunResult {
  cases: readonly EvaluationCaseResult[];
  passed: number;
  failed: number;
}

export function runEvaluation(
  fixtures: readonly EvaluationFixture[],
  candidate: (fixture: EvaluationFixture) => unknown,
): EvaluationRunResult {
  const cases = fixtures.map(fixture => {
    const output = candidate(fixture);
    const schema = validateAIReasoningOutput(output);
    const evidence = schema.valid
      ? validateEvidenceReferences(output as AIReasoningOutput, fixture.context)
      : { valid: false, errors: ['evidence validation skipped because schema is invalid'] };
    return {
      caseId: fixture.caseId,
      schemaValid: schema.valid,
      evidenceValid: evidence.valid,
      errors: [...schema.errors, ...evidence.errors],
    };
  });
  return {
    cases,
    passed: cases.filter(result => result.schemaValid && result.evidenceValid).length,
    failed: cases.filter(result => !result.schemaValid || !result.evidenceValid).length,
  };
}
