/**
 * Battle Card Backend V1 — 阶段规则表。
 * 阶段码唯一来源是 src/lib/types.ts 的 CustomerStage 枚举；
 * 禁止发明、重命名或自动推进阶段。
 */

import type { CustomerStage } from '../types';
import { STAGE_LABELS } from '../types';

export interface StageRule {
  readonly stage_code: CustomerStage;
  readonly label: string;
  readonly stage_goal: string;
  readonly stage_entry_criteria: readonly string[];
  readonly stage_exit_criteria: readonly string[];
  /** 该阶段停滞超过天数进入复盘队列。 */
  readonly stagnation_threshold_days: number;
  readonly target_roles: readonly string[];
}

export const STAGE_RULES: readonly StageRule[] = [
  {
    stage_code: 'NEW_LEAD',
    label: STAGE_LABELS.NEW_LEAD,
    stage_goal: '完成首次触达并判断基础意向，获取决策人联系方式',
    stage_entry_criteria: ['新线索进入客户池', '已记录来源与基础画像'],
    stage_exit_criteria: ['已完成首次触达', '意向明确或明确拒绝'],
    stagnation_threshold_days: 7,
    target_roles: ['决策人', '采购/运营负责人'],
  },
  {
    stage_code: 'CONTACTED',
    label: STAGE_LABELS.CONTACTED,
    stage_goal: '建立双向联系通道（微信/电话），确认沟通意愿',
    stage_entry_criteria: ['已发起首次触达'],
    stage_exit_criteria: ['微信已添加或电话有效沟通'],
    stagnation_threshold_days: 5,
    target_roles: ['决策人'],
  },
  {
    stage_code: 'WECHAT_PASSED',
    label: STAGE_LABELS.WECHAT_PASSED,
    stage_goal: '通过微信建立持续沟通，获取客户基础信息',
    stage_entry_criteria: ['微信好友申请已通过'],
    stage_exit_criteria: ['客户已回复或明确拒绝'],
    stagnation_threshold_days: 5,
    target_roles: ['决策人', '运营负责人'],
  },
  {
    stage_code: 'REPLIED',
    label: STAGE_LABELS.REPLIED,
    stage_goal: '挖掘需求并推动约访，确认关键痛点',
    stage_entry_criteria: ['客户已回复沟通'],
    stage_exit_criteria: ['约访时间确定或进入合同意向'],
    stagnation_threshold_days: 7,
    target_roles: ['决策人', '业务负责人'],
  },
  {
    stage_code: 'VISIT_READY',
    label: STAGE_LABELS.VISIT_READY,
    stage_goal: '完成面访准备（作战卡 + 方案材料），确认面访时间',
    stage_entry_criteria: ['客户同意约访'],
    stage_exit_criteria: ['面访完成'],
    stagnation_threshold_days: 5,
    target_roles: ['决策人', '业务负责人', '技术对接人'],
  },
  {
    stage_code: 'VISITED',
    label: STAGE_LABELS.VISITED,
    stage_goal: '面访后确认需求与方案契合度，推动进入合同流程',
    stage_entry_criteria: ['面访已完成'],
    stage_exit_criteria: ['方案确认并进入合同/打款流程'],
    stagnation_threshold_days: 7,
    target_roles: ['决策人'],
  },
  {
    stage_code: 'CONTRACTING',
    label: STAGE_LABELS.CONTRACTING,
    stage_goal: '完成合同条款确认并推动签约',
    stage_entry_criteria: ['方案与报价已确认'],
    stage_exit_criteria: ['合同签署或明确放弃'],
    stagnation_threshold_days: 7,
    target_roles: ['决策人', '财务/法务'],
  },
  {
    stage_code: 'PAYMENT_PENDING',
    label: STAGE_LABELS.PAYMENT_PENDING,
    stage_goal: '完成首款/全款支付',
    stage_entry_criteria: ['合同已签署'],
    stage_exit_criteria: ['款项到账'],
    stagnation_threshold_days: 5,
    target_roles: ['决策人', '财务'],
  },
  {
    stage_code: 'PAID',
    label: STAGE_LABELS.PAID,
    stage_goal: '完成交付与回访，沉淀客户成功案例',
    stage_entry_criteria: ['款项已到账'],
    stage_exit_criteria: ['交付完成并进入维护期'],
    stagnation_threshold_days: 14,
    target_roles: ['客户成功', '业务负责人'],
  },
  {
    stage_code: 'WON',
    label: STAGE_LABELS.WON,
    stage_goal: '维护客户关系，挖掘增购与转介绍',
    stage_entry_criteria: ['成交闭环'],
    stage_exit_criteria: ['无'],
    stagnation_threshold_days: 30,
    target_roles: ['客户成功'],
  },
  {
    stage_code: 'LOST',
    label: STAGE_LABELS.LOST,
    stage_goal: '沉淀丢单原因，保持低频回访机会',
    stage_entry_criteria: ['丢单确认'],
    stage_exit_criteria: ['无'],
    stagnation_threshold_days: 30,
    target_roles: [],
  },
];

const RULES_BY_STAGE: Readonly<Record<CustomerStage, StageRule>> = Object.freeze(
  Object.fromEntries(STAGE_RULES.map(rule => [rule.stage_code, rule])) as Record<CustomerStage, StageRule>,
);

export function getStageRule(stageCode: string): StageRule {
  const rule = RULES_BY_STAGE[stageCode as CustomerStage];
  if (!rule) throw new Error(`Unknown customer stage: ${stageCode}`);
  return rule;
}

export function isKnownStage(stageCode: string): boolean {
  return stageCode in RULES_BY_STAGE;
}
