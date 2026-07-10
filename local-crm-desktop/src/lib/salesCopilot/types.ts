import type { ContextSnapshot } from '../context/types';
import type { ReasoningProvider } from '../salesAgent/provider';
import type { AgentTriggerBoundaryResult } from '../salesAgent/triggerSeam';
import type { SalesAgentRuntimeResult } from '../salesAgent/types';

export type SalesCopilotWorkflowKind =
  | 'customer_intelligence'
  | 'sales_priority'
  | 'interaction_intelligence';

interface SalesCopilotRequestBase {
  request_id: string;
  profile_id: string;
  provider: ReasoningProvider;
  clock?: () => string;
}

export type SalesCopilotWorkflowRequest =
  | (SalesCopilotRequestBase & { kind: 'customer_intelligence'; context: ContextSnapshot })
  | (SalesCopilotRequestBase & { kind: 'sales_priority'; contexts: readonly ContextSnapshot[] })
  | (SalesCopilotRequestBase & {
      kind: 'interaction_intelligence';
      context: ContextSnapshot;
      trigger: AgentTriggerBoundaryResult;
      explicitly_activated: true;
    });

export interface SalesCopilotSafetyBoundary {
  read_only: true;
  requires_human_review: true;
  executable: false;
  writes_crm: false;
  creates_task: false;
  sends_message: false;
  persists_result: false;
}

export interface CustomerIntelligenceResult extends SalesCopilotSafetyBoundary {
  kind: 'customer_intelligence';
  runtime: SalesAgentRuntimeResult;
}

export interface SalesPriorityItem extends SalesCopilotSafetyBoundary {
  customer_id: string;
  customer_name: string;
  rank: number;
  priority_level: 'high' | 'medium' | 'normal';
  priority_reason: string;
  priority_reason_evidence_ids: readonly string[];
  opportunities: SalesAgentRuntimeResult['result']['opportunities'];
  risks: SalesAgentRuntimeResult['result']['risks'];
  recommended_next_action: SalesAgentRuntimeResult['result']['next_actions'][number];
  confidence: SalesAgentRuntimeResult['result']['confidence'];
  evidence: SalesAgentRuntimeResult['result']['evidence'];
  selected_profile_id: string;
  review_status: 'pending_human_review';
  runtime: SalesAgentRuntimeResult;
}

export interface SalesPriorityResult extends SalesCopilotSafetyBoundary {
  kind: 'sales_priority';
  items: readonly SalesPriorityItem[];
}

export interface InteractionIntelligenceResult extends SalesCopilotSafetyBoundary {
  kind: 'interaction_intelligence';
  activation_request_id: string;
  source_event_id: string;
  activation_mode: 'explicit_manual';
  detection_categories: readonly ('new_opportunity_signal' | 'elevated_risk' | 'follow_up_need' | 'stage_change_possibility' | 'missing_information')[];
  runtime: SalesAgentRuntimeResult;
}

export type SalesCopilotWorkflowResult =
  | CustomerIntelligenceResult
  | SalesPriorityResult
  | InteractionIntelligenceResult;
