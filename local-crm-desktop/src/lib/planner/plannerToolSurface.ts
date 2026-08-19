/**
 * V0.2C / C1.6 — Planner-facing safe tool surface (REGISTRY-DRIVEN).
 *
 * 唯一目的：把生产 Capability Registry 里"已经冻结"的 25 个能力，投影成一份
 * 供模型 planner / 确定性回退选择器使用的安全工具描述。绝不复刻、绝并置第二份
 * capability 注册表，绝不把业务策略写进 prompt。
 *
 * 安全边界（SAFE_TOOL_SURFACE）：
 *   - 只暴露"选择所需"信息：capability_id / description / scope / effect /
 *     data_target / requires_confirmation / authority_policy；
 *   - 绝不暴露 executor_ref / audit_contract / 输入输出 schema 字符串等内部实现；
 *   - 绝不含密钥 / DB 实现 / 可执行代码 / 隐藏系统数据。
 *
 * 生产 Registry（PRODUCTION_CAPABILITY_REGISTRY）是唯一真源；本模块只读它。
 */

import { PRODUCTION_CAPABILITY_REGISTRY } from '../capabilities/execution';
import type { CapabilityRegistry } from '../capabilities/registry';
import type {
  CapabilityAuthorityPolicy,
  CapabilityDataTarget,
  CapabilityEffect,
  CapabilityScopeRequirement,
} from '../capabilities/types';
import { plannerInputSchemaFor, type PlannerInputSchema } from './plannerInputSchema';

/** 供 planner 选择能力的安全工具描述（不含任何内部实现）。 */
export interface PlannerToolDescriptor {
  readonly capability_id: string;
  readonly version: string;
  readonly domain: string;
  /** 权威语义描述（来自生产 manifest，供模型选择用，绝不被 prompt 覆盖）。 */
  readonly description: string;
  /** 供模型精确选择用的简洁语义提示（一行中文；区别于冗长的 manifest description）。 */
  readonly semantic_hint: string;
  readonly effect: CapabilityEffect;
  readonly data_target: CapabilityDataTarget;
  readonly scope_requirement: CapabilityScopeRequirement;
  readonly requires_confirmation: boolean;
  readonly authority_policy: CapabilityAuthorityPolicy;
  /** 最小安全输入 schema（allowed/required 字段名 + 逐字段 type/enum/format 约束，从既有生产常量派生）。 */
  readonly input_schema: PlannerInputSchema;
}

/**
 * 简洁语义提示（planner-facing，一行中文）。来自各能力 manifest 的权威语义，
 * 供模型在同名前缀（battle_card.* / import.* / timeline.*）之间精确区分。
 * 这不是第二份 schema/registry：生产 Registry 仍是唯一真源。
 */
const SEMANTIC_HINTS: Readonly<Record<string, string>> = Object.freeze({
  'customer.search': '搜索客户（组合级/全局）',
  'customer.get': '读取单个客户资料',
  'customer.context': '读取客户上下文快照',
  'timeline.customer.read': '读取客户时间线（跟进+拜访）',
  'timeline.visit.read': '读取客户拜访记录',
  'follow_up.customer.read': '读取客户跟进记录',
  'follow_up.global.read': '读取全部客户的跟进记录（全局）',
  'task.read_by_customer': '读取客户任务',
  'battle_card.current.read': '读取客户当前生效的作战卡',
  'battle_card.history.read': '读取客户作战卡历史版本',
  'battle_card.context.read': '读取客户作战卡聚合上下文（事实/假设/卡片）',
  'import.file.preview': '预览用户选择的导入文件',
  'import.mapping.validate': '校验导入列到 CRM 字段的映射',
  'customer.next_follow_up_time.update': '更新客户下次跟进时间',
  'follow_up.create': '新增一条跟进记录',
  'task.create': '新增一个任务',
  'battle_card.draft.create': '生成客户某阶段的作战卡草稿',
  'battle_card.confirm': '确认/提交作战卡草稿为正式卡',
  'battle_card.hypothesis.status.update': '更新作战卡某条假设的状态',
  'battle_card.intelligence_import.confirm': '确认一批情报导入（写多张记录）',
  'customer.create': '新建客户',
  'customer.profile.update': '更新客户资料字段（行业/区域等）',
  'customer.delete': '删除客户（硬删除）',
  'visit.create': '新增一条拜访记录',
  'customer.opportunity_amount.update': '更新客户商机金额',
});

/**
 * 从给定 Registry 派生安全工具面。默认使用生产 Registry。
 * 只读、确定性、冻结；绝不修改 Registry。
 */
export function buildPlannerToolSurface(
  registry: CapabilityRegistry = PRODUCTION_CAPABILITY_REGISTRY,
): readonly PlannerToolDescriptor[] {
  return Object.freeze(
    registry.list().map((definition) =>
      Object.freeze({
        capability_id: definition.id,
        version: definition.version,
        domain: definition.domain,
        description: definition.description,
        semantic_hint: SEMANTIC_HINTS[definition.id] ?? definition.description,
        effect: definition.effect,
        data_target: definition.data_target,
        scope_requirement: definition.scope_requirement,
        requires_confirmation: definition.requires_confirmation,
        authority_policy: definition.authority_policy,
        input_schema: Object.freeze(plannerInputSchemaFor(definition.id)),
      }),
    ),
  );
}

/** 生产 planner 工具面（25 项，冻结）。 */
export const PRODUCTION_PLANNER_TOOL_SURFACE: readonly PlannerToolDescriptor[] = buildPlannerToolSurface();

/** 工具面中的能力 id 集合（供测试/路由断言；非可变中央数组）。 */
export const PLANNER_TOOL_CAPABILITY_IDS: readonly string[] = Object.freeze(
  PRODUCTION_PLANNER_TOOL_SURFACE.map((descriptor) => descriptor.capability_id),
);

/** 按 id 查找工具描述；未知 id → null（fail-closed，不猜测）。 */
export function findPlannerTool(capabilityId: string): PlannerToolDescriptor | null {
  return PRODUCTION_PLANNER_TOOL_SURFACE.find((descriptor) => descriptor.capability_id === capabilityId) ?? null;
}

/**
 * New-entity create: selected customer is UI/session context, not the new row's
 * business target. Do not inherit selected-customer identity into create arguments.
 */
export function isNewEntityCreateCapability(capabilityId: string | null | undefined): boolean {
  return capabilityId === 'customer.create';
}

/** Transport/runtime identity keys that must never become new-entity business fields. */
const NEW_ENTITY_INHERITED_IDENTITY_KEYS = ['customer_id', 'customerId'] as const;

export function omitNewEntityInheritedIdentity(
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args };
  for (const key of NEW_ENTITY_INHERITED_IDENTITY_KEYS) delete next[key];
  return next;
}

export function selectedCustomerIdForCapability(
  capabilityId: string | null | undefined,
  selectedCustomerId: string | null,
): string | null {
  if (isNewEntityCreateCapability(capabilityId)) return null;
  return selectedCustomerId;
}
