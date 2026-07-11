import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CapabilityProviderRegistry,
  createCapabilityProviderRegistry,
  DeepSeekCompatibleProvider,
  QwenVisionCompatibleProvider,
  validateVisionFacts,
} from '../lib/modelCapabilities';

describe('model capability provider foundation', () => {
  it('resolves TEXT_REASONING to the explicitly requested DeepSeek-compatible provider', () => {
    const provider = createCapabilityProviderRegistry().resolve({
      capability: 'TEXT_REASONING',
      providerKind: 'DEEPSEEK_COMPATIBLE',
    });

    expect(provider).toBeInstanceOf(DeepSeekCompatibleProvider);
    expect(provider.executionMode).toBe('SKELETON');
  });

  it('resolves VISION_ANALYSIS to the explicitly requested Qwen vision-compatible provider', () => {
    const provider = createCapabilityProviderRegistry().resolve({
      capability: 'VISION_ANALYSIS',
      providerKind: 'QWEN_VISION_COMPATIBLE',
    });

    expect(provider).toBeInstanceOf(QwenVisionCompatibleProvider);
    expect(provider.executionMode).toBe('SKELETON');
  });

  it('rejects an unknown capability/provider registration request', () => {
    expect(() => createCapabilityProviderRegistry().resolve({
      capability: 'TEXT_REASONING',
      providerKind: 'QWEN_VISION_COMPATIBLE',
    })).toThrow('No provider registered');
  });

  it('rejects duplicate capability/provider registration', () => {
    expect(() => new CapabilityProviderRegistry([
      new DeepSeekCompatibleProvider(),
      new DeepSeekCompatibleProvider(),
    ])).toThrow('Duplicate capability provider registration');
  });

  it('uses a deterministic explicit registry with exactly the expected providers', () => {
    const providers = createCapabilityProviderRegistry().list();
    expect(providers.map(provider => `${provider.capability}:${provider.providerKind}`)).toEqual([
      'TEXT_REASONING:DEEPSEEK_COMPATIBLE',
      'VISION_ANALYSIS:QWEN_VISION_COMPATIBLE',
    ]);
  });

  it('has no dynamic provider discovery', () => {
    const registrySource = readFileSync(resolve(process.cwd(), 'src/lib/modelCapabilities/registry.ts'), 'utf8');
    expect(registrySource).not.toContain('import.meta.glob');
    expect(registrySource).not.toContain('require.context');
  });

  it('returns only visual facts from the vision skeleton', async () => {
    const result = await new QwenVisionCompatibleProvider().execute({ imageReference: 'image-fixture-1' });
    expect(result).toEqual({ visual_facts: [] });
    expect(validateVisionFacts(result.visual_facts)).toBe(true);
  });

  it('validates the visual-facts-only schema and rejects recommendation fields', () => {
    expect(validateVisionFacts([{
      fact_type: 'observed_object',
      content: 'A product label is visible.',
    }])).toBe(true);
    expect(validateVisionFacts([{
      fact_type: 'observed_object',
      content: 'A product label is visible.',
      recommendation: 'Call the customer.',
    }])).toBe(false);
  });

  it('contains no environment access, network access, fetch, or CRM mutation terms', () => {
    const source = [
      'types.ts',
      'visionFacts.ts',
      'providers.ts',
      'registry.ts',
      'index.ts',
    ].map(file => readFileSync(resolve(process.cwd(), 'src/lib/modelCapabilities', file), 'utf8')).join('\n');

    for (const forbidden of ['process.env', 'import.meta.env', 'fetch(', 'axios', 'http://', 'https://', 'getDb', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
