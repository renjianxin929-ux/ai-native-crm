import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../cli/main';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  readonly restore: () => void;
}

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c3-import-preview-'));
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

describe('v0.2.2 C3 import.file.preview CLI transport', () => {
  it('converts a real local file into the existing native File capability input', async () => {
    const fixture = useTemporaryProfileHome();
    const fixturePath = join(fixture.home, 'customers.csv');
    writeFileSync(fixturePath, 'name,region\nXinghe,Guangzhou\n', 'utf8');
    const output: string[] = [];

    const exitCode = await runCli(
      ['--profile', 'sandbox', 'cap', 'import.file.preview', '--file', fixturePath],
      line => output.push(line),
    );

    expect(exitCode).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      ok: true,
      status: 'COMPLETED',
      capability_id: 'import.file.preview',
      version: '1.0.0',
      profile: 'sandbox',
      result: {
        headers: ['name', 'region'],
        rows: [['Xinghe', 'Guangzhou']],
      },
    });
  });

  it('rejects traversal and missing-file transports before opening a profile database', async () => {
    const fixture = useTemporaryProfileHome();
    const output: string[] = [];

    const traversalExit = await runCli(
      ['--profile', 'sandbox', 'cap', 'import.file.preview', '--file', '..\\escape.csv'],
      line => output.push(line),
    );
    expect(traversalExit).toBe(2);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'INVALID_INPUT' })]);
    expect(existsSync(fixture.profilesRoot)).toBe(false);

    output.length = 0;
    const missingExit = await runCli(
      ['--profile', 'sandbox', 'cap', 'import.file.preview', '--file', join(fixture.home, 'missing.csv')],
      line => output.push(line),
    );
    expect(missingExit).toBe(2);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'INVALID_INPUT' })]);
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });
});
