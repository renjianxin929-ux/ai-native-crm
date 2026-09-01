import type { DatabaseLike } from './db';
import { invokeTauriAtomicCommand, isTauriRuntime } from './runtime/tauriRuntime';

export type DesktopDataSource =
  | { mode: 'LEGACY'; profileName?: never }
  | { mode: 'PROFILE'; profileName: string };

/**
 * Fixed, backend-resolved status for the bundled human/Agent CLI. These paths
 * are presentation-only: callers cannot submit a database or executable path.
 */
export type DesktopAgentCliStatus = DesktopDataSource & {
  readonly profileDatabasePath?: string;
  readonly installedCliPath?: string;
};

type DesktopCommandInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

let commandInvokeForTests: DesktopCommandInvoke | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDesktopDataSource(value: unknown): DesktopDataSource {
  if (!isRecord(value)) {
    throw new Error('Desktop data source response is invalid.');
  }
  if (value.mode === 'LEGACY' && value.profileName === undefined) {
    return { mode: 'LEGACY' };
  }
  if (value.mode === 'PROFILE' && typeof value.profileName === 'string') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.profileName)) {
      throw new Error('Desktop data source returned an invalid profile name.');
    }
    return { mode: 'PROFILE', profileName: value.profileName };
  }
  throw new Error('Desktop data source response is invalid.');
}

function isAbsoluteDisplayPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/u.test(value);
}

function parseDesktopAgentCliStatus(value: unknown): DesktopAgentCliStatus {
  const dataSource = parseDesktopDataSource(value);
  if (!isRecord(value)) {
    throw new Error('Bundled CLI status response is invalid.');
  }
  const profileDatabasePath = value.profileDatabasePath;
  const installedCliPath = value.installedCliPath;
  if (profileDatabasePath !== undefined
    && (typeof profileDatabasePath !== 'string' || !isAbsoluteDisplayPath(profileDatabasePath))) {
    throw new Error('Bundled CLI status returned an invalid profile database path.');
  }
  if (installedCliPath !== undefined
    && (typeof installedCliPath !== 'string' || !isAbsoluteDisplayPath(installedCliPath))) {
    throw new Error('Bundled CLI status returned an invalid executable path.');
  }
  if (dataSource.mode === 'LEGACY' && profileDatabasePath !== undefined) {
    throw new Error('LEGACY status must not expose a profile database path.');
  }
  if (dataSource.mode === 'PROFILE' && profileDatabasePath === undefined) {
    throw new Error('PROFILE status is missing its fixed profile database path.');
  }
  return {
    ...dataSource,
    ...(profileDatabasePath === undefined ? {} : { profileDatabasePath }),
    ...(installedCliPath === undefined ? {} : { installedCliPath }),
  };
}

async function invokeDesktopDataSourceCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  if (commandInvokeForTests) return commandInvokeForTests(command, args);
  if (!isTauriRuntime()) {
    throw new Error('Desktop profile controls require the Tauri runtime.');
  }
  return invokeTauriAtomicCommand(command, args);
}

/** Test-only seam for profile selection and profile database command coverage. */
export function __setDesktopDataSourceCommandInvokeForTests(invoke: DesktopCommandInvoke | null): void {
  commandInvokeForTests = invoke;
}

/**
 * A missing selection is intentionally LEGACY for first upgrade compatibility.
 * Tauri errors (including a malformed saved PROFILE selection) are propagated
 * so callers cannot silently reopen personal-crm.db.
 */
export async function getDesktopDataSource(): Promise<DesktopDataSource> {
  if (!commandInvokeForTests && !isTauriRuntime()) {
    return { mode: 'LEGACY' };
  }
  return parseDesktopDataSource(await invokeDesktopDataSourceCommand('desktop_data_source_status', {}));
}

export async function getDesktopAgentCliStatus(): Promise<DesktopAgentCliStatus> {
  if (!commandInvokeForTests && !isTauriRuntime()) {
    return { mode: 'LEGACY' };
  }
  return parseDesktopAgentCliStatus(await invokeDesktopDataSourceCommand('desktop_agent_cli_status', {}));
}

export async function listDesktopProfiles(): Promise<string[]> {
  const result = await invokeDesktopDataSourceCommand('desktop_list_profiles', {});
  if (!Array.isArray(result) || result.some(profileName => typeof profileName !== 'string')) {
    throw new Error('Desktop profile list response is invalid.');
  }
  return result;
}

export async function createDesktopProfile(profileName: string): Promise<DesktopDataSource> {
  return parseDesktopDataSource(await invokeDesktopDataSourceCommand('desktop_create_profile', { profileName }));
}

export async function selectDesktopProfile(profileName: string): Promise<DesktopDataSource> {
  return parseDesktopDataSource(await invokeDesktopDataSourceCommand('desktop_select_profile', { profileName }));
}

/**
 * PROFILE-mode `getDb()` implementation. The backend resolves the selected
 * profile from independent app configuration for every request; no database
 * path or SQLite URI crosses the renderer boundary.
 */
export function createSelectedProfileDatabase(): DatabaseLike {
  return {
    async execute(sql: string, bindings: unknown[] = []) {
      const result = await invokeDesktopDataSourceCommand('desktop_profile_database_execute', { sql, bindings });
      if (!isRecord(result) || typeof result.rowsAffected !== 'number') {
        throw new Error('Desktop profile database execute response is invalid.');
      }
      return { rowsAffected: result.rowsAffected };
    },
    async select<T>(sql: string, bindings: unknown[] = []): Promise<T[]> {
      const result = await invokeDesktopDataSourceCommand('desktop_profile_database_select', { sql, bindings });
      if (!Array.isArray(result)) {
        throw new Error('Desktop profile database select response is invalid.');
      }
      return result as T[];
    },
  };
}
