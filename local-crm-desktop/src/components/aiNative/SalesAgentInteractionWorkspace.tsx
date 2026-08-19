import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronRight, FileText, Image, Inbox, Mic, Paperclip, Sparkles, X } from 'lucide-react';
import type { ContextSnapshot } from '../../lib/context/types';
import type { CustomerMemoryContext, MemoryRepository } from '../../lib/customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../../lib/readOnlySnapshotLoaderReadiness';
import { getDb } from '../../lib/db';
import { SalesAgentSession, type AgentSessionResult, type SalesAgentHost, type SafeWriteBoundary } from '../../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../../lib/salesAgentTools/approvedCrmWriteBoundary';
import type { AgentWriteProposal } from '../../lib/salesAgentTools/confirmedWrite';
import type { WriteClarificationRequest } from '../../lib/salesAgentTools/writeIntent';
import { editFact, reviewedFacts, setFactReview, type CustomerCaptureReview } from '../../lib/customerCapture/review';
import { readAndValidateVisionFile } from '../../lib/productionAi/visionInput';
import { mapSalesAgentOrbState, type SalesAgentUiPhase } from '../../lib/salesAgentUi/orbState';
import { buildAgentWorkProcess, describeReadWork, describeReasoningWork, summarizeWorkProcess } from '../../lib/salesAgentUi/workProcess';
import { AGENT_HOME_QUICK_ACTIONS, type SalesAgentQuickAction } from '../../lib/salesAgentUi/quickActions';
import { formatUserFacingErrorMessage } from '../../lib/salesAgentUi/formatUserFacingError';
import { formatProposalValues, formatUserTimeLabel, projectConfirmationCard, projectConfirmationTechnicalDetails } from '../../lib/salesAgentUi/userFacingFieldFormatter';
import { projectResultCards } from '../../lib/salesAgentUi/resultCards';
import { explainUnchangedCrmError, mapUserExecutionState } from '../../lib/salesAgentUi/executionState';
import {
  bindPendingPrompt,
  decideCustomerBoundPendingResume,
  isInternalCustomerBind,
  type CustomerBoundPending,
} from '../../lib/salesAgentUi/conversationPendingScope';
import { t, tGrade, tStage } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';
import { isGenericOptionalCustomerPickerEnabled, resolveUnifiedAgentStageMode } from '../../lib/salesAgentUi/stageMode';
import {
  SalesAgentInteractionController,
  type SalesAgentInteractionState,
} from '../../lib/salesAgentTools/interactionController';
import type { CustomerSearchCandidate } from '../../lib/salesAgentTools/searchCustomers';
import { SalesAgentGlassOrb } from './SalesAgentGlassOrb';
import { SALES_AGENT_APP_CLOCK } from '../../lib/salesAgentTools/appClock';
import { createAgentIntentEnvelopeFromPreset, type SemanticIntentResolution } from '../../lib/salesAgentTools/agentIntentEnvelope';
import type { ProductionRuntimeDetails } from '../../lib/productionAi/runtimeMode';

export function CaptureRuntimeMetadata({ details }: { details: ProductionRuntimeDetails }) {
  return <div data-testid="capture-runtime-metadata">
    <p>Execution mode: {details.execution_mode}</p>
    <p>Provider / Model: {details.provider ?? 'none'} / {details.model ?? 'none'}</p>
    <p>Request: {details.request_id}</p>
    <p>Model called: {details.model_called ? 'yes' : 'no'}</p>
    <p>Latency: {details.latency_ms == null ? '—' : `${details.latency_ms} ms`}</p>
    <p>Token usage: {details.token_usage?.total_tokens ?? '—'}</p>
    <p>Tools: {details.tools.join(' → ') || 'none'}</p>
    <p>Evidence count: {details.evidence_count}</p>
    <p>Schema status: {details.schema_validation_status}</p>
    <p>Evidence status: {details.evidence_validation_status}</p>
    <p>Cancellation status: {details.cancellation_status}</p>
    <p>Degradation reason: {details.degradation_reason ?? 'none'}</p>
  </div>;
}

function semanticRouterFromHost(host: SalesAgentHost | null): ((
  instruction: string,
  envelopeId: string,
  signal?: AbortSignal,
  routingContext?: import('../../lib/productionAi/semanticIntentRouter').SemanticIntentRoutingContext,
) => Promise<SemanticIntentResolution>) | undefined {
  if (!host || !('routeSemanticIntent' in host) || typeof host.routeSemanticIntent !== 'function') return undefined;
  return host.routeSemanticIntent as (instruction: string, envelopeId: string, signal?: AbortSignal) => Promise<SemanticIntentResolution>;
}

/**
 * Production confirm: only proposal_id + nonce are submitted.
 * Canonical payload is read from the process-stable write-state store (survives Session remount).
 */
export async function confirmSalesAgentProposal(session: SalesAgentSession, proposal: AgentWriteProposal, onRefresh: () => Promise<void>, boundary: SafeWriteBoundary = approvedCrmWriteBoundary) {
  const result = await session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce ?? '',
    confirmed_at: SALES_AGENT_APP_CLOCK.now(),
  }, boundary);
  await onRefresh();
  return result;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type HistoryItem = {
  readonly id: string;
  readonly question: string;
  readonly summary: string;
  readonly at: string;
  readonly status: string;
};

function createSpeechRecognition(): SpeechRecognitionLike | null {
  const ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  return ctor ? new ctor() : null;
}

function confirmButtonLabel(proposal: AgentWriteProposal): string {
  return projectConfirmationCard(proposal).confirm_label;
}

function successLabel(proposal: AgentWriteProposal): string {
  return projectConfirmationCard(proposal).success_label;
}

function proposalIntent(proposal: AgentWriteProposal | null): 'CREATE_FOLLOW_UP_REQUEST' | 'CREATE_TASK_REQUEST' | 'UPDATE_CUSTOMER_REQUEST' | '' {
  if (!proposal) return '';
  if (proposal.tool_id === 'create_follow_up_record') return 'CREATE_FOLLOW_UP_REQUEST';
  if (proposal.tool_id === 'create_task') return 'CREATE_TASK_REQUEST';
  if (proposal.tool_id === 'update_next_follow_up_time') return 'UPDATE_CUSTOMER_REQUEST';
  return '';
}

export function SalesAgentInteractionWorkspace({
  customerId,
  customerName,
  onBindCustomer,
  onClearCustomer,
  snapshot,
  context,
  compareContext,
  customerCatalog,
  memory,
  profileId,
  host,
  memoryRepository,
  loadCustomerSnapshot,
  onRefresh,
  contextLoading = false,
  onOpenContextDrawer,
  processDrawerOpen = false,
  onProcessDrawerOpenChange,
  initialInstruction = null,
  onInitialInstructionConsumed,
  onRegisterNewConversation,
  userConversationKey,
}: {
  customerId: string;
  customerName?: string;
  /** @deprecated Production resolution uses repository search; kept optional for transitional callers */
  searchableCustomers?: unknown;
  onBindCustomer: (customerId: string, options?: { continuePrompt?: string }) => void;
  onClearCustomer: () => void;
  snapshot: LoadedReadOnlyAgentSnapshot | null;
  context: ContextSnapshot | null;
  compareContext?: ContextSnapshot | null;
  customerCatalog?: readonly { readonly id: string; readonly name: string }[];
  memory?: CustomerMemoryContext;
  profileId: string;
  host: SalesAgentHost | null;
  memoryRepository?: MemoryRepository;
  loadCustomerSnapshot: (customerId: string) => Promise<{ next_follow_up_at: string | null } | null>;
  onRefresh: () => Promise<void>;
  contextLoading?: boolean;
  onOpenContextDrawer?: () => void;
  processDrawerOpen?: boolean;
  onProcessDrawerOpenChange?: (open: boolean) => void;
  initialInstruction?: string | null;
  onInitialInstructionConsumed?: () => void;
  onRegisterNewConversation?: (handler: (() => void) | null) => void;
  /** Changes when the user navigates into a customer from outside internal bind. */
  userConversationKey?: string;
}) {
  const sessionRef = useRef<SalesAgentSession | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);

  useEffect(() => {
    if (!customerId) {
      sessionRef.current?.invalidateAllPendingWrites();
      sessionRef.current = null;
      setSessionVersion(v => v + 1);
      return;
    }
    if (!snapshot || !context) {
      // Keep existing session identity during context reload; do not wipe proposal registry.
      return;
    }
    const existing = sessionRef.current;
    if (existing && existing.getCustomerId() === customerId) {
      existing.updateRuntime({
        host,
        dependencies: {
          snapshot,
          context,
          compare_context: compareContext ?? undefined,
          memory,
          profile_id: profileId,
          memory_repository: memoryRepository,
          loadCustomerSnapshot,
          planning_mode: 'deterministic',
          model_caller: host && 'createProductionModelCaller' in host && typeof host.createProductionModelCaller === 'function'
            ? host.createProductionModelCaller()
            : undefined,
        },
      });
      return;
    }
    // Only invalidate write-state when switching to a different customer identity.
    // Same-customer Session remount MUST keep pending draft + canonical proposals.
    if (existing && existing.getCustomerId() !== customerId) {
      existing.invalidateAllPendingWrites();
    }
    sessionRef.current = new SalesAgentSession(customerId, host, () => SALES_AGENT_APP_CLOCK.now(), {
      snapshot,
      context,
      compare_context: compareContext ?? undefined,
      memory,
      profile_id: profileId,
      memory_repository: memoryRepository,
      loadCustomerSnapshot,
      planning_mode: 'deterministic',
      model_caller: host && 'createProductionModelCaller' in host && typeof host.createProductionModelCaller === 'function'
        ? host.createProductionModelCaller()
        : undefined,
    });
    setSessionVersion(v => v + 1);
  }, [customerId, host, snapshot, context, compareContext, memory, profileId, memoryRepository, loadCustomerSnapshot]);

  const controllerRef = useRef<SalesAgentInteractionController | null>(null);
  const [controllerReady, setControllerReady] = useState(false);
  const pendingContinue = useRef<CustomerBoundPending | null>(null);
  /** User prompt waiting for customer snapshot/session after bind or reload. */
  const pendingUserSubmit = useRef<CustomerBoundPending | null>(null);
  const lastUserConversationKey = useRef<string | null>(null);
  useAppLocale();

  const ensureController = useCallback(async () => {
    if (controllerRef.current) return controllerRef.current;
    try {
      const db = await getDb();
      controllerRef.current = new SalesAgentInteractionController({
        db,
        createSession: id => {
          const current = sessionRef.current;
          return current && current.getCustomerId() === id ? current : null;
        },
        clock: () => SALES_AGENT_APP_CLOCK.now(),
        semantic_intent_router: semanticRouterFromHost(host),
        model_planner: host && 'createModelPlannerCaller' in host && typeof host.createModelPlannerCaller === 'function'
          ? host.createModelPlannerCaller()
          : undefined,
        customer_catalog: customerCatalog,
      });
      setControllerReady(true);
      return controllerRef.current;
    } catch (cause) {
      const message = formatUserFacingErrorMessage(cause);
      setError(message);
      setPhase('blocked');
      throw cause instanceof Error ? cause : new Error(message);
    }
  }, [host]);

  useEffect(() => {
    if (!controllerRef.current) return;
    const controller = controllerRef.current;
    const navigationKey = userConversationKey ?? customerId;
    const isInternalBind = isInternalCustomerBind(pendingContinue.current, customerId);
    if (!customerId) {
      if (decideCustomerBoundPendingResume(pendingUserSubmit.current, null).action === 'discard') {
        pendingUserSubmit.current = null;
      }
      controller.syncExternalScope(null);
      lastUserConversationKey.current = null;
    } else if (isInternalBind) {
      controller.syncExternalScope(customerId, customerName);
      lastUserConversationKey.current = navigationKey;
    } else if (lastUserConversationKey.current !== navigationKey) {
      if (decideCustomerBoundPendingResume(pendingContinue.current, customerId).action === 'discard') {
        pendingContinue.current = null;
      }
      if (decideCustomerBoundPendingResume(pendingUserSubmit.current, customerId).action === 'discard') {
        pendingUserSubmit.current = null;
      }
      controller.enterCustomerConversation(customerId, customerName);
      lastUserConversationKey.current = navigationKey;
    } else {
      controller.syncExternalScope(customerId, customerName);
    }
    controller.createSession = (id: string) => {
      const current = sessionRef.current;
      return current && current.getCustomerId() === id ? current : null;
    };
    controller.semanticIntentRouter = semanticRouterFromHost(host) ?? null;
    controller.modelPlanner = host && 'createModelPlannerCaller' in host && typeof host.createModelPlannerCaller === 'function'
      ? host.createModelPlannerCaller()
      : null;
    controller.setRuntimeContext({ snapshot, context, memory });
    controller.customerCatalog = customerCatalog ?? [];
  }, [customerId, customerName, customerCatalog, sessionVersion, host, snapshot, context, memory, userConversationKey]);

  const [message, setMessage] = useState('');
  const [result, setResult] = useState<AgentSessionResult | null>(null);
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [captureReview, setCaptureReview] = useState<CustomerCaptureReview | null>(null);
  const [proposal, setProposal] = useState<AgentWriteProposal | null>(null);
  const [clarification, setClarification] = useState<WriteClarificationRequest | null>(null);
  const [writeResult, setWriteResult] = useState('');
  const [lastConfirmedProposal, setLastConfirmedProposal] = useState<AgentWriteProposal | null>(null);
  const [replayResult, setReplayResult] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<SalesAgentUiPhase>('idle');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [error, setError] = useState('');
  const [locatingCustomer, setLocatingCustomer] = useState(false);
  const [candidates, setCandidates] = useState<readonly CustomerSearchCandidate[]>([]);
  const [emptyExact, setEmptyExact] = useState(false);

  const selectImage = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setCaptureReview(null);
    try {
      setImagePreview(await readAndValidateVisionFile(file));
    } catch (cause) {
      setImagePreview('');
      setError(formatUserFacingErrorMessage(cause));
    }
  };
  const [portfolioMode, setPortfolioMode] = useState(false);
  const [portfolioTotal, setPortfolioTotal] = useState(0);
  const [portfolioHasMore, setPortfolioHasMore] = useState(false);
  const [activePrompt, setActivePrompt] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<readonly HistoryItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [confirmExpanded, setConfirmExpanded] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [interactionState, setInteractionState] = useState<SalesAgentInteractionState | null>(null);
  const initialInstructionConsumedRef = useRef<string | null>(null);
  const thinkingStartedAt = useRef(0);

  useEffect(() => {
    setConfirmExpanded(false);
  }, [proposal?.proposal_id]);

  const holdThinkingMorph = async () => {
    const elapsed = Date.now() - thinkingStartedAt.current;
    if (elapsed < 450) {
      await new Promise<void>(resolve => { window.setTimeout(resolve, 450 - elapsed); });
    }
  };

  const orbState = mapSalesAgentOrbState({
    phase,
    hasResult: Boolean(result) || Boolean(interactionState?.latest_direct_answer),
    hasProposal: Boolean(proposal),
    voiceListening,
    sessionBusy,
  });

  const stageMode = resolveUnifiedAgentStageMode({
    sessionBusy,
    locatingCustomer,
    phase,
    candidateCount: candidates.length,
    hasPortfolio: portfolioMode,
    hasProposal: Boolean(proposal),
    hasResult: Boolean(result) || Boolean(interactionState?.latest_direct_answer),
    hasWriteSuccess: Boolean(writeResult),
    hasClarification: Boolean(clarification) || interactionState?.phase === 'clarification',
  });

  const orbCompact = stageMode === 'result' || stageMode === 'proposal' || stageMode === 'candidate' || stageMode === 'portfolio' || stageMode === 'error' || stageMode === 'clarification';
  const composerMorphOut = stageMode === 'thinking';
  const showQuickActions = stageMode === 'input';
  const thinkingVisible = stageMode === 'thinking';
  const genericPickerEnabled = isGenericOptionalCustomerPickerEnabled(stageMode, customerId);

  useEffect(() => {
    if (!genericPickerEnabled) setPickerOpen(false);
  }, [genericPickerEnabled]);

  const workSteps = buildAgentWorkProcess({
    customerSelected: Boolean(customerId),
    locatingCustomer,
    contextLoaded: Boolean(snapshot && context),
    memoryCount: memory?.items.length ?? 0,
    timelineCount: context?.recentInteractions.length ?? 0,
    sessionBusy,
    result,
    proposal,
    confirmationPending: Boolean(proposal),
    blockedReason: phase === 'blocked' || phase === 'error' ? error : undefined,
    captureReview,
  });

  const processSummary = summarizeWorkProcess(workSteps);
  const processExpanded = processDrawerOpen ?? false;
  const projected = result && !proposal && !clarification ? projectResultCards(result) : null;
  const directAnswer = !proposal && !clarification ? interactionState?.latest_direct_answer : null;

  const pushHistory = (question: string, summary: string, status: string) => {
    setHistory(current => [
      {
        id: `h-${current.length + 1}-${Date.now()}`,
        question,
        summary,
        at: SALES_AGENT_APP_CLOCK.formatUserTime(SALES_AGENT_APP_CLOCK.now()),
        status,
      },
      ...current,
    ].slice(0, 24));
  };

  const applyState = (state: SalesAgentInteractionState) => {
    setInteractionState(state);
    setCandidates(state.candidate_results);
    setEmptyExact(state.candidate_empty_exact);
    setPortfolioMode(
      state.phase === 'portfolio_browse'
      || state.latest_search?.list_kind === 'portfolio',
    );
    setPortfolioTotal(state.portfolio_total_matches || state.latest_search?.total_matches || 0);
    setPortfolioHasMore(state.portfolio_has_more || Boolean(state.latest_search?.has_more));
    setSessionBusy(state.submit_locked || state.phase === 'reasoning' || state.phase === 'resolving_customer');
    setLocatingCustomer(state.phase === 'resolving_customer' || state.phase === 'awaiting_candidate_selection' && state.submit_locked);
    setResult(state.latest_result);
    setProposal(state.latest_proposal);
    setClarification(state.latest_clarification);
    if (state.phase === 'clarification') {
      setError(state.resolution_reason ? formatUserFacingErrorMessage(state.resolution_reason) : '');
      setPhase('idle');
    } else if (state.resolution_reason) {
      setError(formatUserFacingErrorMessage(state.resolution_reason));
      setPhase('blocked');
    } else if (state.phase === 'proposal') {
      setError('');
      setPhase('idle');
    } else if (state.phase === 'scoped' || state.phase === 'awaiting_candidate_selection' || state.phase === 'portfolio_browse' || state.phase === 'unscoped') {
      setError('');
      setPhase('idle');
    } else if (state.phase === 'reasoning' || state.phase === 'resolving_customer') {
      setPhase('thinking');
    }
  };

  const finishTurn = (state: SalesAgentInteractionState, options?: { readonly userText?: string }) => {
    applyState(state);
    if (options?.userText) {
      const summary = state.latest_direct_answer?.headline
        ?? (state.latest_result ? projectResultCards(state.latest_result).headline : (state.agent_message || t('agent.turnComplete')));
      pushHistory(options.userText, summary, state.phase);
    }
  };

  useEffect(() => {
    if (!customerId) return;
    setCandidates([]);
    setEmptyExact(false);
    setPortfolioMode(false);
    setProposal(null);
    setClarification(null);
  }, [customerId]);

  useEffect(() => {
    const decision = decideCustomerBoundPendingResume(pendingContinue.current, customerId);
    if (decision.action !== 'resume' || !sessionRef.current || contextLoading) {
      if (decision.action === 'discard') pendingContinue.current = null;
      return;
    }
    if (sessionRef.current.getCustomerId() !== customerId) return;
    pendingContinue.current = null;
    const pending = decision.prompt;
    void (async () => {
      const controller = await ensureController();
      setSessionBusy(true);
      setPhase('thinking');
      setActivePrompt(pending);
      const turn = await controller.continueAfterBind(pending, customerId);
      applyState(turn.state);
      if (turn.state.latest_result) {
        pushHistory(pending, projectResultCards(turn.state.latest_result).headline, 'result');
      }
      setSessionBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVersion, contextLoading, customerId]);

  useEffect(() => {
    const decision = decideCustomerBoundPendingResume(pendingUserSubmit.current, customerId);
    if (decision.action !== 'resume') {
      if (decision.action === 'discard') pendingUserSubmit.current = null;
      return;
    }
    if (!customerId || contextLoading || !sessionRef.current || !snapshot || !context) return;
    if (sessionBusy) return;
    pendingUserSubmit.current = null;
    setLocatingCustomer(false);
    void submit(decision.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVersion, contextLoading, snapshot, context, customerId, sessionBusy]);

  const submit = async (prompt = message) => {
    if (!prompt.trim()) return;
    if (sessionBusy) return;
    // Queue scoped instructions until session identity + read context are ready (no lost writes).
    if (customerId && (contextLoading || !sessionRef.current || !snapshot || !context)) {
      pendingUserSubmit.current = bindPendingPrompt(prompt.trim(), customerId);
      setMessage('');
      setError('');
      setWriteResult('');
      setActivePrompt(prompt.trim());
      setPhase('thinking');
      setLocatingCustomer(true);
      return;
    }
    setMessage('');
    setError('');
    setWriteResult('');
    setRuntimeDetailsOpen(false);
    setActivePrompt(prompt.trim());
    thinkingStartedAt.current = Date.now();
    setSessionBusy(true);
    setPhase('thinking');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    sessionRef.current?.updateRuntime({
      dependencies: sessionRef.current && snapshot && context ? {
        snapshot,
        context,
        compare_context: compareContext ?? undefined,
        memory,
        profile_id: profileId,
        memory_repository: memoryRepository,
        loadCustomerSnapshot,
        planning_mode: 'deterministic',
        model_caller: host && 'createProductionModelCaller' in host && typeof host.createProductionModelCaller === 'function'
          ? host.createProductionModelCaller()
          : undefined,
        abort_signal: signal,
      } : undefined,
    });

    try {
      const controller = await ensureController();
      controller.syncExternalScope(customerId || null, customerName);
      const turn = await controller.submit(prompt, signal);
      if (signal.aborted) {
        setError('已取消本次模型请求。');
        setPhase('blocked');
        return;
      }
      finishTurn(turn.state, { userText: prompt });

      if (turn.event.type === 'bind_required') {
        pendingContinue.current = bindPendingPrompt(turn.event.continue_prompt, turn.event.customer_id);
        onBindCustomer(turn.event.customer_id, { continuePrompt: turn.event.continue_prompt });
        setLocatingCustomer(true);
        setPhase('thinking');
        return;
      }

      if (turn.event.type === 'clear_scope') {
        onClearCustomer();
      }
    } catch (cause) {
      if (signal.aborted) {
        setError('已取消本次模型请求。');
        setPhase('blocked');
        return;
      }
      const formatted = formatUserFacingErrorMessage(cause);
      setError(formatted);
      setActivePrompt(prompt.trim());
      setPhase('blocked');
    } finally {
      await holdThinkingMorph();
      setSessionBusy(false);
    }
  };

  const cancelInFlight = () => {
    abortRef.current?.abort();
    setSessionBusy(false);
    setPhase('idle');
    setError('已取消本次模型请求。');
  };

  const answerClarification = (value: string) => {
    if (value === '__custom__') {
      setMessage('');
      setPhase('input-ready');
      return;
    }
    void submit(value);
  };

  const confirm = async () => {
    if (!proposal) return;
    const confirmedProposal = proposal;
    // Prefer live session; if React remounted Session, rebuild one for the same customer —
    // canonical proposal still lives in the process-stable write-state store.
    let session = sessionRef.current;
    const unscopedCreate = confirmedProposal.tool_id === 'create_customer';
    if (!session || session.getCustomerId() !== confirmedProposal.customer_id) {
      if (!unscopedCreate && (!snapshot || !context || !confirmedProposal.customer_id)) {
        setError('这项待确认操作已经失效，请重新生成后再确认。');
        setPhase('blocked');
        return;
      }
      session = new SalesAgentSession(confirmedProposal.customer_id, host, () => SALES_AGENT_APP_CLOCK.now(), snapshot && context ? {
        snapshot,
        context,
        memory,
        profile_id: profileId,
        memory_repository: memoryRepository,
        loadCustomerSnapshot,
        planning_mode: 'deterministic',
        model_caller: host && 'createProductionModelCaller' in host && typeof host.createProductionModelCaller === 'function'
          ? host.createProductionModelCaller()
          : undefined,
      } : undefined);
      if (!unscopedCreate) sessionRef.current = session;
    }
    try {
      const write = await confirmSalesAgentProposal(session, confirmedProposal, async () => {
        await onRefresh();
        setRefreshCount(count => count + 1);
      });
      setWriteResult(
        `${successLabel(confirmedProposal)}\n${formatProposalValues(confirmedProposal.proposed_values)}\n更新时间：${SALES_AGENT_APP_CLOCK.formatUserTime(SALES_AGENT_APP_CLOCK.now())}`,
      );
      setLastConfirmedProposal(confirmedProposal);
      setReplayResult('');
      setProposal(null);
      setClarification(null);
      setResult(null);
      setPhase('idle');
      void write;
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
      setPhase('blocked');
    }
  };

  const replayLastConfirmation = async () => {
    const session = sessionRef.current;
    if (!lastConfirmedProposal || !session || session.getCustomerId() !== lastConfirmedProposal.customer_id) return;
    try {
      await confirmSalesAgentProposal(session, lastConfirmedProposal, onRefresh);
      setReplayResult('错误：重放未被拒绝。');
    } catch (cause) {
      setReplayResult(`重放已拒绝：${formatUserFacingErrorMessage(cause)}`);
    }
  };

  const cancelProposal = () => {
    sessionRef.current?.cancelPendingWrite(proposal);
    setProposal(null);
    setClarification(null);
    setWriteResult('');
    setPhase('idle');
  };

  const toggleGroupedOperation = (operationId: string, selected: boolean) => {
    if (!proposal || !sessionRef.current) return;
    try {
      setProposal(sessionRef.current.setGroupedOperationSelected(proposal.proposal_id, operationId, selected));
      setError('');
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
      setPhase('blocked');
    }
  };

  useEffect(() => {
    if (!initialInstruction || initialInstructionConsumedRef.current === initialInstruction) return;
    if (sessionBusy || contextLoading) return;
    initialInstructionConsumedRef.current = initialInstruction;
    onInitialInstructionConsumed?.();
    void submit(initialInstruction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInstruction, sessionBusy, contextLoading, customerId, sessionVersion]);

  const cancelCandidateSelection = () => {
    if (sessionBusy) return;
    void ensureController().then(controller => {
      pendingContinue.current = null;
      const next = controller.cancelCandidateSelection();
      applyState(next);
      setActivePrompt('');
      setError('');
      setPhase('idle');
    });
  };

  const pickCandidate = async (candidate: CustomerSearchCandidate) => {
    if (sessionBusy) return;
    setSessionBusy(true);
    setPhase('thinking');
    setCandidates([]);
    try {
      const controller = await ensureController();
      const turn = await controller.selectCandidate(candidate.id);
      applyState(turn.state);

      if (turn.event.type === 'bind_required') {
        pendingContinue.current = bindPendingPrompt(turn.event.continue_prompt, turn.event.customer_id);
        onBindCustomer(turn.event.customer_id, { continuePrompt: turn.event.continue_prompt });
        return;
      }
      if (turn.outcome?.kind === 'blocked' || turn.outcome?.kind === 'error') {
        setError(formatUserFacingErrorMessage(turn.outcome.reason));
        setPhase('blocked');
      }
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
      setPhase('blocked');
    } finally {
      setSessionBusy(false);
    }
  };

  const loadMorePortfolio = async () => {
    if (sessionBusy || !portfolioHasMore) return;
    setSessionBusy(true);
    try {
      const controller = await ensureController();
      const turn = await controller.loadMorePortfolio();
      applyState(turn.state);
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
      setPhase('blocked');
    } finally {
      setSessionBusy(false);
    }
  };

  const runQuickAction = (action: SalesAgentQuickAction) => {
    if (action.kind === 'open_capture') {
      setCaptureOpen(true);
      return;
    }
    setMessage(action.prompt);
    void submit(action.prompt);
  };

  const analyzeCapture = async (sourceType: 'text' | 'image', source: string) => {
    if (!sessionRef.current) {
      setError('请先通过自然语言或客户详情绑定客户后再 Analyze。');
      setPhase('blocked');
      return;
    }
    setSessionBusy(true);
    setPhase('thinking');
    setActivePrompt('分析上传内容');
    setError('');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const captureEnvelope = sourceType === 'image' ? createAgentIntentEnvelopeFromPreset({
        instruction: '分析当前用户选择的客户图片',
        now_iso: SALES_AGENT_APP_CLOCK.now(),
        intent: 'CAPTURE_REVIEW',
        mode: 'capture',
        has_selected_image: true,
      }) : undefined;
      const review = await sessionRef.current.capture(sourceType, source, signal, captureEnvelope);
      if (signal.aborted) return;
      setCaptureReview(review);
      setPhase('idle');
    } catch (cause) {
      setPhase('blocked');
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setSessionBusy(false);
    }
  };

  const analyzeReviewed = async () => {
    if (!captureReview || !sessionRef.current) return;
    setSessionBusy(true);
    setPhase('thinking');
    setCaptureOpen(false);
    setActivePrompt('Analyze reviewed facts');
    try {
      await sessionRef.current.persistReviewedFacts(captureReview);
      setResult(await sessionRef.current.analyzeReviewedFacts(captureReview));
      setPhase('idle');
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
      setPhase('blocked');
    } finally {
      setSessionBusy(false);
    }
  };

  const toggleVoice = () => {
    if (voiceListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setVoiceListening(false);
      setPhase(message ? 'input-ready' : 'idle');
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setError('当前环境不支持语音听写；请直接输入文字。');
      setPhase('blocked');
      return;
    }
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(item => item[0]?.transcript ?? '').join('').trim();
      if (transcript) setMessage(current => (current ? `${current} ${transcript}` : transcript));
    };
    recognition.onerror = () => {
      setVoiceListening(false);
      setPhase('idle');
    };
    recognition.onend = () => {
      setVoiceListening(false);
      setPhase(message ? 'input-ready' : 'idle');
    };
    recognitionRef.current = recognition;
    recognition.start();
    setVoiceListening(true);
    setPhase('listening');
  };

  const resetConversation = () => {
    sessionRef.current?.invalidateAllPendingWrites();
    void ensureController().then(controller => {
      const next = controller.startNewConversation({ clear_customer_scope: false });
      applyState(next);
    });
    setResult(null);
    setProposal(null);
    setClarification(null);
    setCandidates([]);
    setPortfolioMode(false);
    setError('');
    setWriteResult('');
    setCaptureReview(null);
    setActivePrompt('');
    setPhase('idle');
  };

  useEffect(() => {
    onRegisterNewConversation?.(resetConversation);
    return () => onRegisterNewConversation?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterNewConversation]);


  void controllerReady;

  const composer = (
    <div
      className={`agent-composer${sessionBusy ? ' is-loading' : ''}${error && stageMode === 'error' ? ' is-error' : ''}${stageMode !== 'input' && !composerMorphOut ? ' agent-composer-docked' : ''}${composerMorphOut ? ' is-morph-out' : ''}`}
      data-testid="sales-agent-composer"
      data-morph-role="composer"
      aria-hidden={composerMorphOut}
    >
      {customerId ? (
        <div className="agent-scope-chip" data-testid="agent-scope-chip" role="status">
          <Building2 size={14} aria-hidden="true" />
          <span>{customerName || t('agent.currentCustomer')}</span>
          <button
            type="button"
            className="agent-scope-clear"
            aria-label="清除客户 Scope"
            onClick={() => {
              void ensureController().then(controller => {
                const next = controller.clearCustomerScope();
                applyState(next);
                onClearCustomer();
              });
            }}
          >
            <X size={12} />
          </button>
        </div>
      ) : genericPickerEnabled ? (
        <div className="agent-optional-picker">
          <button
            type="button"
            className="agent-scope-chip agent-scope-optional"
            data-testid="agent-optional-customer"
            onClick={() => setPickerOpen(open => !open)}
          >
            <Building2 size={14} aria-hidden="true" />
            <span>{t('agent.selectCustomerOptional')}</span>
          </button>
          {pickerOpen && customerCatalog && customerCatalog.length > 0 ? (
            <div className="agent-picker-menu" data-testid="agent-optional-customer-list">
              {customerCatalog.slice(0, 8).map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="agent-picker-item"
                  onClick={() => {
                    if (!isGenericOptionalCustomerPickerEnabled(stageMode, customerId)) return;
                    setPickerOpen(false);
                    onBindCustomer(item.id);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <textarea
        aria-label="Sales Agent message"
        value={message}
        disabled={sessionBusy}
        onFocus={() => { if (!sessionBusy && !voiceListening) setPhase('input-ready'); }}
        onBlur={() => { if (phase === 'input-ready') setPhase('idle'); }}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={t('agent.composer.placeholder')}
        rows={1}
      />
      <div className="agent-composer-tools">
        <button type="button" className="agent-icon-btn" aria-label="附件入口" title="打开 Capture" onClick={() => setCaptureOpen(true)}>
          <Paperclip size={17} />
        </button>
        <button type="button" className={`agent-icon-btn${voiceListening ? ' active' : ''}`} aria-label="麦克风" aria-pressed={voiceListening} onClick={toggleVoice}>
          <Mic size={17} />
        </button>
      </div>
      <button type="button" className="agent-send" onClick={() => void submit()} disabled={sessionBusy || !message.trim()} aria-label="Ask Sales Agent">
        <Sparkles size={17} />
      </button>
    </div>
  );

  return (
    <section className="agent-session agent-session-final" aria-label="Sales Agent interaction workspace">
      {import.meta.env.VITE_E2E_PROFILE === '1' ? (
        <div className="agent-runtime-mode-badge" data-testid="agent-e2e-profile" role="status">
          E2E Fake Transport / 测试配置（无真实 Provider 请求）
        </div>
      ) : null}
      <div
        className={`unified-agent-stage stage-${stageMode}`}
        data-testid="UNIFIED_AGENT_STAGE"
        data-stage-mode={stageMode}
        data-current-intent={interactionState?.current_intent ?? ''}
        data-envelope-id={interactionState?.intent_envelope?.envelope_id ?? ''}
        data-envelope-confidence={interactionState?.intent_envelope?.confidence ?? ''}
        data-envelope-parser-source={interactionState?.intent_envelope?.parser_source ?? ''}
        id="UNIFIED_AGENT_STAGE"
      >
        {activePrompt && stageMode !== 'input' ? (
          <div className="agent-prompt-summary" data-testid="agent-prompt-summary">
            <span>{activePrompt}</span>
          </div>
        ) : null}

        <div className={`agent-orb-slot${orbCompact ? ' is-compact' : ''}`} data-testid="agent-orb-slot">
          <SalesAgentGlassOrb state={orbState} compact={orbCompact} />
        </div>

        {stageMode === 'input' ? (
          <div className="agent-home-greeting" data-testid="agent-home-greeting">
            <h1>{t('agent.home.title')}</h1>
            <p>{t('agent.home.subtitle')}</p>
          </div>
        ) : null}

        {thinkingVisible ? (
          <div className="agent-thinking-panel" data-testid="agent-thinking-panel">
            <p className="agent-live-status" data-testid="agent-live-status">{mapUserExecutionState({ sessionBusy: true })}</p>
            <p className="agent-thinking-reason">{processSummary}</p>
            <button type="button" className="btn btn-sm" data-testid="agent-cancel-inflight" onClick={cancelInFlight}>
              {t('agent.cancel')}
            </button>
            <button
              type="button"
              className="agent-process-line"
              data-testid="agent-process-line"
              onClick={() => onProcessDrawerOpenChange?.(true)}
            >
              <span>查看分析过程</span>
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}

        {stageMode === 'portfolio' ? (
          <div className="agent-candidate-inline" data-testid="agent-portfolio-grid" aria-label="客户组合查询结果">
            <p className="agent-candidate-title" data-testid="agent-portfolio-title">
              {interactionState?.agent_message?.includes('共找到')
                ? interactionState.agent_message
                : `共找到 ${portfolioTotal} 家客户，当前展示 1–${candidates.length}`}
            </p>
            <p className="agent-candidate-note">这是客户组合查询结果，不是单客户选择。不会自动绑定；点击具体客户后才会绑定并继续。</p>
            <div className="agent-candidate-grid">
              {candidates.map(candidate => (
                <button key={candidate.id} type="button" className="agent-candidate-card" onClick={() => void pickCandidate(candidate)} disabled={sessionBusy}>
                  <strong>{candidate.name}</strong>
                  <span>{[candidate.region, candidate.industry, candidate.customer_grade ? tGrade(candidate.customer_grade) : ''].filter(Boolean).join(' · ') || t('agent.unspecifiedRegion')}</span>
                  <span>{t('agent.stage')}：{candidate.stage ? tStage(candidate.stage) : '—'} · {t('agent.lastContact')}：{candidate.last_contacted_at ? formatUserTimeLabel(candidate.last_contacted_at) : '—'}</span>
                  {interactionState?.latest_priority_ranking?.items.find(item => item.customer_id === candidate.id) ? <span data-testid={`priority-reasons-${candidate.id}`}>第 {interactionState.latest_priority_ranking.items.find(item => item.customer_id === candidate.id)?.rank} 名 · {candidate.match_score} 分 · {interactionState.latest_priority_ranking.items.find(item => item.customer_id === candidate.id)?.deterministic_reasons.slice(0, 3).join('；')}</span> : null}
                </button>
              ))}
            </div>
            {portfolioHasMore ? (
              <button type="button" className="btn btn-sm" data-testid="agent-portfolio-load-more" disabled={sessionBusy} onClick={() => void loadMorePortfolio()}>
                继续加载
              </button>
            ) : null}
          </div>
        ) : null}

        {stageMode === 'candidate' ? (
          <div className="agent-candidate-inline" data-testid="agent-candidate-grid" aria-label="客户候选">
            <p className="agent-candidate-title">{t('agent.candidatesTitle')}</p>
            {emptyExact && <p className="agent-candidate-note">{t('agent.candidatesEmptyExact')}</p>}
            <div className="agent-candidate-grid">
              {candidates.slice(0, 5).map(candidate => (
                <button key={candidate.id} type="button" className="agent-candidate-card" onClick={() => void pickCandidate(candidate)} disabled={sessionBusy}>
                  <strong>{candidate.name}</strong>
                  <span>{[candidate.region, candidate.industry, candidate.customer_grade ? tGrade(candidate.customer_grade) : ''].filter(Boolean).join(' · ') || t('agent.unspecifiedRegion')}</span>
                  <span>{t('agent.stage')}：{candidate.stage ? tStage(candidate.stage) : '—'} · {t('agent.lastContact')}：{candidate.last_contacted_at ? formatUserTimeLabel(candidate.last_contacted_at) : '—'}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-sm agent-candidate-cancel"
              data-testid="agent-candidate-cancel"
              onClick={cancelCandidateSelection}
              disabled={sessionBusy}
            >
              {t('agent.cancel')}
            </button>
          </div>
        ) : null}

        {stageMode === 'clarification' && clarification ? (
          <section className="agent-clarify-inline" aria-label="写入澄清" data-testid="agent-clarification-card">
            <h3>{t('agent.clarification.title')}</h3>
            <p className="agent-clarify-question">{clarification.question}</p>
            <p className="agent-clarify-pending">{t('agent.clarification.pending')}：{clarification.original_instruction}</p>
            <p className="agent-clarify-scope">{t('agent.clarification.customer')}：{customerName || clarification.customer_id}</p>
            {Object.keys(clarification.parsed_fields).length > 0 ? (
              <p className="agent-clarify-parsed">{t('agent.clarification.parsed')}：{formatProposalValues(clarification.parsed_fields as Record<string, unknown>)}</p>
            ) : null}
            <div className="agent-clarify-actions">
              {clarification.quick_replies.map(reply => (
                <button
                  key={reply.value}
                  type="button"
                  className="btn btn-sm"
                  disabled={sessionBusy}
                  onClick={() => answerClarification(reply.value)}
                >
                  {reply.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {stageMode === 'clarification' && !clarification && interactionState?.resolution_reason ? (
          <section className="agent-clarify-inline" aria-label="意图澄清" data-testid="agent-clarification-card">
            <h3>需要明确意图</h3>
            <p className="agent-clarify-question">{interactionState.resolution_reason}</p>
          </section>
        ) : null}

        {stageMode === 'result' && directAnswer ? (
          <div className="agent-result-stage" data-testid="agent-result-card" aria-label="Sales Agent result">
            <p className="agent-result-headline">{directAnswer.headline}</p>
            <p className="agent-result-reason" style={{ whiteSpace: 'pre-wrap' }}>{directAnswer.message}</p>
          </div>
        ) : null}

        {stageMode === 'result' && projected && !directAnswer ? (
          <div className="agent-result-stage" data-testid="agent-result-card" data-current-intent={result?.plan.intent ?? ''} aria-label="Sales Agent result">
            <p className="agent-result-headline">{projected.headline}</p>
            <div className="agent-result-actions">
              {projected.nextSteps.slice(0, 3).map(step => (
                <button key={step.label} type="button" className="btn btn-sm" onClick={() => void submit(step.label)}>
                  {step.label}
                </button>
              ))}
              {customerId ? (
                <button type="button" className="btn btn-sm" onClick={() => onOpenContextDrawer?.()}>查看详情</button>
              ) : null}
            </div>
            <button type="button" className="agent-link-btn" data-testid="agent-expand-analysis" onClick={() => setAnalysisExpanded(open => !open)}>
              {analysisExpanded ? '收起完整分析' : '展开完整分析'}
            </button>
            {analysisExpanded ? (
              <>
                <header className="agent-result-header">
                  <div className="agent-result-title-row">
                    <SalesAgentGlassOrb state={orbState} compact />
                    <div>
                      <h3>完整分析</h3>
                      <p>依据最新数据</p>
                    </div>
                  </div>
                  {result?.runtime_details ? (
                    <button
                      type="button"
                      className="agent-runtime-mode-badge"
                      data-testid="agent-runtime-mode-badge"
                      data-runtime-mode={result.runtime_details.runtime_mode}
                      onClick={() => setRuntimeDetailsOpen(open => !open)}
                    >
                      {import.meta.env.VITE_E2E_PROFILE === '1'
                        ? 'E2E Fake Transport / 测试配置'
                        : result.runtime_details.ui_label}
                    </button>
                  ) : null}
                </header>
                {runtimeDetailsOpen && result?.runtime_details ? (
                  <div className="agent-runtime-details" data-testid="agent-runtime-details">
                    <p>运行模式：{result.runtime_details.runtime_mode}</p>
                    <p>Provider：{result.runtime_details.provider ?? '无'}</p>
                    <p>Model：{result.runtime_details.model ?? '无'}</p>
                    <p>是否调用模型：{result.runtime_details.model_called ? '是' : '否'}</p>
                    <p>request_id：{result.runtime_details.request_id}</p>
                    <p>latency：{result.runtime_details.latency_ms == null ? '—' : `${result.runtime_details.latency_ms} ms`}</p>
                    <p>token usage：{result.runtime_details.token_usage?.total_tokens ?? '—'}</p>
                    <p>工具：{result.runtime_details.tools_used.join(' → ') || '无'}</p>
                    <p>Evidence 数量：{result.runtime_details.evidence_count}</p>
                    <p>是否降级：{result.runtime_details.degraded ? '是' : '否'}</p>
                    <p>降级原因：{result.runtime_details.degradation_reason ?? '无'}</p>
                    <p>输出验证：{result.runtime_details.validation_status}</p>
                    <p>Schema validation：{result.runtime_details.schema_validation_status}</p>
                    <p>Evidence validation：{result.runtime_details.evidence_validation_status}</p>
                    <p>Cancellation status：{result.runtime_details.cancellation_status}</p>
                  </div>
                ) : null}
                {result?.blocked_message ? (
                  <p className="agent-model-unavailable" data-testid="agent-model-unavailable" role="status">{result.blocked_message}</p>
                ) : null}
                <div className="agent-insight-grid">
                  {projected.sections.map(section => (
                    <article key={section.title} className="agent-insight-card">
                      <h4>{section.title}</h4>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{section.body}</p>
                    </article>
                  ))}
                </div>
                <button
                  type="button"
                  className="agent-process-line"
                  data-testid="agent-process-line"
                  onClick={() => onProcessDrawerOpenChange?.(true)}
                >
                  <span>依据 {result?.evidence_refs.length ?? 0} 条 · 查看分析过程</span>
                  <ChevronRight size={16} />
                </button>
              </>
            ) : (
              <button type="button" className="agent-link-btn" onClick={() => onOpenContextDrawer?.()}>
                依据 {result?.evidence_refs.length ?? 0} 条
              </button>
            )}
          </div>
        ) : null}

        {stageMode === 'proposal' && proposal ? (() => {
          const projection = projectConfirmationCard(proposal);
          return (
          <section
            className={`agent-confirm-card agent-confirm-inline${projection.strength === 'strong' ? ' is-strong' : ''}`}
            aria-label="Exact CRM confirmation"
            data-testid="agent-confirm-card"
            data-confirm-strength={projection.strength}
          >
            <p className="agent-execution-state">{mapUserExecutionState({ awaitingConfirmation: true })}</p>
            <h3 className="agent-confirm-title">{projection.title}</h3>
            {projection.headline ? <p className="agent-confirm-headline">{projection.headline}</p> : null}
            {projection.summary_lines.map(line => (
              <p key={line}>{line}</p>
            ))}
            {customerName
              && proposal.tool_id !== 'create_customer'
              && !projection.summary_lines.some(line => line.startsWith(`${t('common.customer')}：`))
              ? <p>{t('common.customer')}：{customerName}</p>
              : null}
            {projection.footnote ? <p className="agent-confirm-note">{projection.footnote}</p> : null}
            {projection.destructive_note ? (
              <p className="agent-confirm-strong-note">{projection.destructive_note}</p>
            ) : null}
            {proposal.grouped_operations ? (
              <div className="agent-grouped-operations" data-testid="agent-grouped-proposal">
                <p>本次明确包含以下子操作；可在确认前取消其中一项：</p>
                {proposal.grouped_operations.map(item => (
                  <article key={item.operation_id} data-testid={`agent-grouped-operation-${item.operation_id}`}>
                    <strong>{item.label}</strong>
                    <p>{formatProposalValues(item.proposed_values as Record<string, unknown>)}</p>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => toggleGroupedOperation(item.operation_id, !item.selected)}
                    >
                      {item.selected ? '取消此子操作' : '恢复此子操作'}
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            {confirmExpanded ? (() => {
              const technical = projectConfirmationTechnicalDetails(proposal);
              return (
              <div className="agent-confirm-technical" data-testid="agent-confirm-technical">
                <p className="agent-confirm-technical-heading">{technical.heading}</p>
                {technical.lines.map(line => (
                  <p key={line}>{line}</p>
                ))}
                <button type="button" className="agent-link-btn" onClick={() => setConfirmExpanded(false)}>{t('technicalDetails.hide')}</button>
              </div>
              );
            })() : (
              <button type="button" className="agent-link-btn" onClick={() => setConfirmExpanded(true)}>{t('technicalDetails.show')}</button>
            )}
            <div className="agent-confirm-actions">
              <button type="button" className="btn" onClick={cancelProposal}>{projection.cancel_label}</button>
              <button type="button" className={`btn ${projection.strength === 'strong' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void confirm()}>{confirmButtonLabel(proposal)}</button>
            </div>
          </section>
          );
        })() : null}

        {writeResult ? (
          <div className="agent-success" role="status" data-testid="agent-write-success" data-current-intent={proposalIntent(lastConfirmedProposal)} data-refresh-count={refreshCount}>
            <p className="agent-execution-state">{mapUserExecutionState({ completed: true })}</p>
            <pre>{writeResult}</pre>
            {import.meta.env.VITE_E2E_PROFILE === '1' && lastConfirmedProposal ? (
              <>
                <button type="button" className="agent-link-btn" data-testid="agent-replay-confirmation" onClick={() => void replayLastConfirmation()}>重放上次确认（应被拒绝）</button>
                {replayResult ? <p data-testid="agent-replay-result">{replayResult}</p> : null}
              </>
            ) : null}
            {customerId ? (
              <button type="button" className="agent-link-btn" onClick={() => onOpenContextDrawer?.()}>查看客户详情</button>
            ) : null}
            <button type="button" className="agent-link-btn" onClick={() => { setWriteResult(''); setPhase('idle'); }}>{t('agent.success.continue')}</button>
          </div>
        ) : null}

        {stageMode === 'error' ? (
          <div className="agent-error-inline" data-testid="agent-error" role="alert">
            <p className="agent-execution-state">{mapUserExecutionState({ failed: true })}</p>
            <p style={{ whiteSpace: 'pre-line' }}>{explainUnchangedCrmError(typeof error === 'string' ? error : formatUserFacingErrorMessage(error))}</p>
            <button type="button" className="btn btn-sm" onClick={() => { setError(''); setPhase('idle'); }}>{t('agent.failure.retry')}</button>
          </div>
        ) : null}

        {composer}

        <div className={`agent-quick-grid${showQuickActions ? '' : ' is-morph-out'}`} aria-label="快捷动作" data-testid="agent-quick-grid">
          {AGENT_HOME_QUICK_ACTIONS.map(action => (
            <button key={action.id} type="button" className="agent-quick-card" onClick={() => runQuickAction(action)} disabled={sessionBusy || !showQuickActions}>
              {action.id === 'summary' ? <FileText size={14} aria-hidden="true" /> : action.id === 'interactions' ? <Inbox size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
              <strong>{action.id === 'summary' ? t('quick.summary') : action.id === 'interactions' ? t('quick.interactions') : t('quick.followUp')}</strong>
            </button>
          ))}
        </div>

        <div className="agent-stage-utility">
          <button type="button" className="agent-link-btn" data-testid="agent-history-open" onClick={() => setHistoryOpen(true)}>{t('agent.history')}</button>
          {customerId ? (
            <button type="button" className="agent-link-btn" onClick={() => onOpenContextDrawer?.()}>上下文</button>
          ) : null}
        </div>
      </div>

      {historyOpen && (
        <aside className="agent-drawer agent-drawer-history" data-testid="agent-history-drawer" aria-label={t('agent.history')}>
          <header>
            <h3>{t('agent.history')}</h3>
            <button type="button" className="agent-icon-btn" aria-label={t('agent.historyClose')} onClick={() => setHistoryOpen(false)}><X size={16} /></button>
          </header>
          {history.length === 0 ? <p>{t('agent.historyEmpty')}</p> : (
            <ul className="agent-history-list">
              {history.map(item => (
                <li key={item.id}>
                  <strong>{item.question}</strong>
                  <p>{item.summary}</p>
                  <small>{item.at} · {item.status}</small>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {processExpanded && (
        <aside className="agent-drawer agent-drawer-process" data-testid="agent-process-drawer" aria-label="分析过程">
          <header>
            <h3>分析过程</h3>
            <button type="button" className="agent-icon-btn" aria-label="关闭分析过程" onClick={() => onProcessDrawerOpenChange?.(false)}><X size={16} /></button>
          </header>
          <ol className="agent-trace-list">
            {workSteps.map(step => (
              <li key={step.id} className={step.status}>
                {step.status === 'done' ? <Check size={14} /> : <span className="trace-index">•</span>}
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </div>
              </li>
            ))}
          </ol>
          {result ? (
            <div className="agent-trace-extra">
              <p>{describeReasoningWork(result.plan.intent)}</p>
              <p>{describeReadWork(result.tool_trace.map(item => item.tool_id)) || '已读取相关资料'}</p>
              <p>依据 {result.evidence_refs.length} 条已核实记录</p>
            </div>
          ) : null}
          {interactionState?.latest_search ? (
            <p className="agent-search-meta">已找到 {interactionState.latest_search.candidates.length} 家客户（只读）</p>
          ) : null}
        </aside>
      )}

      {captureOpen && (
        <div className="agent-modal-backdrop" role="presentation" onClick={() => setCaptureOpen(false)}>
          <div className="agent-capture-modal" role="dialog" aria-modal="true" aria-label="Capture" data-testid="agent-capture-modal" data-current-intent="CAPTURE_REVIEW" onClick={event => event.stopPropagation()}>
            <header>
              <h3>采集材料</h3>
              <button type="button" className="agent-icon-btn" aria-label="关闭 Capture" onClick={() => setCaptureOpen(false)}><X size={16} /></button>
            </header>
            <p className="agent-capture-hint">粘贴文本或选择图片；选择或粘贴本身不会自动 Analyze，审核后也不会自动写 CRM。</p>
            <textarea aria-label="Capture text" value={captureText} onChange={event => setCaptureText(event.target.value)} placeholder="粘贴会议纪要或客户原话…" rows={5} />
            <div className="agent-capture-actions">
              <button type="button" className="agent-capture-action" onClick={() => void analyzeCapture('text', captureText)} disabled={sessionBusy || !captureText.trim()}>
                <FileText size={15} /> Analyze
              </button>
              <label className="agent-image-picker">
                <Image size={15} /> 选择图片
                <input aria-label="Capture image" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void selectImage(event.target.files?.[0])} />
              </label>
              {sessionBusy ? <button type="button" className="btn btn-sm" data-testid="capture-cancel-inflight" onClick={cancelInFlight}>Cancel Analyze</button> : null}
            </div>
            {imagePreview && (
              <div className="agent-image-preview">
                <img src={imagePreview} alt="Selected customer capture" />
                <div className="agent-capture-actions">
                  <button type="button" className="agent-capture-action" onClick={() => void analyzeCapture('image', imagePreview)} disabled={sessionBusy}>Analyze image</button>
                  <button type="button" className="btn btn-sm" onClick={() => setImagePreview('')}>删除</button>
                  <label className="btn btn-sm">
                    替换
                    <input className="sr-only" aria-label="Replace capture image" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void selectImage(event.target.files?.[0])} />
                  </label>
                </div>
              </div>
            )}
            {captureReview && (
              <section aria-label="Capture fact review">
                {captureReview.runtime_metadata ? <CaptureRuntimeMetadata details={captureReview.runtime_metadata} /> : null}
                <h4>Candidate 状态 · 核对提取事实</h4>
                {captureReview.facts.map(fact => (
                  <article className="agent-fact" key={fact.fact_id}>
                    <strong>{fact.fact_type}</strong>
                    <p>{fact.reviewed_content}</p>
                    <small>{fact.confidence} · {fact.source_reference}</small>
                    <div className="agent-capture-actions">
                      {fact.fact_type !== 'manual_review_required' ? (
                        <button type="button" className="btn btn-sm" onClick={() => setCaptureReview(setFactReview(captureReview, fact.fact_id, 'accepted'))}>Accept</button>
                      ) : null}
                      <button type="button" className="btn btn-sm" onClick={() => setCaptureReview(setFactReview(captureReview, fact.fact_id, 'rejected'))}>Reject</button>
                    </div>
                    <input aria-label={`Edit ${fact.fact_id}`} value={editing[fact.fact_id] ?? fact.reviewed_content} onChange={event => setEditing({ ...editing, [fact.fact_id]: event.target.value })} />
                    <button type="button" className="btn btn-sm" onClick={() => setCaptureReview(editFact(captureReview, fact.fact_id, editing[fact.fact_id] ?? fact.reviewed_content))}>Save Edit</button>
                  </article>
                ))}
                <p className="agent-review-count">已人工复核 {reviewedFacts(captureReview).length} 项</p>
                <button type="button" className="agent-capture-action" onClick={() => void analyzeReviewed()} disabled={reviewedFacts(captureReview).length === 0}>Analyze reviewed facts</button>
                <button
                  type="button"
                  className="agent-capture-action"
                  onClick={() => {
                    if (!sessionRef.current) return;
                    void sessionRef.current.createProposalFromReviewedFacts(captureReview).then(next => {
                      setProposal(next);
                      setCaptureOpen(false);
                    }).catch(cause => {
                      setError(formatUserFacingErrorMessage(cause));
                      setPhase('blocked');
                    });
                  }}
                  disabled={reviewedFacts(captureReview).length === 0}
                >
                  Create Proposal
                </button>
              </section>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
