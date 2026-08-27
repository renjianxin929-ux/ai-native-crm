import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../cli/main';
import { resolvePendingProposalLocation } from '../cli/pendingProposal';
import { openProfileDatabase } from '../cli/profileDb';
import { unbindProfileRuntimeDatabase } from '../lib/db';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const NOW = '2026-08-27T00:00:00.000Z';
const CUSTOMER_ID = 'c5-xinghe';

interface TemporaryProfileHome {
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

function useTemporaryProfileHome(): void {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c5-confirm-'));
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  temporaryHomes.push({
    restore() {
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    },
  });
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

async function seedCustomer(profile: string, customerId = CUSTOMER_ID, name = '广州星河科技'): Promise<void> {
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

async function followUpCount(profile: string): Promise<number> {
  const handle = await openProfileDatabase(profile);
  try {
    const rows = await handle.db.select<{ count: number }>('SELECT COUNT(*) AS count FROM follow_up_records');
    return Number(rows[0]?.count ?? 0);
  } finally {
    await handle.close();
  }
}

async function customerExists(profile: string, customerId = CUSTOMER_ID): Promise<boolean> {
  const handle = await openProfileDatabase(profile);
  try {
    const rows = await handle.db.select<{ id: string }>('SELECT id FROM customers WHERE id = ?', [customerId]);
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

async function createFollowUpProposal(profile = 'sandbox', title = '跨进程跟进'): Promise<string> {
  const result = await invoke([
    '--profile', profile,
    'cap',
    'follow_up.create',
    '--args',
    JSON.stringify({
      customer_id: CUSTOMER_ID,
      title,
      feedback_notes: '仅在确认后写入',
      next_follow_up_at: '2026-09-02T09:00:00+08:00',
    }),
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.envelope).toMatchObject({
    ok: true,
    status: 'CONFIRMATION_REQUIRED',
    profile,
    proposal_id: expect.any(String),
  });
  return result.envelope.proposal_id as string;
}

async function confirm(profile: string, proposalId: string, phrase?: string): Promise<CliResult> {
  return invoke([
    '--profile', profile,
    'confirm',
    '--proposal', proposalId,
    ...(phrase === undefined ? [] : ['--phrase', phrase]),
  ]);
}

beforeAll(() => {
  productionDbBefore = captureProductionDbSentinels();
});

afterEach(() => {
  unbindProfileRuntimeDatabase();
  __resetSessionWriteStateStoreForTests();
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

afterAll(() => {
  expect(captureProductionDbSentinels()).toEqual(productionDbBefore);
});

describe('v0.2.2 C5 cross-process CLI confirm', () => {
  it('rehydrates a normal pending proposal after an emulated process restart, writes once, consumes pending, and preserves READ', async () => {
    const productionBefore = captureProductionDbSentinels();
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const proposalId = await createFollowUpProposal();
    const location = resolvePendingProposalLocation('sandbox', proposalId);
    expect(existsSync(location.path)).toBe(true);
    expect(await followUpCount('sandbox')).toBe(0);

    // A and B are distinct runCli calls; clear the process-local canonical
    // registry in between to model B's fresh Node process.
    __resetSessionWriteStateStoreForTests();
    const result = await confirm('sandbox', proposalId);

    expect(result.exitCode).toBe(0);
    expect(result.envelope).toMatchObject({
      ok: true,
      status: 'COMPLETED',
      command: 'confirm',
      profile: 'sandbox',
      proposal_id: proposalId,
      result: expect.any(Object),
    });
    expect(await followUpCount('sandbox')).toBe(1);
    expect(existsSync(location.path)).toBe(false);

    const search = await invoke([
      '--profile', 'sandbox', 'cap', 'customer.search', '--args', JSON.stringify({ name_query: '星河' }),
    ]);
    expect(search.exitCode).toBe(0);
    expect(search.envelope).toMatchObject({ ok: true, status: 'COMPLETED', capability_id: 'customer.search' });
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('does not rely on an in-memory proposal when reset immediately before B confirm', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const proposalId = await createFollowUpProposal('sandbox', '重启后仍可确认');

    __resetSessionWriteStateStoreForTests();
    const result = await confirm('sandbox', proposalId);

    expect(result.exitCode).toBe(0);
    expect(await followUpCount('sandbox')).toBe(1);
  });

  it('rejects replay/double confirm after consuming the pending record without a second business write', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const proposalId = await createFollowUpProposal();

    __resetSessionWriteStateStoreForTests();
    expect((await confirm('sandbox', proposalId)).exitCode).toBe(0);
    expect(await followUpCount('sandbox')).toBe(1);

    __resetSessionWriteStateStoreForTests();
    const replay = await confirm('sandbox', proposalId);
    expect(replay.exitCode).toBe(7);
    expect(replay.envelope).toEqual({
      ok: false,
      status: 'ERROR',
      code: 'PENDING_PROPOSAL_NOT_FOUND',
    });
    expect(await followUpCount('sandbox')).toBe(1);
  });

  it('keeps pending when the existing safe write fails, with no business-row mutation', async () => {
    useTemporaryProfileHome();
    // C4 can prepare a scoped proposal without a customer row. The existing
    // approved boundary then rejects the FK-bound safe write after exact
    // confirmation; C5 must not consume the pending file in that case.
    const proposalId = await createFollowUpProposal();
    const location = resolvePendingProposalLocation('sandbox', proposalId);
    __resetSessionWriteStateStoreForTests();

    const result = await confirm('sandbox', proposalId);
    expect(result.exitCode).toBe(4);
    expect(result.envelope).toEqual({ ok: false, status: 'ERROR', code: 'CONFIRMATION_FAILED' });
    expect(await followUpCount('sandbox')).toBe(0);
    expect(existsSync(location.path)).toBe(true);
  });

  it('fails closed for profile mismatch, hash mismatch, corrupt JSON, and a missing proposal', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const initialCount = await followUpCount('sandbox');

    const profileProposal = await createFollowUpProposal();
    const sandboxLocation = resolvePendingProposalLocation('sandbox', profileProposal);
    const otherLocation = resolvePendingProposalLocation('other', profileProposal);
    writeFileSync(otherLocation.path, readFileSync(sandboxLocation.path));
    __resetSessionWriteStateStoreForTests();
    const profileMismatch = await confirm('other', profileProposal);
    expect(profileMismatch.exitCode).toBe(4);
    expect(profileMismatch.envelope).toEqual({
      ok: false,
      status: 'ERROR',
      code: 'PENDING_PROPOSAL_PROFILE_MISMATCH',
    });
    expect(await followUpCount('sandbox')).toBe(initialCount);
    expect(existsSync(sandboxLocation.path)).toBe(true);

    const hashProposal = await createFollowUpProposal('sandbox', '被篡改 hash 的 proposal');
    const hashLocation = resolvePendingProposalLocation('sandbox', hashProposal);
    const hashRecord = JSON.parse(readFileSync(hashLocation.path, 'utf8')) as Record<string, unknown>;
    writeFileSync(hashLocation.path, JSON.stringify({ ...hashRecord, proposal_hash: '0'.repeat(64) }), 'utf8');
    __resetSessionWriteStateStoreForTests();
    const hashMismatch = await confirm('sandbox', hashProposal);
    expect(hashMismatch.exitCode).toBe(4);
    expect(hashMismatch.envelope).toEqual({
      ok: false,
      status: 'ERROR',
      code: 'PENDING_PROPOSAL_HASH_MISMATCH',
    });
    expect(await followUpCount('sandbox')).toBe(initialCount);
    expect(existsSync(hashLocation.path)).toBe(true);

    const corruptProposal = await createFollowUpProposal('sandbox', '损坏 JSON 的 proposal');
    const corruptLocation = resolvePendingProposalLocation('sandbox', corruptProposal);
    writeFileSync(corruptLocation.path, '{not-json', 'utf8');
    __resetSessionWriteStateStoreForTests();
    const corrupt = await confirm('sandbox', corruptProposal);
    expect(corrupt.exitCode).toBe(7);
    expect(corrupt.envelope).toEqual({
      ok: false,
      status: 'ERROR',
      code: 'PENDING_PROPOSAL_CORRUPT',
    });
    expect(await followUpCount('sandbox')).toBe(initialCount);
    expect(existsSync(corruptLocation.path)).toBe(true);

    const missing = await confirm('sandbox', 'proposal-does-not-exist');
    expect(missing.exitCode).toBe(7);
    expect(missing.envelope).toEqual({
      ok: false,
      status: 'ERROR',
      code: 'PENDING_PROPOSAL_NOT_FOUND',
    });
    expect(await followUpCount('sandbox')).toBe(initialCount);
  });

  it('requires the existing delete nonce as the strong-confirmation phrase before customer.delete can run', async () => {
    useTemporaryProfileHome();
    await seedCustomer('sandbox');
    const generated = await invoke([
      '--profile', 'sandbox', 'cap', 'customer.delete', '--args', JSON.stringify({ customer_id: CUSTOMER_ID }),
    ]);
    expect(generated.exitCode).toBe(0);
    expect(generated.envelope).toMatchObject({
      ok: true,
      status: 'STRONG_CONFIRMATION_REQUIRED',
      proposal_id: expect.any(String),
    });
    const proposalId = generated.envelope.proposal_id as string;
    const location = resolvePendingProposalLocation('sandbox', proposalId);
    const phrase = (JSON.parse(readFileSync(location.path, 'utf8')) as { nonce?: unknown }).nonce;
    expect(typeof phrase).toBe('string');

    __resetSessionWriteStateStoreForTests();
    const missingPhrase = await confirm('sandbox', proposalId);
    expect(missingPhrase.exitCode).toBe(4);
    expect(missingPhrase.envelope).toEqual({ ok: false, status: 'ERROR', code: 'CONFIRMATION_PHRASE_REQUIRED' });
    expect(await customerExists('sandbox')).toBe(true);

    const wrongPhrase = await confirm('sandbox', proposalId, 'wrong existing nonce');
    expect(wrongPhrase.exitCode).toBe(4);
    expect(wrongPhrase.envelope).toEqual({ ok: false, status: 'ERROR', code: 'CONFIRMATION_PHRASE_MISMATCH' });
    expect(await customerExists('sandbox')).toBe(true);
    expect(existsSync(location.path)).toBe(true);

    __resetSessionWriteStateStoreForTests();
    const success = await confirm('sandbox', proposalId, phrase as string);
    expect(success.exitCode).toBe(0);
    expect(await customerExists('sandbox')).toBe(false);
    expect(existsSync(location.path)).toBe(false);
  });

  it('keeps missing --proposal as an argument error', async () => {
    useTemporaryProfileHome();
    const result = await invoke(['--profile', 'sandbox', 'confirm']);
    expect(result.exitCode).toBe(2);
    expect(result.envelope).toEqual({ ok: false, status: 'ERROR', code: 'ARGUMENT_ERROR' });
  });
});
