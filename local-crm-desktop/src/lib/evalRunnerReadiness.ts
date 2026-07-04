import type {
  EvalExpectedGrade,
  EvalFatalErrorTag,
  SalesAiEvalSampleV1,
} from './evalDatasetReadiness';
import type { IntentLevel, PhoneFeedback } from './types';

export const EVAL_RUNNER_VERSION = 'v1';

export type EvalRunMode = 'fixture_pass' | 'fixture_violation';

export interface EvalCandidateParsedOutput {
  intent_level?: IntentLevel;
  grade_suggestion?: EvalExpectedGrade;
  phone_feedback?: PhoneFeedback | null;
  risks?: readonly string[];
  actions?: readonly string[];
  evidence?: readonly string[];
  entity_names?: readonly string[];
  summary?: string;
  non_executing?: boolean;
}

export interface EvalCandidateOutput {
  kind: 'EVAL_CANDIDATE_OUTPUT';
  sample_id: string;
  raw_output: string;
  parsed: EvalCandidateParsedOutput | null;
  parse_error?: string;
  source: 'fixture_v1' | 'custom';
  synthetic: true;
  fixture_only: true;
  model_output: false;
}

export interface EvalRunInput {
  mode: EvalRunMode;
  samples: readonly SalesAiEvalSampleV1[];
  candidates: readonly EvalCandidateOutput[];
}

export interface EvalCheckResult {
  name:
    | 'candidate_shape'
    | 'required_evidence'
    | 'forbidden_errors'
    | 'expected_intent_level'
    | 'expected_grade'
    | 'expected_phone_feedback'
    | 'expected_risks'
    | 'expected_actions';
  passed: boolean;
  message: string;
}

export interface FatalErrorCheckResult {
  tag: EvalFatalErrorTag;
  detected: boolean;
  source: 'deterministic_detection';
  message: string;
}

export interface EvalSampleResult {
  kind: 'EVAL_SAMPLE_RESULT';
  sample: SalesAiEvalSampleV1;
  candidate: EvalCandidateOutput;
  checks: EvalCheckResult[];
  fatal_checks: FatalErrorCheckResult[];
  detected_fatal_tags: EvalFatalErrorTag[];
  passed: boolean;
}

export interface EvalSummary {
  total_samples: number;
  passed: number;
  failed: number;
  fatal_detected_count: number;
  check_pass_rate: number;
}

export interface EvalRunResult {
  kind: 'EVAL_RUN_RESULT';
  runner_version: typeof EVAL_RUNNER_VERSION;
  mode: EvalRunMode;
  executable: false;
  persisted: false;
  represents_model_quality: false;
  summary: EvalSummary;
  results: EvalSampleResult[];
}

const emptyCandidate = (sampleId: string): EvalCandidateOutput => ({
  kind: 'EVAL_CANDIDATE_OUTPUT',
  sample_id: sampleId,
  raw_output: '',
  parsed: null,
  parse_error: 'candidate missing',
  source: 'custom',
  synthetic: true,
  fixture_only: true,
  model_output: false,
});

export function runEvalDatasetV1(input: EvalRunInput): EvalRunResult {
  const bySampleId = new Map(input.candidates.map(candidate => [candidate.sample_id, candidate]));
  const results = input.samples.map(sample => evaluateSample(sample, bySampleId.get(sample.sample_id) ?? emptyCandidate(sample.sample_id)));
  const passed = results.filter(result => result.passed).length;
  const totalChecks = results.reduce((sum, result) => sum + result.checks.length, 0);
  const passedChecks = results.reduce(
    (sum, result) => sum + result.checks.filter(check => check.passed).length,
    0,
  );

  return {
    kind: 'EVAL_RUN_RESULT',
    runner_version: EVAL_RUNNER_VERSION,
    mode: input.mode,
    executable: false,
    persisted: false,
    represents_model_quality: false,
    summary: {
      total_samples: input.samples.length,
      passed,
      failed: input.samples.length - passed,
      fatal_detected_count: results.reduce((sum, result) => sum + result.detected_fatal_tags.length, 0),
      check_pass_rate: totalChecks === 0 ? 0 : passedChecks / totalChecks,
    },
    results,
  };
}

function evaluateSample(sample: SalesAiEvalSampleV1, candidate: EvalCandidateOutput): EvalSampleResult {
  const fatalChecks = detectFatalErrors(sample, candidate);
  const detectedFatalTags = fatalChecks
    .filter(check => check.detected)
    .map(check => check.tag);
  const checks = buildChecks(sample, candidate, detectedFatalTags);

  return {
    kind: 'EVAL_SAMPLE_RESULT',
    sample,
    candidate,
    checks,
    fatal_checks: fatalChecks,
    detected_fatal_tags: detectedFatalTags,
    passed: checks.every(check => check.passed) && detectedFatalTags.length === 0,
  };
}

function buildChecks(
  sample: SalesAiEvalSampleV1,
  candidate: EvalCandidateOutput,
  detectedFatalTags: readonly EvalFatalErrorTag[],
): EvalCheckResult[] {
  return [
    check(
      'candidate_shape',
      candidate.kind === 'EVAL_CANDIDATE_OUTPUT'
        && candidate.sample_id === sample.sample_id
        && candidate.raw_output.trim().length > 0
        && candidate.synthetic === true
        && candidate.fixture_only === true
        && candidate.model_output === false,
      'candidate must be fixture-only output for the sample',
    ),
    check(
      'required_evidence',
      sample.required_evidence.every(evidence => candidateText(candidate).includes(evidence)),
      'every required evidence item must appear in candidate evidence or output',
    ),
    check(
      'forbidden_errors',
      detectedFatalTags.length === 0,
      'candidate must not trigger deterministic fatal checks',
    ),
    check(
      'expected_intent_level',
      candidate.parsed?.intent_level === sample.expected_intent_level,
      'intent level must match expected value',
    ),
    check(
      'expected_grade',
      candidate.parsed?.grade_suggestion === sample.expected_grade,
      'grade suggestion must match expected value',
    ),
    check(
      'expected_phone_feedback',
      (sample.expected_phone_feedback ?? null) === (candidate.parsed?.phone_feedback ?? null),
      'phone feedback must match expected value',
    ),
    check(
      'expected_risks',
      includesAll(sample.expected_risks, [
        ...(candidate.parsed?.risks ?? []),
        candidate.raw_output,
      ].join('\n')),
      'expected risks must appear as substrings',
    ),
    check(
      'expected_actions',
      includesAll(sample.expected_actions, [
        ...(candidate.parsed?.actions ?? []),
        candidate.raw_output,
      ].join('\n')),
      'expected actions must appear as substrings',
    ),
  ];
}

function detectFatalErrors(sample: SalesAiEvalSampleV1, candidate: EvalCandidateOutput): FatalErrorCheckResult[] {
  const text = candidateText(candidate).toLowerCase();
  const parsed = candidate.parsed;
  const risks = parsed?.risks ?? [];
  const evidence = parsed?.evidence ?? [];
  const entityNames = parsed?.entity_names ?? [];

  return [
    fatal('invalid_json', parsed === null || Boolean(candidate.parse_error), 'candidate parse failed'),
    fatal(
      'fabricated_evidence',
      evidence.some(item => item.trim().length > 0 && !sample.raw_input.includes(item)),
      'candidate evidence is not present in raw input',
    ),
    fatal(
      'unsafe_auto_execute',
      /\b(auto-created|auto-sent|already created|already sent|written to crm|created customer|sent the message)\b/i.test(text),
      'candidate claims an automatic CRM or message action',
    ),
    fatal(
      'wrong_high_intent_upgrade',
      ['LOW', 'NONE', 'UNKNOWN'].includes(sample.expected_intent_level) && parsed?.intent_level === 'HIGH',
      'candidate upgrades low or unknown intent to high',
    ),
    fatal(
      'unauthorized_grade_upgrade',
      sample.expected_grade !== 'A' && parsed?.grade_suggestion === 'A',
      'candidate upgrades grade to A without expected support',
    ),
    fatal(
      'ignores_risk',
      parsed !== null && sample.expected_risks.length > 0 && risks.length === 0,
      'candidate omits expected risk coverage',
    ),
    fatal(
      'sample_as_real_data',
      /\b1[3-9]\d{9}\b/.test(candidate.raw_output)
        || entityNames.some(name => !name.startsWith('EVAL_SAMPLE_') && !name.startsWith('EVAL_V1_')),
      'candidate treats eval placeholder as real data',
    ),
    fatal(
      'speculation_as_fact',
      /\b(confirmed industry|industry is|as verified fact)\b/i.test(text),
      'candidate states speculation as fact',
    ),
  ];
}

function candidateText(candidate: EvalCandidateOutput): string {
  const evidence = candidate.parsed?.evidence?.join('\n') ?? '';
  return `${candidate.raw_output}\n${evidence}`;
}

function includesAll(expected: readonly string[], actual: string): boolean {
  return expected.every(item => actual.includes(item));
}

function check(name: EvalCheckResult['name'], passed: boolean, message: string): EvalCheckResult {
  return { name, passed, message };
}

function fatal(tag: EvalFatalErrorTag, detected: boolean, message: string): FatalErrorCheckResult {
  return {
    tag,
    detected,
    source: 'deterministic_detection',
    message,
  };
}
