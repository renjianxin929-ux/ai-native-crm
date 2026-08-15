/**
 * V0.2A / W3-1 — Production Capability Execution Composition.
 *
 * 唯一的"真实生产可消费"组合点：把冻结的 22 个生产能力（Wave1/Wave2 读 manifest
 * 13 项 + W3-3 写/草稿/状态迁移 manifest 7 项 + W4-1 customer.create 1 项 +
 * W4-2 customer.profile.update 1 项；Evidence 空 manifest 贡献 0）组合为：
 *   - PRODUCTION_CAPABILITY_REGISTRY      —— A1 registry（确定性 / 不可变 / 可复用）
 *   - PRODUCTION_CAPABILITY_BINDING_REGISTRY —— executor_ref → 真实领域 adapter（22 项全绑定）
 *   - PRODUCTION_CAPABILITY_EXECUTION     —— 统一执行入口（Registry → Input → Scope → A10 → Executor / 确认交接）
 *
 * 约束（本分支）：
 * - 不创建巨大的导出可变 ALL_CAPABILITIES 数组；不手动复制定义；
 *   全部经 A1 createCapabilityRegistry(...manifests) 组合。
 * - Evidence 空 manifest 继续参与领域组合，贡献 0 个生产能力身份。
 * - 所有 22 个 executor_ref 都能如实绑定到现有领域 adapter（不改变领域语义、
 *   不为统一而伪造执行器）；绑定缺失即 EXECUTOR_NOT_BOUND（无 fallback）。
 * - 九个写绑定的执行器/确认交接适配器集中在 ./writeAdapters（复用现有
 *   salesAgentTools 确认运行时与 Battle Card 产品执行器路径）；本文件保持
 *   零写语义（引擎 A10-first 不变式由 engine.ts 保证）。
 */

import { createCapabilityRegistry } from '../registry';
import type { CapabilityDefinition } from '../types';
import type { DatabaseLike } from '../../db';
import type { FieldMapping } from '../../importer';
import type { ContextSnapshot } from '../../context/types';
import type { CustomerMemoryContext } from '../../customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../../readOnlySnapshotLoaderReadiness';
import type { SearchCustomersToolInput } from '../../salesAgentTools/executeSearchCustomersTool';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../customer/manifest';
import { CUSTOMER_CREATE_MANIFEST } from '../customer/createManifest';
import { CUSTOMER_PROFILE_UPDATE_MANIFEST } from '../customer/profileUpdateManifest';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../timeline/manifest';
import { FOLLOW_UP_READ_MANIFEST } from '../followUp/manifest';
import { TASK_READ_MANIFEST } from '../task/manifest';
import { BATTLE_CARD_READ_MANIFEST } from '../battleCard/manifest';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../evidence/manifest';
import { IMPORT_READ_CAPABILITY_MANIFEST } from '../import/manifest';
import { CUSTOMER_WRITE_MANIFEST } from '../customer/writeManifest';
import { FOLLOW_UP_WRITE_MANIFEST } from '../followUp/writeManifest';
import { TASK_WRITE_MANIFEST } from '../task/writeManifest';
import { BATTLE_CARD_WRITE_MANIFEST } from '../battleCard/writeManifest';

import { getCustomerRead, readCustomerContextRead, searchCustomersRead } from '../customer/readAdapter';
import { readCustomerTimeline, readCustomerVisits } from '../timeline/readAdapter';
import { createProductionFollowUpReadRepository } from '../followUp/production';
import { readTasksByCustomer } from '../task/adapter';
import { readBattleCardHistory, readCurrentBattleCard, readCustomerBattleContext } from '../battleCard/readAdapter';
import { previewImportFile, validateImportMapping } from '../import/index';
import { PRODUCTION_WRITE_BINDINGS } from './writeAdapters';

import {
  CapabilityInputValidationError,
  type CapabilityExecutionObserver,
  type CapabilityInvocationScope,
} from './contract';
import {
  createCapabilityBindingRegistry,
  type CapabilityExecutorBinding,
} from './binding';
import { createCapabilityExecutionEngine, type CapabilityExecutionEngine } from './engine';
import { createObservationBridge } from './observationBridge';
import { createNoopObservationEmitter } from '../observation';

/* ------------------------------------------------------------------ */
/* 共享校验护栏（确定性、fail-closed、无副作用）                          */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDatabaseLike(value: unknown): value is DatabaseLike {
  return isPlainObject(value)
    && typeof value.execute === 'function'
    && typeof value.select === 'function';
}

/** 无参输入：undefined 或空对象（客户作用域经 invocation.scope 传递）。 */
function isNoArgInput(value: unknown): boolean {
  return value === undefined || (isPlainObject(value) && Object.keys(value).length === 0);
}

function assertNoArgInput(input: unknown, capabilityId: string): void {
  if (!isNoArgInput(input)) {
    throw new CapabilityInputValidationError(`${capabilityId} takes no input arguments; customer scope is passed via invocation scope.`);
  }
}

/**
 * 客户作用域提取（执行层 scope 校验已保证非空；此处仅做类型收窄的防御，
 * 绝不做"缺失 → 全局回退"）。
 */
function requireCustomerScope(scope: CapabilityInvocationScope): string {
  const customerId = scope.customer_id;
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    throw new Error('Internal invariant: customer scope is required before executor execution.');
  }
  return customerId;
}

/** 客户选择字段（当前真实输入契约中的拼写 + 防御性别名检查）。
 *  - customer_id：customer.get / customer.context 领域输入契约的真实字段
 *    （W3-1 调用契约把它移到 invocation.scope；若调用方仍传入则必须等于 scope）。
 *  - customerId：当前无任何 adapter 读取该拼写 —— 仅作为防御性检查拒绝，
 *    防止未来/误用字段带偏客户身份；不是新增契约字段。
 *  其它嵌套字段（snapshot/context 数据、battleCard db/clock）不是客户选择器，
 *  不做递归扫描（规格 §6：只强制真实执行器驱动字段）。
 */
const CUSTOMER_SELECTOR_KEYS: readonly string[] = ['customer_id', 'customerId'];

/**
 * SCOPE↔INPUT 客户相干护栏（fail closed，执行前）：
 * 对 CUSTOMER 能力，输入中出现的任何客户选择字段都不得反驳显式 invocation scope。
 * - scope 有效（非空 customer_id）且输入字段存在：
 *   · 值 = scope.customer_id → 放行（执行器仍以 scope 为准）；
 *   · 值 ≠ scope.customer_id → INVALID_INPUT（mismatch，执行器绝不被调用）。
 * - scope 缺失/空白时本护栏不拦截（交由引擎 scope 校验产出 INVALID_SCOPE）。
 * 无 fallback、无 "input wins"、无 "last known customer"。
 */
function assertCustomerSelectorCoherent(input: unknown, scope: CapabilityInvocationScope): void {
  if (!isPlainObject(input)) {
    return; // 形状校验由各绑定护栏负责
  }
  const record = input as Record<string, unknown>;
  const scopeCustomerId = scope.customer_id;
  const hasValidScope = typeof scopeCustomerId === 'string' && scopeCustomerId.trim().length > 0;

  for (const key of CUSTOMER_SELECTOR_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new CapabilityInputValidationError(`Input customer selector '${key}' must be a non-empty string when present.`);
    }
    if (hasValidScope && value !== scopeCustomerId) {
      throw new CapabilityInputValidationError(
        `Input customer selector '${key}' ("${value}") contradicts invocation scope.customer_id ("${scopeCustomerId}"); refusing to execute.`,
      );
    }
  }
}

/** 客户级读取输入（snapshot + context；customer_id 只来自 invocation scope）。 */
function validateCustomerScopedReadInput(input: unknown, scope: CapabilityInvocationScope): { snapshot: LoadedReadOnlyAgentSnapshot; context: ContextSnapshot; memory?: CustomerMemoryContext } {
  if (!isPlainObject(input)) {
    throw new CapabilityInputValidationError('Customer-scoped read requires an object input with snapshot and context.');
  }
  const record = input as Record<string, unknown>;
  if (!isPlainObject(record.snapshot) || !Array.isArray(record.snapshot.customers)) {
    throw new CapabilityInputValidationError('Customer-scoped read requires a read-only snapshot with a customers array.');
  }
  if (!isPlainObject(record.context)) {
    throw new CapabilityInputValidationError('Customer-scoped read requires a context snapshot object.');
  }
  // SCOPE↔INPUT 相干性：任何输入客户选择字段都必须与 scope 一致（否则 fail closed）。
  assertCustomerSelectorCoherent(input, scope);
  return {
    snapshot: record.snapshot as unknown as LoadedReadOnlyAgentSnapshot,
    context: record.context as unknown as ContextSnapshot,
    ...(record.memory !== undefined ? { memory: record.memory as unknown as CustomerMemoryContext } : {}),
  };
}

/** Battle Card 读取输入（db 句柄 + 可选 clock；customer_id 只来自 invocation scope）。 */
function validateBattleCardReadInput(input: unknown, scope: CapabilityInvocationScope): { db: DatabaseLike; clock?: () => string } {
  if (!isPlainObject(input)) {
    throw new CapabilityInputValidationError('Battle Card read requires an object input with a db handle.');
  }
  const record = input as Record<string, unknown>;
  if (!isDatabaseLike(record.db)) {
    throw new CapabilityInputValidationError('Battle Card read requires a DatabaseLike db handle.');
  }
  if (record.clock !== undefined && typeof record.clock !== 'function') {
    throw new CapabilityInputValidationError('Battle Card read clock must be a function.');
  }
  // SCOPE↔INPUT 相干性：customer_id 不是 Battle Card 输入契约字段；
  // 若调用方传入客户选择字段，必须与 scope 一致（否则 fail closed）。
  assertCustomerSelectorCoherent(input, scope);
  return { db: record.db as DatabaseLike, clock: record.clock as (() => string) | undefined };
}

/* ------------------------------------------------------------------ */
/* 生产组合：A1 registry（11 个领域 manifest，含 Evidence 空 manifest）    */
/* ------------------------------------------------------------------ */

/** 生产注册表：22 个能力身份（Wave1/Wave2 读 13 + W3-3 写 7 + W4-1 customer.create 1
 *  + W4-2 customer.profile.update 1；Evidence 贡献 0）。构造期即完成全部校验与深冻结；
 *  W3-3/W4-1/W4-2 写 manifest 经 A1 扩展缝组合，绝不手动复制定义。 */
export const PRODUCTION_CAPABILITY_REGISTRY = createCapabilityRegistry(
  CUSTOMER_CAPABILITY_MANIFEST,
  TIMELINE_READ_CAPABILITY_MANIFEST,
  FOLLOW_UP_READ_MANIFEST,
  TASK_READ_MANIFEST,
  BATTLE_CARD_READ_MANIFEST,
  EVIDENCE_READ_CAPABILITY_MANIFEST,
  IMPORT_READ_CAPABILITY_MANIFEST,
  CUSTOMER_WRITE_MANIFEST,
  FOLLOW_UP_WRITE_MANIFEST,
  TASK_WRITE_MANIFEST,
  BATTLE_CARD_WRITE_MANIFEST,
  // W4-1：customer.create 以追加方式组合（21st 身份；W3-3 冻结顺序不变）
  CUSTOMER_CREATE_MANIFEST,
  // W4-2：customer.profile.update 以追加方式组合（22nd 身份；唯一新增生产能力）
  CUSTOMER_PROFILE_UPDATE_MANIFEST,
);

/** 生产 Follow-up 读取边界（绑定 db.ts 真实只读路径 listFollowUps / listAllFollowUps）。 */
const productionFollowUpRepository = createProductionFollowUpReadRepository();

/* ------------------------------------------------------------------ */
/* 生产执行器绑定：22 个 executor_ref ↔ 现有真实领域 adapter（全绑定）     */
/*   - 13 个读/分析 adapter（下述冻结数组）                              */
/*   - 9 个 W3-3/W4-1/W4-2 写 adapter（./writeAdapters：校验 + 确认交接 + 草稿 AUTO） */
/* ------------------------------------------------------------------ */

/**
 * 全部生产绑定。每个条目：精确 executor_ref 身份 + 确定性输入护栏 + 真实 adapter。
 * 绝无 fallback 执行器；绝不 eval / 动态 require / 反射。
 * 写绑定（GAP-B/C/F + W4-1 customer.create + W4-2 customer.profile.update）
 * 集中在 PRODUCTION_WRITE_BINDINGS，保持本数组读语义纯净。
 */
export const PRODUCTION_CAPABILITY_BINDINGS: readonly CapabilityExecutorBinding[] = Object.freeze([
  // ── Customer ────────────────────────────────────────────────────────
  Object.freeze({
    executor_ref: 'salesAgentTool:search_customers',
    validateInput: (input: unknown): unknown => {
      if (!isPlainObject(input)) {
        throw new CapabilityInputValidationError('customer.search requires an object input with normalized filters.');
      }
      const record = input as Record<string, unknown>;
      if (!isPlainObject(record.filters)) {
        throw new CapabilityInputValidationError('customer.search requires a normalized filters object.');
      }
      if (record.list_kind !== undefined && record.list_kind !== 'portfolio' && record.list_kind !== 'resolution') {
        throw new CapabilityInputValidationError('customer.search list_kind must be portfolio or resolution.');
      }
      if (record.db !== undefined && !isDatabaseLike(record.db)) {
        throw new CapabilityInputValidationError('customer.search db must be a DatabaseLike handle.');
      }
      return input;
    },
    execute: (validatedInput: unknown) => searchCustomersRead(validatedInput as SearchCustomersToolInput),
  }),
  Object.freeze({
    executor_ref: 'salesAgentTool:get_customer',
    validateInput: (input: unknown, scope: CapabilityInvocationScope): unknown =>
      validateCustomerScopedReadInput(input, scope),
    execute: (validatedInput: unknown, scope: CapabilityInvocationScope) => {
      const input = validatedInput as { snapshot: LoadedReadOnlyAgentSnapshot; context: ContextSnapshot; memory?: CustomerMemoryContext };
      return getCustomerRead({
        customer_id: requireCustomerScope(scope),
        snapshot: input.snapshot,
        context: input.context,
        ...(input.memory !== undefined ? { memory: input.memory } : {}),
      });
    },
  }),
  Object.freeze({
    executor_ref: 'salesAgentTool:get_customer_context',
    validateInput: (input: unknown, scope: CapabilityInvocationScope): unknown =>
      validateCustomerScopedReadInput(input, scope),
    execute: (validatedInput: unknown, scope: CapabilityInvocationScope) => {
      const input = validatedInput as { snapshot: LoadedReadOnlyAgentSnapshot; context: ContextSnapshot; memory?: CustomerMemoryContext };
      return readCustomerContextRead({
        customer_id: requireCustomerScope(scope),
        snapshot: input.snapshot,
        context: input.context,
        ...(input.memory !== undefined ? { memory: input.memory } : {}),
      });
    },
  }),

  // ── Timeline ────────────────────────────────────────────────────────
  Object.freeze({
    executor_ref: 'crm:listFollowUps+listVisits→buildCustomerTimeline',
    validateInput: (input: unknown): unknown => {
      assertNoArgInput(input, 'timeline.customer.read');
      return input;
    },
    execute: (_validatedInput: unknown, scope: CapabilityInvocationScope) =>
      readCustomerTimeline({ customer_id: requireCustomerScope(scope) }),
  }),
  Object.freeze({
    executor_ref: 'crm:listVisits',
    validateInput: (input: unknown): unknown => {
      assertNoArgInput(input, 'timeline.visit.read');
      return input;
    },
    execute: (_validatedInput: unknown, scope: CapabilityInvocationScope) =>
      readCustomerVisits({ customer_id: requireCustomerScope(scope) }),
  }),

  // ── Follow-up ───────────────────────────────────────────────────────
  Object.freeze({
    executor_ref: 'db:listFollowUps',
    validateInput: (input: unknown): unknown => {
      assertNoArgInput(input, 'follow_up.customer.read');
      return input;
    },
    execute: (_validatedInput: unknown, scope: CapabilityInvocationScope) =>
      productionFollowUpRepository.listFollowUpsByCustomer(requireCustomerScope(scope)),
  }),
  Object.freeze({
    executor_ref: 'db:listAllFollowUps',
    validateInput: (input: unknown): unknown => {
      assertNoArgInput(input, 'follow_up.global.read');
      return input;
    },
    execute: () => productionFollowUpRepository.listAllFollowUps(),
  }),

  // ── Task ────────────────────────────────────────────────────────────
  Object.freeze({
    executor_ref: 'salesAgentTool:list_customer_tasks',
    validateInput: (input: unknown): unknown => {
      assertNoArgInput(input, 'task.read_by_customer');
      return input;
    },
    execute: (_validatedInput: unknown, scope: CapabilityInvocationScope) =>
      readTasksByCustomer(requireCustomerScope(scope)),
  }),

  // ── Battle Card ─────────────────────────────────────────────────────
  Object.freeze({
    executor_ref: 'battleCard:getCurrentStageCard',
    validateInput: (input: unknown, scope: CapabilityInvocationScope): unknown =>
      validateBattleCardReadInput(input, scope),
    execute: (validatedInput: unknown, scope: CapabilityInvocationScope) => {
      const { db, clock } = validatedInput as { db: DatabaseLike; clock?: () => string };
      return readCurrentBattleCard({ db, clock }, requireCustomerScope(scope));
    },
  }),
  Object.freeze({
    executor_ref: 'battleCard:listStageCardHistory',
    validateInput: (input: unknown, scope: CapabilityInvocationScope): unknown =>
      validateBattleCardReadInput(input, scope),
    execute: (validatedInput: unknown, scope: CapabilityInvocationScope) => {
      const { db, clock } = validatedInput as { db: DatabaseLike; clock?: () => string };
      return readBattleCardHistory({ db, clock }, requireCustomerScope(scope));
    },
  }),
  Object.freeze({
    executor_ref: 'battleCard:getCustomerBattleContext',
    validateInput: (input: unknown, scope: CapabilityInvocationScope): unknown =>
      validateBattleCardReadInput(input, scope),
    execute: (validatedInput: unknown, scope: CapabilityInvocationScope) => {
      const { db, clock } = validatedInput as { db: DatabaseLike; clock?: () => string };
      return readCustomerBattleContext({ db, clock }, requireCustomerScope(scope));
    },
  }),

  // ── Import ──────────────────────────────────────────────────────────
  Object.freeze({
    executor_ref: 'crm:parseExcelFile→findBestImportTable→autoDetectFields',
    validateInput: (input: unknown): unknown => {
      if (!(input instanceof File)) {
        throw new CapabilityInputValidationError('import.file.preview requires a browser File object.');
      }
      return input;
    },
    execute: (validatedInput: unknown) => previewImportFile(validatedInput as File),
  }),
  Object.freeze({
    executor_ref: 'crm:DataImportPage.getDuplicateMappingErrors+nameMappingGate',
    validateInput: (input: unknown): unknown => {
      if (!Array.isArray(input)) {
        throw new CapabilityInputValidationError('import.mapping.validate requires an array of field mappings.');
      }
      for (let index = 0; index < input.length; index++) {
        const item = input[index];
        if (!isPlainObject(item)
          || typeof item.sourceColumn !== 'string'
          || !(item.crmField === null || typeof item.crmField === 'string')) {
          throw new CapabilityInputValidationError(`import.mapping.validate mapping[${index}] must have a string sourceColumn and a string|null crmField.`);
        }
      }
      return input;
    },
    execute: (validatedInput: unknown) => validateImportMapping(validatedInput as readonly FieldMapping[]),
  }),

  // ── W3-3 生产写绑定（7 项；见 ./writeAdapters：输入护栏 + 确认交接 + 草稿 AUTO）──
  ...PRODUCTION_WRITE_BINDINGS,
]);

/** 生产绑定注册表：22 个 executor_ref 全绑定；重复绑定在构造期 fail closed。 */
export const PRODUCTION_CAPABILITY_BINDING_REGISTRY = createCapabilityBindingRegistry(
  PRODUCTION_CAPABILITY_BINDINGS,
);

/**
 * 生产统一执行入口（唯一公开执行面）：
 * Registry → Input validation → Scope validation → A10 Authority
 * → (ALLOW_AUTO: Executor) | (确认类: 现有确认机制交接，业务执行器调用数 = 0)。
 * 不存在可跳过 A10 的公开路径。
 *
 * Closure 2：生产执行挂载真实观察桥（W3-2 事件生成语义 + no-op emitter 校验丢弃）。
 * - 一次进入统一执行 → 恰好一个 invocation_id，结果与全部生命周期事件共享；
 * - 事件生成由 W3-1 拥有，W3-2 保持被动；事件只含结构字段（零业务载荷）；
 * - AUDIT_PERSISTENCE=false：no-op emitter 只校验+丢弃，不做任何持久化。
 */
export function createProductionCapabilityExecution(
  observer?: CapabilityExecutionObserver,
): CapabilityExecutionEngine {
  return createCapabilityExecutionEngine({
    registry: PRODUCTION_CAPABILITY_REGISTRY,
    bindings: PRODUCTION_CAPABILITY_BINDING_REGISTRY,
    ...(observer !== undefined ? { observer } : {}),
  });
}

/**
 * 生产观察桥（W3-2 no-op emitter）：
 * 事件生成语义（真实校验+规范化+丢弃）；绝不持久化、不落库、不写文件。
 * 未来持久化 Audit 属于独立分支，不得以本桥替代。
 */
export const PRODUCTION_OBSERVATION_BRIDGE = createObservationBridge(createNoopObservationEmitter());

/** 生产统一执行入口（挂载观察桥：真实生命周期事件生成，零持久化）。 */
export const PRODUCTION_CAPABILITY_EXECUTION: CapabilityExecutionEngine = createProductionCapabilityExecution(
  PRODUCTION_OBSERVATION_BRIDGE.observer,
);

/** 生产能力身份集合（22 项；供调用方/测试断言，非可变中央数组）。 */
export const PRODUCTION_CAPABILITY_IDS: readonly string[] = Object.freeze(
  PRODUCTION_CAPABILITY_REGISTRY.list().map((definition: CapabilityDefinition) => definition.id),
);

/** 生产注册数量（当前冻结生产能力数量 = 22；Evidence 空 manifest 贡献 0）。 */
export const PRODUCTION_CAPABILITY_COUNT: number = PRODUCTION_CAPABILITY_REGISTRY.size();
