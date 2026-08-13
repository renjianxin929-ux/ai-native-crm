/**
 * V0.2A / A1 — Capability Registry.
 *
 * 纯内存注册表：只做"注册 / 查询 / 组合"，不执行任何能力。
 * 依赖边界：本模块唯一允许的 import 是 type-only 的 './types'。
 * 不得引入 db / provider / executor / network 语义。
 */

import type {
  CapabilityDefinition,
  CapabilityDomain,
  CapabilityId,
  CapabilityIdentity,
  CapabilityVersion,
} from './types';

/**
 * Registry 错误码（稳定、可区分；拒绝用单一泛化 Error 覆盖全部注册表失败）。
 */
export type CapabilityRegistryErrorCode =
  | 'INVALID_CAPABILITY_DEFINITION'
  | 'DUPLICATE_CAPABILITY'
  | 'CAPABILITY_NOT_FOUND';

/** Registry 层错误基类：携带稳定 code。 */
export class CapabilityRegistryError extends Error {
  readonly code: CapabilityRegistryErrorCode;

  constructor(code: CapabilityRegistryErrorCode, message: string) {
    super(message);
    this.name = 'CapabilityRegistryError';
    this.code = code;
  }
}

/** 无效/不完整的能力定义。 */
export class InvalidCapabilityDefinitionError extends CapabilityRegistryError {
  constructor(message: string) {
    super('INVALID_CAPABILITY_DEFINITION', message);
    this.name = 'InvalidCapabilityDefinitionError';
  }
}

/** 重复能力身份（id + version），拒绝静默覆盖。 */
export class DuplicateCapabilityError extends CapabilityRegistryError {
  constructor(identity: CapabilityIdentity) {
    // JSON.stringify 转义控制字符/引号：拒绝通过错误消息进行日志注入。
    super('DUPLICATE_CAPABILITY', `Capability already registered: ${JSON.stringify(identity.id)}@${JSON.stringify(identity.version)}`);
    this.name = 'DuplicateCapabilityError';
  }
}

/** 按身份查找失败。 */
export class CapabilityNotFoundError extends CapabilityRegistryError {
  constructor(id: CapabilityId, version: CapabilityVersion) {
    // JSON.stringify 转义控制字符/引号：拒绝通过错误消息进行日志注入。
    super('CAPABILITY_NOT_FOUND', `Capability not found: ${JSON.stringify(id)}@${JSON.stringify(version)}`);
    this.name = 'CapabilityNotFoundError';
  }
}

const EFFECTS = ['READ', 'ANALYZE', 'DRAFT', 'WRITE', 'BULK_WRITE', 'DELETE'] as const;
const DATA_TARGETS = ['NONE', 'CRM_FACT', 'CRM_STATE', 'EVIDENCE'] as const;
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'DESTRUCTIVE'] as const;
const AUTHORITY_POLICIES = ['AUTO', 'POLICY_CONTROLLED', 'CONFIRM', 'STRONG_CONFIRM', 'DENY_AUTONOMOUS'] as const;
const SCOPE_REQUIREMENTS = ['NONE', 'CUSTOMER', 'GLOBAL'] as const;
const IDEMPOTENCIES = ['NONE', 'SAFE', 'REQUIRED'] as const;
const ERROR_CONTRACTS = ['UNSPECIFIED', 'DISTINGUISHABLE'] as const;
const AUDIT_FIELDS = ['audit_required', 'record_input', 'record_output', 'record_effect'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * 校验能力定义。关键语义字段（effect / data_target / risk_level / authority_policy /
 * requires_confirmation / scope_requirement / idempotency / audit_contract）必须显式声明，
 * 任何缺失或非法值都 fail closed（抛 InvalidCapabilityDefinitionError），禁止静默默认。
 */
export function validateCapabilityDefinition(value: unknown): asserts value is CapabilityDefinition {
  if (!isRecord(value)) {
    throw new InvalidCapabilityDefinitionError('Capability definition must be an object.');
  }

  const stringFields = ['id', 'version', 'domain', 'description', 'input_schema', 'output_schema', 'executor_ref'] as const;
  for (const field of stringFields) {
    if (!isNonEmptyString(value[field])) {
      throw new InvalidCapabilityDefinitionError(`Capability definition field '${field}' must be a non-empty string.`);
    }
  }

  if (!isOneOf(value.effect, EFFECTS)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'effect' must be one of READ|ANALYZE|DRAFT|WRITE|BULK_WRITE|DELETE.");
  }
  if (!isOneOf(value.data_target, DATA_TARGETS)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'data_target' must be one of NONE|CRM_FACT|CRM_STATE|EVIDENCE.");
  }
  if (!isOneOf(value.risk_level, RISK_LEVELS)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'risk_level' must be one of LOW|MEDIUM|HIGH|DESTRUCTIVE.");
  }
  if (!isOneOf(value.authority_policy, AUTHORITY_POLICIES)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'authority_policy' must be one of AUTO|POLICY_CONTROLLED|CONFIRM|STRONG_CONFIRM|DENY_AUTONOMOUS.");
  }
  if (!isOneOf(value.scope_requirement, SCOPE_REQUIREMENTS)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'scope_requirement' must be one of NONE|CUSTOMER|GLOBAL.");
  }
  if (!isOneOf(value.idempotency, IDEMPOTENCIES)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'idempotency' must be one of NONE|SAFE|REQUIRED.");
  }
  if (!isOneOf(value.error_contract, ERROR_CONTRACTS)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'error_contract' must be one of UNSPECIFIED|DISTINGUISHABLE.");
  }
  if (typeof value.requires_confirmation !== 'boolean') {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'requires_confirmation' must be a boolean.");
  }

  const audit = value.audit_contract;
  if (!isRecord(audit)) {
    throw new InvalidCapabilityDefinitionError("Capability definition field 'audit_contract' must be an object.");
  }
  for (const field of AUDIT_FIELDS) {
    if (typeof audit[field] !== 'boolean') {
      throw new InvalidCapabilityDefinitionError(`Capability definition audit_contract field '${field}' must be a boolean.`);
    }
  }
}

/** 稳定身份键：id + version（确定性；不依赖描述/展示文本）。 */
export function identityKey(id: CapabilityId, version: CapabilityVersion): string {
  return JSON.stringify([id, version]);
}

/** 从定义提取稳定身份。 */
export function identityOf(definition: CapabilityDefinition): CapabilityIdentity {
  return { id: definition.id, version: definition.version };
}

/**
 * 构建纯数据副本：逐字段一次性读取，caller 持有的 getter/Proxy 只会被读取一次。
 * 校验与存储共用此副本，杜绝 TOCTOU（校验读 'READ'、存储读 'DELETE' 的绕过）。
 */
function cloneDefinition(definition: CapabilityDefinition): CapabilityDefinition {
  return {
    id: definition.id,
    version: definition.version,
    domain: definition.domain,
    description: definition.description,
    input_schema: definition.input_schema,
    output_schema: definition.output_schema,
    effect: definition.effect,
    data_target: definition.data_target,
    risk_level: definition.risk_level,
    authority_policy: definition.authority_policy,
    requires_confirmation: definition.requires_confirmation,
    scope_requirement: definition.scope_requirement,
    idempotency: definition.idempotency,
    executor_ref: definition.executor_ref,
    // 只拷贝契约字段：丢弃 caller 携带的任何额外键（防止深嵌套对象经
    // audit_contract 进入 deepFreeze 递归；非对象时保留原值让校验 fail-closed）。
    audit_contract:
      typeof definition.audit_contract === 'object' && definition.audit_contract !== null
        ? {
            audit_required: definition.audit_contract.audit_required,
            record_input: definition.audit_contract.record_input,
            record_output: definition.audit_contract.record_output,
            record_effect: definition.audit_contract.record_effect,
          }
        : (definition.audit_contract as CapabilityDefinition['audit_contract']),
    error_contract: definition.error_contract,
  };
}

/** 深度冻结（规范化副本后嵌套深度受控：definition + audit_contract 两层）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export interface CapabilityRegistry {
  /** 注册一个能力定义；重复身份（id + version）抛 DuplicateCapabilityError。返回冻结的已注册定义。 */
  readonly register: (definition: CapabilityDefinition) => CapabilityDefinition;
  /** 按身份（id + version）确定性查询；未找到抛 CapabilityNotFoundError。 */
  readonly get: (id: CapabilityId, version: CapabilityVersion) => CapabilityDefinition;
  /** 列出全部已注册能力（按注册顺序；返回新数组，caller 无法改写 registry 状态）。 */
  readonly list: () => readonly CapabilityDefinition[];
  /** 按领域列出（按注册顺序；返回新数组）。 */
  readonly listByDomain: (domain: CapabilityDomain) => readonly CapabilityDefinition[];
  /** 当前已注册能力数量。 */
  readonly size: () => number;
}

/**
 * 创建能力注册表。
 *
 * 组合设计（关键）：接受多个独立 domain manifest（每个 manifest 是只读定义数组），
 * 全部注册进同一注册表。未来各领域分支（customer / timeline / follow-up / task /
 * battle-card / evidence ...）各自提供 manifest 并在入口组合，无需修改中央
 * switch 或巨型中央数组。本模块不含任何业务领域路由逻辑。
 */
export function createCapabilityRegistry(
  ...manifests: readonly (readonly CapabilityDefinition[])[]
): CapabilityRegistry {
  const entries = new Map<string, CapabilityDefinition>();

  const register = (definition: CapabilityDefinition): CapabilityDefinition => {
    // clone-first：先一次性读取为纯数据副本，再对副本校验与存储。
    // 校验与存储必须基于同一份数据，避免 getter/Proxy 二次读取绕过（TOCTOU）。
    const copy = cloneDefinition(definition);
    validateCapabilityDefinition(copy);
    const key = identityKey(copy.id, copy.version);
    if (entries.has(key)) {
      throw new DuplicateCapabilityError(identityOf(copy));
    }
    const stored = deepFreeze(copy);
    entries.set(key, stored);
    return stored;
  };

  for (const manifest of manifests) {
    for (const definition of manifest) {
      register(definition);
    }
  }

  return {
    register,
    get: (id, version) => {
      const entry = entries.get(identityKey(id, version));
      if (entry === undefined) {
        throw new CapabilityNotFoundError(id, version);
      }
      return entry;
    },
    list: () => [...entries.values()],
    listByDomain: (domain) => [...entries.values()].filter((entry) => entry.domain === domain),
    size: () => entries.size,
  };
}
