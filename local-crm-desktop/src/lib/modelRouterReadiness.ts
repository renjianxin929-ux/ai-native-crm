export type ModelRoutePurpose =
  | 'wechat_screenshot_analysis'
  | 'call_transcript_analysis'
  | 'next_action_suggestion';

export type ModelRouteCapability = 'text' | 'image' | 'audio';

export interface NoopModelRouteInput {
  purpose: ModelRoutePurpose;
  prompt_id: string | null;
  required_capabilities: ModelRouteCapability[];
}

export interface NoopModelRoute {
  kind: 'NOOP_MODEL_ROUTE';
  route_id: string;
  purpose: ModelRoutePurpose;
  prompt_id: string | null;
  required_capabilities: ModelRouteCapability[];
  executable: false;
  status: 'not_configured';
  reason: 'router_readiness_only';
  selected_model_id: null;
  selected_provider: null;
}

export function buildNoopModelRouterCatalog(): NoopModelRoute[] {
  return [
    buildNoopModelRoute({
      purpose: 'wechat_screenshot_analysis',
      prompt_id: null,
      required_capabilities: ['image', 'text'],
    }),
    buildNoopModelRoute({
      purpose: 'call_transcript_analysis',
      prompt_id: null,
      required_capabilities: ['text'],
    }),
    buildNoopModelRoute({
      purpose: 'next_action_suggestion',
      prompt_id: null,
      required_capabilities: ['text'],
    }),
  ];
}

export function buildNoopModelRoute(input: NoopModelRouteInput): NoopModelRoute {
  return {
    kind: 'NOOP_MODEL_ROUTE',
    route_id: `${input.purpose}:readiness`,
    purpose: input.purpose,
    prompt_id: input.prompt_id,
    required_capabilities: [...input.required_capabilities],
    executable: false,
    status: 'not_configured',
    reason: 'router_readiness_only',
    selected_model_id: null,
    selected_provider: null,
  };
}
