import type { AIJudgmentCandidate } from './leadWorkbench/aiJudgmentReadiness';
import type { HumanReviewCandidate } from './leadWorkbench/humanReviewReadiness';
import type { OutcomeCandidate } from './leadWorkbench/outcomeReadiness';
import {
  buildNoopModelRoute,
  buildNoopModelRouterCatalog,
  type ModelRoutePurpose,
  type NoopModelRoute,
} from './modelRouterReadiness';
import {
  buildPromptRegistryDefinitions,
  type PromptRegistryDefinition,
  type PromptRegistryPurpose,
} from './promptRegistryReadiness';
import type { VerticalRuleProfile } from './verticalProfiles';

export interface LeadWorkbenchRuntimeTraceInput {
  judgment: AIJudgmentCandidate;
  human_review: HumanReviewCandidate;
  outcome: OutcomeCandidate;
}

export interface LeadWorkbenchRuntimeTrace {
  kind: 'AI_RUNTIME_PLAN';
  scope: 'lead_workbench';
  executable: false;
  persisted: false;
  reason: 'runtime_readiness_only';
  stages: LeadWorkbenchRuntimeTraceInput;
}

export interface CrmAiRuntimeCatalog {
  kind: 'AI_RUNTIME_PLAN';
  scope: 'crm_ai';
  executable: false;
  persisted: false;
  reason: 'runtime_readiness_only';
  prompts: PromptRegistryDefinition[];
  routes: NoopModelRoute[];
}

const promptPurposeByRoutePurpose: Record<ModelRoutePurpose, PromptRegistryPurpose> = {
  wechat_screenshot_analysis: 'wechat_screenshot',
  call_transcript_analysis: 'call_transcript',
  next_action_suggestion: 'next_action_suggestion',
};

export function buildLeadWorkbenchRuntimeTrace(
  input: LeadWorkbenchRuntimeTraceInput,
): LeadWorkbenchRuntimeTrace {
  return {
    kind: 'AI_RUNTIME_PLAN',
    scope: 'lead_workbench',
    executable: false,
    persisted: false,
    reason: 'runtime_readiness_only',
    stages: {
      judgment: input.judgment,
      human_review: input.human_review,
      outcome: input.outcome,
    },
  };
}

export function buildCrmAiRuntimeCatalog(profile: VerticalRuleProfile): CrmAiRuntimeCatalog {
  const prompts = buildPromptRegistryDefinitions(profile);
  const promptIdsByPurpose = new Map(prompts.map(prompt => [prompt.purpose, prompt.prompt_id]));
  const routes = buildNoopModelRouterCatalog().map(route => buildNoopModelRoute({
    purpose: route.purpose,
    prompt_id: promptIdsByPurpose.get(promptPurposeByRoutePurpose[route.purpose]) ?? null,
    required_capabilities: route.required_capabilities,
  }));

  return {
    kind: 'AI_RUNTIME_PLAN',
    scope: 'crm_ai',
    executable: false,
    persisted: false,
    reason: 'runtime_readiness_only',
    prompts,
    routes,
  };
}
