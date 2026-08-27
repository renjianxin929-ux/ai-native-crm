#!/usr/bin/env node

import { File as NodeFile } from 'node:buffer';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapabilityCatalog } from './catalog';
import {
  formatCapabilityResult,
  formatCapabilityConfirmationRequired,
  formatCapabilityExecutionNotEnabled,
  formatCatalog,
  formatError,
  formatHelp,
  formatProfileStatus,
  formatSession,
} from './format';
import { parseCliArgs, type ParsedCliCommand } from './parse';
import { ProfileRuntimeError, validateProfileName } from './profile';
import { openProfileDatabase } from './profileDb';
import {
  hydrateRuntimeInvocation,
  isC4WriteProposalCapability,
  isC3CoreReadCapability,
  RuntimeHydratorError,
} from './runtimeHydrator';
import { persistPendingProposal, PendingProposalError } from './pendingProposal';
import {
  clearProfileCustomer,
  selectProfileCustomer,
  SessionRuntimeError,
  showProfileSession,
} from './session';
import {
  bindProfileRuntimeDatabase,
  enableProfileRuntimeFailClosed,
  unbindProfileRuntimeDatabase,
} from '../lib/db';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution/production';
import { findPlannerTool } from '../lib/planner/plannerToolSurface';
import { getCanonicalProposal } from '../lib/salesAgentTools/sessionWriteStateStore';

type CliLineWriter = (line: string) => void;
type ParsedCapCommand = Extract<ParsedCliCommand, { readonly name: 'cap' }>;

function hasC4CustomerScope(profile: string, command: ParsedCapCommand): boolean {
  if (typeof command.args === 'object' && command.args !== null && !Array.isArray(command.args)) {
    const customerId = (command.args as Record<string, unknown>).customer_id;
    if (typeof customerId === 'string' && customerId.trim().length > 0) return true;
  }
  try {
    return showProfileSession(profile).selected_customer_id !== null;
  } catch {
    // This is only the C4 admission check. The C3 closed surface remains the
    // fallback when a write invocation has no usable customer scope yet.
    return false;
  }
}

function profileErrorCode(error: unknown): string | undefined {
  return error instanceof ProfileRuntimeError ? error.code : undefined;
}

function sessionErrorCode(error: unknown): string | undefined {
  return error instanceof SessionRuntimeError ? error.code : undefined;
}

function hydratorErrorCode(error: unknown): string | undefined {
  return error instanceof RuntimeHydratorError ? error.code : undefined;
}

function capabilityErrorExitCode(code: string): number {
  // C3 locks scope failures to exit 3. Other local input/identity failures use
  // the existing CLI argument-error exit class.
  return code === 'MISSING_SCOPE' || code === 'INVALID_SCOPE' ? 3 : 2;
}

function hasParentPathSegment(path: string): boolean {
  return path.split(/[\\/]+/u).some((segment) => segment === '..');
}

/**
 * The import capability already accepts a browser-standard File. Node 24
 * exposes that same native implementation, so this transport keeps the
 * existing capability identity and parser untouched.
 */
function loadNativeImportFile(filePath: string): NodeFile {
  try {
    if (filePath.trim().length === 0 || hasParentPathSegment(filePath)) {
      throw new RuntimeHydratorError('INVALID_INPUT', 'Import preview file path is invalid.');
    }
    const resolvedPath = resolve(filePath);
    const stats = lstatSync(resolvedPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new RuntimeHydratorError('INVALID_INPUT', 'Import preview requires a real file.');
    }
    const realPath = realpathSync(resolvedPath);
    return new NodeFile([readFileSync(realPath)], basename(realPath));
  } catch (error) {
    if (error instanceof RuntimeHydratorError) throw error;
    throw new RuntimeHydratorError('INVALID_INPUT', 'Import preview file could not be read.');
  }
}

async function runC3CoreReadCapability(
  profile: string,
  command: ParsedCapCommand,
  writeLine: CliLineWriter,
): Promise<number> {
  const descriptor = findPlannerTool(command.capability_id);
  if (descriptor === null) {
    writeLine(formatError('CAPABILITY_NOT_FOUND'));
    return 2;
  }
  if (!isC3CoreReadCapability(descriptor.capability_id)) {
    writeLine(formatCapabilityExecutionNotEnabled());
    return 2;
  }

  let runtimeFile: NodeFile | undefined;
  try {
    runtimeFile = command.file_path === undefined ? undefined : loadNativeImportFile(command.file_path);
  } catch (error) {
    const code = hydratorErrorCode(error) ?? 'INVALID_INPUT';
    writeLine(formatError(code));
    return capabilityErrorExitCode(code);
  }

  let handle: Awaited<ReturnType<typeof openProfileDatabase>> | undefined;
  try {
    // The bind starts before profile open and is always removed after this one
    // invocation. Any adapter that reaches db.ts while unbound fails closed.
    enableProfileRuntimeFailClosed();
    handle = await openProfileDatabase(profile);
    bindProfileRuntimeDatabase(handle.db);

    const session = descriptor.scope_requirement === 'CUSTOMER'
      ? showProfileSession(profile)
      : undefined;
    const invocation = await hydrateRuntimeInvocation({
      profile,
      profileDb: handle.db,
      capability_id: descriptor.capability_id,
      args: command.args,
      ...(runtimeFile !== undefined ? { file: runtimeFile } : {}),
      ...(session !== undefined ? { session } : {}),
    });
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke(invocation);

    if (outcome.status === 'SUCCESS') {
      writeLine(formatCapabilityResult(
        profile,
        invocation.capability_id,
        invocation.capability_version,
        outcome.payload,
      ));
      return 0;
    }
    if (outcome.status === 'EXECUTION_ERROR') {
      writeLine(formatError(outcome.error_code));
      return 10;
    }

    // Every C3 allowlisted capability is an AUTO READ. A different terminal
    // status is therefore a closed execution failure, never a confirmation or
    // write path.
    writeLine(formatError('EXECUTION_ERROR'));
    return 10;
  } catch (error) {
    const profileCode = profileErrorCode(error);
    if (profileCode !== undefined) {
      writeLine(formatError(profileCode));
      return 5;
    }
    const code = hydratorErrorCode(error) ?? sessionErrorCode(error);
    if (code !== undefined) {
      writeLine(formatError(code));
      return capabilityErrorExitCode(code);
    }
    writeLine(formatError('PROFILE_OPEN_FAILED'));
    return 5;
  } finally {
    unbindProfileRuntimeDatabase();
    if (handle !== undefined) await handle.close();
  }
}

/**
 * C4 runs only confirmation-gated write capabilities that have an existing
 * canonical handoff. It persists that proposal and deliberately stops before
 * any post-confirmation execution path.
 */
async function runC4WriteProposalCapability(
  profile: string,
  command: ParsedCapCommand,
  writeLine: CliLineWriter,
): Promise<number> {
  const descriptor = findPlannerTool(command.capability_id);
  if (descriptor === null) {
    writeLine(formatError('CAPABILITY_NOT_FOUND'));
    return 2;
  }
  if (!isC4WriteProposalCapability(descriptor.capability_id)) {
    writeLine(formatCapabilityExecutionNotEnabled());
    return 2;
  }

  let handle: Awaited<ReturnType<typeof openProfileDatabase>> | undefined;
  try {
    // Bind before profile open. Any db.ts access while unbound therefore fails
    // closed instead of reaching the desktop production database.
    enableProfileRuntimeFailClosed();
    handle = await openProfileDatabase(profile);
    bindProfileRuntimeDatabase(handle.db);

    const session = descriptor.scope_requirement === 'CUSTOMER'
      ? showProfileSession(profile)
      : undefined;
    const invocation = await hydrateRuntimeInvocation({
      profile,
      profileDb: handle.db,
      capability_id: descriptor.capability_id,
      args: command.args,
      ...(session !== undefined ? { session } : {}),
    });
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke(invocation);

    if (outcome.status === 'CONFIRMATION_REQUIRED' || outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
      const proposalId = outcome.confirmation_handoff?.proposal_id;
      const customerId = invocation.scope.customer_id;
      if (proposalId === undefined || typeof customerId !== 'string' || customerId.trim().length === 0) {
        writeLine(formatError('EXECUTION_ERROR'));
        return 10;
      }

      let proposal;
      try {
        // Rebuild from the existing canonical snapshot. This verifies the
        // existing hash/schema and never creates a C4 proposal or nonce.
        proposal = getCanonicalProposal(proposalId, customerId);
      } catch {
        writeLine(formatError('EXECUTION_ERROR'));
        return 10;
      }
      if (proposal === null || proposal.proposal_id !== proposalId || proposal.customer_id !== customerId) {
        writeLine(formatError('EXECUTION_ERROR'));
        return 10;
      }

      try {
        persistPendingProposal(profile, proposal);
        writeLine(formatCapabilityConfirmationRequired(
          profile,
          invocation.capability_id,
          outcome.status,
          proposal,
        ));
        return 0;
      } catch (error) {
        if (error instanceof PendingProposalError || error instanceof TypeError) {
          writeLine(formatError('EXECUTION_ERROR'));
          return 10;
        }
        throw error;
      }
    }

    if (outcome.status === 'EXECUTION_ERROR') {
      writeLine(formatError(outcome.error_code));
      return 10;
    }

    // C4 must never claim COMPLETED for a write. SUCCESS would mean an
    // unexpected auto-write path and is a closed acceptance failure.
    writeLine(formatError('EXECUTION_ERROR'));
    return 10;
  } catch (error) {
    const profileCode = profileErrorCode(error);
    if (profileCode !== undefined) {
      writeLine(formatError(profileCode));
      return 5;
    }
    const code = hydratorErrorCode(error) ?? sessionErrorCode(error);
    if (code !== undefined) {
      writeLine(formatError(code));
      return capabilityErrorExitCode(code);
    }
    writeLine(formatError('PROFILE_OPEN_FAILED'));
    return 5;
  } finally {
    unbindProfileRuntimeDatabase();
    if (handle !== undefined) await handle.close();
  }
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
    case 'cap': {
      if (isC4WriteProposalCapability(parsed.command.capability_id)) {
        if (!hasC4CustomerScope(profile, parsed.command)) {
          writeLine(formatCapabilityExecutionNotEnabled());
          return 2;
        }
        return runC4WriteProposalCapability(profile, parsed.command, writeLine);
      }
      return runC3CoreReadCapability(profile, parsed.command, writeLine);
    }
    case 'confirm':
      // C4 recognizes the command shape but intentionally does not reload a
      // pending proposal or call the existing exact-confirmation executor.
      writeLine(formatError('CONFIRM_NOT_ENABLED'));
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
