import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Customer } from '../../lib/types';
import { getDb, getCustomer, listCustomers } from '../../lib/db';
import { getActiveVerticalProfile } from '../../lib/verticalProfiles';
import { resolveVerticalAIProfile } from '../../lib/verticalAIProfiles/registry';
import { buildWorkspaceContextSnapshot } from '../../lib/context/workspaceContextAdapter';
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
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository, type CustomerMemoryContext } from '../../lib/customerMemory';
import { createTrustedHostSalesAgentAdapter } from '../../lib/salesAgentTools/trustedHostAdapter';
import { createSalesAgentMemoryRepository } from '../../lib/salesAgentTools/memoryRepositoryAdapter';
import { SALES_AGENT_APP_CLOCK } from '../../lib/salesAgentTools/appClock';
import type { ContextSnapshot } from '../../lib/context/types';
import type { SalesAgentHost } from '../../lib/salesAgentTools/agentSession';
import { formatUserFacingErrorMessage } from '../../lib/salesAgentUi/formatUserFacingError';

const profile = getActiveVerticalProfile();
const productionProfile = resolveVerticalAIProfile();

export interface SalesAgentRuntime {
  readonly customerId: string;
  readonly customer: Customer | null;
  readonly snapshot: LoadedReadOnlyAgentSnapshot | null;
  readonly context: ContextSnapshot | null;
  readonly compareContext: ContextSnapshot | null;
  readonly memory: CustomerMemoryContext | undefined;
  readonly host: SalesAgentHost | null;
  readonly memoryRepository: ReturnType<typeof createSalesAgentMemoryRepository> | undefined;
  readonly loading: boolean;
  readonly error: string;
  readonly refresh: () => Promise<void>;
}

/**
 * 生产 Sales Agent 运行时装配（与 AINativeCRMWorkspace 同一构造路径）：
 * readOnlySnapshotLoader（严格只读）→ workspace context → Trusted Host adapter → Memory repository。
 * 供作战卡 Sidecar 复用；模型未配置时 host 为受限占位，确定性能力不受影响。
 */
export function useSalesAgentRuntime(customerId: string): SalesAgentRuntime {
  const [catalog, setCatalog] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [directory, setDirectory] = useState<readonly Customer[]>([]);
  const [snapshot, setSnapshot] = useState<LoadedReadOnlyAgentSnapshot | null>(null);
  const [memory, setMemory] = useState<CustomerMemoryContext>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadedFor = useRef('');

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

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const loadSelectedContext = useCallback(async (targetId: string) => {
    if (!targetId) return;
    setLoading(true);
    setError('');
    try {
      const plan = buildReadOnlySnapshotLoaderPlan(buildSelectedCRMContextRequest(profile.key, targetId, SALES_AGENT_APP_CLOCK.now()));
      const result = await loadReadOnlySnapshotFromDb(await getDb(), plan);
      if (!isStrictReadOnlyWorkspaceSafety(result.safety)) throw new Error('只读安全契约未通过。');
      const db = await getDb();
      setSnapshot(result.snapshot);
      setMemory(await new SqliteMemoryRepository(db, new SqliteCrmEvidenceResolver(db)).getMemoryContext(targetId));
    } catch (cause) {
      setSnapshot(null);
      setMemory(undefined);
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!customerId || loadedFor.current === customerId) return;
    loadedFor.current = customerId;
    void loadSelectedContext(customerId);
  }, [customerId, loadSelectedContext]);

  const customer = useMemo(
    () => directory.find(item => item.id === customerId) ?? null,
    [customerId, directory],
  );

  const context = useMemo(() => snapshot ? buildWorkspaceContextSnapshot(snapshot) : null, [snapshot]);
  const compareContext = useMemo(() => catalog ? buildWorkspaceContextSnapshot(catalog) : null, [catalog]);
  const host = useMemo(
    () => context ? createTrustedHostSalesAgentAdapter({ context_snapshot_id: context.snapshotId, profile_id: productionProfile.identity.id }) : null,
    [context],
  );
  const memoryRepository = useMemo(() => snapshot ? createSalesAgentMemoryRepository() : undefined, [snapshot]);

  const refresh = useCallback(async () => {
    if (!customerId) return;
    await loadSelectedContext(customerId);
  }, [customerId, loadSelectedContext]);

  return {
    customerId,
    customer,
    snapshot,
    context,
    compareContext,
    memory,
    host,
    memoryRepository,
    loading,
    error,
    refresh,
  };
}

export { getCustomer as loadCustomerSnapshot };
