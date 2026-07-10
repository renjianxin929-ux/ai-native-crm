import type { ContextSnapshot } from '../context/types';
import type { AIReasoningResult } from './types';
import { validateSalesAgentReasoningResult } from './validation';
import type { ReasoningProvider } from './provider';
import { runSalesAgentRuntime } from './runtime';
import type { SalesAgentEvaluationFixture } from './evaluationFixtures';

export interface SalesAgentEvaluationScore {
  valid: boolean;
  evidence_coverage: number;
  human_review_safe: boolean;
  required_fields_present: boolean;
  profile_used: boolean;
  errors: readonly string[];
}

export function scoreSalesAgentResult(result: AIReasoningResult, context: ContextSnapshot, expectedProfileId = result.reasoning_metadata.profile_id): SalesAgentEvaluationScore {
  const validation = validateSalesAgentReasoningResult(result, context);
  const judgmentGroups = [result.customer_summary, result.customer_stage, result.confidence, ...result.opportunities, ...result.risks, ...result.next_actions];
  const covered = judgmentGroups.filter(item => item.evidence_ids.length > 0).length;
  return {
    valid: validation.valid,
    evidence_coverage: judgmentGroups.length === 0 ? 0 : covered / judgmentGroups.length,
    human_review_safe: result.requires_human_review === true && result.executable === false && result.writes_crm === false,
    required_fields_present: Boolean(result.customer_summary.value && result.customer_stage.value && result.next_actions.length > 0 && result.decision_basis.length > 0),
    profile_used: result.reasoning_metadata.profile_id === expectedProfileId,
    errors: validation.errors,
  };
}

export interface SalesAgentEvaluationCaseResult {
  case_id: string;
  passed: boolean;
  score: SalesAgentEvaluationScore;
}

export async function runSalesAgentEvaluation(input: {
  fixtures: readonly SalesAgentEvaluationFixture[];
  createProvider: () => ReasoningProvider;
}): Promise<readonly SalesAgentEvaluationCaseResult[]> {
  return Promise.all(input.fixtures.map(async fixture => {
    const runtime = await runSalesAgentRuntime({
      request_id: fixture.case_id,
      objective: fixture.objective,
      context: fixture.context,
      profile_id: fixture.profile_id,
      provider: input.createProvider(),
      clock: () => '2026-07-11T00:00:00.000Z',
    });
    const score = scoreSalesAgentResult(runtime.result, fixture.context, fixture.profile_id);
    return {
      case_id: fixture.case_id,
      passed: score.valid
        && score.evidence_coverage >= fixture.minimum_evidence_coverage
        && score.human_review_safe
        && score.required_fields_present
        && score.profile_used,
      score,
    };
  }));
}

