/**
 * V0.2C / C1.11 — Planner input schema (derived from existing production truth).
 *
 * 唯一目的：给 planner/模型提供"选择能力 + 抽取参数"所需的最小安全字段信息。
 * 除 allowed_fields / required_fields 之外，现在为每个业务字段暴露其
 * 生产有界约束（type / required / nullable / enum_values / format / 数值约束），
 * 让模型在抽取参数时就能产出生产合法值（例如 visit.create.next_action 的
 * 闭合枚举），而不是产出自由文本后被 Layer-1 拒绝。
 *
 * 绝不创建第二份可执行 schema，绝不复制业务校验：业务校验仍由绑定层 Layer-1
 * （writeAdapters.validateInput）与 confirmedWrite.allowedFields 权威执行。
 * 本 schema 只是给模型的选择/抽取指导（PLANNER_SCHEMA_BYPASSES_LAYER1=false）。
 *
 * 枚举/格式来源（PRODUCTION_CONSTRAINT_IS_SOURCE_OF_TRUTH=true）：
 *   - writeAdapters 导出的运行时闭合枚举常量（CONTACT_METHODS /
 *     WECHAT_SEARCH_STATUSES / WECHAT_ADD_STATUSES / INTENT_LEVELS /
 *     PHONE_FEEDBACKS / CUSTOMER_STAGES / HYPOTHESIS_STATUSES）；
 *   - visitCreate 导出的 VISIT_OUTCOMES / VISIT_NEXT_ACTIONS。
 * 以上都是产品运行时代码中已存在的唯一真源，本模块只引用、绝不复刻第二份枚举表
 * （SECOND_ENUM_REGISTRY_CREATED=false）。
 *
 * 绝不暴露：db / clock 执行句柄、customer_id/customerId 选择器、executor_ref、
 * 密钥、SQL、隐藏运行时句柄、系统只读字段。
 */

import {
  CONTACT_METHODS,
  CUSTOMER_STAGES,
  HYPOTHESIS_STATUSES,
  INTENT_LEVELS,
  PHONE_FEEDBACKS,
  WECHAT_ADD_STATUSES,
  WECHAT_SEARCH_STATUSES,
} from '../capabilities/execution/writeAdapters';
import { VISIT_NEXT_ACTIONS, VISIT_OUTCOMES } from '../visitCreate';

/** planner 面向的字段类型（最小集合；不暴露任何 DB/执行内部结构）。 */
export type PlannerFieldType =
  | 'string'
  | 'enum'
  | 'boolean'
  | 'number'
  | 'string_array'
  | 'object'
  | 'array';

/** planner 面向的单字段描述（只暴露安全元数据；绝不含实现细节）。 */
export interface PlannerFieldDescriptor {
  readonly name: string;
  /** 是否必填（模型漏填 → planner 转澄清，绝不把缺参当执行）。 */
  readonly required: boolean;
  readonly type: PlannerFieldType;
  /** 是否可为 null（清除为 unknown/空值；与产品 `value || null` 语义一致）。 */
  readonly nullable?: boolean;
  /** type=enum 时的闭合允许值（来自生产运行时常量，唯一真源）。 */
  readonly enum_values?: readonly string[];
  /** type=boolean 时产品的数值表示（SQLite 布尔 = 0|1 整数）。 */
  readonly boolean_values?: readonly number[];
  /** type=number 时的值约束描述（如 'positive'、'finite'）。 */
  readonly numeric_constraint?: string;
  /** 有界格式（如 'YYYY-MM-DD'，来自人工表单 `<input type="date">`）。 */
  readonly format?: string;
}

export interface PlannerInputSchema {
  readonly allowed_fields: readonly string[];
  readonly required_fields: readonly string[];
  /** 逐字段约束（type/enum/format），供模型选择与抽取；仅指导，非权威校验。 */
  readonly fields: Readonly<Record<string, PlannerFieldDescriptor>>;
}

interface FieldOptions {
  readonly required?: boolean;
  readonly nullable?: boolean;
  readonly enum_values?: readonly string[];
  readonly boolean_values?: readonly number[];
  readonly numeric_constraint?: string;
  readonly format?: string;
}

function field(name: string, type: PlannerFieldType, options: FieldOptions = {}): PlannerFieldDescriptor {
  return {
    name,
    type,
    required: options.required === true,
    ...(options.nullable !== undefined ? { nullable: options.nullable } : {}),
    ...(options.enum_values !== undefined ? { enum_values: options.enum_values } : {}),
    ...(options.boolean_values !== undefined ? { boolean_values: options.boolean_values } : {}),
    ...(options.numeric_constraint !== undefined ? { numeric_constraint: options.numeric_constraint } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
  };
}

const stringField = (name: string, options: FieldOptions = {}): PlannerFieldDescriptor => field(name, 'string', options);
const enumField = (name: string, values: readonly string[], options: FieldOptions = {}): PlannerFieldDescriptor =>
  field(name, 'enum', { ...options, enum_values: values });
const numberField = (name: string, options: FieldOptions = {}): PlannerFieldDescriptor => field(name, 'number', options);
const booleanField = (name: string, options: FieldOptions = {}): PlannerFieldDescriptor =>
  field(name, 'boolean', { ...options, boolean_values: [0, 1] });
const stringArrayField = (name: string, options: FieldOptions = {}): PlannerFieldDescriptor => field(name, 'string_array', options);
const objectField = (name: string, options: FieldOptions = {}): PlannerFieldDescriptor => field(name, 'object', options);
const arrayField = (name: string, options: FieldOptions = {}): PlannerFieldDescriptor => field(name, 'array', options);

/** 从字段描述列表构造 schema：allowed/required 由描述单一派生（无第二真源）。 */
function defineSchema(fields: readonly PlannerFieldDescriptor[]): PlannerInputSchema {
  const fieldMap: Record<string, PlannerFieldDescriptor> = {};
  for (const descriptor of fields) {
    fieldMap[descriptor.name] = Object.freeze({ ...descriptor });
  }
  return Object.freeze({
    allowed_fields: Object.freeze(fields.map((descriptor) => descriptor.name)),
    required_fields: Object.freeze(fields.filter((descriptor) => descriptor.required).map((descriptor) => descriptor.name)),
    fields: Object.freeze(fieldMap),
  });
}

/** 唯一真源：capability_id → 最小 planner 输入 schema（从既有生产常量派生）。 */
export const PLANNER_INPUT_SCHEMAS: Readonly<Record<string, PlannerInputSchema>> = Object.freeze({
  'customer.search': defineSchema([
    stringField('name_query'),
    stringField('region'),
    stringField('industry'),
    stringField('customer_grade'),
    stringField('list_kind'),
  ]),
  'follow_up.create': defineSchema([
    stringField('title', { required: true }),
    stringField('feedback_notes', { nullable: true }),
    stringField('next_follow_up_at', { nullable: true }),
  ]),
  'task.create': defineSchema([
    stringField('title', { required: true }),
    stringField('due_at', { nullable: true }),
  ]),
  'customer.next_follow_up_time.update': defineSchema([
    stringField('next_follow_up_at', { required: true }),
  ]),
  'customer.create': defineSchema([
    stringField('name', { required: true }),
    stringField('wechat_id', { nullable: true }),
    stringField('phone_number', { nullable: true }),
    enumField('contact_method', CONTACT_METHODS, { nullable: true }),
    enumField('wechat_search_status', WECHAT_SEARCH_STATUSES, { nullable: true }),
    booleanField('is_key_decision_maker'),
    enumField('wechat_add_status', WECHAT_ADD_STATUSES, { nullable: true }),
    enumField('intent_level', INTENT_LEVELS, { nullable: true }),
    enumField('phone_feedback', PHONE_FEEDBACKS, { nullable: true }),
    stringField('rough_visit_time_text', { nullable: true }),
    stringField('notes', { nullable: true }),
    stringField('website', { nullable: true }),
    stringField('region', { nullable: true }),
    stringField('industry', { nullable: true }),
    stringField('contact_person', { nullable: true }),
    stringField('email', { nullable: true }),
    stringField('address', { nullable: true }),
    stringField('pitch_angle', { nullable: true }),
    stringField('qualification_reason', { nullable: true }),
    stringField('source', { nullable: true }),
  ]),
  'customer.profile.update': defineSchema([
    stringField('name'),
    stringField('wechat_id', { nullable: true }),
    stringField('phone_number', { nullable: true }),
    enumField('wechat_search_status', WECHAT_SEARCH_STATUSES, { nullable: true }),
    booleanField('is_key_decision_maker'),
    enumField('contact_method', CONTACT_METHODS, { nullable: true }),
    stringField('notes', { nullable: true }),
    stringField('website', { nullable: true }),
    stringField('region', { nullable: true }),
    stringField('industry', { nullable: true }),
    stringField('contact_person', { nullable: true }),
    stringField('email', { nullable: true }),
    stringField('address', { nullable: true }),
    stringField('pitch_angle', { nullable: true }),
    stringField('qualification_reason', { nullable: true }),
    stringField('source', { nullable: true }),
  ]),
  'customer.opportunity_amount.update': defineSchema([
    numberField('opportunity_amount', { required: true, nullable: true, numeric_constraint: 'positive' }),
  ]),
  'customer.delete': defineSchema([]),
  'visit.create': defineSchema([
    stringField('title', { required: true }),
    stringField('visit_notes', { nullable: true }),
    stringField('customer_concerns', { nullable: true }),
    enumField('intent_after_visit', INTENT_LEVELS, { nullable: true }),
    enumField('visit_outcome', VISIT_OUTCOMES, { nullable: true }),
    enumField('next_action', VISIT_NEXT_ACTIONS, { nullable: true }),
    stringField('expected_contract_at', { nullable: true, format: 'YYYY-MM-DD' }),
  ]),
  'battle_card.draft.create': defineSchema([
    enumField('stage_code', CUSTOMER_STAGES, { required: true }),
  ]),
  'battle_card.confirm': defineSchema([
    stringField('card_id', { required: true }),
    numberField('expected_version', { required: true, numeric_constraint: 'finite' }),
  ]),
  'battle_card.hypothesis.status.update': defineSchema([
    stringField('hypothesis_id', { required: true }),
    enumField('new_status', HYPOTHESIS_STATUSES, { required: true }),
    stringField('reason', { nullable: true }),
    stringField('expected_version', { required: true }),
  ]),
  'battle_card.intelligence_import.confirm': defineSchema([
    stringField('raw_content', { required: true }),
    stringArrayField('keep_fact_ids'),
    stringArrayField('keep_hypothesis_ids'),
    objectField('fact_overrides'),
    arrayField('fact_verifications'),
    stringField('source_system', { nullable: true }),
  ]),
});

/** 读/分析能力无业务输入（scope 即上下文）；schema 为空。 */
export function plannerInputSchemaFor(capabilityId: string): PlannerInputSchema {
  return PLANNER_INPUT_SCHEMAS[capabilityId] ?? Object.freeze({ allowed_fields: [], required_fields: [], fields: {} });
}

/**
 * 需要执行句柄 db 注入的能力（引擎绑定层 validateInput 要求 input 携带 db）。
 * 模型/planner 绝不暴露 db；由 controller 在路由到引擎前注入真实 db 句柄。
 */
const DB_REQUIRING_CAPABILITY_IDS: ReadonlySet<string> = new Set([
  'customer.next_follow_up_time.update',
  'customer.profile.update',
  'customer.opportunity_amount.update',
  'customer.delete',
  'visit.create',
  'battle_card.draft.create',
  'battle_card.confirm',
  'battle_card.hypothesis.status.update',
  'battle_card.intelligence_import.confirm',
]);

export function requiresDbHandle(capabilityId: string): boolean {
  return DB_REQUIRING_CAPABILITY_IDS.has(capabilityId);
}
