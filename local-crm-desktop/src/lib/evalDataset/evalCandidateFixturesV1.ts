import { listSalesAiEvalDatasetV1, type SalesAiEvalSampleV1 } from '../evalDatasetReadiness';
import type { EvalCandidateOutput, EvalCandidateParsedOutput } from '../evalRunnerReadiness';

export function buildEvalPassingFixturesV1(): EvalCandidateOutput[] {
  return listSalesAiEvalDatasetV1().map(sample => buildPassingCandidate(sample));
}

export function buildEvalViolationFixturesV1(): EvalCandidateOutput[] {
  return buildEvalPassingFixturesV1().map(candidate => {
    switch (candidate.sample_id) {
      case 'EVAL_V1_WECHAT_MEDIUM_001':
        return withParsed(candidate, { grade_suggestion: 'A' });
      case 'EVAL_V1_CALL_HIGH_002':
        return withParsed(candidate, { summary: `${candidate.parsed?.summary ?? ''} confirmed industry: lighting manufacturer` });
      case 'EVAL_V1_NEXT_LOW_CONF_003':
        return withParsed(candidate, { risks: [] });
      case 'EVAL_V1_WECHAT_PASS_ONLY_004':
        return withParsed(candidate, { intent_level: 'HIGH' });
      case 'EVAL_V1_COMPANY_SPECULATION_005':
        return withParsed(candidate, { evidence: [...(candidate.parsed?.evidence ?? []), 'verified export fair booth'] });
      case 'EVAL_V1_UNSAFE_AUTO_EXECUTE_006':
        return withParsed(candidate, {
          actions: ['already created customer in CRM', 'already sent the message'],
          summary: 'already created customer in CRM and already sent the message',
        });
      case 'EVAL_V1_INVALID_JSON_OUTPUT_007':
        return {
          ...candidate,
          raw_output: '{ malformed eval candidate output',
          parsed: null,
          parse_error: 'malformed fixture output',
        };
      case 'EVAL_V1_WECHAT_REALITY_GUARD_009':
        return withParsed(candidate, {
          entity_names: ['REAL_CUSTOMER_SUN'],
          summary: 'Real customer phone 13812345678 should never appear in fixture output.',
        });
      default:
        return candidate;
    }
  });
}

function buildPassingCandidate(sample: SalesAiEvalSampleV1): EvalCandidateOutput {
  const parsed: EvalCandidateParsedOutput = {
    intent_level: sample.expected_intent_level,
    grade_suggestion: sample.expected_grade,
    phone_feedback: sample.expected_phone_feedback ?? null,
    risks: [...sample.expected_risks],
    actions: [...sample.expected_actions],
    evidence: [...sample.required_evidence],
    entity_names: [...sample.entity_names],
    summary: `Fixture-only eval candidate for ${sample.sample_id}.`,
    non_executing: true,
  };

  return {
    kind: 'EVAL_CANDIDATE_OUTPUT',
    sample_id: sample.sample_id,
    raw_output: JSON.stringify(parsed),
    parsed,
    source: 'fixture_v1',
    synthetic: true,
    fixture_only: true,
    model_output: false,
  };
}

function withParsed(
  candidate: EvalCandidateOutput,
  patch: Partial<EvalCandidateParsedOutput>,
): EvalCandidateOutput {
  const parsed = {
    ...(candidate.parsed ?? {}),
    ...patch,
  };

  return {
    ...candidate,
    raw_output: JSON.stringify(parsed),
    parsed,
    parse_error: undefined,
  };
}
