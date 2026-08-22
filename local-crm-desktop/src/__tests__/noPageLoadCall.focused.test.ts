import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('no-page-load-call suite', () => {
  it('workspace and settings do not auto-execute model completions on mount', () => {
    const workspace = readFileSync(resolve(process.cwd(), 'src/components/aiNative/AINativeCRMWorkspace.tsx'), 'utf8');
    const interaction = readFileSync(resolve(process.cwd(), 'src/components/aiNative/SalesAgentInteractionWorkspace.tsx'), 'utf8');
    const settings = readFileSync(resolve(process.cwd(), 'src/pages/AISettingsPage.tsx'), 'utf8');

    expect(workspace).not.toMatch(/useEffect\([\s\S]{0,400}executeTrustedHostCapability/);
    expect(workspace).not.toMatch(/useEffect\([\s\S]{0,400}authorizeTrustedHostCapability/);
    expect(interaction).not.toMatch(/useEffect\([\s\S]{0,400}createProductionModelCaller\(\)\(\{/);
    expect(settings).toContain('listTrustedHostProviderStatus');
    expect(settings).toContain('queueMicrotask(() => { if (active) void refresh(); });');
    expect(settings).not.toMatch(/useEffect\([\s\S]{0,500}testTrustedHostProviderConnection/);
    expect(settings).not.toContain('executeTrustedHostCapability');
    expect(settings).not.toContain('authorizeTrustedHostCapability');
  });
});
