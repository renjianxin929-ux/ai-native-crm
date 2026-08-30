import type { DatabaseLike } from './db';
import { invokeTauriAtomicCommand, isTauriRuntime } from './runtime/tauriRuntime';

export type DesktopDataSource =
  | { mode: 'LEGACY'; profileName?: never }
  | { mode: 'PROFILE'; profileName: string };

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
