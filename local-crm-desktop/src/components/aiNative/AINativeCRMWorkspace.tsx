import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { ReadOnlyAISuggestionPanel } from '../aiSuggestions/ReadOnlyAISuggestionPanel';
import { Stage2ArchitectureStatus } from './Stage2ArchitectureStatus';
import { SalesCopilotPanel } from './SalesCopilotPanel';
import { getDb, getCustomer, listCustomers } from '../../lib/db';
import type { Customer } from '../../lib/types';
import { getActiveVerticalProfile } from '../../lib/verticalProfiles';
import { buildWorkspaceContextSnapshot } from '../../lib/context/workspaceContextAdapter';
import { listVerticalAIProfiles, resolveVerticalAIProfile } from '../../lib/verticalAIProfiles/registry';
import {
  buildReadOnlySnapshotLoaderPlan,
  loadReadOnlySnapshotFromDb,
  type LoadedReadOnlyAgentSnapshot,
  type ReadOnlySnapshotLoaderSafety,
} from '../../lib/readOnlySnapshotLoaderReadiness';
import {
  AI_NATIVE_CRM_WORKSPACE_VERSION,
  buildCustomerCatalogRequest,
  buildSelectedCRMContextRequest,
  isStrictReadOnlyWorkspaceSafety,
  projectCRMContextSummary,
} from '../../lib/aiNativeCRMWorkspaceReadiness';
import {
  runReadOnlySnapshotAISuggestionService,
  type ReadOnlyAISuggestionServiceResponse,
} from '../../lib/readOnlyAISuggestionServiceReadiness';
import { createMockReasoningProvider } from '../../lib/salesAgent/provider';
import { createAgentTriggerBoundary } from '../../lib/salesAgent/triggerSeam';
import { runSalesCopilotWorkflow } from '../../lib/salesCopilot/workflow';
import type { SalesCopilotWorkflowResult } from '../../lib/salesCopilot/types';
import { buildBoundedWorkspaceSalesPriority, MAX_WORKSPACE_PRIORITY_CANDIDATES } from '../../lib/salesCopilot/workspacePriority';
import { LIVE_REASONING_AUTHORIZATION_PHRASE } from '../../lib/liveReasoning/types';
import { createTrustedHostLiveReasoningProvider } from '../../lib/liveReasoning/provider';
import { authorizeTrustedHostCapability } from '../../lib/modelCapabilities/trustedHost';
import { readCustomerScopedSalesAgentEntry } from '../../lib/salesWorkspace/customerScopedSalesAgentEntry';
import { SalesAgentInteractionWorkspace } from './SalesAgentInteractionWorkspace';
import { SALES_AGENT_APP_CLOCK } from '../../lib/salesAgentTools/appClock';
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository, type CustomerMemoryContext } from '../../lib/customerMemory';
import { createTrustedHostSalesAgentAdapter } from '../../lib/salesAgentTools/trustedHostAdapter';
import { createSalesAgentMemoryRepository } from '../../lib/salesAgentTools/memoryRepositoryAdapter';
import { createProductionRefreshCoordinator } from '../../lib/salesAgentTools/productionRefreshCoordinator';
import type { SearchableCustomer } from '../../lib/salesAgentTools/searchCustomers';
import {
  buildDailyFocusItems,
  dismissDailyFocusForToday,
  shouldAutoOpenDailyFocus,
  type DailyFocusItem,
} from '../../lib/salesAgentUi/dailyFocus';
import { formatUserFacingErrorMessage } from '../../lib/salesAgentUi/formatUserFacingError';

const profile = getActiveVerticalProfile();
const stage2Profile = resolveVerticalAIProfile();

function formatTimestamp(value: string): string {
  return SALES_AGENT_APP_CLOCK.formatUserTime(value);
}

function toSearchable(customers: readonly Customer[]): SearchableCustomer[] {
  return customers.map(customer => ({
    id: customer.id,
    name: customer.name,
    region: customer.region,
    industry: customer.industry,
    stage: customer.stage,
    customer_grade: customer.customer_grade,
    intent_level: customer.intent_level,
    last_contacted_at: customer.last_contacted_at,
    next_follow_up_at: customer.next_follow_up_at,
    updated_at: customer.updated_at,
  }));
}

export default function AINativeCRMWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [customerDirectory, setCustomerDirectory] = useState<readonly Customer[]>([]);
  const [snapshot, setSnapshot] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [agentMemory, setAgentMemory] = useState<CustomerMemoryContext | undefined>(undefined);
  const [safety, setSafety] = useState<ReadOnlySnapshotLoaderSafety | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [suggestionResponse, setSuggestionResponse] = useState<ReadOnlyAISuggestionServiceResponse | null>(null);
  const [copilotResults, setCopilotResults] = useState<readonly SalesCopilotWorkflowResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [liveWorkflow, setLiveWorkflow] = useState<'customer_intelligence' | 'interaction_intelligence'>('customer_intelligence');
  const [liveProfileId, setLiveProfileId] = useState(stage2Profile.identity.id);
  const [liveAuthorizationConfirmed, setLiveAuthorizationConfirmed] = useState(false);
  const [liveAuthorizationPhrase, setLiveAuthorizationPhrase] = useState('');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'authorization incomplete' | 'request pending' | 'completed and validated' | 'blocked' | 'timeout' | 'provider error' | 'invalid model output'>('idle');
  const [controlledOpen, setControlledOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [processDrawerOpen, setProcessDrawerOpen] = useState(false);
  const [dailyFocusOpen, setDailyFocusOpen] = useState(false);
  const [dailyFocusItems, setDailyFocusItems] = useState<readonly DailyFocusItem[]>([]);
  const [seedInstruction, setSeedInstruction] = useState<string | null>(null);
  const customerScopedEntry = readCustomerScopedSalesAgentEntry(location.state);
  const autoLoadedCustomer = useRef('');
  const dailyFocusInit = useRef(false);
  const newConversationHandlerRef = useRef<(() => void) | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const now = SALES_AGENT_APP_CLOCK.now();
      const plan = buildReadOnlySnapshotLoaderPlan(buildCustomerCatalogRequest(profile.key, now));
      const result = await loadReadOnlySnapshotFromDb(await getDb(), plan);
      if (!isStrictReadOnlyWorkspaceSafety(result.safety)) {
        throw new Error('只读安全契约未通过，工作区已停止加载。');
      }
      setCatalog(result.snapshot);
      setSafety(result.safety);
      try {
        setCustomerDirectory(await listCustomers());
      } catch {
        setCustomerDirectory([]);
      }
      setError('');
    } catch (cause) {
      setCatalog(prev => prev ?? { customers: [] } as unknown as LoadedReadOnlyAgentSnapshot);
      setError(formatUserFacingErrorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (customerScopedEntry) setSelectedCustomerId(customerScopedEntry.customer_id);
  }, [customerScopedEntry]);

  const searchableCustomers = useMemo(() => toSearchable(customerDirectory), [customerDirectory]);

  useEffect(() => {
    if (customerDirectory.length === 0 || dailyFocusInit.current) return;
    dailyFocusInit.current = true;
    const items = buildDailyFocusItems(searchableCustomers, SALES_AGENT_APP_CLOCK.now());
    setDailyFocusItems(items);
    if (items.length > 0 && shouldAutoOpenDailyFocus()) {
      setDailyFocusOpen(true);
    }
  }, [customerDirectory, searchableCustomers]);

  const loadSelectedContext = useCallback(async (options: { readonly runCopilot?: boolean } = {}) => {
    if (!selectedCustomerId) return;
    setLoading(true);
    setError('');
    setSnapshot(null);
    setAgentMemory(undefined);
    setSuggestionResponse(null);
    setCopilotResults([]);
    try {
      const now = SALES_AGENT_APP_CLOCK.now();
      const plan = buildReadOnlySnapshotLoaderPlan(
        buildSelectedCRMContextRequest(profile.key, selectedCustomerId, now),
      );
      const result = await loadReadOnlySnapshotFromDb(await getDb(), plan);
      if (!isStrictReadOnlyWorkspaceSafety(result.safety)) {
        throw new Error('只读安全契约未通过，工作区已停止加载。');
      }
      setSnapshot(result.snapshot);
      setAgentMemory(await new SqliteMemoryRepository(await getDb(), new SqliteCrmEvidenceResolver(await getDb())).getMemoryContext(selectedCustomerId));
      setSafety(result.safety);
      setSuggestionResponse(runReadOnlySnapshotAISuggestionService({
        kind: 'READ_ONLY_SNAPSHOT_AI_SUGGESTION_SERVICE_REQUEST',
        version: 'v1',
        request_id: `${result.snapshot.snapshot_id}:workspace-suggestions`,
        loaded_snapshot: result.snapshot,
        intent: 'evidence_for_customer',
        context: result.snapshot.context,
        target_customer_id: selectedCustomerId,
        service_read_only: true,
        caller_provided_only: true,
        source_reference_only: true,
        allow_network: false,
        allow_model_call: false,
        allow_env_read: false,
        allow_db: false,
        allow_runner: false,
        allow_execution: false,
        allow_review_queue_entry: false,
        allow_confirmed_action: false,
        allow_human_confirmation: false,
        allow_write_plan_entry: false,
        allow_database_write: false,
        allow_task_create: false,
        allow_followup_create: false,
        allow_customer_status_change: false,
        allow_ui: false,
      }));
      const context = buildWorkspaceContextSnapshot(result.snapshot);
      if (options.runCopilot === true) {
        const provider = createMockReasoningProvider();
        const customerIntelligence = await runSalesCopilotWorkflow({
          kind: 'customer_intelligence', request_id: `${result.snapshot.snapshot_id}:customer-intelligence`, context,
          profile_id: stage2Profile.identity.id, provider,
        });
        setCopilotResults(current => [customerIntelligence, ...current.filter(item => item.kind === 'sales_priority')]);
      }
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId || !catalog) return;
    if (autoLoadedCustomer.current === selectedCustomerId) return;
    autoLoadedCustomer.current = selectedCustomerId;
    void loadSelectedContext({ runCopilot: false });
  }, [catalog, loadSelectedContext, selectedCustomerId]);

  const reviewLatestInteraction = async () => {
    if (!stage2Context || stage2Context.recentInteractions.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const interaction = stage2Context.recentInteractions[0];
      const occurredAt = interaction.occurredAt;
      const trigger = createAgentTriggerBoundary({
        kind: 'InteractionAddedEvent',
        event_id: `workspace:${interaction.interactionId}`,
        occurred_at: occurredAt,
        customer_id: selectedCustomerId,
        interaction_id: interaction.interactionId,
      });
      const interactionIntelligence = await runSalesCopilotWorkflow({
        kind: 'interaction_intelligence',
        request_id: `${stage2Context.snapshotId}:interaction-intelligence`,
        context: stage2Context,
        trigger,
        explicitly_activated: true,
        profile_id: stage2Profile.identity.id,
        provider: createMockReasoningProvider(),
      });
      setCopilotResults(current => [...current.filter(item => item.kind !== 'interaction_intelligence'), interactionIntelligence]);
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const loadSalesPriority = async () => {
    const customerIds = (catalog?.customers ?? []).map(customer => customer.id);
    if (customerIds.length < 2) return;
    setLoading(true);
    setError('');
    try {
      const db = await getDb();
      const priority = await buildBoundedWorkspaceSalesPriority({
        request_id: `workspace-priority:${SALES_AGENT_APP_CLOCK.now()}`,
        customer_ids: customerIds,
        profile_id: stage2Profile.identity.id,
        provider: createMockReasoningProvider(),
        load_read_only_context: async customerId => {
          const now = SALES_AGENT_APP_CLOCK.now();
          const plan = buildReadOnlySnapshotLoaderPlan(buildSelectedCRMContextRequest(profile.key, customerId, now));
          const loaded = await loadReadOnlySnapshotFromDb(db, plan);
          if (!isStrictReadOnlyWorkspaceSafety(loaded.safety)) throw new Error('Priority candidate failed the read-only safety contract.');
          return buildWorkspaceContextSnapshot(loaded.snapshot);
        },
      });
      setCopilotResults(current => [...current.filter(item => item.kind !== 'sales_priority'), priority]);
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const runOneLiveReasoning = async () => {
    if (!stage2Context || !selectedCustomerId || !liveAuthorizationConfirmed || liveAuthorizationPhrase !== LIVE_REASONING_AUTHORIZATION_PHRASE) {
      setLiveStatus('authorization incomplete');
      return;
    }
    setLoading(true); setError(''); setLiveStatus('request pending');
    try {
      const binding = {
        capability: 'TEXT_REASONING' as const,
        providerKind: 'DEEPSEEK_COMPATIBLE' as const,
        modelId: 'deepseek-chat',
        customerId: selectedCustomerId,
        contextSnapshotId: stage2Context.snapshotId,
        workflowKind: liveWorkflow,
        profileId: liveProfileId,
        requestedByUser: true as const,
      };
      const authorization = await authorizeTrustedHostCapability(binding);
      const provider = createTrustedHostLiveReasoningProvider({ authorization, binding });
      const activation = { live_call_requested: true as const, user_explicitly_authorized: true as const, authorization_phrase: LIVE_REASONING_AUTHORIZATION_PHRASE, provider_kind: provider.capability.providerKind as 'OPENAI_COMPATIBLE' | 'DEEPSEEK_COMPATIBLE', capability: 'TEXT_REASONING' as const, model_id: provider.capability.modelIdentifier, profile_id: liveProfileId, workflow_kind: liveWorkflow, customer_id: selectedCustomerId, context_snapshot_id: stage2Context.snapshotId };
      const requestId = `${stage2Context.snapshotId}:live:${liveWorkflow}:${SALES_AGENT_APP_CLOCK.now()}`;
      const result = liveWorkflow === 'customer_intelligence'
        ? await runSalesCopilotWorkflow({ kind: 'customer_intelligence', request_id: requestId, context: stage2Context, profile_id: liveProfileId, provider, live_activation: activation })
        : await runSalesCopilotWorkflow({ kind: 'interaction_intelligence', request_id: requestId, context: stage2Context, trigger: createAgentTriggerBoundary({ kind: 'InteractionAddedEvent', event_id: `workspace:${stage2Context.recentInteractions[0]?.interactionId ?? 'missing'}`, occurred_at: stage2Context.recentInteractions[0]?.occurredAt ?? SALES_AGENT_APP_CLOCK.now(), customer_id: selectedCustomerId, interaction_id: stage2Context.recentInteractions[0]?.interactionId ?? 'missing' }), explicitly_activated: true, profile_id: liveProfileId, provider, live_activation: activation });
      setCopilotResults(current => [...current.filter(item => item.kind !== result.kind), result]);
      setLiveStatus('completed and validated');
    } catch (cause) {
      const message = formatUserFacingErrorMessage(cause);
      setError(message);
      setLiveStatus(message.includes('timed out') ? 'timeout' : message.includes('invalid structured') ? 'invalid model output' : 'provider error');
    } finally { setLoading(false); }
  };

  const selectedCustomer = customerDirectory.find(item => item.id === selectedCustomerId)
    ?? snapshot?.customers[0]
    ?? catalog?.customers.find(item => item.id === selectedCustomerId)
    ?? null;
  const summary = snapshot
    ? projectCRMContextSummary(snapshot, selectedCustomerId, SALES_AGENT_APP_CLOCK.now())
    : null;
  const stage2Context = snapshot ? buildWorkspaceContextSnapshot(snapshot) : null;
  const salesAgentHost = useMemo(() => stage2Context ? createTrustedHostSalesAgentAdapter({ context_snapshot_id: stage2Context.snapshotId, profile_id: stage2Profile.identity.id }) : null, [stage2Context]);
  const salesAgentMemoryRepository = useMemo(() => snapshot ? createSalesAgentMemoryRepository() : undefined, [snapshot]);
  const customerName = selectedCustomer?.name ?? (customerScopedEntry ? '已带入客户' : '');

  const clearCustomer = () => {
    setSelectedCustomerId('');
    setSnapshot(null);
    setAgentMemory(undefined);
    setSuggestionResponse(null);
    setCopilotResults([]);
    autoLoadedCustomer.current = '';
  };

  const bindCustomer = (customerId: string) => {
    if (customerId === selectedCustomerId) {
      autoLoadedCustomer.current = '';
    }
    setSelectedCustomerId(customerId);
    setSnapshot(null);
    setAgentMemory(undefined);
    setSuggestionResponse(null);
    setCopilotResults([]);
    autoLoadedCustomer.current = '';
  };

  const closeDailyFocus = () => {
    dismissDailyFocusForToday();
    setDailyFocusOpen(false);
  };

  const handToAgent = (item: DailyFocusItem) => {
    setDailyFocusOpen(false);
    dismissDailyFocusForToday();
    bindCustomer(item.customer_id);
    setSeedInstruction(`总结客户现状并分析风险与机会：${item.customer_name}`);
  };

  const viewCustomer = (item: DailyFocusItem) => {
    navigate(`/customers/${item.customer_id}`);
  };

  return (
    <div className="agent-shell product-page">
      <div className="agent-topbar agent-topbar-minimal">
        <div className="agent-top-actions">
          <button type="button" className="btn btn-sm agent-daily-focus-btn" data-testid="daily-focus-reopen" onClick={() => setDailyFocusOpen(true)}>
            <Sparkles size={14} aria-hidden="true" />
            今日重点
          </button>
          <button type="button" className="btn btn-sm" onClick={() => newConversationHandlerRef.current?.()}>新对话</button>
          <button type="button" className="btn btn-sm" data-testid="controlled-mode-toggle" onClick={() => setControlledOpen(open => !open)}>受控模式</button>
        </div>
      </div>

      {controlledOpen && (
        <div className="agent-controlled-panel" data-testid="controlled-mode-panel" aria-label="受控模式">
          <span className="status-pill info">当前 Mock / Trusted Host</span>
          <span className="status-pill">只读上下文</span>
          <span className="status-pill warn">写入需人工确认</span>
          <span className="status-pill ok"><ShieldCheck size={14} /> 不自动执行</span>
          <span className="status-pill ok">当前仅只读</span>
        </div>
      )}

      <div className="agent-stage agent-stage-final">
        <SalesAgentInteractionWorkspace
          customerId={selectedCustomerId}
          customerName={customerName}
          onBindCustomer={bindCustomer}
          onClearCustomer={clearCustomer}
          snapshot={snapshot}
          context={stage2Context}
          memory={agentMemory}
          profileId={stage2Profile.identity.id}
          host={salesAgentHost}
          memoryRepository={salesAgentMemoryRepository}
          loadCustomerSnapshot={getCustomer}
          onRefresh={createProductionRefreshCoordinator(() => loadSelectedContext({ runCopilot: false }))}
          contextLoading={loading}
          onOpenContextDrawer={() => setContextDrawerOpen(true)}
          processDrawerOpen={processDrawerOpen}
          onProcessDrawerOpenChange={setProcessDrawerOpen}
          seedInstruction={seedInstruction}
          onSeedInstructionConsumed={() => setSeedInstruction(null)}
          onRegisterNewConversation={handler => { newConversationHandlerRef.current = handler; }}
        />
      </div>

      {contextDrawerOpen && (
        <aside className="agent-drawer agent-drawer-context" data-testid="agent-context-drawer" aria-label="上下文">
          <header>
            <h3>上下文</h3>
            <button type="button" className="agent-icon-btn" aria-label="关闭上下文" onClick={() => setContextDrawerOpen(false)}><X size={16} /></button>
          </header>
          <section>
            <h4>当前客户</h4>
            <p>{customerName || '未绑定'}</p>
          </section>
          <section>
            <h4>客户摘要</h4>
            <p>阶段 {(selectedCustomer as { stage?: string } | null)?.stage ?? '—'} · 等级 {(selectedCustomer as { customer_grade?: string } | null)?.customer_grade ?? '—'} · 意向 {(selectedCustomer as { intent_level?: string } | null)?.intent_level ?? '—'}</p>
          </section>
          <section>
            <h4>ACTIVE Memory</h4>
            <p>{agentMemory?.items.length ?? 0} 条</p>
          </section>
          <section>
            <h4>Timeline / Evidence</h4>
            <p>{stage2Context?.recentInteractions.length ?? 0} 条近期互动</p>
          </section>
          <section>
            <h4>已上传 Capture</h4>
            <p>通过附件入口查看与复核。</p>
          </section>
        </aside>
      )}

      {dailyFocusOpen && (
        <div className="agent-modal-backdrop" role="presentation" onClick={closeDailyFocus}>
          <div className="agent-daily-focus-modal" role="dialog" aria-modal="true" aria-label="今日值得关注" data-testid="daily-focus-modal" onClick={event => event.stopPropagation()}>
            <header>
              <h3>今日值得关注</h3>
              <button type="button" className="agent-icon-btn" aria-label="关闭今日值得关注" onClick={closeDailyFocus}><X size={16} /></button>
            </header>
            {dailyFocusItems.length === 0 ? (
              <p>今天暂无高价值提示。数据仅来自本地 CRM，不会调用模型。</p>
            ) : (
              <ul className="agent-daily-focus-list">
                {dailyFocusItems.map(item => (
                  <li key={item.customer_id}>
                    <strong>{item.customer_name}</strong>
                    <p>{item.why}</p>
                    <small>{item.evidence.map(entry => `${entry.label}：${entry.detail}`).join(' · ')}</small>
                    <div className="agent-daily-focus-actions">
                      <button type="button" className="btn btn-sm" onClick={() => viewCustomer(item)}>查看客户</button>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => handToAgent(item)}>交给 Sales Agent 分析</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <details className="agent-advanced">
        <summary>▶ 高级信息与调试详情</summary>
        <div className="agent-advanced-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            AI 原生 CRM 工作台调试区（默认折叠，不占首屏）。安全状态：只读 Sandbox / 确定性 Mock 推理。当前不会调用外部 Provider 或真实模型（除非你在下方明确授权一次 Live reasoning）。
            未调用 Provider 或模型时也不会执行动作。所有结果必须人工复核。
          </p>

          {customerScopedEntry && (
            <section className="glass-card" aria-label="Customer-scoped Sales Agent entry">
              <h3 className="section-title">Customer-scoped Sales Agent</h3>
              <p style={{ color: '#475569', fontSize: 13 }}>客户已从详情页带入；上下文自动只读加载，不自动推理。</p>
              <div className="detail-grid">
                <div className="detail-item"><div className="label">Customer</div><div className="value">{customerName || customerScopedEntry.customer_id}</div></div>
                <div className="detail-item"><div className="label">Active memory refs</div><div className="value">{customerScopedEntry.active_memory_ids.length}</div></div>
                <div className="detail-item"><div className="label">Timeline refs</div><div className="value">{customerScopedEntry.timeline_evidence_ids.length}</div></div>
              </div>
            </section>
          )}

          {error && (
            <p style={{ color: '#b91c1c', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={15} /> {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => void loadCatalog()} disabled={loading}>刷新客户列表</button>
            <button type="button" className="btn" onClick={() => void loadSelectedContext({ runCopilot: false })} disabled={!selectedCustomerId || loading}>手动刷新只读上下文</button>
            <button type="button" className="btn" onClick={() => void loadSalesPriority()} disabled={loading || (catalog?.customers.length ?? 0) < 2}>
              Build Top-{MAX_WORKSPACE_PRIORITY_CANDIDATES} customer priority
            </button>
          </div>

          {stage2Context && (
            <Stage2ArchitectureStatus context={stage2Context} profile={stage2Profile} />
          )}

          {snapshot && summary && (
            <section className="glass-card" aria-label="CRM 上下文快照">
              <h3 className="section-title">CRM ContextSnapshot</h3>
              <div className="detail-grid" style={{ marginBottom: 14 }}>
                <div className="detail-item"><div className="label">客户</div><div className="value">{selectedCustomer?.name ?? '记录不存在'}</div></div>
                <div className="detail-item"><div className="label">客户记录 ID</div><div className="value">{summary.selected_customer_id}</div></div>
                <div className="detail-item"><div className="label">生命周期信号</div><div className="value">等级 {selectedCustomer?.customer_grade ?? '-'} · 意向 {selectedCustomer?.intent_level ?? '-'}</div></div>
                <div className="detail-item"><div className="label">待办 / 作业项</div><div className="value">{summary.open_task_count} / {summary.work_item_count}</div></div>
                <div className="detail-item"><div className="label">证据引用</div><div className="value">{summary.evidence_count} 条</div></div>
                <div className="detail-item"><div className="label">新鲜度</div><div className="value">{summary.freshness === 'fresh' ? '新鲜（5 分钟内）' : '已过期，需重新读取'}</div></div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, fontSize: 12, color: '#475569', lineHeight: 1.8 }}>
                <div>来源：真实 SQLite 只读查询（{summary.source}）</div>
                <div>快照 ID：{summary.snapshot_id}</div>
                <div>采集时间：{formatTimestamp(summary.captured_at)}</div>
                <div>脱敏状态：字段 allowlist 已应用；原始联系方式与自由文本不进入快照</div>
                <div>持久化：源记录已持久化；本次 ContextSnapshot 未持久化</div>
              </div>
            </section>
          )}

          <section className="glass-card" aria-label="Live reasoning activation gate">
            <h3 className="section-title">Live model reasoning（单次明确授权）</h3>
            <p style={{ color: '#64748b', fontSize: 13 }}>RUN_ONE_LIVE_SALES_AGENT_REASONING · 仅支持 Customer Intelligence 与 Interaction Intelligence。</p>
            <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
              <select aria-label="Live VerticalAIProfile" value={liveProfileId} onChange={event => setLiveProfileId(event.target.value)}><>{listVerticalAIProfiles().map(item => <option key={item.identity.id} value={item.identity.id}>{item.identity.name}</option>)}</></select>
              <select aria-label="Live workflow" value={liveWorkflow} onChange={event => setLiveWorkflow(event.target.value as typeof liveWorkflow)}><option value="customer_intelligence">Customer Intelligence</option><option value="interaction_intelligence">Interaction Intelligence</option></select>
              <label><input type="checkbox" checked={liveAuthorizationConfirmed} onChange={event => setLiveAuthorizationConfirmed(event.target.checked)} /> 我明确授权一次真实模型推理</label>
              <input aria-label="Live authorization phrase" value={liveAuthorizationPhrase} onChange={event => setLiveAuthorizationPhrase(event.target.value)} placeholder={LIVE_REASONING_AUTHORIZATION_PHRASE} />
              <button type="button" className="btn btn-primary" onClick={() => void runOneLiveReasoning()} disabled={loading}>Run one live reasoning request</button>
              <span style={{ fontSize: 13 }}>状态：{liveStatus} · 未自动持久化 · Human review required · Evidence-backed · Not executable · No CRM write</span>
              <span style={{ color: '#92400e', fontSize: 13 }}>凭证、端点与网络仅由可信本地主机管理；未配置时请求会安全阻断。</span>
            </div>
          </section>

          {suggestionResponse ? (
            <section className="glass-card" aria-label="Legacy 基于 CRM 快照的只读建议">
              <p style={{ color: '#475569', fontSize: 13, margin: '0 0 10px' }}>
                Legacy / 只读建议路径：真实 CRM ContextSnapshot 经现有 ReadOnlyAgent 与 SuggestOnly dry-run 规则生成；
                不属于未来 AI 推理入口，未调用 Provider 或模型，也不会执行动作。
              </p>
              <ReadOnlyAISuggestionPanel
                response={suggestionResponse}
                title="Legacy CRM 快照只读建议"
                showProvenance
                showTrace
              />
            </section>
          ) : (
            <section className="glass-card" aria-label="AI 建议卡片空状态">
              <strong>等待 CRM 上下文</strong>
              <p style={{ color: '#64748b', fontSize: 13, marginBottom: 0 }}>
                绑定客户后只读建议服务可生成不可执行的规则建议；不会调用 Provider 或模型。
              </p>
            </section>
          )}

          {copilotResults.length > 0 && (
            <section className="glass-card" aria-label="AI Sales Copilot workflow result">
              <SalesCopilotPanel results={copilotResults} />
              {stage2Context && stage2Context.recentInteractions.length > 0 && !copilotResults.some(item => item.kind === 'interaction_intelligence') && (
                <button type="button" className="btn" onClick={() => void reviewLatestInteraction()} disabled={loading}>
                  Review latest interaction
                </button>
              )}
            </section>
          )}

          <section className="glass-card" aria-label="人工复核与执行边界">
            <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserRoundCheck size={18} /> 人工复核与执行边界
            </h3>
            <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
              <span><CheckCircle2 size={14} color="#059669" /> 当前可用：自然语言客户定位、确定性 Mock 推理、来源与证据检查、人工复核</span>
              <span><LockKeyhole size={14} color="#d97706" /> 当前锁定：外部 Provider/真实模型（除非明确 Live 授权）、自动执行、任何未确认 CRM 写入</span>
              <span style={{ color: '#64748b' }}>工作区契约：{AI_NATIVE_CRM_WORKSPACE_VERSION} · Vertical Profile：{profile.key}</span>
            </div>
          </section>

          {safety && !isStrictReadOnlyWorkspaceSafety(safety) && (
            <div style={{ color: '#b91c1c' }}>安全契约异常，功能已阻断。</div>
          )}
        </div>
      </details>
    </div>
  );
}
