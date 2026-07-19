import type { ModelContextEnvelope, ModelEvidenceRef } from './modelContextEnvelope';
import type { ValidatedModelOutput } from './modelOutputSchemas';

export type GroundedClaimType = 'crm_fact' | 'model_inference' | 'recommendation' | 'draft_content';
export type GroundingStatus = 'VERIFIED' | 'SUPPORTED_INFERENCE' | 'UNSUPPORTED_INFERENCE' | 'INVALID';

export interface GroundedClaim {
  readonly claim_id: string;
  readonly claim_type: GroundedClaimType;
  readonly text: string;
  readonly customer_id: string | null;
  readonly evidence_refs: readonly string[];
  readonly grounding_status: GroundingStatus;
  readonly unsupported_assumptions: readonly string[];
  readonly proposal_eligible: boolean;
}

export interface ValidatedGroundedResult {
  readonly schema: ValidatedModelOutput['schema'];
  readonly claims: readonly GroundedClaim[];
  readonly valid: boolean;
  readonly blocked: boolean;
  readonly errors: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly proposal_eligible: boolean;
}

export interface EvidenceGroundingResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly grounded_refs: readonly string[];
  readonly speculative_refs: readonly string[];
}

function sameOwnership(left: ModelEvidenceRef, right: ModelEvidenceRef): boolean {
  return left.integrity === right.integrity
    && left.customer_id === right.customer_id
    && left.source_type === right.source_type
    && left.source_record_id === right.source_record_id;
}

/** Validate existence, unique ownership and customer scope. No evidence is ever synthesized here. */
export function validateEvidenceGrounding(input: {
  readonly envelope: ModelContextEnvelope;
  readonly cited_refs: readonly string[];
  readonly allowed_customer_ids: readonly string[];
  readonly evidence_required?: boolean;
}): EvidenceGroundingResult {
  const errors: string[] = [];
  const byId = new Map<string, ModelEvidenceRef>();
  const collisions = new Set<string>();
  for (const item of input.envelope.evidence_map) {
    const existing = byId.get(item.evidence_id);
    if (existing && !sameOwnership(existing, item)) collisions.add(item.evidence_id);
    else byId.set(item.evidence_id, item);
  }
  collisions.forEach(id => errors.push(`evidence ownership collision: ${id}`));

  if (input.evidence_required !== false && input.cited_refs.length === 0) {
    errors.push('model output did not cite required evidence');
  }

  const grounded: string[] = [];
  const speculative: string[] = [];
  const seen = new Set<string>();
  for (const rawRef of input.cited_refs) {
    const ref = rawRef.trim();
    if (!ref) { errors.push('empty evidence reference'); continue; }
    if (seen.has(ref)) { errors.push(`duplicate evidence reference: ${ref}`); continue; }
    seen.add(ref);
    const evidence = byId.get(ref);
    if (!evidence) {
      errors.push(`unknown or invented evidence id: ${ref}`);
      speculative.push(ref);
      continue;
    }
    if (collisions.has(ref)) continue;
    if (evidence.customer_id === null || !input.allowed_customer_ids.includes(evidence.customer_id)) {
      errors.push(`cross-customer evidence rejected: ${ref}`);
      continue;
    }
    grounded.push(ref);
  }

  const selectedCustomers = input.envelope.selected_crm_facts
    .map(fact => typeof fact.customer_id === 'string' ? fact.customer_id : null)
    .filter((id): id is string => id !== null);
  const selectedFactAllowlist = input.envelope.intent === 'COMPLEX_CUSTOMER_COMPARE'
    ? input.envelope.customer_allowlist
    : input.allowed_customer_ids;
  if (selectedCustomers.some(id => !selectedFactAllowlist.includes(id))) errors.push('selected CRM fact is outside customer allowlist');
  if (input.envelope.intent !== 'COMPLEX_CUSTOMER_COMPARE' && new Set(selectedCustomers).size > 1) errors.push('single-customer envelope contains multiple customers');

  return { valid: errors.length === 0, errors, grounded_refs: grounded, speculative_refs: speculative };
}

export function markUngroundedAsSpeculation(text: string, hasEvidence: boolean): string {
  return hasEvidence ? text : `【模型推测 / 待确认】${text}`;
}

type ClaimDraft = Omit<GroundedClaim, 'grounding_status' | 'proposal_eligible'>;

/** Deterministically project every business claim from a closed model schema. */
export function extractClaims(output: ValidatedModelOutput, scopedCustomerId: string | null): readonly ClaimDraft[] {
  const claim = (
    id: string,
    claim_type: GroundedClaimType,
    text: string,
    evidence_refs: readonly string[],
    customer_id: string | null = scopedCustomerId,
    unsupported_assumptions: readonly string[] = [],
  ): ClaimDraft => ({ claim_id: `${output.schema}:${id}`, claim_type, text, customer_id, evidence_refs, unsupported_assumptions });

  if (output.schema === 'customer_summary_v1') {
    const v = output.value;
    return [
      claim('understanding', 'crm_fact', v.customer_understanding, v.evidence_refs),
      claim('recent_changes', 'crm_fact', v.recent_changes, v.evidence_refs),
      ...v.risks.map((text, index) => claim(`risk:${index}`, 'model_inference', text, v.evidence_refs)),
      ...v.opportunities.map((text, index) => claim(`opportunity:${index}`, 'model_inference', text, v.evidence_refs)),
      ...v.recommended_next_steps.map((text, index) => claim(`next:${index}`, 'recommendation', text, v.evidence_refs)),
      ...v.speculative_claims.map((text, index) => claim(`speculation:${index}`, 'model_inference', text, [], scopedCustomerId, [text])),
    ];
  }
  if (output.schema === 'risk_analysis_v1') {
    const v = output.value;
    return [
      claim('reasoning', 'model_inference', v.reasoning_summary, v.evidence_refs),
      ...v.risk_items.map((item, index) => claim(`risk:${item.id || index}`, item.inference_type, item.summary, item.evidence_refs)),
      ...v.mitigation.map((text, index) => claim(`mitigation:${index}`, 'recommendation', text, v.evidence_refs)),
      ...v.uncertainty.map((text, index) => claim(`uncertainty:${index}`, 'model_inference', text, [], scopedCustomerId, [text])),
    ];
  }
  if (output.schema === 'next_action_v1') {
    const v = output.value;
    return [
      claim('reasoning', 'model_inference', v.reasoning_summary, v.evidence_refs),
      ...v.recommended_next_steps.map((text, index) => claim(`next:${index}`, 'recommendation', text, v.evidence_refs)),
      ...v.uncertainty.map((text, index) => claim(`uncertainty:${index}`, 'model_inference', text, [], scopedCustomerId, [text])),
    ];
  }
  if (output.schema === 'interaction_summary_v1') {
    const v = output.value;
    return [
      claim('summary', 'crm_fact', v.interaction_summary, v.evidence_refs),
      ...v.key_points.map((text, index) => claim(`key:${index}`, 'crm_fact', text, v.evidence_refs)),
      ...v.uncertainty.map((text, index) => claim(`uncertainty:${index}`, 'model_inference', text, [], scopedCustomerId, [text])),
    ];
  }
  if (output.schema === 'follow_up_draft_v1') {
    const v = output.value;
    return [
      claim('objective', 'model_inference', v.objective, v.evidence_refs),
      claim('draft', 'draft_content', v.draft_text, v.evidence_refs, scopedCustomerId, v.unsupported_assumptions),
      ...v.unsupported_assumptions.map((text, index) => claim(`assumption:${index}`, 'model_inference', text, [], scopedCustomerId, [text])),
    ];
  }
  if (output.schema === 'complex_customer_compare_v1') {
    const v = output.value;
    return [
      claim('summary', 'model_inference', v.comparison_summary, v.evidence_refs, null),
      ...v.ranked_customers.map((item, index) => claim(`rank:${index}`, 'model_inference', `${item.rank}. ${item.customer_id}: ${item.rationale}`, item.evidence_refs, item.customer_id)),
      ...v.uncertainty.map((text, index) => claim(`uncertainty:${index}`, 'model_inference', text, [], null, [text])),
    ];
  }
  return output.value.extracted_facts.map((fact, index) => claim(
    `vision:${fact.fact_id || index}`, 'crm_fact', fact.content, [fact.source_reference], scopedCustomerId,
  ));
}

/** Validate claims independently and fail the whole model result when any claim is invalid. */
export function validateGroundedClaims(input: {
  readonly output: ValidatedModelOutput;
  readonly envelope: ModelContextEnvelope;
  readonly scoped_customer_id: string | null;
  readonly allowed_customer_ids: readonly string[];
  readonly host_bound_vision_source?: string;
}): ValidatedGroundedResult {
  const drafts = extractClaims(input.output, input.scoped_customer_id);
  const errors: string[] = [];
  const claims = drafts.map((draft): GroundedClaim => {
    let grounding_status: GroundingStatus;
    let claimErrors: readonly string[] = [];
    if (input.output.schema === 'image_capture_analysis_v1') {
      const validSource = Boolean(input.host_bound_vision_source)
        && draft.evidence_refs.length === 1
        && draft.evidence_refs[0] === input.host_bound_vision_source;
      grounding_status = validSource ? 'VERIFIED' : 'INVALID';
      if (!validSource) claimErrors = [`vision source ownership mismatch: ${draft.claim_id}`];
    } else if (draft.evidence_refs.length === 0) {
      grounding_status = draft.claim_type === 'crm_fact' ? 'INVALID' : 'UNSUPPORTED_INFERENCE';
      if (draft.claim_type === 'crm_fact') claimErrors = [`CRM fact requires verified evidence: ${draft.claim_id}`];
    } else {
      const grounding = validateEvidenceGrounding({
        envelope: input.envelope,
        cited_refs: draft.evidence_refs,
        allowed_customer_ids: draft.customer_id ? [draft.customer_id] : input.allowed_customer_ids,
        evidence_required: true,
      });
      claimErrors = grounding.errors.map(error => `${draft.claim_id}: ${error}`);
      grounding_status = grounding.valid
        ? draft.claim_type === 'crm_fact' ? 'VERIFIED' : 'SUPPORTED_INFERENCE'
        : 'INVALID';
    }
    errors.push(...claimErrors);
    const proposal_eligible = grounding_status !== 'INVALID'
      && grounding_status !== 'UNSUPPORTED_INFERENCE'
      && draft.unsupported_assumptions.length === 0;
    return { ...draft, grounding_status, proposal_eligible };
  });
  const invalid = claims.some(item => item.grounding_status === 'INVALID');
  return {
    schema: input.output.schema,
    claims,
    valid: !invalid,
    blocked: invalid,
    errors: [...new Set(errors)],
    evidence_refs: [...new Set(claims.flatMap(item => item.grounding_status === 'INVALID' ? [] : item.evidence_refs))],
    proposal_eligible: !invalid && claims.every(item => item.proposal_eligible),
  };
}
