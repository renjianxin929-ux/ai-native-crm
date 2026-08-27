import { closeSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { prepareProfileFilesystem, resolveProfilePaths } from './profile';

/**
 * C4 persists the already-canonical proposal produced by the existing
 * confirmation handoff. It does not create proposal IDs, hashes, nonces, or a
 * second confirmation state store.
 */
export interface PendingProposalRecord extends AgentWriteProposal {
  readonly profile: string;
}

export interface PendingProposalLocation {
  readonly profile: string;
  readonly pendingDir: string;
  readonly path: string;
}

export class PendingProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingProposalError';
  }
}

const PROPOSAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,159}$/u;

function isPathInside(rootDir: string, candidatePath: string): boolean {
  const relativePath = relative(rootDir, candidatePath);
  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith('../')
    && !relativePath.startsWith('..\\')
    && !isAbsolute(relativePath);
}

/**
 * Keeps proposal identity separate from its filesystem spelling. Existing
 * sales-agent proposal IDs contain ISO timestamp colons, which are invalid in
 * Windows filenames. Percent escaping is reversible and leaves ordinary safe
 * IDs untouched; the JSON record always retains the canonical proposal_id.
 */
function proposalFileStem(proposalId: string): string {
  return encodeURIComponent(proposalId).replace(/[!'()*]/gu, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

export function assertPendingProposalId(proposalId: string): string {
  if (typeof proposalId !== 'string'
    || !PROPOSAL_ID_PATTERN.test(proposalId)
    || proposalId === '.'
    || proposalId === '..') {
    throw new PendingProposalError('Pending proposal id is invalid.');
  }
  return proposalId;
}

function assertCanonicalProposalForPersistence(proposal: AgentWriteProposal): void {
  assertPendingProposalId(proposal.proposal_id);
  if (typeof proposal.proposal_hash !== 'string' || proposal.proposal_hash.trim().length === 0
    || typeof proposal.nonce !== 'string' || proposal.nonce.trim().length === 0
    || typeof proposal.created_at !== 'string' || proposal.created_at.trim().length === 0) {
    throw new PendingProposalError('Canonical proposal is incomplete for persistence.');
  }
}

/** Resolves one proposal file under the profile-owned pending directory only. */
export function resolvePendingProposalLocation(profileName: string, proposalId: string): PendingProposalLocation {
  const proposal_id = assertPendingProposalId(proposalId);
  const paths = prepareProfileFilesystem(resolveProfilePaths(profileName));
  const path = resolve(paths.pendingDir, `${proposalFileStem(proposal_id)}.json`);
  if (!isPathInside(paths.pendingDir, path)) {
    throw new PendingProposalError('Pending proposal path escaped its profile directory.');
  }
  return { profile: paths.profile, pendingDir: paths.pendingDir, path };
}

function targetDoesNotExist(path: string): void {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new PendingProposalError('Pending proposal target must not be a symbolic link.');
    }
    throw new PendingProposalError('A pending proposal with this id already exists.');
  } catch (error) {
    if (error instanceof PendingProposalError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

/**
 * Writes exactly one existing canonical proposal with temp-file → fsync →
 * close → same-directory atomic rename. No CRM table is read or mutated here.
 */
export function persistPendingProposal(
  profileName: string,
  proposal: AgentWriteProposal,
): PendingProposalLocation {
  assertCanonicalProposalForPersistence(proposal);
  const location = resolvePendingProposalLocation(profileName, proposal.proposal_id);
  const record: PendingProposalRecord = Object.freeze({
    ...proposal,
    profile: location.profile,
    // Keep the canonical proposal creation time as the persisted record time;
    // C4 must not mint a second proposal timestamp.
    created_at: proposal.created_at,
  });

  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    throw new PendingProposalError('Canonical proposal is not JSON serializable.');
  }

  const temporaryPath = resolve(
    location.pendingDir,
    `.${proposalFileStem(proposal.proposal_id)}.${process.pid}.${randomUUID()}.tmp`,
  );
  if (!isPathInside(location.pendingDir, temporaryPath)) {
    throw new PendingProposalError('Pending proposal temporary path escaped its profile directory.');
  }

  let fileDescriptor: number | undefined;
  let renamed = false;
  try {
    targetDoesNotExist(location.path);
    fileDescriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(fileDescriptor, serialized, 'utf8');
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporaryPath, location.path);
    renamed = true;
    return location;
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the first persistence error.
      }
    }
    if (!renamed) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file either does not exist or cannot be cleaned up.
      }
    }
    if (error instanceof PendingProposalError) throw error;
    throw new PendingProposalError('Pending proposal could not be atomically persisted.');
  }
}
