import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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

export interface LoadedPendingProposal {
  readonly location: PendingProposalLocation;
  readonly proposal: AgentWriteProposal;
}

export type PendingProposalErrorCode =
  | 'PENDING_PROPOSAL_NOT_FOUND'
  | 'PENDING_PROPOSAL_CORRUPT'
  | 'PENDING_PROPOSAL_PATH_REJECTED'
  | 'PENDING_PROPOSAL_PROFILE_MISMATCH'
  | 'PENDING_PROPOSAL_CHANGED'
  | 'PENDING_PROPOSAL_CONSUME_FAILED'
  | 'PENDING_PROPOSAL_PERSIST_FAILED';

export class PendingProposalError extends Error {
  readonly code: PendingProposalErrorCode;

  constructor(message: string, code: PendingProposalErrorCode = 'PENDING_PROPOSAL_PERSIST_FAILED') {
    super(message);
    this.name = 'PendingProposalError';
    this.code = code;
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

function pendingProposalPath(pendingDir: string, proposalId: string): string {
  const path = resolve(pendingDir, `${proposalFileStem(proposalId)}.json`);
  if (!isPathInside(pendingDir, path)) {
    throw new PendingProposalError(
      'Pending proposal path escaped its profile directory.',
      'PENDING_PROPOSAL_PATH_REJECTED',
    );
  }
  return path;
}

export function assertPendingProposalId(proposalId: string): string {
  if (typeof proposalId !== 'string'
    || !PROPOSAL_ID_PATTERN.test(proposalId)
    || proposalId === '.'
    || proposalId === '..') {
    throw new PendingProposalError('Pending proposal id is invalid.', 'PENDING_PROPOSAL_PATH_REJECTED');
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
  const path = pendingProposalPath(paths.pendingDir, proposal_id);
  return { profile: paths.profile, pendingDir: paths.pendingDir, path };
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function existingRealDirectory(path: string, description: string): string {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new PendingProposalError(
        'Pending proposal does not exist for this profile.',
        'PENDING_PROPOSAL_NOT_FOUND',
      );
    }
    throw new PendingProposalError(
      `Pending proposal ${description} could not be inspected.`,
      'PENDING_PROPOSAL_PATH_REJECTED',
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new PendingProposalError(
      `Pending proposal ${description} must be a real directory.`,
      'PENDING_PROPOSAL_PATH_REJECTED',
    );
  }
  try {
    return realpathSync(path);
  } catch {
    throw new PendingProposalError(
      `Pending proposal ${description} could not be resolved.`,
      'PENDING_PROPOSAL_PATH_REJECTED',
    );
  }
}

/**
 * Read-only counterpart to resolvePendingProposalLocation. Confirm must not
 * create a profile, pending directory, or database before it has proved that
 * the requested record exists under the explicitly named profile.
 */
export function resolveExistingPendingProposalLocation(
  profileName: string,
  proposalId: string,
): PendingProposalLocation {
  const proposal_id = assertPendingProposalId(proposalId);
  const paths = resolveProfilePaths(profileName);
  const rootDir = existingRealDirectory(paths.rootDir, 'root');
  const profileDir = existingRealDirectory(paths.profileDir, 'profile directory');
  const pendingDir = existingRealDirectory(paths.pendingDir, 'pending directory');
  if (!isPathInside(rootDir, profileDir) || !isPathInside(profileDir, pendingDir)) {
    throw new PendingProposalError(
      'Pending proposal path escaped its profile directory.',
      'PENDING_PROPOSAL_PATH_REJECTED',
    );
  }
  return {
    profile: paths.profile,
    pendingDir,
    path: pendingProposalPath(pendingDir, proposal_id),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Reloads a C4 record without manufacturing any confirmation data. Its
 * proposal is intentionally still validated and rehydrated by the existing
 * session write-state store before a safe write can run.
 */
export function readPendingProposal(profileName: string, proposalId: string): LoadedPendingProposal {
  const location = resolveExistingPendingProposalLocation(profileName, proposalId);
  let serialized: string;
  try {
    const stats = lstatSync(location.path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new PendingProposalError(
        'Pending proposal file must be a real file.',
        'PENDING_PROPOSAL_PATH_REJECTED',
      );
    }
    // Passing a pathname opens and closes the descriptor in this call. The
    // successful confirmation path can therefore remove it on Windows later.
    serialized = readFileSync(location.path, 'utf8');
  } catch (error) {
    if (error instanceof PendingProposalError) throw error;
    if (isMissingPathError(error)) {
      throw new PendingProposalError(
        'Pending proposal does not exist for this profile.',
        'PENDING_PROPOSAL_NOT_FOUND',
      );
    }
    throw new PendingProposalError(
      'Pending proposal could not be read.',
      'PENDING_PROPOSAL_CORRUPT',
    );
  }

  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isPlainRecord(parsed)) throw new Error('record is not a plain object');
    record = parsed;
  } catch {
    throw new PendingProposalError(
      'Pending proposal JSON is invalid.',
      'PENDING_PROPOSAL_CORRUPT',
    );
  }

  if (record.profile !== location.profile) {
    throw new PendingProposalError(
      'Pending proposal profile does not match the requested profile.',
      'PENDING_PROPOSAL_PROFILE_MISMATCH',
    );
  }
  if (record.proposal_id !== proposalId) {
    throw new PendingProposalError(
      'Pending proposal identity does not match its file path.',
      'PENDING_PROPOSAL_CORRUPT',
    );
  }

  const proposal = { ...record };
  delete proposal.profile;
  return Object.freeze({
    location,
    proposal: proposal as unknown as AgentWriteProposal,
  });
}

/**
 * C5 consumes only the original pending file and only after the existing safe
 * write has reported success. Re-read and compare identity first so a changed
 * file is never removed as if it were the confirmed proposal.
 */
export function consumePendingProposal(
  location: PendingProposalLocation,
  proposal: AgentWriteProposal,
): void {
  let current: LoadedPendingProposal;
  try {
    current = readPendingProposal(location.profile, proposal.proposal_id);
  } catch (error) {
    if (error instanceof PendingProposalError) {
      throw new PendingProposalError(error.message, 'PENDING_PROPOSAL_CONSUME_FAILED');
    }
    throw error;
  }
  if (current.location.path !== location.path
    || current.proposal.proposal_hash !== proposal.proposal_hash
    || current.proposal.nonce !== proposal.nonce) {
    throw new PendingProposalError(
      'Pending proposal changed before it could be consumed.',
      'PENDING_PROPOSAL_CHANGED',
    );
  }
  try {
    // unlinkSync removes the directory entry atomically. readPendingProposal
    // has already closed its file handle, which is required on Windows.
    unlinkSync(location.path);
  } catch {
    throw new PendingProposalError(
      'Pending proposal could not be consumed after confirmation.',
      'PENDING_PROPOSAL_CONSUME_FAILED',
    );
  }
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
