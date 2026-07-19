import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('retired AIAssistantPage', () => {
  it('redirects the legacy route to the sole production AI workspace', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AIAssistantPage.tsx'), 'utf8');
    expect(source).toContain("<Navigate to=\"/ai-workspace\"");
    expect(source).not.toContain('analyzeWechatScreenshot');
    expect(source).not.toContain('analyzeCallTranscript');
    expect(source).not.toContain('createAIDraft');
  });
});
