import { useCallback, useEffect, useState } from 'react';
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
import { getDb } from '../../lib/db';
import { getActiveVerticalProfile } from '../../lib/verticalProfiles';
import { buildWorkspaceContextSnapshot } from '../../lib/context/workspaceContextAdapter';
import { resolveVerticalAIProfile } from '../../lib/verticalAIProfiles/registry';
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
  const [catalog, setCatalog] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [safety, setSafety] = useState<ReadOnlySnapshotLoaderSafety | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [suggestionResponse, setSuggestionResponse] = useState<ReadOnlyAISuggestionServiceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const loadSelectedContext = async () => {
    if (!selectedCustomerId) return;
    setLoading(true);
    setError('');
    setSnapshot(null);
    setSuggestionResponse(null);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const selectedCustomer = snapshot?.customers[0] ?? null;
  const summary = snapshot
    ? projectCRMContextSummary(snapshot, selectedCustomerId, new Date().toISOString())
    : null;
  const stage2Context = snapshot ? buildWorkspaceContextSnapshot(snapshot) : null;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2>AI 原生 CRM 工作台</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            真实 CRM 上下文 → 可审计建议 → 人工复核 → 明确确认 → 安全执行
          </p>
        </div>
        <span className="badge" style={{ alignSelf: 'center', background: '#ecfdf5', color: '#047857' }}>
          <ShieldCheck size={14} /> 当前仅只读
        </span>
      </div>

      <div className="page-body" style={{ display: 'grid', gap: 16 }}>
        <section style={{ ...panelStyle, borderColor: '#86efac', background: '#f0fdf4' }} aria-label="当前权限状态">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <LockKeyhole size={22} color="#047857" />
            <div>
              <strong style={{ color: '#065f46' }}>安全状态：只读 CRM 快照</strong>
              <div style={{ color: '#047857', fontSize: 13, marginTop: 5 }}>
                允许受限数据库读取；禁止 Provider 调用、网络请求、CRM 写入、自动执行与结果持久化。
                所有未来动作必须经过人工复核与明确确认。
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
                setSuggestionResponse(null);
              }}
              aria-label="选择客户"
              style={{ minWidth: 260, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8 }}
            >
              <option value="">未选择客户</option>
              {(catalog?.customers ?? []).map(customer => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={loadSelectedContext} disabled={!selectedCustomerId || loading}>
              {loading ? <RefreshCw size={14} /> : <FileSearch size={14} />}
              {loading ? '读取中…' : '读取只读快照'}
            </button>
            <button className="btn" onClick={() => void loadCatalog()} disabled={loading}>
              刷新客户列表
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

        {suggestionResponse ? (
          <section style={panelStyle} aria-label="基于 CRM 快照的只读建议">
            <p style={{ color: '#475569', fontSize: 13, margin: '0 0 10px' }}>
              来源：真实 CRM ContextSnapshot，经现有 ReadOnlyAgent 与 SuggestOnly dry-run 规则生成；
              未调用 Provider 或模型，不代表已执行动作。
            </p>
            <ReadOnlyAISuggestionPanel
              response={suggestionResponse}
              title="CRM 快照只读建议"
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

        <section style={panelStyle} aria-label="人工复核与执行边界">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserRoundCheck size={18} /> 人工复核与执行边界
          </h3>
          <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            <span><CheckCircle2 size={14} color="#059669" /> 当前可用：真实上下文选择、来源与证据检查、快照新鲜度检查</span>
            <span><LockKeyhole size={14} color="#d97706" /> 当前锁定：Provider/模型调用、ReviewDraft 确认、WritePlan 执行、任何 CRM 写入</span>
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
