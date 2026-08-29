import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runCli } from '../cli/main';
import { resolvePendingProposalLocation } from '../cli/pendingProposal';
import { openProfileDatabase } from '../cli/profileDb';
import { hydrateRuntimeInvocation } from '../cli/runtimeHydrator';
import { unbindProfileRuntimeDatabase } from '../lib/db';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const PROFILE = 'sandbox';
const CUSTOMER_ID = 'c4-opportunity-amount-xinghe';
const NOW = '2026-08-27T00:00:00.000Z';
const ORIGINAL_OPPORTUNITY_AMOUNT = 80000;
const OPPORTUNITY_AMOUNT = 200000;

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
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c4-opportunity-amount-'));
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
        id, name, customer_grade, stage, intent_level, next_follow_up_at,
        industry, opportunity_amount, created_at, updated_at
      ) VALUES (?, ?, 'A', 'QUALIFIED', 'HIGH', ?, ?, ?, ?, ?)`,
      [
        CUSTOMER_ID,
        '广州星河科技',
        '2026-09-06T09:00:00+08:00',
        '原始行业',
        ORIGINAL_OPPORTUNITY_AMOUNT,
        NOW,
        NOW,
      ],
    );
  } finally {
    await handle.close();
  }
}

async function customerRow(profile = PROFILE): Promise<Record<string, unknown>> {
  const handle = await openProfileDatabase(profile);
  try {
    const rows = await handle.db.select<Record<string, unknown>>(
      'SELECT * FROM customers WHERE id = ?',
      [CUSTOMER_ID],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`Missing seeded customer ${CUSTOMER_ID}.`);
    return row;
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

async function runOpportunityAmountUpdate(args: unknown): Promise<CliResult> {
  return invoke([
    '--profile', PROFILE,
    'cap',
    'customer.opportunity_amount.update',
    '--args',
    JSON.stringify(args),
  ]);
}

function readPendingRecord(proposalId: string): Record<string, unknown> {
  const location = resolvePendingProposalLocation(PROFILE, proposalId);
  return JSON.parse(readFileSync(location.path, 'utf8')) as Record<string, unknown>;
}

function assertOnlyOpportunityAmountChanged(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  opportunityAmount: number | null,
): void {
  expect(after.opportunity_amount).toBe(opportunityAmount);
  expect(after.id).toBe(before.id);
  expect(after.name).toBe(before.name);
  expect(after.industry).toBe(before.industry);
  expect(after.next_follow_up_at).toBe(before.next_follow_up_at);

  const allowedChanges = new Set(['opportunity_amount', 'updated_at']);
  for (const [field, value] of Object.entries(before)) {
    if (!allowedChanges.has(field)) expect(after[field]).toEqual(value);
  }
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

describe('v0.2.2 customer.opportunity_amount.update C4/C5 CLI transport', () => {
  it('publishes the capability as supported and still requires an explicit profile', async () => {
    const fixture = useTemporaryProfileHome();
    const catalog = await invoke(['--profile', PROFILE, 'catalog']);
    const capabilities = catalog.envelope.capabilities as readonly Record<string, unknown>[];
    const opportunityAmountUpdate = capabilities.find(
      (entry) => entry.capability_id === 'customer.opportunity_amount.update',
    );

    expect(catalog.exitCode).toBe(0);
    expect(opportunityAmountUpdate).toMatchObject({
      capability_id: 'customer.opportunity_amount.update',
      version: '1.0.0',
      transport: 'SUPPORTED',
      reason: null,
      invocation: 'cap customer.opportunity_amount.update --args <json>',
    });

    const missingProfile = await invoke([
      'cap',
      'customer.opportunity_amount.update',
      '--args',
      JSON.stringify({ customer_id: CUSTOMER_ID, opportunity_amount: OPPORTUNITY_AMOUNT }),
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

    const result = await runOpportunityAmountUpdate({ opportunity_amount: OPPORTUNITY_AMOUNT });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_EXECUTION_NOT_ENABLED' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(existsSync(fixture.profilesRoot)).toBe(false);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it('persists only a pending proposal, projects the scope overlay, and confirms only through C5', async () => {
    const fixture = useTemporaryProfileHome();
    await seedCustomer();
    const before = await customerRow();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const confirmWriteByRef = vi.spyOn(SalesAgentSession.prototype, 'confirmWriteByRef');

    const proposal = await runOpportunityAmountUpdate({
      customer_id: CUSTOMER_ID,
      opportunity_amount: OPPORTUNITY_AMOUNT,
    });

    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'customer.opportunity_amount.update',
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
      capability_id: 'customer.opportunity_amount.update',
      scope: { customer_id: CUSTOMER_ID },
      input: { opportunity_amount: OPPORTUNITY_AMOUNT, db: expect.any(Object) },
    });
    const invocationInput = invocation?.input as Record<string, unknown>;
    expect(invocationInput).not.toHaveProperty('customer_id');
    expect(invocationInput).not.toHaveProperty('customerId');
    expect(Object.keys(invocationInput).sort()).toEqual(['db', 'opportunity_amount']);

    const proposalId = proposal.envelope.proposal_id as string;
    const location = resolvePendingProposalLocation(PROFILE, proposalId);
    const pending = readPendingRecord(proposalId);
    expect(pending).toMatchObject({
      profile: PROFILE,
      proposal_id: proposalId,
      customer_id: CUSTOMER_ID,
      proposed_values: { opportunity_amount: OPPORTUNITY_AMOUNT },
    });
    expect(existsSync(location.path)).toBe(true);
    expect(relative(join(fixture.profilesRoot, PROFILE), location.path)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
    expect(readdirSync(fixture.home).sort()).toEqual(['.localcrm']);
    expect(readdirSync(join(fixture.home, '.localcrm')).sort()).toEqual(['profiles']);
    expect(readdirSync(fixture.profilesRoot).sort()).toEqual([PROFILE]);
    expect(await customerRow()).toEqual(before);
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
    expect(existsSync(location.path)).toBe(false);

    const afterConfirm = await customerRow();
    assertOnlyOpportunityAmountChanged(before, afterConfirm, OPPORTUNITY_AMOUNT);
    expect(afterConfirm.updated_at).not.toBe(before.updated_at);

    __resetSessionWriteStateStoreForTests();
    const replay = await invoke(['--profile', PROFILE, 'confirm', '--proposal', proposalId]);
    expect(replay).toEqual({
      exitCode: 7,
      envelope: { ok: false, status: 'ERROR', code: 'PENDING_PROPOSAL_NOT_FOUND' },
    });
    expect(await customerRow()).toEqual(afterConfirm);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it('keeps the customer unchanged at cap time and records an explicit null only after C5 confirmation', async () => {
    useTemporaryProfileHome();
    await seedCustomer();
    const before = await customerRow();

    const proposal = await runOpportunityAmountUpdate({
      customer_id: CUSTOMER_ID,
      opportunity_amount: null,
    });
    expect(proposal).toMatchObject({
      exitCode: 0,
      envelope: {
        ok: true,
        status: 'CONFIRMATION_REQUIRED',
        capability_id: 'customer.opportunity_amount.update',
      },
    });
    expect(await customerRow()).toEqual(before);

    const proposalId = proposal.envelope.proposal_id as string;
    __resetSessionWriteStateStoreForTests();
    const confirmed = await invoke(['--profile', PROFILE, 'confirm', '--proposal', proposalId]);
    expect(confirmed).toMatchObject({ exitCode: 0, envelope: { ok: true, status: 'COMPLETED' } });

    const afterConfirm = await customerRow();
    assertOnlyOpportunityAmountChanged(before, afterConfirm, null);
    expect(afterConfirm.updated_at).not.toBe(before.updated_at);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it.each([
    ['customerId', CUSTOMER_ID],
    ['name', '广州星河科技'],
    ['industry', '跨境电商'],
    ['next_follow_up_at', '2026-09-10T15:00:00+08:00'],
    ['deal_amount', 300000],
    ['stage', 'QUALIFIED'],
  ] as const)('rejects injected %s without changing the customer row', async (field, value) => {
    useTemporaryProfileHome();
    await seedCustomer();
    const before = await customerRow();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runOpportunityAmountUpdate({
      customer_id: CUSTOMER_ID,
      opportunity_amount: OPPORTUNITY_AMOUNT,
      [field]: value,
    });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(await customerRow()).toEqual(before);
  });

  it.each([
    ['missing opportunity_amount', {}],
    ['undefined opportunity_amount', { opportunity_amount: undefined }],
    ['zero opportunity_amount', { opportunity_amount: 0 }],
    ['negative opportunity_amount', { opportunity_amount: -1 }],
    ['empty-string opportunity_amount', { opportunity_amount: '' }],
    ['numeric-string opportunity_amount', { opportunity_amount: '200000' }],
  ] as const)('rejects %s before Engine.invoke', async (_caseName, businessArgs) => {
    useTemporaryProfileHome();
    await seedCustomer();
    const before = await customerRow();
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    const result = await runOpportunityAmountUpdate({ customer_id: CUSTOMER_ID, ...businessArgs });

    expect(result).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'INVALID_INPUT' },
    });
    expect(engineInvoke).not.toHaveBeenCalled();
    expect(await customerRow()).toEqual(before);
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ] as const)('rejects non-finite %s at the hydrator boundary', async (_caseName, opportunity_amount) => {
    useTemporaryProfileHome();
    await seedCustomer();
    const handle = await openProfileDatabase(PROFILE);
    const engineInvoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    try {
      await expect(hydrateRuntimeInvocation({
        profile: PROFILE,
        profileDb: handle.db,
        capability_id: 'customer.opportunity_amount.update',
        args: { customer_id: CUSTOMER_ID, opportunity_amount },
      })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    } finally {
      await handle.close();
    }

    expect(engineInvoke).not.toHaveBeenCalled();
    expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
  });
});
