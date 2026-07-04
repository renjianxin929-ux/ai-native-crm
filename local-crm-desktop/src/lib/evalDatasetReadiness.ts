import type { ModelRoutePurpose } from './modelRouterReadiness';
import type { CustomerGrade, IntentLevel, PhoneFeedback } from './types';
import { SALES_AI_EVAL_DATASET_V1 } from './evalDataset/salesAiEvalDatasetV1';

export const EVAL_DATASET_VERSION = 'v1';

export const EVAL_SAMPLE_SOURCE_TYPES = [
  'wechat_screenshot',
  'call_transcript',
  'next_action_suggestion',
] as const;

export const EVAL_FATAL_ERROR_TAGS = [
  'fabricated_evidence',
  'unsafe_auto_execute',
  'wrong_high_intent_upgrade',
  'ignores_risk',
  'invalid_json',
  'sample_as_real_data',
  'speculation_as_fact',
  'unauthorized_grade_upgrade',
] as const;

export type EvalSampleSourceType = typeof EVAL_SAMPLE_SOURCE_TYPES[number];
export type EvalFatalErrorTag = typeof EVAL_FATAL_ERROR_TAGS[number];
export type EvalExpectedOutcome = 'positive' | 'caution' | 'negative';
export type EvalExpectedGrade = CustomerGrade | 'UNKNOWN';

export interface SalesAiEvalSampleV1 {
  kind: 'EVAL_SAMPLE';
  dataset_version: typeof EVAL_DATASET_VERSION;
  persisted: false;
  synthetic: true;
  sample_id: string;
  profile_id: string;
  source_type: EvalSampleSourceType;
  route_purpose: ModelRoutePurpose;
  raw_input: string;
  context: Readonly<Record<string, string>>;
  expected_outcome: EvalExpectedOutcome;
  expected_intent_level: IntentLevel;
  expected_grade: EvalExpectedGrade;
  expected_phone_feedback?: PhoneFeedback;
  expected_risks: readonly string[];
  expected_actions: readonly string[];
  required_evidence: readonly string[];
  forbidden_errors: readonly string[];
  fatal_error_tags: readonly EvalFatalErrorTag[];
  entity_names: readonly string[];
  notes: string;
  golden_answer?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EvalSampleValidationResult {
  valid: boolean;
  errors: string[];
}

const sourceTypes = new Set<string>(EVAL_SAMPLE_SOURCE_TYPES);
const fatalTags = new Set<string>(EVAL_FATAL_ERROR_TAGS);
const routePurposes = new Set<string>([
  'wechat_screenshot_analysis',
  'call_transcript_analysis',
  'next_action_suggestion',
]);

export function listSalesAiEvalDatasetV1(): readonly SalesAiEvalSampleV1[] {
  return SALES_AI_EVAL_DATASET_V1;
}

export function validateEvalSample(sample: SalesAiEvalSampleV1): EvalSampleValidationResult {
  const errors: string[] = [];

  requireField(errors, sample.kind === 'EVAL_SAMPLE', 'kind must be EVAL_SAMPLE');
  requireField(errors, sample.dataset_version === EVAL_DATASET_VERSION, 'dataset_version must be v1');
  requireField(errors, sample.persisted === false, 'persisted must be false');
  requireField(errors, sample.synthetic === true, 'synthetic must be true');
  requireField(errors, sample.sample_id.startsWith('EVAL_V1_'), 'sample_id must use EVAL_V1_ prefix');
  requireField(errors, sample.profile_id.trim().length > 0, 'profile_id is required');
  requireField(errors, sourceTypes.has(sample.source_type), 'source_type is invalid');
  requireField(errors, routePurposes.has(sample.route_purpose), 'route_purpose is invalid');
  requireField(errors, sample.raw_input.trim().length > 0, 'raw_input is required');
  requireField(errors, sample.notes.trim().length > 0, 'notes are required');
  requireNonEmpty(errors, sample.expected_risks, 'expected_risks');
  requireNonEmpty(errors, sample.expected_actions, 'expected_actions');
  requireNonEmpty(errors, sample.required_evidence, 'required_evidence');
  requireNonEmpty(errors, sample.forbidden_errors, 'forbidden_errors');
  requireNonEmpty(errors, sample.fatal_error_tags, 'fatal_error_tags');
  requireNonEmpty(errors, sample.entity_names, 'entity_names');

  for (const tag of sample.fatal_error_tags) {
    requireField(errors, fatalTags.has(tag), `unknown fatal_error_tag: ${tag}`);
  }
  for (const entityName of sample.entity_names) {
    requireField(
      errors,
      entityName.startsWith('EVAL_SAMPLE_') || entityName.startsWith('EVAL_V1_'),
      `entity name must use eval prefix: ${entityName}`,
    );
  }
  for (const evidence of sample.required_evidence) {
    requireField(errors, sample.raw_input.includes(evidence), `required evidence is not in raw_input: ${evidence}`);
    requireField(errors, evidence !== sample.raw_input, 'required evidence must be a substring');
  }

  const serialized = JSON.stringify(sample);
  requireField(errors, !/\b1[3-9]\d{9}\b/.test(serialized), 'real-looking mobile number is forbidden');
  requireField(
    errors,
    !/\b(?:wxid_[A-Za-z0-9_-]{6,}|WECHAT_REAL_ID_[A-Za-z0-9_-]+)\b/.test(serialized),
    'real-looking wechat id is forbidden',
  );

  return {
    valid: errors.length === 0,
    errors,
  };
}

function requireNonEmpty(errors: string[], values: readonly unknown[], field: string): void {
  requireField(errors, values.length > 0, `${field} must not be empty`);
}

function requireField(errors: string[], condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}
