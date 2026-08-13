/**
 * V0.2A / W3-3 — Follow-up WRITE Capability Manifest (domain: follow-up).
 *
 * 本模块是 W3-3（Existing Write Capability Registration）的 Follow-up 域写能力 manifest：
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'（与 A1 registry.ts 依赖边界一致）。
 * - 不修改 A1 中央文件（types.ts / registry.ts / index.ts）、不修改 authority/**、
 *   不修改现有读 manifest、不修改任何生产写运行时。
 * - 通过 A1 扩展缝（createCapabilityRegistry(...manifests)）独立组合；测试直接 import。
 *
 * ── 库存真相（W3-3 独立审计）────────────────────────────────────────────
 * 候选：follow-up creation（create follow-up）。
 *
 * REAL_PRODUCT_CAPABILITY:
 *   产品存在真实的"新增跟进记录"写入行为：Sales Agent 交互工作台
 *   （components/aiNative/SalesAgentInteractionWorkspace.tsx）将写意图
 *   （writeIntent.classifyClosedWriteIntent → CREATE_FOLLOW_UP_REQUEST →
 *   tool_id 'create_follow_up_record'）生成为需人工确认的 Proposal，
 *   人工确认后经安全写边界执行；此外 Capture 复核流
 *   （agentSession.createProposalFromReviewedFacts）也走 create_follow_up_record。
 *
 * REAL_PRODUCTION_REACHABLE_AGENT_EXECUTOR:
 *   'create_follow_up_record' ∈ confirmedWrite.AGENT_WRITE_TOOL_IDS（稳定写工具 ID），
 *   approvedCrmWriteBoundary.executeOne（approvedCrmWriteBoundary.ts:47-50）
 *   构造 FollowUpRecord 并调用 repository.createFollowUp → db.createFollowUp
 *   （INSERT INTO follow_up_records）。执行链：
 *   writeIntent → agentSession.emitWriteProposal → registerCanonicalProposal →
 *   人工确认（confirmWriteByRef + consumeExactConfirmation）→
 *   approvedCrmWriteBoundary.execute → db.createFollowUp。
 *
 * SEMANTIC_PARITY:
 *   创建的记录是 follow_up_records 行（Follow-up 实体），customer_id 显式携带；
 *   不创建 Task / work_item / Timeline 等其他记录。
 *
 * 不注册（W3-3 范围外 / 无生产可执行路径）：
 *   - follow_up.update / follow_up.complete / follow_up.delete：剩余缺口审计
 *     证明当前不存在这些生产可执行语义，不注册。
 *
 * ── A1 语义分类 ────────────────────────────────────────────────────────
 * effect=WRITE（持久化创建 CRM 跟进记录；非 READ/ANALYZE/DRAFT）。
 * data_target=CRM_STATE（A1 词汇注释明确把"跟进"列为 CRM_STATE 可变状态；
 *   与 A5R follow_up.customer.read 的 data_target=CRM_STATE 一致）。
 * risk_level=LOW（低风险单条记录创建，可审计、可撤销语义为 reversible）。
 * authority_policy=POLICY_CONTROLLED（A10 受控策略：WRITE 一律 REQUIRE_CONFIRMATION，
 *   与产品"提案→人工确认"运行时语义一致；低风险写入不直接声明 AUTO）。
 * requires_confirmation=true（产品写运行时对每条写提案都要求显式人工确认）。
 * scope_requirement=CUSTOMER（写提案强制携带非空 customer_id，见
 *   validateAgentWriteProposal：空 customer_id 直接拒绝）。
 * idempotency=NONE（create 操作重复执行会产生多条记录；confirmedWrite 的
 *   nonce/重放保护只保证单次消费，不等于业务幂等——W3-3 明确区分）。
 * executor_ref='salesAgentWriteTool:create_follow_up_record'（稳定写工具 ID，
 *   由 approvedCrmWriteBoundary 执行；W3-1 后续负责生产绑定解析）。
 */

import type { CapabilityDefinition } from '../types';

/** W3-3 Follow-up 写能力版本。 */
export const FOLLOW_UP_WRITE_VERSION = '1.0.0' as const;

/** W3-3 Follow-up 写能力身份（稳定身份 = id + version）。 */
export const FOLLOW_UP_WRITE_CAPABILITY_IDS = {
  create: 'follow_up.create',
} as const;

/**
 * Follow-up 写能力审计契约：写操作要求审计，记录输入与效果（副作用结果），
 * 不记录输出（写结果不产生需审计的输出负载）。
 */
const FOLLOW_UP_WRITE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W3-3 Follow-up 域生产写 manifest：仅注册经独立审计证明真实存在的
 * follow-up 创建能力。冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const FOLLOW_UP_WRITE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: FOLLOW_UP_WRITE_CAPABILITY_IDS.create,
    version: FOLLOW_UP_WRITE_VERSION,
    domain: 'follow-up',
    description:
      'Create a Follow-up record for an explicit customer through the existing confirmed-write path (writeIntent create_follow_up_record → approvedCrmWriteBoundary → db.createFollowUp → INSERT INTO follow_up_records). The proposal is generated from a closed write intent, registered as a canonical proposal, and executes only after exact human confirmation (nonce/replay-protected). The created record is a Follow-up entity (follow_up_records row) scoped to the proposal customer_id; no Task/work_item/Timeline record is created instead. Not naturally idempotent: repeated execution creates additional records.',
    input_schema: 'follow_up.create.proposal.v1',
    output_schema: 'follow_up.create.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'LOW',
    authority_policy: 'POLICY_CONTROLLED',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'salesAgentWriteTool:create_follow_up_record',
    audit_contract: { ...FOLLOW_UP_WRITE_AUDIT },
    // 底层执行路径（db.createFollowUp）无稳定错误码体系，如实声明（与 A5R 一致）。
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const FOLLOW_UP_WRITE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  FOLLOW_UP_WRITE_MANIFEST.map((definition) => definition.id),
);
