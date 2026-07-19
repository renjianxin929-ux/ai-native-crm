import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('no-frontend-secret suite', () => {
  it('production AI and trusted host paths never embed provider secrets or browser fetch', () => {
    const files = [
      resolve(process.cwd(), 'src/lib/modelCapabilities/trustedHost.ts'),
      resolve(process.cwd(), 'src/lib/salesAgentTools/trustedHostAdapter.ts'),
      resolve(process.cwd(), 'src/lib/salesAgentTools/agentSession.ts'),
      resolve(process.cwd(), 'src/lib/productionAi/productionReasoningPath.ts'),
      resolve(process.cwd(), 'src/lib/productionAi/modelContextEnvelope.ts'),
      resolve(process.cwd(), 'src/lib/liveReasoning/provider.ts'),
      resolve(process.cwd(), 'src/lib/liveReasoning/transport.ts'),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/Authorization:\s*`Bearer/);
      expect(source).not.toMatch(/fetch\(\s*['"`]https?:\/\/api\.deepseek/);
      if (file.endsWith('trustedHost.ts') || file.endsWith('trustedHostAdapter.ts') || file.includes('productionAi') || file.includes('liveReasoning')) {
        expect(source).not.toContain('process.env');
        expect(source).not.toContain('import.meta.env');
      }
    }
  });
});
