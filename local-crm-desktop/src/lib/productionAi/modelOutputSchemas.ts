/** Closed production JSON schemas. Wrong-target and partial output are rejected, never normalized. */

export interface CustomerSummaryModelOutput {
  readonly customer_understanding: string;
  readonly recent_changes: string;
  readonly risks: readonly string[];
  readonly opportunities: readonly string[];
  readonly recommended_next_steps: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly speculative_claims: readonly string[];
  readonly requires_human_review: true;
}

export interface FollowUpDraftModelOutput {
  readonly draft_text: string;
  readonly tone: string;
  readonly objective: string;
  readonly evidence_refs: readonly string[];
  readonly unsupported_assumptions: readonly string[];
  readonly requires_human_review: true;
}

export interface RiskAnalysisModelOutput {
  readonly risk_items: readonly {
    readonly id: string;
    readonly summary: string;
    readonly severity: 'low' | 'medium' | 'high';
    readonly inference_type: 'crm_fact' | 'model_inference';
    readonly evidence_refs: readonly string[];
  }[];
  readonly severity: 'low' | 'medium' | 'high';
  readonly reasoning_summary: string;
  readonly evidence_refs: readonly string[];
  readonly mitigation: readonly string[];
  readonly uncertainty: readonly string[];
  readonly requires_human_review: true;
}

export interface NextActionModelOutput {
  readonly recommended_next_steps: readonly string[];
  readonly reasoning_summary: string;
  readonly evidence_refs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly requires_human_review: true;
}

export interface InteractionSummaryModelOutput {
  readonly interaction_summary: string;
  readonly key_points: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly requires_human_review: true;
}

export interface ImageCaptureAnalysisModelOutput {
  readonly extracted_facts: readonly {
    readonly fact_id: string;
    readonly fact_type: string;
    readonly content: string;
    readonly source_reference: string;
    readonly confidence: number;
  }[];
  readonly source_reference: string;
  readonly confidence: number;
  readonly evidence_regions: readonly string[];
  readonly unsupported_assumptions: readonly string[];
  readonly requires_fact_review: true;
}

export interface ComplexCustomerCompareModelOutput {
  readonly comparison_summary: string;
  readonly ranked_customers: readonly {
    readonly customer_id: string;
    readonly rank: number;
    readonly rationale: string;
    readonly evidence_refs: readonly string[];
  }[];
  readonly evidence_refs: readonly string[];
  readonly uncertainty: readonly string[];
  readonly requires_human_review: true;
}

export type ValidatedModelOutput =
  | { readonly schema: 'customer_summary_v1'; readonly value: CustomerSummaryModelOutput }
  | { readonly schema: 'follow_up_draft_v1'; readonly value: FollowUpDraftModelOutput }
  | { readonly schema: 'risk_analysis_v1'; readonly value: RiskAnalysisModelOutput }
  | { readonly schema: 'next_action_v1'; readonly value: NextActionModelOutput }
  | { readonly schema: 'interaction_summary_v1'; readonly value: InteractionSummaryModelOutput }
  | { readonly schema: 'image_capture_analysis_v1'; readonly value: ImageCaptureAnalysisModelOutput }
  | { readonly schema: 'complex_customer_compare_v1'; readonly value: ComplexCustomerCompareModelOutput };

export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly output: ValidatedModelOutput | null;
}

const TEXT_MAX = 4000;
const SHORT_TEXT_MAX = 240;
const ARRAY_MAX = 20;
const EVIDENCE_MAX = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], errors: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
}

function text(value: unknown, field: string, errors: string[], max = TEXT_MAX): value is string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) {
    errors.push(`${field} must be a non-empty string <= ${max}`);
    return false;
  }
  return true;
}

function stringArray(
  value: unknown,
  field: string,
  errors: string[],
  options: { min?: number; max?: number; itemMax?: number } = {},
): value is string[] {
  const min = options.min ?? 0;
  const max = options.max ?? ARRAY_MAX;
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push(`${field} must contain ${min}-${max} items`);
    return false;
  }
  value.forEach((item, index) => text(item, `${field}[${index}]`, errors, options.itemMax ?? TEXT_MAX));
  return true;
}

function evidenceArray(value: unknown, field: string, errors: string[], min = 1): value is string[] {
  return stringArray(value, field, errors, { min, max: EVIDENCE_MAX, itemMax: SHORT_TEXT_MAX });
}

const UNSAFE_PATTERNS = [
  /\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bINSERT\s+INTO\b/i,
  /Authorization:\s*Bearer/i, /api[_-]?key\s*[:=]/i, /```(?:sql|bash|sh|powershell)/i,
];

function collectStrings(value: unknown, sink: string[]): void {
  if (typeof value === 'string') sink.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, sink));
  else if (isRecord(value)) Object.values(value).forEach(item => collectStrings(item, sink));
}

function finish(schema: ValidatedModelOutput['schema'], raw: Record<string, unknown>, errors: string[]): SchemaValidationResult {
  const strings: string[] = [];
  collectStrings(raw, strings);
  strings.forEach((value, index) => UNSAFE_PATTERNS.forEach(pattern => {
    if (pattern.test(value)) errors.push(`text[${index}] failed safety copy check`);
  }));
  if (errors.length) return { valid: false, errors: [...new Set(errors)], output: null };
  return { valid: true, errors: [], output: { schema, value: raw as never } };
}

export function validateModelOutputSchema(
  schema: ValidatedModelOutput['schema'] | 'none' | 'closed_write_parse_v1' | 'semantic_intent_v1',
  raw: unknown,
): SchemaValidationResult {
  if (schema === 'none' || schema === 'closed_write_parse_v1' || schema === 'semantic_intent_v1') {
    return { valid: false, errors: ['schema does not accept model narrative output'], output: null };
  }
  if (!isRecord(raw)) return { valid: false, errors: ['model output must be a JSON object'], output: null };
  const errors: string[] = [];

  if (schema === 'customer_summary_v1') {
    const keys = ['customer_understanding', 'recent_changes', 'risks', 'opportunities', 'recommended_next_steps', 'evidence_refs', 'uncertainty', 'speculative_claims', 'requires_human_review'];
    exactKeys(raw, keys, keys, errors, '$');
    text(raw.customer_understanding, 'customer_understanding', errors);
    text(raw.recent_changes, 'recent_changes', errors);
    stringArray(raw.risks, 'risks', errors, { max: ARRAY_MAX });
    stringArray(raw.opportunities, 'opportunities', errors, { max: ARRAY_MAX });
    stringArray(raw.recommended_next_steps, 'recommended_next_steps', errors, { min: 1, max: 12 });
    evidenceArray(raw.evidence_refs, 'evidence_refs', errors);
    stringArray(raw.uncertainty, 'uncertainty', errors, { max: 12 });
    stringArray(raw.speculative_claims, 'speculative_claims', errors, { max: 12 });
    if (raw.requires_human_review !== true) errors.push('requires_human_review must be true');
    return finish(schema, raw, errors);
  }

  if (schema === 'follow_up_draft_v1') {
    const keys = ['draft_text', 'tone', 'objective', 'evidence_refs', 'unsupported_assumptions', 'requires_human_review'];
    exactKeys(raw, keys, keys, errors, '$');
    text(raw.draft_text, 'draft_text', errors);
    text(raw.tone, 'tone', errors, SHORT_TEXT_MAX);
    text(raw.objective, 'objective', errors, 500);
    evidenceArray(raw.evidence_refs, 'evidence_refs', errors);
    stringArray(raw.unsupported_assumptions, 'unsupported_assumptions', errors, { max: 12 });
    if (raw.requires_human_review !== true) errors.push('requires_human_review must be true');
    return finish(schema, raw, errors);
  }

  if (schema === 'risk_analysis_v1') {
    const keys = ['risk_items', 'severity', 'reasoning_summary', 'evidence_refs', 'mitigation', 'uncertainty', 'requires_human_review'];
    exactKeys(raw, keys, keys, errors, '$');
    if (!Array.isArray(raw.risk_items) || raw.risk_items.length < 1 || raw.risk_items.length > ARRAY_MAX) errors.push('risk_items must contain 1-20 items');
    else raw.risk_items.forEach((item, index) => {
      if (!isRecord(item)) { errors.push(`risk_items[${index}] must be object`); return; }
      const itemKeys = ['id', 'summary', 'severity', 'inference_type', 'evidence_refs'];
      exactKeys(item, itemKeys, itemKeys, errors, `risk_items[${index}]`);
      text(item.id, `risk_items[${index}].id`, errors, SHORT_TEXT_MAX);
      text(item.summary, `risk_items[${index}].summary`, errors);
      if (!['low', 'medium', 'high'].includes(String(item.severity))) errors.push(`risk_items[${index}].severity invalid`);
      if (!['crm_fact', 'model_inference'].includes(String(item.inference_type))) errors.push(`risk_items[${index}].inference_type invalid`);
      evidenceArray(item.evidence_refs, `risk_items[${index}].evidence_refs`, errors, item.inference_type === 'crm_fact' ? 1 : 0);
    });
    if (!['low', 'medium', 'high'].includes(String(raw.severity))) errors.push('severity invalid');
    text(raw.reasoning_summary, 'reasoning_summary', errors);
    evidenceArray(raw.evidence_refs, 'evidence_refs', errors);
    stringArray(raw.mitigation, 'mitigation', errors, { max: ARRAY_MAX });
    stringArray(raw.uncertainty, 'uncertainty', errors, { max: ARRAY_MAX });
    if (raw.requires_human_review !== true) errors.push('requires_human_review must be true');
    return finish(schema, raw, errors);
  }

  if (schema === 'next_action_v1') {
    const keys = ['recommended_next_steps', 'reasoning_summary', 'evidence_refs', 'uncertainty', 'requires_human_review'];
    exactKeys(raw, keys, keys, errors, '$');
    stringArray(raw.recommended_next_steps, 'recommended_next_steps', errors, { min: 1, max: 12 });
    text(raw.reasoning_summary, 'reasoning_summary', errors);
    evidenceArray(raw.evidence_refs, 'evidence_refs', errors);
    stringArray(raw.uncertainty, 'uncertainty', errors, { max: 12 });
    if (raw.requires_human_review !== true) errors.push('requires_human_review must be true');
    return finish(schema, raw, errors);
  }

  if (schema === 'interaction_summary_v1') {
    const keys = ['interaction_summary', 'key_points', 'evidence_refs', 'uncertainty', 'requires_human_review'];
    exactKeys(raw, keys, keys, errors, '$');
    text(raw.interaction_summary, 'interaction_summary', errors);
    stringArray(raw.key_points, 'key_points', errors, { min: 1, max: ARRAY_MAX });
    evidenceArray(raw.evidence_refs, 'evidence_refs', errors);
    stringArray(raw.uncertainty, 'uncertainty', errors, { max: 12 });
    if (raw.requires_human_review !== true) errors.push('requires_human_review must be true');
    return finish(schema, raw, errors);
  }

  if (schema === 'image_capture_analysis_v1') {
    const keys = ['extracted_facts', 'source_reference', 'confidence', 'evidence_regions', 'unsupported_assumptions', 'requires_fact_review'];
    exactKeys(raw, keys, keys, errors, '$');
    if (!Array.isArray(raw.extracted_facts) || raw.extracted_facts.length < 1 || raw.extracted_facts.length > ARRAY_MAX) errors.push('extracted_facts must contain 1-20 items');
    else raw.extracted_facts.forEach((fact, index) => {
      if (!isRecord(fact)) { errors.push(`extracted_facts[${index}] must be object`); return; }
      const factKeys = ['fact_id', 'fact_type', 'content', 'source_reference', 'confidence'];
      exactKeys(fact, factKeys, factKeys, errors, `extracted_facts[${index}]`);
      text(fact.fact_id, `extracted_facts[${index}].fact_id`, errors, SHORT_TEXT_MAX);
      text(fact.fact_type, `extracted_facts[${index}].fact_type`, errors, SHORT_TEXT_MAX);
      text(fact.content, `extracted_facts[${index}].content`, errors);
      text(fact.source_reference, `extracted_facts[${index}].source_reference`, errors, 500);
      if (typeof fact.confidence !== 'number' || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) errors.push(`extracted_facts[${index}].confidence invalid`);
    });
    text(raw.source_reference, 'source_reference', errors, 500);
    if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) errors.push('confidence invalid');
    stringArray(raw.evidence_regions, 'evidence_regions', errors, { min: 1, max: ARRAY_MAX, itemMax: 500 });
    stringArray(raw.unsupported_assumptions, 'unsupported_assumptions', errors, { max: 12 });
    if (raw.requires_fact_review !== true) errors.push('requires_fact_review must be true');
    return finish(schema, raw, errors);
  }

  const keys = ['comparison_summary', 'ranked_customers', 'evidence_refs', 'uncertainty', 'requires_human_review'];
  exactKeys(raw, keys, keys, errors, '$');
  text(raw.comparison_summary, 'comparison_summary', errors);
  if (!Array.isArray(raw.ranked_customers) || raw.ranked_customers.length < 2 || raw.ranked_customers.length > 5) errors.push('ranked_customers must contain 2-5 items');
  else raw.ranked_customers.forEach((item, index) => {
    if (!isRecord(item)) { errors.push(`ranked_customers[${index}] must be object`); return; }
    const itemKeys = ['customer_id', 'rank', 'rationale', 'evidence_refs'];
    exactKeys(item, itemKeys, itemKeys, errors, `ranked_customers[${index}]`);
    text(item.customer_id, `ranked_customers[${index}].customer_id`, errors, SHORT_TEXT_MAX);
    if (!Number.isInteger(item.rank) || Number(item.rank) < 1 || Number(item.rank) > 5) errors.push(`ranked_customers[${index}].rank invalid`);
    text(item.rationale, `ranked_customers[${index}].rationale`, errors);
    evidenceArray(item.evidence_refs, `ranked_customers[${index}].evidence_refs`, errors);
  });
  evidenceArray(raw.evidence_refs, 'evidence_refs', errors);
  stringArray(raw.uncertainty, 'uncertainty', errors, { max: 12 });
  if (raw.requires_human_review !== true) errors.push('requires_human_review must be true');
  return finish(schema, raw, errors);
}
