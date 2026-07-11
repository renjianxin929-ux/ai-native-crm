import type { VisionFact, VisionFactType } from './types';

const VISION_FACT_TYPES: readonly VisionFactType[] = [
  'observed_object',
  'extracted_text',
  'visible_attribute',
  'document_information',
];

const VISION_FACT_KEYS = new Set(['fact_type', 'content']);

export function validateVisionFacts(value: unknown): value is readonly VisionFact[] {
  if (!Array.isArray(value)) return false;
  return value.every(fact => {
    if (!isRecord(fact)) return false;
    if (Object.keys(fact).some(key => !VISION_FACT_KEYS.has(key))) return false;
    return VISION_FACT_TYPES.includes(fact.fact_type as VisionFactType)
      && typeof fact.content === 'string'
      && fact.content.trim().length > 0;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
