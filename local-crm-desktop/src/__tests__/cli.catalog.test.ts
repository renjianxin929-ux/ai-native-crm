import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCapabilityCatalog } from '../cli/catalog';
import { runCli } from '../cli/main';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  readonly restore: () => void;
}

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c1-catalog-'));
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
  vi.restoreAllMocks();
});

describe('v0.2.2 C1 capability catalog', () => {
  it('derives exactly the production planner surface ID set', () => {
    const catalogIds = buildCapabilityCatalog().map((entry) => entry.capability_id).sort();
    const plannerIds = PRODUCTION_PLANNER_TOOL_SURFACE.map((entry) => entry.capability_id).sort();

    expect(catalogIds).toEqual(plannerIds);
  });

  it('has 25 entries for the v0.2.1 baseline, not as a permanent magic number', () => {
    // The equality assertion above is the drift guard. This count documents only
    // the current v0.2.1 production baseline.
    expect(buildCapabilityCatalog()).toHaveLength(25);
  });

  it('projects the required planner metadata and excludes fake capability IDs', () => {
    const catalog = buildCapabilityCatalog();

    for (const entry of catalog) {
      expect(entry.version).toEqual(expect.any(String));
      expect(entry.effect).toEqual(expect.any(String));
      expect(entry.requires_confirmation).toEqual(expect.any(Boolean));
      expect(entry.input_schema).toBeDefined();
    }

    const ids = new Set(catalog.map((entry) => entry.capability_id));
    expect(ids).not.toContain('customer.find');
    expect(ids).not.toContain('customer.c1.unknown');
    expect(ids).not.toContain('capability.fake');
  });

  it('has no handwritten CLI capability authority', () => {
    const source = readFileSync(new URL('../cli/catalog.ts', import.meta.url), 'utf8');

    expect(source).toContain('PRODUCTION_PLANNER_TOOL_SURFACE');
    expect(source).not.toContain('CLI_CAPABILITIES');
  });

  it('does not invoke the Execution Engine or open a profile database for catalog', async () => {
    const fixture = useTemporaryProfileHome();
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const output: string[] = [];

    const exitCode = await runCli(['--profile', 'sandbox', 'catalog', '--json'], (line) => output.push(line));

    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      ok: true,
      status: 'COMPLETED',
      profile: 'sandbox',
      command: 'catalog',
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('rejects catalog without an explicit profile before creating profile directories', async () => {
    const fixture = useTemporaryProfileHome();
    const output: string[] = [];

    const exitCode = await runCli(['catalog'], (line) => output.push(line));

    expect(exitCode).toBe(5);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' })]);
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });
});
