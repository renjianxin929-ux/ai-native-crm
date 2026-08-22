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
import { matchCustomerNameScore, type CustomerSearchCandidate, type SearchCustomersResult } from './searchCustomers';
import { isClosedWriteIntentUtterance, draftWriteFields } from './writeIntent';
import { invalidateCustomerWriteState, getCanonicalProposal } from './sessionWriteStateStore';
import { applySemanticIntentResolution, createAgentIntentEnvelope, isReadOnlyReasoningIntent, mergeAgentIntentClarificationAnswer, type AgentIntentEnvelope, type SemanticIntentResolution } from './agentIntentEnvelope';
import { selectCapabilityDeterministic } from '../planner/deterministicCapabilitySelector';
import type { SemanticIntentRoutingContext } from '../productionAi/semanticIntentRouter';
import { SALES_AGENT_APP_CLOCK, withTimeInZone } from './appClock';
import { executeCustomerPriorityRanking, type CustomerPriorityRankingResult } from './customerPriorityRanking';
import { planCapability, validateModelPlannerOutput, type ModelPlannerCaller } from '../planner/runtimePlanner';
import { routeCapabilitySelection, type PlannerSelectionResult } from '../planner/capabilitySelectionRouter';
import {
  findPlannerTool,
  isNewEntityCreateCapability,
  omitNewEntityInheritedIdentity,
  PRODUCTION_PLANNER_TOOL_SURFACE,
  selectedCustomerIdForCapability,
} from '../planner/plannerToolSurface';
import { sanitizeCustomerCreateArguments } from '../planner/customerCreateArgumentIntegrity';
import { materializeRuntimeInput } from '../planner/runtimeContextMaterializer';
import { adaptReadSuccess } from '../planner/readResultAdapter';
import { interpretCustomerQuery } from '../planner/customerQueryInterpretation';
import { formatQueryFailure } from '../salesAgentUi/queryFailure';
import { projectClarificationQuestion } from '../salesAgentUi/userFacingFieldFormatter';
import { t } from '../i18n/appLocale';
import {
  createPendingCapabilityTurn,
  mergePendingBusinessArguments,
  mergePendingCapabilityAnswer,
  omitRuntimeMetadata,
  type PendingCapabilityTurn,
} from '../planner/pendingCapabilityTurn';
import {
  classifyReasoningActionContinuation,
  isGenuinePreviousResultReference,
  parseScheduleFromReasoningAction,
  projectReasoningActionContext,
  selectReasoningHandoff,
  staleReasoningActionMessage,
  MISSING_REASONING_ACTION_MESSAGE,
  type LastReasoningActionContext,
} from '../planner/reasoningActionHandoff';
import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext } from '../customerMemory';

export interface PendingInstructionSessionState {
  readonly original_instruction: string | null;
  readonly active_instruction: string | null;
  readonly intent: string | null;
  readonly pending_instruction: string | null;
  readonly pending_intent: string | null;
  readonly missing_fields: readonly string[];
  readonly customer_scope: string | null;
  readonly candidate_customer_ids: readonly string[];
  readonly selected_customer_id: string | null;
  readonly resume_after_scope: boolean;
  readonly clarification_state: 'NONE' | 'REQUIRED' | 'RESOLVED';
  readonly proposal_state: 'NONE' | 'PENDING' | 'CANCELLED' | 'CONFIRMED' | 'INVALIDATED';
  readonly turn_id: string | null;
}

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
  readonly latest_priority_ranking: CustomerPriorityRankingResult | null;
  readonly pending_session: PendingInstructionSessionState;
  readonly submit_locked: boolean;
  readonly user_message: string | null;
  readonly agent_message: string | null;
  readonly latest_direct_answer: { readonly shape: string; readonly headline: string; readonly message: string; readonly presentation: 'direct' | 'analysis' } | null;
  /** Short-lived reasoning→action handoff. Runtime/session only; never CRM truth. */
  readonly last_reasoning_action_context: LastReasoningActionContext | null;
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
  latest_priority_ranking: null,
  pending_session: { original_instruction: null, active_instruction: null, intent: null, pending_instruction: null, pending_intent: null, missing_fields: [], customer_scope: null, candidate_customer_ids: [], selected_customer_id: null, resume_after_scope: false, clarification_state: 'NONE', proposal_state: 'NONE', turn_id: null },
  submit_locked: false,
  user_message: null,
  agent_message: null,
  latest_direct_answer: null,
  last_reasoning_action_context: null,
  retain_customer_scope_on_new_conversation: true,
};

export interface SalesAgentInteractionControllerDeps {
  readonly db: DatabaseLike;
  readonly createSession: (customerId: string) => SalesAgentSession | null;
  readonly customer_catalog?: readonly { readonly id: string; readonly name: string }[];
  readonly clock?: () => string;
  readonly semantic_intent_router?: (
    instruction: string,
    envelopeId: string,
    signal?: AbortSignal,
    routingContext?: SemanticIntentRoutingContext,
  ) => Promise<SemanticIntentResolution>;
  readonly model_planner?: ModelPlannerCaller;
  /**
   * Optional injected planner. Production UI must not rely on this; it wires model_planner
   * through Trusted Host. Tests may inject a planner to isolate modules.
   */
  readonly capability_planner?: (utterance: string, scopeCustomerId: string | null) => Promise<PlannerSelectionResult>;
}

function corpusNameHitsFromCandidates(
  message: string,
  candidates: readonly { id: string; name: string }[],
): typeof candidates {
  const hits = candidates.filter(item => message.includes(item.name) && item.name.trim().length >= 2);
  return hits;
}

const WRITE_TOOL_TO_CAPABILITY: Readonly<Record<string, string>> = {
  create_follow_up_record: 'follow_up.create',
  create_task: 'task.create',
  update_next_follow_up_time: 'customer.next_follow_up_time.update',
};

const WRITE_HELPER_KEYS = new Set(['next_follow_up_date', 'due_date']);

function collectReparsedBusinessFields(
  pending: PendingCapabilityTurn,
  combinedInstruction: string,
  nowIso: string,
): Record<string, unknown> {
  const draft = draftWriteFields(combinedInstruction, nowIso);
  if (!draft) return {};
  if (WRITE_TOOL_TO_CAPABILITY[draft.tool_id] !== pending.capability_id) return {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft.parsed_fields)) {
    if (WRITE_HELPER_KEYS.has(key) || key === 'clarification_answer') continue;
    fields[key] = value;
  }
  if (typeof draft.parsed_fields.next_follow_up_date === 'string' && typeof fields.next_follow_up_at !== 'string') {
    fields.next_follow_up_at = withTimeInZone(String(draft.parsed_fields.next_follow_up_date), 10, 0, nowIso);
  }
  if (typeof draft.parsed_fields.due_date === 'string' && typeof fields.due_at !== 'string') {
    fields.due_at = withTimeInZone(String(draft.parsed_fields.due_date), 10, 0, nowIso);
  }
  return omitRuntimeMetadata(fields);
}

export class SalesAgentInteractionController {
  private state: SalesAgentInteractionState = { ...INITIAL };
  private readonly candidateIds = new Set<string>();
  private readonly deps: SalesAgentInteractionControllerDeps;
  /** Mutable so React can point at the latest SalesAgentSession after bind. */
  createSession: (customerId: string) => SalesAgentSession | null;
  semanticIntentRouter: ((
    instruction: string,
    envelopeId: string,
    signal?: AbortSignal,
    routingContext?: SemanticIntentRoutingContext,
  ) => Promise<SemanticIntentResolution>) | null;
  modelPlanner: ModelPlannerCaller | null;
  capabilityPlanner: (utterance: string, scopeCustomerId: string | null) => Promise<PlannerSelectionResult>;
  private pendingCapabilityTurn: PendingCapabilityTurn | null = null;
  private boundContinuation: { readonly prompt: string; readonly expectedCustomerId: string } | null = null;
  private runtimeSnapshot: LoadedReadOnlyAgentSnapshot | null = null;
  private runtimeContext: ContextSnapshot | null = null;
  private runtimeMemory: CustomerMemoryContext | undefined;

  private parseIntentEnvelope(message: string): AgentIntentEnvelope {
    return createAgentIntentEnvelope(message, this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now());
  }
  customerCatalog: readonly { readonly id: string; readonly name: string }[];

  constructor(deps: SalesAgentInteractionControllerDeps) {
    this.deps = deps;
    this.createSession = deps.createSession;
    this.semanticIntentRouter = deps.semantic_intent_router ?? null;
    this.modelPlanner = deps.model_planner ?? null;
    this.customerCatalog = deps.customer_catalog ?? [];
    this.capabilityPlanner = deps.capability_planner
      ?? ((utterance, scopeCustomerId) => planCapability(
        utterance,
        this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
        scopeCustomerId,
        { db: this.deps.db, modelSelect: this.modelPlanner ?? undefined },
      ));
  }

  setRuntimeContext(input: {
    readonly snapshot?: LoadedReadOnlyAgentSnapshot | null;
    readonly context?: ContextSnapshot | null;
    readonly memory?: CustomerMemoryContext;
  }): void {
    if (input.snapshot !== undefined) this.runtimeSnapshot = input.snapshot;
    if (input.context !== undefined) this.runtimeContext = input.context;
    if (input.memory !== undefined) this.runtimeMemory = input.memory;
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
    this.pendingCapabilityTurn = null;
    this.boundContinuation = null;
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

  /**
   * User navigation into a customer (list / detail / picker).
   * Fresh scoped conversation: retain requested customer scope, drop transient chat.
   * Do NOT use this for internal bind_required continuation.
   */
  enterCustomerConversation(customerId: string, customerName?: string | null): SalesAgentInteractionState {
    this.startNewConversation({ clear_customer_scope: true });
    this.state = {
      ...this.state,
      phase: 'scoped',
      scoped_customer_id: customerId,
      scoped_customer_name: customerName ?? null,
    };
    return this.state;
  }

  clearCustomerScope(): SalesAgentInteractionState {
    if (this.state.scoped_customer_id) {
      invalidateCustomerWriteState(this.state.scoped_customer_id);
    }
    this.candidateIds.clear();
    this.boundContinuation = null;
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
    const hasPendingCapability = this.state.phase === 'clarification' && Boolean(this.pendingCapabilityTurn);

    this.state = {
      ...this.state,
      submit_locked: true,
      user_message: trimmed,
      latest_result: null,
      latest_proposal: null,
      latest_direct_answer: this.state.phase === 'clarification' ? this.state.latest_direct_answer : null,
      latest_clarification: this.state.phase === 'clarification' ? this.state.latest_clarification : null,
      resolution_reason: null,
    };

    try {
      if (hasPendingCapability) {
        return await this.resumePendingCapabilityTurn(trimmed);
      }
      if (continuationEnvelope && continuationCustomerId && hasWriteClarification) {
        return await this.runScoped(
          mergeAgentIntentClarificationAnswer(continuationEnvelope, trimmed),
          continuationCustomerId,
        );
      }
      const safetyTurn = await this.tryDeterministicSafetyRoute(trimmed);
      if (safetyTurn) return safetyTurn;
      const currentTurnExplicitWrite = isClosedWriteIntentUtterance(trimmed)
        && !isGenuinePreviousResultReference(trimmed);
      if (!currentTurnExplicitWrite) {
        const reasoningHandoff = await this.tryReasoningActionHandoff(trimmed);
        if (reasoningHandoff) return reasoningHandoff;
      }
      let intentEnvelope = this.parseIntentEnvelope(trimmed);

      if (intentEnvelope.mode !== 'write_action' && intentEnvelope.mode !== 'control' && intentEnvelope.mode !== 'capture') {
        const semanticRouted = await this.resolveSemanticIntent(intentEnvelope, trimmed, signal);
        if (semanticRouted.kind === 'turn') return semanticRouted.turn;
        intentEnvelope = semanticRouted.envelope;
      }

      if (this.isFactualVisitRead(intentEnvelope)) {
        return this.invokePlannedCapability('timeline.visit.read', {}, trimmed, this.state.scoped_customer_id);
      }
      if (this.isBattleCardAnalysis(intentEnvelope)) {
        return this.invokePlannedCapability('battle_card.current.read', {}, trimmed, this.state.scoped_customer_id);
      }

      // Analysis / review is not a 25-tool capability pick. Semantic routing
      // already selected the path; the model planner must not intercept it.
      // Future-only next-follow-up writes stay on the existing session path.
      const sessionOwnedNextFollowUp = currentTurnExplicitWrite
        && intentEnvelope.intent === 'UPDATE_CUSTOMER_REQUEST';
      if (
        !sessionOwnedNextFollowUp
        && !isReadOnlyReasoningIntent(intentEnvelope)
        && intentEnvelope.intent !== 'CUSTOMER_TIMELINE_REVIEW'
        && intentEnvelope.intent !== 'SEARCH_CUSTOMERS'
      ) {
        const plannedTurn = await this.tryCapabilityPlanner(trimmed);
        if (plannedTurn) return plannedTurn;
      }
      this.state = { ...this.state, current_intent: intentEnvelope.intent, intent_envelope: intentEnvelope };
      this.state = { ...this.state, pending_session: {
        original_instruction: intentEnvelope.original_instruction, active_instruction: intentEnvelope.original_instruction, intent: intentEnvelope.intent,
        pending_instruction: !this.state.scoped_customer_id && intentEnvelope.mode === 'write_action' ? intentEnvelope.original_instruction : null,
        pending_intent: !this.state.scoped_customer_id && intentEnvelope.mode === 'write_action' ? intentEnvelope.intent : null,
        missing_fields: [...new Set([...( !this.state.scoped_customer_id && intentEnvelope.mode === 'write_action' ? ['customer'] : []), ...intentEnvelope.missing_fields])], customer_scope: this.state.scoped_customer_id, candidate_customer_ids: [], selected_customer_id: this.state.scoped_customer_id,
        resume_after_scope: !this.state.scoped_customer_id && intentEnvelope.mode === 'write_action', clarification_state: intentEnvelope.clarification_required ? 'REQUIRED' : 'NONE',
        proposal_state: 'NONE', turn_id: intentEnvelope.envelope_id,
      } };

      if (intentEnvelope.intent === 'CUSTOMER_PRIORITY_RANKING') return await this.runPriorityRanking(intentEnvelope);

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
          this.rememberBindContinuation(primary.id, trimmed);
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

      // Golden Journey fix (BUG A): an analysis utterance that itself carries a
      // named customer entity ("总结一下广州ABC科技有限公司") must resolve the
      // entity BEFORE the scope gate. Unique/exact match auto-establishes scope;
      // 0 or ambiguous candidates fall through to the normal clarification path.
      if (!this.state.scoped_customer_id && intentEnvelope.mode === 'customer_analysis' && intentEnvelope.portfolio_filters.name_query) {
        return await this.resolveAndMaybeContinue(intentEnvelope, false);
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
      pending_session: { ...this.state.pending_session, missing_fields: this.state.pending_session.missing_fields.filter(field => field !== 'customer'), candidate_customer_ids: [], selected_customer_id: candidate.id, customer_scope: candidate.id, resume_after_scope: true },
    };
    this.candidateIds.clear();
    this.rememberBindContinuation(candidate.id, continuePrompt);
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
   * Abandon this candidate-selection turn only.
   * Clears candidate-only transient state. Does not write CRM,
   * does not change scoped customer, and does not reset unrelated conversation artifacts.
   */
  cancelCandidateSelection(): SalesAgentInteractionState {
    if (this.state.phase !== 'awaiting_candidate_selection') {
      return this.state;
    }
    this.candidateIds.clear();
    this.boundContinuation = null;
    this.pendingCapabilityTurn = null;
    this.state = {
      ...this.state,
      phase: this.state.scoped_customer_id ? 'scoped' : 'unscoped',
      pending_original_instruction: null,
      candidate_results: [],
      candidate_empty_exact: false,
      latest_search: null,
      latest_direct_answer: null,
      current_intent: null,
      intent_envelope: null,
      resolution_reason: null,
      submit_locked: false,
      user_message: null,
      agent_message: null,
      pending_session: {
        ...INITIAL.pending_session,
        customer_scope: this.state.scoped_customer_id,
        selected_customer_id: this.state.scoped_customer_id,
      },
    };
    return this.state;
  }

  /**
   * Called by UI after bind + snapshot/context/memory are ready.
   * Resumes the pending original instruction through SalesAgentSession.
   * Cross-customer stale resumes are discarded and never rebound.
   */
  private rememberBindContinuation(customerId: string, prompt: string): void {
    this.boundContinuation = { expectedCustomerId: customerId, prompt };
  }

  async continueAfterBind(continuePrompt: string, customerId: string): Promise<SalesAgentInteractionTurn> {
    const bound = this.boundContinuation;
    if (!bound || bound.expectedCustomerId !== customerId) {
      this.boundContinuation = null;
      const reason = t('conversation.pendingDiscarded');
      this.state = {
        ...this.state,
        submit_locked: false,
        phase: this.state.scoped_customer_id ? 'scoped' : 'unscoped',
        pending_original_instruction: null,
        resolution_reason: reason,
        agent_message: reason,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
    }
    this.boundContinuation = null;
    this.state = {
      ...this.state,
      scoped_customer_id: customerId,
      phase: 'reasoning',
      submit_locked: true,
      agent_message: '已定位客户，正在读取最近互动与有效记忆……',
    };
    try {
      const pending = this.pendingCapabilityTurn;
      const pendingCapabilityId = pending?.capability_id;
      if (pending && pendingCapabilityId && pendingCapabilityId !== 'customer.search') {
        this.pendingCapabilityTurn = { ...pending, customer_scope: customerId };
        return await this.invokePlannedCapability(
          pendingCapabilityId,
          pending.parsed_arguments,
          pending.original_instruction,
          customerId,
        );
      }
      this.pendingCapabilityTurn = null;
      const originalEnvelope = this.state.intent_envelope;
      const envelope = originalEnvelope && originalEnvelope.mode === 'write_action'
        ? originalEnvelope
        : this.parseIntentEnvelope(continuePrompt.trim() || '总结客户现状');
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

    const bindResolvedCustomer = (hit: { readonly id: string; readonly name: string }): SalesAgentInteractionTurn => {
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
      this.rememberBindContinuation(hit.id, continuePrompt);
      return {
        state: this.state,
        event: {
          type: 'bind_required',
          customer_id: hit.id,
          customer_name: hit.name,
          continue_prompt: continuePrompt,
        },
      };
    };

    // Unique Exact Match outranks fuzzy candidate selection.
    if (list_kind === 'resolution' && norm.filters.name_query) {
      const exactHits = search.candidates.filter(item => matchCustomerNameScore(item, norm.filters.name_query!) >= 100);
      if (exactHits.length === 1) return bindResolvedCustomer(exactHits[0]!);
    }

    // Prefer unique full-name inclusion when multiple structural filters still match one name mention
    if (list_kind === 'resolution' && search.candidates.length > 1) {
      const nameHits = corpusNameHitsFromCandidates(message, search.candidates);
      if (nameHits.length === 1) return bindResolvedCustomer(nameHits[0]!);
    }

    if (search.candidates.length === 1 && list_kind === 'resolution') {
      return bindResolvedCustomer(search.candidates[0]!);
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
        : this.emptyCustomerSearchMessage(message, norm.filters);
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
        pending_session: { ...this.state.pending_session, pending_instruction: near.candidates.length ? message : null, pending_intent: near.candidates.length ? intentEnvelope.intent : null, candidate_customer_ids: near.candidates.map(item => item.id), resume_after_scope: near.candidates.length > 0 },
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
        pending_session: { ...this.state.pending_session, candidate_customer_ids: search.candidates.map(item => item.id), resume_after_scope: false },
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
      pending_session: { ...this.state.pending_session, pending_instruction: message, pending_intent: intentEnvelope.intent, candidate_customer_ids: search.candidates.map(item => item.id), resume_after_scope: true },
    };
    return { state: this.state, event: { type: 'idle' } };
  }

  /**
   * High-confidence mutation / last-contact safety. Runs before semantic
   * classification so delete/create/amount never become analysis.
   */
  private async tryDeterministicSafetyRoute(trimmed: string): Promise<SalesAgentInteractionTurn | null> {
    const planning = selectCapabilityDeterministic({
      utterance: trimmed,
      now_iso: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
      scoped_customer_id: this.state.scoped_customer_id,
      db: this.deps.db,
    });
    if (planning.kind === 'unknown') return null;
    return this.applyPlannerResult(planning, trimmed);
  }

  private async resolveSemanticIntent(
    intentEnvelope: AgentIntentEnvelope,
    trimmed: string,
    signal?: AbortSignal,
  ): Promise<{ readonly kind: 'turn'; readonly turn: SalesAgentInteractionTurn } | { readonly kind: 'envelope'; readonly envelope: AgentIntentEnvelope }> {
    if (!this.semanticIntentRouter) {
      return { kind: 'envelope', envelope: intentEnvelope };
    }
    const routingContext: SemanticIntentRoutingContext = {
      has_selected_customer: Boolean(this.state.scoped_customer_id),
      has_previous_reasoning: Boolean(this.state.last_reasoning_action_context),
      has_previous_review: this.state.last_reasoning_action_context?.reasoning_intent === 'INTERACTION_SUMMARY',
    };
    try {
      const semantic = await this.semanticIntentRouter(trimmed, intentEnvelope.envelope_id, signal, routingContext);
      if (semantic.intent === 'ACTION_FROM_PREVIOUS_RESULT') {
        if (!isGenuinePreviousResultReference(trimmed)) {
          const currentTurnAdvice: SemanticIntentResolution = {
            ...semantic,
            intent: 'NEXT_ACTION_RECOMMENDATION',
          };
          return { kind: 'envelope', envelope: applySemanticIntentResolution(intentEnvelope, currentTurnAdvice) };
        }
        const handoff = await this.tryReasoningActionHandoff(trimmed);
        if (handoff) return { kind: 'turn', turn: handoff };
        const reason = MISSING_REASONING_ACTION_MESSAGE;
        return { kind: 'turn', turn: this.emitReasoningHandoffClarification(reason) };
      }
      if (semantic.intent === 'BATTLE_CARD_ANALYSIS' || semantic.filters.focus === 'battle_card') {
        return {
          kind: 'turn',
          turn: await this.invokePlannedCapability('battle_card.current.read', {}, trimmed, this.state.scoped_customer_id),
        };
      }
      if (semantic.intent === 'CUSTOMER_TIMELINE_REVIEW' || semantic.filters.fact === 'visits') {
        const capabilityId = semantic.filters.fact === 'visits' ? 'timeline.visit.read' : 'timeline.customer.read';
        return {
          kind: 'turn',
          turn: await this.invokePlannedCapability(capabilityId, {}, trimmed, this.state.scoped_customer_id),
        };
      }
      let resolved = semantic;
      const protectedReasoning = (
        intentEnvelope.intent === 'INTERACTION_SUMMARY'
        || intentEnvelope.intent === 'NEXT_ACTION_PREPARATION'
        || intentEnvelope.intent === 'CUSTOMER_RISK_ANALYSIS'
        || intentEnvelope.intent === 'FOLLOW_UP_DRAFT'
      ) && intentEnvelope.confidence >= 0.9;
      if (protectedReasoning && (
        semantic.intent === 'CLARIFICATION_REQUIRED'
        || semantic.intent === 'UNSUPPORTED'
        || semantic.intent === 'CUSTOMER_SUMMARY'
      )) {
        return { kind: 'envelope', envelope: intentEnvelope };
      }
      if (
        this.state.scoped_customer_id
        && semantic.intent === 'CLARIFICATION_REQUIRED'
        && !/删|改|新建|创建|记录/.test(trimmed)
      ) {
        resolved = { ...semantic, intent: 'CUSTOMER_SUMMARY', missing_fields: [], clarification_question: null, confidence: Math.max(semantic.confidence, 0.7) };
      }
      return { kind: 'envelope', envelope: applySemanticIntentResolution(intentEnvelope, resolved) };
    } catch {
      if (this.state.scoped_customer_id) {
        if (intentEnvelope.intent === 'SAFE_FALLBACK') {
          return {
            kind: 'envelope',
            envelope: applySemanticIntentResolution(intentEnvelope, {
              intent: 'CUSTOMER_SUMMARY',
              filters: {},
              entities: [],
              scope: this.state.scoped_customer_id,
              missing_fields: [],
              confidence: 0.7,
              clarification_question: null,
            }),
          };
        }
        return { kind: 'envelope', envelope: intentEnvelope };
      }
      const reason = '当前未配置可用的语义识别服务。请明确是总结、风险分析、下一步建议、跟进文案、互动总结、客户比较还是图片分析。';
      this.state = {
        ...this.state,
        phase: 'clarification',
        submit_locked: false,
        current_intent: intentEnvelope.intent,
        intent_envelope: intentEnvelope,
        resolution_reason: reason,
        agent_message: reason,
      };
      return { kind: 'turn', turn: { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } } };
    }
  }

  private isFactualVisitRead(envelope: AgentIntentEnvelope): boolean {
    const filters = envelope.extracted_fields.filters;
    const fact = filters && typeof filters === 'object' && !Array.isArray(filters)
      ? (filters as Record<string, unknown>).fact
      : undefined;
    return fact === 'visits';
  }

  private isBattleCardAnalysis(envelope: AgentIntentEnvelope): boolean {
    const filters = envelope.extracted_fields.filters;
    const focus = filters && typeof filters === 'object' && !Array.isArray(filters)
      ? (filters as Record<string, unknown>).focus
      : undefined;
    return envelope.extracted_fields.semantic_intent === 'BATTLE_CARD_ANALYSIS' || focus === 'battle_card';
  }

  /**
   * Continuation from the previous reasoning result into a normal capability request.
   * Does not write. Does not invent a second execution path.
   */
  private async tryReasoningActionHandoff(trimmed: string): Promise<SalesAgentInteractionTurn | null> {
    if (!isGenuinePreviousResultReference(trimmed)) {
      return null;
    }
    const request = classifyReasoningActionContinuation(trimmed);
    if (!request) return null;
    const context = this.state.last_reasoning_action_context;
    if (!context) {
      return this.emitReasoningHandoffClarification(MISSING_REASONING_ACTION_MESSAGE);
    }
    const scopedCustomerId = this.state.scoped_customer_id;
    if (!scopedCustomerId || context.customer_id !== scopedCustomerId) {
      return this.emitReasoningHandoffClarification(staleReasoningActionMessage(context));
    }
    const selected = selectReasoningHandoff(context, request);
    if (selected.kind === 'ambiguous') {
      return this.emitReasoningHandoffClarification('你想先创建待办，还是安排下次跟进？');
    }
    if (selected.kind === 'ordinal_out_of_range') {
      return this.emitReasoningHandoffClarification(`刚才只有 ${selected.count} 条建议，请指定其中一条。`);
    }
    if (selected.kind === 'missing') {
      return this.emitReasoningHandoffClarification('当前没有可执行的上一步建议，请先分析下一步或复盘。');
    }
    if (selected.kind === 'task') {
      return this.invokePlannedCapability('task.create', { title: selected.text }, trimmed, scopedCustomerId);
    }
    return this.proposeNextFollowUpFromReasoning(selected.text, trimmed, scopedCustomerId);
  }

  private async proposeNextFollowUpFromReasoning(
    actionText: string,
    utterance: string,
    scopedCustomerId: string,
  ): Promise<SalesAgentInteractionTurn> {
    const nowIso = this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now();
    const schedule = parseScheduleFromReasoningAction(actionText, nowIso);
    if (schedule?.has_explicit_time) {
      return this.invokePlannedCapability(
        'customer.next_follow_up_time.update',
        { next_follow_up_at: schedule.iso },
        utterance,
        scopedCustomerId,
      );
    }
    const question = schedule?.display
      ? `${schedule.display}几点联系？`
      : '请补充下次跟进的具体日期和时间。';
    this.pendingCapabilityTurn = createPendingCapabilityTurn({
      capability_id: 'customer.next_follow_up_time.update',
      original_instruction: `${utterance}：${actionText}`,
      parsed_arguments: schedule ? { next_follow_up_date: schedule.iso.slice(0, 10) } : {},
      missing_fields: schedule ? ['next_follow_up_time'] : ['next_follow_up_at'],
      clarification_question: question,
      customer_scope: scopedCustomerId,
      created_at: nowIso,
    });
    return this.emitReasoningHandoffClarification(question, 'customer.next_follow_up_time.update');
  }

  private emitReasoningHandoffClarification(
    question: string,
    currentIntent?: string,
  ): SalesAgentInteractionTurn {
    this.state = {
      ...this.state,
      phase: 'clarification',
      submit_locked: false,
      resolution_reason: question,
      agent_message: question,
      current_intent: currentIntent ?? this.state.current_intent,
      latest_proposal: null,
    };
    return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason: question } };
  }

  /**
   * Production planner → materializer → capability engine.
   * Returns null only when the planner did not select a capability (unknown).
   */
  private async tryCapabilityPlanner(trimmed: string): Promise<SalesAgentInteractionTurn | null> {
    const planning = await this.capabilityPlanner(trimmed, this.state.scoped_customer_id);
    return this.applyPlannerResult(planning, trimmed);
  }

  private async applyPlannerResult(
    planning: PlannerSelectionResult,
    trimmed: string,
  ): Promise<SalesAgentInteractionTurn | null> {
    if (planning.kind === 'clarify') {
      const c = planning.clarification;
      const known = omitRuntimeMetadata(
        isNewEntityCreateCapability(c.capability_id)
          ? omitNewEntityInheritedIdentity(c.known_arguments ?? {})
          : (c.known_arguments ?? {}),
      );
      const question = projectClarificationQuestion(c.capability_id, c.missing_fields, c.clarification_question, known);
      this.pendingCapabilityTurn = createPendingCapabilityTurn({
        capability_id: c.capability_id,
        original_instruction: trimmed,
        parsed_arguments: known,
        missing_fields: c.missing_fields,
        clarification_question: question,
        customer_scope: selectedCustomerIdForCapability(c.capability_id, this.state.scoped_customer_id),
        created_at: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
      });
      this.state = {
        ...this.state,
        phase: 'clarification',
        submit_locked: false,
        resolution_reason: question,
        agent_message: question,
        current_intent: c.capability_id ?? 'SAFE_FALLBACK',
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason: question } };
    }

    if (planning.kind !== 'invoke') return null;
    const filled = await this.fillSelectedCapabilityArguments(
      planning.selection.capability_id,
      planning.selection.arguments,
      trimmed,
    );
    if (filled.kind === 'clarify') {
      return this.applyPlannerResult(filled, trimmed);
    }
    if (filled.kind !== 'invoke') return null;
    return this.invokePlannedCapability(
      filled.selection.capability_id,
      filled.selection.arguments,
      trimmed,
      selectedCustomerIdForCapability(filled.selection.capability_id, this.state.scoped_customer_id),
    );
  }

  /**
   * Deterministic routing may select a capability without guessing complex
   * business arguments. Missing required fields are filled by the existing
   * Trusted Host planner caller + planner input schema — not a second client.
   *
   * New-entity create must not inherit the selected customer's identity as
   * the new row's business arguments.
   */
  private async fillSelectedCapabilityArguments(
    capabilityId: string,
    currentArguments: Readonly<Record<string, unknown>>,
    utterance: string,
  ): Promise<PlannerSelectionResult> {
    const tool = findPlannerTool(capabilityId);
    const required = tool?.input_schema.required_fields ?? [];
    const empty = (slot: unknown) => slot === undefined || slot === null || slot === '';
    const isolate = (args: Readonly<Record<string, unknown>>): Record<string, unknown> => {
      const cleaned = omitRuntimeMetadata(args);
      const scoped = isNewEntityCreateCapability(capabilityId) ? omitNewEntityInheritedIdentity(cleaned) : cleaned;
      return isNewEntityCreateCapability(capabilityId)
        ? sanitizeCustomerCreateArguments(utterance, scoped)
        : scoped;
    };
    let merged = isolate(currentArguments);
    const missing = required.filter((field) => empty(merged[field]));
    if (missing.length === 0) {
      return { kind: 'invoke', selection: { capability_id: capabilityId, arguments: merged } };
    }
    if (this.modelPlanner) {
      try {
        const raw = await this.modelPlanner({
          tool_surface: PRODUCTION_PLANNER_TOOL_SURFACE.filter(item => item.capability_id === capabilityId),
          instruction: utterance,
          customer_id: selectedCustomerIdForCapability(capabilityId, this.state.scoped_customer_id),
        });
        const parsed = validateModelPlannerOutput(raw);
        const fromModel = parsed.kind === 'invoke' && parsed.selection.capability_id === capabilityId
          ? parsed.selection.arguments
          : parsed.kind === 'clarify'
            ? (parsed.clarification.known_arguments ?? {})
            : {};
        merged = isolate({ ...merged, ...fromModel });
      } catch {
        // Model unavailable for argument extraction — fail closed, do not guess.
      }
    }
    const stillMissing = required.filter((field) => empty(merged[field]));
    if (stillMissing.length === 0) {
      return { kind: 'invoke', selection: { capability_id: capabilityId, arguments: merged } };
    }
    return {
      kind: 'clarify',
      clarification: {
        capability_id: capabilityId,
        clarification_question: projectClarificationQuestion(capabilityId, stillMissing, undefined, merged),
        missing_fields: stillMissing,
        known_arguments: merged,
      },
    };
  }

  private async resumePendingCapabilityTurn(answer: string): Promise<SalesAgentInteractionTurn> {
    const pending = this.pendingCapabilityTurn;
    if (!pending) {
      this.state = { ...this.state, submit_locked: false };
      return { state: this.state, event: { type: 'idle' } };
    }
    const nowIso = this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now();
    const combined = `${pending.original_instruction}\n${answer}`.trim();
    const parsedTime = SALES_AGENT_APP_CLOCK.parseRelativeDateTime(answer)
      ?? (pending.original_instruction
        ? SALES_AGENT_APP_CLOCK.parseRelativeDateTime(`${pending.original_instruction} ${answer}`)
        : null);
    let merged = mergePendingCapabilityAnswer(pending, answer, parsedTime?.iso ?? null);
    merged = mergePendingBusinessArguments(merged, collectReparsedBusinessFields(merged, combined, nowIso));
    this.pendingCapabilityTurn = merged;
    if (merged.missing_fields.length > 0) {
      const question = projectClarificationQuestion(
        merged.capability_id,
        merged.missing_fields,
        merged.clarification_question,
      );
      this.state = {
        ...this.state,
        phase: 'clarification',
        submit_locked: false,
        resolution_reason: question,
        agent_message: question,
        current_intent: merged.capability_id ?? this.state.current_intent,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason: question } };
    }
    if (!merged.capability_id) {
      this.pendingCapabilityTurn = null;
      const planned = await this.tryCapabilityPlanner(combined);
      if (planned) return planned;
      const reason = formatQueryFailure('missing_required_input');
      this.state = { ...this.state, phase: 'blocked', submit_locked: false, resolution_reason: reason, agent_message: reason };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
    }
    return this.invokePlannedCapability(
      merged.capability_id,
      omitRuntimeMetadata(
        isNewEntityCreateCapability(merged.capability_id)
          ? sanitizeCustomerCreateArguments(
            `${merged.original_instruction}\n${answer}`.trim(),
            omitNewEntityInheritedIdentity(merged.parsed_arguments),
          )
          : merged.parsed_arguments,
      ),
      merged.original_instruction,
      selectedCustomerIdForCapability(
        merged.capability_id,
        merged.customer_scope ?? this.state.scoped_customer_id,
      ),
    );
  }

  private emptyCustomerSearchMessage(
    utterance: string,
    filters: { readonly name_query?: string; readonly region?: string },
  ): string {
    const query = interpretCustomerQuery(utterance);
    if (query.explicit_region && query.region) return formatQueryFailure('no_region_match', query.region);
    if (filters.region && !filters.name_query) return formatQueryFailure('no_region_match', filters.region);
    if (filters.name_query || query.name_query) return formatQueryFailure('no_name_match', filters.name_query ?? query.name_query);
    return formatQueryFailure('no_name_match');
  }

  private async invokePlannedCapability(
    capabilityId: string,
    businessArguments: Readonly<Record<string, unknown>>,
    utterance: string,
    scopedCustomerId: string | null,
  ): Promise<SalesAgentInteractionTurn> {
    const tool = findPlannerTool(capabilityId);
    if (!tool) {
      const reason = formatQueryFailure('unsupported_request');
      this.state = { ...this.state, phase: 'blocked', submit_locked: false, resolution_reason: reason, agent_message: reason };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
    }

    if (tool.scope_requirement === 'CUSTOMER' && !scopedCustomerId) {
      const nameQuery = typeof businessArguments.name_query === 'string'
        ? businessArguments.name_query
        : interpretCustomerQuery(utterance).name_query;
      if (nameQuery) {
        return this.bindThenInvoke(capabilityId, businessArguments, utterance, nameQuery);
      }
      const reason = '请先定位客户，或从客户详情进入后再继续。CRM 未变更。';
      this.state = { ...this.state, phase: 'blocked', submit_locked: false, resolution_reason: reason, agent_message: reason };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
    }

    const cleanedArguments = omitRuntimeMetadata(
      isNewEntityCreateCapability(capabilityId)
        ? omitNewEntityInheritedIdentity(businessArguments)
        : businessArguments,
    );
    const materialized = await materializeRuntimeInput(capabilityId, cleanedArguments, {
      db: this.deps.db,
      clock: () => this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
      scoped_customer_id: scopedCustomerId,
      snapshot: this.runtimeSnapshot,
      context: this.runtimeContext,
      memory: this.runtimeMemory,
    });
    const args = omitRuntimeMetadata(
      materialized && typeof materialized === 'object' && !Array.isArray(materialized)
        ? materialized as Record<string, unknown>
        : {},
    );
    const scope = tool.scope_requirement === 'CUSTOMER'
      ? { customer_id: scopedCustomerId ?? undefined }
      : {};

    let outcome;
    try {
      outcome = await routeCapabilitySelection({ capability_id: capabilityId, arguments: args }, scope);
    } catch (cause) {
      const reason = formatUserFacingErrorMessage(cause);
      this.state = { ...this.state, phase: 'error', submit_locked: false, resolution_reason: reason, agent_message: reason };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'error', reason } };
    }

    if (outcome.status === 'CONFIRMATION_REQUIRED' || outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
      this.pendingCapabilityTurn = null;
      const proposal = outcome.confirmation_handoff ? getCanonicalProposal(outcome.confirmation_handoff.proposal_id) : null;
      this.state = {
        ...this.state,
        phase: 'proposal',
        scoped_customer_id: scopedCustomerId ?? this.state.scoped_customer_id,
        latest_proposal: proposal,
        latest_result: null,
        latest_direct_answer: null,
        latest_clarification: null,
        submit_locked: false,
        agent_message: capabilityId === 'customer.delete'
          ? '请确认永久删除该客户。此操作不可恢复。'
          : '已生成需人工确认的写入建议。',
        current_intent: capabilityId,
      };
      return { state: this.state, event: { type: 'idle' } };
    }

    if (outcome.status === 'SUCCESS') {
      this.pendingCapabilityTurn = null;
      return this.presentReadSuccess(capabilityId, outcome.payload, utterance, scopedCustomerId);
    }

    const reason = outcome.status === 'EXECUTION_ERROR'
      ? formatQueryFailure('write_failed', (outcome as { message?: string }).message)
      : '该请求未被允许自主执行。CRM 未变更。';
    this.state = { ...this.state, phase: 'blocked', submit_locked: false, resolution_reason: reason, agent_message: reason };
    return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
  }

  private emitBindRequired(candidate: { id: string; name: string }, utterance: string): SalesAgentInteractionTurn {
    const continuePrompt = resumeInstructionAfterScope(utterance);
    this.pendingCapabilityTurn = this.pendingCapabilityTurn && this.pendingCapabilityTurn.capability_id !== 'customer.search'
      ? { ...this.pendingCapabilityTurn, customer_scope: candidate.id }
      : null;
    this.state = {
      ...this.state,
      phase: 'resolving_customer',
      scoped_customer_id: candidate.id,
      scoped_customer_name: candidate.name,
      pending_original_instruction: utterance,
      agent_message: `已定位客户：${candidate.name}，正在读取最近互动与有效记忆……`,
      submit_locked: true,
    };
    this.rememberBindContinuation(candidate.id, continuePrompt);
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

  private async bindThenInvoke(
    capabilityId: string,
    businessArguments: Readonly<Record<string, unknown>>,
    utterance: string,
    nameQuery: string,
  ): Promise<SalesAgentInteractionTurn> {
    const search = await executeSearchCustomersTool({
      filters: { name_query: nameQuery, now: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now() },
      notes: ['named entity resolution'],
      list_kind: 'resolution',
      db: this.deps.db,
    });
    if (search.candidates.length === 1) {
      const only = search.candidates[0]!;
      this.pendingCapabilityTurn = createPendingCapabilityTurn({
        capability_id: capabilityId,
        original_instruction: utterance,
        parsed_arguments: businessArguments,
        missing_fields: [],
        clarification_question: '',
        customer_scope: only.id,
        created_at: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
      });
      this.state = {
        ...this.state,
        phase: 'resolving_customer',
        scoped_customer_id: only.id,
        scoped_customer_name: only.name,
        pending_original_instruction: utterance,
        latest_search: search,
        agent_message: `已定位客户：${only.name}，正在继续处理…`,
        submit_locked: true,
        current_intent: capabilityId,
      };
      this.rememberBindContinuation(only.id, utterance);
      return {
        state: this.state,
        event: { type: 'bind_required', customer_id: only.id, customer_name: only.name, continue_prompt: utterance },
      };
    }
    if (search.candidates.length === 0) {
      const reason = this.emptyCustomerSearchMessage(utterance, { name_query: nameQuery });
      this.state = {
        ...this.state,
        phase: 'blocked',
        submit_locked: false,
        resolution_reason: reason,
        agent_message: reason,
        latest_search: search,
      };
      return { state: this.state, event: { type: 'idle' }, outcome: { kind: 'blocked', reason } };
    }
    this.candidateIds.clear();
    for (const item of search.candidates) this.candidateIds.add(item.id);
    this.pendingCapabilityTurn = createPendingCapabilityTurn({
      capability_id: capabilityId,
      original_instruction: utterance,
      parsed_arguments: businessArguments,
      missing_fields: [],
      clarification_question: '',
      customer_scope: null,
      created_at: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
    });
    this.state = {
      ...this.state,
      phase: 'awaiting_candidate_selection',
      candidate_results: search.candidates,
      pending_original_instruction: utterance,
      latest_search: search,
      submit_locked: false,
      agent_message: `找到 ${search.candidates.length} 个符合条件的客户，请选择一个继续。`,
      current_intent: capabilityId,
    };
    return { state: this.state, event: { type: 'idle' } };
  }

  private async presentReadSuccess(
    capabilityId: string,
    payload: unknown,
    utterance: string,
    scopedCustomerId: string | null,
  ): Promise<SalesAgentInteractionTurn> {
    let customerName = this.state.scoped_customer_name;
    let nextFollowUp: string | null = null;
    let customerFacts: {
      name?: string | null;
      customer_grade?: string | null;
      region?: string | null;
      industry?: string | null;
      contact_person?: string | null;
      opportunity_amount?: number | null;
      last_contacted_at?: string | null;
      next_follow_up_at?: string | null;
      stage?: string | null;
      has_visit?: boolean;
    } | undefined;
    let customerNames: Record<string, string> | undefined;
    if (scopedCustomerId) {
      const rows = await this.deps.db.select<{
        name: string;
        next_follow_up_at: string | null;
        customer_grade: string | null;
        region: string | null;
        industry: string | null;
        contact_person: string | null;
        opportunity_amount: number | null;
        last_contacted_at: string | null;
        stage: string | null;
      }>(
        'SELECT name, next_follow_up_at, customer_grade, region, industry, contact_person, opportunity_amount, last_contacted_at, stage FROM customers WHERE id = ? LIMIT 1',
        [scopedCustomerId],
      );
      customerName = rows[0]?.name ?? customerName;
      nextFollowUp = rows[0]?.next_follow_up_at ?? null;
      if (rows[0]) {
        customerFacts = {
          name: rows[0].name,
          customer_grade: rows[0].customer_grade,
          region: rows[0].region,
          industry: rows[0].industry,
          contact_person: rows[0].contact_person,
          opportunity_amount: rows[0].opportunity_amount,
          last_contacted_at: rows[0].last_contacted_at,
          next_follow_up_at: rows[0].next_follow_up_at,
          stage: rows[0].stage,
        };
      }
      if (capabilityId === 'battle_card.current.read') {
        const visitRows = await this.deps.db.select<{ c: number }>(
          'SELECT COUNT(*) AS c FROM visit_records WHERE customer_id = ?',
          [scopedCustomerId],
        );
        customerFacts = {
          ...(customerFacts ?? {}),
          has_visit: Number(visitRows[0]?.c ?? 0) > 0,
        };
      }
    }
    if (capabilityId === 'follow_up.global.read') {
      const nameRows = await this.deps.db.select<{ id: string; name: string }>('SELECT id, name FROM customers');
      customerNames = Object.fromEntries(nameRows.map(row => [row.id, row.name]));
    }
    const adapted = adaptReadSuccess({
      capability_id: capabilityId,
      payload,
      utterance,
      customer_name: customerName,
      next_follow_up_at: nextFollowUp,
      clock_now: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(),
      customer_facts: customerFacts,
      customer_names: customerNames,
    });

    if (capabilityId === 'customer.search') {
      const search = payload as SearchCustomersResult;
      this.candidateIds.clear();
      for (const item of search.candidates ?? []) this.candidateIds.add(item.id);
      const empty = !search.candidates?.length;
      const query = interpretCustomerQuery(utterance);
      const resolution = search.list_kind === 'resolution' || (query.mode === 'lookup' && !query.list_mode);
      if (!empty && resolution && (search.candidates?.length ?? 0) === 1) {
        return this.emitBindRequired(search.candidates[0]!, utterance);
      }
      const phase = empty ? 'blocked' : resolution ? 'awaiting_candidate_selection' : 'portfolio_browse';
      this.state = {
        ...this.state,
        phase,
        latest_search: search,
        latest_direct_answer: adapted,
        latest_proposal: null,
        latest_clarification: null,
        candidate_results: search.candidates ?? [],
        portfolio_total_matches: search.total_matches ?? 0,
        portfolio_page_offset: search.page_offset ?? 0,
        portfolio_has_more: Boolean(search.has_more),
        portfolio_filters_message: resolution ? null : utterance,
        pending_original_instruction: resolution && !empty ? utterance : null,
        submit_locked: false,
        agent_message: adapted.message,
        current_intent: capabilityId,
        resolution_reason: empty ? adapted.message : null,
      };
      return {
        state: this.state,
        event: empty ? { type: 'idle' } : resolution ? { type: 'idle' } : { type: 'portfolio_list' },
        outcome: empty ? { kind: 'blocked', reason: adapted.message } : undefined,
      };
    }

    this.state = {
      ...this.state,
      phase: 'scoped',
      scoped_customer_id: scopedCustomerId ?? this.state.scoped_customer_id,
      scoped_customer_name: customerName ?? this.state.scoped_customer_name,
      latest_proposal: null,
      latest_clarification: null,
      latest_direct_answer: adapted,
      submit_locked: false,
      agent_message: adapted.message,
      current_intent: capabilityId,
    };
    return { state: this.state, event: { type: 'idle' } };
  }

  private async runScoped(
    intentEnvelope: AgentIntentEnvelope,
    customerId: string,
    options?: { readonly clearPendingOnSettle?: boolean },
  ): Promise<SalesAgentInteractionTurn> {    const message = intentEnvelope.original_instruction;
    const session = this.createSession(customerId);
    if (!session) {
      this.state = {
        ...this.state,
        phase: 'blocked',
        submit_locked: false,
        resolution_reason: '客户上下文尚未就绪。',
        agent_message: '客户上下文尚未就绪，请稍候再试。',
      };
      this.rememberBindContinuation(customerId, message);
      return {
        state: this.state,
        event: { type: 'bind_required', customer_id: customerId, customer_name: this.state.scoped_customer_name ?? '', continue_prompt: message },
        outcome: { kind: 'blocked', reason: this.state.resolution_reason! },
      };
    }

    this.state = { ...this.state, phase: 'reasoning', submit_locked: true, current_intent: 'CUSTOMER_ANALYSIS' };
    const outcome = await session.submit(intentEnvelope);

    if (outcome.kind === 'reasoning_result') {
      const nowIso = this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now();
      this.state = {
        ...this.state,
        phase: 'scoped',
        scoped_customer_id: customerId,
        latest_result: outcome.result,
        latest_proposal: null,
        latest_clarification: null,
        last_reasoning_action_context: projectReasoningActionContext(
          outcome.result,
          customerId,
          nowIso,
          this.state.scoped_customer_name,
        ),
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
        pending_session: { ...this.state.pending_session, pending_instruction: outcome.clarification.original_instruction, pending_intent: outcome.clarification.intent, missing_fields: outcome.clarification.missing_fields, customer_scope: customerId, selected_customer_id: customerId, resume_after_scope: false, clarification_state: 'REQUIRED', proposal_state: 'NONE' },
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
        pending_session: { ...this.state.pending_session, pending_instruction: null, pending_intent: null, missing_fields: [], customer_scope: customerId, selected_customer_id: customerId, resume_after_scope: false, clarification_state: 'RESOLVED', proposal_state: 'PENDING' },
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

  private async runPriorityRanking(intentEnvelope: AgentIntentEnvelope): Promise<SalesAgentInteractionTurn> {
    const ranking = await executeCustomerPriorityRanking({ db: this.deps.db, now: this.deps.clock?.() ?? SALES_AGENT_APP_CLOCK.now(), limit: 20 });
    const candidates: CustomerSearchCandidate[] = ranking.items.map(item => ({ id: item.customer_id, name: item.customer_name, region: null, industry: null, stage: null, customer_grade: null, intent_level: null, last_contacted_at: null, next_follow_up_at: null, match_score: item.score, evidence_ref: item.evidence_references[0] ?? `customer:${item.customer_id}` }));
    this.candidateIds.clear(); for (const item of candidates) this.candidateIds.add(item.id);
    this.state = { ...this.state, phase: 'portfolio_browse', submit_locked: false, current_intent: intentEnvelope.intent, latest_priority_ranking: ranking, candidate_results: candidates, portfolio_total_matches: candidates.length, portfolio_page_offset: 0, portfolio_has_more: false, portfolio_filters_message: intentEnvelope.original_instruction, pending_original_instruction: null, agent_message: ranking.model_status_note, pending_session: { ...this.state.pending_session, pending_instruction: null, pending_intent: null, candidate_customer_ids: candidates.map(item => item.id), resume_after_scope: false } };
    return { state: this.state, event: { type: 'portfolio_list' } };
  }
}
