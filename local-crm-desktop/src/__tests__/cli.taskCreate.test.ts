import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runCli } from '../cli/main';
import { resolvePendingProposalLocation } from '../cli/pendingProposal';
import { openProfileDatabase } from '../cli/profileDb';
import { unbindProfileRuntimeDatabase } from '../lib/db';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const PROFILE = 'sandbox';
const CUSTOMER_ID = 'c4-task-xinghe';
const NOW = '2026-08-29T00:00:00.000Z';
const TASK_TITLE = '发送报价提醒';
const DUE_AT = '2026-09-03T09:00:00+08:00';

interface TemporaryProfileHome {
  readonly home: string;
  readonly profilesRoot: string;
  restore(): void;
}

interface ProductionDbSentinel {
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly sha256?: string;
}

interface CliResult {
  readonly exitCode: number;
  readonly envelope: Record<string, unknown>;
}

const temporaryHomes: TemporaryProfileHome[] = [];
let productionDbBefore: readonly ProductionDbSentinel[];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c4-task-create-'));
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

async function seedCustomer(profile = PROFILE): Promise<void> {
  const handle = await openProfileDatabase(profile);
  try {
    await handle.db.execute(
      `INSERT INTO customers (
        id, name, customer_grade, stage, intent_level, created_at, updated_at
      ) VALUES (?, ?, 'A', 'QUALIFIED', 'HIGH', ?, ?)`,
      [CUSTOMER_ID, '广州星河科技', NOW, NOW],
    );
  } finally {
    await handle.close();
  }
}

async function taskRows(profile = PROFILE): Promise<readonly Record<string, unknown>[]> {
  const handle = await openProfileDatabase(profile);
  try {
    return handle.db.select<Record<string, unknown>>(
      'SELECT customer_id, title, due_at, status, priority, source FROM tasks ORDER BY rowid ASC',
    );
  } finally {
    await handle.close();
  }
}

async function invoke(argv: readonly string[]): Promise<CliResult> {
  const output: string[] = [];
  const exitCode = await runCli(argv, (line) => output.push(line));
  expect(output).toHaveLength(1);
  return {
    exitCode,
    envelope: JSON.parse(output[0] ?? '{}') as Record<string, unknown>,
  };
}

async function runTaskCreate(args: unknown): Promise<CliResult> {
  return invoke([
    '--profile', PROFILE,
    'cap',
    'task.create',
    '--args',
    JSON.stringify(args),
  ]);
}

function readPendingRecord(proposalId: string): Record<string, unknown> {
  const location = resolvePendingProposalLocation(PROFILE, proposalId);
  return JSON.parse(readFileSync(location.path, 'utf8')) as Record<string, unknown>;
}

beforeAll(() => {
  productionDbBefore = captureProductionDbSentinels();
});

afterEach(() => {
  unbindProfileRuntimeDatabase();
  __resetSessionWriteStateStoreForTests();
  vi.restoreAllMocks();
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

afterAll(() => {
  expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
});

describe('v0.2.2 task.create C4/C5 CLI transport', () => {
  it('publishes task.create as supported and still requires an explicit profile', async () => {
    const fixture = useTemporaryProfileHome();
    const catalog = await invoke(['--profile', PROFILE, 'catalog']);
    const capabilities = catalog.envelope.capabilities as readonly Record<string, unknown>[];
    const taskCreate = capabilities.find((entry) => entry.capability_id === 'task.create');

    expect(catalog.exitCode).toBe(0);
    expect(taskCreate).toMatchObject({
      capability_id: 'task.create',
      version: '1.0.0',
      transport: 'SUPPORTED',
      reason: null,
      invocation: 'cap task.create --args <json>',
    });

    const missingProfile = await invoke([
      'cap',
      'task.create',
      '--args',
      JSON.stringify({ customer_id: CUSTOMER_ID, title: TASK_TITLE }),
    ]);
    expect(missingProfile).toEqual({
      exitCode: 5,
      envelope: { ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' },
    });
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('keeps the existing C4 CUSTOMER admission gate before profile opening or Engine.invoke', async () => {
    const fixture = useTemporaryProfileHome();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runTaskCreate({ title: TASK_TITLE });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_EXECUTION_NOT_ENABLED' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it('persists only a pending task proposal, then confirms it once through C5 and rejects replay', async () => {
    const fixture = useTemporaryProfileHome();
    await seedCustomer();
    const beforeTasks = await taskRows();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const confirmWriteByRef = vi.spyOn(SalesAgentSession.prototype, 'confirmWriteByRef');

    const proposal = await runTaskCreate({ customer_id: CUSTOMER_ID, title: TASK_TITLE });

    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'task.create',
        profile: PROFILE,
        proposal_id: expect.any(String),
        human_summary: expect.any(String),
        diff: expect.any(Object),
      },
    });
    expect(confirmWriteByRef).not.toHaveBeenCalled();
    expect(engineInvoke).toHaveBeenCalledTimes(1);

    const invocation = engineInvoke.mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      capability_id: 'task.create',
      scope: { customer_id: CUSTOMER_ID },
      input: { title: TASK_TITLE },
    });
    const invocationInput = invocation?.input as Record<string, unknown>;
    expect(invocationInput).not.toHaveProperty('db');
    expect(invocationInput).not.toHaveProperty('customer_id');
    expect(invocationInput).not.toHaveProperty('customerId');
    expect(invocationInput).not.toHaveProperty('status');
    expect(invocationInput).not.toHaveProperty('priority');
    expect(invocationInput).not.toHaveProperty('source');
    expect(Object.keys(invocationInput).sort()).toEqual(['title']);

    const proposalId = proposal.envelope.proposal_id as string;
    const location = resolvePendingProposalLocation(PROFILE, proposalId);
    const pending = readPendingRecord(proposalId);
    expect(pending).toMatchObject({
      profile: PROFILE,
      proposal_id: proposalId,
      customer_id: CUSTOMER_ID,
      proposed_values: { title: TASK_TITLE },
    });
    expect(existsSync(location.path)).toBe(true);
    expect(relative(join(fixture.profilesRoot, PROFILE), location.path)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
    expect(readdirSync(fixture.home).sort()).toEqual(['.localcrm']);
    expect(await taskRows()).toEqual(beforeTasks);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);

    // A fresh process rehydrates the immutable pending proposal through C5.
    __resetSessionWriteStateStoreForTests();
    const confirmed = await invoke(['--profile', PROFILE, 'confirm', '--proposal', proposalId]);
    expect(confirmed).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'COMPLETED',
        command: 'confirm',
        profile: PROFILE,
        proposal_id: proposalId,
      },
    });
    expect(confirmWriteByRef).toHaveBeenCalledTimes(1);
    expect(existsSync(location.path)).toBe(false);

    const afterConfirmTasks = await taskRows();
    expect(afterConfirmTasks).toHaveLength(beforeTasks.length + 1);
    expect(afterConfirmTasks.at(-1)).toMatchObject({
      customer_id: CUSTOMER_ID,
      title: TASK_TITLE,
      due_at: null,
    });

    __resetSessionWriteStateStoreForTests();
    const replay = await invoke(['--profile', PROFILE, 'confirm', '--proposal', proposalId]);
    expect(replay).toEqual({
      exitCode: 7,
      envelope: { ok: false, status: 'ERROR', code: 'PENDING_PROPOSAL_NOT_FOUND' },
    });
    expect(await taskRows()).toEqual(afterConfirmTasks);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it('preserves an optional due_at string through C5 confirmation', async () => {
    useTemporaryProfileHome();
    await seedCustomer();
    const beforeTasks = await taskRows();

    const proposal = await runTaskCreate({
      customer_id: CUSTOMER_ID,
      title: TASK_TITLE,
      due_at: DUE_AT,
    });
    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: { ok: true, status: 'CONFIRMATION_REQUIRED', capability_id: 'task.create' },
    });

    __resetSessionWriteStateStoreForTests();
    const confirmed = await invoke([
      '--profile', PROFILE,
      'confirm',
      '--proposal', proposal.envelope.proposal_id as string,
    ]);
    expect(confirmed.exitCode).toBe(0);

    const afterConfirmTasks = await taskRows();
    expect(afterConfirmTasks).toHaveLength(beforeTasks.length + 1);
    expect(afterConfirmTasks.at(-1)).toMatchObject({
      customer_id: CUSTOMER_ID,
      title: TASK_TITLE,
      due_at: DUE_AT,
    });
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it.each([
    ['customerId', CUSTOMER_ID],
    ['status', 'DONE'],
    ['priority', 'HIGH'],
    ['source', 'AUTOMATION'],
    ['visited_at', NOW],
    ['id', 'caller-supplied-id'],
  ] as const)('rejects injected %s before Engine.invoke and leaves tasks empty', async (field, value) => {
    useTemporaryProfileHome();
    await seedCustomer();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runTaskCreate({
      customer_id: CUSTOMER_ID,
      title: TASK_TITLE,
      [field]: value,
    });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(await taskRows()).toEqual([]);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it.each([
    ['missing title', { customer_id: CUSTOMER_ID }],
    ['empty title', { customer_id: CUSTOMER_ID, title: '' }],
    ['whitespace title', { customer_id: CUSTOMER_ID, title: '   ' }],
  ] as const)('rejects %s before Engine.invoke', async (_caseName, args) => {
    useTemporaryProfileHome();
    await seedCustomer();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runTaskCreate(args);

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(await taskRows()).toEqual([]);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it.each([
    ['number', 1],
    ['object', {}],
    ['array', []],
    ['boolean', true],
  ] as const)('rejects a %s due_at before Engine.invoke', async (_caseName, dueAt) => {
    useTemporaryProfileHome();
    await seedCustomer();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runTaskCreate({
      customer_id: CUSTOMER_ID,
      title: TASK_TITLE,
      due_at: dueAt,
    });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(await taskRows()).toEqual([]);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });
});
