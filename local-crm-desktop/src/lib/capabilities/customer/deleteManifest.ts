/**
 * V0.2A / W4-4 — Customer Delete Capability Manifest (domain: customer).
 *
 * 本模块是 W4-4（customer.delete）的 Customer 域能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读/写/创建/资料更新 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（W4-4 独立审计）────────────────────────────────────────────
 * customer.delete — REAL（注册为本 manifest 的唯一新生产能力）。
 *   REAL_PRODUCT_CAPABILITY：产品存在真实"删除客户"人工流程
 *   （CustomerDetail handleDelete，src/pages/CustomerDetail.tsx:270-275）：
 *   window.confirm("确定删除该客户及其所有记录？") → db.deleteCustomer(id) →
 *   onRefresh → navigate('/customers')。db.deleteCustomer
 *   （src/lib/db.ts:534-545）是唯一的真实产品删除路径，硬删除 + 应用层显式级联：
 *     DELETE follow_up_records WHERE customer_id = ?
 *     DELETE visit_records WHERE customer_id = ?
 *     DELETE tasks WHERE customer_id = ?
 *     DELETE customer_stage_cards WHERE customer_id = ?   (battle card)
 *     DELETE customer_hypotheses WHERE customer_id = ?    (battle card)
 *     DELETE reviewed_facts WHERE customer_id = ?         (battle card)
 *     DELETE intelligence_imports WHERE customer_id = ?   (battle card)
 *     DELETE customers WHERE id = ?
 *   该语义已作为共享产品服务存在（db.deleteCustomer）；人工路径与 Agent 确认后
 *   执行路径复用同一函数，绝不创建第二份删除实现。
 *   REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR：
 *   salesAgentWriteTool:delete_customer（新写工具身份）→ 现有确认运行时
 *   （sessionWriteStateStore canonical proposal + confirmWriteByRef +
 *   consumeExactConfirmation nonce/replay）→ approvedCrmWriteBoundary
 *   delete_customer 分支 → db.deleteCustomer。
 *   SCOPE：删除既有客户 → scope_requirement=CUSTOMER；唯一权威客户身份 =
 *   invocation.scope.customer_id。输入禁止携带 customer_id / customerId 目标身份
 *   （出现即 INVALID_INPUT，执行器调用数 = 0）；未知客户在交接前 fail closed。
 *   HARD_OR_SOFT：HARD（db.deleteCustomer 是 DELETE，不是 archive/soft delete）。
 *   REVERSIBLE：false（不可逆；产品无 rollback / 回收站 / tombstone）。
 *   IDEMPOTENCY：业务不幂等（NONE）；重复确认同一提案被 nonce/replay 拒绝；
 *   删除后再次 invoke 同一客户因"客户不存在"在交接前 fail closed——绝不把
 *   "第二次找不到"或"nonce 防重放"误报为业务幂等。
 *   AUDIT：audit_required=true / record_input=true / record_output=false /
 *   record_effect=true（A1 元数据；W3-2 事件仍保持载荷最小化）。
 *   OUTPUT：最小有用结果（entity_id = 被删除的 customer_id；fields 为空）。
 *
 * 本 manifest 刻意独立于 CUSTOMER_CREATE_MANIFEST（W4-1）、
 * CUSTOMER_PROFILE_UPDATE_MANIFEST（W4-2）与 CUSTOMER_WRITE_MANIFEST（W3-3 冻结）；
 * W4-4 以新 manifest 追加组合，绝不改写任何冻结定义。
 */

import type { CapabilityDefinition } from '../types';

/** W4-4 Customer Delete 能力版本。 */
export const CUSTOMER_DELETE_VERSION = '1.0.0' as const;

/** W4-4 Customer Delete 能力身份（稳定身份 = id + version）。 */
export const CUSTOMER_DELETE_CAPABILITY_IDS = {
  delete: 'customer.delete',
} as const;

/** Customer Delete 审计契约：破坏性写操作要求审计，记录输入与效果。 */
const CUSTOMER_DELETE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W4-4 Customer 域生产 delete manifest：只注册经审计证明真实存在的
 * 人工"删除客户"产品能力（customer.delete）。绝不注册 visit.create /
 * import.execute / customer archive / bulk customer delete / generic delete。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const CUSTOMER_DELETE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: CUSTOMER_DELETE_CAPABILITY_IDS.delete,
    version: CUSTOMER_DELETE_VERSION,
    domain: 'customer',
    description:
      'Hard-delete one existing customer through the real product "删除客户" semantics (CustomerDetail handleDelete → db.deleteCustomer): irreversibly removes the customers row and, in the same application-level cascade as the human path, deletes its follow_up_records, visit_records, tasks, customer_stage_cards, customer_hypotheses, reviewed_facts, and intelligence_imports. This is NOT an archive / soft delete / reversible operation — no rollback or tombstone exists in the product. The proposal carries only the bounded display summary (customer name) and a truthful reason disclosing hard delete + irreversibility + cascade; it executes only after exact STRONG human confirmation through the existing confirmed-write flow (nonce/replay-protected). Scope is CUSTOMER and the sole authoritative customer identity is invocation.scope.customer_id (no input customer_id/customerId, no selected-customer fallback, no search-by-name fallback). NOT business-idempotent: confirming again is nonce-rejected, and re-invoking after a successful delete fails closed because the customer no longer exists.',
    input_schema: 'customer.delete.input.v1',
    output_schema: 'customer.delete.result.v1',
    effect: 'DELETE',
    data_target: 'CRM_FACT',
    risk_level: 'DESTRUCTIVE',
    authority_policy: 'STRONG_CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:delete_customer',
    audit_contract: { ...CUSTOMER_DELETE_AUDIT },
    // 底层执行路径（db.deleteCustomer 多步 DELETE）无稳定错误码体系、非事务化，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const CUSTOMER_DELETE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  CUSTOMER_DELETE_MANIFEST.map((definition) => definition.id),
);
