import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCapabilityAliases,
  CAPABILITY_ALIASES,
  CapabilityAliasConflictError,
  deriveCapabilityAlias,
  resolveCapabilityAlias,
} from '../cli/alias';
import { buildCapabilityCatalog } from '../cli/catalog';
import { runCli } from '../cli/main';
import { resolvePendingProposalLocation } from '../cli/pendingProposal';
import { parseCliArgs } from '../cli/parse';
import { openProfileDatabase } from '../cli/profileDb';
import { unbindProfileRuntimeDatabase } from '../lib/db';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const NOW = '2026-08-27T00:00:00.000Z';
const CUSTOMER_ID = 'c8-xinghe';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  restore(): void;
}

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c8-alias-'));
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

async function businessRows(profile: string): Promise<Record<string, readonly Record<string, unknown>[]>> {
  const handle = await openProfileDatabase(profile);
  try {
    return {
      customers: await handle.db.select('SELECT id, name, next_follow_up_at, stage, updated_at FROM customers ORDER BY id'),
      follow_up_records: await handle.db.select('SELECT id, customer_id, title, created_at, updated_at FROM follow_up_records ORDER BY id'),
      visit_records: await handle.db.select('SELECT id, customer_id, title, created_at, updated_at FROM visit_records ORDER BY id'),
      tasks: await handle.db.select('SELECT id, customer_id, title, status, created_at, updated_at FROM tasks ORDER BY id'),
    };
  } finally {
    await handle.close();
  }
}

async function runCommand(argv: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly envelope: Record<string, unknown>;
}> {
  const output: string[] = [];
  const exitCode = await runCli(argv, (line) => output.push(line));
  expect(output).toHaveLength(1);
  return {
    exitCode,
    envelope: JSON.parse(output[0] ?? '{}') as Record<string, unknown>,
  };
}

afterEach(() => {
  unbindProfileRuntimeDatabase();
  __resetSessionWriteStateStoreForTests();
  vi.restoreAllMocks();
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

describe('v0.2.2 C8 capability aliases', () => {
  it('lowers customer search to the same internal cap command and result for the same profile and args', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const args = { name_query: '星河' };
    const capArgv = ['--profile', 'sandbox', 'cap', 'customer.search', '--args', JSON.stringify(args)];
    const aliasArgv = ['--profile', 'sandbox', 'customer', 'search', '--args', JSON.stringify(args)];

    expect(parseCliArgs(aliasArgv)).toEqual(parseCliArgs(capArgv));

    const cap = await runCommand(capArgv);
    const alias = await runCommand(aliasArgv);

    const capResult = cap.envelope.result as Record<string, unknown>;
    const aliasResult = alias.envelope.result as Record<string, unknown>;
    expect(alias.exitCode).toBe(cap.exitCode);
    expect(aliasResult.candidates).toEqual(capResult.candidates);
    expect(aliasResult).toMatchObject({
      list_kind: capResult.list_kind,
      has_more: capResult.has_more,
      filters_applied: { name_query: '星河' },
    });
    expect(alias).toMatchObject({
      exitCode: 0,
      envelope: { ok: true, status: 'COMPLETED', capability_id: 'customer.search', profile: 'sandbox' },
    });
  });

  it('lowers follow-up create to the existing pending-proposal path without business-table writes', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const before = await businessRows('sandbox');

    const result = await runCommand([
      '--profile', 'sandbox', 'follow-up', 'create', '--args', JSON.stringify({
        customer_id: CUSTOMER_ID,
        title: 'C8 alias proposal',
      }),
    ]);

    expect(result).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'follow_up.create',
        profile: 'sandbox',
      },
    });
    expect(typeof result.envelope.proposal_id).toBe('string');
    expect(existsSync(resolvePendingProposalLocation('sandbox', result.envelope.proposal_id as string).path)).toBe(true);
    expect(await businessRows('sandbox')).toEqual(before);
  });

  it('preserves the profile gate for aliases before creating a profile directory', async () => {
    const fixture = useTemporaryProfileHome();

    const result = await runCommand(['customer', 'search', '--args', '{"name_query":"星河"}']);

    expect(result).toEqual({
      exitCode: 5,
      envelope: { ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' },
    });
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('fails unknown alias words without correcting them to a nearby capability', async () => {
    const fixture = useTemporaryProfileHome();
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runCommand(['--profile', 'sandbox', 'customer', 'find', '--args', '{"name_query":"星河"}']);

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'ALIAS_NOT_FOUND' },
    });
    expect(parseCliArgs(['--profile', 'sandbox', 'find', 'customer']))
      .toEqual({ ok: false, profile: 'sandbox', code: 'UNKNOWN_COMMAND' });
    expect(parseCliArgs(['--profile', 'sandbox', '查一下星河']))
      .toEqual({ ok: false, profile: 'sandbox', code: 'UNKNOWN_COMMAND' });
    expect(invoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('derives every Planner Surface alias reversibly and preserves the special import file grammar', () => {
    expect(CAPABILITY_ALIASES.map((entry) => entry.capability_id))
      .toEqual(PRODUCTION_PLANNER_TOOL_SURFACE.map((entry) => entry.capability_id));
    expect(deriveCapabilityAlias('customer.search')).toBe('customer search');
    expect(deriveCapabilityAlias('follow_up.create')).toBe('follow-up create');
    expect(deriveCapabilityAlias('follow_up.customer.read')).toBe('follow-up customer read');
    expect(deriveCapabilityAlias('import.file.preview')).toBe('import file preview');

    for (const descriptor of PRODUCTION_PLANNER_TOOL_SURFACE) {
      const alias = deriveCapabilityAlias(descriptor.capability_id);
      expect(resolveCapabilityAlias(alias), alias).toBe(descriptor.capability_id);

      const argv = [
        '--profile',
        'sandbox',
        ...alias.split(' '),
        ...(descriptor.capability_id === 'import.file.preview' ? ['--file', './a.xlsx'] : []),
      ];
      const parsed = parseCliArgs(argv);
      expect(parsed, descriptor.capability_id).toMatchObject({
        ok: true,
        profile: 'sandbox',
        command: { name: 'cap', capability_id: descriptor.capability_id },
      });
      if (descriptor.capability_id === 'import.file.preview') {
        expect(parsed).toMatchObject({ command: { file_path: './a.xlsx' } });
      }
    }
  });

  it('stops alias derivation on a collision and identifies both source IDs', () => {
    let thrown: unknown;
    try {
      buildCapabilityAliases([
        { capability_id: 'foo_bar.search' },
        { capability_id: 'foo-bar.search' },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CapabilityAliasConflictError);
    expect(thrown).toMatchObject({
      alias: 'foo-bar search',
      capability_ids: ['foo_bar.search', 'foo-bar.search'],
    });
  });

  it('keeps an explicitly unsupported capability explicitly unsupported through its alias', async () => {
    const fixture = useTemporaryProfileHome();
    const unsupported = buildCapabilityCatalog().find((entry) => entry.transport === 'EXPLICITLY_UNSUPPORTED');
    if (unsupported === undefined || unsupported.transport !== 'EXPLICITLY_UNSUPPORTED') {
      throw new Error('C8 requires an explicitly unsupported Planner Surface capability.');
    }
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runCommand([
      '--profile',
      'sandbox',
      ...deriveCapabilityAlias(unsupported.capability_id).split(' '),
    ]);

    expect(result).toEqual({
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
  });
});
