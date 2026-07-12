import { SALES_AGENT_TOOL_REGISTRY, type SalesAgentToolId } from './registry';
import { AGENT_WRITE_TOOL_IDS, type AgentWriteToolId } from './confirmedWrite';

export const SALES_AGENT_INTENTS = [
  'CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'CUSTOMER_OPPORTUNITY_ANALYSIS',
  'CUSTOMER_TIMELINE_REVIEW', 'NEXT_ACTION_PREPARATION', 'FOLLOW_UP_DRAFT',
  'GLOBAL_PRIORITY_REVIEW', 'CREATE_FOLLOW_UP_REQUEST', 'CREATE_VISIT_REQUEST',
  'CREATE_TASK_REQUEST', 'UPDATE_TASK_REQUEST', 'UPDATE_CUSTOMER_REQUEST',
  'UPDATE_CONTACT_REQUEST', 'MULTIMODAL_CAPTURE_REVIEW', 'SAFE_FALLBACK',
] as const;
export type SemanticSalesAgentIntent = typeof SALES_AGENT_INTENTS[number];

export interface SemanticPlanStep {
  readonly tool_id: SalesAgentToolId | AgentWriteToolId;
  readonly customer_id: string;
  readonly access: 'read' | 'write';
  readonly requires_confirmation: boolean;
  readonly reason: string;
}
export interface SemanticPlanProposal {
  readonly intent: SemanticSalesAgentIntent;
  readonly customer_id: string;
  readonly confidence: number;
  readonly steps: readonly SemanticPlanStep[];
}
export interface ValidatedSemanticPlan extends SemanticPlanProposal {
  readonly provider_kind: 'DEEPSEEK_COMPATIBLE' | 'DETERMINISTIC_FALLBACK';
  readonly execution_mode: 'live_model' | 'deterministic_fallback';
  readonly executable: false;
  readonly writes_crm: false;
}

/** Validates untrusted structured model output before any registered tool is considered. */
export function validateSemanticPlan(value: unknown, expectedCustomerId: string): ValidatedSemanticPlan {
  if (!isRecord(value) || !SALES_AGENT_INTENTS.includes(value.intent as SemanticSalesAgentIntent)) throw new Error('Unknown Sales Agent intent.');
  if (value.customer_id !== expectedCustomerId || !expectedCustomerId.trim()) throw new Error('Sales Agent plan scope mismatch.');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('Sales Agent plan confidence is invalid.');
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 5) throw new Error('Sales Agent plan must contain one to five steps.');
  const steps = value.steps.map((step): SemanticPlanStep => {
    if (!isRecord(step) || typeof step.tool_id !== 'string' || (!(step.tool_id in SALES_AGENT_TOOL_REGISTRY) && !AGENT_WRITE_TOOL_IDS.includes(step.tool_id as AgentWriteToolId))) throw new Error('Sales Agent plan contains an unknown tool.');
    if (step.customer_id !== expectedCustomerId || typeof step.reason !== 'string' || !step.reason.trim()) throw new Error('Sales Agent plan has unsafe arguments.');
    const readTool = SALES_AGENT_TOOL_REGISTRY[step.tool_id as SalesAgentToolId];
    const access: 'read' | 'write' = readTool ? readTool.access : 'write'; const requiresConfirmation: boolean = readTool ? readTool.requires_confirmation : true;
    if (step.access !== access || step.requires_confirmation !== requiresConfirmation) throw new Error('Sales Agent plan tool classification mismatch.');
    return { tool_id: step.tool_id as SalesAgentToolId | AgentWriteToolId, customer_id: expectedCustomerId, access, requires_confirmation: requiresConfirmation, reason: step.reason.trim() };
  });
  return { intent: value.intent as SemanticSalesAgentIntent, customer_id: expectedCustomerId, confidence: value.confidence, steps, provider_kind: value.provider_kind === 'DEEPSEEK_COMPATIBLE' ? 'DEEPSEEK_COMPATIBLE' : 'DETERMINISTIC_FALLBACK', execution_mode: value.provider_kind === 'DEEPSEEK_COMPATIBLE' ? 'live_model' : 'deterministic_fallback', executable: false, writes_crm: false };
}

export function deterministicSemanticFallback(customerId: string): ValidatedSemanticPlan {
  return validateSemanticPlan({ intent: 'SAFE_FALLBACK', customer_id: customerId, confidence: 0, provider_kind: 'DETERMINISTIC_FALLBACK', steps: [{ tool_id: 'get_customer_context', customer_id: customerId, access: 'read', requires_confirmation: false, reason: 'Use bounded context while live reasoning is unavailable.' }] }, customerId);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
