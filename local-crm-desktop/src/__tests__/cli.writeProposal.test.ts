import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../cli/main';
import { resolvePendingProposalLocation, persistPendingProposal } from '../cli/pendingProposal';
import { openProfileDatabase } from '../cli/profileDb';
import {
  __setDatabaseLoaderForTests,
  enableProfileRuntimeFailClosed,
  getDb,
  unbindProfileRuntimeDatabase,
} from '../lib/db';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const NOW = '2026-08-27T00:00:00.000Z';
const CUSTOMER_ID = 'c4-xinghe';

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

const temporaryHomes: TemporaryProfileHome[] = [];

function useTemporaryProfileHome(): TemporaryProfileHome {
  const home = mkdtempSync(join(tmpdir(), 'localcrm-c4-write-proposal-'));
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

async function seedProfileRows(profile: string, customerId = CUSTOMER_ID, name = '广州星河科技'): Promise<void> {
  const handle = await openProfileDatabase(profile);
  try {
    await handle.db.execute(
      `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, created_at, updated_at)
       VALUES (?, ?, 'A', 'NEW_LEAD', 'HIGH', ?, ?, ?)`,
      [customerId, name, '2026-09-01T09:00:00+08:00', NOW, NOW],
    );
    await handle.db.execute(
      `INSERT INTO follow_up_records (id, customer_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [`${customerId}-follow-up`, customerId, '既有跟进', NOW, NOW],
    );
    await handle.db.execute(
      `INSERT INTO visit_records (id, customer_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [`${customerId}-visit`, customerId, '既有拜访', NOW, NOW],
    );
    await handle.db.execute(
      `INSERT INTO tasks (id, customer_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'OPEN', ?, ?)`,
      [`${customerId}-task`, customerId, '既有任务', NOW, NOW],
    );
  } finally {
    handle.close();
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
    handle.close();
  }
}

async function runCap(
  profile: string,
  capabilityId: string,
  args?: unknown,
): Promise<{ readonly exitCode: number; readonly envelope: Record<string, unknown> }> {
  const output: string[] = [];
  const argv = args === undefined
    ? ['--profile', profile, 'cap', capabilityId]
    : ['--profile', profile, 'cap', capabilityId, '--args', JSON.stringify(args)];
  const exitCode = await runCli(argv, (line) => output.push(line));
  expect(output).toHaveLength(1);
  return { exitCode, envelope: JSON.parse(output[0] ?? '{}') as Record<string, unknown> };
}

function readPendingRecord(profile: string, proposalId: string): Record<string, unknown> {
  const location = resolvePendingProposalLocation(profile, proposalId);
  return JSON.parse(readFileSync(location.path, 'utf8')) as Record<string, unknown>;
}

function pendingFixtureProposal(proposalId: string): AgentWriteProposal {
  return {
    proposal_id: proposalId,
    proposal_hash: 'a'.repeat(64),
    tool_id: 'create_follow_up_record',
    customer_id: CUSTOMER_ID,
    entity_type: 'follow_up',
    operation: 'create',
    current_values: {},
    proposed_values: { title: '仅用于路径校验' },
    reason: 'test',
    evidence_refs: [],
    reversible: true,
    nonce: 'existing-nonce',
    created_at: NOW,
    status: 'awaiting_confirmation',
    executable: false,
    requires_confirmation: true,
  };
}

afterEach(() => {
  unbindProfileRuntimeDatabase();
  __setDatabaseLoaderForTests(null);
  __resetSessionWriteStateStoreForTests();
  vi.restoreAllMocks();
  while (temporaryHomes.length > 0) temporaryHomes.pop()?.restore();
});

describe('v0.2.2 C4 write proposal persistence', () => {
  it('persists a normal follow-up proposal in its profile pending directory with zero business-table changes', async () => {
    const productionBefore = captureProductionDbSentinels();
    useTemporaryProfileHome();
    await seedProfileRows('sandbox');
    const before = await businessRows('sandbox');

    const result = await runCap('sandbox', 'follow_up.create', {
      customer_id: CUSTOMER_ID,
      title: '确认前的跟进建议',
      feedback_notes: '仅生成 proposal',
      next_follow_up_at: '2026-09-02T09:00:00+08:00',
    });

    expect(result.exitCode).toBe(0);
    expect(result.envelope).toMatchObject({
      ok: true,
      status: 'CONFIRMATION_REQUIRED',
      capability_id: 'follow_up.create',
      profile: 'sandbox',
      human_summary: expect.any(String),
      diff: expect.any(Object),
    });
    const proposalId = result.envelope.proposal_id;
    expect(typeof proposalId).toBe('string');
    const location = resolvePendingProposalLocation('sandbox', proposalId as string);
    expect(relative(location.pendingDir, location.path)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
    expect(existsSync(location.path)).toBe(true);

    const pending = readPendingRecord('sandbox', proposalId as string);
    expect(pending).toMatchObject({
      profile: 'sandbox',
      proposal_id: proposalId,
      proposal_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      nonce: expect.any(String),
      created_at: expect.any(String),
    });
    expect(await businessRows('sandbox')).toEqual(before);
    expect(captureProductionDbSentinels()).toEqual(productionBefore);
  });

  it('keeps pending proposals profile-isolated and leaves the strong-delete business rows untouched', async () => {
    useTemporaryProfileHome();
    await seedProfileRows('sandbox');
    await seedProfileRows('other', 'c4-other', '深圳海潮科技');
    const before = await businessRows('sandbox');

    const normal = await runCap('other', 'follow_up.create', {
      customer_id: 'c4-other',
      title: 'other profile proposal',
    });
    const strong = await runCap('sandbox', 'customer.delete', { customer_id: CUSTOMER_ID });

    expect(normal.exitCode).toBe(0);
    expect(strong.exitCode).toBe(0);
    expect(strong.envelope).toMatchObject({
      ok: true,
      status: 'STRONG_CONFIRMATION_REQUIRED',
      capability_id: 'customer.delete',
      profile: 'sandbox',
      confirm_phrase_expected: expect.any(String),
    });
    const normalId = normal.envelope.proposal_id as string;
    const strongId = strong.envelope.proposal_id as string;
    const normalLocation = resolvePendingProposalLocation('other', normalId);
    const strongLocation = resolvePendingProposalLocation('sandbox', strongId);
    expect(normalLocation.pendingDir).not.toBe(strongLocation.pendingDir);
    expect(readPendingRecord('other', normalId)).toMatchObject({ profile: 'other', proposal_id: normalId });
    const pendingStrong = readPendingRecord('sandbox', strongId);
    expect(pendingStrong).toMatchObject({ profile: 'sandbox', proposal_id: strongId });
    expect(strong.envelope.confirm_phrase_expected).toBe(pendingStrong.nonce);
    expect(await businessRows('sandbox')).toEqual(before);
  });

  it('confirms through C5, preserves C3 read behavior, and keeps customer.find closed', async () => {
    useTemporaryProfileHome();
    await seedProfileRows('sandbox');
    const before = await businessRows('sandbox');
    const proposal = await runCap('sandbox', 'follow_up.create', {
      customer_id: CUSTOMER_ID,
      title: '待确认跟进',
    });

    const output: string[] = [];
    const confirmExit = await runCli(
      ['--profile', 'sandbox', 'confirm', '--proposal', proposal.envelope.proposal_id as string],
      (line) => output.push(line),
    );
    expect(confirmExit).toBe(0);
    expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
      ok: true,
      status: 'COMPLETED',
      command: 'confirm',
      profile: 'sandbox',
      proposal_id: proposal.envelope.proposal_id,
    });
    const afterConfirm = await businessRows('sandbox');
    expect(afterConfirm.follow_up_records).toHaveLength(before.follow_up_records.length + 1);

    const unknown = await runCap('sandbox', 'customer.find', { name_query: '星河' });
    expect(unknown).toEqual({
      exitCode: 2,
      envelope: { ok: false, status: 'ERROR', code: 'CAPABILITY_NOT_FOUND' },
    });
    const search = await runCap('sandbox', 'customer.search', { name_query: '星河' });
    expect(search.exitCode).toBe(0);
    expect(search.envelope).toMatchObject({ ok: true, status: 'COMPLETED', capability_id: 'customer.search' });
  });

  it('remains fail-closed while unbound and rejects corrupted or escaping proposal IDs without writing outside pending', async () => {
    const fixture = useTemporaryProfileHome();
    const fallbackLoader = vi.fn(async () => {
      throw new Error('C4 must not open the default production database while unbound.');
    });
    __setDatabaseLoaderForTests(fallbackLoader);
    enableProfileRuntimeFailClosed();
    await expect(getDb()).rejects.toThrow('Profile runtime database is not bound.');
    expect(fallbackLoader).not.toHaveBeenCalled();
    unbindProfileRuntimeDatabase();

    const handle = await openProfileDatabase('sandbox');
    handle.close();
    expect(() => persistPendingProposal('sandbox', pendingFixtureProposal('../escape')))
      .toThrow('Pending proposal id is invalid.');
    expect(() => persistPendingProposal('sandbox', {
      ...pendingFixtureProposal('proposal-corrupt'),
      proposal_hash: '',
    })).toThrow('Canonical proposal is incomplete for persistence.');
    expect(existsSync(join(fixture.home, 'escape.json'))).toBe(false);
    expect(existsSync(join(fixture.profilesRoot, 'escape.json'))).toBe(false);
  });
});
