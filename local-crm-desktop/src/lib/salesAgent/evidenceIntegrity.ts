export type EvidenceFactType = 'customer' | 'account' | 'interaction' | 'follow_up' | 'visit' | 'task' | 'memory' | 'capture';

export interface EvidenceFactRelation {
  readonly evidence_id: string;
  readonly fact_type: EvidenceFactType;
  readonly fact_id: string;
}

export interface EvidenceIntegrityResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly relations: readonly EvidenceFactRelation[];
}

/**
 * Referential-integrity contract for runtime projections.
 * An evidence record may support multiple facts, represented by explicit relation rows.
 * Exact duplicate rows are idempotently collapsed; conflicting fact identities are retained.
 */
export function validateEvidenceRelations(input: {
  readonly fact_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly relations: readonly EvidenceFactRelation[];
}): EvidenceIntegrityResult {
  const errors: string[] = [];
  const facts = new Set(input.fact_ids.map(normalize).filter(Boolean));
  const evidence = new Set(input.evidence_ids.map(normalize).filter(Boolean));
  if (facts.size !== input.fact_ids.length) errors.push('fact_id 必须非空且唯一。');
  if (evidence.size !== input.evidence_ids.length) errors.push('evidence_id 必须非空且唯一。');

  const deduped = new Map<string, EvidenceFactRelation>();
  for (const relation of input.relations) {
    const normalized: EvidenceFactRelation = {
      evidence_id: normalize(relation.evidence_id),
      fact_type: relation.fact_type,
      fact_id: normalize(relation.fact_id),
    };
    if (!evidence.has(normalized.evidence_id)) errors.push(`证据引用不存在：${normalized.evidence_id || '（空）'}`);
    if (!facts.has(normalized.fact_id)) errors.push(`事实引用不存在：${normalized.fact_id || '（空）'}`);
    deduped.set(`${normalized.evidence_id}\u0000${normalized.fact_type}\u0000${normalized.fact_id}`, normalized);
  }

  for (const factId of facts) {
    if (![...deduped.values()].some(relation => relation.fact_id === factId)) errors.push(`事实缺少证据关系：${factId}`);
  }
  for (const evidenceId of evidence) {
    if (![...deduped.values()].some(relation => relation.evidence_id === evidenceId)) errors.push(`证据没有关联事实：${evidenceId}`);
  }
  return { valid: errors.length === 0, errors, relations: [...deduped.values()] };
}

function normalize(value: string): string {
  return value.trim();
}
