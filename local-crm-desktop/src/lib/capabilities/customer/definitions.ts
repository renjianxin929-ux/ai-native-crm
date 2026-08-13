/**
 * V0.2A / A2 — Customer Read Capability Definitions.
 *
 * 仅注册经审计证明存在于当前产品中的 Customer 读取能力(见 inventory.ts)。
 * 每项定义完全符合 A1 CapabilityDefinition 契约:全部语义字段显式声明,
 * 无静默默认;effect=READ / requires_confirmation=false;authority=AUTO
 * (与现有只读工具 access='read'、requires_confirmation=false 声明一致)。
 *
 * executor_ref 引用现有已注册 Sales Agent 只读工具(A1 声明的引用风格
 * 'salesAgentTool:<tool_id>'),执行器绑定见 readAdapter.ts。
 *
 * 导出集合经深度冻结:元素对象(含 audit_contract)不可变,不引入可变契约状态。
 * 组合进 A1 registry 后,registry 的 clone+deepFreeze 机制再次保证不可变性。
 */

import type { CapabilityDefinition } from '../types';

/** 深度冻结(与 A1 registry 相同的防御模式;元素深度仅两层:definition + audit_contract)。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Search Customer — 组合级(portfolio)客户搜索,现有注册工具 search_customers。 */
const SEARCH_CUSTOMER_DEFINITION: CapabilityDefinition = {
  id: 'customer.search',
  version: '1.0.0',
  domain: 'customer',
  description:
    'Search customers across the CRM portfolio via the registered read-only search_customers tool; bounded result semantics (resolution ≤5, portfolio page ≤20, hard cap 50) are preserved from the existing product path.',
  input_schema: 'normalized_customer_filters_v1',
  output_schema: 'bounded_customer_candidates_v1',
  effect: 'READ',
  data_target: 'CRM_FACT',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'GLOBAL',
  idempotency: 'SAFE',
  executor_ref: 'salesAgentTool:search_customers',
  audit_contract: {
    audit_required: false,
    record_input: false,
    record_output: false,
    record_effect: false,
  },
  error_contract: 'DISTINGUISHABLE',
};

/** Get Customer — 客户级读取,现有注册工具 get_customer(snapshot 精确过滤)。 */
const GET_CUSTOMER_DEFINITION: CapabilityDefinition = {
  id: 'customer.get',
  version: '1.0.0',
  domain: 'customer',
  description:
    'Read a single customer record for an explicit customer scope via the registered read-only get_customer tool; resolution semantics (exact customer_id filter, empty result when absent) are preserved from the existing product path.',
  input_schema: 'customer_id_v1',
  output_schema: 'evidence_linked_read_result_v1',
  effect: 'READ',
  data_target: 'CRM_FACT',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'CUSTOMER',
  idempotency: 'SAFE',
  executor_ref: 'salesAgentTool:get_customer',
  audit_contract: {
    audit_required: false,
    record_input: false,
    record_output: false,
    record_effect: false,
  },
  error_contract: 'DISTINGUISHABLE',
};

/** Read Customer Context — 客户级上下文读取,现有注册工具 get_customer_context(返回现有 ContextSnapshot)。 */
const READ_CUSTOMER_CONTEXT_DEFINITION: CapabilityDefinition = {
  id: 'customer.context',
  version: '1.0.0',
  domain: 'customer',
  description:
    'Read the existing customer context representation (ContextSnapshot) for an explicit customer scope via the registered read-only get_customer_context tool; returns the real product context projection (a bounded snapshot that may include portfolio-level facts exactly as the existing product projection does), never a parallel synthetic context.',
  input_schema: 'customer_id_v1',
  output_schema: 'context_snapshot_v1',
  effect: 'READ',
  data_target: 'CRM_FACT',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'CUSTOMER',
  idempotency: 'SAFE',
  executor_ref: 'salesAgentTool:get_customer_context',
  audit_contract: {
    audit_required: false,
    record_input: false,
    record_output: false,
    record_effect: false,
  },
  error_contract: 'DISTINGUISHABLE',
};

/**
 * 全部真实 Customer 读取能力定义(只读、冻结)。
 * Read Customer State 经审计为 NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY,
 * 有意不进入本集合(inventory.ts 中记录理由)。
 */
export const CUSTOMER_READ_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = deepFreeze([
  SEARCH_CUSTOMER_DEFINITION,
  GET_CUSTOMER_DEFINITION,
  READ_CUSTOMER_CONTEXT_DEFINITION,
]);
