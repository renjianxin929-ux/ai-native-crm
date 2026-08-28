import { afterEach, describe, expect, it, vi } from 'vitest';

const { defaultDbTripwire } = vi.hoisted(() => ({
  defaultDbTripwire: vi.fn(async () => {
    throw new Error('C1 cap parsing must not call getDb().');
  }),
}));

vi.mock('../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/db')>();
  return { ...actual, getDb: defaultDbTripwire };
});

import { parseCliArgs } from '../cli/parse';
import { buildCapabilityCatalog } from '../cli/catalog';
import { runCli } from '../cli/main';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';

afterEach(() => {
  defaultDbTripwire.mockClear();
  vi.restoreAllMocks();
});

describe('v0.2.2 C1 CLI parsing', () => {
  it('parses cap customer.search and JSON args', () => {
    const parsed = parseCliArgs([
      '--profile',
      'sandbox',
      'cap',
      'customer.search',
      '--args',
      '{"name_query":"星河"}',
    ]);

    expect(parsed).toEqual({
      ok: true,
      profile: 'sandbox',
      command: {
        name: 'cap',
        capability_id: 'customer.search',
        args: { name_query: '星河' },
      },
    });
  });

  it('preserves JSON fields exactly and does not correct query to an official field', () => {
    const parsed = parseCliArgs([
      '--profile',
      'sandbox',
      'cap',
      'customer.search',
      '--args',
      '{"query":"星河"}',
    ]);

    expect(parsed).toMatchObject({
      ok: true,
      command: {
        name: 'cap',
        capability_id: 'customer.search',
        args: { query: '星河' },
      },
    });
  });

  it('rejects malformed --args JSON', () => {
    expect(parseCliArgs([
      '--profile',
      'sandbox',
      'cap',
      'customer.search',
      '--args',
      '{bad json}',
    ])).toEqual({ ok: false, profile: 'sandbox', code: 'ARGUMENT_ERROR' });
  });

  it('rejects cap without a capability ID', () => {
    expect(parseCliArgs(['--profile', 'sandbox', 'cap']))
      .toEqual({ ok: false, profile: 'sandbox', code: 'ARGUMENT_ERROR' });
  });

  it('preserves an unknown capability ID instead of rewriting it to customer.search', () => {
    expect(parseCliArgs(['--profile', 'sandbox', 'cap', 'customer.find']))
      .toEqual({
        ok: true,
        profile: 'sandbox',
        command: { name: 'cap', capability_id: 'customer.find', args: undefined },
      });
  });

  it('reports malformed command syntax and unknown commands as parser errors', () => {
    expect(parseCliArgs(['--profile', 'sandbox', 'catalog', '--unexpected']))
      .toEqual({ ok: false, profile: 'sandbox', code: 'ARGUMENT_ERROR' });
    expect(parseCliArgs(['--profile', 'sandbox', 'not-a-command']))
      .toEqual({ ok: false, profile: 'sandbox', code: 'UNKNOWN_COMMAND' });
  });

  it('does not execute a parsed unwired write cap command', async () => {
    const invoke = vi.spyOn(PRODUCTION_CAPABILITY_EXECUTION, 'invoke');
    const output: string[] = [];
    const nextFollowUpTimeUpdate = buildCapabilityCatalog()
      .find((entry) => entry.capability_id === 'customer.next_follow_up_time.update');
    if (nextFollowUpTimeUpdate?.transport !== 'EXPLICITLY_UNSUPPORTED') {
      throw new Error('C7 must keep customer.next_follow_up_time.update explicitly unsupported.');
    }

    const exitCode = await runCli([
      '--profile',
      'sandbox',
      'cap',
      'customer.next_follow_up_time.update',
      '--args',
      '{"next_follow_up_at":"2026-09-03T09:00:00+08:00"}',
    ], (line) => output.push(line));

    // C7 rejects an unwired write before profile opening or Engine invocation.
    expect(exitCode).toBe(2);
    expect(output).toEqual([JSON.stringify({
      ok: false,
      status: 'ERROR',
      code: 'CAPABILITY_EXPLICITLY_UNSUPPORTED',
      capability_id: nextFollowUpTimeUpdate.capability_id,
      reason: nextFollowUpTimeUpdate.reason,
    })]);
    expect(defaultDbTripwire).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
