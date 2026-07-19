import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('tauri-db-acceptance-isolation', () => {
  it('uses only a generated temp e2e app_data_dir and never targets the normal app identifier', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/__tests__/salesAgentTauriDbAcceptance.evidence.test.ts'), 'utf8');
    expect(source).toContain("mkdtempSync(join(tmpdir(), 'local-crm-tauri-e2e-'))");
    expect(source).toContain("join(root, 'com.localcrm.desktop.e2e')");
    expect(source).toContain("join(appDataDir, 'personal-crm.db')");
    expect(source).not.toMatch(/homedir\(|AppData|Roaming/);
    expect(source.replaceAll('com.localcrm.desktop.e2e', '')).not.toContain('com.localcrm.desktop');
  });
});
