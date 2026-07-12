import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSearch,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { ReadOnlyAISuggestionPanel } from '../aiSuggestions/ReadOnlyAISuggestionPanel';
import { Stage2ArchitectureStatus } from './Stage2ArchitectureStatus';
import { SalesCopilotPanel } from './SalesCopilotPanel';
import { getDb } from '../../lib/db';
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
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository, type CustomerMemoryContext } from '../../lib/customerMemory';
import { getCustomer } from '../../lib/db';
import { createTrustedHostSalesAgentAdapter } from '../../lib/salesAgentTools/trustedHostAdapter';
import { createSalesAgentMemoryRepository } from '../../lib/salesAgentTools/memoryRepositoryAdapter';
import { createProductionRefreshCoordinator } from '../../lib/salesAgentTools/productionRefreshCoordinator';

const profile = getActiveVerticalProfile();
const stage2Profile = resolveVerticalAIProfile();

const panelStyle = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--surface, #fff)',
  padding: 18,
} as const;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export default function AINativeCRMWorkspace() {
  const location = useLocation();
  const [catalog, setCatalog] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
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
  const customerScopedEntry = readCustomerScopedSalesAgentEntry(location.state);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const plan = buildReadOnlySnapshotLoaderPlan(buildCustomerCatalogRequest(profile.key, now));
      const result = await loadReadOnlySnapshotFromDb(await getDb(), plan);
      if (!isStrictReadOnlyWorkspaceSafety(result.safety)) {
        throw new Error('只读安全契约未通过，工作区已停止加载。');
      }
      setCatalog(result.snapshot);
      setSafety(result.safety);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (customerScopedEntry) setSelectedCustomerId(customerScopedEntry.customer_id);
  }, [customerScopedEntry]);

  const loadSelectedContext = async (options: { readonly runCopilot?: boolean } = {}) => {
    if (!selectedCustomerId) return;
    setLoading(true);
    setError('');
    setSnapshot(null);
    setAgentMemory(undefined);
    setSuggestionResponse(null);
    setCopilotResults([]);
    try {
      const now = new Date().toISOString();
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
      if (options.runCopilot !== false) {
        const provider = createMockReasoningProvider();
        const customerIntelligence = await runSalesCopilotWorkflow({
          kind: 'customer_intelligence', request_id: `${result.snapshot.snapshot_id}:customer-intelligence`, context,
          profile_id: stage2Profile.identity.id, provider,
        });
        setCopilotResults(current => [customerIntelligence, ...current.filter(item => item.kind === 'sales_priority')]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
        request_id: `workspace-priority:${new Date().toISOString()}`,
        customer_ids: customerIds,
        profile_id: stage2Profile.identity.id,
        provider: createMockReasoningProvider(),
        load_read_only_context: async customerId => {
          const now = new Date().toISOString();
          const plan = buildReadOnlySnapshotLoaderPlan(buildSelectedCRMContextRequest(profile.key, customerId, now));
          const loaded = await loadReadOnlySnapshotFromDb(db, plan);
          if (!isStrictReadOnlyWorkspaceSafety(loaded.safety)) throw new Error('Priority candidate failed the read-only safety contract.');
          return buildWorkspaceContextSnapshot(loaded.snapshot);
        },
      });
      setCopilotResults(current => [...current.filter(item => item.kind !== 'sales_priority'), priority]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

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
      setError(cause instanceof Error ? cause.message : String(cause));
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
      const requestId = `${stage2Context.snapshotId}:live:${liveWorkflow}:${new Date().toISOString()}`;
      const result = liveWorkflow === 'customer_intelligence'
        ? await runSalesCopilotWorkflow({ kind: 'customer_intelligence', request_id: requestId, context: stage2Context, profile_id: liveProfileId, provider, live_activation: activation })
        : await runSalesCopilotWorkflow({ kind: 'interaction_intelligence', request_id: requestId, context: stage2Context, trigger: createAgentTriggerBoundary({ kind: 'InteractionAddedEvent', event_id: `workspace:${stage2Context.recentInteractions[0]?.interactionId ?? 'missing'}`, occurred_at: stage2Context.recentInteractions[0]?.occurredAt ?? new Date().toISOString(), customer_id: selectedCustomerId, interaction_id: stage2Context.recentInteractions[0]?.interactionId ?? 'missing' }), explicitly_activated: true, profile_id: liveProfileId, provider, live_activation: activation });
      setCopilotResults(current => [...current.filter(item => item.kind !== result.kind), result]);
      setLiveStatus('completed and validated');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setLiveStatus(message.includes('timed out') ? 'timeout' : message.includes('invalid structured') ? 'invalid model output' : 'provider error');
    } finally { setLoading(false); }
  };

  const selectedCustomer = snapshot?.customers[0] ?? null;
  const summary = snapshot
    ? projectCRMContextSummary(snapshot, selectedCustomerId, new Date().toISOString())
    : null;
  const stage2Context = snapshot ? buildWorkspaceContextSnapshot(snapshot) : null;
  const salesAgentHost = useMemo(() => stage2Context ? createTrustedHostSalesAgentAdapter({ context_snapshot_id: stage2Context.snapshotId, profile_id: stage2Profile.identity.id }) : null, [stage2Context]);
  const salesAgentMemoryRepository = useMemo(() => snapshot ? createSalesAgentMemoryRepository() : undefined, [snapshot]);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2>AI 原生 CRM 工作台</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            真实 CRM 上下文 → SalesAgentRuntime Mock 推理 → 证据校验 → 人工复核
          </p>
        </div>
        <span className="badge" style={{ alignSelf: 'center', background: '#ecfdf5', color: '#047857' }}>
          <ShieldCheck size={14} /> 当前仅只读
        </span>
      </div>

      <div className="page-body" style={{ display: 'grid', gap: 16 }}>
        {customerScopedEntry && (
          <section style={panelStyle} aria-label="Customer-scoped Sales Agent entry">
            <h3 className="section-title">Customer-scoped Sales Agent</h3>
            <p style={{ color: '#475569', fontSize: 13, margin: '0 0 10px' }}>客户上下文已带入工作台；尚未读取快照或运行推理。请明确选择“读取当前客户上下文”后继续。</p>
            <div className="detail-grid">
              <div className="detail-item"><div className="label">Customer ID</div><div className="value">{customerScopedEntry.customer_id}</div></div>
              <div className="detail-item"><div className="label">ContextSnapshot reference</div><div className="value">{customerScopedEntry.context_snapshot_reference}</div></div>
              <div className="detail-item"><div className="label">Active memory context</div><div className="value">{customerScopedEntry.active_memory_ids.length} references</div></div>
              <div className="detail-item"><div className="label">Timeline reference</div><div className="value">{customerScopedEntry.timeline_evidence_ids.length} evidence references</div></div>
              <div className="detail-item"><div className="label">Profile identity</div><div className="value">{customerScopedEntry.profile_identity}</div></div>
            </div>
            <p style={{ color: '#64748b', fontSize: 12, marginBottom: 0 }}>Read-only · No automatic model invocation · Human review required</p>
          </section>
        )}
        <section style={{ ...panelStyle, borderColor: '#86efac', background: '#f0fdf4' }} aria-label="当前权限状态">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <LockKeyhole size={22} color="#047857" />
            <div>
              <strong style={{ color: '#065f46' }}>安全状态：只读 Sandbox / Mock 推理</strong>
              <div style={{ color: '#047857', fontSize: 13, marginTop: 5 }}>
                当前仅运行确定性 Mock Provider；不会调用外部 Provider 或真实模型。
                禁止网络请求、CRM 写入、自动执行与结果持久化；所有结果必须人工复核。
              </div>
            </div>
          </div>
        </section>

        <section style={panelStyle} aria-label="选择 CRM 上下文">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={18} /> 选择真实 CRM 上下文
          </h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select
              value={selectedCustomerId}
              onChange={event => {
                setSelectedCustomerId(event.target.value);
                setSnapshot(null);
                setAgentMemory(undefined);
                setSuggestionResponse(null);
                setCopilotResults([]);
              }}
              aria-label="选择客户"
              style={{ minWidth: 260, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8 }}
            >
              <option value="">未选择客户</option>
              {(catalog?.customers ?? []).map(customer => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => void loadSelectedContext()} disabled={!selectedCustomerId || loading}>
              {loading ? <RefreshCw size={14} /> : <FileSearch size={14} />}
              {loading ? '读取中…' : '读取只读快照'}
            </button>
            <button className="btn" onClick={() => void loadCatalog()} disabled={loading}>
              刷新客户列表
            </button>
            <button className="btn" onClick={() => void loadSalesPriority()} disabled={loading || (catalog?.customers.length ?? 0) < 2}>
              Build Top-{MAX_WORKSPACE_PRIORITY_CANDIDATES} customer priority
            </button>
          </div>
          {!selectedCustomerId && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '12px 0 0' }}>
              当前为无上下文状态。选择客户后才会生成结构化只读快照；不会调用 AI 或修改数据。
            </p>
          )}
          {error && (
            <p style={{ color: '#b91c1c', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={15} /> {error}
            </p>
          )}
        </section>

        {stage2Context && (
          <Stage2ArchitectureStatus context={stage2Context} profile={stage2Profile} />
        )}

        {snapshot && summary && stage2Context && (
          <SalesAgentInteractionWorkspace customerId={selectedCustomerId} snapshot={snapshot} context={stage2Context} memory={agentMemory} profileId={stage2Profile.identity.id} host={salesAgentHost} memoryRepository={salesAgentMemoryRepository} loadCustomerSnapshot={getCustomer} onRefresh={createProductionRefreshCoordinator(loadSelectedContext)} />
        )}

        {snapshot && summary && (
          <section style={panelStyle} aria-label="CRM 上下文快照">
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

        <section style={panelStyle} aria-label="Live reasoning activation gate">
          <h3 className="section-title">Live model reasoning（单次明确授权）</h3>
          <p style={{ color: '#64748b', fontSize: 13 }}>仅支持 Customer Intelligence 与 Interaction Intelligence；Sales Priority 保持 MOCK-only，禁止批量真实调用。</p>
          <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
            <select aria-label="Live VerticalAIProfile" value={liveProfileId} onChange={event => setLiveProfileId(event.target.value)}><>{listVerticalAIProfiles().map(item => <option key={item.identity.id} value={item.identity.id}>{item.identity.name}</option>)}</></select>
            <select aria-label="Live workflow" value={liveWorkflow} onChange={event => setLiveWorkflow(event.target.value as typeof liveWorkflow)}><option value="customer_intelligence">Customer Intelligence</option><option value="interaction_intelligence">Interaction Intelligence</option></select>
            <label><input type="checkbox" checked={liveAuthorizationConfirmed} onChange={event => setLiveAuthorizationConfirmed(event.target.checked)} /> 我明确授权一次真实模型推理</label>
            <input aria-label="Live authorization phrase" value={liveAuthorizationPhrase} onChange={event => setLiveAuthorizationPhrase(event.target.value)} placeholder={LIVE_REASONING_AUTHORIZATION_PHRASE} />
            <button className="btn btn-primary" onClick={() => void runOneLiveReasoning()} disabled={loading}>Run one live reasoning request</button>
            <span style={{ fontSize: 13 }}>状态：{liveStatus} · 未自动持久化 · Human review required · Evidence-backed · Not executable · No CRM write</span>
            <span style={{ color: '#92400e', fontSize: 13 }}>凭证、端点与网络仅由可信本地主机管理；未配置时请求会安全阻断。</span>
          </div>
        </section>

        {suggestionResponse ? (
          <section style={panelStyle} aria-label="Legacy 基于 CRM 快照的只读建议">
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
          <section style={panelStyle} aria-label="AI 建议卡片空状态">
            <strong>等待 CRM 上下文</strong>
            <p style={{ color: '#64748b', fontSize: 13, marginBottom: 0 }}>
              选择并读取真实客户快照后，现有只读建议服务会生成不可执行的规则建议；不会调用 Provider 或模型。
            </p>
          </section>
        )}

        {copilotResults.length > 0 && (
          <section style={panelStyle} aria-label="AI Sales Copilot workflow result">
            <SalesCopilotPanel results={copilotResults} />
            {stage2Context && stage2Context.recentInteractions.length > 0 && !copilotResults.some(item => item.kind === 'interaction_intelligence') && (
              <button className="btn" onClick={() => void reviewLatestInteraction()} disabled={loading}>
                Review latest interaction
              </button>
            )}
          </section>
        )}

        <section style={panelStyle} aria-label="人工复核与执行边界">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserRoundCheck size={18} /> 人工复核与执行边界
          </h3>
          <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            <span><CheckCircle2 size={14} color="#059669" /> 当前可用：真实上下文选择、确定性 Mock 推理、来源与证据检查、人工复核</span>
            <span><LockKeyhole size={14} color="#d97706" /> 当前锁定：外部 Provider/真实模型、自动执行、Review Queue、WritePlan、任何 CRM 写入</span>
            <span style={{ color: '#64748b' }}>工作区契约：{AI_NATIVE_CRM_WORKSPACE_VERSION} · Vertical Profile：{profile.key} · Profile 版本：现有 Profile 未提供版本字段</span>
          </div>
        </section>

        {safety && !isStrictReadOnlyWorkspaceSafety(safety) && (
          <div style={{ color: '#b91c1c' }}>安全契约异常，功能已阻断。</div>
        )}
      </div>
    </div>
  );
}
