import type { CapabilityCatalogEntry } from './catalog';

/** Serialize every C1 CLI response as one JSON line. */
export function formatJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('CLI responses must be JSON serializable.');
  return json;
}

export function formatError(code: string): string {
  return formatJson({ ok: false, status: 'ERROR', code });
}

export function formatCatalog(
  profile: string,
  capabilities: readonly CapabilityCatalogEntry[],
): string {
  return formatJson({
    ok: true,
    status: 'COMPLETED',
    profile,
    command: 'catalog',
    capabilities,
  });
}

export function formatHelp(): string {
  return formatJson({
    ok: true,
    status: 'COMPLETED',
    command: 'help',
    commands: ['catalog', 'help', 'profile-status', 'cap'],
  });
}

export function formatProfileStatus(profile: string, dbPath: string): string {
  return formatJson({
    ok: true,
    status: 'COMPLETED',
    profile,
    db_path: dbPath,
  });
}

export function formatCapabilityExecutionNotEnabled(): string {
  return formatError('CAPABILITY_EXECUTION_NOT_ENABLED');
}
