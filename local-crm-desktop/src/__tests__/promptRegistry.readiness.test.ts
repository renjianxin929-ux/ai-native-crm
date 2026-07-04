import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildCallTranscriptPrompt, buildWechatScreenshotPrompt } from '../lib/aiDraft';
import {
  buildPromptRegistryDefinitions,
  renderPromptRegistryDefinition,
} from '../lib/promptRegistryReadiness';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../lib/verticalProfiles';

describe('Prompt Registry readiness gate', () => {
  it('projects active aiDraft prompt policies into readiness-only prompt definitions', () => {
    const profile = getActiveVerticalProfile();
    const definitions = buildPromptRegistryDefinitions(profile);

    expect(definitions).toHaveLength(4);
    expect(definitions.map((definition) => definition.prompt_id)).toEqual([
      `${profile.key}:aiDraft.wechatScreenshotPrompt`,
      `${profile.key}:aiDraft.callTranscriptPrompt`,
      `${profile.key}:aiDraft.callTranscriptSystemPrompt`,
      `${profile.key}:aiDraft.nextActionSuggestion.systemPrompt`,
    ]);

    for (const definition of definitions) {
      expect(definition.kind).toBe('PROMPT_DEFINITION');
      expect(definition.prompt_version).toBe('readiness-v1');
      expect(definition.profile_id).toBe(profile.key);
      expect(definition.source).toBe('VerticalRuleProfile.aiDraft');
      expect(definition.runtime_editable).toBe(false);
      expect(definition.model_id).toBeNull();
      expect(definition.template.length).toBeGreaterThan(0);
    }
  });

  it('preserves existing prompt builder output without introducing registry behavior changes', () => {
    const profile = getActiveVerticalProfile();
    const definitions = buildPromptRegistryDefinitions(profile);
    const byPurpose = new Map(definitions.map((definition) => [definition.purpose, definition]));

    expect(byPurpose.get('wechat_screenshot')?.template).toBe(
      buildWechatScreenshotPrompt({ profile }),
    );
    expect(renderPromptRegistryDefinition(
      byPurpose.get('call_transcript')!,
      { transcript: 'CALL BODY' },
    )).toBe(buildCallTranscriptPrompt('CALL BODY', { profile }));
  });

  it('keeps the supplied vertical profile aiDraft section as the source of truth', () => {
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_prompt_registry_profile',
      name: 'Dummy Prompt Registry Profile',
      aiDraft: {
        ...getActiveVerticalProfile().aiDraft,
        wechatScreenshotPrompt: 'Dummy screenshot registry prompt',
        callTranscriptPrompt: {
          beforeTranscript: 'Dummy before ',
          afterTranscript: ' dummy after',
        },
        callTranscriptSystemPrompt: 'Dummy call system registry prompt',
        nextActionSuggestion: {
          ...getActiveVerticalProfile().aiDraft.nextActionSuggestion,
          systemPrompt: 'Dummy next-action registry prompt',
        },
      },
    };

    const definitions = buildPromptRegistryDefinitions(dummyProfile);

    expect(definitions.map((definition) => definition.profile_id)).toEqual([
      dummyProfile.key,
      dummyProfile.key,
      dummyProfile.key,
      dummyProfile.key,
    ]);
    expect(definitions.find((definition) => definition.purpose === 'wechat_screenshot')?.template)
      .toBe('Dummy screenshot registry prompt');
    expect(renderPromptRegistryDefinition(
      definitions.find((definition) => definition.purpose === 'call_transcript')!,
      { transcript: 'hello' },
    )).toBe('Dummy before hello dummy after');
    expect(definitions.find((definition) => definition.purpose === 'call_transcript_system')?.template)
      .toBe('Dummy call system registry prompt');
    expect(definitions.find((definition) => definition.purpose === 'next_action_suggestion')?.template)
      .toBe('Dummy next-action registry prompt');
  });

  it('does not bind prompt definitions to providers, network calls, or runtime editing', () => {
    const source = readFileSync('src/lib/promptRegistryReadiness.ts', 'utf8');
    const forbiddenRuntimeTerms = [
      'fetch(',
      'apiKey',
      'baseUrl',
      'deepseek',
      'qwen',
      'openai',
      'claude',
      'gemini',
      'prompt_registry',
      'saveprompt',
      'updateprompt',
    ];

    for (const term of forbiddenRuntimeTerms) {
      expect(source.toLowerCase()).not.toContain(term);
    }
  });
});
