import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  __setDesktopDataSourceCommandInvokeForTests,
  getDesktopAgentCliStatus,
} from '../lib/desktopDataSource';
import { buildAgentCatalogExample } from '../pages/SettingsPage';

afterEach(() => {
  __setDesktopDataSourceCommandInvokeForTests(null);
});

describe('bundled executable CLI release surface', () => {
  it('accepts only a Rust-resolved, read-only status payload and sends no path arguments', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    __setDesktopDataSourceCommandInvokeForTests(async (command, args) => {
      calls.push({ command, args });
      return {
        mode: 'PROFILE',
        profileName: 'demo',
        profileDatabasePath: 'C:\\Users\\demo\\.localcrm\\profiles\\demo\\crm.sqlite',
        installedCliPath: 'C:\\Program Files\\local-crm\\crm.exe',
      };
    });

    await expect(getDesktopAgentCliStatus()).resolves.toEqual({
      mode: 'PROFILE',
      profileName: 'demo',
      profileDatabasePath: 'C:\\Users\\demo\\.localcrm\\profiles\\demo\\crm.sqlite',
      installedCliPath: 'C:\\Program Files\\local-crm\\crm.exe',
    });
    expect(calls).toEqual([{ command: 'desktop_agent_cli_status', args: {} }]);
  });

  it('copies an absolute sidecar command and never a bare PATH command', () => {
    expect(buildAgentCatalogExample('C:\\Program Files\\local-crm\\crm.exe', 'demo'))
      .toBe('"C:\\Program Files\\local-crm\\crm.exe" --profile demo catalog');
    expect(buildAgentCatalogExample('/Applications/local-crm.app/Contents/MacOS/crm', 'demo'))
      .toBe('"/Applications/local-crm.app/Contents/MacOS/crm" --profile demo catalog');
    expect(() => buildAgentCatalogExample('crm', 'demo')).toThrow('absolute executable path');
  });

  it('keeps the release build and user-facing documentation on the one bundled sidecar boundary', () => {
    const repoRoot = resolve(import.meta.dirname, '../..');
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    const tauriConfig = JSON.parse(readFileSync(resolve(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8')) as Record<string, unknown>;
    const docs = readFileSync(resolve(repoRoot, 'docs/bundled-executable-cli-v0.2.2.md'), 'utf8');
    const settings = readFileSync(resolve(repoRoot, 'src/pages/SettingsPage.tsx'), 'utf8');
    const adapter = readFileSync(resolve(repoRoot, 'src/lib/desktopDataSource.ts'), 'utf8');
    const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-bundled-cli.mjs'), 'utf8');
    const cargoBuildScript = readFileSync(resolve(repoRoot, 'src-tauri/build.rs'), 'utf8');
    const installCheck = readFileSync(resolve(repoRoot, 'scripts/check-bundled-cli-install.mjs'), 'utf8');

    expect((packageJson.scripts as Record<string, string>)['build:bundled-cli']).toBe('node scripts/build-bundled-cli.mjs');
    expect((packageJson.scripts as Record<string, string>)['verify:bundled-cli']).toBe('node scripts/check-bundled-cli-install.mjs');
    expect(packageJson).not.toHaveProperty('bin');
    expect((tauriConfig.build as Record<string, string>).beforeBuildCommand).toBe('npm run build:bundled-cli');
    expect((tauriConfig.bundle as Record<string, unknown>).externalBin).toEqual(['binaries/crm']);
    expect(adapter).toContain("'desktop_agent_cli_status'");
    expect(settings).toContain('没有 PATH shim 时不会复制裸');
    expect(settings).toContain('Agent 不得调用');
    expect(docs).toContain('`catalog`, `cap`, `session`, and\n`profile-status`');
    expect(docs).toContain('not a separate Agent binary');
    const documentedExamples = docs.match(/```[\s\S]*?```/gu)?.join('\n') ?? '';
    expect(documentedExamples).not.toContain('confirm');
    expect(documentedExamples).not.toContain('--phrase');
    expect(buildScript).toContain("'better_sqlite3.node'");
    expect(buildScript).toContain("'binaries', `crm-${targetTriple}${extension}`");
    expect(buildScript).toContain("CRM_BUNDLED_CLI_LAUNCHER_BUILD: '1'");
    expect(cargoBuildScript).toContain('CRM_BUNDLED_CLI_LAUNCHER_BUILD');
    expect(installCheck).toContain("PATH: ''");
    expect(installCheck).toContain("customer_create_confirmation_required: true");
  });
});
