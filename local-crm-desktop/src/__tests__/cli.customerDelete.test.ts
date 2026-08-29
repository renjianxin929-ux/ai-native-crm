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
const CUSTOMER_ID = 'c4-delete-xinghe';
const SECOND_CUSTOMER_ID = 'c4-delete-haiyue';
const NOW = '2026-08-29T00:00:00.000Z';

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
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c4-customer-delete-'));
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

async function seedCustomer(
  customerId: string,
  name: string,
): Promise<void> {
  const handle = await openProfileDatabase(PROFILE);
  try {
    await handle.db.execute(
      `INSERT INTO customers (id, name, customer_grade, stage, intent_level, created_at, updated_at)
       VALUES (?, ?, 'A', 'NEW_LEAD', 'HIGH', ?, ?)`,
      [customerId, name, NOW, NOW],
    );
  } finally {
    await handle.close();
  }
}

async function customerExists(customerId: string): Promise<boolean> {
  const handle = await openProfileDatabase(PROFILE);
  try {
    const rows = await handle.db.select<{ id: string }>(
      'SELECT id FROM customers WHERE id = ?',
      [customerId],
    );
    return rows.length === 1;
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

async function runCustomerDelete(args: unknown): Promise<CliResult> {
  return invoke([
    '--profile', PROFILE,
    'cap',
    'customer.delete',
    '--args',
    JSON.stringify(args),
  ]);
}

async function confirm(proposalId: string, phrase?: string): Promise<CliResult> {
  return invoke([
    '--profile', PROFILE,
    'confirm',
    '--proposal', proposalId,
    ...(phrase === undefined ? [] : ['--phrase', phrase]),
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

describe('v0.2.2 customer.delete C4/C5 CLI transport', () => {
  it('publishes customer.delete as supported and requires an explicit profile without creating profile storage', async () => {
    const fixture = useTemporaryProfileHome();
    const catalog = await invoke(['--profile', PROFILE, 'catalog']);
    const capabilities = catalog.envelope.capabilities as readonly Record<string, unknown>[];
    const customerDelete = capabilities.find((entry) => entry.capability_id === 'customer.delete');

    expect(catalog.exitCode).toBe(0);
    expect(customerDelete).toMatchObject({
      capability_id: 'customer.delete',
      version: '1.0.0',
      transport: 'SUPPORTED',
      reason: null,
      invocation: 'cap customer.delete --args <json>',
    });

    const missingProfile = await invoke([
      'cap',
      'customer.delete',
      '--args',
      JSON.stringify({ customer_id: CUSTOMER_ID }),
    ]);
    expect(missingProfile).toEqual({
      exitCode: 5,
      envelope: { ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' },
    });
    expect(existsSync(fixture.profilesRoot)).toBe(false);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it('keeps the C4 CUSTOMER admission gate ahead of profile opening and Engine.invoke', async () => {
    const fixture = useTemporaryProfileHome();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runCustomerDelete({});

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_EXECUTION_NOT_ENABLED' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it('persists a strong delete proposal, then accepts its pending nonce once through a fresh C5 process', async () => {
    const fixture = useTemporaryProfileHome();
    await seedCustomer(CUSTOMER_ID, '广州星河科技');
    await seedCustomer(SECOND_CUSTOMER_ID, '深圳海岳科技');
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const confirmWriteByRef = vi.spyOn(SalesAgentSession.prototype, 'confirmWriteByRef');

    const proposal = await runCustomerDelete({ customer_id: CUSTOMER_ID });

    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'STRONG_CONFIRMATION_REQUIRED',
        capability_id: 'customer.delete',
        profile: PROFILE,
        proposal_id: expect.any(String),
        human_summary: expect.any(String),
        diff: expect.any(Object),
        confirm_phrase_expected: expect.any(String),
      },
    });
    expect(engineInvoke).toHaveBeenCalledTimes(1);
    expect(confirmWriteByRef).not.toHaveBeenCalled();
    expect(await customerExists(CUSTOMER_ID)).toBe(true);

    const invocation = engineInvoke.mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      capability_id: 'customer.delete',
      scope: { customer_id: CUSTOMER_ID },
      input: { db: expect.any(Object) },
    });
    const invocationInput = invocation?.input as Record<string, unknown>;
    expect(Object.keys(invocationInput).sort()).toEqual(['db']);
    expect(invocationInput).not.toHaveProperty('customer_id');
    expect(invocationInput).not.toHaveProperty('customerId');
    expect(invocationInput).not.toHaveProperty('name');

    const proposalId = proposal.envelope.proposal_id as string;
    const location = resolvePendingProposalLocation(PROFILE, proposalId);
    expect(existsSync(location.path)).toBe(true);
    expect(relative(join(fixture.profilesRoot, PROFILE), location.path)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
    expect(readdirSync(fixture.home).sort()).toEqual(['.localcrm']);

    const pending = readPendingRecord(proposalId);
    expect(pending).toMatchObject({
      profile: PROFILE,
      proposal_id: proposalId,
      customer_id: CUSTOMER_ID,
      nonce: expect.any(String),
    });
    const nonce = pending.nonce;
    if (typeof nonce !== 'string' || nonce.trim().length === 0) {
      throw new Error('customer.delete pending proposal must retain a non-empty nonce.');
    }
    expect(proposal.envelope.confirm_phrase_expected).toBe(nonce);
    expect(await customerExists(SECOND_CUSTOMER_ID)).toBe(true);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);

    const missingPhrase = await confirm(proposalId);
    expect(missingPhrase).toEqual({
      exitCode: 4,
      envelope: { ok: false, status: 'ERROR', code: 'CONFIRMATION_PHRASE_REQUIRED' },
    });
    expect(confirmWriteByRef).not.toHaveBeenCalled();
    expect(await customerExists(CUSTOMER_ID)).toBe(true);
    expect(existsSync(location.path)).toBe(true);

    // Model a separate human CLI process: restore only the immutable pending record.
    __resetSessionWriteStateStoreForTests();
    const confirmed = await confirm(proposalId, nonce);
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
    expect(await customerExists(CUSTOMER_ID)).toBe(false);
    expect(await customerExists(SECOND_CUSTOMER_ID)).toBe(true);
    expect(existsSync(location.path)).toBe(false);

    __resetSessionWriteStateStoreForTests();
    const replay = await confirm(proposalId, nonce);
    expect(replay).toEqual({
      exitCode: 7,
      envelope: { ok: false, status: 'ERROR', code: 'PENDING_PROPOSAL_NOT_FOUND' },
    });
    expect(confirmWriteByRef).toHaveBeenCalledTimes(1);
    expect(await customerExists(CUSTOMER_ID)).toBe(false);
    expect(await customerExists(SECOND_CUSTOMER_ID)).toBe(true);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it.each([
    ['customerId', CUSTOMER_ID],
    ['name', '广州星河科技'],
  ] as const)('rejects injected %s without deleting the scoped customer', async (field, value) => {
    useTemporaryProfileHome();
    await seedCustomer(CUSTOMER_ID, '广州星河科技');
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runCustomerDelete({
      customer_id: CUSTOMER_ID,
      [field]: value,
    });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(await customerExists(CUSTOMER_ID)).toBe(true);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });
});
