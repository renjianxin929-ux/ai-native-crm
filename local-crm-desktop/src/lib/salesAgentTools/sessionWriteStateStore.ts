/**
 * Process-stable write-state store for Sales Agent.
 * Survives React remounts and SalesAgentSession identity churn.
 * Canonical Proposal / PendingWriteIntent live here — never in React props/state.
 */

import { invalidateWriteProposal, type AgentWriteProposal } from './confirmedWrite';
import type { WriteFieldDraft } from './writeIntent';

interface CustomerWriteState {
  pendingDraft: WriteFieldDraft | null;
  proposals: Map<string, AgentWriteProposal>;
  consumedProposalIds: Set<string>;
}

const byCustomer = new Map<string, CustomerWriteState>();

function stateFor(customerId: string): CustomerWriteState {
  let state = byCustomer.get(customerId);
  if (!state) {
    state = {
      pendingDraft: null,
      proposals: new Map(),
      consumedProposalIds: new Set(),
    };
    byCustomer.set(customerId, state);
  }
  return state;
}

/** Deep-freeze a plain JSON-like tree so UI cannot mutate canonical write payloads. */
export function freezeWriteTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeWriteTree(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function getPendingWriteDraft(customerId: string): WriteFieldDraft | null {
  return stateFor(customerId).pendingDraft;
}

export function setPendingWriteDraft(customerId: string, draft: WriteFieldDraft | null): void {
  stateFor(customerId).pendingDraft = draft ? freezeWriteTree({ ...draft, parsed_fields: { ...draft.parsed_fields } }) : null;
}

export function registerCanonicalProposal(proposal: AgentWriteProposal): AgentWriteProposal {
  const canonical = freezeWriteTree({
    ...proposal,
    current_values: { ...proposal.current_values },
    proposed_values: { ...proposal.proposed_values },
    evidence_refs: [...proposal.evidence_refs],
    ...(proposal.grouped_operations ? {
      grouped_operations: proposal.grouped_operations.map(item => ({
        ...item,
        current_values: { ...item.current_values },
        proposed_values: { ...item.proposed_values },
      })),
    } : {}),
  });
  const state = stateFor(proposal.customer_id);
  state.proposals.set(canonical.proposal_id, canonical);
  return canonical;
}

export function setCanonicalGroupedOperationSelection(
  proposalId: string,
  customerId: string,
  operationId: string,
  selected: boolean,
): AgentWriteProposal {
  const state = stateFor(customerId);
  const current = state.proposals.get(proposalId);
  if (!current?.grouped_operations) throw new Error('这项待确认操作已经失效，请重新生成后再确认。');
  if (!current.grouped_operations.some(item => item.operation_id === operationId)) throw new Error('组合操作不存在。');
  const grouped_operations = current.grouped_operations.map(item => item.operation_id === operationId ? { ...item, selected } : item);
  if (!grouped_operations.some(item => item.selected)) throw new Error('至少保留一项待执行操作。');
  const proposal_hash = `${current.nonce}:${JSON.stringify({ current_values: current.current_values, proposed_values: current.proposed_values, grouped_operations })}`;
  const updated = freezeWriteTree({ ...current, proposal_hash, grouped_operations });
  state.proposals.set(proposalId, updated);
  return updated;
}

export function getCanonicalProposal(proposalId: string, customerId?: string): AgentWriteProposal | null {
  if (customerId) {
    return stateFor(customerId).proposals.get(proposalId) ?? null;
  }
  for (const state of byCustomer.values()) {
    const hit = state.proposals.get(proposalId);
    if (hit) return hit;
  }
  return null;
}

export function consumeCanonicalProposal(proposalId: string, customerId: string): AgentWriteProposal | null {
  const state = stateFor(customerId);
  const proposal = state.proposals.get(proposalId) ?? null;
  if (!proposal) return null;
  state.proposals.delete(proposalId);
  state.consumedProposalIds.add(proposalId);
  return proposal;
}

export function wasProposalConsumed(proposalId: string, customerId?: string): boolean {
  if (customerId) return stateFor(customerId).consumedProposalIds.has(proposalId);
  for (const state of byCustomer.values()) {
    if (state.consumedProposalIds.has(proposalId)) return true;
  }
  return false;
}

export function cancelCanonicalProposal(proposal: AgentWriteProposal | null | undefined): void {
  if (!proposal) return;
  // Invalidate nonce so the cancelled confirmation token cannot execute.
  // Do not mark proposal_id as "consumed/replay" — UI must say "已失效，请重新生成".
  invalidateWriteProposal(proposal);
  const state = stateFor(proposal.customer_id);
  state.proposals.delete(proposal.proposal_id);
  state.pendingDraft = null;
}

/** Clear pending draft + unconfirmed proposals for a customer (scope switch / new conversation). */
export function invalidateCustomerWriteState(customerId: string): void {
  const state = byCustomer.get(customerId);
  if (!state) return;
  for (const proposal of state.proposals.values()) {
    invalidateWriteProposal(proposal);
    state.consumedProposalIds.add(proposal.proposal_id);
  }
  state.proposals.clear();
  state.pendingDraft = null;
}

/** Test helper — never call from production UI. */
export function __resetSessionWriteStateStoreForTests(): void {
  byCustomer.clear();
}
