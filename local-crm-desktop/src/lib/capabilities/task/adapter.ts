/**
 * V0.2A / A6R — Task Read Capabilities: read adapter.
 *
 * 执行绑定层：复用现有 Task 数据读路径（db.listTasks，db.ts:734
 * `SELECT * FROM tasks ORDER BY due_at ASC`），不修改 db.ts。
 *
 * 注意（REPOSITORY_HELPER ≠ PRODUCT CAPABILITY）：
 * db.listTasks() 本身在全库无生产调用方，因此不构成全局任务读产品能力
 * （task.read 不注册）。本 adapter 仅以它作为底层数据读取函数，
 * 客户级能力 task.read_by_customer 的成立依据是现有 agent 工具
 * list_customer_tasks（salesAgentTools/registry.ts:53,101,106）的真实可达行为。
 *
 * 语义对齐（EXISTING PATH PARITY）：
 * - task.read_by_customer 与现有 agent 读工具 list_customer_tasks
 *   （salesAgentTools/registry.ts:93-113）保持一致：
 *     · customer_id 精确匹配（registry.ts:101）
 *     · 空/空白 customer_id 抛错（registry.ts:94）
 *     · 未知客户（非空但不存在）→ 空结果，不泄露其他客户数据
 * - 不做状态归一化：status 原样返回（OPEN/DONE/CANCELLED，db 真相），
 *   不做 snapshot 的 TODO/DONE 投影映射（readOnlySnapshotLoaderReadiness.ts:366-368）。
 * - 不做时间分类：due_at 原样保留（含 null）；不制造 today/overdue/upcoming 分类。
 *
 * 零写保证：本模块只经 listTasks() 触发 SELECT；无任何 INSERT/UPDATE/DELETE 入口。
 * 零模型/网络：本模块不 import 模型提供方 / LLM / fetch。
 */

import { listTasks } from '../../db';
import type { Task } from '../../types';

/** 稳定错误类别（DISTINGUISHABLE 契约）：空 customer_id。 */
export class TaskReadScopeError extends Error {
  readonly code = 'EMPTY_CUSTOMER_ID';

  constructor() {
    super('task.read_by_customer requires a non-empty customer_id.');
    this.name = 'TaskReadScopeError';
  }
}

/**
 * 读指定客户的任务：在现有 Task 数据读路径（db.listTasks）之上按 customer_id 精确过滤。
 * 与 agent 工具 list_customer_tasks 的过滤语义一致（registry.ts:101）。
 */
export async function readTasksByCustomer(customerId: string): Promise<Task[]> {
  if (!customerId || !customerId.trim()) {
    throw new TaskReadScopeError();
  }
  const all = await listTasks();
  return all.filter((task) => task.customer_id === customerId);
}
