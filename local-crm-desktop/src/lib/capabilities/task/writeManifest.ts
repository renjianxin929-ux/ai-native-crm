/**
 * V0.2A / W3-3 — Task WRITE Capability Manifest (domain: task).
 *
 * 本模块是 W3-3（Existing Write Capability Registration）的 Task 域写能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'（与 A1 registry.ts 依赖边界一致）。
 * - 不修改 A1 中央文件、authority/**、现有读 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（W3-3 独立审计）────────────────────────────────────────────
 * 候选：task creation（create task）。
 *
 * REAL_PRODUCT_CAPABILITY:
 *   产品存在真实的"创建任务/待办"写入行为：Sales Agent 交互工作台将写意图
 *   （writeIntent.classifyClosedWriteIntent → CREATE_TASK_REQUEST →
 *   tool_id 'create_task'）生成为需人工确认的 Proposal，确认后经安全写边界执行。
 *
 * REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR:
 *   'create_task' ∈ confirmedWrite.AGENT_WRITE_TOOL_IDS（稳定写工具 ID），
 *   approvedCrmWriteBoundary.executeOne（approvedCrmWriteBoundary.ts:51-54）
 *   构造 Task 记录（title / due_at / status=OPEN / priority=MEDIUM / source=MANUAL）
 *   并调用 repository.createTask → db.createTask（INSERT INTO tasks）。
 *   执行链：
 *   writeIntent → agentSession.emitWriteProposal → registerCanonicalProposal →
 *   人工确认（confirmWriteByRef + consumeExactConfirmation）→
 *   approvedCrmWriteBoundary.execute → db.createTask。
 *
 * SEMANTIC_PARITY:
 *   创建的记录是 tasks 行（Task 实体，status OPEN、due_at 可选、customer 显式），
 *   不是 work_item 或其它记录；status/due/customer 语义与当前 Task 真值一致
 *   （A6R 读能力 task.read_by_customer 读取同一 tasks 表）。
 *
 * 不注册（W3-3 范围外 / 无生产可执行路径）：
 *   - update_task / update_task_status / complete_task / cancel_task / delete_task：
 *     剩余缺口审计证明当前不存在生产可执行路径（approvedCrmWriteBoundary 对
 *     update_task / update_task_status 无执行分支，会抛 "not supported"）；
 *     历史写 ID 不是能力。
 *
 * ── A1 语义分类 ────────────────────────────────────────────────────────
 * effect=WRITE（持久化创建 CRM 任务记录）。
 * data_target=CRM_STATE（A1 词汇注释明确把"任务"列为 CRM_STATE 可变状态；
 *   与 A6R task.read_by_customer 的 data_target=CRM_STATE 一致）。
 * risk_level=LOW（低风险单条任务创建）。
 * authority_policy=POLICY_CONTROLLED（A10 受控策略：WRITE 一律 REQUIRE_CONFIRMATION）。
 * requires_confirmation=true（产品写运行时对每条写提案都要求显式人工确认）。
 * scope_requirement=CUSTOMER（写提案强制携带非空 customer_id）。
 * idempotency=NONE（create 重复执行产生多条任务；nonce/重放保护 ≠ 业务幂等）。
 * executor_ref='salesAgentWriteTool:create_task'（稳定写工具 ID，
 *   由 approvedCrmWriteBoundary 执行；W3-1 后续负责生产绑定解析）。
 */

import type { CapabilityDefinition } from '../types';

/** W3-3 Task 写能力版本。 */
export const TASK_WRITE_VERSION = '1.0.0' as const;

/** W3-3 Task 写能力身份（稳定身份 = id + version）。 */
export const TASK_WRITE_CAPABILITY_IDS = {
  create: 'task.create',
} as const;

/** Task 写能力审计契约：写操作要求审计，记录输入与效果。 */
const TASK_WRITE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W3-3 Task 域生产写 manifest：仅注册经独立审计证明真实存在的 Task 创建能力。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const TASK_WRITE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: TASK_WRITE_CAPABILITY_IDS.create,
    version: TASK_WRITE_VERSION,
    domain: 'task',
    description:
      'Create a Task record for an explicit customer through the existing confirmed-write path (writeIntent create_task → approvedCrmWriteBoundary → db.createTask → INSERT INTO tasks). The proposal is generated from a closed write intent, registered as a canonical proposal, and executes only after exact human confirmation (nonce/replay-protected). The created record is a Task entity (tasks row) with status OPEN, optional due_at, priority MEDIUM, source MANUAL, scoped to the proposal customer_id; it is never a work_item. Not naturally idempotent: repeated execution creates additional tasks.',
    input_schema: 'task.create.proposal.v1',
    output_schema: 'task.create.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'LOW',
    authority_policy: 'POLICY_CONTROLLED',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:create_task',
    audit_contract: { ...TASK_WRITE_AUDIT },
    // 底层执行路径（db.createTask）无稳定错误码体系，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const TASK_WRITE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  TASK_WRITE_MANIFEST.map((definition) => definition.id),
);
