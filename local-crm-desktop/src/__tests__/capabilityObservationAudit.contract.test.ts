/**
 * V0.2A / W3-2 — Capability Observation / Audit Event Contract 聚焦测试。
 *
 * 覆盖规格 T1–T20（任务 §25）：
 *   T1  事件契约结构字段强制        T2  事件类型词汇
 *   T3  能力身份精确保留            T4  CUSTOMER 范围
 *   T5  GLOBAL 范围                T6  NONE 范围
 *   T7  授权决策保留                T8  确认要求与执行失败可区分
 *   T9  强确认语义                  T10 自主拒绝非执行错误/成功
 *   T11 执行成功                    T12 执行失败（稳定错误类别）
 *   T13 PII 最小化                  T14 Emitter 不可变性
 *   T15 重复/事件变异安全           T16 无持久化（静态边界）
 *   T17 无执行（静态边界）          T18 当前能力兼容（真实 manifest）
 *   T19 未来写能力兼容（合成 fixture） T20 无 V0.3 运行时（静态边界）
 *
 * 调用关联闭包（W3_2_01，T21–T26）：
 *   T21 invocation_id 必填（缺失/空/非字符串 fail closed）
 *   T22 同一 invocation 多事件关联
 *   T23 并发同能力同范围调用可区分
 *   T24 确认生命周期关联（invocation/authority/confirmation + 未来确认执行）
 *   T25 event_id 唯一性不被共享 invocation_id 削弱
 *   T26 invocation_id 不可变性
 *
 * 另含：A1 audit_contract 关系证据 + §26 契约级集成证据（真实冻结定义）。
 *
 * 仅构造事件与合成 fixture；不执行任何能力、不写 DB、不调用模型/网络/Provider。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import { AUTHORITY_DECISION_KINDS, AUTHORITY_DECISION_REASONS } from '../lib/capabilities/authority/types';
import type { CapabilityDefinition } from '../lib/capabilities';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../lib/capabilities/customer/manifest';
import { IMPORT_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/import/manifest';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline/manifest';
import { FOLLOW_UP_READ_MANIFEST } from '../lib/capabilities/followUp/manifest';
import { TASK_READ_MANIFEST } from '../lib/capabilities/task/manifest';
import { BATTLE_CARD_READ_MANIFEST } from '../lib/capabilities/battleCard/manifest';
import {
  createInMemoryObservationEmitter,
  createNoopObservationEmitter,
  createObservationEvent,
  normalizeObservationEvent,
  ObservationEventError,
  OBSERVATION_CONFIRMATION_STATES,
  OBSERVATION_ERROR_CODES,
  OBSERVATION_EVENT_TYPES,
  OBSERVATION_RESULT_STATUSES,
  OBSERVATION_SCOPE_TYPES,
  isValidObservationTimestamp,
  type ObservationEvent,
  type ObservationEventInput,
  type ObservationEventType,
} from '../lib/capabilities/observation';

/* ------------------------------------------------------------------ */
/* 测试基础                                                            */
/* ------------------------------------------------------------------ */

const FIXED_TS = '2025-08-13T22:25:00+08:00';
const CUSTOMER_GET_EXECUTOR = 'salesAgentTool:get_customer';

function makeDefinition(
  id: string,
  overrides: Partial<
    Pick<CapabilityDefinition, 'effect' | 'risk_level' | 'authority_policy' | 'requires_confirmation' | 'data_target' | 'scope_requirement' | 'idempotency'>
  > = {},
): CapabilityDefinition {
  return {
    id,
    version: '1.0.0',
    domain: 'fixture-observation',
    description: `W3-2 synthetic fixture: ${id}`,
    input_schema: 'fixture.input.v1',
    output_schema: 'fixture.output.v1',
    effect: 'READ',
    data_target: 'CRM_FACT',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'CUSTOMER',
    idempotency: 'SAFE',
    executor_ref: `fixture.executor:${id}`,
    audit_contract: {
      audit_required: false,
      record_input: false,
      record_output: false,
      record_effect: false,
    },
    error_contract: 'DISTINGUISHABLE',
    ...overrides,
  };
}

function baseInput(overrides: Partial<ObservationEventInput> = {}): ObservationEventInput {
  return {
    event_type: 'INVOCATION_STARTED',
    timestamp: FIXED_TS,
    invocation_id: 'inv-1001',
    capability_id: 'customer.get',
    capability_version: '1.0.0',
    scope_type: 'CUSTOMER',
    scope_id: 'cust-1001',
    executor_ref: CUSTOMER_GET_EXECUTOR,
    ...overrides,
  };
}

function inputForKind(kind: ObservationEventType): ObservationEventInput {
  const base = baseInput({ event_type: kind });
  switch (kind) {
    case 'INVOCATION_STARTED':
      return base;
    case 'AUTHORITY_DECIDED':
      return { ...base, authority_decision: 'ALLOW_AUTO', authority_reason_code: 'AUTO_ALLOWED' };
    case 'CONFIRMATION_REQUIRED':
      return { ...base, authority_decision: 'REQUIRE_CONFIRMATION', authority_reason_code: 'EXPLICIT_CONFIRMATION_REQUIRED' };
    case 'AUTONOMY_DENIED':
      return { ...base, authority_decision: 'DENY_AUTONOMOUS', authority_reason_code: 'AUTONOMY_DENIED' };
    case 'EXECUTION_COMPLETED':
      return { ...base, authority_decision: 'ALLOW_AUTO', authority_reason_code: 'AUTO_ALLOWED' };
    case 'EXECUTION_FAILED':
      return { ...base, authority_decision: 'ALLOW_AUTO', authority_reason_code: 'AUTO_ALLOWED', error_code: 'EXECUTOR_ERROR' };
  }
}

const ALL_PRODUCTION_MANIFESTS: readonly (readonly CapabilityDefinition[])[] = Object.freeze([
  CUSTOMER_CAPABILITY_MANIFEST,
  IMPORT_READ_CAPABILITY_MANIFEST,
  TIMELINE_READ_CAPABILITY_MANIFEST,
  FOLLOW_UP_READ_MANIFEST,
  TASK_READ_MANIFEST,
  BATTLE_CARD_READ_MANIFEST,
]);

const OBSERVATION_SOURCE_DIR = resolve(process.cwd(), 'src/lib/capabilities/observation');
const OBSERVATION_SOURCE_FILES = ['events.ts', 'emitter.ts', 'index.ts'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------ */
/* T1 – T3：契约结构 / 词汇 / 身份                                       */
/* ------------------------------------------------------------------ */

describe('W3-2 observation/audit event contract suite', () => {
  it('T1: the event contract enforces the required structural fields', () => {
    const event = createObservationEvent(baseInput());

    expect(typeof event.event_id).toBe('string');
    expect(event.event_id.length).toBeGreaterThan(0);
    expect(event.invocation_id).toBe('inv-1001');
    expect(event.event_type).toBe('INVOCATION_STARTED');
    expect(isValidObservationTimestamp(event.timestamp)).toBe(true);
    expect(event.capability_id).toBe('customer.get');
    expect(event.capability_version).toBe('1.0.0');
    expect(event.scope_type).toBe('CUSTOMER');
    expect(event.scope_id).toBe('cust-1001');
    expect(event.executor_ref).toBe(CUSTOMER_GET_EXECUTOR);
    expect(event.authority_decision).toBeNull();
    expect(event.authority_reason_code).toBeNull();
    expect(event.confirmation_required).toBe(false);
    expect(event.confirmation_state).toBe('NOT_REQUIRED');
    expect(event.result_status).toBe('NOT_EXECUTED');
    expect(event.error_code).toBeNull();

    // 关键身份字段缺失 → fail closed
    expect(() => createObservationEvent(baseInput({ capability_id: '' }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ capability_id: undefined }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ capability_version: '' }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ executor_ref: '' }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ invocation_id: undefined }))).toThrow(ObservationEventError);

    // 非对象输入 → fail closed
    expect(() => normalizeObservationEvent(null)).toThrow(ObservationEventError);
    expect(() => normalizeObservationEvent({})).toThrow(ObservationEventError);
  });

  it('T2: only the supported lifecycle event kinds are accepted (closed vocabulary)', () => {
    expect(OBSERVATION_EVENT_TYPES).toEqual([
      'INVOCATION_STARTED',
      'AUTHORITY_DECIDED',
      'CONFIRMATION_REQUIRED',
      'AUTONOMY_DENIED',
      'EXECUTION_COMPLETED',
      'EXECUTION_FAILED',
    ]);

    for (const kind of OBSERVATION_EVENT_TYPES) {
      expect(createObservationEvent(inputForKind(kind)).event_type).toBe(kind);
    }

    // 不支持的/虚构的类型一律拒绝
    expect(() =>
      createObservationEvent({ ...baseInput(), event_type: 'INVOCATION_COMPLETED' } as unknown as ObservationEventInput),
    ).toThrow(ObservationEventError);
    expect(() =>
      createObservationEvent({ ...baseInput(), event_type: 'EXECUTION_PLANNED' } as unknown as ObservationEventInput),
    ).toThrow(ObservationEventError);
    expect(() =>
      createObservationEvent({ ...baseInput(), event_type: 'AGENT_STEP' } as unknown as ObservationEventInput),
    ).toThrow(ObservationEventError);

    // 词汇常量与类型联合一致（运行时可枚举）
    expect(OBSERVATION_SCOPE_TYPES).toEqual(['GLOBAL', 'CUSTOMER', 'NONE']);
    expect(OBSERVATION_CONFIRMATION_STATES).toEqual([
      'NOT_REQUIRED', 'REQUIRED', 'STRONG_REQUIRED', 'CONFIRMED', 'REJECTED', 'CANCELLED',
    ]);
    expect(OBSERVATION_RESULT_STATUSES).toEqual(['SUCCESS', 'FAILED', 'NOT_EXECUTED']);
    expect(OBSERVATION_ERROR_CODES).toEqual([
      'CAPABILITY_NOT_FOUND', 'INVALID_INPUT', 'INVALID_SCOPE', 'AUTHORITY_DENIED', 'EXECUTOR_NOT_BOUND', 'EXECUTOR_ERROR',
    ]);
  });

  it('T3: capability identity (id + version) is preserved exactly', () => {
    const event = createObservationEvent(baseInput({ capability_id: 'customer.get', capability_version: '1.0.0' }));
    expect(event.capability_id).toBe('customer.get');
    expect(event.capability_version).toBe('1.0.0');

    // 精确保留：不修剪、不改写
    const exact = createObservationEvent(baseInput({ capability_id: ' import.file.preview ', capability_version: '1.0.0' }));
    expect(exact.capability_id).toBe(' import.file.preview ');
    expect(exact.capability_version).toBe('1.0.0');
  });

  /* ------------------------------------------------------------------ */
  /* T4 – T6：范围语义                                                    */
  /* ------------------------------------------------------------------ */

  it('T4: CUSTOMER-scoped events preserve the exact customer scope id', () => {
    const event = createObservationEvent(baseInput({ scope_type: 'CUSTOMER', scope_id: 'cust-42' }));
    expect(event.scope_type).toBe('CUSTOMER');
    expect(event.scope_id).toBe('cust-42');

    // CUSTOMER 缺 scope_id → fail closed（不得静默丢弃客户身份 / 不得谎报范围）
    expect(() => createObservationEvent(baseInput({ scope_type: 'CUSTOMER', scope_id: null }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ scope_type: 'CUSTOMER', scope_id: '   ' }))).toThrow(ObservationEventError);
  });

  it('T5: GLOBAL-scoped events never invent a customer id', () => {
    const event = createObservationEvent(baseInput({ scope_type: 'GLOBAL', scope_id: null }));
    expect(event.scope_type).toBe('GLOBAL');
    expect(event.scope_id).toBeNull();

    // GLOBAL 携带 scope_id（伪造客户身份）→ fail closed
    expect(() => createObservationEvent(baseInput({ scope_type: 'GLOBAL', scope_id: 'cust-999' }))).toThrow(ObservationEventError);
  });

  it('T6: NONE-scoped events (Import Preview / Validate style) carry no fabricated scope', () => {
    const event = createObservationEvent(
      baseInput({
        event_type: 'AUTHORITY_DECIDED',
        capability_id: 'import.file.preview',
        capability_version: '1.0.0',
        scope_type: 'NONE',
        scope_id: null,
        executor_ref: 'crm:parseExcelFile→findBestImportTable→autoDetectFields',
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
      }),
    );
    expect(event.scope_type).toBe('NONE');
    expect(event.scope_id).toBeNull();

    // NONE 不得被虚假标为客户范围
    expect(() => createObservationEvent(baseInput({ scope_type: 'NONE', scope_id: 'cust-1' }))).toThrow(ObservationEventError);
    // 与能力声明 scope_requirement 矛盾 → fail closed
    expect(() =>
      createObservationEvent(
        baseInput({ scope_type: 'CUSTOMER', scope_id: 'cust-1', expected_scope_requirement: 'NONE' }),
      ),
    ).toThrow(ObservationEventError);
  });

  /* ------------------------------------------------------------------ */
  /* T7 – T10：授权 / 确认语义                                             */
  /* ------------------------------------------------------------------ */

  it('T7: A10 decision kind + reason code are preserved without reinterpretation', () => {
    const definition = CUSTOMER_CAPABILITY_MANIFEST.find((d) => d.id === 'customer.get');
    expect(definition).toBeDefined();
    const decision = evaluateAuthorityPolicy(definition!);
    expect(decision.decision).toBe('ALLOW_AUTO');
    expect(decision.reason_code).toBe('AUTO_ALLOWED');

    const event = createObservationEvent(
      baseInput({
        event_type: 'AUTHORITY_DECIDED',
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );
    expect(event.authority_decision).toBe('ALLOW_AUTO');
    expect(event.authority_reason_code).toBe('AUTO_ALLOWED');
    expect(event.confirmation_required).toBe(false);
    expect(event.confirmation_state).toBe('NOT_REQUIRED');
    expect(event.result_status).toBe('NOT_EXECUTED');

    // 确认类决策 + 稳定原因码同样逐字保留
    const writeDecision = evaluateAuthorityPolicy(
      makeDefinition('fixture.confirm-write', { effect: 'WRITE', authority_policy: 'CONFIRM', requires_confirmation: true }),
    );
    expect(writeDecision.decision).toBe('REQUIRE_CONFIRMATION');
    const ev2 = createObservationEvent(
      baseInput({
        event_type: 'AUTHORITY_DECIDED',
        authority_decision: writeDecision.decision,
        authority_reason_code: writeDecision.reason_code,
      }),
    );
    expect(ev2.authority_decision).toBe('REQUIRE_CONFIRMATION');
    expect(ev2.confirmation_required).toBe(true);
    expect(ev2.confirmation_state).toBe('REQUIRED');

    // 词汇边界：A10 枚举之外的决策/原因码 → fail closed（防原因篡改）
    expect(() =>
      createObservationEvent({
        ...baseInput({ event_type: 'AUTHORITY_DECIDED', authority_decision: 'ALLOW_AUTO' }),
        authority_reason_code: 'TAMPERED_REASON',
      } as unknown as ObservationEventInput),
    ).toThrow(ObservationEventError);
    expect(() =>
      createObservationEvent({
        ...baseInput({ event_type: 'AUTHORITY_DECIDED' }),
        authority_decision: 'MAYBE_ALLOW',
      } as unknown as ObservationEventInput),
    ).toThrow(ObservationEventError);

    // 派生不变式：confirmation_required 精确等于 A10 语义
    expect(event.confirmation_required).toBe(event.authority_decision === 'ALLOW_AUTO' ? false : true);
    expect(AUTHORITY_DECISION_KINDS).toContain(event.authority_decision!);
    expect(AUTHORITY_DECISION_REASONS).toContain(event.authority_reason_code!);
  });

  it('T8: confirmation-required lifecycle is distinguishable from execution failure', () => {
    const required = createObservationEvent(
      baseInput({
        event_type: 'CONFIRMATION_REQUIRED',
        authority_decision: 'REQUIRE_CONFIRMATION',
        authority_reason_code: 'EXPLICIT_CONFIRMATION_REQUIRED',
      }),
    );
    const failed = createObservationEvent(
      baseInput({
        event_type: 'EXECUTION_FAILED',
        authority_decision: 'REQUIRE_CONFIRMATION',
        authority_reason_code: 'EXPLICIT_CONFIRMATION_REQUIRED',
        confirmation_state: 'CONFIRMED',
        error_code: 'EXECUTOR_ERROR',
      }),
    );

    expect(required.event_type).toBe('CONFIRMATION_REQUIRED');
    expect(required.result_status).toBe('NOT_EXECUTED');
    expect(required.error_code).toBeNull();
    expect(required.confirmation_state).toBe('REQUIRED');

    expect(failed.event_type).toBe('EXECUTION_FAILED');
    expect(failed.result_status).toBe('FAILED');
    expect(failed.error_code).toBe('EXECUTOR_ERROR');
    expect(failed.confirmation_state).toBe('CONFIRMED');

    // 二者绝不混淆：类型、结果、错误类别全部不同
    expect(required.event_type).not.toBe(failed.event_type);
    expect(required.result_status).not.toBe(failed.result_status);
  });

  it('T9: strong-confirmation semantics remain distinct from ordinary confirmation', () => {
    const strong = createObservationEvent(
      baseInput({
        event_type: 'CONFIRMATION_REQUIRED',
        authority_decision: 'REQUIRE_STRONG_CONFIRMATION',
        authority_reason_code: 'DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL',
      }),
    );
    expect(strong.confirmation_required).toBe(true);
    expect(strong.confirmation_state).toBe('STRONG_REQUIRED');
    expect(strong.confirmation_state).not.toBe('REQUIRED');

    // 强确认决策不得伪装成普通确认状态
    expect(() =>
      createObservationEvent(
        baseInput({
          event_type: 'CONFIRMATION_REQUIRED',
          authority_decision: 'REQUIRE_STRONG_CONFIRMATION',
          authority_reason_code: 'STRONG_CONFIRMATION_REQUIRED',
          confirmation_state: 'REQUIRED',
        }),
      ),
    ).toThrow(ObservationEventError);
  });

  it('T10: an autonomy-denied event is neither an execution error nor a success', () => {
    const denied = createObservationEvent(
      baseInput({
        event_type: 'AUTONOMY_DENIED',
        authority_decision: 'DENY_AUTONOMOUS',
        authority_reason_code: 'AUTONOMY_DENIED',
      }),
    );
    expect(denied.event_type).toBe('AUTONOMY_DENIED');
    expect(denied.result_status).toBe('NOT_EXECUTED');
    expect(denied.error_code).toBeNull();
    expect(denied.confirmation_required).toBe(false);
    expect(denied.authority_decision).toBe('DENY_AUTONOMOUS');

    // 拒绝 ≠ 执行错误：AUTONOMY_DENIED 不得携带错误类别
    expect(() =>
      createObservationEvent(
        baseInput({
          event_type: 'AUTONOMY_DENIED',
          authority_decision: 'DENY_AUTONOMOUS',
          authority_reason_code: 'AUTONOMY_DENIED',
          error_code: 'EXECUTOR_ERROR',
        }),
      ),
    ).toThrow(ObservationEventError);
    // 拒绝 ≠ 成功：DENY_AUTONOMOUS 不得产生执行完成事件
    expect(() =>
      createObservationEvent(
        baseInput({
          event_type: 'EXECUTION_COMPLETED',
          authority_decision: 'DENY_AUTONOMOUS',
          authority_reason_code: 'AUTONOMY_DENIED',
        }),
      ),
    ).toThrow(ObservationEventError);
  });

  /* ------------------------------------------------------------------ */
  /* T11 – T13：结果 / 错误 / PII 最小化                                   */
  /* ------------------------------------------------------------------ */

  it('T11: execution-success events carry structural metadata and no arbitrary business payload', () => {
    const event = createObservationEvent(
      baseInput({
        event_type: 'EXECUTION_COMPLETED',
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
      }),
    );
    expect(event.result_status).toBe('SUCCESS');
    expect(event.error_code).toBeNull();

    // 结构性元数据齐全（调用关联 / 身份 / 版本 / 时间 / 范围 / 执行器 / 授权 / 确认）
    expect(event.invocation_id).toBe('inv-1001');
    expect(event.capability_id).toBe('customer.get');
    expect(event.capability_version).toBe('1.0.0');
    expect(event.timestamp).toBe(FIXED_TS);
    expect(event.scope_type).toBe('CUSTOMER');
    expect(event.scope_id).toBe('cust-1001');
    expect(event.executor_ref).toBe(CUSTOMER_GET_EXECUTOR);
    expect(event.authority_decision).toBe('ALLOW_AUTO');
    expect(event.authority_reason_code).toBe('AUTO_ALLOWED');
    expect(event.confirmation_required).toBe(false);
    expect(event.confirmation_state).toBe('NOT_REQUIRED');

    // 事件键集合 = 精确的 15 个契约字段；不存在任何 payload / raw 字段
    expect(Object.keys(event).sort()).toEqual(
      [
        'authority_decision', 'authority_reason_code', 'capability_id', 'capability_version',
        'confirmation_required', 'confirmation_state', 'error_code', 'event_id', 'event_type',
        'executor_ref', 'invocation_id', 'result_status', 'scope_id', 'scope_type', 'timestamp',
      ].sort(),
    );
  });

  it('T12: execution-failure events record a stable error category without raw stack or sensitive data', () => {
    const event = createObservationEvent(
      baseInput({
        event_type: 'EXECUTION_FAILED',
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
        error_code: 'EXECUTOR_NOT_BOUND',
      }),
    );
    expect(event.result_status).toBe('FAILED');
    expect(event.error_code).toBe('EXECUTOR_NOT_BOUND');
    expect('stack' in event).toBe(false);
    expect('message' in event).toBe(false);
    expect('cause' in event).toBe(false);

    // 携带原始 stack 文本 → 拒绝
    expect(() =>
      createObservationEvent({
        ...baseInput({
          event_type: 'EXECUTION_FAILED',
          authority_decision: 'ALLOW_AUTO',
          authority_reason_code: 'AUTO_ALLOWED',
          error_code: 'EXECUTOR_ERROR',
        }),
        stack: 'Error: at fn (src/file.ts:12)',
      } as unknown as ObservationEventInput),
    ).toThrow(ObservationEventError);

    // EXECUTION_FAILED 必须携带稳定错误类别
    expect(() =>
      createObservationEvent(
        baseInput({
          event_type: 'EXECUTION_FAILED',
          authority_decision: 'ALLOW_AUTO',
          authority_reason_code: 'AUTO_ALLOWED',
        }),
      ),
    ).toThrow(ObservationEventError);
  });

  it('T13: PII minimization — disallowed raw payload fields are rejected by the explicit contract', () => {
    const disallowedKeys = [
      'raw_notes',
      'prompt',
      'model_response',
      'spreadsheet_rows',
      'api_key',
      'token',
      'password',
      'secret',
      'raw_evidence',
      'file_contents',
      'full_customer_payload',
    ];
    for (const key of disallowedKeys) {
      expect(
        () => createObservationEvent({ ...baseInput(), [key]: 'sensitive-value' } as unknown as ObservationEventInput),
        `raw payload field ${key} must be rejected`,
      ).toThrow(ObservationEventError);
    }

    // 事件对象不存在任何载荷字段（键集合固定为契约字段）
    const event = createObservationEvent(baseInput());
    for (const key of disallowedKeys) {
      expect(key in event).toBe(false);
    }

    // 高审计声明能力（audit_contract.record_input=true）的事件同样无载荷
    const previewEvent = createObservationEvent(
      baseInput({
        event_type: 'AUTHORITY_DECIDED',
        capability_id: 'import.file.preview',
        capability_version: '1.0.0',
        scope_type: 'NONE',
        scope_id: null,
        executor_ref: 'crm:parseExcelFile→findBestImportTable→autoDetectFields',
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
      }),
    );
    expect(previewEvent.scope_type).toBe('NONE');
    expect('rows' in previewEvent).toBe(false);
    expect('headers' in previewEvent).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* T14 – T15：Emitter 不可变性与重复安全                                  */
  /* ------------------------------------------------------------------ */

  it('T14: emitter immutability — mutating caller-owned input after emit does not alter emitted history', () => {
    const emitter = createInMemoryObservationEmitter();
    const input: ObservationEventInput = baseInput({ scope_id: 'cust-1001' });
    const callerEvent = createObservationEvent(input);
    const emitted = emitter.emit(callerEvent);

    // 调用方事后篡改自己的输入对象（模拟可变引用泄漏）
    (input as { scope_id: string | null }).scope_id = 'cust-9999';
    (input as { authority_decision: string | null }).authority_decision = 'DENY_AUTONOMOUS';

    // 工厂产出的事件本身即冻结：调用方无法变异（严格模式下赋值抛 TypeError）
    expect(() => {
      (callerEvent as { scope_id: string | null }).scope_id = 'cust-8888';
    }).toThrow(TypeError);

    const stored = emitter.events()[0];
    expect(stored.scope_id).toBe('cust-1001');
    expect(stored.authority_decision).toBeNull();
    expect(stored).not.toBe(callerEvent); // emitter 保存的是规范化副本，不是调用方对象/输入引用
    expect(emitted).toBe(stored); // emit 返回存储的冻结副本（安全：不可变）
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(emitted)).toBe(true);

    // 已发射事件不可被调用方改写（冻结；严格模式下赋值抛 TypeError）
    expect(() => {
      (stored as { scope_id: string | null }).scope_id = 'cust-7777';
    }).toThrow(TypeError);
  });

  it('T15: duplicate event ids are rejected — no mutable event overwrite behavior', () => {
    const emitter = createInMemoryObservationEmitter();
    const first = createObservationEvent(baseInput({ event_id: 'OBS-dup-1' }));
    const second = createObservationEvent(
      baseInput({
        event_id: 'OBS-dup-1',
        event_type: 'AUTHORITY_DECIDED',
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
      }),
    );

    emitter.emit(first);
    expect(() => emitter.emit(second)).toThrow(ObservationEventError);
    expect(emitter.size()).toBe(1);

    // 首次事件保持原样（未被覆盖）
    expect(emitter.events()[0].event_type).toBe('INVOCATION_STARTED');
    expect(emitter.events()[0].event_id).toBe('OBS-dup-1');

    // 不同 id 正常追加；快照为冻结副本
    emitter.emit(createObservationEvent(baseInput({ event_id: 'OBS-dup-2' })));
    expect(emitter.size()).toBe(2);
    expect(emitter.events()[1].event_id).toBe('OBS-dup-2');
  });

  it('event identity: auto-generated event ids follow the stable local format; no network/UUID dependency', () => {
    const e1 = createObservationEvent(baseInput());
    const e2 = createObservationEvent(baseInput());
    expect(e1.event_id).toMatch(/^OBS-\d{6}$/);
    expect(e2.event_id).toMatch(/^OBS-\d{6}$/);
    expect(e2.event_id).not.toBe(e1.event_id);
  });

  it('event timestamp: explicit timestamps preserved; default timestamp is a valid project-style ISO', () => {
    const explicit = createObservationEvent(baseInput({ timestamp: '2025-08-13T22:25:00+08:00' }));
    expect(explicit.timestamp).toBe('2025-08-13T22:25:00+08:00');

    const auto = createObservationEvent(baseInput({ timestamp: undefined }));
    expect(isValidObservationTimestamp(auto.timestamp)).toBe(true);

    expect(() => createObservationEvent(baseInput({ timestamp: 'not-a-timestamp' }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ timestamp: '2025-13-45T99:99:99+08:00' }))).toThrow(ObservationEventError);
  });

  it('emitter contract: no-op emitter validates and discards; deterministic API', () => {
    const emitter = createNoopObservationEmitter();
    const result = emitter.emit(createObservationEvent(baseInput()));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.event_type).toBe('INVOCATION_STARTED');
    // 无效事件即使对 no-op emitter 也 fail closed
    expect(() =>
      emitter.emit({ ...baseInput(), event_type: 'BOGUS' } as unknown as ObservationEvent),
    ).toThrow(ObservationEventError);
  });

  /* ------------------------------------------------------------------ */
  /* T16 – T17：静态边界（无持久化 / 无执行）                               */
  /* ------------------------------------------------------------------ */

  it('T16: no persistence — no SQLite/file/network/telemetry sink added (static boundary)', () => {
    const forbidden =
      /(better-sqlite3|@tauri|node:fs|\bwriteFile\b|appendFile|localStorage|sessionStorage|IndexedDB|createCrmRepository|sqlite|fetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\/|console\.log|console\.warn)/;
    for (const file of OBSERVATION_SOURCE_FILES) {
      const code = stripComments(readFileSync(resolve(OBSERVATION_SOURCE_DIR, file), 'utf8'));
      expect(code, `${file} must not reference persistence/network machinery`).not.toMatch(forbidden);
    }
  });

  it('T17: no execution — EXECUTOR_CALLS=0 / CRM_WRITES=0 (static import boundary)', () => {
    const forbidden =
      /(confirmedWrite|approvedCrmWriteBoundary|sessionWriteStateStore|importer|executeImport|readAdapter|createCustomer|updateCustomer|createTask|updateTask|createCrmRepository|salesAgentTools|\brequire\s*\(|import\s*\(|from\s+['"]node:)/;
    for (const file of OBSERVATION_SOURCE_FILES) {
      const code = stripComments(readFileSync(resolve(OBSERVATION_SOURCE_DIR, file), 'utf8'));
      expect(code, `${file} must not reference executor/DB machinery`).not.toMatch(forbidden);

      // 模块图静态边界：只允许本层 / A10 词汇 / A1 契约层
      const imports = [...code.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map((m) => m[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} import specifier`).toMatch(
          /^\.\/(events|emitter|index)$|^\.\.\/authority\/types$|^\.\.\/types$/,
        );
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* T18 – T19：当前能力兼容 / 未来写能力兼容                                */
  /* ------------------------------------------------------------------ */

  it('T18: every current production capability class (GLOBAL/CUSTOMER/NONE × READ/ANALYZE) produces valid event metadata', () => {
    const allDefinitions = ALL_PRODUCTION_MANIFESTS.flat();
    expect(allDefinitions.length).toBeGreaterThanOrEqual(13);

    const coveredScopes = new Set<string>();
    const coveredEffects = new Set<string>();

    for (const definition of allDefinitions) {
      coveredScopes.add(definition.scope_requirement);
      coveredEffects.add(definition.effect);

      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision, `production ${definition.id} stays autonomous`).toBe('ALLOW_AUTO');

      const event = createObservationEvent({
        event_type: 'AUTHORITY_DECIDED',
        timestamp: FIXED_TS,
        invocation_id: `inv-t18-${definition.id}`,
        capability_id: definition.id,
        capability_version: definition.version,
        scope_type: definition.scope_requirement,
        scope_id: definition.scope_requirement === 'CUSTOMER' ? 'cust-1001' : null,
        expected_scope_requirement: definition.scope_requirement,
        executor_ref: definition.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      });

      expect(event.capability_id).toBe(definition.id);
      expect(event.capability_version).toBe(definition.version);
      expect(event.scope_type).toBe(definition.scope_requirement);
      expect(event.executor_ref).toBe(definition.executor_ref);
      expect(event.invocation_id).toBe(`inv-t18-${definition.id}`);
      expect(event.authority_decision).toBe('ALLOW_AUTO');
      expect(event.result_status).toBe('NOT_EXECUTED');

      // 身份可回解析到 A1 定义及其 audit_contract（关系保持：事件不复制/不修改 audit_contract）
      const resolved = allDefinitions.find(
        (d) => d.id === event.capability_id && d.version === event.capability_version,
      );
      expect(resolved).toBeDefined();
      expect(resolved!.audit_contract.audit_required).toBe(definition.audit_contract.audit_required);
      expect('audit_contract' in event).toBe(false);
    }

    // 三种范围 + READ/ANALYZE 全部被覆盖（真实 manifest 真相）
    expect(coveredScopes).toEqual(new Set(['GLOBAL', 'CUSTOMER', 'NONE']));
    expect(coveredEffects.has('READ')).toBe(true);
    expect(coveredEffects.has('ANALYZE')).toBe(true);
  });

  it('T19: synthetic WRITE / BULK_WRITE / DELETE authority outcomes are representable without executing actions', () => {
    const writeDef = makeDefinition('fixture.customer.write', {
      effect: 'WRITE', data_target: 'CRM_STATE', risk_level: 'LOW', authority_policy: 'POLICY_CONTROLLED', idempotency: 'REQUIRED',
    });
    const deleteDef = makeDefinition('fixture.customer.delete', {
      effect: 'DELETE', data_target: 'CRM_STATE', risk_level: 'HIGH', authority_policy: 'AUTO', idempotency: 'REQUIRED',
    });
    const bulkDef = makeDefinition('fixture.customer.bulk-write', {
      effect: 'BULK_WRITE', data_target: 'CRM_STATE', risk_level: 'MEDIUM', authority_policy: 'AUTO', idempotency: 'REQUIRED',
    });
    const deniedDef = makeDefinition('fixture.customer.denied', { effect: 'WRITE', authority_policy: 'DENY_AUTONOMOUS' });

    const writeDecision = evaluateAuthorityPolicy(writeDef);
    const deleteDecision = evaluateAuthorityPolicy(deleteDef);
    const bulkDecision = evaluateAuthorityPolicy(bulkDef);
    const deniedDecision = evaluateAuthorityPolicy(deniedDef);

    expect(writeDecision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(deleteDecision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(bulkDecision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(deniedDecision.decision).toBe('DENY_AUTONOMOUS');

    const eventInputFor = (definition: CapabilityDefinition, decision: { decision: string; reason_code: string }): ObservationEventInput => ({
      event_type: 'CONFIRMATION_REQUIRED',
      timestamp: FIXED_TS,
      invocation_id: 'inv-t19-confirm',
      capability_id: definition.id,
      capability_version: definition.version,
      scope_type: 'CUSTOMER',
      scope_id: 'cust-1001',
      executor_ref: definition.executor_ref,
      authority_decision: decision.decision as ObservationEventInput['authority_decision'],
      authority_reason_code: decision.reason_code as ObservationEventInput['authority_reason_code'],
    });

    // WRITE → 确认要求（NOT_EXECUTED，非执行）
    const confirmEvent = createObservationEvent(eventInputFor(writeDef, writeDecision));
    expect(confirmEvent.confirmation_required).toBe(true);
    expect(confirmEvent.confirmation_state).toBe('REQUIRED');
    expect(confirmEvent.result_status).toBe('NOT_EXECUTED');
    expect(confirmEvent.error_code).toBeNull();

    // DELETE / BULK_WRITE → 强确认要求（T9 语义保持）
    const strongEvent = createObservationEvent(eventInputFor(deleteDef, deleteDecision));
    expect(strongEvent.confirmation_state).toBe('STRONG_REQUIRED');
    expect(createObservationEvent(eventInputFor(bulkDef, bulkDecision)).confirmation_state).toBe('STRONG_REQUIRED');

    // 自主拒绝 → AUTONOMY_DENIED（非执行错误/成功）
    const deniedEvent = createObservationEvent({
      event_type: 'AUTONOMY_DENIED',
      timestamp: FIXED_TS,
      invocation_id: 'inv-t19-deny',
      capability_id: deniedDef.id,
      capability_version: deniedDef.version,
      scope_type: 'CUSTOMER',
      scope_id: 'cust-1001',
      executor_ref: deniedDef.executor_ref,
      authority_decision: 'DENY_AUTONOMOUS',
      authority_reason_code: deniedDecision.reason_code,
    });
    expect(deniedEvent.result_status).toBe('NOT_EXECUTED');
    expect(deniedEvent.error_code).toBeNull();

    // 成功的已确认执行（synthetic；不执行任何动作）
    const confirmedSuccess = createObservationEvent({
      event_type: 'EXECUTION_COMPLETED',
      timestamp: FIXED_TS,
      invocation_id: 'inv-t19-success',
      capability_id: writeDef.id,
      capability_version: writeDef.version,
      scope_type: 'CUSTOMER',
      scope_id: 'cust-1001',
      executor_ref: writeDef.executor_ref,
      authority_decision: 'REQUIRE_CONFIRMATION',
      authority_reason_code: 'EXPLICIT_CONFIRMATION_REQUIRED',
      confirmation_state: 'CONFIRMED',
    });
    expect(confirmedSuccess.result_status).toBe('SUCCESS');
    expect(confirmedSuccess.confirmation_state).toBe('CONFIRMED');
    expect(confirmedSuccess.confirmation_required).toBe(true);

    // 失败的已确认执行（synthetic）
    const confirmedFailure = createObservationEvent({
      event_type: 'EXECUTION_FAILED',
      timestamp: FIXED_TS,
      invocation_id: 'inv-t19-failure',
      capability_id: writeDef.id,
      capability_version: writeDef.version,
      scope_type: 'CUSTOMER',
      scope_id: 'cust-1001',
      executor_ref: writeDef.executor_ref,
      authority_decision: 'REQUIRE_CONFIRMATION',
      authority_reason_code: 'EXPLICIT_CONFIRMATION_REQUIRED',
      confirmation_state: 'CONFIRMED',
      error_code: 'EXECUTOR_ERROR',
    });
    expect(confirmedFailure.result_status).toBe('FAILED');
    expect(confirmedFailure.error_code).toBe('EXECUTOR_ERROR');
  });

  /* ------------------------------------------------------------------ */
  /* T20：无 V0.3 运行时                                                  */
  /* ------------------------------------------------------------------ */

  it('T20: no planner / tool-selection / agent-loop runtime is added (static boundary)', () => {
    const forbidden =
      /(planner|planExecution|tool.?select|agent.?loop|goal.?decompos|retry.?loop|multi.?agent|intentReplacement|AgentRuntime|semanticPlanning|operatingLayer)/i;
    for (const file of OBSERVATION_SOURCE_FILES) {
      const code = stripComments(readFileSync(resolve(OBSERVATION_SOURCE_DIR, file), 'utf8'));
      expect(code, `${file} must not reference V0.3 runtime machinery`).not.toMatch(forbidden);
    }
  });

  /* ------------------------------------------------------------------ */
  /* T21 – T26：调用关联（invocation_id）闭包                              */
  /* ------------------------------------------------------------------ */

  it('T21: invocation id is required — missing/empty/invalid fails closed', () => {
    // 缺失 → INVALID_INVOCATION_ID
    expect(() => createObservationEvent(baseInput({ invocation_id: undefined }))).toThrow(ObservationEventError);
    // 空串 / 空白串 → fail closed
    expect(() => createObservationEvent(baseInput({ invocation_id: '' }))).toThrow(ObservationEventError);
    expect(() => createObservationEvent(baseInput({ invocation_id: '   ' }))).toThrow(ObservationEventError);
    // 非字符串（数字 / 布尔 / 对象 / 数组 / null）→ fail closed
    expect(() => createObservationEvent({ ...baseInput(), invocation_id: 42 } as unknown as ObservationEventInput)).toThrow(ObservationEventError);
    expect(() => createObservationEvent({ ...baseInput(), invocation_id: true } as unknown as ObservationEventInput)).toThrow(ObservationEventError);
    expect(() => createObservationEvent({ ...baseInput(), invocation_id: null } as unknown as ObservationEventInput)).toThrow(ObservationEventError);
    expect(() => createObservationEvent({ ...baseInput(), invocation_id: { id: 'inv-1' } } as unknown as ObservationEventInput)).toThrow(ObservationEventError);
    expect(() => createObservationEvent({ ...baseInput(), invocation_id: ['inv-1'] } as unknown as ObservationEventInput)).toThrow(ObservationEventError);

    // 错误码精确可区分
    let code = '';
    try {
      createObservationEvent(baseInput({ invocation_id: '' }));
    } catch (error) {
      code = (error as ObservationEventError).code;
    }
    expect(code).toBe('INVALID_INVOCATION_ID');

    // 显式标量精确保留（不修剪、不推断）
    const event = createObservationEvent(baseInput({ invocation_id: 'inv-abc-123' }));
    expect(event.invocation_id).toBe('inv-abc-123');
  });

  it('T22: multiple unique events may share one invocation_id (same-invocation correlation)', () => {
    const emitter = createInMemoryObservationEmitter();
    emitter.emit(
      createObservationEvent(baseInput({ event_id: 'e1', event_type: 'INVOCATION_STARTED', invocation_id: 'inv-1' })),
    );
    emitter.emit(
      createObservationEvent(
        baseInput({
          event_id: 'e2',
          event_type: 'AUTHORITY_DECIDED',
          invocation_id: 'inv-1',
          authority_decision: 'ALLOW_AUTO',
          authority_reason_code: 'AUTO_ALLOWED',
        }),
      ),
    );
    emitter.emit(
      createObservationEvent(
        baseInput({
          event_id: 'e3',
          event_type: 'EXECUTION_COMPLETED',
          invocation_id: 'inv-1',
          authority_decision: 'ALLOW_AUTO',
          authority_reason_code: 'AUTO_ALLOWED',
        }),
      ),
    );

    const events = emitter.events();
    expect(emitter.size()).toBe(3);
    expect(events.map((e) => e.event_id)).toEqual(['e1', 'e2', 'e3']);
    // 同一 invocation_id 无歧义分组：全部生命周期事件共享 inv-1
    const grouped = events.filter((e) => e.invocation_id === 'inv-1');
    expect(grouped.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    // 每个事件 event_id 唯一
    expect(new Set(events.map((e) => e.event_id)).size).toBe(3);
  });

  it('T23: concurrent same-capability same-scope invocations remain distinguishable', () => {
    const emitter = createInMemoryObservationEmitter();
    // 两次并发调用：customer.get + customer=A，仅 invocation_id 不同
    const emitInvocation = (invocationId: string): void => {
      emitter.emit(
        createObservationEvent(
          baseInput({
            event_id: `${invocationId}-start`,
            event_type: 'INVOCATION_STARTED',
            invocation_id: invocationId,
            capability_id: 'customer.get',
            capability_version: '1.0.0',
            scope_type: 'CUSTOMER',
            scope_id: 'cust-A',
          }),
        ),
      );
      emitter.emit(
        createObservationEvent(
          baseInput({
            event_id: `${invocationId}-authority`,
            event_type: 'AUTHORITY_DECIDED',
            invocation_id: invocationId,
            capability_id: 'customer.get',
            capability_version: '1.0.0',
            scope_type: 'CUSTOMER',
            scope_id: 'cust-A',
            authority_decision: 'ALLOW_AUTO',
            authority_reason_code: 'AUTO_ALLOWED',
          }),
        ),
      );
    };
    // 交错发射：inv-1 → inv-2 → inv-1（真实并发时序）
    emitInvocation('inv-1');
    emitInvocation('inv-2');
    emitter.emit(
      createObservationEvent(
        baseInput({
          event_id: 'inv-1-completed',
          event_type: 'EXECUTION_COMPLETED',
          invocation_id: 'inv-1',
          capability_id: 'customer.get',
          capability_version: '1.0.0',
          scope_type: 'CUSTOMER',
          scope_id: 'cust-A',
          authority_decision: 'ALLOW_AUTO',
          authority_reason_code: 'AUTO_ALLOWED',
        }),
      ),
    );

    const events = emitter.events();
    // 按 invocation_id 分组：互不混淆
    const inv1 = events.filter((e) => e.invocation_id === 'inv-1');
    const inv2 = events.filter((e) => e.invocation_id === 'inv-2');
    expect(inv1.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    expect(inv2.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED']);
    expect(inv1.every((e) => e.capability_id === 'customer.get' && e.scope_id === 'cust-A')).toBe(true);
    expect(inv2.every((e) => e.capability_id === 'customer.get' && e.scope_id === 'cust-A')).toBe(true);
    // inv-2 的事件绝不被 inv-1 的完成事件污染
    expect(inv2.some((e) => e.event_id === 'inv-1-completed')).toBe(false);
    // 全部 event_id 全局唯一
    expect(new Set(events.map((e) => e.event_id)).size).toBe(events.length);
  });

  it('T24: confirmation lifecycle correlation — invocation/authority/confirmation-required preserve one invocation_id', () => {
    const writeDef = makeDefinition('fixture.correlation.write', {
      effect: 'WRITE', data_target: 'CRM_STATE', risk_level: 'LOW', authority_policy: 'CONFIRM', requires_confirmation: true,
    });
    const decision = evaluateAuthorityPolicy(writeDef);
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');

    const emitter = createInMemoryObservationEmitter();
    emitter.emit(
      createObservationEvent({
        event_type: 'INVOCATION_STARTED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-write-7',
        capability_id: writeDef.id,
        capability_version: writeDef.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        executor_ref: writeDef.executor_ref,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'AUTHORITY_DECIDED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-write-7',
        capability_id: writeDef.id,
        capability_version: writeDef.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        executor_ref: writeDef.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'CONFIRMATION_REQUIRED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-write-7',
        capability_id: writeDef.id,
        capability_version: writeDef.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        executor_ref: writeDef.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );

    const preExecution = emitter.events();
    expect(preExecution.every((e) => e.invocation_id === 'inv-write-7')).toBe(true);
    expect(preExecution.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);

    // 契约兼容性（不实现确认持久化/运行时）：未来已确认执行事件必须能保留同一 invocation_id
    const confirmedExecution = createObservationEvent({
      event_type: 'EXECUTION_COMPLETED',
      timestamp: FIXED_TS,
      invocation_id: 'inv-write-7',
      capability_id: writeDef.id,
      capability_version: writeDef.version,
      scope_type: 'CUSTOMER',
      scope_id: 'cust-1001',
      executor_ref: writeDef.executor_ref,
      authority_decision: 'REQUIRE_CONFIRMATION',
      authority_reason_code: 'EXPLICIT_CONFIRMATION_REQUIRED',
      confirmation_state: 'CONFIRMED',
    });
    expect(confirmedExecution.invocation_id).toBe('inv-write-7');
    expect(confirmedExecution.confirmation_state).toBe('CONFIRMED');
    expect(confirmedExecution.result_status).toBe('SUCCESS');
    expect(preExecution.map((e) => e.event_id)).not.toContain(confirmedExecution.event_id);
  });

  it('T25: event id uniqueness is not weakened by a shared invocation_id', () => {
    const emitter = createInMemoryObservationEmitter();
    emitter.emit(
      createObservationEvent(baseInput({ event_id: 'OBS-shared-1', invocation_id: 'inv-shared' })),
    );
    // 同一 invocation_id + 重复 event_id → 仍拒绝（DUPLICATE_EVENT_ID）
    expect(() =>
      emitter.emit(
        createObservationEvent(
          baseInput({
            event_id: 'OBS-shared-1',
            invocation_id: 'inv-shared',
            event_type: 'AUTHORITY_DECIDED',
            authority_decision: 'ALLOW_AUTO',
            authority_reason_code: 'AUTO_ALLOWED',
          }),
        ),
      ),
    ).toThrow(ObservationEventError);
    expect(emitter.size()).toBe(1);

    // 同一 invocation_id + 不同 event_id → 正常接受（正常且必需）
    emitter.emit(
      createObservationEvent(
        baseInput({
          event_id: 'OBS-shared-2',
          invocation_id: 'inv-shared',
          event_type: 'EXECUTION_COMPLETED',
          authority_decision: 'ALLOW_AUTO',
          authority_reason_code: 'AUTO_ALLOWED',
        }),
      ),
    );
    expect(emitter.size()).toBe(2);
    expect(emitter.events().every((e) => e.invocation_id === 'inv-shared')).toBe(true);
  });

  it('T26: invocation id immutability — caller mutation cannot alter emitted correlation identity', () => {
    const emitter = createInMemoryObservationEmitter();
    const input: ObservationEventInput = baseInput({ invocation_id: 'inv-immutable-1' });
    emitter.emit(createObservationEvent(input));

    // 调用方事后篡改自己的输入对象
    (input as { invocation_id: string }).invocation_id = 'inv-HIJACKED';
    (input as { scope_id: string | null }).scope_id = 'cust-9999';

    const stored = emitter.events()[0];
    expect(stored.invocation_id).toBe('inv-immutable-1');
    expect(stored.scope_id).toBe('cust-1001');
    expect(Object.isFrozen(stored)).toBe(true);

    // 已发射事件不可改写关联身份（冻结；严格模式下赋值抛 TypeError）
    expect(() => {
      (stored as { invocation_id: string }).invocation_id = 'inv-HIJACKED-2';
    }).toThrow(TypeError);
  });

  /* ------------------------------------------------------------------ */
  /* A1 关系 + §26 集成证据                                                */
  /* ------------------------------------------------------------------ */

  it('A1 relationship: audit_contract stays on the frozen definition — events reference identity without copying it', () => {
    const definition = CUSTOMER_CAPABILITY_MANIFEST.find((d) => d.id === 'customer.get');
    expect(definition).toBeDefined();
    expect(definition!.audit_contract).toEqual({
      audit_required: false,
      record_input: false,
      record_output: false,
      record_effect: false,
    });

    const event = createObservationEvent(
      baseInput({ capability_id: definition!.id, capability_version: definition!.version }),
    );
    expect(event.capability_id).toBe(definition!.id);
    expect(event.capability_version).toBe(definition!.version);
    expect('audit_contract' in event).toBe(false);
    expect(definition!.audit_contract.audit_required).toBe(false);

    // 高审计声明能力（import.file.preview: audit_required=true, record_input=true）
    // 其事件仍无载荷——audit_contract 不进入事件，记录内容属未来持久化层职责。
    const preview = IMPORT_READ_CAPABILITY_MANIFEST.find((d) => d.id === 'import.file.preview');
    expect(preview).toBeDefined();
    expect(preview!.audit_contract.record_input).toBe(true);
    const previewEvent = createObservationEvent(
      baseInput({
        event_type: 'AUTHORITY_DECIDED',
        capability_id: preview!.id,
        capability_version: preview!.version,
        scope_type: 'NONE',
        scope_id: null,
        executor_ref: preview!.executor_ref,
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
      }),
    );
    expect(previewEvent.capability_id).toBe('import.file.preview');
    expect(previewEvent.scope_type).toBe('NONE');
    expect('rows' in previewEvent).toBe(false);
    expect('headers' in previewEvent).toBe(false);
    expect('audit_contract' in previewEvent).toBe(false);
  });

  it('integration evidence: customer.get + synthetic invocation + A10 ALLOW_AUTO → invocation/authority/success sequence', () => {
    const definition = CUSTOMER_CAPABILITY_MANIFEST.find((d) => d.id === 'customer.get')!;
    const decision = evaluateAuthorityPolicy(definition);

    const emitter = createInMemoryObservationEmitter();
    emitter.emit(
      createObservationEvent({
        event_type: 'INVOCATION_STARTED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-seq-1',
        capability_id: definition.id,
        capability_version: definition.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        expected_scope_requirement: definition.scope_requirement,
        executor_ref: definition.executor_ref,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'AUTHORITY_DECIDED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-seq-1',
        capability_id: definition.id,
        capability_version: definition.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        expected_scope_requirement: definition.scope_requirement,
        executor_ref: definition.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'EXECUTION_COMPLETED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-seq-1',
        capability_id: definition.id,
        capability_version: definition.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        expected_scope_requirement: definition.scope_requirement,
        executor_ref: definition.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );

    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    expect(events.map((e) => e.result_status)).toEqual(['NOT_EXECUTED', 'NOT_EXECUTED', 'SUCCESS']);
    for (const event of events) {
      expect(event.invocation_id).toBe('inv-seq-1');
      expect(event.capability_id).toBe('customer.get');
      expect(event.capability_version).toBe('1.0.0');
      expect(event.scope_type).toBe('CUSTOMER');
      expect(event.scope_id).toBe('cust-1001');
    }
  });

  it('integration evidence: import.file.preview (NONE scope) + ALLOW_AUTO → valid event sequence', () => {
    const definition = IMPORT_READ_CAPABILITY_MANIFEST.find((d) => d.id === 'import.file.preview')!;
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.decision).toBe('ALLOW_AUTO');

    const emitter = createInMemoryObservationEmitter();
    emitter.emit(
      createObservationEvent({
        event_type: 'INVOCATION_STARTED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-preview-1',
        capability_id: definition.id,
        capability_version: definition.version,
        scope_type: 'NONE',
        scope_id: null,
        expected_scope_requirement: definition.scope_requirement,
        executor_ref: definition.executor_ref,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'EXECUTION_COMPLETED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-preview-1',
        capability_id: definition.id,
        capability_version: definition.version,
        scope_type: 'NONE',
        scope_id: null,
        expected_scope_requirement: definition.scope_requirement,
        executor_ref: definition.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );

    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'EXECUTION_COMPLETED']);
    for (const event of events) {
      expect(event.invocation_id).toBe('inv-preview-1');
      expect(event.scope_type).toBe('NONE');
      expect(event.scope_id).toBeNull();
    }
    expect(events[1].result_status).toBe('SUCCESS');
  });

  it('integration evidence: synthetic DELETE + REQUIRE_STRONG_CONFIRMATION → confirmation-required event, no execution event', () => {
    const deleteDef = makeDefinition('fixture.integration.delete', {
      effect: 'DELETE', data_target: 'CRM_STATE', risk_level: 'HIGH', authority_policy: 'AUTO', idempotency: 'REQUIRED',
    });
    const decision = evaluateAuthorityPolicy(deleteDef);
    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');

    const emitter = createInMemoryObservationEmitter();
    emitter.emit(
      createObservationEvent({
        event_type: 'INVOCATION_STARTED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-delete-1',
        capability_id: deleteDef.id,
        capability_version: deleteDef.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        executor_ref: deleteDef.executor_ref,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'AUTHORITY_DECIDED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-delete-1',
        capability_id: deleteDef.id,
        capability_version: deleteDef.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        executor_ref: deleteDef.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );
    emitter.emit(
      createObservationEvent({
        event_type: 'CONFIRMATION_REQUIRED',
        timestamp: FIXED_TS,
        invocation_id: 'inv-delete-1',
        capability_id: deleteDef.id,
        capability_version: deleteDef.version,
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1001',
        executor_ref: deleteDef.executor_ref,
        authority_decision: decision.decision,
        authority_reason_code: decision.reason_code,
      }),
    );

    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
    expect(events.every((e) => e.invocation_id === 'inv-delete-1')).toBe(true);
    expect(events[2].confirmation_state).toBe('STRONG_REQUIRED');
    expect(events[2].result_status).toBe('NOT_EXECUTED');
    // 未确认：没有产生任何 EXECUTION_* 事件
    expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
  });
});
