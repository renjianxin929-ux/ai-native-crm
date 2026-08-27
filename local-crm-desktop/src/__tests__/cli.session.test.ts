import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../cli/main';
import { profileSessionPath } from '../cli/session';
import { resolveProfilePaths } from '../cli/profile';
import { openProfileDatabase } from '../cli/profileDb';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  readonly restore: () => void;
}

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c2-session-'));
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
  temporaryHomes.push(fixture);
  return fixture;
}

afterEach(() => {
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

describe('v0.2.2 C2 profile session CLI', () => {
  it('returns a null selected customer when the profile session file is absent', async () => {
    const fixture = useTemporaryProfileHome();
    const output: string[] = [];

    const exitCode = await runCli(['--profile', 'sandbox', 'session', 'show'], line => output.push(line));

    expect(exitCode).toBe(0);
    expect(output).toEqual([JSON.stringify({
      ok: true,
      status: 'COMPLETED',
      command: 'session.show',
      profile: 'sandbox',
      selected_customer_id: null,
    })]);
    expect(existsSync(join(fixture.profilesRoot, 'sandbox', 'session.json'))).toBe(false);
    expect(existsSync(join(fixture.profilesRoot, 'sandbox', 'crm.sqlite'))).toBe(false);
  });

  it('select-customer writes only the profile session and never changes customers', async () => {
    useTemporaryProfileHome();
    const handle = await openProfileDatabase('sandbox');
    try {
      await handle.db.execute(
        'INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ['c2-customer', 'Session Marker', '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z'],
      );
      expect(await handle.db.select<{ id: string; name: string }>('SELECT id, name FROM customers ORDER BY id'))
        .toEqual([{ id: 'c2-customer', name: 'Session Marker' }]);
    } finally {
      handle.close();
    }

    const output: string[] = [];
    const exitCode = await runCli(
      ['--profile', 'sandbox', 'session', 'select-customer', '--id', 'c2-customer'],
      line => output.push(line),
    );

    expect(exitCode).toBe(0);
    expect(output).toEqual([JSON.stringify({
      ok: true,
      status: 'COMPLETED',
      command: 'session.select-customer',
      profile: 'sandbox',
      selected_customer_id: 'c2-customer',
    })]);
    expect(readFileSync(profileSessionPath('sandbox'), 'utf8'))
      .toBe(JSON.stringify({ selected_customer_id: 'c2-customer' }));

    const reopened = await openProfileDatabase('sandbox');
    try {
      expect(await reopened.db.select<{ id: string; name: string }>('SELECT id, name FROM customers ORDER BY id'))
        .toEqual([{ id: 'c2-customer', name: 'Session Marker' }]);
    } finally {
      reopened.close();
    }
  });

  it('clears a selected customer by removing the session value', async () => {
    useTemporaryProfileHome();
    const selectOutput: string[] = [];
    const clearOutput: string[] = [];
    const showOutput: string[] = [];

    expect(await runCli(
      ['--profile', 'sandbox', 'session', 'select-customer', '--id', 'c2-customer'],
      line => selectOutput.push(line),
    )).toBe(0);
    expect(await runCli(['--profile', 'sandbox', 'session', 'clear-customer'], line => clearOutput.push(line))).toBe(0);
    expect(await runCli(['--profile', 'sandbox', 'session', 'show'], line => showOutput.push(line))).toBe(0);

    expect(JSON.parse(selectOutput[0] ?? '{}')).toMatchObject({ selected_customer_id: 'c2-customer' });
    expect(JSON.parse(clearOutput[0] ?? '{}')).toMatchObject({
      command: 'session.clear-customer',
      selected_customer_id: null,
    });
    expect(JSON.parse(showOutput[0] ?? '{}')).toMatchObject({
      command: 'session.show',
      selected_customer_id: null,
    });
    expect(existsSync(profileSessionPath('sandbox'))).toBe(false);
  });

  it('requires --profile before it creates any session directory', async () => {
    const fixture = useTemporaryProfileHome();
    const output: string[] = [];

    const exitCode = await runCli(['session', 'show'], line => output.push(line));

    expect(exitCode).toBe(5);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' })]);
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('fails closed when session.json is malformed', async () => {
    useTemporaryProfileHome();
    writeFileSync(profileSessionPath('sandbox'), '{not-json', 'utf8');
    const output: string[] = [];

    const exitCode = await runCli(['--profile', 'sandbox', 'session', 'show'], line => output.push(line));

    expect(exitCode).toBe(2);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'SESSION_INVALID' })]);
  });

  it('keeps the fixed session file inside the requested profile directory', () => {
    const fixture = useTemporaryProfileHome();
    const path = profileSessionPath('sandbox');
    const profileDir = resolveProfilePaths('sandbox').profileDir;
    const relativePath = relative(profileDir, path);

    expect(path).toBe(join(fixture.profilesRoot, 'sandbox', 'session.json'));
    expect(relativePath).toBe('session.json');
    expect(relativePath.startsWith('..')).toBe(false);
  });
});
