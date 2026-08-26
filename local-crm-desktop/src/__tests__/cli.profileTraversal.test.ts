/**
 * v0.2.2 / C0 — profile-name rejection and production-path tripwires.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { defaultDbTripwire } = vi.hoisted(() => ({
  defaultDbTripwire: vi.fn(async () => {
    throw new Error('C0 forbids default getDb(): profile runtime must never open sqlite:personal-crm.db.');
  }),
}));

// Keep schema initialization real while making any accidental production-DB
// fallback immediately observable. File fingerprints below are independent
// evidence and remain the authoritative production-file check.
vi.mock('../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/db')>();
  return { ...actual, getDb: defaultDbTripwire };
});

import { runCli } from '../cli/main';
import { openProfileDatabase } from '../cli/profileDb';

interface ProductionDbSentinel {
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly sha256?: string;
}

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  readonly restore: () => void;
}

const tempHomes: TemporaryProfileHome[] = [];
let productionDbBefore: readonly ProductionDbSentinel[];

function captureProductionDbSentinels(): readonly ProductionDbSentinel[] {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'com.localcrm.desktop', 'personal-crm.db') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'com.localcrm.desktop', 'personal-crm.db') : null,
  ].filter((path): path is string => Boolean(path));

  return candidates.map((path) => {
    if (!existsSync(path)) return { path, exists: false };
    const stat = statSync(path);
    return {
      path,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
}

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c0-traversal-'));
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  const fixture: TemporaryProfileHome = {
    home,
    profilesRoot: join(home, '.localcrm', 'profiles'),
    restore() {
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    },
  };
  tempHomes.push(fixture);
  return fixture;
}

beforeAll(() => {
  defaultDbTripwire.mockClear();
  productionDbBefore = captureProductionDbSentinels();
});

afterEach(() => {
  while (tempHomes.length > 0) tempHomes.pop()?.restore();
});

afterAll(() => {
  expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  expect(defaultDbTripwire).not.toHaveBeenCalled();
});

describe('v0.2.2 C0 profile validation', () => {
  it.each([
    '',
    ' ',
    '.',
    '..',
    '../foo',
    'foo/bar',
    'foo\\bar',
    'C:\\outside',
    'sqlite:personal-crm.db',
    '~',
    'foo:bar',
    'a'.repeat(65),
  ])('rejects unsafe profile name %j before creating any file', async (profileName) => {
    const fixture = useTemporaryProfileHome();

    await expect(openProfileDatabase(profileName)).rejects.toMatchObject({ code: 'PROFILE_INVALID' });

    expect(existsSync(fixture.profilesRoot)).toBe(false);
    expect(existsSync(join(fixture.home, 'foo'))).toBe(false);
  });

  it('rejects absolute profile inputs and never accepts a path outside the fixed root', async () => {
    const fixture = useTemporaryProfileHome();
    const absoluteInput = join(fixture.home, 'outside');
    expect(isAbsolute(absoluteInput)).toBe(true);

    await expect(openProfileDatabase(absoluteInput)).rejects.toMatchObject({ code: 'PROFILE_INVALID' });

    expect(existsSync(fixture.profilesRoot)).toBe(false);
    expect(existsSync(absoluteInput)).toBe(false);
  });

  it('fails closed for missing commands and refuses catalog without opening a database', async () => {
    const fixture = useTemporaryProfileHome();
    const noCommandOutput: string[] = [];
    const catalogOutput: string[] = [];

    expect(await runCli(['--profile', 'sandbox'], (line) => noCommandOutput.push(line))).toBe(2);
    expect(JSON.parse(noCommandOutput[0] ?? '{}')).toMatchObject({ ok: false, status: 'ERROR', code: 'COMMAND_REQUIRED' });

    expect(await runCli(['--profile', 'sandbox', 'catalog'], (line) => catalogOutput.push(line))).toBe(2);
    expect(JSON.parse(catalogOutput[0] ?? '{}')).toMatchObject({ ok: false, status: 'ERROR', code: 'UNKNOWN_COMMAND' });

    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('does not introduce a CLI route to the default Tauri database runtime', () => {
    const profileSource = readFileSync(new URL('../cli/profile.ts', import.meta.url), 'utf8');
    const profileDbSource = readFileSync(new URL('../cli/profileDb.ts', import.meta.url), 'utf8');
    const mainSource = readFileSync(new URL('../cli/main.ts', import.meta.url), 'utf8');
    const cliSource = profileSource + profileDbSource + mainSource;

    expect(cliSource).not.toContain('getDb(');
    expect(cliSource).not.toContain('@tauri-apps/plugin-sql');
    expect(cliSource).not.toContain('VITE_ALLOW_MEMORY_DB');
    expect(cliSource).not.toContain('__setDbInstanceForTests');
    expect(cliSource).not.toContain('__setDatabaseLoaderForTests');
  });
});
