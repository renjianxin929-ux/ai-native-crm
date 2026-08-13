/**
 * V0.2A / W3-1 — Capability Execution Engine.
 *
 * 唯一职责：把一次显式选定的 CapabilityInvocation 走完统一语义链：
 *
 *   1. Registry lookup     — A1 registry.get(id, version)；失败 → CAPABILITY_NOT_FOUND
 *   2. Executor binding    — executor_ref → 精确绑定；缺失 → EXECUTOR_NOT_BOUND（无 fallback）
 *   3. Input validation    — 绑定层确定性输入护栏；失败 → INVALID_INPUT（执行器调用数 = 0）
 *   4. Scope validation    — definition.scope_requirement 强制；失败 → INVALID_SCOPE
 *   5. Authority decision  — A10 evaluateAuthorityPolicy（本层绝不自行解释策略）
 *   6. Execute             — 仅 ALLOW_AUTO 才调用执行器；确认/强确认/拒绝 → 结构化结果
 *   7. Unified result/error— SUCCESS 原样保留 Product payload；错误脱敏分类
 *   8. Observation seam    — AUTHORITY_DECIDED / BEFORE_EXECUTION / OUTCOME 最小事件
 *
 * 安全不变式：
 * - 唯一统一执行入口是 invoke()：它总是先评估 A10，不存在可跳过 A10 的公开路径。
 * - 确认类 / 拒绝类决策下执行器绝不运行（executor 调用数 = 0）。
 * - 执行器错误被捕获并映射为 EXECUTOR_ERROR，绝不伪装成 SUCCESS。
 * - 本模块不 import 任何 DB / 网络 / Provider / 模型 / 确认写入运行时。
 */

import { evaluateAuthorityPolicy } from '../authority';
import type { AuthorityDecision } from '../authority/types';
import type { CapabilityRegistry } from '../registry';
import type {
  CapabilityDefinition,
  CapabilityExecutorRef,
  CapabilityId,
  CapabilityVersion,
} from '../types';
import type { CapabilityBindingRegistry } from './binding';
import {
  CapabilityInputValidationError,
  type CapabilityConfirmationHandoff,
  type CapabilityExecutionErrorCode,
  type CapabilityExecutionObserver,
  type CapabilityExecutionOutcome,
  type CapabilityInvocation,
  type CapabilityInvocationScope,
} from './contract';

/** 稳定、脱敏、有界的错误消息：控制字符转义 + 长度截断（不泄漏原始敏感内容）。 */
const MAX_ERROR_MESSAGE_LENGTH = 512;

function escapeControlChars(value: string): string {
  let result = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    result += code < 0x20 || code === 0x7f
      ? `\\u${code.toString(16).padStart(4, '0')}`
      : ch;
  }
  return result;
}

function sanitizeMessage(value: string): string {
  const escaped = escapeControlChars(value);
  return escaped.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${escaped.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : escaped;
}

/** 结果对象冻结：调用方无法改写执行元数据（payload 原样保留，不深冻结）。 */
function freezeOutcome<T extends CapabilityExecutionOutcome>(outcome: T): T {
  return Object.freeze(outcome);
}

function failure(
  errorCode: CapabilityExecutionErrorCode,
  identity: { capability_id: CapabilityId; capability_version: CapabilityVersion },
  message: string,
  resolved?: { definition: CapabilityDefinition; decision?: AuthorityDecision; executor_ref?: CapabilityExecutorRef },
): CapabilityExecutionOutcome {
  return freezeOutcome({
    status: 'EXECUTION_ERROR' as const,
    capability_id: identity.capability_id,
    capability_version: identity.capability_version,
    error_code: errorCode,
    message: sanitizeMessage(message),
    authority_decision: resolved?.decision ?? null,
    executor_ref: resolved?.executor_ref ?? null,
    idempotency: resolved?.definition.idempotency ?? null,
  });
}

/**
 * 作用域校验（统一规则，绝无全局回退）：
 * - scope_requirement=CUSTOMER → 必须有显式非空 customer_id，否则 INVALID_SCOPE。
 *   "缺失 customer → 全局回退"与"未知 customer → 第一个/最新客户回退"均被禁止。
 * - scope_requirement=GLOBAL / NONE → 不要求、也不假装要求 customer scope。
 */
function scopeValidationMessage(
  definition: CapabilityDefinition,
  scope: CapabilityInvocationScope,
): string | null {
  if (definition.scope_requirement === 'CUSTOMER') {
    const customerId = scope.customer_id;
    if (typeof customerId !== 'string' || customerId.trim().length === 0) {
      return 'Capability requires an explicit non-empty customer scope; refusing to broaden to GLOBAL.';
    }
  }
  return null;
}

export interface CapabilityExecutionEngine {
  /** 统一执行入口：registry → input → scope → A10 → (execute | confirmation outcome)。 */
  readonly invoke: (invocation: CapabilityInvocation) => Promise<CapabilityExecutionOutcome>;
  readonly registry: CapabilityRegistry;
  readonly bindings: CapabilityBindingRegistry;
}

export interface CapabilityExecutionEngineOptions {
  readonly registry: CapabilityRegistry;
  readonly bindings: CapabilityBindingRegistry;
  /** A10 评估器（默认 evaluateAuthorityPolicy；注入仅用于测试计数，不得绕开语义）。 */
  readonly evaluate?: (definition: CapabilityDefinition) => AuthorityDecision;
  readonly observer?: CapabilityExecutionObserver;
}

export function createCapabilityExecutionEngine(
  options: CapabilityExecutionEngineOptions,
): CapabilityExecutionEngine {
  const evaluate = options.evaluate ?? evaluateAuthorityPolicy;
  const observe = options.observer?.observe;

  /** 终态统一出口：每个 invocation 恰好发出一个 OUTCOME 观察事件。 */
  const emitOutcome = (outcome: CapabilityExecutionOutcome): CapabilityExecutionOutcome => {
    observe?.({
      phase: 'OUTCOME',
      capability_id: outcome.capability_id,
      capability_version: outcome.capability_version,
      ...(outcome.authority_decision ? { authority_decision: outcome.authority_decision } : {}),
      ...(outcome.executor_ref ? { executor_ref: outcome.executor_ref } : {}),
      outcome,
    });
    return outcome;
  };

  async function invoke(invocation: CapabilityInvocation): Promise<CapabilityExecutionOutcome> {
    // 1. Registry lookup（fail closed）
    let definition: CapabilityDefinition;
    try {
      definition = options.registry.get(invocation.capability_id, invocation.capability_version);
    } catch {
      return emitOutcome(failure('CAPABILITY_NOT_FOUND', invocation, 'Capability identity is not registered.'));
    }

    // 2. Executor binding（精确 executor_ref；缺失即 fail closed，绝无 fallback）
    const binding = options.bindings.resolve(definition.executor_ref);
    if (binding === undefined) {
      return emitOutcome(failure('EXECUTOR_NOT_BOUND', invocation, `No executor binding is registered for executor_ref ${JSON.stringify(definition.executor_ref)}.`, { definition }));
    }

    // 3. Input validation（执行前 fail closed；执行器调用数保持 0）
    //    传入显式 scope：CUSTOMER 能力的绑定在此强制 SCOPE↔INPUT 客户相干性。
    let validatedInput: unknown;
    try {
      validatedInput = binding.validateInput(invocation.input, invocation.scope);
    } catch (error) {
      const message = error instanceof CapabilityInputValidationError
        ? error.message
        : 'Invocation input failed validation.';
      return emitOutcome(failure('INVALID_INPUT', invocation, message, { definition }));
    }

    // 4. Scope validation（fail closed；无全局/首个客户回退）
    const scopeError = scopeValidationMessage(definition, invocation.scope);
    if (scopeError !== null) {
      return emitOutcome(failure('INVALID_SCOPE', invocation, scopeError, { definition }));
    }

    // 5. Authority decision（A10 唯一权威；本层不重解释）
    const decision = evaluate(definition);
    observe?.({ phase: 'AUTHORITY_DECIDED', capability_id: definition.id, capability_version: definition.version, authority_decision: decision, executor_ref: definition.executor_ref });

    const resolvedMeta = {
      authority_decision: decision,
      executor_ref: definition.executor_ref,
      idempotency: definition.idempotency,
    } as const;

    /**
     * GAP-F 确认交接尝试（仅确认/强确认分支调用）。
     * 交接 = 把请求注册进现有产品确认机制（CONFIRMATION_HANDOFF_SIDE_EFFECT），
     * 绝不执行业务写；失败 fail-closed：无提案注册、无业务执行，返回结构化错误。
     * - 交接抛 CapabilityInputValidationError（如 by-ID 目标所有权不符）→ INVALID_INPUT
     * - 其它交接失败 → EXECUTOR_ERROR（消息脱敏）
     */
    type HandoffAttempt =
      | { readonly kind: 'ok'; readonly handoff?: CapabilityConfirmationHandoff }
      | { readonly kind: 'failed'; readonly outcome: CapabilityExecutionOutcome };
    const attemptHandoff = async (): Promise<HandoffAttempt> => {
      if (binding.handoff === undefined) return { kind: 'ok' };
      try {
        return { kind: 'ok', handoff: await binding.handoff(validatedInput, invocation.scope) };
      } catch (error) {
        const isValidation = error instanceof CapabilityInputValidationError;
        const message = error instanceof Error ? error.message : String(error);
        return {
          kind: 'failed',
          outcome: emitOutcome(failure(
            isValidation ? 'INVALID_INPUT' : 'EXECUTOR_ERROR',
            invocation,
            isValidation ? message : `Confirmation handoff failed: ${message}`,
            { definition, decision },
          )),
        };
      }
    };

    if (decision.decision === 'REQUIRE_CONFIRMATION' || decision.decision === 'REQUIRE_STRONG_CONFIRMATION') {
      const attempt = await attemptHandoff();
      if (attempt.kind === 'failed') return attempt.outcome;
      const status = decision.decision === 'REQUIRE_CONFIRMATION'
        ? ('CONFIRMATION_REQUIRED' as const)
        : ('STRONG_CONFIRMATION_REQUIRED' as const);
      return emitOutcome(freezeOutcome({
        status,
        capability_id: definition.id,
        capability_version: definition.version,
        ...resolvedMeta,
        ...(attempt.handoff !== undefined ? { confirmation_handoff: attempt.handoff } : {}),
      }));
    }
    if (decision.decision === 'DENY_AUTONOMOUS') {
      return emitOutcome(freezeOutcome({ status: 'AUTONOMY_DENIED', capability_id: definition.id, capability_version: definition.version, ...resolvedMeta }));
    }
    // decision.decision === 'ALLOW_AUTO'

    // 6. Execute（仅 ALLOW_AUTO 到达此处）
    observe?.({ phase: 'BEFORE_EXECUTION', capability_id: definition.id, capability_version: definition.version, authority_decision: decision, executor_ref: definition.executor_ref });
    try {
      const payload = await binding.execute(validatedInput, invocation.scope);
      return emitOutcome(freezeOutcome({
        status: 'SUCCESS',
        capability_id: definition.id,
        capability_version: definition.version,
        authority_decision: decision,
        executor_ref: definition.executor_ref,
        idempotency: definition.idempotency,
        payload,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return emitOutcome(failure('EXECUTOR_ERROR', invocation, `Executor '${definition.executor_ref}' failed: ${message}`, { definition, decision }));
    }
  }

  return { invoke, registry: options.registry, bindings: options.bindings };
}
