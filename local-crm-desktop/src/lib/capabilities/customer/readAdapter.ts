/**
 * V0.2A / A2 — Customer Read Adapter (binding to EXISTING read behavior).
 *
 * 复用规则(任务第 6 节)优先级 1:绑定现有已注册 Sales Agent 只读工具执行器。
 * 本模块不包含任何业务 SQL、过滤逻辑、客户解析逻辑或上下文构造逻辑 —
 * 全部委托现有生产路径:
 *
 * - customer.search   → executeSearchCustomersTool (src/lib/salesAgentTools/executeSearchCustomersTool.ts)
 * - customer.get      → executeSalesAgentReadTool('get_customer', ...) (src/lib/salesAgentTools/registry.ts)
 * - customer.context  → executeSalesAgentReadTool('get_customer_context', ...) (src/lib/salesAgentTools/registry.ts)
 *
 * 只读保证:所有被绑定执行器均为注册工具 access='read'、requires_confirmation=false,
 * 不调用 provider/network,不写 CRM(见 registry.ts / executeSearchCustomersTool.ts)。
 */

import type { ContextSnapshot } from '../../context/types';
import type { CustomerMemoryContext } from '../../customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../../readOnlySnapshotLoaderReadiness';
import {
  executeSalesAgentReadTool,
  type SalesAgentToolResult,
} from '../../salesAgentTools/registry';
import {
  executeSearchCustomersTool,
} from '../../salesAgentTools/executeSearchCustomersTool';

/** 客户级读取的显式客户作用域输入(与现有 SalesAgentReadToolContext 一致)。 */
export interface CustomerScopedReadInput {
  readonly customer_id: string;
  readonly snapshot: LoadedReadOnlyAgentSnapshot;
  readonly context: ContextSnapshot;
  readonly memory?: CustomerMemoryContext;
}

/** Search Customer:直接绑定现有注册工具执行器(同一引用),保留全部现有语义(含注入 db 的测试语义)。 */
export const searchCustomersRead: typeof executeSearchCustomersTool = executeSearchCustomersTool;

/** Get Customer:委托现有注册工具,按 customer_id 精确过滤 snapshot.customers。 */
export function getCustomerRead(input: CustomerScopedReadInput): SalesAgentToolResult {
  return executeSalesAgentReadTool('get_customer', input);
}

/** Read Customer Context:委托现有注册工具,返回现有 ContextSnapshot 表示。 */
export function readCustomerContextRead(input: CustomerScopedReadInput): SalesAgentToolResult {
  return executeSalesAgentReadTool('get_customer_context', input);
}
