import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8')) as Record<string, unknown>;
}

describe('Tauri E2E database isolation', () => {
  it('keeps the production identifier and production window free of E2E hooks', () => {
    const production = readJson('src-tauri/tauri.conf.json');
    const source = readFileSync(resolve(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8');

    expect(production.identifier).toBe('com.localcrm.desktop');
    expect(source).not.toContain('com.localcrm.desktop.e2e');
    expect(source).not.toContain('remote-debugging-port');
    expect(source).not.toContain('local-crm-e2e');
  });

  it('uses a dedicated non-bundled E2E identifier and test-only CDP port', () => {
    const e2e = readJson('src-tauri/tauri.e2e.conf.json');
    const source = readFileSync(resolve(repoRoot, 'src-tauri/tauri.e2e.conf.json'), 'utf8');

    expect(e2e.productName).toBe('local-crm-e2e');
    expect(e2e.identifier).toBe('com.localcrm.desktop.e2e');
    expect(e2e.bundle).toMatchObject({ active: false });
    expect(source).toContain('--remote-debugging-port=9223');
    expect(source).not.toContain('com.localcrm.desktop/personal-crm.db');
  });

  it('exposes the flavor only through the explicit Tauri config merge command', () => {
    const packageJson = readJson('package.json');
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts['tauri:e2e']).toBe('tauri dev --config src-tauri/tauri.e2e.conf.json --features e2e');
    expect(scripts.tauri).toBe('tauri');
    expect(scripts.dev).toBe('vite');
  });
});
