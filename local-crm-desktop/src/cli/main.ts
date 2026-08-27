#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapabilityCatalog } from './catalog';
import {
  formatCapabilityExecutionNotEnabled,
  formatCatalog,
  formatError,
  formatHelp,
  formatProfileStatus,
  formatSession,
} from './format';
import { parseCliArgs } from './parse';
import { ProfileRuntimeError, validateProfileName } from './profile';
import { openProfileDatabase } from './profileDb';
import {
  clearProfileCustomer,
  selectProfileCustomer,
  SessionRuntimeError,
  showProfileSession,
} from './session';

type CliLineWriter = (line: string) => void;

function profileErrorCode(error: unknown): string | undefined {
  return error instanceof ProfileRuntimeError ? error.code : undefined;
}

function sessionErrorCode(error: unknown): string | undefined {
  return error instanceof SessionRuntimeError ? error.code : undefined;
}

/**
 * C1 catalog surface.  The existing C0 profile gate remains first: no command
 * can infer a profile or open a profile database before explicit validation.
 */
export async function runCli(
  argv: readonly string[],
  writeLine: CliLineWriter = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  const parsed = parseCliArgs(argv);
  const profile = parsed.profile;
  if (profile === undefined) {
    writeLine(formatError('PROFILE_REQUIRED'));
    return 5;
  }

  try {
    validateProfileName(profile);
  } catch (error) {
    writeLine(formatError(profileErrorCode(error) ?? 'PROFILE_INVALID'));
    return 5;
  }

  if (!parsed.ok) {
    writeLine(formatError(parsed.code));
    return 2;
  }

  switch (parsed.command.name) {
    case 'catalog':
      writeLine(formatCatalog(profile, buildCapabilityCatalog()));
      return 0;
    case 'help':
      writeLine(formatHelp());
      return 0;
    case 'cap':
      // C1 proves parsing only.  It must never imply that a capability ran.
      writeLine(formatCapabilityExecutionNotEnabled());
      return 2;
    case 'profile-status':
      try {
        const handle = await openProfileDatabase(profile);
        try {
          writeLine(formatProfileStatus(handle.profile, handle.dbPath));
          return 0;
        } finally {
          await handle.close();
        }
      } catch (error) {
        writeLine(formatError(profileErrorCode(error) ?? 'PROFILE_OPEN_FAILED'));
        return 5;
      }
    case 'session':
      try {
        switch (parsed.command.action) {
          case 'show': {
            const session = showProfileSession(profile);
            writeLine(formatSession(profile, 'session.show', session.selected_customer_id));
            return 0;
          }
          case 'select-customer': {
            const session = selectProfileCustomer(profile, parsed.command.customer_id);
            writeLine(formatSession(profile, 'session.select-customer', session.selected_customer_id));
            return 0;
          }
          case 'clear-customer': {
            const session = clearProfileCustomer(profile);
            writeLine(formatSession(profile, 'session.clear-customer', session.selected_customer_id));
            return 0;
          }
        }
      } catch (error) {
        const code = sessionErrorCode(error) ?? profileErrorCode(error);
        writeLine(formatError(code ?? 'SESSION_INVALID'));
        return code?.startsWith('PROFILE_') ? 5 : 2;
      }
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
      process.stdout.write(`${formatError('PROFILE_OPEN_FAILED')}\n`);
      process.exitCode = 5;
    },
  );
}
