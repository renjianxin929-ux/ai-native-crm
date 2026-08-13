/**
 * V0.2A / A6R — Task Read Capabilities: domain manifest.
 *
 * 纯声明式 Task 域 manifest：只声明 A1 CapabilityDefinition，不包含任何执行逻辑。
 * 本模块唯一允许的 import 是 type-only 的 '../types'（A1 契约层）。
 * 不得引入 db / provider / executor / network 语义（保持与 A1 T6 静态 import 边界一致）。
 *
 * 库存真相（Inventory Truth）——仅注册已证明存在的真实产品/agent 读行为：
 *   1. task.read_by_customer ← 现有 agent 读工具 list_customer_tasks
 *      （salesAgentTools/registry.ts:53,101,106）的语义：按 customer_id 精确过滤、
 *      空 customer_id 抛错、未知客户返回空。该工具是真实可达的 agent 行为：
 *      agentSession.ts:104（NEXT_ACTION_PREPARATION 计划）、operatingLayer.ts:45、
 *      capabilityRoutingMatrix.ts:93（deterministic_tools）、modelContextEnvelope.ts:232
 *      均消费/执行它；此外 stageCardEngine.ts:274 也按 customer_id 读 tasks 表。
 *
 * 不注册（避免能力膨胀，§10/§11/§15/§16）：
 *   - task.read（全局任务读）：db.listTasks()（db.ts:734）在全库无生产调用方
 *     （仅 db.test.ts 的 importable 断言引用），TodayView.tsx 未挂载、无任务页面/面板；
 *     agent snapshot 的 selectTasks 无过滤模式是上下文投影（LIMIT 50、TODO/DONE 映射、
 *     字段子集），语义与全局任务读不同。Repository helper ≠ Product Capability，
 *     因此 task.read 不注册（分类：NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY）。
 *   - task.read_today / task.read_overdue：today 派生存在于 rules.ts:326-330
 *     （buildTodaySummary.tasks_due_today：due_at 存在 && status==='OPEN' && due <= 今日 23:59:59），
 *     但它是 Daily Summary 投影的一部分，不是 Task 域独立读原语。
 *   - task.read_pending / task.read_completed：listTasks() + status 字段不构成独立产品能力（§11）。
 *   - task.read_one：无单任务读行为（无 getTasks/getTaskById，全 src 无匹配）。
 *   - daily_focus / daily_review：更高层 UI/投影工作流，非 Task 域原语（§16）。
 */

import type { CapabilityDefinition } from '../types';

/** 审计契约：读能力与 A1 READ fixture 惯例一致（全显式声明；读记录输入输出，不产生效果）。 */
const TASK_READ_AUDIT = {
  audit_required: true,
  record_input: true,
  record_output: true,
  record_effect: false,
} as const;

/**
 * Task 读能力生产 manifest（冻结；供 createCapabilityRegistry(...) 独立组合）。
 * 通过 A1 扩展缝组合：A1 的 createCapabilityRegistry 接受多个独立 domain manifest，
 * 本数组不依赖任何中央 hub / switch（§9）。
 */
export const TASK_READ_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: 'task.read_by_customer',
    version: '1.0.0',
    domain: 'task',
    description: '读取指定客户的任务：按 customer_id 精确过滤；未知客户返回空结果，空 customer_id 抛错（与现有 agent 工具 list_customer_tasks 语义一致）。',
    input_schema: 'task.read_by_customer.query.v1',
    output_schema: 'task.read_by_customer.result.v1',
    effect: 'READ',
    data_target: 'CRM_STATE',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'CUSTOMER',
    idempotency: 'SAFE',
    // executor_ref 指向能力语义来源：现有 agent 客户级任务读工具 list_customer_tasks
    // （salesAgentTools/registry.ts:53）。域内绑定实现（语义对齐的读 adapter）
    // 见 capabilities/task/adapter.ts 的 readTasksByCustomer。
    executor_ref: 'salesAgentTool:list_customer_tasks',
    audit_contract: { ...TASK_READ_AUDIT },
    error_contract: 'DISTINGUISHABLE',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相）。 */
export const TASK_READ_CAPABILITY_IDS: readonly string[] = Object.freeze(
  TASK_READ_MANIFEST.map((definition) => definition.id),
);
