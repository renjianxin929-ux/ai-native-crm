/**
 * v0.2.2 / C-1 — Headless Node feasibility gate.
 *
 * This is deliberately not a CLI implementation. It proves that the existing
 * capability runtime can be imported and exercised with an explicitly injected
 * in-memory SQLite adapter, while the default Tauri production DB path is a
 * hard test tripwire.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { buildWorkspaceContextSnapshot } from '../lib/context/workspaceContextAdapter';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { createSqliteDb, seedCustomer } from './battleCard.fixtures';

const { defaultDbTripwire } = vi.hoisted(() => ({
  defaultDbTripwire: vi.fn(async () => {
    throw new Error('C-1 forbids default getDb(): sqlite:personal-crm.db must never be opened.');
  }),
}));

// Preserve every real db.ts export except the dangerous default connection.
// Explicit DatabaseLike injection must be the only route used by this gate.
vi.mock('../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/db')>();
  return { ...actual, getDb: defaultDbTripwire };
});

const NOW = '2026-08-26T00:00:00.000Z';
const CUSTOMER_ID = 'c1-guangzhou-xinghe';
const CUSTOMER_NAME = '广州星河科技';

interface ProductionDbSentinel {
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtime_ms?: number;
  readonly sha256?: string;
}

function captureProductionDbSentinel(): readonly ProductionDbSentinel[] {
  const appData = process.env.APPDATA;
  if (!appData) return [];

  const path = join(appData, 'com.localcrm.desktop', 'personal-crm.db');
  if (!existsSync(path)) return [{ path, exists: false }];

  const stat = statSync(path);
  return [{
    path,
    exists: true,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }];
}

function snapshotForSeedCustomer(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'c1-headless-snapshot',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'c1-headless', now: NOW },
    customers: [{
      id: CUSTOMER_ID,
      name: CUSTOMER_NAME,
      customer_grade: 'A',
      intent_level: 'HIGH',
      evidence_ref: {
        type: 'customer',
        id: CUSTOMER_ID,
        label: CUSTOMER_NAME,
        synthetic: false,
        persisted: true,
      },
    }],
    tasks: [],
    work_items: [],
    collected_leads: [],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
}

async function createIsolatedFixture(): Promise<{
  readonly db: DatabaseLike;
  readonly engine_db: DatabaseLike;
  readonly engine_sql: string[];
  readonly close: () => void;
}> {
  const db = createSqliteDb();
  await initializeDatabaseSchema(db);

  const customerTable = await db.select<{ name: string }>(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    ['table', 'customers'],
  );
  expect(customerTable).toEqual([{ name: 'customers' }]);

  await seedCustomer(db, { id: CUSTOMER_ID, name: CUSTOMER_NAME, grade: 'A' });

  const engineSql: string[] = [];
  const engineDb: DatabaseLike = {
    execute: (sql, bindings) => db.execute(sql, bindings),
    select: async <T>(sql: string, bindings?: unknown[]) => {
      engineSql.push(sql);
      return db.select<T>(sql, bindings);
    },
  };

  return { db, engine_db: engineDb, engine_sql: engineSql, close: () => db.close() };
}

let productionDbBefore: readonly ProductionDbSentinel[];

beforeAll(() => {
  defaultDbTripwire.mockClear();
  productionDbBefore = captureProductionDbSentinel();
});

afterAll(() => {
  expect(captureProductionDbSentinel()).toEqual(productionDbBefore);
  expect(defaultDbTripwire).not.toHaveBeenCalled();
});

describe('v0.2.2 C-1 headless capability feasibility', () => {
  it('imports the planner surface and production engine in pure Node', async () => {
    expect('window' in globalThis).toBe(false);
    expect('__TAURI_INTERNALS__' in globalThis).toBe(false);

    const { PRODUCTION_PLANNER_TOOL_SURFACE } = await import('../lib/planner/plannerToolSurface');
    const { PRODUCTION_CAPABILITY_EXECUTION } = await import('../lib/capabilities/execution/production');

    expect(PRODUCTION_PLANNER_TOOL_SURFACE.find((tool) => tool.capability_id === 'customer.search')).toBeDefined();
    expect(PRODUCTION_PLANNER_TOOL_SURFACE.find((tool) => tool.capability_id === 'customer.get')).toBeDefined();
    expect(typeof PRODUCTION_CAPABILITY_EXECUTION.invoke).toBe('function');
  });

  it('runs customer.search and customer.get through the real engine on isolated SQLite', async () => {
    const fixture = await createIsolatedFixture();
    try {
      const { PRODUCTION_PLANNER_TOOL_SURFACE } = await import('../lib/planner/plannerToolSurface');
      const { PRODUCTION_CAPABILITY_EXECUTION } = await import('../lib/capabilities/execution/production');
      const searchTool = PRODUCTION_PLANNER_TOOL_SURFACE.find((tool) => tool.capability_id === 'customer.search');
      const getTool = PRODUCTION_PLANNER_TOOL_SURFACE.find((tool) => tool.capability_id === 'customer.get');

      expect(searchTool).toBeDefined();
      expect(getTool).toBeDefined();
      if (!searchTool || !getTool) throw new Error('Required production planner descriptors are absent.');

      const search = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: searchTool.capability_id,
        capability_version: searchTool.version,
        input: {
          filters: { name_query: '星河', now: NOW },
          list_kind: 'resolution',
          db: fixture.engine_db,
        },
        scope: {},
      });

      expect(search.status).toBe('SUCCESS');
      if (search.status !== 'SUCCESS') throw new Error('customer.search did not reach a successful Engine outcome.');
      expect(search.executor_ref).toBe('salesAgentTool:search_customers');
      expect(search.authority_decision.decision).toBe('ALLOW_AUTO');
      expect(search.payload).toMatchObject({
        tool_id: 'search_customers',
        read_only: true,
        writes_crm: false,
        candidates: [expect.objectContaining({ id: CUSTOMER_ID, name: CUSTOMER_NAME })],
      });
      expect(fixture.engine_sql).toEqual(expect.arrayContaining([
        expect.stringMatching(/FROM customers/i),
        expect.stringMatching(/COUNT\(\*\)/i),
      ]));

      const snapshot = snapshotForSeedCustomer();
      const context = buildWorkspaceContextSnapshot(snapshot);
      const get = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: getTool.capability_id,
        capability_version: getTool.version,
        input: { snapshot, context },
        scope: { customer_id: CUSTOMER_ID },
      });

      expect(get.status).toBe('SUCCESS');
      if (get.status !== 'SUCCESS') throw new Error('customer.get did not reach a successful Engine outcome.');
      expect(get.executor_ref).toBe('salesAgentTool:get_customer');
      expect(get.authority_decision.decision).toBe('ALLOW_AUTO');
      expect(get.payload).toMatchObject({
        tool_id: 'get_customer',
        read_only: true,
        writes_crm: false,
        records: [expect.objectContaining({ id: CUSTOMER_ID, name: CUSTOMER_NAME })],
      });

      const missingScope = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: getTool.capability_id,
        capability_version: getTool.version,
        input: { snapshot, context },
        scope: {},
      });
      expect(missingScope).toMatchObject({
        status: 'EXECUTION_ERROR',
        error_code: 'INVALID_SCOPE',
      });
    } finally {
      fixture.close();
    }
  });

  it('fails closed for an unknown capability instead of correcting it to customer.search', async () => {
    const { PRODUCTION_PLANNER_TOOL_SURFACE } = await import('../lib/planner/plannerToolSurface');
    const { PRODUCTION_CAPABILITY_EXECUTION } = await import('../lib/capabilities/execution/production');
    const knownVersion = PRODUCTION_PLANNER_TOOL_SURFACE.find((tool) => tool.capability_id === 'customer.search')?.version;

    expect(knownVersion).toBeDefined();
    if (!knownVersion) throw new Error('customer.search version is absent from the production planner surface.');

    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.c1.unknown',
      capability_version: knownVersion,
      input: {},
      scope: {},
    });

    expect(outcome).toMatchObject({
      status: 'EXECUTION_ERROR',
      error_code: 'CAPABILITY_NOT_FOUND',
      capability_id: 'customer.c1.unknown',
    });
  });
});
