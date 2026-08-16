/**
 * V0.2C / C0 — Customer Opportunity Amount Update shared product service.
 *
 * 单一真源：把"记录/更新商机金额"的窄义产品语义提取到这里，让
 * Agent 确认后执行路径复用同一份产品组合（§11 产品语义对等）：
 *
 *   opportunity_amount（number|null）→ 存在性校验（绝不 upsert / create）
 *   → 值闭合校验（有限正数 或 null=清除为 unknown）
 *   → db.updateCustomer（只写 opportunity_amount 列）
 *   → 返回 { customer_id }
 *
 * 语义不变量（C0 冻结）：
 *   - opportunity_amount 是"用户确认/显式记录的期望商业金额"；
 *   - 绝不 AI 估算、阶段派生默认值、自动推断、假演示金额；
 *   - UNKNOWN 必须保持 null（本服务支持显式清除为 null）；
 *   - null 绝不渲染/聚合为 0（渲染与聚合语义由 board projection 层保证）。
 *
 * 本模块不实现输入安全护栏的"值规范化"（白名单键 / 类型校验属于能力绑定层
 * Layer 1 + confirmedWrite allowedFields Layer 2）；它只负责"给定已校验的
 * opportunity_amount 值，按最窄语义更新客户"，并作为第 3 层（approved boundary /
 * 产品服务）在运行时再次闭合——任何非 opportunity_amount 的载荷到达这里都 fail closed。
 *
 * 输出最小化：返回 { customer_id }，绝不返回完整客户行。
 */

import { getCustomer, updateCustomer } from './db';

/**
 * 权威允许键：本服务只接受这一个键。到达本服务的任何其它键都 fail closed
 * （绝不 strip、绝不透传），与 profile update 的 Layer 3 白名单同款防御。
 */
export const OPPORTUNITY_AMOUNT_UPDATE_KEY = 'opportunity_amount' as const;

/**
 * 确认后执行的最小真实产品"更新商机金额"执行器（Layer 3 纵深防御）。
 *
 * 值约束（C0 冻结）：
 *   - 有限正数（Number.isFinite 且 > 0）：记录期望商业金额；
 *   - null：显式清除为 unknown（UNKNOWN_AMOUNT_IS_NULL=true）；
 *   - 其它（NaN/Infinity/负数/0/字符串/对象）：fail closed。
 *
 * 目标客户必须存在（§8）：不存在 → truthful failure，零写入（绝不 upsert / create）。
 * 只写 opportunity_amount 列；不触发任何规则 / 状态迁移 / 任务创建。
 */
export async function updateCustomerOpportunityAmount(
  customerId: string,
  opportunityAmount: unknown,
): Promise<{ customer_id: string }> {
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    throw new Error('customer.opportunity_amount.update requires a non-empty customer_id.');
  }

  const isNull = opportunityAmount === null;
  const isPositiveNumber =
    typeof opportunityAmount === 'number'
    && Number.isFinite(opportunityAmount)
    && opportunityAmount > 0;

  if (!isNull && !isPositiveNumber) {
    throw new Error(
      'customer.opportunity_amount.update requires a finite positive number or null (unknown).',
    );
  }

  // 存在性校验（§8）：未知客户 → truthful failure → 零写入。
  const existing = await getCustomer(customerId);
  if (!existing) {
    throw new Error(`customer.opportunity_amount.update target customer does not exist: ${customerId}`);
  }

  await updateCustomer(customerId, { opportunity_amount: isNull ? null : (opportunityAmount as number) });
  return { customer_id: customerId };
}
