/**
 * V0.2A / W4-2 — Customer Profile Update shared product service.
 *
 * 单一真源：把 CustomerForm "编辑客户"（edit-mode）中"普通客户资料字段"的
 * 产品语义提取到这里，让人工 UI 路径与 Agent 确认后执行路径复用同一份
 * 产品组合（§11 产品语义对等）：
 *
 *   patch（仅普通资料字段）→ 存在性校验（绝不 upsert / 绝不 create）
 *   → db.updateCustomer（只写 patch 中提供的资料列）
 *   → 返回 { customer_id }
 *
 * ── 与 CustomerForm edit-mode 的产品对等 ───────────────────────────────
 * 人工编辑客户资料时（CustomerForm.tsx:93-118），用户可编辑的 20 个字段中，
 * 只有 16 个是"普通资料字段"（见 CUSTOMER_PROFILE_UPDATE_KEYS）：
 *   - 空串 → null（表单 `value || null` 的清除语义，逐字段复用）；
 *   - undefined → 不变（部分更新；人工表单是全量保存，Agent patch 是部分更新，
 *     两者在"只改提交的字段"上等价——db.updateCustomer 只写提供的列）；
 *   - 值校验与枚举校验由能力绑定层（Layer 1）完成，本服务只做纵深防御。
 * 刻意排除（非资料语义，见 manifest 字段分类表）：
 *   - wechat_add_status / intent_level / phone_feedback：触发 Rule 2 / Rule 3
 *     （等级/阶段/下次跟进/任务），属规则自有字段，绝不进入本服务；
 *   - rough_visit_time_text：修改它会驱动系统自有派生列（parsed_visit_reminder_at /
 *     time_parse_status / time_parse_note），本服务绝不触碰派生/系统列；
 *   - next_follow_up_at：customer.next_follow_up_time.update 专属（§12）；
 *   - stage / customer_grade / payment_* / battle_card_* 等：规则/系统自有。
 *
 * 本模块不实现任何输入安全护栏的"值规范化"（白名单键 / 枚举 / fail-closed 属于
 * 能力绑定层 + confirmedWrite allowedFields）；它只负责"给定已校验的产品资料字段，
 * 按人工 CustomerForm 完全相同的方式更新客户"，并作为第 3 层（approved boundary /
 * 产品服务）在运行时再次关闭白名单——任何非资料字段到达这里都 fail closed。
 *
 * 输出最小化（W4-2 契约）：返回 { customer_id }，绝不返回完整客户行。
 */

import { getCustomer, updateCustomer } from './db';

/**
 * 普通客户资料字段白名单（权威清单；W4-2 审计结论，见 manifest 字段分类表）。
 * 与 confirmedWrite.allowedFields['update_customer_profile']（Layer 2）及
 * 能力绑定层输入白名单（Layer 1）为同一集合，测试断言三者一致。
 */
export const CUSTOMER_PROFILE_UPDATE_KEYS: readonly string[] = Object.freeze([
  'name',
  'wechat_id',
  'phone_number',
  'wechat_search_status',
  'is_key_decision_maker',
  'contact_method',
  'notes',
  'website',
  'region',
  'industry',
  'contact_person',
  'email',
  'address',
  'pitch_angle',
  'qualification_reason',
  'source',
]);

const PROFILE_KEY_SET: ReadonlySet<string> = new Set<string>(CUSTOMER_PROFILE_UPDATE_KEYS);

/**
 * 确认后执行的最小真实产品资料更新执行器（§18）。
 *
 * 纵深防御（Layer 3）：
 * - 白名单键闭合：patch 中任何非资料键一律 fail closed（绝不 strip、绝不透传）；
 * - 至少一个资料字段（空 patch fail closed）；
 * - 拒绝 undefined 值（patch 中的值必须是具体产品值；undefined = 未提供，不在 patch 中）；
 * - name 非空（人工表单阻止空名称提交）；
 * - 目标客户必须存在（§8）：不存在 → truthful failure，零写入（绝不 upsert / create）。
 *
 * 只写 patch 提供的资料列（db.updateCustomer 的 repository 层对白名单外键只警告不写，
 * 而本服务在更上层就保证到达它的键全部在白名单内）；不触发任何规则 / 状态迁移 /
 * 任务创建。返回 { customer_id }（最小输出契约）。
 */
export async function updateCustomerProfile(
  customerId: string,
  patch: Readonly<Record<string, unknown>>,
): Promise<{ customer_id: string }> {
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    throw new Error('customer.profile.update requires a non-empty customer_id.');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('customer.profile.update patch must be a plain object.');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new Error('customer.profile.update requires at least one profile field.');
  }
  for (const key of keys) {
    if (!PROFILE_KEY_SET.has(key)) {
      throw new Error(`customer.profile.update rejects non-profile field: ${key}`);
    }
    if (patch[key] === undefined) {
      throw new Error(`customer.profile.update field ${key} must be a concrete product value.`);
    }
  }
  // name 纵深防御：人工表单阻止空名称提交（编辑模式 name 必填）。
  const rawName = patch['name'];
  if (rawName !== undefined && (typeof rawName !== 'string' || rawName.trim().length === 0)) {
    throw new Error('customer.profile.update name must be a non-empty string.');
  }
  // 存在性校验（§8）：未知客户 → truthful failure → 零资料更新。
  const existing = await getCustomer(customerId);
  if (!existing) {
    throw new Error(`customer.profile.update target customer does not exist: ${customerId}`);
  }
  const updates: Record<string, unknown> = {};
  for (const key of keys) {
    updates[key] = patch[key];
  }
  await updateCustomer(customerId, updates);
  return { customer_id: customerId };
}
