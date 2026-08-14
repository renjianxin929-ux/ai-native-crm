/**
 * V0.2A / W4-1 — Customer Create Capability Manifest (domain: customer).
 *
 * 本模块是 W4-1（customer.create）的 Customer 域能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读/写 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（W4-1 独立审计）────────────────────────────────────────────
 * customer.create — REAL（注册为本 manifest 的唯一新生产能力）。
 *   REAL_PRODUCT_CAPABILITY：产品存在真实"新增客户"人工流程（CustomerForm
 *   create-mode，src/components/CustomerForm.tsx:142-221）：form input →
 *   parseRoughTime → getDefaultCustomerGrade → calculateNextFollowUpAt →
 *   db.createCustomer → 后置产品规则（Rule 2 微信通过 / Rule 3 意向升级）。
 *   该语义已提取为共享产品服务 src/lib/customerCreate.ts
 *   （createCustomerWithProductRules），人工路径与 Agent 确认后执行路径复用。
 *   REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR：
 *   salesAgentWriteTool:create_customer（新写工具身份）→ 现有确认运行时
 *   （sessionWriteStateStore canonical proposal + confirmWriteByRef +
 *   consumeExactConfirmation nonce/replay）→ approvedCrmWriteBoundary
 *   create_customer 分支 → createCustomerWithProductRules。
 *   SCOPE：创建前客户不存在 → scope_requirement=NONE（不伪造 CUSTOMER scope；
 *   输入禁止携带 customer_id / customerId 目标身份）。
 *   IDEMPOTENCY：业务不幂等（重复确认可能再创建一个客户）；nonce/重放保护
 *   与业务幂等分离。
 *   AUDIT：audit_required=true / record_input=true / record_output=false /
 *   record_effect=true（A1 元数据；W3-2 事件仍保持载荷最小化）。
 *   OUTPUT：最小有用结果 { customer_id }。
 *
 * 本 manifest 刻意独立于 CUSTOMER_WRITE_MANIFEST（W3-3 写 manifest 冻结于
 * W3-3 审计基线）；W4-1 以新 manifest 追加组合，绝不改写 W3-3 冻结定义。
 */

import type { CapabilityDefinition } from '../types';

/** W4-1 Customer Create 能力版本。 */
export const CUSTOMER_CREATE_VERSION = '1.0.0' as const;

/** W4-1 Customer Create 能力身份（稳定身份 = id + version）。 */
export const CUSTOMER_CREATE_CAPABILITY_IDS = {
  create: 'customer.create',
} as const;

/** Customer Create 审计契约：写操作要求审计，记录输入与效果。 */
const CUSTOMER_CREATE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W4-1 Customer 域生产 create manifest：只注册经审计证明真实存在的
 * 人工"新增客户"产品能力（customer.create）。绝不注册 customer.update /
 * customer.delete / visit.create / import.execute。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const CUSTOMER_CREATE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: CUSTOMER_CREATE_CAPABILITY_IDS.create,
    version: CUSTOMER_CREATE_VERSION,
    domain: 'customer',
    description:
      'Create one customer through the real product "新增客户" semantics (CustomerForm create-mode): rough visit time parse (parseRoughTime), initial grade (getDefaultCustomerGrade), initial follow-up (calculateNextFollowUpAt), db.createCustomer insert, and applicable post-create product rules (Rule 2 wechat-passed task / Rule 3 intent upgrade). The proposal carries only the human form fields (name required; all other product fields optional) and executes only after exact human confirmation through the existing confirmed-write flow (nonce/replay-protected). Scope is NONE (the customer does not exist before creation; no fabricated customer scope, no customer_id/customerId target identity). NOT business-idempotent: confirming again may create another customer.',
    input_schema: 'customer.create.input.v1',
    output_schema: 'customer.create.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_FACT',
    risk_level: 'MEDIUM',
    authority_policy: 'POLICY_CONTROLLED',
    requires_confirmation: true,
    scope_requirement: 'NONE',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:create_customer',
    audit_contract: { ...CUSTOMER_CREATE_AUDIT },
    // 底层执行路径（db.createCustomer / 产品规则）无稳定错误码体系，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const CUSTOMER_CREATE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  CUSTOMER_CREATE_MANIFEST.map((definition) => definition.id),
);
