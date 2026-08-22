/**
 * User-facing READ result adapter.
 * Structured capability payloads answer directly; this is not an LLM formatter.
 */

import { formatUserTimeLabel, formatUserFacingValue } from '../salesAgentUi/userFacingFieldFormatter';
import { isCompletedHistoricalFollowUp } from './followUpInteractionContract';
import { sortByInstantDesc } from '../time/instantCompare';
import { interpretCustomerQuery, isLastContactQuestion } from './customerQueryInterpretation';
import { STAGE_LABELS, type CustomerStage } from '../types';
import { evaluateBattleCardCoherence } from '../battleCardUi/battleCardViewModels';

export type ReadAnswerShape =
  | 'DIRECT_FACT'
  | 'LIST'
  | 'TIMELINE'
  | 'CUSTOMER_SUMMARY'
  | 'ANALYSIS';

export interface AdaptedReadAnswer {
  readonly shape: ReadAnswerShape;
  readonly headline: string;
  readonly message: string;
  readonly presentation: 'direct' | 'analysis';
}

export interface CustomerFactProjection {
  readonly name?: string | null;
  readonly customer_grade?: string | null;
  readonly region?: string | null;
  readonly industry?: string | null;
  readonly contact_person?: string | null;
  readonly opportunity_amount?: number | null;
  readonly last_contacted_at?: string | null;
  readonly next_follow_up_at?: string | null;
  readonly stage?: string | null;
  readonly has_visit?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordsOf(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (record && Array.isArray(record.records)) return record.records;
  if (Array.isArray(payload)) return payload;
  if (record && Array.isArray(record.candidates)) return record.candidates;
  return [];
}

function rowTime(row: Record<string, unknown> | null): string {
  if (!row) return '';
  return String(
    row.occurredAt
    ?? row.visited_at
    ?? row.created_at
    ?? row.updated_at
    ?? '',
  );
}

function rowTitle(row: Record<string, unknown> | null): string {
  if (!row) return '';
  if (typeof row.title === 'string' && row.title.trim()) return row.title;
  if (typeof row.summary === 'string' && row.summary.trim()) return row.summary;
  return '';
}

function rowDetail(row: Record<string, unknown> | null): string {
  if (!row) return '';
  for (const key of ['feedback_notes', 'visit_notes', 'customer_concerns', 'detail', 'summary']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatListLines(rows: unknown[], limit: number, customerNames?: Readonly<Record<string, string>>): string {
  return rows.slice(0, limit).map((item, index) => {
    const row = asRecord(item);
    const when = formatUserTimeLabel(rowTime(row));
    const title = rowTitle(row);
    const detail = rowDetail(row);
    const customerId = typeof row?.customer_id === 'string' ? row.customer_id : '';
    const customer = (customerId && customerNames?.[customerId]) || (typeof row?.name === 'string' ? row.name : '') || customerId;
    const parts = [when, customer, title, detail].filter(Boolean);
    return `${index + 1}. ${parts.join(' · ')}`;
  }).join('\n');
}

function formatCustomerLine(item: unknown): string {
  const row = asRecord(item);
  if (!row) return '';
  return typeof row.name === 'string' ? row.name : '';
}

function formatCustomerFacts(facts: CustomerFactProjection | undefined, payload: unknown, fallbackName?: string | null): string {
  const row = recordsOf(payload).map(asRecord).find(Boolean)
    ?? asRecord(payload)
    ?? {};
  const name = facts?.name || fallbackName || (typeof row.name === 'string' ? row.name : '') || (typeof row.customerId === 'string' ? '' : '');
  const grade = facts?.customer_grade ?? (typeof row.customer_grade === 'string' ? row.customer_grade : typeof row.grade === 'string' ? row.grade : null);
  const region = facts?.region ?? (typeof row.region === 'string' ? row.region : null);
  const industry = facts?.industry ?? (typeof row.industry === 'string' ? row.industry : null);
  const contact = facts?.contact_person ?? (typeof row.contact_person === 'string' ? row.contact_person : null);
  const amount = facts?.opportunity_amount ?? (typeof row.opportunity_amount === 'number' ? row.opportunity_amount : null);
  const last = facts?.last_contacted_at ?? (typeof row.last_contacted_at === 'string' ? row.last_contacted_at : null);
  const next = facts?.next_follow_up_at ?? (typeof row.next_follow_up_at === 'string' ? row.next_follow_up_at : null);
  const lines = [
    name ? `客户：${name}` : '客户资料',
    grade ? `等级：${grade}` : '',
    region ? `地区：${region}` : '',
    industry ? `行业：${industry}` : '',
    contact ? `联系人：${contact}` : '',
    typeof amount === 'number' ? `商机金额：${amount}` : '',
    last ? `上次联系：${formatUserTimeLabel(last)}` : '',
    next ? `下次跟进：${formatUserTimeLabel(next)}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function adaptReadSuccess(input: {
  readonly capability_id: string;
  readonly payload: unknown;
  readonly utterance: string;
  readonly customer_name?: string | null;
  readonly next_follow_up_at?: string | null;
  readonly clock_now?: string;
  readonly customer_facts?: CustomerFactProjection;
  readonly customer_names?: Readonly<Record<string, string>>;
}): AdaptedReadAnswer {
  const query = interpretCustomerQuery(input.utterance);
  if (input.capability_id === 'customer.search') {
    const payload = asRecord(input.payload);
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : recordsOf(input.payload);
    const names = candidates.map(formatCustomerLine).filter(Boolean);
    const total = typeof payload?.total_matches === 'number' ? payload.total_matches : names.length;
    if (query.explicit_region && query.region && names.length === 0) {
      return {
        shape: 'LIST',
        presentation: 'direct',
        headline: '没有匹配的客户',
        message: `CRM 中目前没有地区字段为“${query.region}”的客户。CRM 未变更。可改用名称包含该词的查找，例如“${query.region}客户有哪些”。`,
      };
    }
    if (query.name_query && names.length === 0) {
      return {
        shape: 'LIST',
        presentation: 'direct',
        headline: '没有匹配的客户',
        message: `CRM 中目前没有名称包含“${query.name_query}”的客户。CRM 未变更。`,
      };
    }
    if (names.length === 0) {
      return {
        shape: 'LIST',
        presentation: 'direct',
        headline: '没有匹配的客户',
        message: 'CRM 中目前没有符合该筛选条件的客户。CRM 未变更。',
      };
    }
    const list = names.slice(0, 20).map((name, index) => `${index + 1}. ${name}`).join('\n');
    return {
      shape: 'LIST',
      presentation: 'direct',
      headline: `找到 ${total} 家客户`,
      message: list,
    };
  }

  if (query.direct_fact === 'last_contact' || isLastContactQuestion(input.utterance)) {
    const rows = recordsOf(input.payload);
    const occurred = sortByInstantDesc(rows.filter(item => {
      const row = asRecord(item);
      if (!row) return false;
      if (row.kind === 'meeting' || typeof row.visited_at === 'string') return true;
      if ('is_completed' in row) return isCompletedHistoricalFollowUp(row);
      if (typeof row.occurredAt === 'string') return true;
      return false;
    }), item => rowTime(asRecord(item)));
    const name = input.customer_name ? `“${input.customer_name}”` : '该客户';
    const latest = occurred[0] ? asRecord(occurred[0]) : null;
    const when = latest ? formatUserTimeLabel(rowTime(latest)) : '';
    const title = rowTitle(latest);
    const detail = rowDetail(latest);
    let message = occurred.length === 0
      ? `目前没有已完成的联系记录。`
      : `上次联系${name}是${when}${title ? `（${title}）` : ''}${detail ? `：${detail}` : '。'}`;
    if (input.next_follow_up_at) {
      message += `\n已安排下次跟进：${formatUserTimeLabel(input.next_follow_up_at)}`;
    }
    return {
      shape: 'DIRECT_FACT',
      presentation: 'direct',
      headline: occurred.length ? `上次联系：${when}` : '目前没有已完成的联系记录',
      message,
    };
  }

  if (input.capability_id === 'timeline.visit.read') {
    const rows = recordsOf(input.payload);
    if (rows.length === 0) {
      return { shape: 'TIMELINE', presentation: 'direct', headline: '拜访记录', message: '目前没有拜访记录。' };
    }
    return {
      shape: 'TIMELINE',
      presentation: 'direct',
      headline: `拜访记录 ${rows.length} 条`,
      message: formatListLines(rows, 20, input.customer_names),
    };
  }

  if (input.capability_id === 'follow_up.customer.read') {
    const rows = recordsOf(input.payload).filter(item => {
      const row = asRecord(item);
      return row ? isCompletedHistoricalFollowUp(row) : false;
    });
    if (rows.length === 0) {
      return { shape: 'LIST', presentation: 'direct', headline: '跟进记录', message: '目前没有已完成的跟进记录。' };
    }
    return {
      shape: 'LIST',
      presentation: 'direct',
      headline: `跟进记录 ${rows.length} 条`,
      message: formatListLines(rows, 20, input.customer_names),
    };
  }

  if (input.capability_id === 'timeline.customer.read') {
    const rows = recordsOf(input.payload);
    if (rows.length === 0) {
      return { shape: 'TIMELINE', presentation: 'direct', headline: '互动时间线', message: '目前没有互动记录。' };
    }
    return {
      shape: 'TIMELINE',
      presentation: 'direct',
      headline: `互动时间线 ${rows.length} 条`,
      message: formatListLines(rows, 20, input.customer_names),
    };
  }

  if (input.capability_id === 'follow_up.global.read') {
    const rows = recordsOf(input.payload);
    if (rows.length === 0) {
      return { shape: 'LIST', presentation: 'direct', headline: '跟进记录', message: '目前没有任何跟进记录。' };
    }
    return {
      shape: 'LIST',
      presentation: 'direct',
      headline: `跟进记录 ${rows.length} 条`,
      message: formatListLines(rows, 12, input.customer_names),
    };
  }

  if (input.capability_id === 'customer.get' || input.capability_id === 'customer.context') {
    const message = formatCustomerFacts(input.customer_facts, input.payload, input.customer_name);
    return {
      shape: 'CUSTOMER_SUMMARY',
      presentation: 'direct',
      headline: input.customer_name ? `客户：${input.customer_name}` : '客户资料',
      message,
    };
  }

  if (input.capability_id === 'task.read_by_customer') {
    return formatTaskList(input.payload);
  }
  if (input.capability_id === 'battle_card.current.read') {
    return formatCurrentBattleCard(unwrapBattleCardData(input.payload), input.customer_facts);
  }
  if (input.capability_id === 'battle_card.history.read') {
    return formatBattleCardHistory(unwrapBattleCardData(input.payload));
  }
  if (input.capability_id === 'battle_card.context.read') {
    return formatBattleCardContext(unwrapBattleCardData(input.payload));
  }
  if (input.capability_id === 'import.file.preview') {
    return formatImportPreview(input.payload);
  }
  if (input.capability_id === 'import.mapping.validate') {
    return formatImportMapping(input.payload);
  }

  return {
    shape: 'ANALYSIS',
    presentation: 'analysis',
    headline: '已完成读取',
    message: '已根据 CRM 记录完成读取。',
  };
}

function unwrapBattleCardData(payload: unknown): unknown {
  const record = asRecord(payload);
  if (record && record.read_only === true && 'data' in record) return record.data;
  return payload;
}

function formatStageLabel(stage: unknown): string {
  if (typeof stage !== 'string' || !stage.trim()) return '';
  return STAGE_LABELS[stage as CustomerStage] ?? stage;
}

function parseCardPayload(card: Record<string, unknown>): Record<string, unknown> | null {
  const raw = card.payload_json;
  if (typeof raw !== 'string' || !raw.trim()) return asRecord(card.payload) ?? asRecord(card.action_card);
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function formatTaskList(payload: unknown): AdaptedReadAnswer {
  const rows = recordsOf(payload);
  if (rows.length === 0) {
    return { shape: 'LIST', presentation: 'direct', headline: '任务', message: '这个客户目前没有任务。' };
  }
  const lines = rows.slice(0, 20).map((item, index) => {
    const row = asRecord(item);
    const title = typeof row?.title === 'string' && row.title.trim() ? row.title.trim() : '未命名任务';
    const due = typeof row?.due_at === 'string' && row.due_at.trim() ? formatUserTimeLabel(row.due_at) : '';
    const status = typeof row?.status === 'string' ? formatUserFacingValue('status', row.status) : '';
    const priority = typeof row?.priority === 'string' ? formatUserFacingValue('priority', row.priority) : '';
    return `${index + 1}. ${[title, due ? `截止 ${due}` : '', status, priority].filter(Boolean).join(' · ')}`;
  });
  return {
    shape: 'LIST',
    presentation: 'direct',
    headline: `任务 ${rows.length} 条`,
    message: lines.join('\n'),
  };
}

function formatCurrentBattleCard(data: unknown, facts?: CustomerFactProjection): AdaptedReadAnswer {
  if (data == null) {
    return { shape: 'CUSTOMER_SUMMARY', presentation: 'direct', headline: '当前作战卡', message: '这个客户目前没有作战卡。' };
  }
  const card = asRecord(data);
  if (!card || typeof card.stage_code !== 'string') {
    return { shape: 'CUSTOMER_SUMMARY', presentation: 'direct', headline: '当前作战卡', message: '这个客户目前没有作战卡。' };
  }
  const payload = parseCardPayload(card);
  const action = asRecord(payload?.action_card) ?? payload;
  const nextAction = asRecord(action?.next_best_action);
  const cardLines = [
    typeof card.card_status === 'string' ? `状态：${formatUserFacingValue('status', card.card_status)}` : '',
    formatStageLabel(card.stage_code) ? `阶段：${formatStageLabel(card.stage_code)}` : '',
    typeof card.version === 'number' ? `版本：v${card.version}` : '',
    typeof action?.current_situation === 'string' && action.current_situation.trim() ? `当前情况：${action.current_situation.trim()}` : '',
    typeof action?.stage_goal === 'string' && action.stage_goal.trim() ? `阶段目标：${action.stage_goal.trim()}` : '',
    typeof nextAction?.objective === 'string' && nextAction.objective.trim() ? `下一步：${nextAction.objective.trim()}` : '',
  ].filter(Boolean);
  const coherence = evaluateBattleCardCoherence({
    customerStage: facts?.stage ?? '',
    cardStageCode: card.stage_code,
    hasVisit: facts?.has_visit === true,
  });
  const reviewLines = coherence.kind === 'stale'
    ? [coherence.user_message, cardLines.join('\n')]
    : coherence.kind === 'no_card'
      ? ['这个客户目前没有作战卡。']
      : ['这张作战卡目前仍与当前 CRM 阶段一致。', cardLines.join('\n')];
  return {
    shape: 'CUSTOMER_SUMMARY',
    presentation: 'direct',
    headline: coherence.kind === 'stale' ? '作战卡已部分过时' : '当前作战卡',
    message: reviewLines.filter(Boolean).join('\n'),
  };
}

function formatBattleCardHistory(data: unknown): AdaptedReadAnswer {
  const rows = Array.isArray(data) ? data : recordsOf(data);
  if (rows.length === 0) {
    return { shape: 'LIST', presentation: 'direct', headline: '作战卡历史', message: '这个客户目前没有作战卡历史。' };
  }
  const lines = rows.slice(0, 20).map((item, index) => {
    const row = asRecord(item);
    const stage = formatStageLabel(row?.stage_code);
    const version = typeof row?.version === 'number' ? `v${row.version}` : '';
    const status = typeof row?.card_status === 'string' ? formatUserFacingValue('status', row.card_status) : '';
    const when = typeof row?.confirmed_at === 'string' && row.confirmed_at.trim()
      ? formatUserTimeLabel(row.confirmed_at)
      : typeof row?.created_at === 'string' && row.created_at.trim()
        ? formatUserTimeLabel(row.created_at)
        : '';
    return `${index + 1}. ${[stage, version, status, when].filter(Boolean).join(' · ')}`;
  });
  return {
    shape: 'LIST',
    presentation: 'direct',
    headline: `作战卡历史 ${rows.length} 条`,
    message: lines.join('\n'),
  };
}

function formatBattleCardContext(data: unknown): AdaptedReadAnswer {
  const context = asRecord(data) ?? {};
  const lines: string[] = [];
  const current = context.current_stage_card;
  if (current && typeof current === 'object') {
    const card = asRecord(current);
    const stage = formatStageLabel(card?.stage_code);
    const status = typeof card?.card_status === 'string' ? formatUserFacingValue('status', card.card_status) : '';
    const version = typeof card?.version === 'number' ? `v${card.version}` : '';
    lines.push(`当前卡片：${[stage, version, status].filter(Boolean).join(' · ') || '有当前作战卡'}`);
  }
  if (Array.isArray(context.verified_facts)) {
    if (context.verified_facts.length === 0) {
      lines.push('目前没有已核实事实。');
    } else {
      lines.push('事实：');
      for (const [index, item] of context.verified_facts.slice(0, 8).entries()) {
        const row = asRecord(item);
        const statement = typeof row?.statement === 'string' ? row.statement.trim() : '';
        if (statement) lines.push(`${index + 1}. ${statement}`);
      }
    }
  }
  if (Array.isArray(context.hypotheses)) {
    if (context.hypotheses.length === 0) {
      lines.push('目前没有假设。');
    } else {
      lines.push('假设：');
      for (const [index, item] of context.hypotheses.slice(0, 8).entries()) {
        const row = asRecord(item);
        const statement = typeof row?.statement === 'string' ? row.statement.trim() : '';
        const status = typeof row?.status === 'string' ? formatUserFacingValue('status', row.status) : '';
        if (statement) lines.push(`${index + 1}. ${[statement, status].filter(Boolean).join(' · ')}`);
      }
    }
  }
  return {
    shape: 'CUSTOMER_SUMMARY',
    presentation: 'direct',
    headline: '作战卡上下文',
    message: lines.join('\n') || '当前没有可展示的作战卡上下文。',
  };
}

function formatImportPreview(payload: unknown): AdaptedReadAnswer {
  if (typeof File !== 'undefined' && payload instanceof File) {
    return {
      shape: 'LIST',
      presentation: 'direct',
      headline: '导入预览',
      message: '目前没有可预览的导入文件解析结果。请先选择一份 Excel 或 CSV 文件。',
    };
  }
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.headers) || !Array.isArray(record.rows)) {
    return {
      shape: 'LIST',
      presentation: 'direct',
      headline: '导入预览',
      message: '目前没有可预览的导入文件。请先选择一份 Excel 或 CSV 文件。',
    };
  }
  const headers = record.headers.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const rows = record.rows.filter(Array.isArray) as unknown[][];
  if (headers.length === 0 && rows.length === 0) {
    return {
      shape: 'LIST',
      presentation: 'direct',
      headline: '导入预览',
      message: '文件已解析，但没有检测到可用的表头或数据行。',
    };
  }
  const lines = [
    typeof record.sheetName === 'string' && record.sheetName.trim() ? `工作表：${record.sheetName.trim()}` : '',
    `数据行：${rows.length} 行`,
    headers.length ? `列：${headers.slice(0, 12).join('、')}${headers.length > 12 ? '…' : ''}` : '',
  ].filter(Boolean);
  if (rows.length > 0) {
    lines.push('预览：');
    for (const [index, row] of rows.slice(0, 5).entries()) {
      const cells = row.slice(0, 6).map(cell => String(cell ?? '').trim()).filter(Boolean);
      if (cells.length) lines.push(`${index + 1}. ${cells.join(' · ')}`);
    }
  }
  return {
    shape: 'LIST',
    presentation: 'direct',
    headline: '导入预览',
    message: lines.join('\n'),
  };
}

function formatImportMapping(payload: unknown): AdaptedReadAnswer {
  const record = asRecord(payload);
  if (!record || typeof record.valid !== 'boolean') {
    return {
      shape: 'DIRECT_FACT',
      presentation: 'direct',
      headline: '导入映射',
      message: '没有可用的映射校验结果。',
    };
  }
  if (record.valid) {
    return {
      shape: 'DIRECT_FACT',
      presentation: 'direct',
      headline: '导入映射',
      message: '导入字段映射有效。',
    };
  }
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return {
    shape: 'DIRECT_FACT',
    presentation: 'direct',
    headline: '导入映射无效',
    message: errors.length > 0
      ? `导入字段映射无效：\n${errors.slice(0, 12).map((item, index) => `${index + 1}. ${item}`).join('\n')}`
      : '导入字段映射无效。',
  };
}
