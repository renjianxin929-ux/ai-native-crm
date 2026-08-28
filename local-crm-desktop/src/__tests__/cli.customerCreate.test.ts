import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

const NOW = '2026-08-27T00:00:00.000Z';
const SEEDED_CUSTOMER_ID = 'customer-create-existing';
const NEW_CUSTOMER_NAME = '广州星河科技';

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
  const home = mkdtempSync(join(tmpdir(), 'localcrm-customer-create-'));
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
  profile: string,
  customerId = SEEDED_CUSTOMER_ID,
  name = '杭州已有客户',
): Promise<void> {
  const handle = await openProfileDatabase(profile);
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

async function customerRows(profile: string): Promise<readonly Record<string, unknown>[]> {
  const handle = await openProfileDatabase(profile);
  try {
    return handle.db.select('SELECT id, name, customer_grade, stage, intent_level, created_at, updated_at FROM customers ORDER BY id');
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

async function runCap(profile: string, capabilityId: string, args?: unknown): Promise<CliResult> {
  return invoke(args === undefined
    ? ['--profile', profile, 'cap', capabilityId]
    : ['--profile', profile, 'cap', capabilityId, '--args', JSON.stringify(args)]);
}

function readPendingRecord(profile: string, proposalId: string): Record<string, unknown> {
  const location = resolvePendingProposalLocation(profile, proposalId);
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

describe('v0.2.2 customer.create C4/C5 CLI transport', () => {
  it('publishes customer.create as supported while preserving profile, unknown-ID, and unwired-write gates', async () => {
    const fixture = useTemporaryProfileHome();
    const catalog = await invoke(['--profile', 'sandbox', 'catalog']);
    const capabilities = catalog.envelope.capabilities as readonly Record<string, unknown>[];
    const create = capabilities.find((entry) => entry.capability_id === 'customer.create');

    expect(catalog.exitCode).toBe(0);
    expect(create).toMatchObject({
      capability_id: 'customer.create',
      version: '1.0.0',
      transport: 'SUPPORTED',
      reason: null,
      invocation: 'cap customer.create --args <json>',
    });

    const missingProfile = await invoke(['cap', 'customer.create', '--args', JSON.stringify({ name: NEW_CUSTOMER_NAME })]);
    expect(missingProfile).toEqual({
      exitCode: 5,
      envelope: { ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' },
    });

    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const unknown = await runCap('sandbox', 'customer.find', { name_query: '星河' });
    expect(unknown).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_NOT_FOUND' },
    });

    const unwired = await runCap('sandbox', 'visit.create', {
      title: 'must remain unwired',
    });
    expect(unwired).toMatchObject({
      exitCode: 2,
      envelope: {
        ok: false,
        status: 'ERROR',
        code: 'CAPABILITY_EXPLICITLY_UNSUPPORTED',
        capability_id: 'visit.create',
        reason: expect.any(String),
      },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);
  });

  it('rejects missing names and customer selectors before any customer-table mutation', async () => {
    useTemporaryProfileHome();
    const productionBefore = captureProductionDbSentinels();
    await seedCustomer('sandbox');
    const before = await customerRows('sandbox');

    const missingName = await runCap('sandbox', 'customer.create', {});
    expect(missingName).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });

    const selector = await runCap('sandbox', 'customer.create', {
      name: NEW_CUSTOMER_NAME,
      customer_id: SEEDED_CUSTOMER_ID,
    });
    expect(selector).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });

    const camelSelector = await runCap('sandbox', 'customer.create', {
      name: NEW_CUSTOMER_NAME,
      customerId: SEEDED_CUSTOMER_ID,
    });
    expect(camelSelector).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(await customerRows('sandbox')).toEqual(before);
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('ignores a selected customer, persists the existing create proposal, and never confirms from the cap path', async () => {
    useTemporaryProfileHome();
    const productionBefore = captureProductionDbSentinels();
    await seedCustomer('sandbox');
    const before = await customerRows('sandbox');

    const selected = await invoke([
      '--profile', 'sandbox', 'session', 'select-customer', '--id', SEEDED_CUSTOMER_ID,
    ]);
    expect(selected).toMatchObject({
      exitCode: 0,
      envelope: { ok: true, status: 'COMPLETED', selected_customer_id: SEEDED_CUSTOMER_ID },
    });

    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const confirmWriteByRef = vi.spyOn(SalesAgentSession.prototype, 'confirmWriteByRef');
    const result = await runCap('sandbox', 'customer.create', { name: NEW_CUSTOMER_NAME });

    expect(result).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'customer.create',
        profile: 'sandbox',
        proposal_id: expect.any(String),
        human_summary: expect.any(String),
        diff: expect.any(Object),
      },
    });
    expect(engineInvoke).toHaveBeenCalledWith(expect.objectContaining({
      capability_id: 'customer.create',
      input: { name: NEW_CUSTOMER_NAME },
      scope: {},
    }));
    expect(confirmWriteByRef).not.toHaveBeenCalled();

    const proposalId = result.envelope.proposal_id as string;
    const location = resolvePendingProposalLocation('sandbox', proposalId);
    expect(relative(location.pendingDir, location.path)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
    expect(existsSync(location.path)).toBe(true);

    const pending = readPendingRecord('sandbox', proposalId);
    expect(pending).toMatchObject({
      profile: 'sandbox',
      proposal_id: proposalId,
      customer_id: expect.any(String),
      proposed_values: { name: NEW_CUSTOMER_NAME },
    });
    expect(pending.customer_id).not.toBe(SEEDED_CUSTOMER_ID);
    expect(await customerRows('sandbox')).toEqual(before);
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('rehydrates a create proposal for human confirmation, writes once, and rejects replay', async () => {
    useTemporaryProfileHome();
    const productionBefore = captureProductionDbSentinels();
    await seedCustomer('sandbox');
    const before = await customerRows('sandbox');

    const proposal = await runCap('sandbox', 'customer.create', { name: NEW_CUSTOMER_NAME });
    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'customer.create',
        proposal_id: expect.any(String),
      },
    });
    expect(proposal.envelope).not.toHaveProperty('confirm_phrase_expected');
    const proposalId = proposal.envelope.proposal_id as string;
    const location = resolvePendingProposalLocation('sandbox', proposalId);
    expect(existsSync(location.path)).toBe(true);
    const pendingCustomerId = readPendingRecord('sandbox', proposalId).customer_id;
    expect(typeof pendingCustomerId).toBe('string');
    if (typeof pendingCustomerId !== 'string' || pendingCustomerId.trim().length === 0) {
      throw new Error('customer.create pending proposal must retain a customer_id.');
    }
    expect(await customerRows('sandbox')).toEqual(before);

    // Model a separate human process: no in-memory canonical proposal remains.
    __resetSessionWriteStateStoreForTests();
    const confirmed = await invoke(['--profile', 'sandbox', 'confirm', '--proposal', proposalId]);
    expect(confirmed).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'COMPLETED',
        command: 'confirm',
        profile: 'sandbox',
        proposal_id: proposalId,
      },
    });
    expect(existsSync(location.path)).toBe(false);
    const afterConfirm = await customerRows('sandbox');
    expect(afterConfirm).toHaveLength(before.length + 1);
    const createdCustomer = afterConfirm.find((row) => row.name === NEW_CUSTOMER_NAME);
    expect(createdCustomer).toMatchObject({ id: pendingCustomerId, name: NEW_CUSTOMER_NAME });

    const search = await runCap('sandbox', 'customer.search', { name_query: '星河' });
    expect(search).toMatchObject({
      exitCode: 0,
      envelope: { ok: true, status: 'COMPLETED', capability_id: 'customer.search' },
    });
    const searchResult = search.envelope.result as { readonly candidates?: readonly Record<string, unknown>[] };
    expect(searchResult.candidates).toContainEqual(expect.objectContaining({ name: NEW_CUSTOMER_NAME }));

    __resetSessionWriteStateStoreForTests();
    const replay = await invoke(['--profile', 'sandbox', 'confirm', '--proposal', proposalId]);
    expect(replay).toEqual({
      exitCode: 7,
      envelope: { ok: false, status: 'ERROR', code: 'PENDING_PROPOSAL_NOT_FOUND' },
    });
    expect(await customerRows('sandbox')).toEqual(afterConfirm);
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('preserves the existing follow_up.create and customer.delete proposal behavior', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const before = await customerRows('sandbox');

    const followUp = await runCap('sandbox', 'follow_up.create', {
      customer_id: SEEDED_CUSTOMER_ID,
      title: '原有跟进提案',
    });
    expect(followUp).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'follow_up.create',
      },
    });

    const deletion = await runCap('sandbox', 'customer.delete', { customer_id: SEEDED_CUSTOMER_ID });
    expect(deletion).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'STRONG_CONFIRMATION_REQUIRED',
        capability_id: 'customer.delete',
        confirm_phrase_expected: expect.any(String),
      },
    });
    expect(await customerRows('sandbox')).toEqual(before);
  });
});
