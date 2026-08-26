#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProfileRuntimeError, validateProfileName } from './profile';
import { openProfileDatabase } from './profileDb';

type CliLineWriter = (line: string) => void;

function writeJson(writeLine: CliLineWriter, value: Record<string, unknown>): void {
  writeLine(JSON.stringify(value));
}

function profileErrorCode(error: unknown): string | undefined {
  return error instanceof ProfileRuntimeError ? error.code : undefined;
}

/**
 * Minimal C0 probe surface. It intentionally has no catalog, capability, or
 * write workflow: callers must choose an explicit profile and profile-status.
 */
export async function runCli(
  argv: readonly string[],
  writeLine: CliLineWriter = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  if (argv[0] !== '--profile') {
    writeJson(writeLine, { ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' });
    return 5;
  }

  const profile = argv[1];
  if (profile === undefined) {
    writeJson(writeLine, { ok: false, status: 'ERROR', code: 'PROFILE_REQUIRED' });
    return 5;
  }

  try {
    validateProfileName(profile);
  } catch (error) {
    writeJson(writeLine, { ok: false, status: 'ERROR', code: profileErrorCode(error) ?? 'PROFILE_INVALID' });
    return 5;
  }

  const command = argv[2];
  if (command === undefined) {
    writeJson(writeLine, { ok: false, status: 'ERROR', code: 'COMMAND_REQUIRED' });
    return 2;
  }
  if (argv.length !== 3) {
    writeJson(writeLine, { ok: false, status: 'ERROR', code: 'ARGUMENT_ERROR' });
    return 2;
  }
  if (command !== 'profile-status') {
    writeJson(writeLine, { ok: false, status: 'ERROR', code: 'UNKNOWN_COMMAND' });
    return 2;
  }

  try {
    const handle = await openProfileDatabase(profile);
    try {
      writeJson(writeLine, {
        ok: true,
        status: 'COMPLETED',
        profile: handle.profile,
        db_path: handle.dbPath,
      });
      return 0;
    } finally {
      await handle.close();
    }
  } catch (error) {
    writeJson(writeLine, {
      ok: false,
      status: 'ERROR',
      code: profileErrorCode(error) ?? 'PROFILE_OPEN_FAILED',
    });
    return 5;
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  void runCli(process.argv.slice(2)).then(
    (exitCode) => { process.exitCode = exitCode; },
    () => {
      process.stdout.write(`${JSON.stringify({ ok: false, status: 'ERROR', code: 'PROFILE_OPEN_FAILED' })}\n`);
      process.exitCode = 5;
    },
  );
}
