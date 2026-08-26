import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

export const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ProfileRuntimeErrorCode =
  | 'PROFILE_INVALID'
  | 'PROFILE_PATH_REJECTED'
  | 'PROFILE_PRODUCTION_PATH_REJECTED';

export class ProfileRuntimeError extends Error {
  readonly code: ProfileRuntimeErrorCode;

  constructor(code: ProfileRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'ProfileRuntimeError';
    this.code = code;
  }
}

export interface ProfilePaths {
  readonly profile: string;
  readonly homeDir: string;
  readonly rootDir: string;
  readonly profileDir: string;
  readonly pendingDir: string;
  readonly dbPath: string;
}

function rejectPath(message: string): never {
  throw new ProfileRuntimeError('PROFILE_PATH_REJECTED', message);
}

function isPathInside(rootDir: string, candidatePath: string): boolean {
  const relativePath = relative(rootDir, candidatePath);
  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith('../')
    && !relativePath.startsWith('..\\')
    && !isAbsolute(relativePath);
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function configuredHomeDir(): string {
  const configuredHome = process.platform === 'win32'
    ? process.env.USERPROFILE
    : process.env.HOME;
  if (!configuredHome || !isAbsolute(configuredHome)) {
    rejectPath('A fixed absolute user profile directory is required.');
  }
  return resolve(configuredHome);
}

function productionDatabasePaths(): readonly string[] {
  const appDataRoots = [process.env.APPDATA, process.env.LOCALAPPDATA]
    .filter((value): value is string => Boolean(value && isAbsolute(value)));
  return appDataRoots.map((appDataRoot) => resolve(appDataRoot, 'com.localcrm.desktop', 'personal-crm.db'));
}

function assertNotProductionDatabasePath(dbPath: string): void {
  if (pathsEqual(dbPath, 'sqlite:personal-crm.db')
    || productionDatabasePaths().some((productionPath) => pathsEqual(dbPath, productionPath))) {
    throw new ProfileRuntimeError(
      'PROFILE_PRODUCTION_PATH_REJECTED',
      'The default production CRM database is not a valid profile database.',
    );
  }
}

function assertPathInsideProfileRoot(rootDir: string, candidatePath: string): void {
  if (!isPathInside(rootDir, candidatePath)) {
    rejectPath('Profile paths must remain inside the fixed profile root.');
  }
}

function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertDirectory(path: string, description: string): void {
  const stats = statIfPresent(path);
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
    rejectPath(`${description} must be a real directory, not a link or file.`);
  }
}

function ensureRealDirectory(path: string, description: string, recursive: boolean): void {
  if (!existsSync(path)) mkdirSync(path, { recursive });
  assertDirectory(path, description);
}

function assertExistingDatabaseFileIsSafe(paths: ProfilePaths): string {
  const stats = statIfPresent(paths.dbPath);
  if (!stats) return paths.dbPath;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    rejectPath('The profile database must be a real file, not a link or directory.');
  }

  const realDbPath = realpathSync(paths.dbPath);
  assertPathInsideProfileRoot(paths.rootDir, realDbPath);
  assertPathInsideProfileRoot(paths.profileDir, realDbPath);
  assertNotProductionDatabasePath(realDbPath);
  return realDbPath;
}

export function validateProfileName(profileName: string): string {
  if (typeof profileName !== 'string' || !PROFILE_NAME_PATTERN.test(profileName)) {
    throw new ProfileRuntimeError(
      'PROFILE_INVALID',
      'Profile names must match ^[A-Za-z0-9_-]{1,64}$.',
    );
  }
  return profileName;
}

export function resolveProfilePaths(profileName: string): ProfilePaths {
  const profile = validateProfileName(profileName);
  const homeDir = configuredHomeDir();
  const rootDir = resolve(homeDir, '.localcrm', 'profiles');
  const profileDir = resolve(rootDir, profile);
  const pendingDir = resolve(profileDir, 'pending');
  const dbPath = resolve(profileDir, 'crm.sqlite');

  assertPathInsideProfileRoot(homeDir, rootDir);
  assertPathInsideProfileRoot(rootDir, profileDir);
  assertPathInsideProfileRoot(rootDir, pendingDir);
  assertPathInsideProfileRoot(rootDir, dbPath);
  assertNotProductionDatabasePath(dbPath);

  return { profile, homeDir, rootDir, profileDir, pendingDir, dbPath };
}

/**
 * Creates only the fixed profile directories after all lexical checks pass,
 * then resolves existing filesystem links to make escape attempts fail closed.
 */
export function prepareProfileFilesystem(paths: ProfilePaths): ProfilePaths {
  assertDirectory(paths.homeDir, 'The configured user profile directory');

  const localCrmDir = join(paths.homeDir, '.localcrm');
  ensureRealDirectory(localCrmDir, 'The LocalCRM profile parent', false);
  ensureRealDirectory(paths.rootDir, 'The LocalCRM profile root', false);
  ensureRealDirectory(paths.profileDir, 'The requested profile directory', false);
  ensureRealDirectory(paths.pendingDir, 'The profile pending directory', false);

  const rootDir = realpathSync(paths.rootDir);
  const profileDir = realpathSync(paths.profileDir);
  const pendingDir = realpathSync(paths.pendingDir);
  assertPathInsideProfileRoot(rootDir, profileDir);
  assertPathInsideProfileRoot(rootDir, pendingDir);
  assertPathInsideProfileRoot(profileDir, pendingDir);

  const dbPath = assertExistingDatabaseFileIsSafe({
    ...paths,
    rootDir,
    profileDir,
    pendingDir,
    dbPath: resolve(profileDir, 'crm.sqlite'),
  });
  assertPathInsideProfileRoot(rootDir, dbPath);
  assertPathInsideProfileRoot(profileDir, dbPath);
  assertNotProductionDatabasePath(dbPath);

  return { ...paths, rootDir, profileDir, pendingDir, dbPath };
}

/**
 * Re-check the database file after SQLite opens it, covering an existing-file
 * substitution without ever delegating to the desktop application's db.ts.
 */
export function verifyOpenedProfileDatabase(paths: ProfilePaths): ProfilePaths {
  const dbPath = assertExistingDatabaseFileIsSafe(paths);
  return { ...paths, dbPath };
}
