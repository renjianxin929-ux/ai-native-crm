/**
 * V0.2A / A4R — Timeline / Interaction READ Capability Manifest (domain: timeline).
 *
 * 本模块是 Timeline 域的独立可组合 manifest（A1 扩展缝：createCapabilityRegistry(...manifests)）。
 * - 纯声明式：只描述能力，不包含任何执行 / DB / 网络 / 模型语义。
 * - 只注册经独立审计证明在当前产品中真实存在的 READ 能力（§10 INVENTORY TRUTH）。
 * - 执行器绑定 = 真实当前产品读取路径（不是 legacy agent 工具快照投影）。
 * - 不修改 A1 中心文件（types.ts / registry.ts / index.ts）。
 * - 不注册 Summarize（INTERACTION_SUMMARY 为 REAL_TEXT_MODEL 意图，模型绑定，非确定性产品读取能力）。
 * - 不注册 Follow-up 独立能力（属于 A5R 域）；Timeline 聚合投影源自现有产品行为。
 *
 * LEGACY_AGENT_TOOL_SEMANTIC_MISMATCH（记录，不在本分支修复）：
 *   salesAgentTools/registry.ts 的 get_customer_timeline / list_customer_followups /
 *   list_customer_visits 三个现有 agent 工具共享 tasks + work_items 快照投影
 *   （registry.ts 三分支共享实现），并不读取 follow_up_records / visit_records 表，
 *   与真实产品读取路径语义不一致。A4R 不绑定、不修复这些工具；它们属于后续
 *   专门 closure（Agent 运行时修复分支）。
 */

import type { CapabilityDefinition } from '../types';

/**
 * timeline.customer.read — 读取指定客户的 Timeline。
 *
 * 真实产品来源（A4R 之前已存在）：
 * - db.ts listFollowUps(customerId)（follow_up_records，WHERE customer_id = ? ORDER BY created_at DESC）
 * - db.ts listVisits(customerId)（visit_records，WHERE customer_id = ? ORDER BY created_at DESC）
 * - components/salesWorkspace/CustomerIntelligencePanel.tsx buildCustomerTimeline
 *   （public export 纯函数投影：合并 follow-ups + visits，occurredAt 降序
 *   [follow-up 用 updated_at；visit 用 visited_at || updated_at]，保留 evidenceId）
 * - 产品 UI 使用路径：CustomerDetail.tsx → listFollowUps / listVisits → buildCustomerTimeline
 *
 * 本能力绑定上述真实产品读取组合；不复制 SQL、不复制过滤、不发明第二投影。
 *
 * data_target 论证：Timeline 的本质是事实性互动/记录的时间投影（follow-ups、visits
 * 为 CRM_FACT 证据化记录），故声明 CRM_FACT。
 * error_contract 说明：现有产品读取函数（db.ts listFollowUps/listVisits）以 Error
 * message 区分失败、无稳定错误码体系，故如实声明 UNSPECIFIED。
 */
const timelineCustomerRead: CapabilityDefinition = {
  id: 'timeline.customer.read',
  version: '1.0.0',
  domain: 'timeline',
  description: 'Read the customer-scoped Timeline projection through the real product read path (db.ts listFollowUps + listVisits → buildCustomerTimeline; occurredAt descending; evidenceId preserved).',
  input_schema: 'timeline.customer.read.input.v1',
  output_schema: 'timeline.customer.read.output.v1',
  effect: 'READ',
  data_target: 'CRM_FACT',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'CUSTOMER',
  idempotency: 'SAFE',
  executor_ref: 'crm:listFollowUps+listVisits→buildCustomerTimeline',
  audit_contract: {
    audit_required: true,
    record_input: true,
    record_output: true,
    record_effect: false,
  },
  error_contract: 'UNSPECIFIED',
};

/**
 * timeline.visit.read — 读取指定客户的 Visit（面访）交互记录。
 *
 * 真实产品来源（A4R 之前已存在）：
 * - db.ts listVisits(customerId)：visit_records 表，WHERE customer_id = ?
 *   ORDER BY created_at DESC（真实产品 Visit 读取函数，产品 UI CustomerDetail 使用）
 *
 * 本能力绑定该真实产品读取函数。全局 listAllVisits 属于全局读取，不作为
 * 客户范围能力暴露（§12）。
 */
const timelineVisitRead: CapabilityDefinition = {
  id: 'timeline.visit.read',
  version: '1.0.0',
  domain: 'timeline',
  description: 'Read the customer-scoped Visit records through the real product read function db.ts listVisits (visit_records, customer-scoped).',
  input_schema: 'timeline.visit.read.input.v1',
  output_schema: 'timeline.visit.read.output.v1',
  effect: 'READ',
  data_target: 'CRM_FACT',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'CUSTOMER',
  idempotency: 'SAFE',
  executor_ref: 'crm:listVisits',
  audit_contract: {
    audit_required: true,
    record_input: true,
    record_output: true,
    record_effect: false,
  },
  error_contract: 'UNSPECIFIED',
};

/**
 * Timeline 域生产 manifest：仅包含经审计确认真实存在的确定性 READ 能力，
 * 且执行器绑定真实当前产品读取路径。冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const TIMELINE_READ_CAPABILITY_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  timelineCustomerRead,
  timelineVisitRead,
]);
