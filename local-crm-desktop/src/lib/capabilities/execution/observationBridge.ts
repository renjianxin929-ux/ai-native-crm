/**
 * V0.2A / W3-1 Closure 2 — Execution → Observation Bridge（最小的真话桥）。
 *
 * 职责：消费 W3-1 统一执行的生命周期真值（CapabilityExecutionObserver 事件），
 * 只向 W3-2 发射其冻结契约能如实承载的结构化事件（ObservationEventInput）。
 *
 * 边界（本文件是执行层内唯一的 W3-2 集成点）：
 * - 不修改 W3-2 词汇/契约：不发明 STRONG_CONFIRMATION_REQUIRED 等新事件类型
 *   （强确认语义经 confirmation_state=STRONG_REQUIRED 保持）。
 * - 零载荷泄漏：事件只携带结构字段（调用关联 / 能力身份 / 范围 / 执行器 /
 *   授权决策 / 稳定错误类别）；绝不发送 raw input / raw output / notes / prompt /
 *   model response / spreadsheet rows / evidence / secret / stack / 原始异常消息。
 * - 观察是被动的：桥不做 planner / 工具选择 / Agent loop / 重试；执行拥有生命周期
 *   相干性（同一 invocation_id 的全部事件共享同一能力身份 / 范围 / 执行器）。
 *
 * 前置授权失败（PRE_AUTHORITY_FAILURE_MODEL）——如实兼容：
 * W3-2 的 EXECUTION_FAILED 要求"治理它的非拒绝授权决策 + 稳定原因码"
 * （assertKindConsistency fail-closed）。W3-1 的 CAPABILITY_NOT_FOUND /
 * INVALID_INPUT / INVALID_SCOPE / EXECUTOR_NOT_BOUND 发生在 A10 之前，真话里
 * 没有决策。因此：
 *   - INVOCATION_STARTED：定义解析成功后如实发出（executor_ref / scope_requirement
 *     已知；范围可表示时）。
 *   - EXECUTION_FAILED 终态：前置授权失败绝不伪造 authority_decision / reason，
 *     故不发射终态事件（结果真值由 W3-1 outcome 携带：error_code + invocation_id）。
 *   - CAPABILITY_NOT_FOUND（无定义 → 无真实 executor_ref）与 INVALID_SCOPE
 *     （CUSTOMER 缺 customer_id → 无真实 scope_id）连 INVOCATION_STARTED 也无法
 *     如实表示，本桥保持沉默——不发任何事件，绝不插入 executor_ref='unknown' /
 *     authority_decision='ALLOW_AUTO' / scope_id='none' 等假值。
 *   - 执行期失败（EXECUTOR_ERROR、确认交接失败）有真实决策，如实发射 EXECUTION_FAILED。
 *
 * 时间戳：由本可信执行边界提供（默认本地 zoned ISO，与项目 AppClock 惯例一致；
 * 可注入确定性时钟，不构建时钟基础设施、不使用网络时间）。
 *
 * 观察失败：由引擎接缝包含（engine.safeObserve），本桥不实现持久化、不重试。
 */

import type { CapabilityScopeRequirement } from '../types';
import type { AuthorityDecisionKind, AuthorityDecisionReason } from '../authority/types';
import {
  createObservationEvent,
  type ObservationEmitter,
  type ObservationErrorCode,
  type ObservationEventInput,
  type ObservationScopeType,
} from '../observation';
import type {
  CapabilityExecutionErrorCode,
  CapabilityExecutionObservationEvent,
  CapabilityExecutionObserver,
  CapabilityExecutionOutcome,
  CapabilityInvocationScope,
} from './contract';

/* ------------------------------------------------------------------ */
/* 时间戳（本执行边界的可信本地时钟抽象；无网络 / 无时钟基础设施）           */
/* ------------------------------------------------------------------ */

/** 本地时区 ISO 序列化（与 W3-2 事件契约同一格式；无依赖）。 */
function localIsoTimestamp(): string {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export interface ObservationBridgeOptions {
  /** 生命周期时间戳提供者（默认本地 zoned ISO；测试可注入确定性时钟）。 */
  readonly now?: () => string;
}

/* ------------------------------------------------------------------ */
/* 范围如实映射                                                         */
/* ------------------------------------------------------------------ */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 范围字段如实派生：
 * - CUSTOMER：scope_type=CUSTOMER，scope_id=scope.customer_id（必须非空，否则
 *   无法如实表示 → null，调用方不发事件）。
 * - GLOBAL / NONE：scope_id=null（绝不伪造客户身份）。
 */
function scopeFields(
  requirement: CapabilityScopeRequirement,
  scope: CapabilityInvocationScope,
): { readonly scope_type: ObservationScopeType; readonly scope_id: string | null } | null {
  if (requirement === 'CUSTOMER') {
    if (!isNonEmptyString(scope.customer_id)) return null;
    return { scope_type: 'CUSTOMER', scope_id: scope.customer_id };
  }
  return { scope_type: requirement, scope_id: null };
}

/* ------------------------------------------------------------------ */
/* 稳定错误类别映射（只映射现有冻结类别；绝不复制 raw message/stack）        */
/* ------------------------------------------------------------------ */

function mapErrorCode(code: CapabilityExecutionErrorCode): ObservationErrorCode {
  switch (code) {
    case 'CAPABILITY_NOT_FOUND':
      return 'CAPABILITY_NOT_FOUND';
    case 'INVALID_INPUT':
      return 'INVALID_INPUT';
    case 'INVALID_SCOPE':
      return 'INVALID_SCOPE';
    case 'EXECUTOR_NOT_BOUND':
      return 'EXECUTOR_NOT_BOUND';
    case 'EXECUTOR_ERROR':
      return 'EXECUTOR_ERROR';
  }
}

/* ------------------------------------------------------------------ */
/* 桥                                                                  */
/* ------------------------------------------------------------------ */

export interface ObservationBridge {
  /** 作为 W3-1 观察器挂载（engine observer seam）。 */
  readonly observer: CapabilityExecutionObserver;
  /** 底层 W3-2 发射器（测试可读取事件历史）。 */
  readonly emitter: ObservationEmitter;
}

/**
 * 创建执行 → 观察桥。
 * - emitter：W3-2 事件接收端（生产可用 no-op emitter = 事件生成语义、零持久化；
 *   测试可用 createInMemoryObservationEmitter 校验生命周期）。
 * - now：可选时间戳提供者。
 */
export function createObservationBridge(
  emitter: ObservationEmitter,
  options: ObservationBridgeOptions = {},
): ObservationBridge {
  const now = options.now ?? localIsoTimestamp;

  const emit = (input: ObservationEventInput): void => {
    // 规范化 + 冻结由 W3-2 完成；emitter 拒绝（如重复 event_id）由引擎接缝包含。
    emitter.emit(createObservationEvent(input));
  };

  /** 只发射结构字段（能力身份 / 范围 / 执行器 / 决策 / 错误类别），零载荷。 */
  const observe = (event: CapabilityExecutionObservationEvent): void => {
    if (event.scope_requirement === undefined) return; // 无定义 → 无法如实派生范围/执行器
    const scoped = scopeFields(event.scope_requirement, event.scope);
    if (scoped === null) return; // 范围无法如实表示（如 CUSTOMER 缺 customer_id）
    if (!isNonEmptyString(event.executor_ref)) return; // 无真实执行器身份（CAPABILITY_NOT_FOUND）

    const base: Omit<ObservationEventInput, 'event_type' | 'authority_decision' | 'authority_reason_code' | 'error_code'> = {
      timestamp: now(),
      invocation_id: event.invocation_id,
      capability_id: event.capability_id,
      capability_version: event.capability_version,
      scope_type: scoped.scope_type,
      scope_id: scoped.scope_id,
      expected_scope_requirement: event.scope_requirement,
      executor_ref: event.executor_ref,
    };

    switch (event.phase) {
      case 'INVOCATION_STARTED': {
        emit({ ...base, event_type: 'INVOCATION_STARTED' });
        return;
      }
      case 'AUTHORITY_DECIDED': {
        const decision = event.authority_decision;
        if (decision === undefined) return;
        emit({
          ...base,
          event_type: 'AUTHORITY_DECIDED',
          authority_decision: decision.decision,
          authority_reason_code: decision.reason_code,
        });
        return;
      }
      case 'BEFORE_EXECUTION':
        // W3-2 词汇中没有 BEFORE_EXECUTION；不发明事件类型。
        return;
      case 'OUTCOME': {
        if (event.outcome === undefined) return;
        emitTerminal(base, event.outcome);
        return;
      }
    }
  };

  const emitTerminal = (
    base: Omit<ObservationEventInput, 'event_type' | 'authority_decision' | 'authority_reason_code' | 'error_code'>,
    outcome: CapabilityExecutionOutcome,
  ): void => {
    const decision = outcome.authority_decision;
    const decisionFields = decision === null || decision === undefined
      ? {}
      : { authority_decision: decision.decision as AuthorityDecisionKind, authority_reason_code: decision.reason_code as AuthorityDecisionReason };
    switch (outcome.status) {
      case 'SUCCESS':
        if (decision === null || decision === undefined) return; // 防御：成功结果必带决策
        emit({ ...base, event_type: 'EXECUTION_COMPLETED', ...decisionFields });
        return;
      case 'CONFIRMATION_REQUIRED':
        emit({ ...base, event_type: 'CONFIRMATION_REQUIRED', ...decisionFields });
        return;
      case 'STRONG_CONFIRMATION_REQUIRED':
        // 强确认：同一 CONFIRMATION_REQUIRED 事件类型，confirmation_state 由
        // W3-2 从 REQUIRE_STRONG_CONFIRMATION 精确派生为 STRONG_REQUIRED。
        emit({ ...base, event_type: 'CONFIRMATION_REQUIRED', ...decisionFields });
        return;
      case 'AUTONOMY_DENIED':
        emit({ ...base, event_type: 'AUTONOMY_DENIED', ...decisionFields });
        return;
      case 'EXECUTION_ERROR': {
        // 前置授权失败无真实决策（authority_decision=null）：W3-2 EXECUTION_FAILED
        // 要求治理决策 → 绝不伪造，不发终态事件；结果真值在 outcome 上。
        if (decision === null || decision === undefined) return;
        emit({ ...base, event_type: 'EXECUTION_FAILED', ...decisionFields, error_code: mapErrorCode(outcome.error_code) });
        return;
      }
    }
  };

  return { observer: { observe }, emitter };
}
