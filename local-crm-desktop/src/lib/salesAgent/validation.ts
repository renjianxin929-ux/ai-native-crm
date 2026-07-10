import type { ContextSnapshot } from '../context/types';
import type { AIReasoningResult, EvidenceBackedItem, EvidenceBackedJudgment } from './types';

export interface SalesAgentValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export function validateSalesAgentReasoningResult(
  value: unknown,
  context: ContextSnapshot,
  expectedMetadata?: {
    profile_id: string;
    provider_id: string;
    provider_kind: import('./types').SalesAgentProviderKind;
    model_id: string;
    execution_mode: import('./types').SalesAgentProviderExecutionMode;
    generated_at: string;
  },
): SalesAgentValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['result must be an object'] };
  if (value.kind !== 'AI_SALES_AGENT_REASONING_RESULT') errors.push('kind must be AI_SALES_AGENT_REASONING_RESULT');
  if (value.version !== 'v1') errors.push('version must be v1');
  if (value.requires_human_review !== true) errors.push('human review must be required');
  if (value.executable !== false) errors.push('result must be non-executable');
  if (value.writes_crm !== false) errors.push('result must not write CRM data');
  validateMetadata(value.reasoning_metadata, context, expectedMetadata, errors);

  validateJudgment(value.customer_summary, 'customer_summary', errors, item => typeof item === 'string' && item.trim().length > 0);
  validateJudgment(value.customer_stage, 'customer_stage', errors, item => typeof item === 'string' && item.trim().length > 0);
  validateJudgment(value.confidence, 'confidence', errors, item => typeof item === 'number' && item >= 0 && item <= 1);
  for (const field of ['opportunities', 'risks', 'next_actions'] as const) validateItems(value[field], field, errors);

  if (!Array.isArray(value.evidence)) errors.push('evidence must be an array');
  else value.evidence.forEach((item, index) => {
    if (!isRecord(item) || !hasText(item.evidence_id) || !isFactType(item.fact_type) || !hasText(item.fact_id) || !Array.isArray(item.supports) || item.supports.length === 0 || !item.supports.every(hasText)) {
      errors.push(`evidence[${index}] is invalid`);
    }
  });
  if (!Array.isArray(value.decision_basis)) errors.push('decision_basis must be an array');
  else value.decision_basis.forEach((item, index) => {
    if (!isRecord(item) || !hasText(item.claim_path) || !isEvidenceIds(item.evidence_ids)) errors.push(`decision_basis[${index}] is invalid`);
  });

  if (errors.length === 0) validateEvidence(value as unknown as AIReasoningResult, context, errors);
  return { valid: errors.length === 0, errors };
}

function validateEvidence(result: AIReasoningResult, context: ContextSnapshot, errors: string[]): void {
  const factIndex = buildContextFactIndex(context, errors);
  const known = new Set(factIndex.keys());
  const declared = new Set(result.evidence.map(item => item.evidence_id));
  const basis = new Map(result.decision_basis.map(item => [item.claim_path, item.evidence_ids]));
  const groups: readonly (readonly [string, readonly string[]])[] = [
    ['customer_summary', result.customer_summary.evidence_ids],
    ['customer_stage', result.customer_stage.evidence_ids],
    ['confidence', result.confidence.evidence_ids],
    ...result.opportunities.map(item => [`opportunities.${item.id}`, item.evidence_ids] as const),
    ...result.risks.map(item => [`risks.${item.id}`, item.evidence_ids] as const),
    ...result.next_actions.map(item => [`next_actions.${item.id}`, item.evidence_ids] as const),
  ];
  groups.forEach(([field, ids]) => {
    if (ids.length === 0) errors.push(`${field} requires evidence`);
    const basisIds = basis.get(field);
    if (!basisIds || !sameIds(ids, basisIds)) errors.push(`${field} has no matching decision basis`);
    ids.forEach(id => {
      if (!known.has(id)) errors.push(`${field} references unknown evidence id: ${id}`);
      if (!declared.has(id)) errors.push(`${field} references undeclared evidence id: ${id}`);
    });
  });
  result.evidence.forEach(item => {
    if (!known.has(item.evidence_id)) errors.push(`evidence contains unknown evidence id: ${item.evidence_id}`);
    const fact = factIndex.get(item.evidence_id);
    if (fact && (fact.fact_type !== item.fact_type || fact.fact_id !== item.fact_id)) {
      errors.push(`evidence ${item.evidence_id} does not trace to ${item.fact_type}:${item.fact_id}`);
    }
    item.supports.forEach(claim => {
      const claimIds = basis.get(claim);
      if (!claimIds?.includes(item.evidence_id)) errors.push(`evidence ${item.evidence_id} has untraceable support claim: ${claim}`);
    });
  });
  result.decision_basis.forEach(item => {
    if (!groups.some(([field]) => field === item.claim_path)) errors.push(`decision_basis has unknown claim path: ${item.claim_path}`);
  });
}

function buildContextFactIndex(context: ContextSnapshot, errors: string[]): Map<string, { fact_type: 'customer' | 'account' | 'interaction'; fact_id: string }> {
  const index = new Map<string, { fact_type: 'customer' | 'account' | 'interaction'; fact_id: string }>();
  const add = (evidenceId: string, fact_type: 'customer' | 'account' | 'interaction', fact_id: string) => {
    const existing = index.get(evidenceId);
    if (existing && (existing.fact_type !== fact_type || existing.fact_id !== fact_id)) errors.push(`evidence id maps to multiple facts: ${evidenceId}`);
    else index.set(evidenceId, { fact_type, fact_id });
  };
  context.customers.forEach(fact => fact.evidenceIds.forEach(id => add(id, 'customer', fact.customerId)));
  context.accounts.forEach(fact => fact.evidenceIds.forEach(id => add(id, 'account', fact.accountId)));
  context.recentInteractions.forEach(fact => fact.evidenceIds.forEach(id => add(id, 'interaction', fact.interactionId)));
  context.evidenceIdentifiers.forEach(id => { if (!index.has(id)) errors.push(`context evidence is not traceable to a concrete fact: ${id}`); });
  return index;
}

function validateMetadata(
  value: unknown,
  context: ContextSnapshot,
  expected: { profile_id: string; provider_id: string; provider_kind: import('./types').SalesAgentProviderKind; model_id: string; execution_mode: import('./types').SalesAgentProviderExecutionMode; generated_at: string } | undefined,
  errors: string[],
): void {
  if (!isRecord(value)) { errors.push('reasoning_metadata is invalid'); return; }
  for (const field of ['profile_id', 'provider_id', 'model_id', 'generated_at', 'context_snapshot_id'] as const) {
    if (!hasText(value[field])) errors.push(`reasoning_metadata.${field} is required`);
  }
  if (!isFactProviderKind(value.provider_kind)) errors.push('reasoning_metadata.provider_kind is invalid');
  if (!isExecutionMode(value.execution_mode)) errors.push('reasoning_metadata.execution_mode is invalid');
  if (value.context_snapshot_id !== context.snapshotId) errors.push('reasoning metadata context snapshot mismatch');
  if (typeof value.generated_at === 'string' && !Number.isFinite(Date.parse(value.generated_at))) errors.push('reasoning metadata generation timestamp is invalid');
  if (expected) Object.entries(expected).forEach(([field, expectedValue]) => {
    if (value[field] !== expectedValue) errors.push(`reasoning metadata ${field} mismatch`);
  });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id));
}

function validateJudgment<T>(value: unknown, field: string, errors: string[], validValue: (value: unknown) => boolean): asserts value is EvidenceBackedJudgment<T> {
  if (!isRecord(value) || !validValue(value.value) || !isEvidenceIds(value.evidence_ids)) errors.push(`${field} is invalid`);
}

function validateItems(value: unknown, field: string, errors: string[]): asserts value is readonly EvidenceBackedItem[] {
  if (!Array.isArray(value)) { errors.push(`${field} must be an array`); return; }
  value.forEach((item, index) => {
    if (!isRecord(item) || !hasText(item.id) || !hasText(item.summary) || !isEvidenceIds(item.evidence_ids)) {
      errors.push(`${field}[${index}] is invalid`);
    }
  });
}

function isEvidenceIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(hasText);
}
function hasText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isFactType(value: unknown): value is 'customer' | 'account' | 'interaction' { return value === 'customer' || value === 'account' || value === 'interaction'; }
function isFactProviderKind(value: unknown): value is import('./types').SalesAgentProviderKind { return value === 'MOCK' || value === 'OPENAI_COMPATIBLE' || value === 'DEEPSEEK_COMPATIBLE' || value === 'LOCAL_MODEL' || value === 'STAGE2_COMPATIBILITY'; }
function isExecutionMode(value: unknown): value is import('./types').SalesAgentProviderExecutionMode { return value === 'MOCK' || value === 'SANDBOX' || value === 'LIVE'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
