/**
 * V0.2C / C1.7 — Deterministic capability selector（Slim fallback, 非 25 能力路由器）.
 *
 * 定位：模型不可用时的"少量高置信捷径"。主路径（模型可用）由 runtimePlanner 走
 * registry 工具面 + 模型选择。本模块刻意只保留：
 *   - 现有已证明的 3 个窄写意图（follow_up / task / next_follow_up，委托 writeIntent）；
 *   - 5 个真正高置信、参数形状确定的新写原语（delete / opportunity / create /
 *     global-read / 拜访或资料改动的"识别意图→澄清"）；
 *   - 模型不可用时的诚实澄清，绝不伪造参数、绝不降级成客户摘要。
 *
 * 绝不：为 25 个能力各写一条正则；绝不复刻业务参数解析器。
 */

import type { DatabaseLike } from '../db';
import type { PlannerSelectionResult } from './capabilitySelectionRouter';
import { interpretCustomerQuery, isLastContactQuestion } from './customerQueryInterpretation';
import { classifyFollowUpVsSchedule } from './followUpInteractionContract';

export interface DeterministicSelectorInput {
  readonly utterance: string;
  readonly now_iso: string;
  readonly scoped_customer_id: string | null;
  readonly db?: DatabaseLike;
}

function clarify(capability_id: string | null, question: string, missing_fields: readonly string[]): PlannerSelectionResult {
  return { kind: 'clarify', clarification: { capability_id, clarification_question: question, missing_fields } };
}

function parseAmount(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(万|w|W|k|K|元|块)?/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = match[2] ?? '';
  if (unit === '万' || unit === 'w' || unit === 'W') return base * 10_000;
  if (unit === 'k' || unit === 'K') return base * 1_000;
  return base;
}

/** 确定性选择器（模型不可用回退）。仅高置信捷径，其余诚实澄清/unknown。 */
export function selectCapabilityDeterministic(input: DeterministicSelectorInput): PlannerSelectionResult {
  const text = input.utterance.trim();
  if (!text) return { kind: 'unknown', reason: '请输入指令。' };

  if (isLastContactQuestion(text)) {
    const lastContactQuery = interpretCustomerQuery(text);
    return {
      kind: 'invoke',
      selection: {
        capability_id: 'timeline.customer.read',
        arguments: lastContactQuery.name_query ? { name_query: lastContactQuery.name_query } : {},
      },
    };
  }

  // Write capability selection precedes browse/search so “新增一个客户” cannot
  // be stolen as a name lookup.
  if (/删除|删掉|删了|移除|彻底?(?:删|清)(?:除|掉)?/.test(text) && /客户|账户|这个|当前|该/.test(text)) {
    return { kind: 'invoke', selection: { capability_id: 'customer.delete', arguments: { db: input.db } } };
  }

  if (/商机(?:金额|额度|价值)|机会金额|成交额|预期金额/.test(text) && /记|写|改|设(?:为|置)?|更新/.test(text)) {
    const amount = parseAmount(text);
    if (amount === null || amount <= 0) {
      return clarify('customer.opportunity_amount.update', '请给出明确的商机金额数字，例如“记 20 万”。', ['opportunity_amount']);
    }
    return { kind: 'invoke', selection: { capability_id: 'customer.opportunity_amount.update', arguments: { db: input.db, opportunity_amount: amount } } };
  }

  // 新建客户 → customer.create。只高置信选择能力，不把 客户/企业/公司 当名称分隔符。
  // 已证明的窄提取：联系人/对接人/负责人 → contact_person。公司名由 sanitizer 保真抽取。
  if (/新建|新增|创建|登记|录入/.test(text) && /客户|企业|公司|联系人/.test(text)) {
    const args: Record<string, unknown> = {};
    const contact = text.match(/(?:联系人|对接人|负责人)\s*(?:是|为)?\s*([^\s，。！？]{1,20})/);
    if (contact?.[1]) args.contact_person = contact[1];
    return { kind: 'invoke', selection: { capability_id: 'customer.create', arguments: args } };
  }

  const query = interpretCustomerQuery(text);
  const analysisOrWrite = /总结|分析|风险|机会|下一步|建议|删除|删掉|新建|新增|创建|登记|录入|商机|拜访|写[一条个]?跟进|记录跟进/.test(text);
  if (!analysisOrWrite && (query.mode === 'list' || query.explicit_region || (query.mode === 'lookup' && query.name_query))) {
    const filters: Record<string, unknown> = {};
    if (query.name_query) filters.name_query = query.name_query;
    if (query.region) filters.region = query.region;
    if (query.customer_grade) filters.customer_grade = query.customer_grade;
    if (query.industry) filters.industry = query.industry;
    if (Object.keys(filters).length > 0) {
      return {
        kind: 'invoke',
        selection: {
          capability_id: 'customer.search',
          arguments: { filters, list_kind: query.list_mode ? 'portfolio' : 'resolution' },
        },
      };
    }
  }

  const followUpKind = classifyFollowUpVsSchedule(text);
  if (followUpKind.kind === 'future_only') {
    return { kind: 'unknown', reason: 'future_schedule_via_session' };
  }

  // 既有确定性写意图（follow_up / task / next_follow_up）留在既有 session 路径，
  // 本选择器不拦截，返回 unknown 交给 controller 的既有流程。

  // 全局跟进读。
  if (/(?:所有|全部|全量).{0,6}客户.{0,6}跟进|最近(?:所有|全部)客户.{0,6}跟进/.test(text)) {
    return { kind: 'invoke', selection: { capability_id: 'follow_up.global.read', arguments: {} } };
  }

  // 其余（拜访/作战卡/导入/资料改动/读等精细语义）交由模型选择；模型不可用则诚实 unknown。
  return { kind: 'unknown', reason: '当前 AI 模型不可用，无法可靠解释该请求；请配置模型后重试，或改用更明确的指令。' };
}
