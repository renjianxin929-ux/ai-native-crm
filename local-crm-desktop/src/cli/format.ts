import type { CapabilityCatalogEntry } from './catalog';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { projectConfirmationCard } from '../lib/salesAgentUi/userFacingFieldFormatter';

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
    commands: ['catalog', 'help', 'profile-status', 'session', 'cap', 'confirm'],
    catalog_transport: 'catalog marks every capability as SUPPORTED or EXPLICITLY_UNSUPPORTED',
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

export function formatSession(
  profile: string,
  command: 'session.show' | 'session.select-customer' | 'session.clear-customer',
  selectedCustomerId: string | null,
): string {
  return formatJson({
    ok: true,
    status: 'COMPLETED',
    command,
    profile,
    selected_customer_id: selectedCustomerId,
  });
}

/** C3 successful capability invocation envelope; result is the engine payload unchanged. */
export function formatCapabilityResult(
  profile: string,
  capabilityId: string,
  version: string,
  result: unknown,
): string {
  return formatJson({
    ok: true,
    status: 'COMPLETED',
    capability_id: capabilityId,
    version,
    profile,
    result,
  });
}

/** Existing confirmed-write result, exposed by the C5 CLI transport only after safe write success. */
export function formatConfirmationResult(
  profile: string,
  proposalId: string,
  result: unknown,
): string {
  return formatJson({
    ok: true,
    status: 'COMPLETED',
    command: 'confirm',
    profile,
    proposal_id: proposalId,
    result,
  });
}

function confirmationHumanSummary(proposal: AgentWriteProposal): string {
  const card = projectConfirmationCard(proposal);
  return [
    card.title,
    ...(card.headline === null ? [] : [card.headline]),
    ...card.summary_lines,
    ...(card.destructive_note === null ? [] : [card.destructive_note]),
  ].join('；');
}

/** C4 confirmation envelope: proposal remains pending and is never executed. */
export function formatCapabilityConfirmationRequired(
  profile: string,
  capabilityId: string,
  status: 'CONFIRMATION_REQUIRED' | 'STRONG_CONFIRMATION_REQUIRED',
  proposal: AgentWriteProposal,
): string {
  if (status === 'STRONG_CONFIRMATION_REQUIRED'
    && (typeof proposal.nonce !== 'string' || proposal.nonce.trim().length === 0)) {
    throw new TypeError('Strong confirmation requires the existing proposal nonce.');
  }
  return formatJson({
    ok: true,
    status,
    capability_id: capabilityId,
    profile,
    proposal_id: proposal.proposal_id,
    human_summary: confirmationHumanSummary(proposal),
    diff: {
      current_values: proposal.current_values,
      proposed_values: proposal.proposed_values,
    },
    // This is the existing exact-confirmation nonce, not a new CLI protocol.
    ...(status === 'STRONG_CONFIRMATION_REQUIRED' ? { confirm_phrase_expected: proposal.nonce } : {}),
  });
}

export function formatCapabilityExecutionNotEnabled(): string {
  return formatError('CAPABILITY_EXECUTION_NOT_ENABLED');
}

/** C7 fail-closed response for a known planner-surface capability with no CLI transport. */
export function formatCapabilityExplicitlyUnsupported(
  capabilityId: string,
  reason: string,
): string {
  return formatJson({
    ok: false,
    status: 'ERROR',
    code: 'CAPABILITY_EXPLICITLY_UNSUPPORTED',
    capability_id: capabilityId,
    reason,
  });
}
