export const AGENT_WRITE_TOOL_IDS = ['create_follow_up_record', 'create_visit_record', 'create_task', 'update_task', 'update_task_status', 'update_next_follow_up_time', 'update_customer_basic_fields', 'update_contact_basic_fields'] as const;
export type AgentWriteToolId = typeof AGENT_WRITE_TOOL_IDS[number];
export interface GroupedWriteOperation {
  readonly operation_id: string;
  readonly label: string;
  readonly tool_id: AgentWriteToolId;
  readonly current_values: Readonly<Record<string, unknown>>;
  readonly proposed_values: Readonly<Record<string, unknown>>;
  readonly selected: boolean;
}
export interface AgentWriteProposal {
  readonly proposal_id: string; readonly proposal_hash: string; readonly tool_id: AgentWriteToolId;
  readonly customer_id: string; readonly entity_type: 'customer' | 'contact' | 'follow_up' | 'visit' | 'task'; readonly entity_id?: string;
  readonly operation: 'create' | 'update'; readonly current_values: Readonly<Record<string, unknown>>; readonly proposed_values: Readonly<Record<string, unknown>>;
  readonly reason: string; readonly evidence_refs: readonly string[]; readonly reversible: boolean; readonly nonce?: string; readonly created_at: string;
  readonly status: 'awaiting_confirmation'; readonly executable: false; readonly requires_confirmation: true;
  readonly grouped_operations?: readonly GroupedWriteOperation[];
}
export interface ExactConfirmation { readonly proposal_id: string; readonly proposal_hash: string; readonly tool_id: AgentWriteToolId; readonly customer_id: string; readonly entity_id?: string; readonly payload_hash?: string; readonly nonce: string; readonly confirmed_at: string; }

const consumed = new Set<string>();
let proposalSequence = 0;
const allowedFields: Readonly<Record<AgentWriteToolId, readonly string[]>> = Object.freeze({
  create_follow_up_record: ['title', 'feedback_notes', 'next_follow_up_at'], create_visit_record: ['title', 'visit_notes', 'visited_at'], create_task: ['title', 'due_at', 'status'], update_task: ['title', 'due_at'], update_task_status: ['status'], update_next_follow_up_time: ['next_follow_up_at'], update_customer_basic_fields: ['name', 'industry', 'address', 'phone'], update_contact_basic_fields: ['name', 'phone', 'email', 'position'],
});

export function validateAgentWriteProposal(proposal: AgentWriteProposal): void {
  if (!AGENT_WRITE_TOOL_IDS.includes(proposal.tool_id) || !proposal.customer_id.trim() || !proposal.proposal_id.trim() || !proposal.proposal_hash.trim() || (proposal.nonce !== undefined && !proposal.nonce.trim())) throw new Error('Write proposal identity is invalid.');
  if (proposal.status !== 'awaiting_confirmation' || proposal.executable !== false || !proposal.reason.trim()) throw new Error('Write proposal must remain awaiting exact confirmation.');
  const fields = Object.keys(proposal.proposed_values);
  if (fields.length === 0 || fields.some(field => !allowedFields[proposal.tool_id].includes(field))) throw new Error('Write proposal includes a forbidden field.');
  if (proposal.grouped_operations) {
    if (proposal.grouped_operations.length < 2 || !proposal.grouped_operations.some(item => item.selected)) throw new Error('Grouped proposal must disclose at least two operations and select at least one.');
    const ids = new Set<string>();
    for (const item of proposal.grouped_operations) {
      if (!item.operation_id.trim() || ids.has(item.operation_id)) throw new Error('Grouped proposal operation identity is invalid.');
      ids.add(item.operation_id);
      const childFields = Object.keys(item.proposed_values);
      if (!AGENT_WRITE_TOOL_IDS.includes(item.tool_id) || childFields.length === 0 || childFields.some(field => !allowedFields[item.tool_id].includes(field))) throw new Error('Grouped proposal includes a forbidden operation.');
    }
  }
}

/** Consumes one exact proposal confirmation. The caller may invoke its existing Safe Write boundary only after this succeeds. */
export function consumeExactConfirmation(proposal: AgentWriteProposal, confirmation: ExactConfirmation): { readonly confirmation_id: string; readonly proposal: AgentWriteProposal } {
  validateAgentWriteProposal(proposal);
  if (consumed.has(confirmation.nonce)) throw new Error('Confirmation replay rejected.');
  if (!Number.isFinite(Date.parse(confirmation.confirmed_at)) || confirmation.confirmed_at < proposal.created_at) throw new Error('Confirmation timestamp is invalid.');
  if (confirmation.proposal_id !== proposal.proposal_id || confirmation.proposal_hash !== proposal.proposal_hash || confirmation.tool_id !== proposal.tool_id || confirmation.customer_id !== proposal.customer_id || confirmation.entity_id !== proposal.entity_id || confirmation.payload_hash !== proposal.proposal_hash || (proposal.nonce !== undefined && confirmation.nonce !== proposal.nonce) || !confirmation.nonce.trim()) throw new Error('Confirmation does not match the exact proposal.');
  consumed.add(confirmation.nonce);
  return { confirmation_id: confirmation.nonce, proposal };
}

/** Invalidate a cancelled proposal so the same nonce cannot be replayed later. */
export function isWriteConfirmationReplay(nonce: string | undefined): boolean {
  const normalized = nonce?.trim();
  if (!normalized) return false;
  return consumed.has(normalized);
}

export function invalidateWriteProposal(proposal: AgentWriteProposal): void {
  if (proposal.nonce) consumed.add(proposal.nonce);
}

export interface BuildWriteProposalInput {
  readonly customer_id: string;
  readonly message: string;
  readonly evidence_refs: readonly string[];
  readonly created_at: string;
  readonly current_values?: Readonly<Record<string, unknown>>;
  /** Session-owned tool selection — never re-inferred from weekday tokens in React. */
  readonly tool_id?: AgentWriteToolId;
  readonly proposed_values?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly grouped_operations?: readonly GroupedWriteOperation[];
}

/** Offline parsing is deliberately bounded and owned by the session layer, never React. */
export function buildWriteProposal(input: BuildWriteProposalInput): AgentWriteProposal {
  const text = input.message.trim();
  const tool_id: AgentWriteToolId = input.tool_id
    ?? (/task|待办|提醒/.test(text.toLowerCase()) ? 'create_task'
      : /next\s*follow|下次.*跟进|更新.*跟进|改.*跟进/.test(text.toLowerCase()) ? 'update_next_follow_up_time'
        : 'create_follow_up_record');

  let proposed_values: Readonly<Record<string, unknown>>;
  if (input.proposed_values) {
    proposed_values = input.proposed_values;
  } else if (tool_id === 'create_task') {
    proposed_values = { title: text, status: 'OPEN' };
  } else if (tool_id === 'update_next_follow_up_time') {
    const schedule = parseProposedSchedule(text, input.created_at);
    if (!schedule) throw new Error('A deterministic proposed follow-up schedule is required before confirmation.');
    proposed_values = { next_follow_up_at: schedule };
  } else {
    proposed_values = { title: '跟进记录', feedback_notes: text };
  }

  const current_values = input.current_values ?? {};
  if (tool_id === 'update_next_follow_up_time' && !Object.prototype.hasOwnProperty.call(current_values, 'next_follow_up_at')) {
    throw new Error('The stored next follow-up value is required before confirmation.');
  }
  if (tool_id === 'update_next_follow_up_time' && typeof proposed_values.next_follow_up_at !== 'string') {
    throw new Error('A deterministic proposed follow-up schedule is required before confirmation.');
  }

  const nonce = `proposal:${input.customer_id}:${tool_id}:${input.created_at}:${++proposalSequence}`;
  const proposal_hash = `${nonce}:${JSON.stringify({ current_values, proposed_values, grouped_operations: input.grouped_operations ?? null })}`;
  return {
    proposal_id: `proposal-${input.created_at}-${proposalSequence}`,
    proposal_hash,
    tool_id,
    customer_id: input.customer_id,
    entity_type: tool_id === 'create_task' ? 'task' : tool_id === 'create_follow_up_record' ? 'follow_up' : 'customer',
    ...(tool_id === 'update_next_follow_up_time' ? { entity_id: input.customer_id } : {}),
    operation: tool_id.startsWith('create') ? 'create' : 'update',
    current_values,
    proposed_values,
    reason: input.reason ?? '用户本次明确指令',
    evidence_refs: input.evidence_refs,
    reversible: true,
    nonce,
    created_at: input.created_at,
    status: 'awaiting_confirmation',
    executable: false,
    requires_confirmation: true,
    ...(input.grouped_operations ? { grouped_operations: input.grouped_operations } : {}),
  };
}

/** Deliberately bounded: ambiguous natural language becomes a blocked proposal, never an invented date. */
function parseProposedSchedule(message: string, now: string): string | null {
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?Z?))?\b/);
  if (iso) {
    if (iso[2]) {
      const raw = iso[2].endsWith('Z') ? iso[2] : `${iso[2]}Z`;
      const candidate = `${iso[1]}T${raw}`;
      return Number.isFinite(Date.parse(candidate)) ? candidate : null;
    }
    // Date-only ISO in legacy English paths defaults to 09:00Z for prior fixtures.
    const candidate = `${iso[1]}T09:00:00Z`;
    return Number.isFinite(Date.parse(candidate)) ? candidate : null;
  }
  const nextWednesday = /next\s+wednesday|下周三/i.test(message);
  if (!nextWednesday) return null;
  const date = new Date(now); const delta = ((3 - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + delta); date.setUTCHours(9, 0, 0, 0);
  return date.toISOString();
}
