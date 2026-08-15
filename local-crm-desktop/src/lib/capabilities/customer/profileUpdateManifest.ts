/**
 * V0.2A / W4-2 — Customer Profile Update Capability Manifest (domain: customer).
 *
 * 本模块是 W4-2（customer.profile.update）的 Customer 域能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读/写 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（W4-2 独立审计）────────────────────────────────────────────
 * customer.profile.update — REAL（注册为本 manifest 的唯一新生产能力）。
 *   REAL_PRODUCT_CAPABILITY：产品存在真实"编辑客户资料"人工流程（CustomerForm
 *   edit-mode，src/components/CustomerForm.tsx:56-133）。该流程的用户可编辑 20 个
 *   表单字段中，经 §3 字段分类审计，只有 16 个是"普通资料字段"（name / wechat_id /
 *   phone_number / wechat_search_status / is_key_decision_maker / contact_method /
 *   notes / website / region / industry / contact_person / email / address /
 *   pitch_angle / qualification_reason / source）：
 *     - wechat_add_status / intent_level / phone_feedback 触发 Rule 2 / Rule 3
 *       （applyWechatPassed / applyIntentRule → 等级、阶段、下次跟进、任务），
 *       属规则自有信号，不是资料字段（§4 / §13）；
 *     - rough_visit_time_text 修改会驱动系统自有派生列（parsed_visit_reminder_at /
 *       time_parse_status / time_parse_note），属派生/系统语义，不是资料字段；
 *     - next_follow_up_at 由 customer.next_follow_up_time.update 专属拥有（§12）。
 *   该语义已提取为共享产品服务 src/lib/customerProfileUpdate.ts
 *   （updateCustomerProfile：存在性校验 + 仅资料列写入 + 运行时白名单闭合），
 *   人工编辑路径与 Agent 确认后执行路径复用同一份产品语义。
 *   REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR：
 *   salesAgentWriteTool:update_customer_profile（新写工具身份，仅存在于本 W4-2
 *   confirmed-write 链路；绝不复活死符号 update_customer_basic_fields /
 *   update_contact_basic_fields，其 allowedFields 与资料契约不一致）→ 现有确认
 *   运行时（sessionWriteStateStore canonical proposal + confirmWriteByRef +
 *   consumeExactConfirmation nonce/replay）→ approvedCrmWriteBoundary
 *   update_customer_profile 分支 → updateCustomerProfile。
 *   SCOPE：操作既有客户 → scope_requirement=CUSTOMER；唯一权威客户身份 =
 *   invocation.scope.customer_id（§7）。输入禁止携带 customer_id / customerId
 *   目标身份（出现即 INVALID_INPUT，执行器调用数 = 0）。
 *   IDEMPOTENCY：业务不幂等（重复确认会再次写入资料且 updated_at 变化；
 *   nonce/重放保护与业务幂等分离）。
 *   AUDIT：audit_required=true / record_input=true / record_output=false /
 *   record_effect=true（A1 元数据；W3-2 事件仍保持载荷最小化）。
 *   OUTPUT：最小有用结果 { customer_id }。
 *
 * 本 manifest 刻意独立于 CUSTOMER_CREATE_MANIFEST（W4-1）与 CUSTOMER_WRITE_MANIFEST
 * （W3-3 冻结）；W4-2 以新 manifest 追加组合，绝不改写任何冻结定义。
 */

import type { CapabilityDefinition } from '../types';

/** W4-2 Customer Profile Update 能力版本。 */
export const CUSTOMER_PROFILE_UPDATE_VERSION = '1.0.0' as const;

/** W4-2 Customer Profile Update 能力身份（稳定身份 = id + version）。 */
export const CUSTOMER_PROFILE_UPDATE_CAPABILITY_IDS = {
  profileUpdate: 'customer.profile.update',
} as const;

/** Customer Profile Update 审计契约：写操作要求审计，记录输入与效果。 */
const CUSTOMER_PROFILE_UPDATE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W4-2 Customer 域生产 profile update manifest：只注册经审计证明真实存在的
 * 窄语义"普通客户资料字段部分更新"生产能力（customer.profile.update）。
 * 绝不注册 customer.update / customer.state.update / customer.grade.update /
 * customer.stage.update / customer.payment.update / customer.delete /
 * visit.create / import.execute。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const CUSTOMER_PROFILE_UPDATE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: CUSTOMER_PROFILE_UPDATE_CAPABILITY_IDS.profileUpdate,
    version: CUSTOMER_PROFILE_UPDATE_VERSION,
    domain: 'customer',
    description:
      'Partially update only the ordinary customer profile fields of one existing customer (name, wechat_id, phone_number, wechat_search_status, is_key_decision_maker, contact_method, notes, website, region, industry, contact_person, email, address, pitch_angle, qualification_reason, source) through the real product "编辑客户" semantics (CustomerForm edit-mode): empty string clears to null exactly like the form (`value || null`), undefined means unchanged, only provided profile columns are written, the target customer must already exist (never upsert/create), and NO product rule / state transition / task runs (wechat_add_status / intent_level / phone_feedback are rule-owned signals and are NOT profile fields; rough_visit_time_text is excluded because it drives system-owned derived parse columns; next_follow_up_at stays owned by customer.next_follow_up_time.update). The proposal carries bounded current vs proposed values for the changed profile fields and executes only after exact human confirmation through the existing confirmed-write flow (nonce/replay-protected). This is a narrow profile-edit primitive — it is NOT a generic customer.update and cannot set rule-owned state, system fields, or any other column.',
    input_schema: 'customer.profile.update.patch.v1',
    output_schema: 'customer.profile.update.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_FACT',
    risk_level: 'MEDIUM',
    authority_policy: 'POLICY_CONTROLLED',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:update_customer_profile',
    audit_contract: { ...CUSTOMER_PROFILE_UPDATE_AUDIT },
    // 底层执行路径（db.updateCustomer）无稳定错误码体系，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const CUSTOMER_PROFILE_UPDATE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  CUSTOMER_PROFILE_UPDATE_MANIFEST.map((definition) => definition.id),
);
