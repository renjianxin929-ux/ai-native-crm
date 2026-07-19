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

  it('rejects legacy SQLite credential persistence', async () => {
    const { saveAIConfig } = await import('../lib/ai');

    const config = {
      provider: 'openai' as const,
      apiKey: 'sk-test-123',
      model: 'gpt-4',
    };

    await expect(saveAIConfig(config)).rejects.toThrow(/DPAPI/);
  });

  it('does not test providers through the browser legacy path', async () => {
    const { testAIConnection } = await import('../lib/ai');
    const result = await testAIConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4',
    });
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
  });

  it('rejects the retired mock chat analysis path', async () => {
    const { analyzeChatText } = await import('../lib/ai');
    await expect(analyzeChatText('Hello', {
      id: 'test',
      name: 'Test Customer',
    } as Record<string, unknown>)).rejects.toThrow(/不生成或伪造/);
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
