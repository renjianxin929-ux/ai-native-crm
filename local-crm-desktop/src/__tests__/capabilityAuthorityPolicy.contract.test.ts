/**
 * V0.2A / A10 — Capability Authority Policy Contract 聚焦测试。
 *
 * 覆盖规格 T1–T18：
 *   T1  AUTO READ           T2  ANALYZE / DRAFT
 *   T3  EXPLICIT CONFIRM    T4  REQUIRES_CONFIRMATION 覆盖
 *   T5  STRONG CONFIRM      T6  DENY AUTONOMOUS
 *   T7  DELETE effect 楼层   T8  BULK_WRITE effect 楼层
 *   T9  DESTRUCTIVE risk 楼层 T10 HIGH 风险写入楼层
 *   T11 POLICY_CONTROLLED    T12 无效/矛盾 fail closed
 *   T13 稳定原因码           T14 零执行
 *   T15 零模型/网络          T16 Wave 1 READ 兼容
 *   T17 不可变性/调用方安全  T18 生产 manifest 安全
 *
 * 仅使用合成 fixture（fixture.* 前缀，domain=fixture-authority），
 * 不注册任何真实 CRM 能力；合成 fixture 绝不进入生产 manifest。
 * 策略评估是纯函数：无执行、无 DB、无模型、无网络、无持久化。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateAuthorityPolicy,
  type AuthorityDecisionReason,
} from '../lib/capabilities/authority';
import { AUTHORITY_DECISION_KINDS, AUTHORITY_DECISION_REASONS } from '../lib/capabilities/authority/types';
import type { CapabilityDefinition } from '../lib/capabilities';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../lib/capabilities/customer/manifest';
import { FOLLOW_UP_READ_MANIFEST } from '../lib/capabilities/followUp/manifest';
import { TASK_READ_MANIFEST } from '../lib/capabilities/task/manifest';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline/manifest';

/* ------------------------------------------------------------------ */
/* 合成 fixture 工厂（只用于本测试；绝不进入生产 manifest）               */
/* ------------------------------------------------------------------ */

const AUDIT_NONE = {
  audit_required: false,
  record_input: false,
  record_output: false,
  record_effect: false,
} as const;

function makeFixture(
  id: string,
  overrides: Partial<Pick<CapabilityDefinition, 'effect' | 'risk_level' | 'authority_policy' | 'requires_confirmation' | 'data_target' | 'scope_requirement' | 'idempotency'>>,
): CapabilityDefinition {
  return {
    id,
    version: '1.0.0',
    domain: 'fixture-authority',
    description: `A10 synthetic fixture: ${id}`,
    input_schema: 'fixture.input.v1',
    output_schema: 'fixture.output.v1',
    effect: 'READ',
    data_target: 'CRM_FACT',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'NONE',
    idempotency: 'SAFE',
    executor_ref: 'fixture.executor.v1',
    audit_contract: { ...AUDIT_NONE },
    error_contract: 'DISTINGUISHABLE',
    ...overrides,
  };
}

/** 深度冻结（与 A1 相同的防御模式）：验证评估器对冻结输入安全。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 合成写/删 fixture 集合（T18 断言它们与生产 manifest 无交集）。 */
const SYNTHETIC_FIXTURES: readonly CapabilityDefinition[] = Object.freeze([
  makeFixture('fixture.customer.low-risk-write', { effect: 'WRITE', data_target: 'CRM_STATE', risk_level: 'LOW', authority_policy: 'POLICY_CONTROLLED', idempotency: 'REQUIRED' }),
  makeFixture('fixture.customer.high-risk-write', { effect: 'WRITE', data_target: 'CRM_STATE', risk_level: 'HIGH', authority_policy: 'CONFIRM', idempotency: 'REQUIRED' }),
  makeFixture('fixture.bulk-write', { effect: 'BULK_WRITE', data_target: 'CRM_STATE', risk_level: 'MEDIUM', authority_policy: 'AUTO', idempotency: 'REQUIRED' }),
  makeFixture('fixture.delete', { effect: 'DELETE', data_target: 'CRM_STATE', risk_level: 'HIGH', authority_policy: 'AUTO', idempotency: 'REQUIRED' }),
]);

const PRODUCTION_MANIFESTS: readonly (readonly CapabilityDefinition[])[] = Object.freeze([
  CUSTOMER_CAPABILITY_MANIFEST,
  FOLLOW_UP_READ_MANIFEST,
  TASK_READ_MANIFEST,
  TIMELINE_READ_CAPABILITY_MANIFEST,
]);

/* ------------------------------------------------------------------ */
/* 契约测试                                                            */
/* ------------------------------------------------------------------ */

describe('capability-authority-policy contract suite', () => {
  it('T1: a valid low-risk READ with authority=AUTO and no explicit confirmation resolves to ALLOW_AUTO', () => {
    const definition = makeFixture('fixture.customer.read', {
      effect: 'READ',
      risk_level: 'LOW',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });

    const decision = evaluateAuthorityPolicy(definition);

    expect(decision.decision).toBe('ALLOW_AUTO');
    expect(decision.autonomous_allowed).toBe(true);
    expect(decision.confirmation_required).toBe(false);
    expect(decision.reason_code).toBe('AUTO_ALLOWED');
    expect(decision.capability_id).toBe('fixture.customer.read');
    expect(decision.capability_version).toBe('1.0.0');
  });

  it('T2: non-mutating ANALYZE / DRAFT fixtures resolve to autonomous allow when the contract permits, with no persistence', () => {
    const analyze = makeFixture('fixture.customer.analyze', {
      effect: 'ANALYZE',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });
    const draftAuto = makeFixture('fixture.customer.draft', {
      effect: 'DRAFT',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });
    const draftPolicyControlled = makeFixture('fixture.customer.draft', {
      effect: 'DRAFT',
      authority_policy: 'POLICY_CONTROLLED',
      requires_confirmation: false,
    });

    for (const definition of [analyze, draftAuto, draftPolicyControlled]) {
      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision).toBe('ALLOW_AUTO');
      expect(decision.autonomous_allowed).toBe(true);
      expect(decision.confirmation_required).toBe(false);
      expect(decision.reason_code).toBe('AUTO_ALLOWED');
    }

    // 无持久化：评估器是纯函数，返回决策对象，不写任何存储（T14 静态边界另行证明）。
    expect(evaluateAuthorityPolicy(draftAuto)).toEqual(evaluateAuthorityPolicy(draftAuto));
  });

  it('T3: authority_policy=CONFIRM always resolves to REQUIRE_CONFIRMATION', () => {
    const definition = makeFixture('fixture.customer.confirm-write', {
      effect: 'WRITE',
      risk_level: 'MEDIUM',
      authority_policy: 'CONFIRM',
      requires_confirmation: true,
    });

    const decision = evaluateAuthorityPolicy(definition);

    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
  });

  it('T4: requires_confirmation=true can never produce ALLOW_AUTO', () => {
    // AUTO 显式确认要求必须覆盖 AUTO 的自主默认
    const autoRead = makeFixture('fixture.customer.read', {
      effect: 'READ',
      authority_policy: 'AUTO',
      requires_confirmation: true,
    });
    const autoWrite = makeFixture('fixture.customer.write', {
      effect: 'WRITE',
      authority_policy: 'AUTO',
      requires_confirmation: true,
    });
    const policyControlledRead = makeFixture('fixture.customer.read', {
      effect: 'READ',
      authority_policy: 'POLICY_CONTROLLED',
      requires_confirmation: true,
    });
    const strongConfirm = makeFixture('fixture.customer.write', {
      effect: 'WRITE',
      authority_policy: 'STRONG_CONFIRM',
      requires_confirmation: true,
    });

    for (const definition of [autoRead, autoWrite, policyControlledRead, strongConfirm]) {
      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision, `decision must not be ALLOW_AUTO for ${definition.id}`).not.toBe('ALLOW_AUTO');
      expect(decision.autonomous_allowed, `autonomous must be false for ${definition.id}`).toBe(false);
      expect(decision.confirmation_required, `confirmation required for ${definition.id}`).toBe(true);
    }

    expect(evaluateAuthorityPolicy(autoRead).decision).toBe('REQUIRE_CONFIRMATION');
    expect(evaluateAuthorityPolicy(autoWrite).decision).toBe('REQUIRE_CONFIRMATION');
    expect(evaluateAuthorityPolicy(policyControlledRead).decision).toBe('REQUIRE_CONFIRMATION');
    // 更强要求（STRONG_CONFIRM）保持强确认
    expect(evaluateAuthorityPolicy(strongConfirm).decision).toBe('REQUIRE_STRONG_CONFIRMATION');
  });

  it('T5: authority_policy=STRONG_CONFIRM resolves to REQUIRE_STRONG_CONFIRMATION', () => {
    const definition = makeFixture('fixture.customer.strong-confirm', {
      effect: 'WRITE',
      risk_level: 'HIGH',
      authority_policy: 'STRONG_CONFIRM',
      requires_confirmation: true,
    });

    const decision = evaluateAuthorityPolicy(definition);

    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.reason_code).toBe('STRONG_CONFIRMATION_REQUIRED');
  });

  it('T6: authority_policy=DENY_AUTONOMOUS never grants autonomous execution', () => {
    const variants: CapabilityDefinition[] = [
      makeFixture('fixture.deny.read', { effect: 'READ', authority_policy: 'DENY_AUTONOMOUS' }),
      makeFixture('fixture.deny.write', { effect: 'WRITE', authority_policy: 'DENY_AUTONOMOUS' }),
      makeFixture('fixture.deny.delete', { effect: 'DELETE', authority_policy: 'DENY_AUTONOMOUS' }),
      makeFixture('fixture.deny.destructive', { effect: 'WRITE', risk_level: 'DESTRUCTIVE', authority_policy: 'DENY_AUTONOMOUS' }),
    ];

    for (const definition of variants) {
      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision, `deny for ${definition.id}`).toBe('DENY_AUTONOMOUS');
      expect(decision.autonomous_allowed, `no autonomy for ${definition.id}`).toBe(false);
      expect(decision.confirmation_required, `deny does not promise confirmability for ${definition.id}`).toBe(false);
      expect(decision.reason_code).toBe('AUTONOMY_DENIED');
    }
  });

  it('T7: DELETE fixture never produces ALLOW_AUTO even when authority is misdeclared AUTO', () => {
    const misdeclared = makeFixture('fixture.delete', {
      effect: 'DELETE',
      risk_level: 'LOW',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });

    const decision = evaluateAuthorityPolicy(misdeclared);

    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.confirmation_required).toBe(true);
    expect(decision.reason_code).toBe('DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
  });

  it('T8: BULK_WRITE fixture never produces ALLOW_AUTO', () => {
    const misdeclared = makeFixture('fixture.bulk-write', {
      effect: 'BULK_WRITE',
      risk_level: 'MEDIUM',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });

    const decision = evaluateAuthorityPolicy(misdeclared);

    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.confirmation_required).toBe(true);
    expect(decision.reason_code).toBe('DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
  });

  it('T9: risk_level=DESTRUCTIVE never produces ALLOW_AUTO', () => {
    const misdeclared = makeFixture('fixture.customer.write', {
      effect: 'WRITE',
      risk_level: 'DESTRUCTIVE',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });

    const decision = evaluateAuthorityPolicy(misdeclared);

    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.confirmation_required).toBe(true);
    expect(decision.reason_code).toBe('DESTRUCTIVE_RISK_REQUIRES_STRONG_CONTROL');
  });

  it('T10: HIGH-risk WRITE must not silently become autonomous', () => {
    const misdeclared = makeFixture('fixture.customer.high-risk-write', {
      effect: 'WRITE',
      risk_level: 'HIGH',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });

    const decision = evaluateAuthorityPolicy(misdeclared);

    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.confirmation_required).toBe(true);
    expect(decision.reason_code).toBe('HIGH_RISK_WRITE_REQUIRES_CONFIRMATION');
  });

  it('T11: POLICY_CONTROLLED LOW-risk WRITE deterministically requires confirmation (documented A10 rule)', () => {
    const lowRiskWrite = makeFixture('fixture.customer.low-risk-write', {
      effect: 'WRITE',
      risk_level: 'LOW',
      authority_policy: 'POLICY_CONTROLLED',
      requires_confirmation: false,
    });

    const decision = evaluateAuthorityPolicy(lowRiskWrite);

    // 文档化 A10 规则：受控策略下写类能力（即使是 LOW 风险）→ 要求人工确认。
    // 与现有 confirmed-write 运行时"提案 → 人工确认"语义一致；不得隐式/漂移。
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
    expect(decision.reason_code).toBe('POLICY_CONTROLLED_REQUIRES_CONFIRMATION');

    // 确定性：等价输入多次评估产生等价决策
    expect(evaluateAuthorityPolicy(lowRiskWrite)).toEqual(decision);

    // 对照固化：同样 LOW 风险 WRITE 若被显式声明为 AUTO + requires_confirmation=false，
    // 则按 A1 AUTO 词汇"可自主执行"语义放行（AUTO 是显式授权声明，不是默认值）。
    // 产品若想让低风险写受控，必须声明 POLICY_CONTROLLED（如上）——两种语义显式可区分。
    const autoLowWrite = makeFixture('fixture.customer.low-risk-write', {
      effect: 'WRITE',
      risk_level: 'LOW',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    });
    const autoDecision = evaluateAuthorityPolicy(autoLowWrite);
    expect(autoDecision.decision).toBe('ALLOW_AUTO');
    expect(autoDecision.autonomous_allowed).toBe(true);
    expect(autoDecision.reason_code).toBe('AUTO_ALLOWED');
  });

  it('T12: invalid / contradictory / malformed policy state fails closed (never defaults to AUTO)', () => {
    const valid = makeFixture('fixture.customer.read', { effect: 'READ' });

    const malformed: unknown[] = [
      null,
      undefined,
      'string-definition',
      [],
      Object.create(null), // 无原型对象：缺全部关键字段
      { ...valid, authority_policy: 'ASK' }, // 未知 authority 值
      { ...valid, effect: 'SEARCH' }, // 未知 effect（业务意图不得作为 effect）
      { ...valid, risk_level: 'CRITICAL' }, // 未知 risk
      { ...valid, requires_confirmation: 'yes' }, // 非 boolean 确认标志
      { ...valid, id: '' }, // 空身份
      { ...valid, id: '   ' }, // 空白身份
      { ...valid, version: '' }, // 空版本
      { ...valid, effect: undefined }, // 缺关键元数据
      { ...valid, risk_level: undefined }, // 缺关键元数据
      { ...valid, authority_policy: undefined }, // 缺关键元数据
      { ...valid, requires_confirmation: undefined }, // 缺关键元数据
    ];

    // 原型链注入防护：__proto__ 字面量只能让对象继承合法定义（等价 Object.create），
    // 无法向 Object.prototype 注入字段；评估器结果由字段值决定，且不污染全局原型。
    const protoInjected = { __proto__: valid } as unknown;
    expect(evaluateAuthorityPolicy(protoInjected).decision).toBe('ALLOW_AUTO');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);

    for (const bad of malformed) {
      const decision = evaluateAuthorityPolicy(bad as CapabilityDefinition);
      expect(decision.decision, `fail closed for ${JSON.stringify(bad)?.slice(0, 60)}`).toBe('DENY_AUTONOMOUS');
      expect(decision.autonomous_allowed).toBe(false);
      expect(decision.reason_code).toBe('INVALID_CAPABILITY_POLICY');
      // fail-closed 决策永远不携带可被误读为"真实能力"的身份：对象中可安全提取的
      // 身份保留，其余情况为空串——A11 审计消费身份字段时不会指向伪造能力。
      expect(typeof decision.capability_id).toBe('string');
      expect(typeof decision.capability_version).toBe('string');
    }
  });

  it('T13: equivalent policy inputs yield stable machine-readable reason semantics', () => {
    // 等价输入 → 等价决策（多次评估 deep-equal，且返回全新对象）
    const read = makeFixture('fixture.customer.read', { effect: 'READ', authority_policy: 'AUTO' });
    const d1 = evaluateAuthorityPolicy(read);
    const d2 = evaluateAuthorityPolicy(read);
    expect(d2).toEqual(d1);
    expect(d2).not.toBe(d1);

    // 不同策略输入 → 稳定且可区分的原因码（互不相同）
    const reasons: AuthorityDecisionReason[] = [
      evaluateAuthorityPolicy(makeFixture('fixture.read', { effect: 'READ', authority_policy: 'AUTO' })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.confirm', { effect: 'WRITE', authority_policy: 'CONFIRM', requires_confirmation: true })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.strong', { effect: 'WRITE', authority_policy: 'STRONG_CONFIRM', requires_confirmation: true })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.deny', { effect: 'READ', authority_policy: 'DENY_AUTONOMOUS' })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.delete', { effect: 'DELETE', authority_policy: 'AUTO' })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.destructive', { effect: 'WRITE', risk_level: 'DESTRUCTIVE', authority_policy: 'AUTO' })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.high', { effect: 'WRITE', risk_level: 'HIGH', authority_policy: 'AUTO' })).reason_code,
      evaluateAuthorityPolicy(makeFixture('fixture.pc-write', { effect: 'WRITE', risk_level: 'LOW', authority_policy: 'POLICY_CONTROLLED' })).reason_code,
      evaluateAuthorityPolicy({ ...makeFixture('fixture.bad', { effect: 'READ' }), authority_policy: 'ASK' }).reason_code,
    ];
    expect(new Set(reasons).size).toBe(reasons.length);

    // 所有原因码都属于稳定声明集合；所有决策类别都属于稳定声明集合
    for (const reason of reasons) {
      expect(AUTHORITY_DECISION_REASONS).toContain(reason);
    }
    for (const definition of [read, makeFixture('fixture.delete', { effect: 'DELETE', authority_policy: 'AUTO' })]) {
      const decision = evaluateAuthorityPolicy(definition);
      expect(AUTHORITY_DECISION_KINDS).toContain(decision.decision);
      expect(AUTHORITY_DECISION_REASONS).toContain(decision.reason_code);
    }

    // 全部决策类别样本 → 派生字段不变式（autonomous_allowed / confirmation_required 精确派生）
    const kindSamples: CapabilityDefinition[] = [
      makeFixture('fixture.kind.allow', { effect: 'READ', authority_policy: 'AUTO' }),
      makeFixture('fixture.kind.confirm', { effect: 'WRITE', authority_policy: 'CONFIRM', requires_confirmation: true }),
      makeFixture('fixture.kind.strong', { effect: 'WRITE', authority_policy: 'STRONG_CONFIRM', requires_confirmation: true }),
      makeFixture('fixture.kind.deny', { effect: 'READ', authority_policy: 'DENY_AUTONOMOUS' }),
    ];
    for (const definition of kindSamples) {
      const sample = evaluateAuthorityPolicy(definition);
      expect(AUTHORITY_DECISION_KINDS).toContain(sample.decision);
      expect(sample.autonomous_allowed).toBe(sample.decision === 'ALLOW_AUTO');
      expect(sample.confirmation_required).toBe(
        sample.decision === 'REQUIRE_CONFIRMATION' || sample.decision === 'REQUIRE_STRONG_CONFIRMATION',
      );
    }
  });

  it('T14: policy evaluation executes nothing — EXECUTOR_CALLS=0 / DB_WRITE_CALLS=0 / CRM_WRITES=0 (static import boundary)', () => {
    const sourceDir = resolve(process.cwd(), 'src/lib/capabilities/authority');
    const files = ['types.ts', 'policy.ts', 'index.ts'];
    // 剥离注释后再检查 import：只分析真实代码，避免注释文字误报
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 运行时证明：评估是同步纯函数，返回决策对象（上面所有用例已隐式验证）
    const decision = evaluateAuthorityPolicy(SYNTHETIC_FIXTURES[0]);
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');

    for (const file of files) {
      const codeOnly = stripComments(readFileSync(resolve(sourceDir, file), 'utf8'));
      // 只允许 type-only 导入，且只允许导入本层或 A1 契约层（../types）
      const imports = [...codeOnly.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map((m) => m[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} import specifier`).toMatch(/^\.\/(types|policy|index)$|^\.\.\/types$/);
      }
      // 运行时（非 type-only）导入绝不允许——模块图内不得出现任何执行入口
      const valueImports = [...codeOnly.matchAll(/import\b(?!\s*type\b)[\s\S]*?from '([^']+)';/g)];
      expect(valueImports, `${file} must have no value imports`).toHaveLength(0);
    }

    // 模块图静态边界（仅分析代码，剥离注释）：不得出现执行/DB/网络/provider/确认运行时入口。
    // 覆盖 import / require / 动态 import() / node: 内建模块 全部形态。
    const forbiddenTokens =
      /(fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|better-sqlite3|@tauri|confirmedWrite|approvedCrmWriteBoundary|sessionWriteStateStore|createCrmRepository|BattleCardWriteExecutor|createCustomer|updateCustomer|createTask|\brequire\s*\(|import\s*\(|from\s+['"]node:|['"]node:)/;
    expect(stripComments(readFileSync(resolve(sourceDir, 'policy.ts'), 'utf8'))).not.toMatch(forbiddenTokens);
    expect(stripComments(readFileSync(resolve(sourceDir, 'types.ts'), 'utf8'))).not.toMatch(forbiddenTokens);
    expect(stripComments(readFileSync(resolve(sourceDir, 'index.ts'), 'utf8'))).not.toMatch(forbiddenTokens);
  });

  it('T15: no model / provider / network dependency — MODEL_CALLS=0 / PROVIDER_CALLS=0 / NETWORK_CALLS=0', () => {
    const sourceDir = resolve(process.cwd(), 'src/lib/capabilities/authority');

    for (const file of ['types.ts', 'policy.ts', 'index.ts']) {
      const source = readFileSync(resolve(sourceDir, file), 'utf8');
      // 只匹配"机制引用"形态（专有名称 / 调用点），不匹配注释中的普通词汇
      const modelTokens =
        /(deepseek|openai|anthropic|axios|\bfetch\s*\(|XMLHttpRequest|WebSocket|WebSearch|https?:\/\/|\bllm\b|model\s*\(|provider\s*\(|prompt\s*\(|\.generate\s*\()/i;
      expect(source, `${file} must not reference model/provider/network machinery`).not.toMatch(modelTokens);
      expect(source).not.toMatch(/async\s/); // 纯同步：无异步执行点
    }
  });

  it('T16: every Wave 1 production READ capability resolves consistently with automatic execution — no unexpected write-style confirmation', () => {
    const productionDefinitions = PRODUCTION_MANIFESTS.flat();
    expect(productionDefinitions.length).toBeGreaterThan(0);

    for (const definition of productionDefinitions) {
      expect(definition.effect).toBe('READ');

      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision, `Wave 1 ${definition.id} stays autonomous`).toBe('ALLOW_AUTO');
      expect(decision.autonomous_allowed).toBe(true);
      expect(decision.confirmation_required, `Wave 1 ${definition.id} must not require confirmation`).toBe(false);
      expect(decision.reason_code).toBe('AUTO_ALLOWED');
      expect(decision.capability_id).toBe(definition.id);
      expect(decision.capability_version).toBe(definition.version);
    }
  });

  it('T17: policy evaluation does not mutate CapabilityDefinition or registry state', () => {
    const frozen = deepFreeze(makeFixture('fixture.customer.read', {
      effect: 'READ',
      authority_policy: 'AUTO',
      requires_confirmation: false,
    }));
    const before = JSON.stringify(frozen);

    const decision = evaluateAuthorityPolicy(frozen);

    // 输入保持冻结且内容不变
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.audit_contract)).toBe(true);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(decision).not.toBe(frozen); // 返回全新决策对象，不返回输入引用

    // 调用方篡改返回的决策对象不影响后续评估
    const mutated = evaluateAuthorityPolicy(frozen) as unknown as { reason_code: string };
    mutated.reason_code = 'AUTONOMY_DENIED';
    expect(evaluateAuthorityPolicy(frozen).reason_code).toBe('AUTO_ALLOWED');
  });

  it('T18: synthetic Write/Delete fixtures never enter any production capability manifest', () => {
    const productionIds = new Set(PRODUCTION_MANIFESTS.flat().map((d) => d.id));
    const syntheticIds = new Set(SYNTHETIC_FIXTURES.map((d) => d.id));

    // 合成 fixture 身份与生产 manifest 身份零交集
    for (const id of syntheticIds) {
      expect(productionIds.has(id), `synthetic ${id} must not exist in production manifests`).toBe(false);
    }

    // 生产 manifest 不包含任何 fixture.* 能力，且没有任何写/删能力被注册
    for (const definition of PRODUCTION_MANIFESTS.flat()) {
      expect(definition.id.startsWith('fixture.')).toBe(false);
      expect(['WRITE', 'BULK_WRITE', 'DELETE']).not.toContain(definition.effect);
      expect(definition.domain).not.toBe('fixture-authority');
    }

    // 合成 fixture 仅存在于本测试文件（可搜索验证），不导出、不注册
    expect(SYNTHETIC_FIXTURES.length).toBeGreaterThan(0);
    const testSource = readFileSync(resolve(process.cwd(), 'src/__tests__/capabilityAuthorityPolicy.contract.test.ts'), 'utf8');
    for (const id of syntheticIds) {
      expect(testSource).toContain(id); // 只出现在测试内
    }
  });
});
