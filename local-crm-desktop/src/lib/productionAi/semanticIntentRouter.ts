import type { SemanticIntentResolution } from '../salesAgentTools/agentIntentEnvelope';

export interface SemanticIntentHostCall {
  readonly capability: 'SEMANTIC_INTENT_ROUTING';
  readonly schema: 'semantic_intent_v1';
  readonly instruction: string;
  readonly envelope_id: string;
}

export type SemanticIntentHost = (call: SemanticIntentHostCall, signal?: AbortSignal) => Promise<unknown>;

const INTENTS = [
  'CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'NEXT_ACTION_RECOMMENDATION', 'FOLLOW_UP_DRAFT',
  'INTERACTION_SUMMARY', 'COMPLEX_CUSTOMER_COMPARE', 'IMAGE_CAPTURE_ANALYSIS',
  'CLARIFICATION_REQUIRED', 'UNSUPPORTED',
] as const;

/** Closed, non-actionable semantic routing adapter. It cannot return tools, SQL, writes or proposals. */
export function createSemanticIntentRouter(host: SemanticIntentHost) {
  return async (instruction: string, envelopeId: string, signal?: AbortSignal): Promise<SemanticIntentResolution> => {
    const call = { capability: 'SEMANTIC_INTENT_ROUTING' as const, schema: 'semantic_intent_v1' as const, instruction, envelope_id: envelopeId };
    const raw = signal ? await host(call, signal) : await host(call);
    return validateSemanticIntentResponse(raw);
  };
}

export function validateSemanticIntentResponse(raw: unknown): SemanticIntentResolution {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('semantic_intent_v1 must be an object');
  const value = raw as Record<string, unknown>;
  const keys = ['intent', 'confidence', 'customer_reference', 'required_capability', 'clarification_question', 'extracted_nonwrite_slots'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) {
    throw new Error('semantic_intent_v1 closed schema rejected');
  }
  if (!INTENTS.includes(value.intent as typeof INTENTS[number])) throw new Error('semantic_intent_v1 intent rejected');
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('semantic_intent_v1 confidence rejected');
  if (value.customer_reference !== null && typeof value.customer_reference !== 'string') throw new Error('semantic_intent_v1 customer reference rejected');
  if (!['TEXT_REASONING', 'VISION_ANALYSIS', 'none'].includes(String(value.required_capability))) throw new Error('semantic_intent_v1 capability rejected');
  if (value.clarification_question !== null && typeof value.clarification_question !== 'string') throw new Error('semantic_intent_v1 clarification rejected');
  if (!value.extracted_nonwrite_slots || typeof value.extracted_nonwrite_slots !== 'object' || Array.isArray(value.extracted_nonwrite_slots)) throw new Error('semantic_intent_v1 slots rejected');
  for (const [key, slot] of Object.entries(value.extracted_nonwrite_slots as Record<string, unknown>)) {
    if (!key || typeof slot !== 'string') throw new Error('semantic_intent_v1 slots must be string-only');
  }
  return value as unknown as SemanticIntentResolution;
}
