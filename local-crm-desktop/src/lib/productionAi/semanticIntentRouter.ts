import type { SemanticIntentResolution } from '../salesAgentTools/agentIntentEnvelope';

export interface SemanticIntentRoutingContext {
  readonly has_selected_customer: boolean;
  readonly has_previous_reasoning: boolean;
  readonly has_previous_review: boolean;
}

export interface SemanticIntentHostCall {
  readonly capability: 'SEMANTIC_INTENT_ROUTING';
  readonly schema: 'semantic_intent_v1';
  readonly instruction: string;
  readonly envelope_id: string;
  readonly has_selected_customer: boolean;
  readonly has_previous_reasoning: boolean;
  readonly has_previous_review: boolean;
}

export type SemanticIntentHost = (call: SemanticIntentHostCall, signal?: AbortSignal) => Promise<unknown>;

const INTENTS = [
  'CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'NEXT_ACTION_RECOMMENDATION', 'FOLLOW_UP_DRAFT',
  'INTERACTION_SUMMARY', 'COMPLEX_CUSTOMER_COMPARE', 'IMAGE_CAPTURE_ANALYSIS',
  'CUSTOMER_PRIORITY_RANKING', 'CUSTOMER_TIMELINE_REVIEW', 'BATTLE_CARD_ANALYSIS',
  'ACTION_FROM_PREVIOUS_RESULT',
  'CLARIFICATION_REQUIRED', 'UNSUPPORTED',
] as const;

/** Closed, non-actionable semantic routing adapter. It cannot return tools, SQL, writes or proposals. */
export function createSemanticIntentRouter(host: SemanticIntentHost) {
  return async (
    instruction: string,
    envelopeId: string,
    signal?: AbortSignal,
    routingContext?: SemanticIntentRoutingContext,
  ): Promise<SemanticIntentResolution> => {
    const call: SemanticIntentHostCall = {
      capability: 'SEMANTIC_INTENT_ROUTING',
      schema: 'semantic_intent_v1',
      instruction,
      envelope_id: envelopeId,
      has_selected_customer: routingContext?.has_selected_customer === true,
      has_previous_reasoning: routingContext?.has_previous_reasoning === true,
      has_previous_review: routingContext?.has_previous_review === true,
    };
    const raw = signal ? await host(call, signal) : await host(call);
    return validateSemanticIntentResponse(raw);
  };
}

export function validateSemanticIntentResponse(raw: unknown): SemanticIntentResolution {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('semantic_intent_v1 must be an object');
  const value = raw as Record<string, unknown>;
  const keys = ['intent', 'filters', 'entities', 'scope', 'missing_fields', 'confidence', 'clarification_question'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) {
    throw new Error('semantic_intent_v1 closed schema rejected');
  }
  if (!INTENTS.includes(value.intent as typeof INTENTS[number])) throw new Error('semantic_intent_v1 intent rejected');
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('semantic_intent_v1 confidence rejected');
  if (!value.filters || typeof value.filters !== 'object' || Array.isArray(value.filters) || Object.entries(value.filters as Record<string, unknown>).some(([key, slot]) => !key || typeof slot !== 'string')) throw new Error('semantic_intent_v1 filters rejected');
  if (!Array.isArray(value.entities) || value.entities.some(entity => !entity || typeof entity !== 'object' || Array.isArray(entity) || Object.keys(entity as object).some(key => !['type', 'value'].includes(key)) || typeof (entity as { type?: unknown }).type !== 'string' || typeof (entity as { value?: unknown }).value !== 'string')) throw new Error('semantic_intent_v1 entities rejected');
  if (value.scope !== null && typeof value.scope !== 'string') throw new Error('semantic_intent_v1 scope rejected');
  if (!Array.isArray(value.missing_fields) || value.missing_fields.some(field => typeof field !== 'string')) throw new Error('semantic_intent_v1 missing fields rejected');
  if (value.clarification_question !== null && typeof value.clarification_question !== 'string') throw new Error('semantic_intent_v1 clarification rejected');
  return value as unknown as SemanticIntentResolution;
}
