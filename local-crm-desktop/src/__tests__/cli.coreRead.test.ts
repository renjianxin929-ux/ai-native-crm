import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCapabilityCatalog } from '../cli/catalog';
import { runCli } from '../cli/main';
import { openProfileDatabase } from '../cli/profileDb';
import { hydrateRuntimeInvocation, RuntimeHydratorError } from '../cli/runtimeHydrator';
import {
  __setDatabaseLoaderForTests,
  bindProfileRuntimeDatabase,
  enableProfileRuntimeFailClosed,
  getDb,
  unbindProfileRuntimeDatabase,
} from '../lib/db';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';

const NOW = '2026-08-27T00:00:00.000Z';
const SANDBOX_CUSTOMER_ID = 'c3-xinghe';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  readonly restore: () => void;
}

interface ProductionDbSentinel {
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly sha256?: string;
}

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c3-core-read-'));
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

function captureProductionDbSentinels(): readonly ProductionDbSentinel[] {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'com.localcrm.desktop', 'personal-crm.db') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'com.localcrm.desktop', 'personal-crm.db') : null,
  ].filter((path): path is string => Boolean(path));

  return candidates.map((path) => {
    if (!existsSync(path)) return { path, exists: false };
    const stats = statSync(path);
    return {
      path,
      exists: true,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
}

async function seedProfileCustomer(
  profile: string,
  customerId: string,
  name: string,
  options: { readonly withReadRecords?: boolean } = {},
): Promise<void> {
  const handle = await openProfileDatabase(profile);
  try {
    await handle.db.execute(
      `INSERT INTO customers (id, name, customer_grade, stage, intent_level, created_at, updated_at)
       VALUES (?, ?, 'A', 'NEW_LEAD', 'HIGH', ?, ?)`,
      [customerId, name, NOW, NOW],
    );
    if (!options.withReadRecords) return;

    await handle.db.execute(
      `INSERT INTO follow_up_records (id, customer_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['c3-follow-up', customerId, 'C3 profile follow-up', NOW, NOW],
    );
    await handle.db.execute(
      `INSERT INTO visit_records (id, customer_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['c3-visit', customerId, 'C3 profile visit', NOW, NOW],
    );
    await handle.db.execute(
      `INSERT INTO tasks (id, customer_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'OPEN', ?, ?)`,
      ['c3-task', customerId, 'C3 profile task', NOW, NOW],
    );
  } finally {
    handle.close();
  }
}

async function runCap(profile: string, capabilityId: string, args?: unknown): Promise<{ readonly exitCode: number; readonly envelope: Record<string, unknown> }> {
  const output: string[] = [];
  const argv = args === undefined
    ? ['--profile', profile, 'cap', capabilityId]
    : ['--profile', profile, 'cap', capabilityId, '--args', JSON.stringify(args)];
  const exitCode = await runCli(argv, line => output.push(line));
  expect(output).toHaveLength(1);
  return { exitCode, envelope: JSON.parse(output[0] ?? '{}') as Record<string, unknown> };
}

afterEach(() => {
  unbindProfileRuntimeDatabase();
  __setDatabaseLoaderForTests(null);
  vi.restoreAllMocks();
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

describe('v0.2.2 C3 core READ capability CLI', () => {
  it('executes customer.search against only the requested profile database', async () => {
    const productionBefore = captureProductionDbSentinels();
    useTemporaryProfileHome();
    await seedProfileCustomer('sandbox', SANDBOX_CUSTOMER_ID, '广州星河科技');
    await seedProfileCustomer('other', 'c3-other', '深圳海潮科技');

    const sandbox = await runCap('sandbox', 'customer.search', { name_query: '星河' });
    const other = await runCap('other', 'customer.search', { name_query: '星河' });
    const optionalNameQuery = await runCap('sandbox', 'customer.search', { customer_grade: 'A' });

    expect(sandbox.exitCode).toBe(0);
    expect(sandbox.envelope).toMatchObject({
      ok: true,
      status: 'COMPLETED',
      capability_id: 'customer.search',
      version: '1.0.0',
      profile: 'sandbox',
    });
    expect((sandbox.envelope.result as { candidates: readonly { id: string }[] }).candidates)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: SANDBOX_CUSTOMER_ID })]));
    expect(other.exitCode).toBe(0);
    expect((other.envelope.result as { candidates: readonly unknown[] }).candidates).toEqual([]);
    expect(optionalNameQuery.exitCode).toBe(0);
    expect((optionalNameQuery.envelope.result as { candidates: readonly { id: string }[] }).candidates)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: SANDBOX_CUSTOMER_ID })]));
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('uses args.customer_id then the selected session customer, and fails closed when neither exists', async () => {
    useTemporaryProfileHome();
    await seedProfileCustomer('sandbox', SANDBOX_CUSTOMER_ID, '广州星河科技');

    const missing = await runCap('sandbox', 'customer.get', {});
    expect(missing.exitCode).toBe(3);
    expect(missing.envelope).toEqual({ ok: false, status: 'ERROR', code: 'MISSING_SCOPE' });

    const explicit = await runCap('sandbox', 'customer.get', { customer_id: SANDBOX_CUSTOMER_ID });
    expect(explicit.exitCode).toBe(0);
    expect(JSON.stringify(explicit.envelope.result)).toContain(SANDBOX_CUSTOMER_ID);

    const sessionOutput: string[] = [];
    expect(await runCli(
      ['--profile', 'sandbox', 'session', 'select-customer', '--id', SANDBOX_CUSTOMER_ID],
      line => sessionOutput.push(line),
    )).toBe(0);
    expect(sessionOutput).toHaveLength(1);

    const selected = await runCap('sandbox', 'customer.get', {});
    expect(selected.exitCode).toBe(0);
    expect(JSON.stringify(selected.envelope.result)).toContain(SANDBOX_CUSTOMER_ID);
  });

  it('binds db.ts reads to the profile database for timeline, follow-up, task, and battle-card reads', async () => {
    const productionBefore = captureProductionDbSentinels();
    useTemporaryProfileHome();
    await seedProfileCustomer('sandbox', SANDBOX_CUSTOMER_ID, '广州星河科技', { withReadRecords: true });
    const fallbackLoader = vi.fn(async () => {
      throw new Error('C3 profile runtime must not reach the default database loader.');
    });
    __setDatabaseLoaderForTests(fallbackLoader);

    const sessionOutput: string[] = [];
    expect(await runCli(
      ['--profile', 'sandbox', 'session', 'select-customer', '--id', SANDBOX_CUSTOMER_ID],
      line => sessionOutput.push(line),
    )).toBe(0);

    const timeline = await runCap('sandbox', 'timeline.customer.read');
    const visits = await runCap('sandbox', 'timeline.visit.read');
    const followUps = await runCap('sandbox', 'follow_up.customer.read');
    const globalFollowUps = await runCap('sandbox', 'follow_up.global.read');
    const tasks = await runCap('sandbox', 'task.read_by_customer');
    const currentCard = await runCap('sandbox', 'battle_card.current.read');
    const cardHistory = await runCap('sandbox', 'battle_card.history.read');
    const cardContext = await runCap('sandbox', 'battle_card.context.read');

    for (const result of [timeline, visits, followUps, globalFollowUps, tasks, currentCard, cardHistory, cardContext]) {
      expect(result.exitCode).toBe(0);
      expect(result.envelope).toMatchObject({ ok: true, status: 'COMPLETED', profile: 'sandbox' });
    }
    expect(JSON.stringify(timeline.envelope.result)).toContain('c3-visit');
    expect(JSON.stringify(followUps.envelope.result)).toContain('c3-follow-up');
    expect(JSON.stringify(globalFollowUps.envelope.result)).toContain('c3-follow-up');
    expect(JSON.stringify(tasks.envelope.result)).toContain('c3-task');
    expect(fallbackLoader).not.toHaveBeenCalled();
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('runs import.mapping.validate through its existing capability without creating customer scope', async () => {
    useTemporaryProfileHome();

    const result = await runCap('sandbox', 'import.mapping.validate', [
      { sourceColumn: '客户名称', crmField: 'name' },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.envelope).toMatchObject({
      ok: true,
      capability_id: 'import.mapping.validate',
      profile: 'sandbox',
      result: { valid: true },
    });
  });

  it('fails closed on a caller version mismatch and keeps global reads out of customer session scope', async () => {
    useTemporaryProfileHome();
    const handle = await openProfileDatabase('sandbox');
    try {
      const globalInvocation = await hydrateRuntimeInvocation({
        profile: 'sandbox',
        profileDb: handle.db,
        capability_id: 'follow_up.global.read',
        args: undefined,
        session: { selected_customer_id: SANDBOX_CUSTOMER_ID },
      });
      expect(globalInvocation.scope).toEqual({});

      await expect(hydrateRuntimeInvocation({
        profile: 'sandbox',
        profileDb: handle.db,
        capability_id: 'customer.search',
        capability_version: '0.0.0',
        args: {},
      })).rejects.toMatchObject<RuntimeHydratorError>({ code: 'CAPABILITY_NOT_FOUND' });
    } finally {
      handle.close();
    }
  });

  it('does not invoke the engine for unknown or still-unwired write capability IDs', async () => {
    useTemporaryProfileHome();
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const unknown = await runCap('sandbox', 'customer.find', { name_query: '星河' });
    const followUpCreate = await runCap('sandbox', 'follow_up.create', { title: 'must not write' });
    const battleCardDraftCreate = await runCap('sandbox', 'battle_card.draft.create', {
      stage_code: 'NEW_LEAD',
    });
    const battleCardDraftCreateTransport = buildCapabilityCatalog()
      .find((entry) => entry.capability_id === 'battle_card.draft.create');
    if (battleCardDraftCreateTransport?.transport !== 'EXPLICITLY_UNSUPPORTED') {
      throw new Error('C7 must keep battle_card.draft.create explicitly unsupported.');
    }

    expect(unknown.exitCode).toBe(2);
    expect(unknown.envelope).toEqual({ ok: false, status: 'ERROR', code: 'CAPABILITY_NOT_FOUND' });
    expect(followUpCreate).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_EXECUTION_NOT_ENABLED' },
    });
    expect(battleCardDraftCreate).toEqual({
      exitCode: 2,
      envelope: {
        ok: false,
        status: 'ERROR',
        code: 'CAPABILITY_EXPLICITLY_UNSUPPORTED',
        capability_id: battleCardDraftCreateTransport.capability_id,
        reason: battleCardDraftCreateTransport.reason,
      },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed before a default database can be initialized, and returns a bound profile handle', async () => {
    const fallbackLoader = vi.fn(async () => {
      throw new Error('Default database loader must not run while C3 is fail-closed.');
    });
    __setDatabaseLoaderForTests(fallbackLoader);

    enableProfileRuntimeFailClosed();
    await expect(getDb()).rejects.toThrow('Profile runtime database is not bound.');
    expect(fallbackLoader).not.toHaveBeenCalled();
    unbindProfileRuntimeDatabase();

    useTemporaryProfileHome();
    const handle = await openProfileDatabase('sandbox');
    try {
      enableProfileRuntimeFailClosed();
      bindProfileRuntimeDatabase(handle.db);
      expect(await getDb()).toBe(handle.db);
      expect(fallbackLoader).not.toHaveBeenCalled();
    } finally {
      unbindProfileRuntimeDatabase();
      handle.close();
    }
  });

  it('keeps catalog identity derived from the production surface and preserves the profile gate', async () => {
    const fixture = useTemporaryProfileHome();
    expect(buildCapabilityCatalog().map(entry => entry.capability_id).sort())
      .toEqual(PRODUCTION_PLANNER_TOOL_SURFACE.map(entry => entry.capability_id).sort());

    const output: string[] = [];
    const exitCode = await runCli(['cap', 'customer.search', '--args', '{"name_query":"星河"}'], line => output.push(line));
    expect(exitCode).toBe(5);
    expect(output).toEqual([JSON.stringify({ ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' })]);
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });
});
