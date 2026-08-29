import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCapabilityCatalog } from '../cli/catalog';
import { runCli } from '../cli/main';
import { openProfileDatabase } from '../cli/profileDb';
import { unbindProfileRuntimeDatabase } from '../lib/db';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const NOW = '2026-08-27T00:00:00.000Z';
const CUSTOMER_ID = 'c7-xinghe';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  restore(): void;
}

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c7-capability-transport-'));
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

async function seedCustomer(profile: string): Promise<void> {
  const handle = await openProfileDatabase(profile);
  try {
    await handle.db.execute(
      `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, created_at, updated_at)
       VALUES (?, ?, 'A', 'NEW_LEAD', 'HIGH', ?, ?, ?)`,
      [CUSTOMER_ID, '广州星河科技', '2026-09-01T09:00:00+08:00', NOW, NOW],
    );
  } finally {
    await handle.close();
  }
}

async function runCap(
  profile: string,
  capabilityId: string,
  args: unknown,
): Promise<{ readonly exitCode: number; readonly envelope: Record<string, unknown> }> {
  const output: string[] = [];
  const exitCode = await runCli(
    ['--profile', profile, 'cap', capabilityId, '--args', JSON.stringify(args)],
    (line) => output.push(line),
  );
  expect(output).toHaveLength(1);
  return { exitCode, envelope: JSON.parse(output[0] ?? '{}') as Record<string, unknown> };
}

afterEach(() => {
  unbindProfileRuntimeDatabase();
  __resetSessionWriteStateStoreForTests();
  vi.restoreAllMocks();
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

describe('v0.2.2 C7 capability transport status', () => {
  it('projects every Planner Surface capability with transport status and the special file invocation', async () => {
    const fixture = useTemporaryProfileHome();
    const output: string[] = [];

    const exitCode = await runCli(['--profile', 'sandbox', 'catalog'], (line) => output.push(line));

    expect(exitCode).toBe(0);
    expect(output).toHaveLength(1);
    const envelope = JSON.parse(output[0] ?? '{}') as { readonly capabilities: readonly Record<string, unknown>[] };
    const catalog = envelope.capabilities;
    expect(catalog.map((entry) => entry.capability_id).sort())
      .toEqual(PRODUCTION_PLANNER_TOOL_SURFACE.map((entry) => entry.capability_id).sort());
    for (const entry of catalog) {
      expect(entry.transport).toMatch(/^(SUPPORTED|EXPLICITLY_UNSUPPORTED)$/u);
      if (entry.transport === 'SUPPORTED') {
        expect(entry.reason).toBeNull();
        expect(entry.invocation).toEqual(expect.any(String));
      } else {
        expect(entry.reason).toEqual(expect.any(String));
        expect(entry.invocation).toBeNull();
      }
    }
    expect(catalog.find((entry) => entry.capability_id === 'import.file.preview')).toMatchObject({
      transport: 'SUPPORTED',
      reason: null,
      invocation: 'cap import.file.preview --file <path>',
    });
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('keeps the existing C3 search and C4 proposal transports working', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');

    const search = await runCap('sandbox', 'customer.search', { name_query: '星河' });
    const proposal = await runCap('sandbox', 'follow_up.create', {
      customer_id: CUSTOMER_ID,
      title: 'C7 transport proposal',
    });

    expect(search).toMatchObject({
      exitCode: 0,
      envelope: { ok: true, status: 'COMPLETED', capability_id: 'customer.search' },
    });
    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'follow_up.create',
      },
    });
  });

  it('fails known but unwired capabilities before Engine.invoke and preserves unknown-ID behavior', async () => {
    const fixture = useTemporaryProfileHome();
    const unsupported = buildCapabilityCatalog()
      .find((entry) => entry.capability_id === 'battle_card.draft.create');
    if (unsupported?.transport !== 'EXPLICITLY_UNSUPPORTED') {
      throw new Error('C7 must keep battle_card.draft.create explicitly unsupported.');
    }
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const rejected = await runCap('sandbox', unsupported.capability_id, {});
    expect(rejected).toEqual({
      exitCode: 2,
      envelope: {
        ok: false,
        status: 'ERROR',
        code: 'CAPABILITY_EXPLICITLY_UNSUPPORTED',
        capability_id: unsupported.capability_id,
        reason: unsupported.reason,
      },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);

    const unknown = await runCap('sandbox', 'customer.find', {});
    expect(unknown).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_NOT_FOUND' },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('documents catalog transport states in help', async () => {
    const output: string[] = [];

    const exitCode = await runCli(['--profile', 'sandbox', 'help'], (line) => output.push(line));

    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      catalog_transport: 'catalog marks every capability as SUPPORTED or EXPLICITLY_UNSUPPORTED',
    });
  });

  it('derives support from the existing C3/C4 predicates instead of a third capability-ID array', () => {
    const source = readFileSync(new URL('../cli/capabilityTransport.ts', import.meta.url), 'utf8');
    const literalCapabilityIds = [...source.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/gu)]
      .map((match) => match[1]);

    expect(source).toContain('isC3CoreReadCapability');
    expect(source).toContain('isC4WriteProposalCapability');
    // The sole literal is the documented special --file invocation, not an ID
    // array. Every support decision delegates to the existing C3/C4 slices.
    expect(literalCapabilityIds).toEqual(['import.file.preview']);
    expect(source).not.toMatch(/\b(?:const|let|var)\s+\w*(?:CAPABILITY_IDS|CAPABILITIES)\w*\s*=\s*(?:Object\.freeze\()?\s*\[/u);
  });
});
