import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildNoopModelRoute, buildNoopModelRouterCatalog } from '../lib/modelRouterReadiness';
import { buildPromptRegistryDefinitions } from '../lib/promptRegistryReadiness';
import { getActiveVerticalProfile } from '../lib/verticalProfiles';

describe('Model Router readiness gate', () => {
  it('declares existing AI use cases as non-executable no-op routes', () => {
    const catalog = buildNoopModelRouterCatalog();

    expect(catalog.map((route) => route.purpose)).toEqual([
      'wechat_screenshot_analysis',
      'call_transcript_analysis',
      'next_action_suggestion',
    ]);

    for (const route of catalog) {
      expect(route.kind).toBe('NOOP_MODEL_ROUTE');
      expect(route.executable).toBe(false);
      expect(route.status).toBe('not_configured');
      expect(route.selected_model_id).toBeNull();
      expect(route.selected_provider).toBeNull();
      expect(route.reason).toBe('router_readiness_only');
      expect(route.required_capabilities.length).toBeGreaterThan(0);
    }
  });

  it('keeps prompt definitions and route plans linked without selecting a real model', () => {
    const profile = getActiveVerticalProfile();
    const prompt = buildPromptRegistryDefinitions(profile)
      .find((definition) => definition.purpose === 'call_transcript')!;

    const route = buildNoopModelRoute({
      purpose: 'call_transcript_analysis',
      prompt_id: prompt.prompt_id,
      required_capabilities: ['text'],
    });

    expect(route.prompt_id).toBe(prompt.prompt_id);
    expect(route.required_capabilities).toEqual(['text']);
    expect(route.selected_model_id).toBeNull();
    expect(route.selected_provider).toBeNull();
    expect(route.executable).toBe(false);
  });

  it('uses caller-supplied capability requirements instead of hardcoded provider defaults', () => {
    const route = buildNoopModelRoute({
      purpose: 'wechat_screenshot_analysis',
      prompt_id: null,
      required_capabilities: ['image', 'text'],
    });

    expect(route.required_capabilities).toEqual(['image', 'text']);
    expect(route.route_id).toBe('wechat_screenshot_analysis:readiness');
  });

  it('does not read environment, call providers, persist settings, or expose runtime selection', () => {
    const source = readFileSync('src/lib/modelRouterReadiness.ts', 'utf8');
    const forbiddenRuntimeTerms = [
      'fetch(',
      'apiKey',
      'baseUrl',
      'process.env',
      'import.meta.env',
      'localStorage',
      'settings',
      'deepseek',
      'qwen',
      'openai',
      'claude',
      'gemini',
      'buildDeepSeek',
      'buildQwen',
      'CREATE TABLE',
    ];

    for (const term of forbiddenRuntimeTerms) {
      expect(source.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});
