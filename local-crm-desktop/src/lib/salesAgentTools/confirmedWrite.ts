export const AGENT_WRITE_TOOL_IDS = ['create_follow_up_record', 'create_visit_record', 'create_task', 'update_task', 'update_task_status', 'update_next_follow_up_time', 'update_customer_basic_fields', 'update_contact_basic_fields'] as const;
export type AgentWriteToolId = typeof AGENT_WRITE_TOOL_IDS[number];
export interface AgentWriteProposal {
  readonly proposal_id: string; readonly proposal_hash: string; readonly tool_id: AgentWriteToolId;
  readonly customer_id: string; readonly entity_type: 'customer' | 'contact' | 'follow_up' | 'visit' | 'task'; readonly entity_id?: string;
  readonly operation: 'create' | 'update'; readonly current_values: Readonly<Record<string, unknown>>; readonly proposed_values: Readonly<Record<string, unknown>>;
  readonly reason: string; readonly evidence_refs: readonly string[]; readonly reversible: boolean; readonly nonce?: string; readonly created_at: string;
  readonly status: 'awaiting_confirmation'; readonly executable: false;
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

/** Offline parsing is deliberately bounded and owned by the session layer, never React. */
export function buildWriteProposal(input: { customer_id: string; message: string; evidence_refs: readonly string[]; created_at: string; current_values?: Readonly<Record<string, unknown>> }): AgentWriteProposal {
  const text = input.message.trim(); const lower = text.toLowerCase();
  const tool_id: AgentWriteToolId = /task|待办|提醒/.test(lower) ? 'create_task' : /next.*follow|下次.*跟进|周[一二三四五六日天]/.test(lower) ? 'update_next_follow_up_time' : 'create_follow_up_record';
  const schedule = tool_id === 'update_next_follow_up_time' ? parseProposedSchedule(text, input.created_at) : undefined;
  if (tool_id === 'update_next_follow_up_time' && !schedule) throw new Error('A deterministic proposed follow-up schedule is required before confirmation.');
  const proposed_values = tool_id === 'create_task' ? { title: text, status: 'OPEN' } : tool_id === 'update_next_follow_up_time' ? { next_follow_up_at: schedule! } : { title: 'Agent follow-up', feedback_notes: text };
  const current_values = input.current_values ?? {};
  if (tool_id === 'update_next_follow_up_time' && !Object.prototype.hasOwnProperty.call(current_values, 'next_follow_up_at')) throw new Error('The stored next follow-up value is required before confirmation.');
  // Same-clock requests are distinct session proposals; replay protection is per exact nonce.
  const nonce = `proposal:${input.customer_id}:${tool_id}:${input.created_at}:${++proposalSequence}`; const proposal_hash = `${nonce}:${JSON.stringify({ current_values, proposed_values })}`;
  return { proposal_id: `proposal-${input.created_at}`, proposal_hash, tool_id, customer_id: input.customer_id, entity_type: tool_id === 'create_task' ? 'task' : tool_id === 'create_follow_up_record' ? 'follow_up' : 'customer', ...(tool_id === 'update_next_follow_up_time' ? { entity_id: input.customer_id } : {}), operation: tool_id.startsWith('create') ? 'create' : 'update', current_values, proposed_values, reason: 'Explicit user request', evidence_refs: input.evidence_refs, reversible: true, nonce, created_at: input.created_at, status: 'awaiting_confirmation', executable: false };
}

/** Deliberately bounded: ambiguous natural language becomes a blocked proposal, never an invented date. */
function parseProposedSchedule(message: string, now: string): string | null {
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?Z?))?\b/);
  if (iso) {
    const candidate = iso[2] ? `${iso[1]}T${iso[2].endsWith('Z') ? iso[2] : `${iso[2]}Z`}` : `${iso[1]}T09:00:00Z`;
    return Number.isFinite(Date.parse(candidate)) ? candidate : null;
  }
  const nextWednesday = /next\s+wednesday|下周三/i.test(message);
  if (!nextWednesday) return null;
  const date = new Date(now); const delta = ((3 - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + delta); date.setUTCHours(9, 0, 0, 0);
  return date.toISOString();
}
