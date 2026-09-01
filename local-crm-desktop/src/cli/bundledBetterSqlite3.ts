import { createRequire } from 'node:module';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

type NativeDatabaseConstructor = typeof Database;

let cachedNativeDatabase: NativeDatabaseConstructor | null = null;

function runtimeDirectory(): string {
  const value = process.env.CRM_BUNDLED_CLI_RUNTIME_DIR;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('The bundled CRM CLI runtime directory is unavailable.');
  }
  return value;
}

function loadNativeDatabase(): NativeDatabaseConstructor {
  if (cachedNativeDatabase !== null) return cachedNativeDatabase;

  const runtimeDir = runtimeDirectory();
  const requireFromRuntime = createRequire(join(runtimeDir, 'bundled-cli-require.cjs'));
  const packageEntry = join(runtimeDir, 'better-sqlite3', 'lib', 'index.js');
  cachedNativeDatabase = requireFromRuntime(packageEntry) as NativeDatabaseConstructor;
  return cachedNativeDatabase;
}

/**
 * Build-only replacement for the regular better-sqlite3 import. The native
 * package's public constructor supports `nativeBinding`; supplying it here
 * bypasses its discovery helper and pins loading to the installed sidecar
 * runtime rather than Node's package lookup paths.
 */
const BundledDatabase = function bundledDatabase(
  filenameGiven: string | Buffer,
  options?: ConstructorParameters<NativeDatabaseConstructor>[1],
) {
  const NativeDatabase = loadNativeDatabase();
  return new NativeDatabase(filenameGiven, {
    ...(options ?? {}),
    nativeBinding: join(runtimeDirectory(), 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  } as ConstructorParameters<NativeDatabaseConstructor>[1]);
} as unknown as NativeDatabaseConstructor;

export default BundledDatabase;
