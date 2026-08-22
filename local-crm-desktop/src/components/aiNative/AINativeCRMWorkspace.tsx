import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, Sparkles, X, MoreHorizontal } from 'lucide-react';
import { getDb, getCustomer, listCustomers } from '../../lib/db';
import type { Customer } from '../../lib/types';
import { getActiveVerticalProfile } from '../../lib/verticalProfiles';
import { buildWorkspaceContextSnapshot } from '../../lib/context/workspaceContextAdapter';
import { resolveVerticalAIProfile } from '../../lib/verticalAIProfiles/registry';
import {
  buildReadOnlySnapshotLoaderPlan,
  loadReadOnlySnapshotFromDb,
  type LoadedReadOnlyAgentSnapshot,
} from '../../lib/readOnlySnapshotLoaderReadiness';
import {
  buildCustomerCatalogRequest,
  buildSelectedCRMContextRequest,
  isStrictReadOnlyWorkspaceSafety,
} from '../../lib/aiNativeCRMWorkspaceReadiness';
import { readCustomerScopedSalesAgentEntry } from '../../lib/salesWorkspace/customerScopedSalesAgentEntry';
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository, type CustomerMemoryContext } from '../../lib/customerMemory';
import { createTrustedHostSalesAgentAdapter } from '../../lib/salesAgentTools/trustedHostAdapter';
import { createSalesAgentMemoryRepository } from '../../lib/salesAgentTools/memoryRepositoryAdapter';
import { createProductionRefreshCoordinator } from '../../lib/salesAgentTools/productionRefreshCoordinator';
import { SALES_AGENT_APP_CLOCK } from '../../lib/salesAgentTools/appClock';
import {
  buildDailyFocusItems,
  dismissDailyFocusForToday,
  shouldAutoOpenDailyFocus,
  type DailyFocusItem,
} from '../../lib/salesAgentUi/dailyFocus';
import { formatUserFacingErrorMessage } from '../../lib/salesAgentUi/formatUserFacingError';
import type { SearchableCustomer } from '../../lib/salesAgentTools/searchCustomers';
import { SalesAgentInteractionWorkspace } from './SalesAgentInteractionWorkspace';

const profile = getActiveVerticalProfile();
const productionProfile = resolveVerticalAIProfile();

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

/** The only production AI workspace. Mock/Copilot/live-debug branches are not imported here. */
export default function AINativeCRMWorkspace({
  onProductCatalogRefresh,
}: {
  onProductCatalogRefresh?: () => Promise<void>;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const scopedEntry = readCustomerScopedSalesAgentEntry(location.state);
  const [catalog, setCatalog] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [directory, setDirectory] = useState<readonly Customer[]>([]);
  const [snapshot, setSnapshot] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [memory, setMemory] = useState<CustomerMemoryContext>();
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [controlledOpen, setControlledOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [processDrawerOpen, setProcessDrawerOpen] = useState(false);
  const [chromeOpen, setChromeOpen] = useState(false);
  const [dailyFocusOpen, setDailyFocusOpen] = useState(false);
  const [dailyFocusItems, setDailyFocusItems] = useState<readonly DailyFocusItem[]>([]);
  const [initialInstruction, setInitialInstruction] = useState<string | null>(null);
  const autoLoadedCustomer = useRef('');
  const dailyFocusInitialized = useRef(false);
  const newConversationHandler = useRef<(() => void) | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const plan = buildReadOnlySnapshotLoaderPlan(buildCustomerCatalogRequest(profile.key, SALES_AGENT_APP_CLOCK.now()));
      const result = await loadReadOnlySnapshotFromDb(await getDb(), plan);
      if (!isStrictReadOnlyWorkspaceSafety(result.safety)) throw new Error('只读安全契约未通过。');
      setCatalog(result.snapshot);
      setDirectory(await listCustomers());
      setError('');
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadCatalog(); });
    return () => { active = false; };
  }, [loadCatalog]);
  useEffect(() => {
    if (!scopedEntry) return;
    let active = true;
    queueMicrotask(() => { if (active) setSelectedCustomerId(scopedEntry.customer_id); });
    return () => { active = false; };
  }, [scopedEntry]);

  const searchable = useMemo(() => toSearchable(directory), [directory]);
  const compareContext = useMemo(() => catalog ? buildWorkspaceContextSnapshot(catalog) : null, [catalog]);
  useEffect(() => {
    if (directory.length === 0 || dailyFocusInitialized.current) return;
    dailyFocusInitialized.current = true;
    const items = buildDailyFocusItems(searchable, SALES_AGENT_APP_CLOCK.now());
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDailyFocusItems(items);
      if (items.length > 0 && shouldAutoOpenDailyFocus()) setDailyFocusOpen(true);
    });
    return () => { active = false; };
  }, [directory, searchable]);

  const loadSelectedContext = useCallback(async (customerId = selectedCustomerId) => {
    if (!customerId) return;
    setLoading(true);
    setError('');
    try {
      const plan = buildReadOnlySnapshotLoaderPlan(buildSelectedCRMContextRequest(profile.key, customerId, SALES_AGENT_APP_CLOCK.now()));
      const result = await loadReadOnlySnapshotFromDb(await getDb(), plan);
      if (!isStrictReadOnlyWorkspaceSafety(result.safety)) throw new Error('只读安全契约未通过。');
      const db = await getDb();
      setSnapshot(result.snapshot);
      setMemory(await new SqliteMemoryRepository(db, new SqliteCrmEvidenceResolver(db)).getMemoryContext(customerId));
    } catch (cause) {
      setSnapshot(null);
      setMemory(undefined);
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId || !catalog || autoLoadedCustomer.current === selectedCustomerId) return;
    autoLoadedCustomer.current = selectedCustomerId;
    void loadSelectedContext(selectedCustomerId);
  }, [catalog, loadSelectedContext, selectedCustomerId]);

  const bindCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setSnapshot(null);
    setMemory(undefined);
    autoLoadedCustomer.current = '';
  };
  const clearCustomer = () => {
    setSelectedCustomerId('');
    setSnapshot(null);
    setMemory(undefined);
    autoLoadedCustomer.current = '';
  };

  const selectedCustomer = directory.find(item => item.id === selectedCustomerId)
    ?? snapshot?.customers.find(item => item.id === selectedCustomerId)
    ?? catalog?.customers.find(item => item.id === selectedCustomerId)
    ?? null;
  const context = snapshot ? buildWorkspaceContextSnapshot(snapshot) : null;
  const host = useMemo(() => context ? createTrustedHostSalesAgentAdapter({
    context_snapshot_id: context.snapshotId,
    profile_id: productionProfile.identity.id,
  }) : null, [context]);
  const memoryRepository = useMemo(() => snapshot ? createSalesAgentMemoryRepository() : undefined, [snapshot]);
  const customerName = selectedCustomer?.name ?? (scopedEntry ? '已带入客户' : '');

  const closeDailyFocus = () => { dismissDailyFocusForToday(); setDailyFocusOpen(false); };
  const handToAgent = (item: DailyFocusItem) => {
    closeDailyFocus();
    bindCustomer(item.customer_id);
    setInitialInstruction(`总结一下这个客户最近的情况：${item.customer_name}`);
  };

  return (
    <div className="agent-shell product-page">
      <div className="agent-topbar agent-topbar-minimal">
        <div className="agent-top-actions">
          <button type="button" className="agent-icon-btn" aria-label="更多" onClick={() => setChromeOpen(value => !value)}>
            <MoreHorizontal size={16} />
          </button>
          {chromeOpen ? (
            <div className="agent-chrome-menu">
              <button type="button" className="btn btn-sm agent-daily-focus-btn" onClick={() => { setChromeOpen(false); setDailyFocusOpen(true); }}>
                <Sparkles size={14} aria-hidden="true" />今日重点
              </button>
              <button type="button" className="btn btn-sm" onClick={() => { setChromeOpen(false); newConversationHandler.current?.(); }}>新对话</button>
              <button type="button" className="btn btn-sm" onClick={() => setControlledOpen(value => !value)}>受控模式</button>
            </div>
          ) : null}
          <button type="button" className="sr-only" data-testid="daily-focus-reopen" onClick={() => setDailyFocusOpen(true)}>今日重点</button>
          <button type="button" className="sr-only" data-testid="controlled-mode-toggle" onClick={() => setControlledOpen(value => !value)}>受控模式</button>
        </div>
      </div>

      {controlledOpen && (
        <div className="agent-controlled-panel" data-testid="controlled-mode-panel" aria-label="受控模式">
          <span className="status-pill info">Trusted Host 正式路径</span>
          <span className="status-pill">最小化只读上下文</span>
          <span className="status-pill warn">写入需人工确认</span>
          <span className="status-pill ok"><ShieldCheck size={14} /> 不自动执行</span>
        </div>
      )}
      {error && <div role="alert" className="app-db-error">{error}</div>}

      <div className="agent-stage agent-stage-final">
        <SalesAgentInteractionWorkspace
          customerId={selectedCustomerId}
          customerName={customerName}
          onBindCustomer={bindCustomer}
          onClearCustomer={clearCustomer}
          snapshot={snapshot}
          context={context}
          compareContext={compareContext}
          customerCatalog={searchable.map(item => ({ id: item.id, name: item.name }))}
          memory={memory}
          profileId={productionProfile.identity.id}
          host={host}
          memoryRepository={memoryRepository}
          loadCustomerSnapshot={getCustomer}
          onRefresh={createProductionRefreshCoordinator(
            () => loadSelectedContext(),
            async () => {
              await loadCatalog();
              await onProductCatalogRefresh?.();
            },
          )}
          contextLoading={loading}
          onOpenContextDrawer={() => setContextDrawerOpen(true)}
          processDrawerOpen={processDrawerOpen}
          onProcessDrawerOpenChange={setProcessDrawerOpen}
          initialInstruction={initialInstruction}
          onInitialInstructionConsumed={() => setInitialInstruction(null)}
          onRegisterNewConversation={handler => { newConversationHandler.current = handler; }}
          userConversationKey={scopedEntry ? `${scopedEntry.customer_id}:${location.key}` : selectedCustomerId}
        />
      </div>

      {contextDrawerOpen && (
        <aside className="agent-drawer agent-drawer-context" data-testid="agent-context-drawer" aria-label="上下文">
          <header><h3>上下文</h3><button type="button" className="agent-icon-btn" aria-label="关闭上下文" onClick={() => setContextDrawerOpen(false)}><X size={16} /></button></header>
          <section><h4>当前客户</h4><p>{customerName || '未绑定'}</p></section>
          <section><h4>记忆</h4><p>{memory?.items.length ?? 0} 条</p></section>
          <section><h4>近期互动</h4><p>{context?.recentInteractions.length ?? 0} 条</p></section>
        </aside>
      )}

      {dailyFocusOpen && (
        <div className="agent-modal-backdrop" role="presentation" onClick={closeDailyFocus}>
          <div className="agent-daily-focus-modal" role="dialog" aria-modal="true" aria-label="今日值得关注" data-testid="daily-focus-modal" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <h3>今日值得关注</h3>
                <p className="agent-daily-focus-kicker" data-testid="daily-focus-execution-mode">根据本地客户记录整理</p>
              </div>
              <button type="button" className="agent-icon-btn" aria-label="关闭今日值得关注" onClick={closeDailyFocus}><X size={16} /></button>
            </header>
            {dailyFocusItems.length === 0 ? <p className="agent-daily-focus-empty">今天没有特别需要先看的客户。</p> : (
              <ul className="agent-daily-focus-list">{dailyFocusItems.map(item => (
                <li key={item.customer_id}>
                  <strong>{item.customer_name}</strong>
                  <p>{item.why}</p>
                  <div className="agent-daily-focus-actions">
                    <button type="button" className="agent-link-btn" onClick={() => navigate(`/customers/${item.customer_id}`)}>查看客户</button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => handToAgent(item)}>交给 Sales Agent 分析</button>
                  </div>
                </li>
              ))}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
