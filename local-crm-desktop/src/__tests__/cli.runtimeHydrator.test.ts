import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { defaultDbTripwire } = vi.hoisted(() => ({
  defaultDbTripwire: vi.fn(async () => {
    throw new Error('C2 runtime hydrator must use only its injected profile database.');
  }),
}));

vi.mock('../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/db')>();
  return { ...actual, getDb: defaultDbTripwire };
});

import { hydrateRuntimeInvocation, RuntimeHydratorError } from '../cli/runtimeHydrator';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { initializeDatabaseSchema } from '../lib/db';
import { findPlannerTool } from '../lib/planner/plannerToolSurface';
import { createSqliteDb, seedCustomer } from './battleCard.fixtures';

const NOW = '2026-08-27T00:00:00.000Z';
const CUSTOMER_ID = 'c2-xinghe';

afterEach(() => {
  defaultDbTripwire.mockClear();
  vi.restoreAllMocks();
});

describe('v0.2.2 C2 runtime hydrator', () => {
  it('hydrates customer.search with untouched business filters and the injected profile database', async () => {
    const db = createSqliteDb();
    await initializeDatabaseSchema(db);
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

    try {
      const invocation = await hydrateRuntimeInvocation({
        profile: 'sandbox',
        profileDb: db,
        capability_id: 'customer.search',
        args: {
          name_query: '星河',
          region: '广州',
          industry: '软件',
          customer_grade: 'A',
          list_kind: 'resolution',
        },
        now: NOW,
      });

      const descriptor = findPlannerTool('customer.search');
      expect(descriptor).not.toBeNull();
      expect(invocation.capability_id).toBe('customer.search');
      expect(invocation.capability_version).toBe(descriptor?.version);
      expect(invocation.scope).toEqual({});

      const hydratedInput = invocation.input as {
        readonly filters: Record<string, unknown>;
        readonly list_kind?: string;
        readonly db: unknown;
      };
      expect(hydratedInput.filters).toEqual({
        name_query: '星河',
        region: '广州',
        industry: '软件',
        customer_grade: 'A',
        now: NOW,
      });
      expect(hydratedInput.list_kind).toBe('resolution');
      expect(hydratedInput.db).toBe(db);
      expect(defaultDbTripwire).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('fails closed for customer.get without an explicit customer id or selected session customer', async () => {
    const db = createSqliteDb();
    await initializeDatabaseSchema(db);

    try {
      await expect(hydrateRuntimeInvocation({
        profile: 'sandbox',
        profileDb: db,
        capability_id: 'customer.get',
        args: {},
        session: null,
        now: NOW,
      })).rejects.toMatchObject<RuntimeHydratorError>({ code: 'MISSING_SCOPE' });
      expect(defaultDbTripwire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it.each(['customer.get', 'customer.context'] as const)(
    'uses the selected session customer for %s and builds its read-only snapshot/context from that profile database',
    async (capability_id) => {
      const db = createSqliteDb();
      await initializeDatabaseSchema(db);
      await seedCustomer(db, { id: CUSTOMER_ID, name: '广州星河科技' });
      const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');

      try {
        const invocation = await hydrateRuntimeInvocation({
          profile: 'sandbox',
          profileDb: db,
          capability_id,
          args: {},
          session: { selected_customer_id: CUSTOMER_ID },
          now: NOW,
        });

        expect(invocation.capability_id).toBe(capability_id);
        expect(invocation.scope).toEqual({ customer_id: CUSTOMER_ID });
        const hydratedInput = invocation.input as {
          readonly snapshot: { readonly customers: readonly { readonly id: string }[] };
          readonly context: { readonly customers: readonly { readonly customerId: string }[] };
        };
        expect(hydratedInput.snapshot.customers.map(customer => customer.id)).toEqual([CUSTOMER_ID]);
        expect(hydratedInput.context.customers.map(customer => customer.customerId)).toEqual([CUSTOMER_ID]);
        expect(defaultDbTripwire).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
      } finally {
        db.close();
      }
    },
  );

  it('rejects an unknown capability id without rewriting it to customer.search', async () => {
    const db = createSqliteDb();
    await initializeDatabaseSchema(db);

    try {
      await expect(hydrateRuntimeInvocation({
        profile: 'sandbox',
        profileDb: db,
        capability_id: 'customer.find',
        args: { name_query: '星河' },
        now: NOW,
      })).rejects.toMatchObject<RuntimeHydratorError>({ code: 'CAPABILITY_NOT_FOUND' });
      expect(defaultDbTripwire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('contains no default-database or production-execution path', () => {
    const source = readFileSync(new URL('../cli/runtimeHydrator.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('getDb(');
    expect(source).not.toContain('PRODUCTION_CAPABILITY_EXECUTION');
  });
});
