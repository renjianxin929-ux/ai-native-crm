/**
 * v0.2.2 / C0 — explicit profile runtime and file-level isolation.
 *
 * These tests deliberately run under a temporary USERPROFILE/HOME. They never
 * rely on db.ts's default Tauri connection or a memory fallback.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c0-profile-'));
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
  productionDbBefore = captureProductionDbSentinels();
});

afterEach(() => {
  while (tempHomes.length > 0) tempHomes.pop()?.restore();
});

afterAll(() => {
  expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
});

describe('v0.2.2 C0 profile runtime', () => {
  it('requires --profile and never falls back to sandbox', async () => {
    const fixture = useTemporaryProfileHome();
    const output: string[] = [];

    const exitCode = await runCli(['profile-status'], (line) => output.push(line));

    expect(exitCode).toBe(5);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' })]);
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('creates an initialized SQLite file only inside the fixed profile root', async () => {
    const fixture = useTemporaryProfileHome();
    const productionBefore = captureProductionDbSentinels();
    const output: string[] = [];

    const exitCode = await runCli(['--profile', 'sandbox', 'profile-status'], (line) => output.push(line));

    const expectedDbPath = join(fixture.profilesRoot, 'sandbox', 'crm.sqlite');
    expect(exitCode).toBe(0);
    expect(output).toEqual([JSON.stringify({
      ok: true,
      status: 'COMPLETED',
      profile: 'sandbox',
      db_path: expectedDbPath,
    })]);
    expect(existsSync(expectedDbPath)).toBe(true);
    expect(captureProductionDbSentinels()).toEqual(productionBefore);

    const handle = await openProfileDatabase('sandbox');
    try {
      expect(handle.profile).toBe('sandbox');
      expect(handle.rootDir).toBe(fixture.profilesRoot);
      expect(handle.dbPath).toBe(expectedDbPath);
      expect(await handle.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'",
      )).toEqual([{ name: 'customers' }]);
      expect(await handle.db.select<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    } finally {
      await handle.close();
    }
  });

  it('keeps customers isolated between profiles and releases files on close', async () => {
    const fixture = useTemporaryProfileHome();
    const sandbox = await openProfileDatabase('sandbox');
    const other = await openProfileDatabase('other');
    const sandboxDir = join(fixture.profilesRoot, 'sandbox');

    try {
      expect(sandbox.dbPath).toBe(join(fixture.profilesRoot, 'sandbox', 'crm.sqlite'));
      expect(other.dbPath).toBe(join(fixture.profilesRoot, 'other', 'crm.sqlite'));
      expect(sandbox.dbPath).not.toBe(other.dbPath);
      expect(existsSync(sandbox.dbPath)).toBe(true);
      expect(existsSync(other.dbPath)).toBe(true);

      await sandbox.db.execute(
        'INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ['c0-sandbox-marker', 'Sandbox Marker', '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z'],
      );

      expect(await sandbox.db.select<{ id: string }>('SELECT id FROM customers WHERE id = ?', ['c0-sandbox-marker']))
        .toEqual([{ id: 'c0-sandbox-marker' }]);
      expect(await other.db.select<{ id: string }>('SELECT id FROM customers WHERE id = ?', ['c0-sandbox-marker']))
        .toEqual([]);
    } finally {
      await sandbox.close();
      await other.close();
    }

    rmSync(sandboxDir, { recursive: true, force: true });
    expect(existsSync(sandboxDir)).toBe(false);
  });
});
