/**
 * V0.2A / A1 — Capability Registry Contract 聚焦测试。
 *
 * 覆盖规格 T1–T9：
 *   T1 有效定义   T2 必填/无效定义 fail closed   T3 重复拒绝
 *   T4 确定性查找 T5 跨领域组合                   T6 零执行（静态 import 边界）
 *   T7 变异安全   T8 稳定身份（id + version）     T9 可区分错误语义
 *
 * 仅使用合成 fixture（fixture-domain-a / fixture-domain-b），不注册任何真实 CRM 能力。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CapabilityNotFoundError,
  CapabilityRegistryError,
  createCapabilityRegistry,
  DuplicateCapabilityError,
  identityKey,
  InvalidCapabilityDefinitionError,
  type CapabilityAuthorityPolicy,
  type CapabilityDataTarget,
  type CapabilityDefinition,
  type CapabilityEffect,
  type CapabilityIdempotency,
  type CapabilityRiskLevel,
} from '../lib/capabilities';

const AUDIT_FULL = {
  audit_required: true,
  record_input: true,
  record_output: true,
  record_effect: true,
} as const;

/** fixture-domain-a：读 + 写（客户事实/客户状态），证明域 manifest 独立可组合。 */
const fixtureDomainAManifest: readonly CapabilityDefinition[] = [
  {
    id: 'fixture.customer.read',
    version: '1.0.0',
    domain: 'fixture-domain-a',
    description: 'Fixture A: read customer facts.',
    input_schema: 'fixture.customer.query.v1',
    output_schema: 'fixture.customer.result.v1',
    effect: 'READ',
    data_target: 'CRM_FACT',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'CUSTOMER',
    idempotency: 'SAFE',
    executor_ref: 'fixture.executor.read.v1',
    audit_contract: { ...AUDIT_FULL },
    error_contract: 'DISTINGUISHABLE',
  },
  {
    id: 'fixture.customer.write',
    version: '1.0.0',
    domain: 'fixture-domain-a',
    description: 'Fixture A: write customer state.',
    input_schema: 'fixture.customer.update.v1',
    output_schema: 'fixture.customer.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'MEDIUM',
    authority_policy: 'CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'REQUIRED',
    executor_ref: 'fixture.executor.write.v1',
    audit_contract: { ...AUDIT_FULL },
    error_contract: 'DISTINGUISHABLE',
  },
];

/** fixture-domain-b：任务写 + 证据记录（EVIDENCE 目标与 CRM_STATE 区分）。 */
const fixtureDomainBManifest: readonly CapabilityDefinition[] = [
  {
    id: 'fixture.task.write',
    version: '1.0.0',
    domain: 'fixture-domain-b',
    description: 'Fixture B: write task state.',
    input_schema: 'fixture.task.update.v1',
    output_schema: 'fixture.task.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'HIGH',
    authority_policy: 'STRONG_CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'REQUIRED',
    executor_ref: 'fixture.executor.write.v1',
    audit_contract: { ...AUDIT_FULL },
    error_contract: 'DISTINGUISHABLE',
  },
  {
    id: 'fixture.evidence.record',
    version: '1.0.0',
    domain: 'fixture-domain-b',
    description: 'Fixture B: record external evidence (not CRM fact).',
    input_schema: 'fixture.evidence.record.v1',
    output_schema: 'fixture.evidence.result.v1',
    effect: 'WRITE',
    data_target: 'EVIDENCE',
    risk_level: 'MEDIUM',
    authority_policy: 'POLICY_CONTROLLED',
    requires_confirmation: false,
    scope_requirement: 'NONE',
    idempotency: 'REQUIRED',
    executor_ref: 'fixture.executor.evidence.v1',
    audit_contract: { ...AUDIT_FULL },
    error_contract: 'DISTINGUISHABLE',
  },
];

function makeMutationFixture(): CapabilityDefinition {
  return {
    id: 'fixture.mutate.read',
    version: '1.0.0',
    domain: 'fixture-domain-a',
    description: 'original',
    input_schema: 'fixture.mutate.query.v1',
    output_schema: 'fixture.mutate.result.v1',
    effect: 'READ',
    data_target: 'CRM_FACT',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'NONE',
    idempotency: 'SAFE',
    executor_ref: 'fixture.executor.read.v1',
    audit_contract: { ...AUDIT_FULL },
    error_contract: 'DISTINGUISHABLE',
  };
}

describe('capability-registry contract suite', () => {
  it('T1: a valid CapabilityDefinition is accepted and stored', () => {
    const registry = createCapabilityRegistry();
    const stored = registry.register(fixtureDomainAManifest[0]);

    expect(stored).toBe(registry.get('fixture.customer.read', '1.0.0'));
    expect(stored.effect).toBe('READ');
    expect(stored.data_target).toBe('CRM_FACT');
    expect(stored.risk_level).toBe('LOW');
    expect(stored.authority_policy).toBe('AUTO');
    expect(stored.requires_confirmation).toBe(false);
    expect(stored.scope_requirement).toBe('CUSTOMER');
    expect(stored.idempotency).toBe('SAFE');
    expect(stored.executor_ref).toBe('fixture.executor.read.v1');
    expect(stored.audit_contract).toEqual(AUDIT_FULL);
    expect(stored.error_contract).toBe('DISTINGUISHABLE');
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.audit_contract)).toBe(true);
  });

  it('T2: invalid or incomplete definitions fail closed without silent defaults', () => {
    const registry = createCapabilityRegistry();
    const valid = fixtureDomainAManifest[0];

    const criticalFields = [
      'id', 'version', 'domain', 'description',
      'input_schema', 'output_schema',
      'effect', 'data_target', 'risk_level', 'authority_policy',
      'requires_confirmation', 'scope_requirement', 'idempotency',
      'executor_ref', 'audit_contract', 'error_contract',
    ] as const;
    for (const field of criticalFields) {
      const broken = { ...valid, [field]: undefined } as unknown as CapabilityDefinition;
      expect(() => registry.register(broken), `missing field ${field}`).toThrow(InvalidCapabilityDefinitionError);
    }

    expect(() => registry.register({ ...valid, effect: 'SEARCH' as CapabilityEffect })).toThrow(InvalidCapabilityDefinitionError);
    expect(() => registry.register({ ...valid, data_target: 'WEB' as CapabilityDataTarget })).toThrow(InvalidCapabilityDefinitionError);
    expect(() => registry.register({ ...valid, risk_level: 'CRITICAL' as CapabilityRiskLevel })).toThrow(InvalidCapabilityDefinitionError);
    expect(() => registry.register({ ...valid, authority_policy: 'ASK' as CapabilityAuthorityPolicy })).toThrow(InvalidCapabilityDefinitionError);
    expect(() => registry.register({ ...valid, idempotency: 'ALWAYS' as CapabilityIdempotency })).toThrow(InvalidCapabilityDefinitionError);

    expect(() => registry.register({ ...valid, id: '' } as CapabilityDefinition)).toThrow(InvalidCapabilityDefinitionError);
    expect(() => registry.register({ ...valid, description: '   ' } as CapabilityDefinition)).toThrow(InvalidCapabilityDefinitionError);
    expect(() => registry.register({
      ...valid,
      audit_contract: { ...valid.audit_contract, audit_required: 'yes' as unknown as boolean },
    } as CapabilityDefinition)).toThrow(InvalidCapabilityDefinitionError);

    expect(registry.size()).toBe(0);
  });

  it('T3: duplicate capability identity rejects without silent overwrite', () => {
    const registry = createCapabilityRegistry(fixtureDomainAManifest);

    expect(() => registry.register({ ...fixtureDomainAManifest[0] })).toThrow(DuplicateCapabilityError);
    expect(registry.size()).toBe(2);
    expect(registry.get('fixture.customer.read', '1.0.0').description).toBe(fixtureDomainAManifest[0].description);
  });

  it('T4: lookup is deterministic for get / list / listByDomain', () => {
    const registry = createCapabilityRegistry(fixtureDomainAManifest, fixtureDomainBManifest);

    expect(registry.get('fixture.customer.read', '1.0.0')).toBe(registry.get('fixture.customer.read', '1.0.0'));

    expect(registry.list().map((d) => d.id)).toEqual([
      'fixture.customer.read',
      'fixture.customer.write',
      'fixture.task.write',
      'fixture.evidence.record',
    ]);

    expect(registry.listByDomain('fixture-domain-a').map((d) => d.id)).toEqual([
      'fixture.customer.read',
      'fixture.customer.write',
    ]);
    expect(registry.listByDomain('fixture-domain-b').map((d) => d.id)).toEqual([
      'fixture.task.write',
      'fixture.evidence.record',
    ]);
    expect(registry.listByDomain('fixture-domain-unknown')).toEqual([]);
  });

  it('T5: independent domain manifests compose into one registry without central routing', () => {
    const registry = createCapabilityRegistry(fixtureDomainAManifest, fixtureDomainBManifest);

    expect(registry.size()).toBe(4);
    expect(registry.get('fixture.customer.read', '1.0.0').domain).toBe('fixture-domain-a');
    expect(registry.get('fixture.task.write', '1.0.0').domain).toBe('fixture-domain-b');
    expect(registry.get('fixture.evidence.record', '1.0.0').data_target).toBe('EVIDENCE');
    expect(registry.get('fixture.task.write', '1.0.0').data_target).toBe('CRM_STATE');
  });

  it('T6: registry construction and lookup involve zero DB/network/provider/executor calls (static import boundary)', () => {
    const registry = createCapabilityRegistry(fixtureDomainAManifest, fixtureDomainBManifest);
    expect(registry.size()).toBe(4);
    expect(registry.get('fixture.task.write', '1.0.0').effect).toBe('WRITE');

    const registrySource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/registry.ts'), 'utf8');
    const typesSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/types.ts'), 'utf8');
    const indexSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/index.ts'), 'utf8');

    // registry.ts 唯一 import 是 type-only './types'；types.ts 无 import；index.ts 只 re-export 本层。
    const registryImports = [...registrySource.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map((m) => m[1]);
    expect(registryImports).toEqual(['./types']);
    expect(typesSource).not.toMatch(/^import\b/m);
    expect(indexSource).not.toMatch(/from '\.\.\//);

    // DB_CALLS=0 / NETWORK_CALLS=0 / PROVIDER_CALLS=0 / EXECUTOR_CALLS=0 由上述 import 边界保证：
    // 模块图中不存在任何 db / 网络 / provider / 执行器入口。
    const forbiddenTokens = /(fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|sqlite|better-sqlite3|@tauri|from ['"]\.\.\/)/;
    expect(registrySource).not.toMatch(forbiddenTokens);
    expect(typesSource).not.toMatch(forbiddenTokens);

    // 无中央领域 switch：组合由 manifest 数组驱动。
    expect(registrySource).not.toMatch(/\bswitch\s*\(/);
  });

  it('T7: caller mutation cannot alter registry authoritative state', () => {
    const manifest: CapabilityDefinition[] = [makeMutationFixture()];
    const registry = createCapabilityRegistry(manifest);

    // 1. 修改原始 manifest 对象（含嵌套 audit_contract）→ registry 不受影响
    (manifest[0] as { description: string }).description = 'mutated-after-register';
    (manifest[0].audit_contract as { audit_required: boolean }).audit_required = false;
    expect(registry.get('fixture.mutate.read', '1.0.0').description).toBe('original');
    expect(registry.get('fixture.mutate.read', '1.0.0').audit_contract.audit_required).toBe(true);

    // 2. 修改返回的 definition → 深度冻结，strict mode 抛 TypeError
    const stored = registry.get('fixture.mutate.read', '1.0.0');
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.audit_contract)).toBe(true);
    expect(() => {
      (stored as { description: string }).description = 'mutated-stored';
    }).toThrow(TypeError);

    // 3. 修改返回的 list 数组（push/splice/元素改写）→ registry 不受影响
    const listed = registry.list();
    (listed as CapabilityDefinition[]).push(fixtureDomainBManifest[0]);
    (listed as CapabilityDefinition[]).splice(0, 1);
    expect(registry.size()).toBe(1);
    expect(registry.list()).toHaveLength(1);
    expect(() => {
      (registry.list()[0] as { description: string }).description = 'mutated-list-element';
    }).toThrow(TypeError);
  });

  it('T7b: getter/Proxy definitions cannot smuggle unvalidated values into registry state', () => {
    const base = makeMutationFixture();
    let effectReads = 0;
    // 恶意 getter：第一次读取返回合法值，后续读取返回危险值（模拟 TOCTOU 绕过）。
    const sneaky = new Proxy(base, {
      get(target, prop) {
        if (prop === 'effect') {
          effectReads += 1;
          return effectReads === 1 ? 'READ' : 'DELETE';
        }
        return Reflect.get(target, prop);
      },
    });

    const registry = createCapabilityRegistry([sneaky as CapabilityDefinition]);

    // clone-first：校验与存储共用首次读取的纯数据副本，危险值永不进入 registry。
    expect(registry.get('fixture.mutate.read', '1.0.0').effect).toBe('READ');
    expect(registry.get('fixture.mutate.read', '1.0.0').effect).toBe('READ');
    expect(registry.size()).toBe(1);

    // 错误消息不反射原始输入：控制字符/引号被 JSON 转义（拒绝日志注入）。
    let notFound: CapabilityRegistryError | undefined;
    try {
      registry.get('bad\u0000id', '1.0.0');
    } catch (error) {
      notFound = error as CapabilityRegistryError;
    }
    expect(notFound).toBeInstanceOf(CapabilityNotFoundError);
    expect(notFound?.message).not.toContain('\u0000');
    expect(notFound?.message).toContain('"bad\\u0000id"');

    // audit_contract 只保留契约字段：caller 携带的额外键（含深嵌套对象）被丢弃，
    // 无法经 audit_contract 进入 deepFreeze 递归。
    const withExtraKeys = makeMutationFixture();
    (withExtraKeys.audit_contract as { extra?: unknown }).extra = { nested: { deep: { object: true } } };
    const strictRegistry = createCapabilityRegistry([withExtraKeys]);
    const storedAudit = strictRegistry.get('fixture.mutate.read', '1.0.0').audit_contract;
    expect(storedAudit).not.toHaveProperty('extra');
    expect(Object.keys(storedAudit).sort()).toEqual(['audit_required', 'record_effect', 'record_input', 'record_output']);
  });

  it('T8: stable identity is deterministic and bound to id + version', () => {
    const registry = createCapabilityRegistry([fixtureDomainAManifest[0]]);

    // 同一身份 → 同一对象（确定性）
    expect(registry.get('fixture.customer.read', '1.0.0')).toBe(registry.get('fixture.customer.read', '1.0.0'));

    // 相同 id + version、不同描述文本 → 视为重复，拒绝
    const renamed = { ...fixtureDomainAManifest[0], description: 'renamed display text' };
    expect(() => registry.register(renamed)).toThrow(DuplicateCapabilityError);

    // 相同 id、不同 version → 不同能力
    registry.register({ ...fixtureDomainAManifest[0], version: '2.0.0' });
    expect(registry.size()).toBe(2);
    expect(registry.get('fixture.customer.read', '2.0.0').version).toBe('2.0.0');
    expect(registry.get('fixture.customer.read', '2.0.0')).not.toBe(registry.get('fixture.customer.read', '1.0.0'));

    // 身份键确定性
    expect(identityKey('x', '1.0.0')).toBe(identityKey('x', '1.0.0'));
    expect(identityKey('x', '1.0.0')).not.toBe(identityKey('x', '2.0.0'));
  });

  it('T9: registry failure semantics are distinguishable', () => {
    const registry = createCapabilityRegistry(fixtureDomainAManifest);

    let invalid: CapabilityRegistryError | undefined;
    let duplicate: CapabilityRegistryError | undefined;
    let missing: CapabilityRegistryError | undefined;

    try {
      registry.register({ ...fixtureDomainAManifest[0], effect: 'SEARCH' as CapabilityEffect });
    } catch (error) {
      invalid = error as CapabilityRegistryError;
    }
    try {
      registry.register({ ...fixtureDomainAManifest[0] });
    } catch (error) {
      duplicate = error as CapabilityRegistryError;
    }
    try {
      registry.get('fixture.not.registered', '9.9.9');
    } catch (error) {
      missing = error as CapabilityRegistryError;
    }

    expect(invalid).toBeInstanceOf(InvalidCapabilityDefinitionError);
    expect(duplicate).toBeInstanceOf(DuplicateCapabilityError);
    expect(missing).toBeInstanceOf(CapabilityNotFoundError);
    expect(invalid).toBeInstanceOf(CapabilityRegistryError);
    expect(duplicate).toBeInstanceOf(CapabilityRegistryError);
    expect(missing).toBeInstanceOf(CapabilityRegistryError);

    const codes = [invalid?.code, duplicate?.code, missing?.code];
    expect(codes).toEqual(['INVALID_CAPABILITY_DEFINITION', 'DUPLICATE_CAPABILITY', 'CAPABILITY_NOT_FOUND']);
    expect(new Set(codes).size).toBe(3);
  });
});
