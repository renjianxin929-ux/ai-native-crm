import type { VerticalRuleProfile } from './verticalProfiles';

export type PromptRegistryPurpose =
  | 'wechat_screenshot'
  | 'call_transcript'
  | 'call_transcript_system'
  | 'next_action_suggestion';

export interface PromptRegistryDefinition {
  kind: 'PROMPT_DEFINITION';
  prompt_id: string;
  prompt_version: 'readiness-v1';
  purpose: PromptRegistryPurpose;
  profile_id: string;
  source: 'VerticalRuleProfile.aiDraft';
  template: string;
  runtime_editable: false;
  model_id: null;
}

export function buildPromptRegistryDefinitions(
  profile: VerticalRuleProfile,
): PromptRegistryDefinition[] {
  return [
    buildDefinition(profile, 'wechat_screenshot', 'aiDraft.wechatScreenshotPrompt', (
      profile.aiDraft.wechatScreenshotPrompt
    )),
    buildDefinition(profile, 'call_transcript', 'aiDraft.callTranscriptPrompt', (
      `${profile.aiDraft.callTranscriptPrompt.beforeTranscript}{{transcript}}${profile.aiDraft.callTranscriptPrompt.afterTranscript}`
    )),
    buildDefinition(profile, 'call_transcript_system', 'aiDraft.callTranscriptSystemPrompt', (
      profile.aiDraft.callTranscriptSystemPrompt
    )),
    buildDefinition(profile, 'next_action_suggestion', 'aiDraft.nextActionSuggestion.systemPrompt', (
      profile.aiDraft.nextActionSuggestion.systemPrompt
    )),
  ];
}

export function renderPromptRegistryDefinition(
  definition: PromptRegistryDefinition,
  variables: { transcript?: string } = {},
): string {
  return definition.template.replace('{{transcript}}', variables.transcript ?? '');
}

function buildDefinition(
  profile: VerticalRuleProfile,
  purpose: PromptRegistryPurpose,
  path: string,
  template: string,
): PromptRegistryDefinition {
  return {
    kind: 'PROMPT_DEFINITION',
    prompt_id: `${profile.key}:${path}`,
    prompt_version: 'readiness-v1',
    purpose,
    profile_id: profile.key,
    source: 'VerticalRuleProfile.aiDraft',
    template,
    runtime_editable: false,
    model_id: null,
  };
}
