/**
 * PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX
 * Explicit typed routing for every closed Sales Agent intent.
 * Deterministic CRM tools never call the model; model intents never write CRM.
 */

export type CapabilityExecutionMode = 'DETERMINISTIC' | 'REAL_TEXT_MODEL' | 'REAL_MULTIMODAL' | 'HYBRID_PARSER';

export type CapabilityWritePolicy =
  | 'none'
  | 'proposal_then_human_confirm'
  | 'deterministic_repository_only';

export type CapabilityFailurePolicy =
  | 'return_deterministic_result'
  | 'block_without_mock'
  | 'block_multimodal_allow_manual_entry'
  | 'parser_fallback_deterministic';

export type ProductionCapabilityIntent =
  | 'PORTFOLIO_SEARCH'
  | 'ENTITY_RESOLUTION'
  | 'COUNT_PAGINATION'
  | 'DATE_TIMEZONE_PARSE'
  | 'CUSTOMER_FIELD_FILTER'
  | 'TASK_FOLLOWUP_WRITE'
  | 'CANCEL_CONFIRM_REPLAY'
  | 'CRM_DATA_REFRESH'
  | 'EVIDENCE_ID_VALIDATE'
  | 'CUSTOMER_SUMMARY'
  | 'CUSTOMER_RISK_ANALYSIS'
  | 'NEXT_ACTION_RECOMMENDATION'
  | 'FOLLOW_UP_DRAFT'
  | 'EMAIL_OR_MESSAGE_DRAFT'
  | 'INTERACTION_SUMMARY'
  | 'REVIEWED_FACT_REASONING'
  | 'COMPLEX_CUSTOMER_COMPARE'
  | 'IMAGE_CAPTURE_ANALYSIS'
  | 'DOCUMENT_SCREENSHOT_EXTRACT'
  | 'WRITE_INTENT_UNDERSTANDING'
  | 'AMBIGUOUS_DATE_MULTI_ACTION'
  | 'FUZZY_CUSTOMER_REFERENCE'
  | 'SEMANTIC_INTENT_ROUTING'
  | 'CUSTOMER_TIMELINE_REVIEW'
  | 'SAFE_FALLBACK';

export type ModelCapabilityKind = 'none' | 'TEXT_REASONING' | 'VISION_ANALYSIS' | 'STRUCTURED_PARSE' | 'SEMANTIC_INTENT_ROUTING';

export type OutputSchemaId =
  | 'none'
  | 'customer_summary_v1'
  | 'follow_up_draft_v1'
  | 'risk_analysis_v1'
  | 'next_action_v1'
  | 'interaction_summary_v1'
  | 'image_capture_analysis_v1'
  | 'complex_customer_compare_v1'
  | 'closed_write_parse_v1'
  | 'semantic_intent_v1';

export interface CapabilityRoutingEntry {
  readonly intent: ProductionCapabilityIntent;
  readonly execution_mode: CapabilityExecutionMode;
  readonly requires_customer_scope: boolean;
  readonly deterministic_tools: readonly string[];
  readonly model_capability: ModelCapabilityKind;
  readonly requires_real_model: boolean;
  readonly allows_local_fallback: boolean;
  readonly output_schema: OutputSchemaId;
  readonly evidence_required: boolean;
  readonly write_policy: CapabilityWritePolicy;
  readonly failure_policy: CapabilityFailurePolicy;
}

export const PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX: readonly CapabilityRoutingEntry[] = [
  // A — deterministic only
  { intent: 'PORTFOLIO_SEARCH', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['search_customers'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'ENTITY_RESOLUTION', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['search_customers', 'resolve_entity'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'COUNT_PAGINATION', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['search_customers'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'DATE_TIMEZONE_PARSE', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['parse_datetime'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'CUSTOMER_FIELD_FILTER', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['search_customers'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'TASK_FOLLOWUP_WRITE', execution_mode: 'DETERMINISTIC', requires_customer_scope: true, deterministic_tools: ['create_follow_up_record', 'create_task', 'update_next_follow_up_time'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: true, write_policy: 'deterministic_repository_only', failure_policy: 'return_deterministic_result' },
  { intent: 'CANCEL_CONFIRM_REPLAY', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['cancel_proposal', 'confirm_proposal', 'replay'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'deterministic_repository_only', failure_policy: 'return_deterministic_result' },
  { intent: 'CRM_DATA_REFRESH', execution_mode: 'DETERMINISTIC', requires_customer_scope: false, deterministic_tools: ['refresh_snapshot'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'EVIDENCE_ID_VALIDATE', execution_mode: 'DETERMINISTIC', requires_customer_scope: true, deterministic_tools: ['validate_evidence_ids'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: true, write_policy: 'none', failure_policy: 'return_deterministic_result' },
  { intent: 'CUSTOMER_TIMELINE_REVIEW', execution_mode: 'DETERMINISTIC', requires_customer_scope: true, deterministic_tools: ['get_customer', 'get_customer_timeline', 'list_customer_followups', 'list_customer_visits'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: true, write_policy: 'none', failure_policy: 'return_deterministic_result' },

  // B — real text model
  { intent: 'CUSTOMER_SUMMARY', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer', 'get_customer_context', 'get_active_memory', 'get_customer_timeline'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'customer_summary_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'CUSTOMER_RISK_ANALYSIS', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer_context', 'get_customer_timeline', 'get_active_memory', 'get_today_priority'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'risk_analysis_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'NEXT_ACTION_RECOMMENDATION', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer_context', 'get_customer_timeline', 'list_customer_tasks', 'get_active_memory'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'next_action_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'FOLLOW_UP_DRAFT', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer', 'get_customer_timeline', 'get_active_memory', 'get_existing_ai_results'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'follow_up_draft_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'EMAIL_OR_MESSAGE_DRAFT', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer', 'get_customer_timeline', 'get_active_memory'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'follow_up_draft_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'INTERACTION_SUMMARY', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer_timeline', 'get_active_memory'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'interaction_summary_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'REVIEWED_FACT_REASONING', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: true, deterministic_tools: ['get_customer_context', 'get_active_memory'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'customer_summary_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },
  { intent: 'COMPLEX_CUSTOMER_COMPARE', execution_mode: 'REAL_TEXT_MODEL', requires_customer_scope: false, deterministic_tools: ['search_customers'], model_capability: 'TEXT_REASONING', requires_real_model: true, allows_local_fallback: false, output_schema: 'complex_customer_compare_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_without_mock' },

  // C — multimodal
  { intent: 'IMAGE_CAPTURE_ANALYSIS', execution_mode: 'REAL_MULTIMODAL', requires_customer_scope: true, deterministic_tools: [], model_capability: 'VISION_ANALYSIS', requires_real_model: true, allows_local_fallback: false, output_schema: 'image_capture_analysis_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_multimodal_allow_manual_entry' },
  { intent: 'DOCUMENT_SCREENSHOT_EXTRACT', execution_mode: 'REAL_MULTIMODAL', requires_customer_scope: true, deterministic_tools: [], model_capability: 'VISION_ANALYSIS', requires_real_model: true, allows_local_fallback: false, output_schema: 'image_capture_analysis_v1', evidence_required: true, write_policy: 'none', failure_policy: 'block_multimodal_allow_manual_entry' },

  // D — hybrid parser (deterministic first)
  { intent: 'WRITE_INTENT_UNDERSTANDING', execution_mode: 'HYBRID_PARSER', requires_customer_scope: true, deterministic_tools: ['classify_closed_write_intent'], model_capability: 'STRUCTURED_PARSE', requires_real_model: false, allows_local_fallback: true, output_schema: 'closed_write_parse_v1', evidence_required: false, write_policy: 'proposal_then_human_confirm', failure_policy: 'parser_fallback_deterministic' },
  { intent: 'AMBIGUOUS_DATE_MULTI_ACTION', execution_mode: 'HYBRID_PARSER', requires_customer_scope: true, deterministic_tools: ['parse_datetime', 'classify_closed_write_intent'], model_capability: 'STRUCTURED_PARSE', requires_real_model: false, allows_local_fallback: true, output_schema: 'closed_write_parse_v1', evidence_required: false, write_policy: 'proposal_then_human_confirm', failure_policy: 'parser_fallback_deterministic' },
  { intent: 'FUZZY_CUSTOMER_REFERENCE', execution_mode: 'HYBRID_PARSER', requires_customer_scope: false, deterministic_tools: ['search_customers', 'resolve_entity'], model_capability: 'STRUCTURED_PARSE', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: false, write_policy: 'none', failure_policy: 'parser_fallback_deterministic' },
  { intent: 'SEMANTIC_INTENT_ROUTING', execution_mode: 'HYBRID_PARSER', requires_customer_scope: false, deterministic_tools: [], model_capability: 'SEMANTIC_INTENT_ROUTING', requires_real_model: true, allows_local_fallback: false, output_schema: 'semantic_intent_v1', evidence_required: false, write_policy: 'none', failure_policy: 'block_without_mock' },

  // Safe fallback — local only
  { intent: 'SAFE_FALLBACK', execution_mode: 'DETERMINISTIC', requires_customer_scope: true, deterministic_tools: ['get_customer_context', 'get_active_memory', 'get_customer_timeline'], model_capability: 'none', requires_real_model: false, allows_local_fallback: true, output_schema: 'none', evidence_required: true, write_policy: 'none', failure_policy: 'return_deterministic_result' },
] as const;

const BY_INTENT = new Map(PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX.map(entry => [entry.intent, entry]));

/** Map session / operating-layer intent strings onto the formal matrix. */
export function mapSessionIntentToCapability(intent: string): ProductionCapabilityIntent {
  if (BY_INTENT.has(intent as ProductionCapabilityIntent)) {
    return intent as ProductionCapabilityIntent;
  }
  switch (intent) {
    case 'CUSTOMER_SUMMARY': return 'CUSTOMER_SUMMARY';
    case 'CUSTOMER_RISK_ANALYSIS': return 'CUSTOMER_RISK_ANALYSIS';
    case 'CUSTOMER_TIMELINE_REVIEW': return 'CUSTOMER_TIMELINE_REVIEW';
    case 'NEXT_ACTION_PREPARATION': return 'NEXT_ACTION_RECOMMENDATION';
    case 'FOLLOW_UP_DRAFT': return 'FOLLOW_UP_DRAFT';
    case 'INTERACTION_SUMMARY': return 'INTERACTION_SUMMARY';
    case 'COMPLEX_CUSTOMER_COMPARE': return 'COMPLEX_CUSTOMER_COMPARE';
    case 'CREATE_FOLLOW_UP_REQUEST':
    case 'CREATE_TASK_REQUEST':
    case 'UPDATE_CUSTOMER_REQUEST': return 'TASK_FOLLOWUP_WRITE';
    case 'SEARCH_CUSTOMERS': return 'PORTFOLIO_SEARCH';
    case 'CAPTURE_REVIEW': return 'IMAGE_CAPTURE_ANALYSIS';
    case 'CANCEL_PENDING_WRITE':
    case 'CONFIRM_PENDING_WRITE':
    case 'CLEAR_CUSTOMER_SCOPE':
    case 'NEW_CONVERSATION': return 'CANCEL_CONFIRM_REPLAY';
    case 'SAFE_FALLBACK': return 'SAFE_FALLBACK';
    default: return 'SAFE_FALLBACK';
  }
}

export function resolveCapabilityRoute(intent: string): CapabilityRoutingEntry {
  const mapped = mapSessionIntentToCapability(intent);
  const entry = BY_INTENT.get(mapped);
  if (!entry) throw new Error(`Unknown capability intent: ${intent}`);
  return entry;
}

export function listModelRequiredIntents(): readonly ProductionCapabilityIntent[] {
  return PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX.filter(e => e.requires_real_model).map(e => e.intent);
}

export function listDeterministicIntents(): readonly ProductionCapabilityIntent[] {
  return PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX.filter(e => e.execution_mode === 'DETERMINISTIC').map(e => e.intent);
}

export function listMultimodalIntents(): readonly ProductionCapabilityIntent[] {
  return PRODUCTION_AI_CAPABILITY_ROUTING_MATRIX.filter(e => e.execution_mode === 'REAL_MULTIMODAL').map(e => e.intent);
}
