/**
 * V0.2A / A2 — Customer Read Capability Inventory (audit evidence).
 *
 * 审计结论基于当前产品源码(Phase 2 调查),记录四项候选 Customer 读取能力的
 * 真实性分类。生产 manifest(definitions.ts / manifest.ts)只允许包含
 * product_capability_exists=true 且 final_status='VERIFIED' 的能力。
 *
 * 审计证据来源(全部为产品现有源码,file:line 级):
 * - Search Customer:
 *   - 已注册只读工具 `search_customers`:src/lib/salesAgentTools/registry.ts:57-66
 *   - 生产执行器 executeSearchCustomersTool:src/lib/salesAgentTools/executeSearchCustomersTool.ts:52-99
 *     (→ createCrmRepository(db) → repository.searchCustomers/countCustomers → SQLite 参数化查询)
 * - Get Customer:
 *   - 已注册只读工具 `get_customer`:src/lib/salesAgentTools/registry.ts:48
 *   - 执行器 executeSalesAgentReadTool('get_customer', ...):src/lib/salesAgentTools/registry.ts:93-113
 *     (从 LoadedReadOnlyAgentSnapshot.customers 精确按 customer_id 过滤,数据源
 *      src/lib/readOnlySnapshotLoaderReadiness.ts:290-392 SQLite 只读加载)
 * - Read Customer Context:
 *   - 已注册只读工具 `get_customer_context`:src/lib/salesAgentTools/registry.ts:49
 *   - 执行器 executeSalesAgentReadTool('get_customer_context', ...) 返回现有 ContextSnapshot
 *     (src/lib/context/types.ts:37-52;生产投影 buildWorkspaceContextSnapshot
 *      src/lib/context/workspaceContextAdapter.ts:7-69)
 * - Read Customer State:
 *   - 不存在独立 customer state 实体/状态机/投影。stage/customer_grade/intent_level/
 *     payment_status/next_action 等均为 Customer 表列(src/lib/types.ts:45-89),
 *     Agent 侧现有投影只有 CRMCustomerFact 的 grade+intentLevel(src/lib/context/types.ts:8-15)。
 *   - 结论:NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY,不得发明状态模型,不得注册。
 */

export type CustomerReadCandidateId =
  | 'search_customer'
  | 'get_customer'
  | 'read_customer_context'
  | 'read_customer_state';

export type CustomerReadA2Action = 'REGISTER_EXISTING' | 'NOT_APPLICABLE';

export type CustomerReadFinalStatus = 'VERIFIED' | 'NOT_DISTINCT';

export interface CustomerReadInventoryEntry {
  readonly candidate: CustomerReadCandidateId;
  readonly label: string;
  readonly product_capability_exists: boolean;
  /** 现有产品源码位置(只读审计证据)。 */
  readonly existing_source_path: readonly string[];
  /** 现有执行路径(生产行为)。 */
  readonly existing_execution_path: string;
  readonly agent_capability_already_exists: boolean;
  readonly a2_action: CustomerReadA2Action;
  readonly final_status: CustomerReadFinalStatus;
  /** NOT_DISTINCT 时必须给出精确理由。 */
  readonly not_distinct_reason?: string;
}

/** 深度冻结(条目对象含只读字符串字段,冻结对象本身即可防篡改)。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const CUSTOMER_READ_INVENTORY: readonly CustomerReadInventoryEntry[] = deepFreeze([
  {
    candidate: 'search_customer',
    label: 'Search Customer',
    product_capability_exists: true,
    existing_source_path: [
      'src/lib/salesAgentTools/executeSearchCustomersTool.ts',
      'src/lib/salesAgentTools/searchCustomers.ts',
      'src/lib/salesAgentTools/registry.ts',
    ],
    existing_execution_path:
      'executeSearchCustomersTool → createCrmRepository(db) → searchCustomers/countCustomers → SQLite (parameterized, read-only)',
    agent_capability_already_exists: true,
    a2_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
  },
  {
    candidate: 'get_customer',
    label: 'Get Customer',
    product_capability_exists: true,
    existing_source_path: [
      'src/lib/salesAgentTools/registry.ts',
      'src/lib/readOnlySnapshotLoaderReadiness.ts',
    ],
    existing_execution_path:
      "executeSalesAgentReadTool('get_customer', { customer_id, snapshot }) → snapshot.customers exact filter",
    agent_capability_already_exists: true,
    a2_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
  },
  {
    candidate: 'read_customer_context',
    label: 'Read Customer Context',
    product_capability_exists: true,
    existing_source_path: [
      'src/lib/salesAgentTools/registry.ts',
      'src/lib/context/types.ts',
      'src/lib/context/workspaceContextAdapter.ts',
    ],
    existing_execution_path:
      "executeSalesAgentReadTool('get_customer_context', { customer_id, context }) → existing ContextSnapshot representation",
    agent_capability_already_exists: true,
    a2_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
  },
  {
    candidate: 'read_customer_state',
    label: 'Read Customer State',
    product_capability_exists: false,
    existing_source_path: ['src/lib/types.ts', 'src/lib/context/types.ts'],
    existing_execution_path: 'N/A — no distinct customer state representation exists in current product source',
    agent_capability_already_exists: false,
    a2_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    not_distinct_reason:
      "No independent customer state entity/state-machine/projection exists. stage / customer_grade / intent_level / payment_status / next_action are plain customers table columns (src/lib/types.ts:45-89); the only agent-facing projection is CRMCustomerFact grade+intentLevel (src/lib/context/types.ts:8-15). A2 must not invent a new state model, therefore this capability is intentionally absent from the production manifest.",
  },
]);

/** 仅真实存在的能力才进入生产 manifest 的候选集合(供测试断言 manifest 与清单一致)。 */
export const VERIFIED_CUSTOMER_READ_CANDIDATES: readonly CustomerReadCandidateId[] = deepFreeze(
  CUSTOMER_READ_INVENTORY
    .filter((entry) => entry.product_capability_exists && entry.final_status === 'VERIFIED')
    .map((entry) => entry.candidate),
);
