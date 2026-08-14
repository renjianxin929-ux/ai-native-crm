/**
 * V0.2A / W4-1 — Customer Create shared product service.
 *
 * 单一真源：把 CustomerForm "新增客户" create-mode 的完整产品语义提取到这里，
 * 让人工 UI 路径（CustomerForm.handleSubmit）与 Agent 确认后执行路径
 * （approvedCrmWriteBoundary create_customer 分支）复用同一份产品组合：
 *
 *   form input → parseRoughTime（模糊约访时间）→ getDefaultCustomerGrade（初始等级）
 *   → calculateNextFollowUpAt（初始跟进时间）→ db.createCustomer（插入行）
 *   → 适用后置产品规则（Rule 2 微信通过 / Rule 3 意向-电话反馈）
 *
 * 本模块不实现任何输入安全护栏（字段白名单 / 枚举校验 / fail-closed 属于能力
 * 绑定层与 confirmedWrite allowedFields）；它只负责"给定已校验的产品字段，
 * 按人工 CustomerForm 完全相同的方式创建客户"。id 由调用方生成
 * （CustomerForm 与能力确认交接各自生成 uuidv4，与人工提交时生成 id 一致）。
 *
 * 输出最小化（W4-1 契约）：返回 { customer_id }，绝不返回完整客户行。
 */

import { createCustomer, createTask, getCustomer, updateCustomer } from './db';
import {
  applyIntentRule,
  applyWechatPassed,
  calculateNextFollowUpAt,
  getDefaultCustomerGrade,
} from './rules';
import { parseRoughTime } from './timeParser';
import type {
  ContactMethod,
  Customer,
  CustomerGrade,
  IntentLevel,
  PhoneFeedback,
  TimeParseStatus,
  WechatAddStatus,
  WechatSearchStatus,
} from './types';

/**
 * 人工"新增客户"表单的完整产品字段集（用户可编辑字段白名单）。
 * 与 CustomerForm 的 20 个字段一一对应；系统/规则/领域自有字段绝不进入本输入。
 */
export interface CustomerCreateInput {
  /** 待创建客户的 id（调用方生成；与人工提交时 CustomerForm 生成 id 一致）。 */
  readonly id: string;
  /** 客户名称（必填；人工表单同语义：空串/纯空白被表单阻止提交）。 */
  readonly name: string;
  readonly wechat_id?: string | null;
  readonly phone_number?: string | null;
  readonly contact_method?: ContactMethod | null;
  readonly wechat_search_status?: WechatSearchStatus | null;
  /** 是否关键决策人：产品表示 0/1（表单 Number(...)，Customer.is_key_decision_maker: number）。 */
  readonly is_key_decision_maker?: 0 | 1;
  /** 微信添加状态：产品默认 NOT_ADDED（表单 select 无空选项）。 */
  readonly wechat_add_status?: WechatAddStatus;
  /** 意向度：产品默认 UNKNOWN（表单 select 无空选项）。 */
  readonly intent_level?: IntentLevel;
  readonly phone_feedback?: PhoneFeedback | null;
  readonly rough_visit_time_text?: string | null;
  readonly notes?: string | null;
  readonly website?: string | null;
  readonly region?: string | null;
  readonly industry?: string | null;
  readonly contact_person?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly pitch_angle?: string | null;
  readonly qualification_reason?: string | null;
  readonly source?: string | null;
}

/**
 * 按人工 CustomerForm create-mode 的完整语义创建客户并运行适用后置规则。
 * 只返回 { customer_id }（W4-1 OUTPUT 最小化契约）。
 */
export async function createCustomerWithProductRules(
  input: CustomerCreateInput,
): Promise<{ customer_id: string }> {
  const id = input.id;
  const now = new Date().toISOString();

  // 解析模糊约访时间（与 CustomerForm：仅非空白文本触发解析）
  let parsedReminder: string | null = null;
  let parseStatus: TimeParseStatus = 'NOT_PARSED';
  let parseNote: string | null = null;
  if (input.rough_visit_time_text?.trim()) {
    const result = parseRoughTime(input.rough_visit_time_text.trim());
    parsedReminder = result.parsed_at;
    parseStatus = result.status;
    parseNote = result.note;
  }

  // 初始等级（与 CustomerForm 相同的产品计算）
  const grade: CustomerGrade = getDefaultCustomerGrade({
    wechat_search_status: input.wechat_search_status ?? null,
    is_key_decision_maker: (input.is_key_decision_maker ?? 0) === 1,
  });

  // 初始跟进时间（与 CustomerForm 相同的产品计算）
  const nextFollowUpAt = calculateNextFollowUpAt(grade);

  await createCustomer(
    id,
    input.name,
    input.contact_method ?? null,
    input.wechat_id ?? null,
    input.phone_number ?? null,
    input.wechat_search_status ?? null,
    input.is_key_decision_maker ?? 0,
    grade,
    input.wechat_add_status ?? 'NOT_ADDED',
    input.intent_level ?? 'UNKNOWN',
    input.phone_feedback ?? null,
    input.rough_visit_time_text ?? null,
    parsedReminder,
    parseStatus,
    parseNote,
    nextFollowUpAt,
    input.notes ?? null,
    input.website ?? null,
    input.region ?? null,
    input.industry ?? null,
    input.contact_person ?? null,
    input.email ?? null,
    input.address ?? null,
    input.pitch_angle ?? null,
    input.qualification_reason ?? null,
    input.source ?? null,
  );

  // ── 新增后规则（与 CustomerForm create-mode 完全一致）────────────────
  // Rule 2：微信通过 → 创建首次沟通任务，不升级（stage 仅切 WECHAT_PASSED）
  if (input.wechat_add_status === 'PASSED') {
    const dummyCustomer: Customer = {
      id,
      name: input.name,
      customer_grade: grade,
      stage: 'NEW_LEAD',
      contact_method: (input.contact_method ?? null) as Customer['contact_method'],
      wechat_id: input.wechat_id ?? null,
      phone_number: input.phone_number ?? null,
      wechat_search_status: (input.wechat_search_status ?? null) as WechatSearchStatus | null,
      is_key_decision_maker: input.is_key_decision_maker ?? 0,
      wechat_add_status: 'NOT_ADDED' as WechatAddStatus,
      has_replied: 0,
      intent_level: (input.intent_level ?? 'UNKNOWN') as IntentLevel,
      phone_feedback: (input.phone_feedback ?? null) as PhoneFeedback | null,
      can_schedule_visit: 0,
      visit_scheduled_at: null,
      rough_visit_time_text: input.rough_visit_time_text ?? null,
      parsed_visit_reminder_at: parsedReminder,
      time_parse_status: parseStatus as Customer['time_parse_status'],
      time_parse_note: parseNote,
      next_follow_up_at: nextFollowUpAt,
      last_contacted_at: null,
      last_feedback_type: 'UNKNOWN',
      next_action: null,
      no_show_count: 0,
      lost_reason: null,
      payment_status: 'NOT_STARTED',
      deal_amount: null,
      paid_at: null,
      closed_at: null,
      notes: input.notes ?? null,
      website: input.website ?? null,
      region: input.region ?? null,
      industry: input.industry ?? null,
      contact_person: input.contact_person ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      pitch_angle: input.pitch_angle ?? null,
      qualification_reason: input.qualification_reason ?? null,
      source: input.source ?? null,
      created_at: now,
      updated_at: now,
    };
    const { customer: afterPass, tasks: wxTasks } = applyWechatPassed(dummyCustomer);
    await updateCustomer(id, { stage: afterPass.stage, next_follow_up_at: afterPass.next_follow_up_at });
    for (const task of wxTasks) {
      await createTask(task);
    }
  }

  // Rule 3：意向 → 可升级 A（与 CustomerForm 相同触发条件）
  if (input.intent_level === 'HIGH' || input.phone_feedback === 'CAN_MEET' || input.phone_feedback === 'INTERESTED') {
    const current = await getCustomer(id);
    if (current) {
      const { customer: afterIntent } = applyIntentRule(current, {
        intent_level: input.intent_level !== 'UNKNOWN' ? input.intent_level : null,
        phone_feedback: input.phone_feedback || null,
      });
      await updateCustomer(id, afterIntent);
    }
  }

  return { customer_id: id };
}
