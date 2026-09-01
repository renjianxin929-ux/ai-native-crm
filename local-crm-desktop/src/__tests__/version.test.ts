import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../lib/version';

const RELEASE_VERSION = '0.2.2';

function readReleaseFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function cargoManifestPackageVersion(contents: string): string | null {
  const packageLines = contents
    .split(/\r?\n/u)
    .slice(contents.split(/\r?\n/u).indexOf('[package]') + 1);
  const versionLine = packageLines.find((line) => /^version = "[^"]+"$/u.test(line));
  return versionLine?.match(/^version = "([^"]+)"$/u)?.[1] ?? null;
}

function cargoLockPackageVersion(contents: string, packageName: string): string | null {
  const packageBlock = contents
    .split('[[package]]')
    .find((block) => block.split(/\r?\n/u).includes(`name = "${packageName}"`));
  return packageBlock?.match(/^version = "([^"]+)"$/mu)?.[1] ?? null;
}

describe('app version', () => {
  it('exports the current app version from one shared module', () => {
    expect(APP_VERSION).toBe(RELEASE_VERSION);
  });

  it('keeps every user-visible release declaration aligned', () => {
    const packageManifest = JSON.parse(readReleaseFile('package.json')) as { readonly version?: string };
    const packageLock = JSON.parse(readReleaseFile('package-lock.json')) as {
      readonly version?: string;
      readonly packages?: Readonly<Record<string, { readonly version?: string }>>;
    };
    const tauriConfig = JSON.parse(readReleaseFile('src-tauri/tauri.conf.json')) as { readonly version?: string };
    const cargoManifest = readReleaseFile('src-tauri/Cargo.toml');
    const cargoLock = readReleaseFile('src-tauri/Cargo.lock');

    expect(packageManifest.version).toBe(RELEASE_VERSION);
    expect(packageLock.version).toBe(RELEASE_VERSION);
    expect(packageLock.packages?.['']?.version).toBe(RELEASE_VERSION);
    expect(tauriConfig.version).toBe(RELEASE_VERSION);
    expect(cargoManifestPackageVersion(cargoManifest)).toBe(RELEASE_VERSION);

    expect(cargoLockPackageVersion(cargoLock, 'app')).toBe(RELEASE_VERSION);
  });

  it('SettingsPage uses the shared app version instead of a local hard-coded value', () => {
    const src = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(src).toContain("import { APP_VERSION } from '../lib/version'");
    expect(src).not.toContain("const APP_VERSION = '0.3.1'");
    expect(src).not.toContain('v0.3.1');
  });
});
