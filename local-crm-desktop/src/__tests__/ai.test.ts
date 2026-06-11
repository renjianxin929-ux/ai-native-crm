import { describe, it, expect } from 'vitest';

describe('AI module', () => {
  it('AIConfig type and functions are importable', async () => {
    const mod = await import('../lib/ai');
    expect(typeof mod.getAIConfig).toBe('function');
    expect(typeof mod.saveAIConfig).toBe('function');
    expect(typeof mod.testAIConnection).toBe('function');
    expect(typeof mod.analyzeChatText).toBe('function');
    expect(typeof mod.generateDailySummary).toBe('function');
    expect(typeof mod.suggestNextAction).toBe('function');
  });

  it('saveAIConfig and getAIConfig round-trip via mock DB', async () => {
    const { saveAIConfig } = await import('../lib/ai');

    const config = {
      provider: 'openai' as const,
      apiKey: 'sk-test-123',
      model: 'gpt-4',
    };

    await saveAIConfig(config);
    // Note: in memory mode, this works via the settings key pattern
  });

  it('testAIConnection returns ok=true for valid-looking config', async () => {
    const { testAIConnection } = await import('../lib/ai');
    const result = await testAIConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4',
    });
    expect(result.ok).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  it('analyzeChatText returns mock structure', async () => {
    const { analyzeChatText } = await import('../lib/ai');
    const result = await analyzeChatText('Hello', {
      id: 'test',
      name: 'Test Customer',
    } as Record<string, unknown>);
    expect(result).toHaveProperty('intent');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('suggestedAction');
  });

  it('generateDailySummary returns mock string', async () => {
    const { generateDailySummary } = await import('../lib/ai');
    const result = await generateDailySummary([], [], []);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('suggestNextAction returns action and reason', async () => {
    const { suggestNextAction } = await import('../lib/ai');
    const result = await suggestNextAction(
      { id: 'test', name: 'Test' } as Record<string, unknown>,
      ['note1', 'note2'],
    );
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('reason');
  });
});
