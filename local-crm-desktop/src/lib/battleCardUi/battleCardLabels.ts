/**
 * Battle Card UI — 中文标签与状态文案（只读展示合同）。
 * 后端类型来自 src/lib/battleCard/types.ts，本文件只做展示映射，不改变语义。
 */

import type {
  CustomerBattleCardStatus,
  FactApplicability,
  FactVerificationStatus,
  HypothesisStatus,
  IntelligenceParseStatus,
  StageCardGeneratedBy,
  StageCardStatus,
} from '../battleCard/types';
import { STAGE_LABELS } from '../types';

export const FACT_VERIFICATION_STATUS_LABELS: Readonly<Record<FactVerificationStatus, string>> = {
  PENDING: '待核实',
  VERIFIED: '已核实',
  CONFLICTED: '冲突',
  SUPERSEDED: '已替代',
};

export const FACT_APPLICABILITY_LABELS: Readonly<Record<FactApplicability, string>> = {
  GLOBAL: '全局适用',
  PARTIAL: '部分适用',
  CONDITIONAL: '条件适用',
  UNSUPPORTED: '证据不足',
};

export const FACT_APPLICABILITY_SHORT: Readonly<Record<FactApplicability, string>> = {
  GLOBAL: '全局',
  PARTIAL: '部分',
  CONDITIONAL: '条件',
  UNSUPPORTED: '不足',
};

export const HYPOTHESIS_STATUS_LABELS: Readonly<Record<HypothesisStatus, string>> = {
  PENDING: '待验证',
  PARTIALLY_CONFIRMED: '部分确认',
  CONFIRMED: '已确认',
  REJECTED: '已证伪',
  EXPIRED: '已过期',
};

export const HYPOTHESIS_STATUS_ACTIONS: readonly { readonly status: HypothesisStatus; readonly label: string }[] = [
  { status: 'PENDING', label: '保持待验证' },
  { status: 'PARTIALLY_CONFIRMED', label: '标记部分确认' },
  { status: 'CONFIRMED', label: '确认成立' },
  { status: 'REJECTED', label: '证伪' },
  { status: 'EXPIRED', label: '过期' },
];

export const PARSE_STATUS_LABELS: Readonly<Record<IntelligenceParseStatus, string>> = {
  PENDING: '解析中',
  DRAFTED: '草稿',
  CONFIRMED: '已确认',
  CANCELLED: '已取消',
};

export const STAGE_CARD_STATUS_LABELS: Readonly<Record<StageCardStatus, string>> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
};

export const STAGE_CARD_GENERATED_BY_LABELS: Readonly<Record<StageCardGeneratedBy, string>> = {
  DETERMINISTIC: '本地规则',
  MODEL_ENHANCED: '模型增强',
  MANUAL: '人工',
};

export const BATTLE_CARD_STATUS_LABELS: Readonly<Record<CustomerBattleCardStatus, string>> = {
  NONE: '无作战卡',
  DRAFT: '草稿待确认',
  CONFIRMED: '已确认',
  REVIEW_DUE: '待复核',
};

export const STAGE_LABELS_MAP = STAGE_LABELS;

export function stageLabel(stageCode: string): string {
  return STAGE_LABELS[stageCode as keyof typeof STAGE_LABELS] ?? stageCode;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysBetween(fromIso: string, nowIso: string): number | null {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - from) / (24 * 60 * 60 * 1000)));
}

export function evidenceRefLabel(ref: string): string {
  if (ref.startsWith('import:')) return `材料来源：${ref.slice('import:'.length)}`;
  if (ref.startsWith('reviewed_fact:')) return '已核实事实';
  if (ref.startsWith('hypothesis:')) return '假设';
  if (ref.startsWith('customer:')) return '客户档案';
  if (ref.startsWith('stage:')) return `阶段 ${stageLabel(ref.slice('stage:'.length))}`;
  if (ref.startsWith('card:')) return '作战卡';
  const match = ref.match(/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):(.+)$/);
  if (match) {
    const typeLabel: Record<string, string> = {
      CUSTOMER: '客户档案',
      FOLLOW_UP_RECORD: '跟进记录',
      VISIT_RECORD: '拜访记录',
      TASK: '任务',
    };
    const id = match[2] ?? '';
    return `${typeLabel[match[1] ?? ''] ?? match[1]}（${id.slice(0, 12)}${id.length > 12 ? '…' : ''}）`;
  }
  return ref;
}
