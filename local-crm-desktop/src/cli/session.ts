import { lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { prepareProfileFilesystem, resolveProfilePaths } from './profile';

export type SessionRuntimeErrorCode = 'SESSION_INVALID' | 'ARGUMENT_ERROR';

export class SessionRuntimeError extends Error {
  readonly code: SessionRuntimeErrorCode;

  constructor(code: SessionRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'SessionRuntimeError';
    this.code = code;
  }
}

export interface ProfileSession {
  readonly selected_customer_id: string | null;
}

interface SessionLocation {
  readonly profile: string;
  readonly profileDir: string;
  readonly sessionPath: string;
}

function isPathInside(rootDir: string, candidatePath: string): boolean {
  const relativePath = relative(rootDir, candidatePath);
  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith('../')
    && !relativePath.startsWith('..\\')
    && !isAbsolute(relativePath);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function resolveSessionLocation(profileName: string): SessionLocation {
  const profilePaths = prepareProfileFilesystem(resolveProfilePaths(profileName));
  const sessionPath = resolve(profilePaths.profileDir, 'session.json');
  if (!isPathInside(profilePaths.profileDir, sessionPath)) {
    throw new SessionRuntimeError('SESSION_INVALID', 'Profile session path must remain inside the profile directory.');
  }
  return {
    profile: profilePaths.profile,
    profileDir: profilePaths.profileDir,
    sessionPath,
  };
}

function sessionFileExists(location: SessionLocation): boolean {
  let stats;
  try {
    stats = lstatSync(location.sessionPath);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }

  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SessionRuntimeError('SESSION_INVALID', 'Profile session must be a real file.');
  }

  const realSessionPath = realpathSync(location.sessionPath);
  if (!isPathInside(location.profileDir, realSessionPath)) {
    throw new SessionRuntimeError('SESSION_INVALID', 'Profile session path escaped its profile directory.');
  }
  return true;
}

function parseSession(raw: string): ProfileSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionRuntimeError('SESSION_INVALID', 'Profile session JSON is invalid.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SessionRuntimeError('SESSION_INVALID', 'Profile session must be an object.');
  }

  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1
    || !Object.hasOwn(record, 'selected_customer_id')
    || typeof record.selected_customer_id !== 'string'
    || record.selected_customer_id.trim().length === 0) {
    throw new SessionRuntimeError('SESSION_INVALID', 'Profile session has an invalid selected_customer_id.');
  }

  return { selected_customer_id: record.selected_customer_id };
}

function readSessionAt(location: SessionLocation): ProfileSession {
  if (!sessionFileExists(location)) return { selected_customer_id: null };
  return parseSession(readFileSync(location.sessionPath, 'utf8'));
}

/**
 * Read a selected customer only when the profile directory already exists.
 * C4 admission is a read-only preflight: a missing session must not create a
 * profile or pending directory merely to learn that no customer is selected.
 */
export function showExistingProfileSession(profileName: string): ProfileSession {
  const profilePaths = resolveProfilePaths(profileName);
  try {
    lstatSync(profilePaths.profileDir);
  } catch (error) {
    if (isMissingPathError(error)) return { selected_customer_id: null };
    throw error;
  }
  return readSessionAt(resolveSessionLocation(profileName));
}

function normalizeCustomerId(customerId: string): string {
  const normalized = customerId.trim();
  if (!normalized) {
    throw new SessionRuntimeError('ARGUMENT_ERROR', 'A non-empty customer id is required.');
  }
  return normalized;
}

/** Returns the fixed, profile-contained session path after C0 filesystem checks. */
export function profileSessionPath(profileName: string): string {
  return resolveSessionLocation(profileName).sessionPath;
}

/** Reads the one permitted session value; an absent session file is an empty session. */
export function showProfileSession(profileName: string): ProfileSession {
  return readSessionAt(resolveSessionLocation(profileName));
}

/** Stores only the selected customer id in the fixed profile session file. */
export function selectProfileCustomer(profileName: string, customerId: string): ProfileSession {
  const location = resolveSessionLocation(profileName);
  // A malformed existing file must not be silently repaired by a write command.
  readSessionAt(location);

  const selected_customer_id = normalizeCustomerId(customerId);
  writeFileSync(location.sessionPath, JSON.stringify({ selected_customer_id }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { selected_customer_id };
}

/** Clears selection by removing the fixed session file, never touching CRM tables. */
export function clearProfileCustomer(profileName: string): ProfileSession {
  const location = resolveSessionLocation(profileName);
  const session = readSessionAt(location);
  if (session.selected_customer_id !== null) unlinkSync(location.sessionPath);
  return { selected_customer_id: null };
}
