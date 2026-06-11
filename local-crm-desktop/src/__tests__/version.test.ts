import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../lib/version';

describe('app version', () => {
  it('exports the current app version from one shared module', () => {
    expect(APP_VERSION).toBe('0.4.0');
  });

  it('SettingsPage uses the shared app version instead of a local hard-coded value', () => {
    const src = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(src).toContain("import { APP_VERSION } from '../lib/version'");
    expect(src).not.toContain("const APP_VERSION = '0.3.1'");
    expect(src).not.toContain('v0.3.1');
  });
});
