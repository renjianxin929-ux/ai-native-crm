import { createMockReasoningProvider } from '../salesAgent/provider';
import { runSalesAgentRuntime } from '../salesAgent/runtime';
import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext, MemoryRepository } from '../customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import { formatUserFacingErrorMessage } from '../salesAgentUi/formatUserFacingError';
import { executeSalesAgentReadTool, type SalesAgentCustomerScopedToolId, type SalesAgentToolResult } from './registry';
import { classifySalesAgentIntent, projectSalesAgentResponse, type SalesAgentResponseProjection } from './operatingLayer';
import { deterministicSemanticFallback, validateSemanticPlan, type ValidatedSemanticPlan } from './semanticPlanning';
import { buildWriteProposal, consumeExactConfirmation, type AgentWriteProposal, type ExactConfirmation, type GroupedWriteOperation } from './confirmedWrite';
import { createUnreviewedCapture, reviewedFacts, type CaptureSourceType, type CustomerCaptureReview } from '../customerCapture/review';
import {
  classifyClosedWriteIntent,
  draftWriteFields,
  mergeClarificationAnswer,
  proposedValuesFromDraft,
  type WriteClarificationRequest,
  type WriteFieldDraft,
} from './writeIntent';
import {
  cancelCanonicalProposal,
  consumeCanonicalProposal,
  getCanonicalProposal,
  getPendingWriteDraft,
  invalidateCustomerWriteState,
  registerCanonicalProposal,
  setPendingWriteDraft,
  setCanonicalGroupedOperationSelection,
  wasProposalConsumed,
} from './sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from './appClock';

export type AgentMode = 'mock' | 'live' | 'fallback';
/** Host behavior is injected at the app boundary; React never creates provider behavior. */
export interface SalesAgentHost {
  reason(input: { customer_id: string; message: string }): Promise<unknown>;
  capture(input: { customer_id: string; source_type: CaptureSourceType; source: string }): Promise<unknown>;
}
export type FakeTrustedHost = SalesAgentHost;
export interface AgentSessionMessage {
  readonly id: string;
  readonly role: 'user' | 'agent';
  readonly content: string;
  readonly mode: AgentMode;
  readonly created_at: string;
}
export interface AgentSessionResult {
  readonly plan: ValidatedSemanticPlan;
  readonly mode: AgentMode;
  readonly provider: string;
  readonly model: string;
  readonly tool_trace: readonly SalesAgentToolResult[];
  readonly evidence_refs: readonly string[];
  readonly confidence: number;
  readonly response: string;
  readonly structured: SalesAgentResponseProjection;
  readonly requires_human_review: true;
  readonly executable: false;
  readonly writes_crm: false;
}
export type SalesAgentSessionOutcome =
  | { readonly kind: 'reasoning_result'; readonly result: AgentSessionResult }
  | { readonly kind: 'write_proposal'; readonly proposal: AgentWriteProposal }
  | { readonly kind: 'clarification_required'; readonly clarification: WriteClarificationRequest }
  | { readonly kind: 'blocked' | 'fallback' | 'error'; readonly reason: string };
export interface SafeWriteBoundary {
  execute(proposal: AgentWriteProposal, confirmation_id: string): Promise<{ entity_id: string; fields: readonly string[] }>;
}
export interface SalesAgentSessionDependencies {
  readonly snapshot: LoadedReadOnlyAgentSnapshot;
  readonly context: ContextSnapshot;
  readonly memory?: CustomerMemoryContext;
  readonly profile_id: string;
  readonly memory_repository?: MemoryRepository;
  readonly loadCustomerSnapshot?: (customerId: string) => Promise<{ next_follow_up_at: string | null } | null>;
  /**
   * `deterministic` (production default for chat): local intent + Mock runtime, no live provider.
   * `host`: call injected host.reason (tests / explicit live planning).
   */
  readonly planning_mode?: 'deterministic' | 'host';
}

const READ_TOOLS_BY_INTENT: Record<string, readonly SalesAgentCustomerScopedToolId[]> = {
  CUSTOMER_SUMMARY: ['get_customer', 'get_customer_context', 'get_active_memory', 'get_customer_timeline'],
  CUSTOMER_RISK_ANALYSIS: ['get_customer_context', 'get_customer_timeline', 'get_active_memory', 'get_today_priority'],
  CUSTOMER_TIMELINE_REVIEW: ['get_customer', 'get_customer_timeline', 'list_customer_followups', 'list_customer_visits'],
  NEXT_ACTION_PREPARATION: ['get_customer_context', 'get_customer_timeline', 'list_customer_tasks', 'get_active_memory'],
  FOLLOW_UP_DRAFT: ['get_customer', 'get_customer_timeline', 'get_active_memory', 'get_existing_ai_results'],
  SAFE_FALLBACK: ['get_customer_context', 'get_active_memory', 'get_customer_timeline'],
};

export function deterministicPlanForMessage(customerId: string, message: string): ValidatedSemanticPlan {
  const write = localWritePlan(customerId, message);
  if (write) return write;
  const intent = classifySalesAgentIntent(message);
  const tools = READ_TOOLS_BY_INTENT[intent] ?? READ_TOOLS_BY_INTENT.SAFE_FALLBACK;
  return validateSemanticPlan({
    intent: intent === 'CUSTOMER_RISK_ANALYSIS' ? 'CUSTOMER_RISK_ANALYSIS'
      : intent === 'CUSTOMER_TIMELINE_REVIEW' ? 'CUSTOMER_TIMELINE_REVIEW'
        : intent === 'NEXT_ACTION_PREPARATION' ? 'NEXT_ACTION_PREPARATION'
          : intent === 'FOLLOW_UP_DRAFT' ? 'FOLLOW_UP_DRAFT'
            : intent === 'CUSTOMER_SUMMARY' ? 'CUSTOMER_SUMMARY'
              : 'SAFE_FALLBACK',
    customer_id: customerId,
    confidence: 0,
    provider_kind: 'DETERMINISTIC_FALLBACK',
    steps: tools.map(tool_id => ({
      tool_id,
      customer_id: customerId,
      access: 'read' as const,
      requires_confirmation: false as const,
      reason: 'Deterministic registered read without live provider.',
    })),
  }, customerId);
}

function localWritePlan(customerId: string, message: string): ValidatedSemanticPlan | null {
  const classified = classifyClosedWriteIntent(message);
  if (!classified) return null;
  return validateSemanticPlan({
    intent: classified.intent,
    customer_id: customerId,
    confidence: 0,
    provider_kind: 'DETERMINISTIC_FALLBACK',
    steps: [{
      tool_id: classified.tool_id,
      customer_id: customerId,
      access: 'write',
      requires_confirmation: true,
      reason: classified.reason,
    }],
  }, customerId);
}

function deterministicLocalCapture(customerId: string, sourceType: CaptureSourceType, source: string): CustomerCaptureReview {
  const facts = sourceType === 'text'
    ? source.split(/[。！？\n]+/).map(item => item.trim()).filter(Boolean).slice(0, 20).map((content, index) => ({
        fact_id: `local-text-${index + 1}-${stableKey(content)}`,
        fact_type: /反对|不接受|太贵|拒绝/.test(content) ? 'visible_objection' : /需要|希望|要求|计划|下周|报价/.test(content) ? 'visible_requirement' : 'extracted_text',
        content,
        source_reference: `text:${index + 1}`,
        confidence: 1,
      }))
    : [{
        fact_id: `local-image-manual-${stableKey(source.slice(0, 256))}`,
        fact_type: 'manual_review_required',
        content: '图片已安全载入；离线模式未识别图片内容，请人工编辑为可核对的客户事实后再接受。',
        source_reference: 'image:manual-review',
        confidence: 0,
      }];
  return createUnreviewedCapture(customerId, sourceType, 'DETERMINISTIC_LOCAL', facts);
}

function isUnavailableCaptureProvider(error: unknown): boolean {
  const detail = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : (() => { try { return JSON.stringify(error); } catch { return ''; } })();
  return /missing_host_provider|Trusted-host adapter is blocked/i.test(detail);
}

export class SalesAgentSession {
  readonly messages: AgentSessionMessage[] = [];
  private readonly persistedFactIds = new Set<string>();
  private clarificationSeq = 0;
  private readonly customerId: string;
  private host: SalesAgentHost | null;
  private readonly clock: () => string;
  private dependencies?: SalesAgentSessionDependencies;

  constructor(
    customerId: string,
    host: SalesAgentHost | null,
    clock: () => string = () => SALES_AGENT_APP_CLOCK.now(),
    dependencies?: SalesAgentSessionDependencies,
  ) {
    this.customerId = customerId;
    this.host = host;
    this.clock = clock;
    this.dependencies = dependencies;
  }

  getCustomerId(): string {
    return this.customerId;
  }

  /** Update read snapshot/context without replacing session identity or write-state store. */
  updateRuntime(input: {
    readonly host?: SalesAgentHost | null;
    readonly dependencies?: SalesAgentSessionDependencies;
  }): void {
    if (input.host !== undefined) this.host = input.host;
    if (input.dependencies) this.dependencies = input.dependencies;
  }

  getPendingDraft(): WriteFieldDraft | null {
    return getPendingWriteDraft(this.customerId);
  }

  getRegisteredProposal(proposalId: string): AgentWriteProposal | null {
    return getCanonicalProposal(proposalId, this.customerId);
  }

  setGroupedOperationSelected(proposalId: string, operationId: string, selected: boolean): AgentWriteProposal {
    return setCanonicalGroupedOperationSelection(proposalId, this.customerId, operationId, selected);
  }

  /** The sole message entry point: it owns classification, tool selection, proposal construction and fallback. */
  async submit(message: string, evidenceRefs: readonly string[] = [`customer:${this.customerId}`]): Promise<SalesAgentSessionOutcome> {
    if (!message.trim()) return { kind: 'blocked', reason: formatUserFacingErrorMessage('A message is required.') };
    try {
      if (getPendingWriteDraft(this.customerId)) {
        return await this.resumePendingWrite(message.trim(), evidenceRefs);
      }

      const draft = draftWriteFields(message, this.clock());
      if (draft) {
        if (draft.missing_fields.length > 0 && draft.question) {
          setPendingWriteDraft(this.customerId, draft);
          return {
            kind: 'clarification_required',
            clarification: this.toClarification(draft),
          };
        }
        return await this.emitWriteProposal(draft, evidenceRefs);
      }

      const plan = await this.plan(message);
      if (plan.steps.some(step => step.access === 'write')) {
        const writeStep = plan.steps.find(step => step.access === 'write')!;
        const fallbackDraft = draftWriteFields(message, this.clock()) ?? {
          intent: plan.intent as WriteFieldDraft['intent'],
          tool_id: writeStep.tool_id as WriteFieldDraft['tool_id'],
          original_instruction: message.trim(),
          parsed_fields: {},
          missing_fields: [] as string[],
          question: null,
          quick_replies: [],
        };
        if (fallbackDraft.missing_fields.length > 0 && fallbackDraft.question) {
          setPendingWriteDraft(this.customerId, fallbackDraft);
          return { kind: 'clarification_required', clarification: this.toClarification(fallbackDraft) };
        }
        return await this.emitWriteProposal({
          ...fallbackDraft,
          tool_id: writeStep.tool_id as WriteFieldDraft['tool_id'],
          intent: (plan.intent === 'CREATE_TASK_REQUEST' || plan.intent === 'CREATE_FOLLOW_UP_REQUEST' || plan.intent === 'UPDATE_CUSTOMER_REQUEST')
            ? plan.intent
            : fallbackDraft.intent,
        }, evidenceRefs);
      }
      return { kind: 'reasoning_result', result: await this.askWithPlan(message, plan) };
    } catch (cause) {
      return { kind: 'blocked', reason: formatUserFacingErrorMessage(cause) };
    }
  }

  cancelPendingWrite(proposal?: AgentWriteProposal | null): void {
    setPendingWriteDraft(this.customerId, null);
    if (proposal) cancelCanonicalProposal(proposal);
  }

  /** Drop all unconfirmed proposals (scope switch / new conversation). */
  invalidateAllPendingWrites(reason = 'scope_or_conversation_reset'): void {
    void reason;
    invalidateCustomerWriteState(this.customerId);
  }

  async ask(message: string): Promise<AgentSessionResult> {
    const outcome = await this.submit(message);
    if (outcome.kind !== 'reasoning_result') {
      throw new Error(
        outcome.kind === 'write_proposal'
          ? 'A write proposal was requested.'
          : outcome.kind === 'clarification_required'
            ? 'Write clarification is required.'
            : outcome.reason,
      );
    }
    return outcome.result;
  }

  private async plan(message: string): Promise<ValidatedSemanticPlan> {
    if (!this.dependencies) throw new Error('Sales Agent production dependencies are not configured.');
    const mode = this.dependencies.planning_mode ?? (this.host ? 'host' : 'deterministic');
    if (mode === 'host' && this.host) {
      return validateSemanticPlan(await this.host.reason({ customer_id: this.customerId, message }), this.customerId);
    }
    if (!this.host) return deterministicPlanForMessage(this.customerId, message);
    // Deterministic chat path — do not call live Trusted Host / provider for ordinary asks.
    return deterministicPlanForMessage(this.customerId, message);
  }

  private async askWithPlan(message: string, plan: ValidatedSemanticPlan): Promise<AgentSessionResult> {
    if (!this.dependencies) throw new Error('Sales Agent production dependencies are not configured.');
    const mode: AgentMode = this.dependencies.planning_mode === 'deterministic' || !this.host ? 'fallback' : 'mock';
    this.push('user', message, mode);
    const tool_trace = plan.steps
      .filter(step => step.access === 'read')
      .map(step => executeSalesAgentReadTool(step.tool_id as SalesAgentCustomerScopedToolId, {
        customer_id: this.customerId,
        snapshot: this.dependencies!.snapshot,
        context: this.dependencies!.context,
        memory: this.dependencies!.memory,
      }));
    if (!tool_trace.length) throw new Error('A successful read result requires an executed registered read tool.');
    const runtime = await runSalesAgentRuntime({
      request_id: `${this.dependencies.context.snapshotId}:session:${this.messages.length}`,
      objective: message,
      context: this.dependencies.context,
      memory: this.dependencies.memory,
      profile_id: this.dependencies.profile_id,
      provider: createMockReasoningProvider(),
      clock: this.clock,
    });
    const evidence_refs = [...new Set([
      ...tool_trace.flatMap(item => item.evidence_refs),
      ...runtime.result.evidence.map(item => item.evidence_id),
    ])];
    const structured = projectSalesAgentResponse(runtime, tool_trace, evidence_refs);
    const response = [
      `【客户理解】${structured.customer_understanding}`,
      `【最近变化】${structured.recent_changes}`,
      `【风险与机会】${structured.risks_and_opportunities}`,
      `【建议下一步】${structured.recommended_next_step}`,
      `【证据】${structured.evidence_refs.join('、') || '无'}`,
      `【工具】${tool_trace.map(item => item.tool_id).join(' → ')}`,
    ].join('\n');
    const result: AgentSessionResult = {
      plan,
      mode,
      provider: mode === 'mock'
        ? 'injected fake-host test transport + SalesAgentRuntime'
        : 'deterministic fallback + SalesAgentRuntime (no live provider)',
      model: 'Mock reasoning provider (deterministic_fixture_v1)',
      tool_trace,
      evidence_refs,
      confidence: 0.62,
      response,
      structured,
      requires_human_review: true,
      executable: false,
      writes_crm: false,
    };
    this.push('agent', result.response, mode);
    return result;
  }

  async capture(sourceType: CaptureSourceType, source: string): Promise<CustomerCaptureReview> {
    if (!source.trim()) throw new Error('Capture source is required.');
    if (!this.host) {
      return deterministicLocalCapture(this.customerId, sourceType, source);
    }
    let output: unknown;
    try {
      output = await this.host.capture({ customer_id: this.customerId, source_type: sourceType, source });
    } catch (error) {
      // Capture remains usable without an API key. The trusted host returns this
      // typed block when no provider is configured; it must never leak into UI.
      if (isUnavailableCaptureProvider(error)) {
        return deterministicLocalCapture(this.customerId, sourceType, source);
      }
      throw error;
    }
    return createUnreviewedCapture(
      this.customerId,
      sourceType,
      sourceType === 'image' ? 'QWEN_VISION_COMPATIBLE' : 'DEEPSEEK_COMPATIBLE',
      (output as { visual_facts?: unknown }).visual_facts,
    );
  }

  async persistReviewedFacts(review: CustomerCaptureReview): Promise<readonly string[]> {
    if (review.customer_id !== this.customerId) throw new Error('Capture customer scope mismatch.');
    if (!this.dependencies?.memory_repository) throw new Error('Memory repository is not configured.');
    return Promise.all(reviewedFacts(review).map(async fact => {
      const key = stableKey(`${fact.source_reference}:${fact.reviewed_content}`);
      const id = `capture-memory-${this.customerId}-${fact.fact_id}-${key}`;
      if (this.persistedFactIds.has(id)) return id;
      const entry = await this.dependencies!.memory_repository!.createCandidate({
        id,
        customer_id: this.customerId,
        memory_type: 'FACT',
        content: fact.reviewed_content,
        source_type: 'HUMAN_INPUT',
        source_reference: fact.source_reference,
        confidence: fact.confidence,
        evidence: [{ id: `capture-evidence-${fact.fact_id}-${key}`, evidence_type: 'CUSTOMER', evidence_id: this.customerId }],
      });
      this.persistedFactIds.add(id);
      return entry.id;
    }));
  }

  async analyzeReviewedFacts(review: CustomerCaptureReview): Promise<AgentSessionResult> {
    this.assertReviewed(review);
    const acceptedFacts = reviewedFacts(review).map(fact => fact.reviewed_content);
    const outcome = await this.submit(`Analyze reviewed customer capture facts: ${acceptedFacts.join('; ')}`);
    if (outcome.kind !== 'reasoning_result') {
      throw new Error(
        outcome.kind === 'write_proposal'
          ? 'Capture analysis must remain read-only.'
          : outcome.kind === 'clarification_required'
            ? 'Capture analysis must remain read-only.'
            : outcome.reason,
      );
    }
    const reviewedSummary = `已复核事实：${acceptedFacts.join('；')}`;
    const structured = {
      ...outcome.result.structured,
      customer_understanding: `${reviewedSummary}\n${outcome.result.structured.customer_understanding}`,
    };
    return {
      ...outcome.result,
      structured,
      response: `${reviewedSummary}\n${outcome.result.response}`,
    };
  }

  async createProposalFromReviewedFacts(review: CustomerCaptureReview): Promise<AgentWriteProposal> {
    this.assertReviewed(review);
    const facts = reviewedFacts(review);
    const factText = facts.map(fact => fact.reviewed_content).join('; ');
    const evidenceRefs = facts.map(fact => fact.source_reference);
    let outcome = await this.submit(factText, evidenceRefs);
    // A reviewed fact can be descriptive rather than an imperative. The user's
    // explicit Create Proposal click supplies the missing write intent, while
    // the generated proposal still remains unexecuted until exact confirmation.
    if (outcome.kind === 'reasoning_result') {
      outcome = await this.submit(`帮我写一条跟进：${factText}`, evidenceRefs);
    }
    if (outcome.kind !== 'write_proposal') {
      throw new Error(
        outcome.kind === 'reasoning_result'
          ? 'Reviewed facts did not request a supported CRM write.'
          : outcome.kind === 'clarification_required'
            ? 'Reviewed facts require clarification before a write proposal.'
            : outcome.reason,
      );
    }
    return outcome.proposal;
  }

  /**
   * Production confirm path: only proposal_id + nonce are trusted references.
   * Canonical proposal is always read from the session registry.
   */
  async confirmWriteByRef(
    ref: { readonly proposal_id: string; readonly nonce: string; readonly confirmed_at: string },
    boundary: SafeWriteBoundary,
  ) {
    const peeked = getCanonicalProposal(ref.proposal_id, this.customerId)
      ?? getCanonicalProposal(ref.proposal_id);
    if (!peeked) {
      if (wasProposalConsumed(ref.proposal_id, this.customerId) || wasProposalConsumed(ref.proposal_id)) {
        throw new Error('Confirmation replay rejected.');
      }
      throw new Error('Unknown or modified session-owned write proposal.');
    }
    if (peeked.customer_id !== this.customerId) {
      throw new Error('Unknown or modified session-owned write proposal.');
    }
    if (!peeked.nonce || peeked.nonce !== ref.nonce) {
      throw new Error('Confirmation does not match the exact proposal.');
    }
    const canonical = consumeCanonicalProposal(ref.proposal_id, this.customerId);
    if (!canonical) {
      throw new Error('Confirmation replay rejected.');
    }
    const confirmation: ExactConfirmation = {
      proposal_id: canonical.proposal_id,
      proposal_hash: canonical.proposal_hash,
      tool_id: canonical.tool_id,
      customer_id: canonical.customer_id,
      entity_id: canonical.entity_id,
      payload_hash: canonical.proposal_hash,
      nonce: ref.nonce,
      confirmed_at: ref.confirmed_at,
    };
    const accepted = consumeExactConfirmation(canonical, confirmation);
    return boundary.execute(accepted.proposal, accepted.confirmation_id);
  }

  /**
   * Compatibility confirm: UI/helpers may pass a proposal projection, but the registry
   * remains the source of truth. Modified projections are rejected before consume.
   */
  async confirmWrite(proposal: AgentWriteProposal, confirmation: ExactConfirmation, boundary: SafeWriteBoundary) {
    const peeked = getCanonicalProposal(proposal.proposal_id, this.customerId)
      ?? getCanonicalProposal(confirmation.proposal_id, this.customerId)
      ?? getCanonicalProposal(proposal.proposal_id);
    if (!peeked) {
      if (
        wasProposalConsumed(proposal.proposal_id, this.customerId)
        || wasProposalConsumed(confirmation.proposal_id, this.customerId)
        || wasProposalConsumed(proposal.proposal_id)
      ) {
        throw new Error('Confirmation replay rejected.');
      }
      throw new Error('Unknown or modified session-owned write proposal.');
    }
    if (proposalFingerprint(proposal) !== proposalFingerprint(peeked)) {
      throw new Error('Unknown or modified session-owned write proposal.');
    }
    // Compat path still rejects mismatched confirmation envelopes (wrong customer/tool/entity).
    if (
      confirmation.proposal_id !== peeked.proposal_id
      || confirmation.proposal_hash !== peeked.proposal_hash
      || confirmation.tool_id !== peeked.tool_id
      || confirmation.customer_id !== peeked.customer_id
      || confirmation.entity_id !== peeked.entity_id
      || confirmation.payload_hash !== peeked.proposal_hash
      || (peeked.nonce !== undefined && confirmation.nonce !== peeked.nonce)
    ) {
      throw new Error('Confirmation does not match the exact proposal.');
    }
    return this.confirmWriteByRef({
      proposal_id: peeked.proposal_id,
      nonce: confirmation.nonce,
      confirmed_at: confirmation.confirmed_at,
    }, boundary);
  }

  private async resumePendingWrite(answer: string, evidenceRefs: readonly string[]): Promise<SalesAgentSessionOutcome> {
    const pending = getPendingWriteDraft(this.customerId);
    if (!pending) return { kind: 'blocked', reason: '没有待澄清的写入意图。' };
    const merged = mergeClarificationAnswer(pending, answer, this.clock());
    if (merged.missing_fields.length > 0 && merged.question) {
      setPendingWriteDraft(this.customerId, merged);
      return { kind: 'clarification_required', clarification: this.toClarification(merged) };
    }
    setPendingWriteDraft(this.customerId, null);
    return this.emitWriteProposal(merged, evidenceRefs);
  }

  private async emitWriteProposal(draft: WriteFieldDraft, evidenceRefs: readonly string[]): Promise<SalesAgentSessionOutcome> {
    const plan = localWritePlan(this.customerId, draft.original_instruction) ?? validateSemanticPlan({
      intent: draft.intent,
      customer_id: this.customerId,
      confidence: 0,
      provider_kind: 'DETERMINISTIC_FALLBACK',
      steps: [{ tool_id: draft.tool_id, customer_id: this.customerId, access: 'write', requires_confirmation: true, reason: 'Session-owned write proposal.' }],
    }, this.customerId);
    const grouped_operations = await this.groupedOperationsForDraft(draft);
    const current_values = grouped_operations ? {} : await this.currentValuesForTool(draft.tool_id);
    const built = buildWriteProposal({
      customer_id: this.customerId,
      message: draft.original_instruction,
      evidence_refs: evidenceRefs,
      created_at: this.clock(),
      current_values,
      tool_id: draft.tool_id,
      proposed_values: proposedValuesFromDraft(draft),
      reason: '用户本次明确指令',
      ...(grouped_operations ? { grouped_operations } : {}),
    });
    const proposal = registerCanonicalProposal(built);
    setPendingWriteDraft(this.customerId, null);
    void plan;
    return { kind: 'write_proposal', proposal };
  }

  private async groupedOperationsForDraft(draft: WriteFieldDraft): Promise<readonly GroupedWriteOperation[] | undefined> {
    const next = draft.parsed_fields.next_follow_up_at;
    if (draft.tool_id !== 'create_follow_up_record' || typeof next !== 'string') return undefined;
    const customer = await this.dependencies?.loadCustomerSnapshot?.(this.customerId);
    if (!customer) throw new Error('生成组合建议前需要读取当前客户的下次跟进时间。');
    return [
      {
        operation_id: 'record-follow-up-now',
        label: '新增当前跟进记录',
        tool_id: 'create_follow_up_record',
        current_values: {},
        proposed_values: proposedValuesFromDraft(draft),
        selected: true,
      },
      {
        operation_id: 'update-next-follow-up',
        label: '更新下次跟进时间',
        tool_id: 'update_next_follow_up_time',
        current_values: { next_follow_up_at: customer.next_follow_up_at },
        proposed_values: { next_follow_up_at: next },
        selected: true,
      },
    ];
  }

  private toClarification(draft: WriteFieldDraft): WriteClarificationRequest {
    return {
      kind: 'CLARIFICATION_REQUIRED',
      clarification_id: `clarify-${this.customerId}-${++this.clarificationSeq}`,
      intent: draft.intent,
      tool_id: draft.tool_id,
      original_instruction: draft.original_instruction,
      customer_id: this.customerId,
      question: draft.question ?? '请补充必要信息以继续写入。',
      missing_fields: draft.missing_fields,
      parsed_fields: draft.parsed_fields,
      quick_replies: draft.quick_replies,
      pending_write_intent: draft.intent,
    };
  }

  private assertReviewed(review: CustomerCaptureReview) {
    if (review.customer_id !== this.customerId || reviewedFacts(review).length === 0) {
      throw new Error('Accepted or edited customer-scoped facts are required.');
    }
  }

  private async currentValuesForTool(toolId: string): Promise<Readonly<Record<string, unknown>>> {
    if (toolId !== 'update_next_follow_up_time') return {};
    const customer = await this.dependencies?.loadCustomerSnapshot?.(this.customerId);
    if (!customer) throw new Error('The current customer snapshot is required before proposing a next follow-up update.');
    return { next_follow_up_at: customer.next_follow_up_at };
  }

  private push(role: AgentSessionMessage['role'], content: string, mode: AgentMode) {
    this.messages.push({ id: `${role}-${this.messages.length + 1}`, role, content, mode, created_at: this.clock() });
  }
}

function stableKey(value: string): string {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) | 0;
  return String(hash >>> 0);
}

function proposalFingerprint(proposal: AgentWriteProposal): string {
  return `${proposal.proposal_id}:${proposal.proposal_hash}:${JSON.stringify(proposal.proposed_values)}:${JSON.stringify(proposal.grouped_operations ?? null)}:${proposal.entity_id ?? ''}`;
}

// Re-export for callers that still expect the name
export { deterministicSemanticFallback };
