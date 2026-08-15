/**
 * V0.2A / W4-3 — Visit Create Capability Manifest (domain: visit).
 *
 * 本模块是 W4-3（visit.create）的 Visit 域能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读/写 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（W4-3 独立审计）────────────────────────────────────────────
 * visit.create — REAL（注册为本 manifest 的唯一新生产能力）。
 *   REAL_PRODUCT_CAPABILITY：产品存在真实"新增面访记录"人工流程（VisitForm
 *   src/components/VisitForm.tsx → CustomerDetail.handleVisitSaved）。该流程的
 *   用户可编辑 7 个字段（title 必填；visit_notes / customer_concerns /
 *   intent_after_visit / visit_outcome / next_action / expected_contract_at 可选，
 *   `value || null` 空串清除）；visited_at / id / created_at / updated_at 为系统派生。
 *   若 visit_outcome 非空，人工路径还会 applyVisitOutcome(customer, outcome) 后
 *   updateCustomer（只取 customer，丢弃返回的 tasks → 不创建任务）。
 *   该语义已提取为共享产品服务 src/lib/visitCreate.ts
 *   （createVisitWithProductRules），人工路径与 Agent 确认后执行路径复用同一份
 *   产品语义（存在性校验 → 可选面访结论规则更新客户 → db.createVisit 插入）。
 *   REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR：
 *   salesAgentWriteTool:create_visit_record（现有 confirmed-write 稳定写工具 ID，
 *   W4-3 将其 allowedFields 修正为真实 7 个面访字段 + 补齐执行分支与 entity_type）→
 *   现有确认运行时（sessionWriteStateStore canonical proposal + confirmWriteByRef +
 *   consumeExactConfirmation nonce/replay）→ approvedCrmWriteBoundary
 *   create_visit_record 分支 → createVisitWithProductRules。
 *   SCOPE：操作既有客户 → scope_requirement=CUSTOMER；唯一权威客户身份 =
 *   invocation.scope.customer_id（§7）。输入禁止携带 customer_id / customerId
 *   目标身份（出现即 INVALID_INPUT，执行器调用数 = 0）。
 *   IDEMPOTENCY：业务不幂等（重复确认会再次创建面访记录；nonce/重放保护与
 *   业务幂等分离）。
 *   AUDIT：audit_required=true / record_input=true / record_output=false /
 *   record_effect=true（A1 元数据；W3-2 事件仍保持载荷最小化）。
 *   OUTPUT：最小有用结果 { visit_id }。
 *
 * 本 manifest 刻意独立于 W3-3 冻结的写 manifest 与 W4-1/W4-2 manifest；
 * W4-3 以新 manifest 追加组合，绝不改写任何冻结定义。
 */

import type { CapabilityDefinition } from '../types';

/** W4-3 Visit Create 能力版本。 */
export const VISIT_CREATE_VERSION = '1.0.0' as const;

/** W4-3 Visit Create 能力身份（稳定身份 = id + version）。 */
export const VISIT_CREATE_CAPABILITY_IDS = {
  create: 'visit.create',
} as const;

/** Visit Create 审计契约：写操作要求审计，记录输入与效果。 */
const VISIT_CREATE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W4-3 Visit 域生产 create manifest：只注册经审计证明真实存在的
 * 人工"新增面访记录"产品能力（visit.create）。绝不注册 visit.update /
 * visit.delete / customer.delete / import.execute。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const VISIT_CREATE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: VISIT_CREATE_CAPABILITY_IDS.create,
    version: VISIT_CREATE_VERSION,
    domain: 'visit',
    description:
      'Create one Visit (面访记录) for an existing customer through the real product "新增面访记录" semantics (VisitForm create-mode + CustomerDetail.handleVisitSaved): the 7 human-editable fields are title (required; non-empty) plus optional visit_notes, customer_concerns, intent_after_visit, visit_outcome, next_action, expected_contract_at (`value || null` empty-string-to-null, exactly like the form); visited_at / id / created_at / updated_at are system-derived (now / generated), never accepted as input; and if visit_outcome is provided the visit-outcome rule (applyVisitOutcome) updates the customer state (grade/stage/next_action/next_follow_up_at/updated_at) exactly like the human path while discarding the rule-returned tasks (the human form creates no tasks). The target customer must already exist (never upsert/create; unknown customer fails closed). Executes only after exact human confirmation through the existing confirmed-write flow (nonce/replay-protected). This is a narrow visit-create primitive — NOT a generic visit.update/delete and cannot set system fields, arbitrary columns, or a fabricated customer identity. Not business-idempotent: confirming again may create another visit.',
    input_schema: 'visit.create.input.v1',
    output_schema: 'visit.create.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_FACT',
    risk_level: 'MEDIUM',
    authority_policy: 'POLICY_CONTROLLED',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:create_visit_record',
    audit_contract: { ...VISIT_CREATE_AUDIT },
    // 底层执行路径（db.createVisit / applyVisitOutcome → updateCustomer）无稳定错误码体系，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const VISIT_CREATE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  VISIT_CREATE_MANIFEST.map((definition) => definition.id),
);
