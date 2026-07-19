/**
 * Canonical Sales Agent interaction state machine.
 * Owns customer resolution, pending-instruction continuation, and scoped persistence.
 * React may only render this state and dispatch user/candidate actions.
 */

import type { DatabaseLike } from '../db';
import { formatUserFacingErrorMessage } from '../salesAgentUi/formatUserFacingError';
import type { AgentSessionResult, SalesAgentSession, SalesAgentSessionOutcome, SafeWriteBoundary } from './agentSession';
import type { AgentWriteProposal } from './confirmedWrite';
import type { WriteClarificationRequest } from './writeIntent';
import {
  resumeInstructionAfterScope,
} from './filterNormalization';
import { executeSearchCustomersTool } from './executeSearchCustomersTool';
import type { CustomerSearchCandidate, SearchCustomersResult } from './searchCustomers';
import { isClosedWriteIntentUtterance } from './writeIntent';
import { invalidateCustomerWriteState } from './sessionWriteStateStore';
import { applySemanticIntentResolution, createAgentIntentEnvelope, mergeAgentIntentClarificationAnswer, type AgentIntentEnvelope, type SemanticIntentResolution } from './agentIntentEnvelope';
import { SALES_AGENT_APP_CLOCK } from './appClock';

export type SalesAgentInteractionPhase =
  | 'unscoped'
  | 'resolving_customer'
  | 'awaiting_candidate_selection'
  | 'portfolio_browse'
  | 'scoped'
  | 'reasoning'
  | 'proposal'
  | 'clarification'
  | 'blocked'
  | 'error';

export const CANONICAL_AGENT_SESSION_PHASES = [
  'idle', 'parsing', 'portfolio_results', 'resolving_customer', 'awaiting_candidate',
  'loading_context', 'reasoning', 'clarification_required', 'awaiting_confirmation',
  'executing_write', 'completed', 'blocked', 'error',
] as const;
export type CanonicalAgentSessionPhase = typeof CANONICAL_AGENT_SESSION_PHASES[number];

export function projectCanonicalSessionPhase(phase: SalesAgentInteractionPhase): CanonicalAgentSessionPhase {
  const mapping: Record<SalesAgentInteractionPhase, CanonicalAgentSessionPhase> = {
    unscoped: 'idle',
    resolving_customer: 'resolving_customer',
    awaiting_candidate_selection: 'awaiting_candidate',
    portfolio_browse: 'portfolio_results',
    scoped: 'completed',
    reasoning: 'reasoning',
    proposal: 'awaiting_confirmation',
    clarification: 'clarification_required',
    blocked: 'blocked',
    error: 'error',
  };
  return mapping[phase];
}

export interface SalesAgentInteractionState {
  readonly phase: SalesAgentInteractionPhase;
  readonly scoped_customer_id: string | null;
  readonly scoped_customer_name: string | null;
  readonly pending_original_instruction: string | null;
  readonly candidate_results: readonly CustomerSearchCandidate[];
  readonly candidate_empty_exact: boolean;
  readonly portfolio_total_matches: number;
  readonly portfolio_page_offset: number;
  readonly portfolio_has_more: boolean;
  readonly portfolio_filters_message: string | null;
  readonly resolution_reason: string | null;
  readonly current_intent: string | null;
  readonly intent_envelope: AgentIntentEnvelope | null;
  readonly latest_result: AgentSessionResult | null;
  readonly latest_proposal: AgentWriteProposal | null;
  readonly latest_clarification: WriteClarificationRequest | null;
  readonly latest_search: SearchCustomersResult | null;
  readonly submit_locked: boolean;
  readonly user_message: string | null;
  readonly agent_message: string | null;
  /** New conversation clears history; customer scope retention is explicit. */
  readonly retain_customer_scope_on_new_conversation: true;
}

export type SalesAgentInteractionEvent =
  | { readonly type: 'bind_required'; readonly customer_id: string; readonly customer_name: string; readonly continue_prompt: string }
  | { readonly type: 'clear_scope' }
  | { readonly type: 'portfolio_list' }
  | { readonly type: 'idle' };

export interface SalesAgentInteractionTurn {
  readonly state: SalesAgentInteractionState;
  readonly event: SalesAgentInteractionEvent;
  readonly outcome?: SalesAgentSessionOutcome;
}

const INITIAL: SalesAgentInteractionState = {
  phase: 'unscoped',
  scoped_customer_id: null,
  scoped_customer_name: null,
  pending_original_instruction: null,
  candidate_results: [],
  candidate_empty_exact: false,
  portfolio_total_matches: 0,
  portfolio_page_offset: 0,
  portfolio_has_more: false,
  portfolio_filters_message: null,
  resolution_reason: null,
  current_intent: null,
  intent_envelope: null,
  latest_result: null,
  latest_proposal: null,
  latest_clarification: null,
  latest_search: null,
  submit_locked: false,
  user_message: null,
  agent_message: null,
  retain_customer_scope_on_new_conversation: true,
};

export interface SalesAgentInteractionControllerDeps {
  readonly db: DatabaseLike;
  readonly createSession: (customerId: string) => SalesAgentSession | null;
  readonly customer_catalog?: readonly { readonly id: string; readonly name: string }[];
  readonly clock?: () => string;
  readonly semantic_intent_router?: (instruction: string, envelopeId: string, signal?: AbortSignal) => Promise<SemanticIntentResolution>;
}

function corpusNameHitsFromCandidates(
  message: string,
  candidates: readonly { id: string; name: string }[],
): typeof candidates {
  const hits = candidates.filter(item => message.includes(item.name) && item.name.trim().length >= 2);
  return hits;
}

export class SalesAgentInteractionController {
  private state: SalesAgentInteractionState = { ...INITIAL };
  private readonly candidateIds = new Set<string>();
  private readonly deps: SalesAgentInteractionControllerDeps;
  /** Mutable so React can point at the latest SalesAgentSession after bind. */
  createSession: (customerId: string) => SalesAgentSession | null;
  semanticIntentRouter: ((instruction: string, envelopeId: string, signal?: AbortSignal) => Promise<SemanticIntentResolution>) | null;

  private parseIntentEnvelope(message: string): AgentIntentEnvelope {
    return createAgentIntentEnvelope(message, this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now());
  }
  customerCatalog: readonly { readonly id: string; readonly name: string }[];

  constructor(deps: SalesAgentInteractionControllerDeps) {
    this.deps = deps;
    this.createSession = deps.createSession;
    this.semanticIntentRouter = deps.semantic_intent_router ?? null;
    this.customerCatalog = deps.customer_catalog ?? [];
  }

  getState(): SalesAgentInteractionState {
    return this.state;
  }

  /** Sync external React-bound scope into the controller (e.g. from customer detail entry). */
  syncExternalScope(customerId: string | null, customerName?: string | null): void {
    if (!customerId) {
      if (this.state.scoped_customer_id) {
        invalidateCustomerWriteState(this.state.scoped_customer_id);
        this.state = {
          ...this.state,
          phase: 'unscoped',
          scoped_customer_id: null,
          scoped_customer_name: null,
          latest_proposal: null,
          latest_clarification: null,
          agent_message: this.state.latest_proposal
            ? '客户上下文已清除，未确认的写入建议已失效。'
            : this.state.agent_message,
        };
      }
      return;
    }
    if (this.state.scoped_customer_id === customerId) return;
    const previous = this.state.scoped_customer_id;
    const hadPendingWrite = Boolean(this.state.latest_proposal || this.state.latest_clarification);
    if (previous) invalidateCustomerWriteState(previous);
    this.state = {
      ...this.state,
      phase: 'scoped',
      scoped_customer_id: customerId,
      scoped_customer_name: customerName ?? this.state.scoped_customer_name,
      candidate_results: [],
      candidate_empty_exact: false,
      latest_proposal: null,
      latest_clarification: null,
      portfolio_total_matches: 0,
      portfolio_page_offset: 0,
      portfolio_has_more: false,
      portfolio_filters_message: null,
      agent_message: hadPendingWrite
        ? '已切换客户，未确认的写入建议已失效，请重新下达指令。'
        : this.state.agent_message,
    };
  }

  /**
   * Production confirm entry: only proposal_id + nonce.
   * Canonical payload is read from the process-stable write-state store via Session.
   */
  async confirmProposal(
    session: SalesAgentSession,
    ref: { readonly proposal_id: string; readonly nonce: string },
    boundary: SafeWriteBoundary,
  ) {
    return session.confirmWriteByRef({
      proposal_id: ref.proposal_id,
      nonce: ref.nonce,
      confirmed_at: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
    }, boundary);
  }

  /**
   * New conversation: clears conversation artifacts including pending proposals/clarifications.
   * Customer scope is retained by default (retain_customer_scope_on_new_conversation: true).
   */
  startNewConversation(options?: { readonly clear_customer_scope?: boolean }): SalesAgentInteractionState {
    const clear = options?.clear_customer_scope === true;
    if (this.state.scoped_customer_id) {
      invalidateCustomerWriteState(this.state.scoped_customer_id);
    }
    this.candidateIds.clear();
    this.state = {
      ...INITIAL,
      phase: clear || !this.state.scoped_customer_id ? 'unscoped' : 'scoped',
      scoped_customer_id: clear ? null : this.state.scoped_customer_id,
      scoped_customer_name: clear ? null : this.state.scoped_customer_name,
      retain_customer_scope_on_new_conversation: true,
      agent_message: '已开始新对话。未确认的写入建议已清除。',
    };
    return this.state;
  }

  clearCustomerScope(): SalesAgentInteractionState {
    if (this.state.scoped_customer_id) {
      invalidateCustomerWriteState(this.state.scoped_customer_id);
    }
    this.candidateIds.clear();
    this.state = {
      ...this.state,
      phase: 'unscoped',
      scoped_customer_id: null,
      scoped_customer_name: null,
      pending_original_instruction: null,
      candidate_results: [],
      candidate_empty_exact: false,
      portfolio_total_matches: 0,
      portfolio_page_offset: 0,
      portfolio_has_more: false,
      portfolio_filters_message: null,
      latest_proposal: null,
      latest_clarification: null,
      resolution_reason: '已清除当前客户上下文。',
      agent_message: '已清除当前客户上下文。',
    };
    return this.state;
  }

  /** Load next portfolio page without forcing single-customer bind. */
  async loadMorePortfolio(): Promise<SalesAgentInteractionTurn> {
    if (this.state.phase !== 'portfolio_browse' || !this.state.latest_search || !this.state.portfolio_has_more) {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '当前没有可继续加载的客户组合结果。' },
      };
    }
    if (this.state.submit_locked) {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '上一条请求仍在处理中，请稍候。' },
      };
    }
    const prev = this.state.latest_search;
    if (!prev) {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '当前没有可继续加载的客户组合结果。' },
      };
    }
    this.state = { ...this.state, submit_locked: true };
    try {
      const nextOffset = prev.page_offset + prev.candidates.length;
      const search = await executeSearchCustomersTool({
        filters: prev.filters_applied,
        unsupported_filters: prev.unsupported_filters,
        notes: prev.notes,
        list_kind: 'portfolio',
        offset: nextOffset,
        page_size: prev.page_size,
        db: this.deps.db,
      });
      for (const item of search.candidates) this.candidateIds.add(item.id);
      const merged = [...this.state.candidate_results, ...search.candidates];
      const start = 1;
      const end = merged.length;
      const agent_message = `共找到 ${search.total_matches} 家，当前展示 ${start}–${end}${search.has_more ? '。可继续加载更多。' : '。'}`;
      this.state = {
        ...this.state,
        phase: 'portfolio_browse',
        candidate_results: merged,
        latest_search: {
          ...search,
          candidates: search.candidates,
          page_offset: nextOffset,
        },
        portfolio_total_matches: search.total_matches,
        portfolio_page_offset: nextOffset,
        portfolio_has_more: search.has_more,
        submit_locked: false,
        agent_message,
      };
      return { state: this.state, event: { type: 'portfolio_list' } };
    } catch (cause) {
      const reason = formatUserFacingErrorMessage(cause);
      this.state = {
        ...this.state,
        phase: 'error',
        submit_locked: false,
        resolution_reason: reason,
        agent_message: reason,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'error', reason } };
    }
  }

  async submit(message: string, signal?: AbortSignal): Promise<SalesAgentInteractionTurn> {
    if (this.state.submit_locked) {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '上一条请求仍在处理中，请稍候。' },
      };
    }
    const trimmed = message.trim();
    if (!trimmed) {
      this.state = {
        ...this.state,
        phase: 'blocked',
        resolution_reason: '请输入销售问题或客户名称。',
        agent_message: '请输入销售问题或客户名称。',
        user_message: message,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason: this.state.resolution_reason! } };
    }
    const continuationEnvelope = this.state.phase === 'clarification' ? this.state.intent_envelope : null;
    const continuationCustomerId = this.state.phase === 'clarification' ? this.state.scoped_customer_id : null;
    const hasWriteClarification = this.state.phase === 'clarification' && Boolean(this.state.latest_clarification);

    this.state = {
      ...this.state,
      submit_locked: true,
      user_message: trimmed,
      latest_result: null,
      latest_proposal: null,
      latest_clarification: this.state.phase === 'clarification' ? this.state.latest_clarification : null,
      resolution_reason: null,
    };

    try {
      if (continuationEnvelope && continuationCustomerId && hasWriteClarification) {
        return await this.runScoped(
          mergeAgentIntentClarificationAnswer(continuationEnvelope, trimmed),
          continuationCustomerId,
        );
      }
      let intentEnvelope = this.parseIntentEnvelope(trimmed);
      if (intentEnvelope.intent === 'SAFE_FALLBACK' && this.semanticIntentRouter) {
        try {
          const semantic = await this.semanticIntentRouter(trimmed, intentEnvelope.envelope_id, signal);
          intentEnvelope = applySemanticIntentResolution(intentEnvelope, semantic);
        } catch {
          const reason = '当前未配置可用的语义识别服务。请明确是总结、风险分析、下一步建议、跟进文案、互动总结、客户比较还是图片分析。';
          this.state = { ...this.state, phase: 'clarification', submit_locked: false, current_intent: intentEnvelope.intent, intent_envelope: intentEnvelope, resolution_reason: reason, agent_message: reason };
          return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
        }
      }
      this.state = { ...this.state, current_intent: intentEnvelope.intent, intent_envelope: intentEnvelope };

      if (intentEnvelope.mode === 'capture' && intentEnvelope.clarification_required) {
        const reason = '请先通过附件入口选择一张 JPEG、PNG 或 WebP 图片，再显式点击 Analyze image。';
        this.state = { ...this.state, phase: 'clarification', submit_locked: false, resolution_reason: reason, agent_message: reason };
        return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
      }
      if (intentEnvelope.intent === 'COMPLEX_CUSTOMER_COMPARE') {
        let selected = corpusNameHitsFromCandidates(trimmed, this.customerCatalog);
        // The directory is loaded asynchronously in React. Resolve against the
        // read-only repository as the authoritative fallback so an early UI turn
        // cannot become a false clarification merely because catalog props raced.
        if (selected.length < 2) {
          const repositoryCatalog = await executeSearchCustomersTool({
            filters: {}, notes: ['compare explicit-name resolution'], list_kind: 'portfolio', offset: 0, db: this.deps.db,
          });
          selected = corpusNameHitsFromCandidates(trimmed, repositoryCatalog.candidates);
        }
        if (selected.length < 2 || selected.length > 5) {
          const reason = selected.length > 5
            ? '一次客户比较只允许显式选择 2–5 家客户；当前请求超过 5 家，已拒绝执行。'
            : '客户比较需要在请求中显式写出 2–5 家完整客户名称，形成受限 customer_allowlist。';
          this.state = { ...this.state, phase: 'clarification', submit_locked: false, resolution_reason: reason, agent_message: reason };
          return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
        }
        intentEnvelope = {
          ...intentEnvelope,
          extracted_fields: {
            ...intentEnvelope.extracted_fields,
            customer_allowlist: selected.map(item => item.id),
            customer_names: selected.map(item => item.name),
          },
        };
        this.state = { ...this.state, current_intent: intentEnvelope.intent, intent_envelope: intentEnvelope };
        const primary = selected[0]!;
        if (this.state.scoped_customer_id !== primary.id) {
          this.state = {
            ...this.state,
            phase: 'resolving_customer',
            scoped_customer_id: primary.id,
            scoped_customer_name: primary.name,
            pending_original_instruction: trimmed,
            agent_message: `已形成 ${selected.length} 家客户的受限比较集合，正在读取证据…`,
            submit_locked: true,
          };
          return {
            state: this.state,
            event: { type: 'bind_required', customer_id: primary.id, customer_name: primary.name, continue_prompt: trimmed },
          };
        }
        return await this.runScoped(intentEnvelope, primary.id);
      }

      if (intentEnvelope.clarification_required && intentEnvelope.intent === 'SAFE_FALLBACK') {
        const reason = '无法高置信度确定请求意图，请明确是总结、风险分析、下一步建议、跟进文案、互动总结、客户比较还是图片分析。';
        this.state = { ...this.state, phase: 'clarification', submit_locked: false, resolution_reason: reason, agent_message: reason };
        return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
      }

      if (intentEnvelope.intent === 'CLEAR_CUSTOMER_SCOPE') {
        this.clearCustomerScope();
        this.state = { ...this.state, submit_locked: false };
        return { state: this.state, event: { type: 'clear_scope' } };
      }

      // Explicit switch / portfolio / any customer lookup always re-enters resolution
      // Write intents with an existing scope must not re-enter customer search.
      if (this.state.scoped_customer_id && intentEnvelope.mode === 'write_action' && isClosedWriteIntentUtterance(trimmed)) {
        return await this.runScoped(intentEnvelope, this.state.scoped_customer_id);
      }

      if (intentEnvelope.mode === 'entity_resolution' || intentEnvelope.mode === 'portfolio_search') {
        return await this.resolveAndMaybeContinue(intentEnvelope, intentEnvelope.mode === 'portfolio_search');
      }

      // Scoped customer: analysis/write requests bypass search
      if (this.state.scoped_customer_id && intentEnvelope.mode === 'customer_analysis') {
        return await this.runScoped(intentEnvelope, this.state.scoped_customer_id);
      }

      if (!this.state.scoped_customer_id && intentEnvelope.mode === 'customer_analysis') {
        this.state = {
          ...this.state,
          phase: 'blocked',
          submit_locked: false,
          resolution_reason: '请先定位客户，或从客户详情进入后再总结/分析。',
          agent_message: '请先定位客户，或从客户详情进入后再总结/分析。',
        };
        return {
          state: this.state,
          event: { type: 'idle' },
          outcome: { kind: 'blocked', reason: this.state.resolution_reason! },
        };
      }

      if (!this.state.scoped_customer_id) {
        return await this.resolveAndMaybeContinue(intentEnvelope, false);
      }

      return await this.runScoped(intentEnvelope, this.state.scoped_customer_id);
    } catch (cause) {
      const reason = formatUserFacingErrorMessage(cause);
      this.state = {
        ...this.state,
        phase: 'error',
        submit_locked: false,
        resolution_reason: reason,
        agent_message: reason,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'error', reason } };
    }
  }

  async selectCandidate(customerId: string): Promise<SalesAgentInteractionTurn> {
    if (this.state.submit_locked) {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '上一条请求仍在处理中，请稍候。' },
      };
    }
    if (this.state.phase !== 'awaiting_candidate_selection' && this.state.phase !== 'portfolio_browse') {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '当前没有待选择的客户候选。' },
      };
    }
    if (!this.candidateIds.has(customerId)) {
      this.state = {
        ...this.state,
        // Keep awaiting selection so a valid candidate can still be chosen
        phase: 'awaiting_candidate_selection',
        resolution_reason: '所选客户不在本次候选列表中，已拒绝跨候选选择。',
        agent_message: '所选客户不在本次候选列表中，已拒绝跨候选选择。',
      };
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: this.state.resolution_reason! },
      };
    }
    const candidate = this.state.candidate_results.find(item => item.id === customerId);
    if (!candidate) {
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: '候选客户无效。' },
      };
    }
    const pending = this.state.pending_original_instruction
      ?? (this.state.phase === 'portfolio_browse' ? '总结客户现状' : null);
    if (!pending) {
      this.state = {
        ...this.state,
        phase: 'blocked',
        resolution_reason: '原始指令已丢失，请重新输入。',
        agent_message: '原始指令已丢失，请重新输入。',
      };
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: { kind: 'blocked', reason: this.state.resolution_reason! },
      };
    }
    const continuePrompt = resumeInstructionAfterScope(pending);
    this.state = {
      ...this.state,
      phase: 'resolving_customer',
      scoped_customer_id: candidate.id,
      scoped_customer_name: candidate.name,
      candidate_results: [],
      candidate_empty_exact: false,
      agent_message: `已定位客户：${candidate.name}，正在读取最近互动与有效记忆……`,
      submit_locked: true,
    };
    this.candidateIds.clear();
    return {
      state: this.state,
      event: {
        type: 'bind_required',
        customer_id: candidate.id,
        customer_name: candidate.name,
        continue_prompt: continuePrompt,
      },
    };
  }

  /**
   * Called by UI after bind + snapshot/context/memory are ready.
   * Resumes the pending original instruction through SalesAgentSession.
   */
  async continueAfterBind(continuePrompt: string, customerId: string): Promise<SalesAgentInteractionTurn> {
    this.state = {
      ...this.state,
      scoped_customer_id: customerId,
      phase: 'reasoning',
      submit_locked: true,
      agent_message: '已定位客户，正在读取最近互动与有效记忆……',
    };
    try {
      const originalEnvelope = this.state.intent_envelope;
      if (!originalEnvelope) throw new Error('原始 Intent Envelope 已丢失，无法安全继续。');
      // Candidate binding may reduce “打开 X，然后总结” to the bounded
      // post-bind instruction. Re-parse that user-visible continuation instead
      // of submitting the original SEARCH_CUSTOMERS envelope to Session.
      const envelope = continuePrompt.trim() && continuePrompt.trim() !== originalEnvelope.original_instruction.trim()
        ? this.parseIntentEnvelope(continuePrompt)
        : originalEnvelope;
      this.state = { ...this.state, current_intent: envelope.intent, intent_envelope: envelope };
      const turn = await this.runScoped(envelope, customerId, { clearPendingOnSettle: true });
      return turn;
    } catch (cause) {
      const reason = formatUserFacingErrorMessage(cause);
      this.state = {
        ...this.state,
        phase: 'error',
        submit_locked: false,
        pending_original_instruction: null,
        resolution_reason: reason,
        agent_message: reason,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'error', reason } };
    }
  }

  private async resolveAndMaybeContinue(intentEnvelope: AgentIntentEnvelope, portfolio: boolean): Promise<SalesAgentInteractionTurn> {
    const message = intentEnvelope.original_instruction;
    this.state = { ...this.state, phase: 'resolving_customer', current_intent: 'SEARCH_CUSTOMERS' };
    const norm = {
      filters: intentEnvelope.portfolio_filters,
      unsupported: intentEnvelope.unsupported_criteria,
      notes: [] as string[],
    };
    const list_kind = portfolio ? 'portfolio' as const : 'resolution' as const;

    // Unique exact name hit short-circuit via repository name filter
    const search = await executeSearchCustomersTool({
      filters: norm.filters,
      unsupported_filters: norm.unsupported,
      notes: norm.notes,
      list_kind,
      offset: 0,
      db: this.deps.db,
    });

    this.state = { ...this.state, latest_search: search };

    if (norm.unsupported.length > 0 && search.candidates.length === 0) {
      const reason = `无法按请求过滤：不支持的条件 ${norm.unsupported.join('、')}。`;
      this.state = {
        ...this.state,
        phase: 'blocked',
        submit_locked: false,
        resolution_reason: reason,
        agent_message: reason,
        pending_original_instruction: null,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
    }

    // Prefer unique full-name inclusion when multiple structural filters still match one name mention
    if (list_kind === 'resolution' && search.candidates.length > 1) {
      const nameHits = corpusNameHitsFromCandidates(message, search.candidates);
      if (nameHits.length === 1) {
        const hit = nameHits[0]!;
        const continuePrompt = resumeInstructionAfterScope(message);
        this.state = {
          ...this.state,
          phase: 'resolving_customer',
          scoped_customer_id: hit.id,
          scoped_customer_name: hit.name,
          pending_original_instruction: message,
          agent_message: `已定位客户：${hit.name}，正在继续处理…`,
          submit_locked: true,
        };
        return {
          state: this.state,
          event: {
            type: 'bind_required',
            customer_id: hit.id,
            customer_name: hit.name,
            continue_prompt: continuePrompt,
          },
        };
      }
    }

    if (search.candidates.length === 1 && list_kind === 'resolution') {
      const only = search.candidates[0]!;
      const continuePrompt = resumeInstructionAfterScope(message);
      this.state = {
        ...this.state,
        phase: 'resolving_customer',
        scoped_customer_id: only.id,
        scoped_customer_name: only.name,
        pending_original_instruction: message,
        agent_message: `已定位客户：${only.name}，正在继续处理…`,
        submit_locked: true,
      };
      return {
        state: this.state,
        event: {
          type: 'bind_required',
          customer_id: only.id,
          customer_name: only.name,
          continue_prompt: continuePrompt,
        },
      };
    }

    if (search.candidates.length === 0) {
      // Near-miss: loosen name only when a name was present (resolution path)
      let near = search;
      if (list_kind === 'resolution' && norm.filters.name_query) {
        const q = norm.filters.name_query.slice(0, Math.max(2, Math.min(norm.filters.name_query.length, 6)));
        near = await executeSearchCustomersTool({
          filters: { name_query: q, now: norm.filters.now },
          notes: ['没有精确匹配；以下为名称近似候选。'],
          list_kind: 'resolution',
          db: this.deps.db,
        });
      }
      this.candidateIds.clear();
      for (const item of near.candidates) this.candidateIds.add(item.id);
      const emptyMsg = near.candidates.length
        ? '没有找到准确客户，以下是近似候选（最多 5 个）。请点击选择，或补充名称/地区/行业。'
        : '没有找到匹配客户。请补充更完整的名称、地区、等级或行业。';
      this.state = {
        ...this.state,
        phase: near.candidates.length ? 'awaiting_candidate_selection' : 'blocked',
        candidate_results: near.candidates,
        candidate_empty_exact: true,
        pending_original_instruction: near.candidates.length ? message : null,
        submit_locked: false,
        agent_message: emptyMsg,
        resolution_reason: near.candidates.length ? null : emptyMsg,
        latest_search: near,
        portfolio_total_matches: 0,
        portfolio_page_offset: 0,
        portfolio_has_more: false,
        portfolio_filters_message: null,
      };
      return {
        state: this.state,
        event: { type: 'idle' },
        outcome: near.candidates.length ? undefined : { kind: 'blocked', reason: emptyMsg },
      };
    }

    // Portfolio list — never force single-customer disambiguation
    if (list_kind === 'portfolio') {
      this.candidateIds.clear();
      for (const item of search.candidates) this.candidateIds.add(item.id);
      const start = search.candidates.length ? search.page_offset + 1 : 0;
      const end = search.page_offset + search.candidates.length;
      const agent_message = `共找到 ${search.total_matches} 家客户，当前展示 ${start}–${end}${search.has_more ? '。可继续加载或点击具体客户后绑定。' : '。点击具体客户后绑定。'}`;
      this.state = {
        ...this.state,
        phase: 'portfolio_browse',
        candidate_results: search.candidates,
        candidate_empty_exact: false,
        pending_original_instruction: null,
        scoped_customer_id: this.state.scoped_customer_id,
        submit_locked: false,
        agent_message,
        portfolio_total_matches: search.total_matches,
        portfolio_page_offset: search.page_offset,
        portfolio_has_more: search.has_more,
        portfolio_filters_message: message,
      };
      return { state: this.state, event: { type: 'portfolio_list' } };
    }

    // Multiple matches — single-customer resolution disambiguation (≤5)
    this.candidateIds.clear();
    for (const item of search.candidates) this.candidateIds.add(item.id);
    const agent_message = `找到 ${search.candidates.length} 个符合条件的客户，请选择一个继续。`;
    this.state = {
      ...this.state,
      phase: 'awaiting_candidate_selection',
      candidate_results: search.candidates,
      candidate_empty_exact: false,
      pending_original_instruction: message,
      submit_locked: false,
      agent_message,
      portfolio_total_matches: search.total_matches,
      portfolio_page_offset: 0,
      portfolio_has_more: false,
      portfolio_filters_message: null,
    };
    return { state: this.state, event: { type: 'idle' } };
  }

  private async runScoped(
    intentEnvelope: AgentIntentEnvelope,
    customerId: string,
    options?: { readonly clearPendingOnSettle?: boolean },
  ): Promise<SalesAgentInteractionTurn> {
    const message = intentEnvelope.original_instruction;
    const session = this.createSession(customerId);
    if (!session) {
      this.state = {
        ...this.state,
        phase: 'blocked',
        submit_locked: false,
        resolution_reason: '客户上下文尚未就绪。',
        agent_message: '客户上下文尚未就绪，请稍候再试。',
      };
      return {
        state: this.state,
        event: { type: 'bind_required', customer_id: customerId, customer_name: this.state.scoped_customer_name ?? '', continue_prompt: message },
        outcome: { kind: 'blocked', reason: this.state.resolution_reason! },
      };
    }

    this.state = { ...this.state, phase: 'reasoning', submit_locked: true, current_intent: 'CUSTOMER_ANALYSIS' };
    const outcome = await session.submit(intentEnvelope);

    if (outcome.kind === 'reasoning_result') {
      this.state = {
        ...this.state,
        phase: 'scoped',
        scoped_customer_id: customerId,
        latest_result: outcome.result,
        latest_proposal: null,
        latest_clarification: null,
        submit_locked: false,
        pending_original_instruction: options?.clearPendingOnSettle ? null : this.state.pending_original_instruction,
        agent_message: outcome.result.response,
        current_intent: outcome.result.plan.intent,
      };
      return { state: this.state, event: { type: 'idle' }, outcome };
    }

    if (outcome.kind === 'clarification_required') {
      this.state = {
        ...this.state,
        phase: 'clarification',
        scoped_customer_id: customerId,
        latest_clarification: outcome.clarification,
        latest_proposal: null,
        latest_result: null,
        submit_locked: false,
        pending_original_instruction: outcome.clarification.original_instruction,
        agent_message: outcome.clarification.question,
        current_intent: outcome.clarification.intent,
      };
      return { state: this.state, event: { type: 'idle' }, outcome };
    }

    if (outcome.kind === 'write_proposal') {
      this.state = {
        ...this.state,
        phase: 'proposal',
        scoped_customer_id: customerId,
        latest_proposal: outcome.proposal,
        latest_result: null,
        latest_clarification: null,
        submit_locked: false,
        pending_original_instruction: options?.clearPendingOnSettle ? null : this.state.pending_original_instruction,
        agent_message: '已生成需人工确认的写入建议。',
        // Keep the closed business intent stable through the proposal phase.
        // The tool id remains available on latest_proposal for rendering and
        // execution, but it must not replace the routed intent in state.
        current_intent: intentEnvelope.intent,
      };
      return { state: this.state, event: { type: 'idle' }, outcome };
    }

    const reason = formatUserFacingErrorMessage(outcome.reason);
    this.state = {
      ...this.state,
      phase: outcome.kind === 'error' ? 'error' : 'blocked',
      submit_locked: false,
      pending_original_instruction: options?.clearPendingOnSettle ? null : this.state.pending_original_instruction,
      resolution_reason: reason,
      agent_message: reason,
      latest_clarification: null,
    };
    return { state: this.state, event: { type: 'idle' }, outcome: { ...outcome, reason } };
  }
}
