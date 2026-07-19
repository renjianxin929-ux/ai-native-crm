import { describe, expect, it } from 'vitest';
import { buildAgentIntentEnvelope, type ClosedAgentIntent } from '../lib/salesAgentTools/agentIntentEnvelope';

const NOW = '2026-07-16T00:00:00.000Z';
const variants = ['请帮我', '麻烦', '现在', '我想', '能否'];
const expand = (bases: readonly string[]) => bases.flatMap(base => variants.map(prefix => `${prefix}${base}`));

const groups: ReadonlyArray<{ intent: ClosedAgentIntent; phrases: readonly string[] }> = [
  { intent: 'CUSTOMER_SUMMARY', phrases: expand(['总结这个客户', '概括客户现状', '看看这个客户整体怎么样', '说明这个客户最近的情况', '梳理客户合作进展', '总结客户当前情况', '概括一下这个客户', '说说客户整体怎么样', '整理客户最近的情况', '总结一下客户现状']) },
  { intent: 'CUSTOMER_RISK_ANALYSIS', phrases: expand(['分析这个客户的风险', '看看客户有哪些机会', '判断最大的风险', '分析最大的机会', '说说客户最大的问题', '判断这个客户是否值得推进', '梳理客户风险', '分析推进机会', '评估当前风险', '说明值得推进的机会']) },
  { intent: 'NEXT_ACTION_PREPARATION', phrases: expand(['建议下一步', '说说接下来先做什么', '给出推进建议', '分析应该怎么推进', '规划下一步工作', '告诉我下一步怎么办', '判断接下来先处理什么', '整理客户下一步', '建议接下来先推进什么', '给客户推进建议']) },
  { intent: 'FOLLOW_UP_DRAFT', phrases: expand(['写微信跟进客户的话术', '起草跟进消息', '拟一封客户跟进邮件', '写客户跟进短信', '起草微信跟进文案', '拟客户跟进话术', '写一段跟进消息', '起草客户沟通文案', '写邮件跟进客户', '拟一条客户跟进消息']) },
  { intent: 'INTERACTION_SUMMARY', phrases: expand(['总结最近客户互动', '整理近期沟通变化', '概括最近几次互动', '最近发生了哪些重要变化', '总结最近的客户互动', '整理最近几次沟通', '概括近期客户互动', '总结最近几次沟通变化', '整理近期互动情况', '概括最近客户互动变化']) },
  { intent: 'CAPTURE_REVIEW', phrases: expand(['分析这张聊天截图', '识别这张客户图片', '从这张照片提取有效信息', '看一下这张拜访照片里的有效信息', '分析这张客户照片', '从截图提取客户信息']) },
  { intent: 'COMPLEX_CUSTOMER_COMPARE', phrases: expand(['对比这三家客户哪个更值得优先跟进', '比较 A 和 B 的风险与机会', '对比两家客户的风险', '比较这些客户哪个更值得推进', '看看哪家客户更值得优先', '对比几个客户的机会']) },
];

describe('natural-language-paraphrase suite', () => {
  for (const group of groups) {
    it.each(group.phrases)(`${group.intent}: %s`, phrase => {
      const parsed = buildAgentIntentEnvelope(phrase, NOW, { has_selected_image: group.intent === 'CAPTURE_REVIEW' });
      expect(parsed.intent).toBe(group.intent);
      expect(parsed.parser_source).toBe('production_deterministic_v2');
      expect(parsed.requires_real_model).toBe(true);
      expect(parsed.model_capability).toBe(group.intent === 'CAPTURE_REVIEW' ? 'VISION_ANALYSIS' : 'TEXT_REASONING');
    });
  }

  const ambiguous = expand(['你好', '谢谢', '帮忙看看', '这是什么意思', '可以吗', '稍后再说', '我知道了', '嗯', '继续', '给点想法']);
  it.each(ambiguous)('negative ambiguity: %s', phrase => {
    const parsed = buildAgentIntentEnvelope(phrase, NOW);
    expect(parsed.intent).toBe('SAFE_FALLBACK');
    expect(parsed.clarification_required).toBe(true);
    expect(parsed.requires_real_model).toBe(false);
  });

  it('keeps deterministic search, write and control ahead of model routing', () => {
    expect(buildAgentIntentEnvelope('查找上海的 A 级客户', NOW).intent).toBe('SEARCH_CUSTOMERS');
    expect(buildAgentIntentEnvelope('创建下周一联系客户的任务', NOW).mode).toBe('write_action');
    expect(buildAgentIntentEnvelope('新增一条今天的跟进记录', NOW).mode).toBe('write_action');
    expect(buildAgentIntentEnvelope('取消当前操作', NOW).intent).toBe('CANCEL_PENDING_WRITE');
  });
});
