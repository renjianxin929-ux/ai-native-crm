import { createMockReasoningProvider } from '../salesAgent/provider';
import { runSalesAgentRuntime } from '../salesAgent/runtime';
import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext, MemoryRepository } from '../customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import { executeSalesAgentReadTool, type SalesAgentToolResult } from './registry';
import { deterministicSemanticFallback, validateSemanticPlan, type ValidatedSemanticPlan } from './semanticPlanning';
import { buildWriteProposal, consumeExactConfirmation, type AgentWriteProposal, type ExactConfirmation } from './confirmedWrite';
import { createUnreviewedCapture, reviewedFacts, type CaptureSourceType, type CustomerCaptureReview } from '../customerCapture/review';

export type AgentMode = 'mock' | 'live' | 'fallback';
/** Host behavior is injected at the app boundary; React never creates provider behavior. */
export interface SalesAgentHost { reason(input: { customer_id: string; message: string }): Promise<unknown>; capture(input: { customer_id: string; source_type: CaptureSourceType; source: string }): Promise<unknown>; }
export type FakeTrustedHost = SalesAgentHost;
export interface AgentSessionMessage { readonly id: string; readonly role: 'user' | 'agent'; readonly content: string; readonly mode: AgentMode; readonly created_at: string; }
export interface AgentSessionResult { readonly plan: ValidatedSemanticPlan; readonly mode: AgentMode; readonly provider: string; readonly model: string; readonly tool_trace: readonly SalesAgentToolResult[]; readonly evidence_refs: readonly string[]; readonly confidence: number; readonly response: string; readonly requires_human_review: true; readonly executable: false; readonly writes_crm: false; }
export type SalesAgentSessionOutcome =
  | { readonly kind: 'reasoning_result'; readonly result: AgentSessionResult }
  | { readonly kind: 'write_proposal'; readonly proposal: AgentWriteProposal }
  | { readonly kind: 'blocked' | 'fallback' | 'error'; readonly reason: string };
export interface SafeWriteBoundary { execute(proposal: AgentWriteProposal, confirmation_id: string): Promise<{ entity_id: string; fields: readonly string[] }>; }
export interface SalesAgentSessionDependencies { readonly snapshot: LoadedReadOnlyAgentSnapshot; readonly context: ContextSnapshot; readonly memory?: CustomerMemoryContext; readonly profile_id: string; readonly memory_repository?: MemoryRepository; readonly loadCustomerSnapshot?: (customerId: string) => Promise<{ next_follow_up_at: string | null } | null>; }

export class SalesAgentSession {
  readonly messages: AgentSessionMessage[] = [];
  private readonly persistedFactIds = new Set<string>();
  private readonly issuedProposalKeys = new Set<string>();
  private readonly customerId: string; private readonly host: SalesAgentHost | null; private readonly clock: () => string; private readonly dependencies?: SalesAgentSessionDependencies;
  constructor(customerId: string, host: SalesAgentHost | null, clock: () => string = () => new Date().toISOString(), dependencies?: SalesAgentSessionDependencies) { this.customerId = customerId; this.host = host; this.clock = clock; this.dependencies = dependencies; }

  /** The sole message entry point: it owns classification, tool selection, proposal construction and fallback. */
  async submit(message: string, evidenceRefs: readonly string[] = [`customer:${this.customerId}`]): Promise<SalesAgentSessionOutcome> {
    if (!message.trim()) return { kind: 'blocked', reason: 'A message is required.' };
    try {
      const plan = await this.plan(message);
      if (plan.steps.some(step => step.access === 'write')) {
        const current_values = await this.currentValuesFor(plan);
        const proposal = buildWriteProposal({ customer_id: this.customerId, message, evidence_refs: evidenceRefs, created_at: this.clock(), current_values });
        this.issuedProposalKeys.add(proposalFingerprint(proposal));
        return { kind: 'write_proposal', proposal };
      }
      return { kind: 'reasoning_result', result: await this.askWithPlan(message, plan) };
    } catch (cause) { return { kind: 'blocked', reason: cause instanceof Error ? cause.message : String(cause) }; }
  }
  async ask(message: string): Promise<AgentSessionResult> { const outcome = await this.submit(message); if (outcome.kind !== 'reasoning_result') throw new Error(outcome.kind === 'write_proposal' ? 'A write proposal was requested.' : outcome.reason); return outcome.result; }
  private async plan(message: string): Promise<ValidatedSemanticPlan> {
    if (!this.dependencies) throw new Error('Sales Agent production dependencies are not configured.');
    if (!this.host) return deterministicSemanticFallback(this.customerId);
    return validateSemanticPlan(await this.host.reason({ customer_id: this.customerId, message }), this.customerId);
  }
  private async askWithPlan(message: string, plan: ValidatedSemanticPlan): Promise<AgentSessionResult> {
    if (!this.dependencies) throw new Error('Sales Agent production dependencies are not configured.');
    this.push('user', message, this.host ? 'mock' : 'fallback');
    const mode: AgentMode = this.host ? 'mock' : 'fallback';
    const tool_trace = plan.steps.filter(step => step.access === 'read').map(step => executeSalesAgentReadTool(step.tool_id as Parameters<typeof executeSalesAgentReadTool>[0], { customer_id: this.customerId, snapshot: this.dependencies!.snapshot, context: this.dependencies!.context, memory: this.dependencies!.memory }));
    if (!tool_trace.length) throw new Error('A successful read result requires an executed registered read tool.');
    const runtime = await runSalesAgentRuntime({ request_id: `${this.dependencies.context.snapshotId}:session:${this.messages.length}`, objective: message, context: this.dependencies.context, memory: this.dependencies.memory, profile_id: this.dependencies.profile_id, provider: createMockReasoningProvider(), clock: this.clock });
    const evidence_refs = [...new Set([...tool_trace.flatMap(item => item.evidence_refs), ...runtime.result.evidence.map(item => item.evidence_id)])];
    const result: AgentSessionResult = { plan, mode, provider: mode === 'mock' ? 'injected fake-host test transport + SalesAgentRuntime' : 'deterministic fallback + SalesAgentRuntime', model: 'Mock reasoning provider (deterministic_fixture_v1)', tool_trace, evidence_refs, confidence: .62, response: runtime.result.customer_summary.value, requires_human_review: true, executable: false, writes_crm: false };
    this.push('agent', result.response, mode); return result;
  }
  async capture(sourceType: CaptureSourceType, source: string): Promise<CustomerCaptureReview> { if (!source.trim()) throw new Error('Capture source is required.'); if (!this.host) throw new Error('Trusted-host adapter is blocked.'); const output = await this.host.capture({ customer_id: this.customerId, source_type: sourceType, source }); return createUnreviewedCapture(this.customerId, sourceType, sourceType === 'image' ? 'QWEN_VISION_COMPATIBLE' : 'DEEPSEEK_COMPATIBLE', (output as { visual_facts?: unknown }).visual_facts); }
  async persistReviewedFacts(review: CustomerCaptureReview): Promise<readonly string[]> { if (review.customer_id !== this.customerId) throw new Error('Capture customer scope mismatch.'); if (!this.dependencies?.memory_repository) throw new Error('Memory repository is not configured.'); return Promise.all(reviewedFacts(review).map(async fact => { const key = stableKey(`${fact.source_reference}:${fact.reviewed_content}`); const id = `capture-memory-${this.customerId}-${fact.fact_id}-${key}`; if (this.persistedFactIds.has(id)) return id; const entry = await this.dependencies!.memory_repository!.createCandidate({ id, customer_id: this.customerId, memory_type: 'FACT', content: fact.reviewed_content, source_type: 'HUMAN_INPUT', source_reference: fact.source_reference, confidence: fact.confidence, evidence: [{ id: `capture-evidence-${fact.fact_id}-${key}`, evidence_type: 'CUSTOMER', evidence_id: this.customerId }] }); this.persistedFactIds.add(id); return entry.id; })); }
  async analyzeReviewedFacts(review: CustomerCaptureReview): Promise<AgentSessionResult> { this.assertReviewed(review); const outcome = await this.submit(`Analyze reviewed customer capture facts: ${reviewedFacts(review).map(fact => fact.reviewed_content).join('; ')}`); if (outcome.kind !== 'reasoning_result') throw new Error(outcome.kind === 'write_proposal' ? 'Capture analysis must remain read-only.' : outcome.reason); return outcome.result; }
  async createProposalFromReviewedFacts(review: CustomerCaptureReview): Promise<AgentWriteProposal> { this.assertReviewed(review); const outcome = await this.submit(reviewedFacts(review).map(fact => fact.reviewed_content).join('; '), reviewedFacts(review).map(fact => fact.source_reference)); if (outcome.kind !== 'write_proposal') throw new Error(outcome.kind === 'reasoning_result' ? 'Reviewed facts did not request a supported CRM write.' : outcome.reason); return outcome.proposal; }
  async confirmWrite(proposal: AgentWriteProposal, confirmation: ExactConfirmation, boundary: SafeWriteBoundary) {
    if (!this.issuedProposalKeys.has(proposalFingerprint(proposal))) throw new Error('Unknown or modified session-owned write proposal.');
    const accepted = consumeExactConfirmation(proposal, confirmation);
    return boundary.execute(accepted.proposal, accepted.confirmation_id);
  }
  private assertReviewed(review: CustomerCaptureReview) { if (review.customer_id !== this.customerId || reviewedFacts(review).length === 0) throw new Error('Accepted or edited customer-scoped facts are required.'); }
  private async currentValuesFor(plan: ValidatedSemanticPlan): Promise<Readonly<Record<string, unknown>>> {
    if (!plan.steps.some(step => step.tool_id === 'update_next_follow_up_time')) return {};
    const customer = await this.dependencies?.loadCustomerSnapshot?.(this.customerId);
    if (!customer) throw new Error('The current customer snapshot is required before proposing a next follow-up update.');
    return { next_follow_up_at: customer.next_follow_up_at };
  }
  private push(role: AgentSessionMessage['role'], content: string, mode: AgentMode) { this.messages.push({ id: `${role}-${this.messages.length + 1}`, role, content, mode, created_at: this.clock() }); }
}
function stableKey(value: string): string { let hash = 0; for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) | 0; return String(hash >>> 0); }
function proposalFingerprint(proposal: AgentWriteProposal): string { return `${proposal.proposal_id}:${proposal.proposal_hash}:${JSON.stringify(proposal.proposed_values)}:${proposal.entity_id ?? ''}`; }
