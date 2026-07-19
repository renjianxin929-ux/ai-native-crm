import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext, MemoryRepository } from '../customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import { formatUserFacingErrorMessage } from '../salesAgentUi/formatUserFacingError';
import { executeSalesAgentReadTool, type SalesAgentCustomerScopedToolId, type SalesAgentToolResult } from './registry';
import { intentFromEnvelope, type SalesAgentResponseProjection } from './operatingLayer';
import { createAgentIntentEnvelopeFromPreset, type AgentIntentEnvelope } from './agentIntentEnvelope';
import type { GroundedClaim } from '../productionAi/evidenceGrounding';
import { validateSemanticPlan, deterministicSemanticFallback, type ValidatedSemanticPlan } from './semanticPlanning';
import { buildWriteProposal, consumeExactConfirmation, type AgentWriteProposal, type ExactConfirmation, type GroupedWriteOperation } from './confirmedWrite';
import { createUnreviewedCapture, reviewedFacts, type CaptureSourceType, type CustomerCaptureReview } from '../customerCapture/review';
import {
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
import {
  acquireSessionModelLock,
  releaseSessionModelLock,
  runProductionReasoningPath,
  type ProductionModelCaller,
  type ProductionRuntimeDetails,
  validateModelOutputSchema,
  buildRuntimeDetails,
} from '../productionAi';

export type AgentMode = 'live' | 'fallback';
/** Host behavior is injected at the app boundary; React never creates provider behavior. */
export interface SalesAgentHost {
  reason(input: { customer_id: string; message: string }): Promise<unknown>;
  capture(input: { customer_id: string; source_type: CaptureSourceType; source: string; signal?: AbortSignal }): Promise<unknown>;
  createProductionModelCaller?: () => ProductionModelCaller;
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
  readonly runtime_details: ProductionRuntimeDetails;
  readonly blocked_message: string | null;
  readonly intent_envelope: AgentIntentEnvelope;
  readonly grounded_claims: readonly GroundedClaim[];
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
  /** Read-only catalog context used only for an explicit 2–5 customer compare allowlist. */
  readonly compare_context?: ContextSnapshot;
  readonly memory?: CustomerMemoryContext;
  readonly profile_id: string;
  readonly memory_repository?: MemoryRepository;
  readonly loadCustomerSnapshot?: (customerId: string) => Promise<{ next_follow_up_at: string | null } | null>;
  /**
   * `deterministic` (production default for chat): local intent planning, no live planning provider.
   * `host`: call injected host.reason (tests / explicit live planning).
   */
  readonly planning_mode?: 'deterministic' | 'host';
  /** Injected Fake Transport / Trusted Host caller for tests and production adapter. */
  readonly model_caller?: ProductionModelCaller;
  readonly abort_signal?: AbortSignal;
}

const READ_TOOLS_BY_INTENT: Record<string, readonly SalesAgentCustomerScopedToolId[]> = {
  CUSTOMER_SUMMARY: ['get_customer', 'get_customer_context', 'get_active_memory', 'get_customer_timeline'],
  CUSTOMER_RISK_ANALYSIS: ['get_customer_context', 'get_customer_timeline', 'get_active_memory', 'get_today_priority'],
  CUSTOMER_TIMELINE_REVIEW: ['get_customer', 'get_customer_timeline', 'list_customer_followups', 'list_customer_visits'],
  NEXT_ACTION_PREPARATION: ['get_customer_context', 'get_customer_timeline', 'list_customer_tasks', 'get_active_memory'],
  FOLLOW_UP_DRAFT: ['get_customer', 'get_customer_timeline', 'get_active_memory', 'get_existing_ai_results'],
  INTERACTION_SUMMARY: ['get_customer_timeline', 'get_active_memory'],
  COMPLEX_CUSTOMER_COMPARE: ['get_customer_context', 'get_customer_timeline', 'get_active_memory'],
  SAFE_FALLBACK: ['get_customer_context', 'get_active_memory', 'get_customer_timeline'],
};

export function deterministicPlanForEnvelope(customerId: string, envelope: AgentIntentEnvelope): ValidatedSemanticPlan {
  const write = localWritePlan(customerId, envelope);
  if (write) return write;
  const intent = intentFromEnvelope(envelope);
  const tools = READ_TOOLS_BY_INTENT[intent] ?? READ_TOOLS_BY_INTENT.SAFE_FALLBACK;
  return validateSemanticPlan({
    intent: intent === 'CUSTOMER_RISK_ANALYSIS' ? 'CUSTOMER_RISK_ANALYSIS'
      : intent === 'CUSTOMER_TIMELINE_REVIEW' ? 'CUSTOMER_TIMELINE_REVIEW'
        : intent === 'NEXT_ACTION_PREPARATION' ? 'NEXT_ACTION_PREPARATION'
           : intent === 'FOLLOW_UP_DRAFT' ? 'FOLLOW_UP_DRAFT'
             : intent === 'INTERACTION_SUMMARY' ? 'INTERACTION_SUMMARY'
               : intent === 'COMPLEX_CUSTOMER_COMPARE' ? 'COMPLEX_CUSTOMER_COMPARE'
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

function localWritePlan(customerId: string, envelope: AgentIntentEnvelope): ValidatedSemanticPlan | null {
  const draft = envelope.write_draft;
  if (!draft) return null;
  return validateSemanticPlan({
    intent: draft.intent,
    customer_id: customerId,
    confidence: 0,
    provider_kind: 'DETERMINISTIC_FALLBACK',
    steps: [{
      tool_id: draft.tool_id,
      customer_id: customerId,
      access: 'write',
      requires_confirmation: true,
      reason: 'Authoritative AgentIntentEnvelope write decision.',
    }],
  }, customerId);
}

function deterministicLocalCapture(customerId: string, sourceType: CaptureSourceType, source: string): CustomerCaptureReview {
  if (sourceType !== 'text') throw new Error('多模态模型未配置或不可用，本次未进行图片 AI 分析。请配置 Vision Provider 后重试。');
  const facts = source.split(/[。！？\n]+/).map(item => item.trim()).filter(Boolean).slice(0, 20).map((content, index) => ({
        fact_id: `local-text-${index + 1}-${stableKey(content)}`,
        fact_type: /反对|不接受|太贵|拒绝/.test(content) ? 'visible_objection' : /需要|希望|要求|计划|下周|报价/.test(content) ? 'visible_requirement' : 'extracted_text',
        content,
        source_reference: `text:${index + 1}`,
        confidence: 1,
      }));
  return createUnreviewedCapture(customerId, sourceType, 'DETERMINISTIC_LOCAL', facts, buildRuntimeDetails({
    runtime_mode: 'LOCAL_DETERMINISTIC', provider: null, model: null, model_called: false,
    request_id: `capture-local-${stableKey(source)}`, latency_ms: 0, token_usage: null, tools_used: ['local_text_capture'],
    evidence_count: facts.length, degraded: false, degradation_reason: null, validation_status: 'not_applicable',
    evidence_validation_status: 'not_applicable', cancellation_status: 'not_requested', requires_real_model: false,
  }));
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

  /** Consumes the controller-owned immutable intent decision; this layer never classifies user text. */
  async submit(
    intentEnvelope: AgentIntentEnvelope,
    evidenceRefs: readonly string[] = [`customer:${this.customerId}`],
  ): Promise<SalesAgentSessionOutcome> {
    const message = intentEnvelope.original_instruction;
    if (!message.trim()) return { kind: 'blocked', reason: formatUserFacingErrorMessage('A message is required.') };
    try {
      if (getPendingWriteDraft(this.customerId)) {
        const answer = typeof intentEnvelope.extracted_fields.clarification_answer === 'string'
          ? intentEnvelope.extracted_fields.clarification_answer
          : message.trim();
        return await this.resumePendingWrite(answer, evidenceRefs);
      }

      const draft = intentEnvelope.write_draft;
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

      if (intentEnvelope.clarification_required && intentEnvelope.intent === 'SAFE_FALLBACK' && this.dependencies?.planning_mode !== 'host') {
        return { kind: 'blocked', reason: '无法高置信度确定请求意图，请明确是总结、风险分析、下一步建议、跟进文案、互动总结、客户比较还是图片分析。' };
      }
      const plan = await this.plan(intentEnvelope);
      if (plan.steps.some(step => step.access === 'write')) {
        const writeStep = plan.steps.find(step => step.access === 'write')!;
        const fallbackDraft = intentEnvelope.write_draft ?? {
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
      return { kind: 'reasoning_result', result: await this.askWithPlan(intentEnvelope, plan) };
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

  async ask(intentEnvelope: AgentIntentEnvelope): Promise<AgentSessionResult> {
    const outcome = await this.submit(intentEnvelope);
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

  private async plan(envelope: AgentIntentEnvelope): Promise<ValidatedSemanticPlan> {
    if (!this.dependencies) throw new Error('Sales Agent production dependencies are not configured.');
    const mode = this.dependencies.planning_mode ?? (this.host ? 'host' : 'deterministic');
    if (mode === 'host' && this.host) {
      return validateSemanticPlan(await this.host.reason({ customer_id: this.customerId, message: envelope.normalized_instruction }), this.customerId);
    }
    if (!this.host) return deterministicPlanForEnvelope(this.customerId, envelope);
    // Deterministic chat path — do not call live Trusted Host / provider for ordinary asks.
    return deterministicPlanForEnvelope(this.customerId, envelope);
  }

  private async askWithPlan(intentEnvelope: AgentIntentEnvelope, plan: ValidatedSemanticPlan): Promise<AgentSessionResult> {
    if (!this.dependencies) throw new Error('Sales Agent production dependencies are not configured.');
    const message = intentEnvelope.original_instruction;
    const request_id = intentEnvelope.envelope_id;
    const sessionKey = `${this.customerId}:${this.dependencies.context.snapshotId}`;
    if (!acquireSessionModelLock(sessionKey, request_id)) {
      throw new Error('同一会话已有进行中的模型请求，请等待完成或取消后再试。');
    }
    try {
      const tool_trace = plan.steps
        .filter(step => step.access === 'read')
        .map(step => executeSalesAgentReadTool(step.tool_id as SalesAgentCustomerScopedToolId, {
          customer_id: this.customerId,
          snapshot: this.dependencies!.snapshot,
          context: this.dependencies!.context,
          memory: this.dependencies!.memory,
        }));
      if (!tool_trace.length) throw new Error('A successful read result requires an executed registered read tool.');

      const model_caller = this.dependencies.model_caller
        ?? this.host?.createProductionModelCaller?.()
        ?? undefined;

      const compareAllowlist = intentEnvelope.intent === 'COMPLEX_CUSTOMER_COMPARE'
        && Array.isArray(intentEnvelope.extracted_fields.customer_allowlist)
        ? intentEnvelope.extracted_fields.customer_allowlist.filter((item): item is string => typeof item === 'string')
        : undefined;
      const path = await runProductionReasoningPath({
        request_id,
        intent: plan.intent,
        message,
        customer_id: this.customerId,
        customer_allowlist: compareAllowlist,
        context: compareAllowlist ? (this.dependencies.compare_context ?? this.dependencies.context) : this.dependencies.context,
        memory: this.dependencies.memory,
        tool_trace,
        callModel: model_caller,
        signal: this.dependencies.abort_signal,
      });
      if (this.dependencies.abort_signal?.aborted || path.runtime.cancellation_status === 'cancelled_at_host') {
        throw new Error('cancelled');
      }

      const mode: AgentMode = path.runtime.runtime_mode === 'REAL_MODEL' ? 'live' : 'fallback';
      this.push('user', message, mode);

      const response = [
        path.blocked_message ? `【状态】${path.blocked_message}` : null,
        `【客户理解】${path.structured.customer_understanding}`,
        `【最近变化】${path.structured.recent_changes}`,
        `【风险与机会】${path.structured.risks_and_opportunities}`,
        `【建议下一步】${path.structured.recommended_next_step}`,
        `【证据】${path.evidence_refs.join('、') || '无'}`,
        `【工具】${tool_trace.map(item => item.tool_id).join(' → ')}`,
        `【运行模式】${path.runtime.ui_label}`,
      ].filter(Boolean).join('\n');

      const result: AgentSessionResult = {
        plan,
        mode,
        provider: path.runtime.provider ?? (mode === 'fallback' ? 'local_deterministic' : 'none'),
        model: path.runtime.model ?? 'none',
        tool_trace,
        evidence_refs: path.evidence_refs,
        confidence: path.runtime.model_called && !path.runtime.degraded ? 0.72 : 0.55,
        response,
        structured: path.structured,
        requires_human_review: true,
        executable: false,
        writes_crm: false,
        runtime_details: path.runtime,
        blocked_message: path.blocked_message,
        intent_envelope: intentEnvelope,
        grounded_claims: path.grounded_result?.claims ?? [],
      };
      if (this.dependencies.abort_signal?.aborted) throw new Error('cancelled');
      this.push('agent', result.response, mode);
      return result;
    } finally {
      releaseSessionModelLock(sessionKey, request_id);
    }
  }

  async capture(sourceType: CaptureSourceType, source: string, signal?: AbortSignal, intentEnvelope?: AgentIntentEnvelope): Promise<CustomerCaptureReview> {
    if (!source.trim()) throw new Error('Capture source is required.');
    if (sourceType === 'image' && !this.host) {
      throw new Error('多模态模型未配置或不可用，本次未进行图片 AI 分析。请配置 Vision Provider 后重试。');
    }
    if (sourceType === 'image' && intentEnvelope && (intentEnvelope.intent !== 'CAPTURE_REVIEW' || intentEnvelope.capture_intent !== 'image_analysis')) {
      throw new Error('Capture Analyze requires a formal Vision Intent Envelope.');
    }
    if (!this.host) {
      return deterministicLocalCapture(this.customerId, sourceType, source);
    }
    const activeSignal = signal ?? this.dependencies?.abort_signal;
    if (activeSignal?.aborted) throw new Error('cancelled');
    const output = await this.host.capture({ customer_id: this.customerId, source_type: sourceType, source, signal: activeSignal });
    if (activeSignal?.aborted) throw new Error('cancelled');
    if (sourceType === 'image') {
      const validation = validateModelOutputSchema('image_capture_analysis_v1', output);
      if (!validation.valid || validation.output?.schema !== 'image_capture_analysis_v1') {
        throw new Error('多模态模型输出未通过 image_capture_analysis_v1 封闭 Schema 校验。');
      }
      return createUnreviewedCapture(this.customerId, sourceType, 'QWEN_VISION_COMPATIBLE', validation.output.value.extracted_facts, buildRuntimeDetails({
        runtime_mode: 'REAL_MODEL', provider: 'QWEN_VISION_COMPATIBLE', model: 'qwen-vl-plus', model_called: true,
        request_id: intentEnvelope?.envelope_id ?? 'capture-host-request', latency_ms: null, token_usage: null, tools_used: [],
        evidence_count: validation.output.value.extracted_facts.length, degraded: false, degradation_reason: null,
        validation_status: 'passed', evidence_validation_status: 'passed', cancellation_status: 'not_requested', requires_real_model: true,
      }));
    }
    return createUnreviewedCapture(
      this.customerId,
      sourceType,
      'DEEPSEEK_COMPATIBLE',
      (output as { extracted_facts?: unknown }).extracted_facts,
    );
  }

  async persistReviewedFacts(review: CustomerCaptureReview): Promise<readonly string[]> {
    if (review.customer_id !== this.customerId) throw new Error('Capture customer scope mismatch.');
    if (!this.dependencies?.memory_repository) throw new Error('Memory repository is not configured.');
    return Promise.all(reviewedFacts(review).map(async fact => {
      const key = stableKey(`${fact.source_reference}:${fact.reviewed_content}`);
      const id = `capture-memory-${this.customerId}-${fact.fact_id}-${key}`;
      if (this.persistedFactIds.has(id)) return id;
      const repository = this.dependencies!.memory_repository!;
      const evidence = { id: `capture-evidence-${fact.fact_id}-${key}`, evidence_type: 'CUSTOMER' as const, evidence_id: this.customerId };
      const existing = (await repository.listCustomerMemory(this.customerId)).find(item => item.id === id);
      if (existing) {
        const exactReplay = existing.customer_id === this.customerId
          && existing.memory_type === 'FACT'
          && existing.content === fact.reviewed_content
          && existing.source_type === 'HUMAN_INPUT'
          && existing.source_reference === fact.source_reference
          && existing.confidence === fact.confidence
          && existing.evidence.some(link => link.id === evidence.id && link.evidence_type === evidence.evidence_type && link.evidence_id === evidence.evidence_id);
        if (!exactReplay) throw new Error('Capture memory identity collision.');
        this.persistedFactIds.add(id);
        return id;
      }
      const entry = await repository.createCandidate({
        id,
        customer_id: this.customerId,
        memory_type: 'FACT',
        content: fact.reviewed_content,
        source_type: 'HUMAN_INPUT',
        source_reference: fact.source_reference,
        confidence: fact.confidence,
        evidence: [evidence],
      });
      this.persistedFactIds.add(id);
      return entry.id;
    }));
  }

  async analyzeReviewedFacts(review: CustomerCaptureReview): Promise<AgentSessionResult> {
    this.assertReviewed(review);
    const acceptedFacts = reviewedFacts(review).map(fact => fact.reviewed_content);
    const instruction = `Analyze reviewed customer capture facts: ${acceptedFacts.join('; ')}`;
    const outcome = await this.submit(createAgentIntentEnvelopeFromPreset({
      instruction,
      now_iso: this.clock(),
      intent: 'CUSTOMER_SUMMARY',
      mode: 'customer_analysis',
    }));
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
    // The explicit Create Proposal click becomes one standard instruction and
    // one immutable envelope; the proposal remains unexecuted until confirmation.
    const outcome = await this.submit(createAgentIntentEnvelopeFromPreset({
      instruction: factText,
      now_iso: this.clock(),
      intent: 'CREATE_FOLLOW_UP_REQUEST',
      mode: 'write_action',
    }), evidenceRefs);
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
