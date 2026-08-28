#!/usr/bin/env node

import { File as NodeFile } from 'node:buffer';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapabilityCatalog } from './catalog';
import { findCapabilityTransport } from './capabilityTransport';
import {
  formatCapabilityExplicitlyUnsupported,
  formatCapabilityResult,
  formatCapabilityConfirmationRequired,
  formatCapabilityExecutionNotEnabled,
  formatCatalog,
  formatConfirmationResult,
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
import {
  consumePendingProposal,
  persistPendingProposal,
  PendingProposalError,
  readPendingProposal,
} from './pendingProposal';
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
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { getCanonicalProposal, rehydrateCanonicalProposal } from '../lib/salesAgentTools/sessionWriteStateStore';

type CliLineWriter = (line: string) => void;
type ParsedCapCommand = Extract<ParsedCliCommand, { readonly name: 'cap' }>;
type ParsedConfirmCommand = Extract<ParsedCliCommand, { readonly name: 'confirm' }>;

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
      const customerId = descriptor.scope_requirement === 'CUSTOMER'
        ? invocation.scope.customer_id
        : undefined;
      if (proposalId === undefined
        || (descriptor.scope_requirement === 'CUSTOMER'
          && (typeof customerId !== 'string' || customerId.trim().length === 0))) {
        writeLine(formatError('EXECUTION_ERROR'));
        return 10;
      }

      let proposal;
      try {
        // Rebuild from the existing canonical snapshot. This verifies the
        // existing hash/schema and never creates a C4 proposal or nonce.
        proposal = getCanonicalProposal(proposalId);
      } catch {
        writeLine(formatError('EXECUTION_ERROR'));
        return 10;
      }
      if (proposal === null
        || proposal.proposal_id !== proposalId
        || typeof proposal.customer_id !== 'string'
        || proposal.customer_id.trim().length === 0
        || (customerId !== undefined && proposal.customer_id !== customerId)) {
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
 * C4 persists no new strong-confirmation token: for its sole destructive
 * capability, the already-issued canonical nonce is the phrase exposed in the
 * C4 envelope. This check only admits that existing nonce to confirmWriteByRef.
 */
function requiresExistingStrongConfirmationPhrase(proposal: AgentWriteProposal): boolean {
  return proposal.tool_id === 'delete_customer' && proposal.operation === 'delete';
}

function pendingReadExitCode(error: PendingProposalError): number {
  // The stored profile is part of the confirmation binding. A mismatch is a
  // failed confirmation; filesystem/JSON/consume failures remain pending I/O.
  return error.code === 'PENDING_PROPOSAL_PROFILE_MISMATCH' ? 4 : 7;
}

function restoredProposalFailure(error: unknown): { readonly code: string; readonly exitCode: number } {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Confirmation replay rejected.') {
    return { code: 'CONFIRMATION_REPLAY_REJECTED', exitCode: 4 };
  }
  if (message.includes('hash mismatch')) {
    return { code: 'PENDING_PROPOSAL_HASH_MISMATCH', exitCode: 4 };
  }
  return { code: 'PENDING_PROPOSAL_CORRUPT', exitCode: 7 };
}

function confirmationFailureCode(error: unknown, strongConfirmation: boolean): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Confirmation replay rejected.') return 'CONFIRMATION_REPLAY_REJECTED';
  if (message.includes('does not match the exact proposal')) {
    return strongConfirmation ? 'CONFIRMATION_PHRASE_MISMATCH' : 'CONFIRMATION_MISMATCH';
  }
  return 'CONFIRMATION_FAILED';
}

/**
 * C5 transport bridge: pending file → checked canonical proposal → existing
 * SalesAgentSession exact confirmation → existing approved safe-write boundary.
 * It never routes the Agent through a confirm path or re-invokes the engine.
 */
async function runC5Confirm(
  profile: string,
  command: ParsedConfirmCommand,
  writeLine: CliLineWriter,
): Promise<number> {
  let loaded;
  try {
    // This happens before opening the profile DB. Missing/corrupt/mismatched
    // pending data therefore cannot create a profile DB or mutate business rows.
    loaded = readPendingProposal(profile, command.proposal_id);
  } catch (error) {
    if (error instanceof PendingProposalError) {
      writeLine(formatError(error.code));
      return pendingReadExitCode(error);
    }
    writeLine(formatError('PENDING_PROPOSAL_CORRUPT'));
    return 7;
  }

  const strongConfirmation = requiresExistingStrongConfirmationPhrase(loaded.proposal);
  if (strongConfirmation && command.phrase === undefined) {
    writeLine(formatError('CONFIRMATION_PHRASE_REQUIRED'));
    return 4;
  }
  if (!strongConfirmation && command.phrase !== undefined) {
    writeLine(formatError('CONFIRMATION_PHRASE_UNEXPECTED'));
    return 4;
  }

  let proposal: AgentWriteProposal;
  try {
    // Rehydrate into the one existing state store. It recomputes the existing
    // canonical hash; it does not mint an ID, hash, nonce, or confirmation.
    proposal = rehydrateCanonicalProposal(loaded.proposal);
  } catch (error) {
    const failure = restoredProposalFailure(error);
    writeLine(formatError(failure.code));
    return failure.exitCode;
  }

  let handle: Awaited<ReturnType<typeof openProfileDatabase>> | undefined;
  try {
    enableProfileRuntimeFailClosed();
    handle = await openProfileDatabase(profile);
    bindProfileRuntimeDatabase(handle.db);

    // The temporary session only supplies the existing customer-owned registry
    // lookup. confirmWriteByRef remains the exact nonce/replay gate and the
    // approved boundary remains the only business-write path.
    const session = new SalesAgentSession(proposal.customer_id, null);
    const result = await session.confirmWriteByRef({
      proposal_id: proposal.proposal_id,
      // Strong confirmations pass the user's phrase directly into the
      // existing exact-nonce validator. Normal CLI confirm has no phrase and
      // transports the immutable canonical nonce from the restored record.
      nonce: strongConfirmation ? command.phrase ?? '' : proposal.nonce ?? '',
      confirmed_at: SALES_AGENT_APP_CLOCK.now(),
    }, approvedCrmWriteBoundary);

    // Consume only after safe write success. The pending reader has closed all
    // descriptors before its Windows-safe unlink.
    try {
      consumePendingProposal(loaded.location, proposal);
    } catch (error) {
      if (error instanceof PendingProposalError) {
        writeLine(formatError(error.code));
        return 7;
      }
      writeLine(formatError('PENDING_PROPOSAL_CONSUME_FAILED'));
      return 7;
    }

    writeLine(formatConfirmationResult(profile, proposal.proposal_id, result));
    return 0;
  } catch (error) {
    const profileCode = profileErrorCode(error);
    if (profileCode !== undefined) {
      writeLine(formatError(profileCode));
      return 5;
    }
    writeLine(formatError(confirmationFailureCode(error, strongConfirmation)));
    return 4;
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
      const transport = findCapabilityTransport(parsed.command.capability_id);
      if (transport === null) {
        writeLine(formatError('CAPABILITY_NOT_FOUND'));
        return 2;
      }
      if (transport.transport === 'EXPLICITLY_UNSUPPORTED') {
        // This happens before scope lookup, profile opening, or Engine.invoke.
        writeLine(formatCapabilityExplicitlyUnsupported(
          transport.capability_id,
          transport.reason,
        ));
        return 2;
      }
      if (isC4WriteProposalCapability(parsed.command.capability_id)) {
        const descriptor = findPlannerTool(parsed.command.capability_id);
        if (descriptor?.scope_requirement === 'CUSTOMER' && !hasC4CustomerScope(profile, parsed.command)) {
          writeLine(formatCapabilityExecutionNotEnabled());
          return 2;
        }
        return runC4WriteProposalCapability(profile, parsed.command, writeLine);
      }
      return runC3CoreReadCapability(profile, parsed.command, writeLine);
    }
    case 'confirm':
      return runC5Confirm(profile, parsed.command, writeLine);
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
