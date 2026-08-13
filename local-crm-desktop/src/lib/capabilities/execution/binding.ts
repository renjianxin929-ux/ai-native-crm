/**
 * V0.2A / W3-1 — Executor Binding Model.
 *
 * 把 A1 的 executor_ref（字符串元数据）解析为可调用的执行器：
 * - 精确 executor_ref 身份 ↔ 恰好一个绑定执行器（不允许模糊匹配）。
 * - 重复绑定 fail closed：同一 executor_ref 注册两次在构造期抛错。
 * - 缺失绑定 fail closed：resolve 返回 undefined，引擎映射为 EXECUTOR_NOT_BOUND，
 *   绝无 fallback 执行器。
 *
 * 安全边界：
 * - 不使用 eval / 动态 require / 任意模块路径 / 反射执行：executor_ref 只是
 *   查找绑定注册表的字符串键，永远不直接作为代码执行。
 * - 绑定表由闭包持有、构造后不可变：调用方无法注入、覆盖或扩表。
 */

import type { CapabilityExecutorRef } from '../types';
import type { CapabilityInvocationScope } from './contract';

/**
 * 一个能力执行器绑定。
 * - validateInput：确定性输入护栏（执行前 fail-closed）。非法输入抛
 *   CapabilityInputValidationError；合法输入返回（可收窄的）校验后输入。
 *   第二个参数是显式 invocation scope：CUSTOMER 能力必须在此校验
 *   SCOPE↔INPUT 客户相干性（输入客户选择字段 ≠ scope.customer_id → 抛错），
 *   保证执行器生效客户身份只能来自 invocation.scope。
 * - execute：真正执行能力。只会在 A10 决策为 ALLOW_AUTO 后被引擎调用。
 *   接收校验后输入 + 显式作用域；返回原始 Product 结果（引擎原样包裹）。
 *   执行器生效客户身份必须从 scope 派生，绝不从输入重读。
 */
export interface CapabilityExecutorBinding {
  readonly executor_ref: CapabilityExecutorRef;
  readonly validateInput: (input: unknown, scope: CapabilityInvocationScope) => unknown;
  readonly execute: (
    validatedInput: unknown,
    scope: CapabilityInvocationScope,
  ) => unknown | Promise<unknown>;
}

/** 绑定注册表错误（构造期；稳定 code）。 */
export class CapabilityBindingError extends Error {
  readonly code: 'DUPLICATE_EXECUTOR_BINDING' | 'INVALID_EXECUTOR_BINDING';

  constructor(code: 'DUPLICATE_EXECUTOR_BINDING' | 'INVALID_EXECUTOR_BINDING', message: string) {
    super(message);
    this.name = 'CapabilityBindingError';
    this.code = code;
  }
}

/** 重复 executor_ref：拒绝静默覆盖（fail closed）。 */
export class DuplicateExecutorBindingError extends CapabilityBindingError {
  constructor(executorRef: CapabilityExecutorRef) {
    // JSON.stringify 转义控制字符/引号：拒绝经错误消息进行日志注入。
    super('DUPLICATE_EXECUTOR_BINDING', `Executor binding already registered: ${JSON.stringify(executorRef)}`);
    this.name = 'DuplicateExecutorBindingError';
  }
}

/** 畸形绑定条目（非对象 / 空 executor_ref / 缺 execute）。 */
export class InvalidExecutorBindingError extends CapabilityBindingError {
  constructor(message: string) {
    super('INVALID_EXECUTOR_BINDING', message);
    this.name = 'InvalidExecutorBindingError';
  }
}

/** 绑定注册表查询面（构造后不可变；无 register/覆盖/删除入口）。 */
export interface CapabilityBindingRegistry {
  /** 精确 executor_ref 查找；未绑定返回 undefined（引擎 fail-closed 为 EXECUTOR_NOT_BOUND）。 */
  readonly resolve: (executorRef: CapabilityExecutorRef) => CapabilityExecutorBinding | undefined;
  readonly size: () => number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 构建绑定注册表。entries 在构造期全部校验并去重：
 * - 重复 executor_ref → DuplicateExecutorBindingError（不静默覆盖）。
 * - 畸形条目 → InvalidExecutorBindingError。
 * Map 由闭包持有，注册表对象只暴露 resolve/size —— 调用方无法改写绑定表。
 */
export function createCapabilityBindingRegistry(
  entries: readonly CapabilityExecutorBinding[],
): CapabilityBindingRegistry {
  const byRef = new Map<CapabilityExecutorRef, CapabilityExecutorBinding>();

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      throw new InvalidExecutorBindingError('Executor binding must be an object.');
    }
    if (!isNonEmptyString(entry.executor_ref)) {
      throw new InvalidExecutorBindingError('Executor binding executor_ref must be a non-empty string.');
    }
    if (typeof entry.validateInput !== 'function' || typeof entry.execute !== 'function') {
      throw new InvalidExecutorBindingError(`Executor binding '${entry.executor_ref}' must declare validateInput and execute functions.`);
    }
    if (byRef.has(entry.executor_ref)) {
      throw new DuplicateExecutorBindingError(entry.executor_ref);
    }
    byRef.set(entry.executor_ref, entry);
  }

  return {
    resolve: (executorRef) => byRef.get(executorRef),
    size: () => byRef.size,
  };
}
