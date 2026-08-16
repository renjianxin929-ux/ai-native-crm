/**
 * V0.2C / C0 — Customer Opportunity Amount Update Capability Manifest (domain: customer).
 *
 * 本模块是 C0（customer.opportunity_amount.update）的 Customer 域能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读/写 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（C0 独立审计）────────────────────────────────────────────
 * customer.opportunity_amount.update — REAL（注册为本 manifest 的唯一新生产能力）。
 *   REAL_PRODUCT_NEED：个人商机看板需要"真实商机金额"；全仓库审计证明现有字段
 *   无一真值表达"活跃商机的期望商业金额"：
 *     - deal_amount（成交金额）语义为已成交交易金额，且当前产品无任何写入路径，
 *       重解释为活跃商机金额会篡改现有字段语义（C0 §1 禁止）；
 *     - visit_records.expected_contract_at 是"预计签约时间"（日期），非金额；
 *     - 无 expected_amount / quote_amount / opportunity_amount / contract_amount /
 *       order_amount / pipeline amount 字段。
 *   因此新增一个窄义可空列 customers.opportunity_amount（REAL, nullable）。
 *   REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR：
 *   salesAgentWriteTool:update_opportunity_amount（新写工具身份，仅存在于本 C0
 *   confirmed-write 链路）→ 现有确认运行时（sessionWriteStateStore canonical
 *   proposal + confirmWriteByRef + consumeExactConfirmation nonce/replay）→
 *   approvedCrmWriteBoundary update_opportunity_amount 分支 →
 *   updateCustomerOpportunityAmount（共享产品服务）。
 *   SCOPE：操作既有客户 → scope_requirement=CUSTOMER；唯一权威客户身份 =
 *   invocation.scope.customer_id。输入禁止携带 customer_id / customerId
 *   目标身份（出现即 INVALID_INPUT，执行器调用数 = 0）。
 *   IDEMPOTENCY：业务不幂等（重复确认会再次写入金额；nonce/重放保护与业务幂等分离）。
 *   AUDIT：audit_required=true / record_input=true / record_output=false /
 *   record_effect=true（A1 元数据；W3-2 事件仍保持载荷最小化）。
 *   OUTPUT：最小有用结果 { customer_id }。
 *
 * 本 manifest 刻意独立于 W3-3 冻结写 manifest 与 W4-1/W4-2/W4-4/W4-3 manifest；
 * C0 以新 manifest 追加组合，绝不改写任何冻结定义。
 */

import type { CapabilityDefinition } from '../types';

/** C0 Opportunity Amount Update 能力版本。 */
export const OPPORTUNITY_AMOUNT_UPDATE_VERSION = '1.0.0' as const;

/** C0 Opportunity Amount Update 能力身份（稳定身份 = id + version）。 */
export const OPPORTUNITY_AMOUNT_UPDATE_CAPABILITY_IDS = {
  update: 'customer.opportunity_amount.update',
} as const;

/** Opportunity Amount Update 审计契约：写操作要求审计，记录输入与效果。 */
const OPPORTUNITY_AMOUNT_UPDATE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * C0 Customer 域生产 manifest：只注册经审计证明真实需要且语义最窄的
 * "商机金额更新"生产能力（customer.opportunity_amount.update）。
 * 绝不注册 customer.update / customer.amount.update（泛化）/ customer.stage.update /
 * customer.deal_amount.update（重解释 deal_amount）。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const OPPORTUNITY_AMOUNT_UPDATE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: OPPORTUNITY_AMOUNT_UPDATE_CAPABILITY_IDS.update,
    version: OPPORTUNITY_AMOUNT_UPDATE_VERSION,
    domain: 'customer',
    description:
      'Record or clear the explicitly user-confirmed expected commercial amount (customers.opportunity_amount) of one existing customer through the confirmed-write path. The value must be a finite positive number (a recorded expected amount) or null (explicitly clear back to unknown); negative, zero, NaN/Infinity, strings and objects are rejected. The amount is ONLY ever an explicitly confirmed/recorded value — it is never an AI-estimated company value, never a stage-derived default, never an automatically inferred amount, and never a fake demo amount. UNKNOWN stays NULL, and NULL is never rendered or aggregated as zero. The proposal carries the stored current value (current_values.opportunity_amount) before registration and executes only after exact human confirmation (nonce/replay-protected) through updateCustomerOpportunityAmount, which writes only the opportunity_amount column (no rule/state/task side effects). This is a narrow single-field amount primitive — it is NOT a generic customer.update, NOT a stage update, and must not reinterpret or mutate deal_amount (成交金额). Not business-idempotent: confirming again overwrites the amount.',
    input_schema: 'customer.opportunity_amount.update.input.v1',
    output_schema: 'customer.opportunity_amount.update.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_FACT',
    risk_level: 'MEDIUM',
    authority_policy: 'CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:update_opportunity_amount',
    audit_contract: { ...OPPORTUNITY_AMOUNT_UPDATE_AUDIT },
    // 底层执行路径（db.updateCustomer）无稳定错误码体系，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const OPPORTUNITY_AMOUNT_UPDATE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  OPPORTUNITY_AMOUNT_UPDATE_MANIFEST.map((definition) => definition.id),
);
