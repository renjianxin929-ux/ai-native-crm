/**
 * Process-stable write-state store for Sales Agent.
 * Survives React remounts and SalesAgentSession identity churn.
 *
 * Canonical Proposal 真源 = CanonicalProposalSnapshot（canonical_payload_json + proposal_hash），
 * 绝不保存调用者传入对象的可变引用；所有读取路径从 snapshot 重建全新执行对象。
 */

import {
  createCanonicalProposalSnapshot,
  invalidateWriteProposal,
  rebuildProposalFromSnapshot,
  type AgentWriteProposal,
  type CanonicalProposalSnapshot,
} from './confirmedWrite';
import type { WriteFieldDraft } from './writeIntent';

interface CustomerWriteState {
  pendingDraft: WriteFieldDraft | null;
  snapshots: Map<string, CanonicalProposalSnapshot>;
  consumedProposalIds: Set<string>;
}

const byCustomer = new Map<string, CustomerWriteState>();

function stateFor(customerId: string): CustomerWriteState {
  let state = byCustomer.get(customerId);
  if (!state) {
    state = {
      pendingDraft: null,
      snapshots: new Map(),
      consumedProposalIds: new Set(),
    };
    byCustomer.set(customerId, state);
  }
  return state;
}

/** Deep-freeze a plain JSON-like tree so UI cannot mutate canonical write payloads (additional guard; the authoritative source is the snapshot JSON). */
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

/** 注册 canonical snapshot；返回从 snapshot 重建的全新执行对象（调用者不可见 registry 内部）。 */
export function registerCanonicalProposal(proposal: AgentWriteProposal): AgentWriteProposal {
  const snapshot = createCanonicalProposalSnapshot(proposal);
  const state = stateFor(proposal.customer_id);
  state.snapshots.set(snapshot.proposal_id, snapshot);
  return rebuildProposalFromSnapshot(snapshot);
}

/**
 * Restores an already-issued canonical proposal after a process restart.
 * Unlike registerCanonicalProposal this is an integrity gate: the persisted
 * proposal_hash must already equal the existing canonical snapshot hash. It
 * never creates an ID, nonce, or alternate confirmation state.
 */
export function rehydrateCanonicalProposal(proposal: AgentWriteProposal): AgentWriteProposal {
  const snapshot = createCanonicalProposalSnapshot(proposal);
  if (snapshot.proposal_hash !== proposal.proposal_hash) {
    throw new Error('Canonical proposal hash mismatch; confirmation rejected.');
  }

  const state = stateFor(proposal.customer_id);
  if (state.consumedProposalIds.has(proposal.proposal_id)) {
    throw new Error('Confirmation replay rejected.');
  }
  const existing = state.snapshots.get(proposal.proposal_id);
  if (existing) {
    const rebuilt = rebuildProposalFromSnapshot(existing);
    if (rebuilt.proposal_hash !== proposal.proposal_hash || rebuilt.nonce !== proposal.nonce) {
      throw new Error('Canonical proposal identity collision; confirmation rejected.');
    }
    return rebuilt;
  }

  state.snapshots.set(snapshot.proposal_id, snapshot);
  return rebuildProposalFromSnapshot(snapshot);
}

export function setCanonicalGroupedOperationSelection(
  proposalId: string,
  customerId: string,
  operationId: string,
  selected: boolean,
): AgentWriteProposal {
  const state = stateFor(customerId);
  const snapshot = state.snapshots.get(proposalId);
  if (!snapshot) throw new Error('这项待确认操作已经失效，请重新生成后再确认。');
  const current = rebuildProposalFromSnapshot(snapshot);
  if (!current.grouped_operations) throw new Error('这项待确认操作已经失效，请重新生成后再确认。');
  if (!current.grouped_operations.some(item => item.operation_id === operationId)) throw new Error('组合操作不存在。');
  const grouped_operations = current.grouped_operations.map(item => item.operation_id === operationId ? { ...item, selected } : item);
  if (!grouped_operations.some(item => item.selected)) throw new Error('至少保留一项待执行操作。');
  const updated = rebuildProposalFromSnapshot(createCanonicalProposalSnapshot({ ...current, grouped_operations }));
  state.snapshots.set(proposalId, createCanonicalProposalSnapshot(updated));
  return updated;
}

/** 从 snapshot 重建全新对象（每次调用新副本；修改返回副本不影响 registry）。 */
export function getCanonicalProposal(proposalId: string, customerId?: string): AgentWriteProposal | null {
  if (customerId) {
    const snapshot = stateFor(customerId).snapshots.get(proposalId);
    return snapshot ? rebuildProposalFromSnapshot(snapshot) : null;
  }
  for (const state of byCustomer.values()) {
    const snapshot = state.snapshots.get(proposalId);
    if (snapshot) return rebuildProposalFromSnapshot(snapshot);
  }
  return null;
}

/** 消费：hash 复核（fail-closed）后重建并移除。 */
export function consumeCanonicalProposal(proposalId: string, customerId: string): AgentWriteProposal | null {
  const state = stateFor(customerId);
  const snapshot = state.snapshots.get(proposalId);
  if (!snapshot) return null;
  const rebuilt = rebuildProposalFromSnapshot(snapshot); // hash mismatch 在此 fail-closed
  state.snapshots.delete(proposalId);
  state.consumedProposalIds.add(proposalId);
  return rebuilt;
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
  state.snapshots.delete(proposal.proposal_id);
  state.pendingDraft = null;
}

/** Clear pending draft + unconfirmed proposals for a customer (scope switch / new conversation). */
export function invalidateCustomerWriteState(customerId: string): void {
  const state = byCustomer.get(customerId);
  if (!state) return;
  for (const snapshot of state.snapshots.values()) {
    invalidateWriteProposal({ ...rebuildProposalFromSnapshot(snapshot), nonce: snapshot.nonce } as AgentWriteProposal);
    state.consumedProposalIds.add(snapshot.proposal_id);
  }
  state.snapshots.clear();
  state.pendingDraft = null;
}

/** Test helper — never call from production UI. */
export function __resetSessionWriteStateStoreForTests(): void {
  byCustomer.clear();
}

/**
 * Test-only corruption hook（__xxxForTests 惯例）：受控破坏 snapshot（hash/JSON/schema_version 失配模拟）。
 * 仅用于验证 Confirm 的 fail-closed；生产路径永不调用。
 */
export function __corruptCanonicalSnapshotForTests(
  proposalId: string,
  customerId: string,
  mutate: (snapshot: CanonicalProposalSnapshot) => CanonicalProposalSnapshot,
): void {
  const state = stateFor(customerId);
  const current = state.snapshots.get(proposalId);
  if (!current) throw new Error('Canonical proposal snapshot does not exist.');
  state.snapshots.set(proposalId, mutate(current));
}
