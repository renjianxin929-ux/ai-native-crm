/**
 * V0.2A / W3-3 — Customer WRITE Capability Manifest (domain: customer).
 *
 * 本模块是 W3-3（Existing Write Capability Registration）的 Customer 域写能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读 manifest、生产写运行时。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 库存真相（W3-3 独立审计）────────────────────────────────────────────
 * 候选（高风险能力膨胀区，逐项独立审计）：
 *
 * 1) update_next_follow_up_time — REAL（注册为本 manifest 的唯一写能力）。
 *    REAL_PRODUCT_CAPABILITY：产品存在真实"更新下次跟进时间"写入行为：
 *    writeIntent.classifyClosedWriteIntent → UPDATE_CUSTOMER_REQUEST →
 *    tool_id 'update_next_follow_up_time'（proposed_values 只含 next_follow_up_at）。
 *    REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR：
 *    approvedCrmWriteBoundary.executeOne（approvedCrmWriteBoundary.ts:55-57）对
 *    update_next_follow_up_time 调用 repository.updateCustomer(customer_id, values) →
 *    db.updateCustomer（仅写入 values 中的 next_follow_up_at 字段）。
 *    执行链：writeIntent → agentSession.emitWriteProposal（要求 current_values 携带
 *    当前存储值，见 currentValuesForTool / buildWriteProposal）→ 人工确认 →
 *    approvedCrmWriteBoundary.execute → db.updateCustomer。
 *    SEMANTIC_PARITY：只更新客户的下一次跟进调度字段，绝不暗示任意客户字段变更。
 *
 * 2) update_customer_basic_fields — NOT_REGISTERED。
 *    approvedCrmWriteBoundary 存在执行分支（55-57 行同一分支），但全仓库审计
 *    证明不存在正常生产 write-intent 生成路径：classifyClosedWriteIntent 永不产出
 *    该 tool_id，任何 UI/Agent 调用方都不构建该 tool_id 的 Proposal
 *    （唯一出现点是测试 fixture stage12ConfirmedWrite.test.ts 与符号声明）。
 *    按 W3-3 规则：有边界分支 ≠ 有真实生产生成/调用路径 → 不注册。
 *
 * 3) update_contact_basic_fields — NOT_REGISTERED（死声明）。
 *    approvedCrmWriteBoundary 无执行分支（会抛 "Requested write tool is not
 *    supported"），仅存在于 confirmedWrite.AGENT_WRITE_TOOL_IDS 符号表与
 *    allowedFields —— 死声明 / 不可执行分支，绝不成为能力。
 *
 * 4) generic customer.update — NOT_REGISTERED。
 *    未证明存在"任意客户字段变更"的通用稳定 Agent 能力；只注册窄语义
 *    customer.next_follow_up_time.update（= 上面 1) 的真实可执行范围）。
 *
 * ── A1 语义分类 ────────────────────────────────────────────────────────
 * effect=WRITE（持久化变更客户 CRM 状态字段）。
 * data_target=CRM_STATE（next_follow_up_at 是调度/状态字段；A1 词汇注释：
 *   CRM_STATE = 任务、跟进、工作项等可变状态；W3-3 §20：scheduling/state
 *   transitions 归 CRM_STATE）。
 * risk_level=MEDIUM（变更客户记录字段，高于单条 create 的影响面；保守声明）。
 * authority_policy=CONFIRM（客户记录变更属较高影响写，显式要求人工确认；
 *   A10：CONFIRM → REQUIRE_CONFIRMATION）。
 * requires_confirmation=true（产品写运行时强制人工确认，且提案构造强制携带
 *   当前存储值 current_values.next_follow_up_at）。
 * scope_requirement=CUSTOMER（强制非空 customer_id；禁止缺省全局写、禁止跨客户写）。
 * idempotency=NONE（执行器不承诺业务幂等：不同值重复执行产生不同状态；
 *   nonce/重放保护 ≠ 业务幂等）。
 * executor_ref='salesAgentWriteTool:update_next_follow_up_time'（稳定写工具 ID，
 *   由 approvedCrmWriteBoundary 执行；W3-1 后续负责生产绑定解析）。
 */

import type { CapabilityDefinition } from '../types';

/** W3-3 Customer 写能力版本。 */
export const CUSTOMER_WRITE_VERSION = '1.0.0' as const;

/** W3-3 Customer 写能力身份（稳定身份 = id + version）。 */
export const CUSTOMER_WRITE_CAPABILITY_IDS = {
  nextFollowUpTimeUpdate: 'customer.next_follow_up_time.update',
} as const;

/** Customer 写能力审计契约：写操作要求审计，记录输入与效果。 */
const CUSTOMER_WRITE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W3-3 Customer 域生产写 manifest：只注册经审计证明真实存在且唯一可执行的
 * 窄语义客户写能力（next_follow_up_time 更新）。绝不注册 customer.update /
 * update_customer_basic_fields / update_contact_basic_fields。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const CUSTOMER_WRITE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: CUSTOMER_WRITE_CAPABILITY_IDS.nextFollowUpTimeUpdate,
    version: CUSTOMER_WRITE_VERSION,
    domain: 'customer',
    description:
      'Update only the next follow-up scheduling field of one customer (customers.next_follow_up_at) through the existing confirmed-write path (writeIntent update_next_follow_up_time → approvedCrmWriteBoundary → db.updateCustomer with exactly the next_follow_up_at field). The proposal requires the stored current value (current_values.next_follow_up_at) before registration and executes only after exact human confirmation (nonce/replay-protected). This is a narrow scheduling-state semantic — it is NOT a generic customer.update and does not imply arbitrary customer field mutation.',
    input_schema: 'customer.next_follow_up_time.update.proposal.v1',
    output_schema: 'customer.next_follow_up_time.update.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'MEDIUM',
    authority_policy: 'CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:update_next_follow_up_time',
    audit_contract: { ...CUSTOMER_WRITE_AUDIT },
    // 底层执行路径（db.updateCustomer）无稳定错误码体系，如实声明。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const CUSTOMER_WRITE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  CUSTOMER_WRITE_MANIFEST.map((definition) => definition.id),
);
