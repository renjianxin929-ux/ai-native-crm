/**
 * V0.2A / A5R — Follow-up Read Capabilities Manifest.
 *
 * 本模块是 A5R 的独立领域 manifest：通过 A1 的 createCapabilityRegistry(...manifests)
 * 组合缝注册，不修改 A1 中央文件（types.ts / registry.ts / index.ts），不创建中央
 * ALL_CAPABILITIES 数组，不引入任何 db / executor / network / provider 语义。
 *
 * 能力清单（仅注册经过审计证明的真实产品能力，见 FOLLOWUP_PRODUCT_INVENTORY）：
 *   1. follow_up.customer.read — 客户作用域跟进记录读取。
 *      真实产品路径：local-crm-desktop/src/lib/db.ts listFollowUps(customerId)
 *      （SELECT * FROM follow_up_records WHERE customer_id = ? ORDER BY created_at DESC），
 *      被 CustomerDetail.tsx 消费。
 *   2. follow_up.global.read — 全局跟进记录读取（全量、created_at 倒序）。
 *      真实产品路径：local-crm-desktop/src/lib/db.ts listAllFollowUps()，
 *      被 FollowUpRecords.tsx（/follow-ups 页面）消费。
 *
 * 未注册（产品不存在该能力）：
 *   - 单条跟进记录读取（无 getFollowUp / followUpById 执行路径）→ NOT_EXISTING
 *   - upcoming / overdue / followup_summary 等分类（产品未定义）→ 不发明
 *
 * 依赖边界：本文件唯一允许的 import 是 type-only 的 '../types'（与 A1 registry.ts 一致）。
 */

import type { CapabilityDefinition } from '../types';

/** A5R 领域名（A1 registry.ts 组合注释中预留的 follow-up 域）。 */
export const FOLLOW_UP_DOMAIN = 'follow-up' as const;

/** A5R 生产能力版本。 */
export const FOLLOW_UP_READ_VERSION = '1.0.0' as const;

/** A5R 生产能力身份（稳定身份 = id + version）。 */
export const FOLLOW_UP_CAPABILITY_IDS = {
  customerRead: 'follow_up.customer.read',
  globalRead: 'follow_up.global.read',
} as const;

/**
 * A5R 生产 manifest：只包含审计证明存在的真实产品能力。
 * 只读数组；通过 A1 组合缝注册，绝不写入 A1 中央文件。
 */
export const FOLLOW_UP_READ_MANIFEST: readonly CapabilityDefinition[] = [
  {
    id: FOLLOW_UP_CAPABILITY_IDS.customerRead,
    version: FOLLOW_UP_READ_VERSION,
    domain: FOLLOW_UP_DOMAIN,
    description:
      'Read Follow-up records for one customer from the persisted follow_up_records domain, ordered by created_at descending (parity with db.listFollowUps).',
    input_schema: 'follow_up.customer.query.v1',
    output_schema: 'follow_up.records.v1',
    effect: 'READ',
    // A1 词汇：CRM_STATE = 任务、跟进、工作项等可变状态。
    data_target: 'CRM_STATE',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'CUSTOMER',
    idempotency: 'SAFE',
    executor_ref: 'db:listFollowUps',
    audit_contract: {
      audit_required: true,
      record_input: true,
      record_output: true,
      record_effect: false,
    },
    // 底层执行路径（db.listFollowUps）未承诺稳定错误类别，如实声明。
    error_contract: 'UNSPECIFIED',
  },
  {
    id: FOLLOW_UP_CAPABILITY_IDS.globalRead,
    version: FOLLOW_UP_READ_VERSION,
    domain: FOLLOW_UP_DOMAIN,
    description:
      'Read all Follow-up records across customers from the persisted follow_up_records domain, ordered by created_at descending (parity with db.listAllFollowUps; backs the /follow-ups product page).',
    input_schema: 'follow_up.global.query.v1',
    output_schema: 'follow_up.records.v1',
    effect: 'READ',
    data_target: 'CRM_STATE',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'GLOBAL',
    idempotency: 'SAFE',
    executor_ref: 'db:listAllFollowUps',
    audit_contract: {
      audit_required: true,
      record_input: true,
      record_output: true,
      record_effect: false,
    },
    error_contract: 'UNSPECIFIED',
  },
];
