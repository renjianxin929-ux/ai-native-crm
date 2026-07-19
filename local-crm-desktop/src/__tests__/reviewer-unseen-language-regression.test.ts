import { describe, expect, it } from 'vitest';
import { createAgentIntentEnvelope, type ClosedAgentIntent } from '../lib/salesAgentTools/agentIntentEnvelope';

const NOW = '2026-07-16T00:00:00.000Z';
const cases: ReadonlyArray<readonly [string, ClosedAgentIntent]> = [
  ['给我捋一下这家公司现在到底啥情况', 'CUSTOMER_SUMMARY'], ['这单目前走到哪儿了', 'CUSTOMER_SUMMARY'],
  ['我刚接手，先让我快速认识下这家', 'CUSTOMER_SUMMARY'], ['把现有信息压成一段给我', 'CUSTOMER_SUMMARY'],
  ['客户这阵子的状态帮我过一遍', 'CUSTOMER_SUMMARY'], ['quick brief on this account', 'CUSTOMER_SUMMARY'],
  ['别展开，讲讲这个客户的全貌', 'CUSTOMER_SUMMARY'], ['把这家企业的来龙去脉串起来', 'CUSTOMER_SUMMARY'],
  ['我需要一个接手前的速览', 'CUSTOMER_SUMMARY'], ['这客户现状咋样', 'CUSTOMER_SUMMARY'],
  ['哪里最可能掉链子', 'CUSTOMER_RISK_ANALYSIS'], ['这单有啥雷', 'CUSTOMER_RISK_ANALYSIS'],
  ['帮我挑出推进里的隐患', 'CUSTOMER_RISK_ANALYSIS'], ['what could go wrong here', 'CUSTOMER_RISK_ANALYSIS'],
  ['值不值得继续花时间', 'CUSTOMER_RISK_ANALYSIS'], ['给这段关系做个风险体检', 'CUSTOMER_RISK_ANALYSIS'],
  ['有哪些信号不太对劲', 'CUSTOMER_RISK_ANALYSIS'], ['有没有被我们忽略的成交窗口', 'CUSTOMER_RISK_ANALYSIS'],
  ['风险和突破口一起看下', 'CUSTOMER_RISK_ANALYSIS'], ['这家还有戏吗', 'CUSTOMER_RISK_ANALYSIS'],
  ['现在最该先动哪一步', 'NEXT_ACTION_PREPARATION'], ['给我排个推进先后手', 'NEXT_ACTION_PREPARATION'],
  ['what should I do next', 'NEXT_ACTION_PREPARATION'], ['接下来怎么接比较顺', 'NEXT_ACTION_PREPARATION'],
  ['如果只能做一件事做什么', 'NEXT_ACTION_PREPARATION'], ['帮我定个下一拍', 'NEXT_ACTION_PREPARATION'],
  ['别分析太多，告诉我先干啥', 'NEXT_ACTION_PREPARATION'], ['这个局面怎么往前拱', 'NEXT_ACTION_PREPARATION'],
  ['下一步动作给个靠谱建议', 'NEXT_ACTION_PREPARATION'], ['从哪儿破局比较好', 'NEXT_ACTION_PREPARATION'],
  ['替我回一句，别太销售', 'FOLLOW_UP_DRAFT'], ['给客户回个自然点的消息', 'FOLLOW_UP_DRAFT'],
  ['write a warm follow up for this account', 'FOLLOW_UP_DRAFT'], ['帮我组织一下怎么开口', 'FOLLOW_UP_DRAFT'],
  ['我想催一下但别显得着急', 'FOLLOW_UP_DRAFT'], ['整一段能直接复制的回复', 'FOLLOW_UP_DRAFT'],
  ['用专业但不生硬的口吻回他', 'FOLLOW_UP_DRAFT'], ['给这次沟通补一条后续话术', 'FOLLOW_UP_DRAFT'],
  ['怎么回复比较合适，帮我写出来', 'FOLLOW_UP_DRAFT'], ['draft something short for WeChat', 'FOLLOW_UP_DRAFT'],
  ['刚才几轮聊了些什么', 'INTERACTION_SUMMARY'], ['把前几次交流串成时间脉络', 'INTERACTION_SUMMARY'],
  ['recap the recent conversations', 'INTERACTION_SUMMARY'], ['最近双方口径有什么变化', 'INTERACTION_SUMMARY'],
  ['给我还原一下最近沟通过程', 'INTERACTION_SUMMARY'], ['前面都谈了啥重点', 'INTERACTION_SUMMARY'],
  ['把近期往来压缩成三点', 'INTERACTION_SUMMARY'], ['我错过了哪些最新进展', 'INTERACTION_SUMMARY'],
  ['最近几轮对话的重点是啥', 'INTERACTION_SUMMARY'], ['把互动记录讲成人话', 'INTERACTION_SUMMARY'],
  ['这几家谁应该排前面', 'COMPLEX_CUSTOMER_COMPARE'], ['横着看一下这几个账户', 'COMPLEX_CUSTOMER_COMPARE'],
  ['compare these accounts for me', 'COMPLEX_CUSTOMER_COMPARE'], ['哪一家更有优先级', 'COMPLEX_CUSTOMER_COMPARE'],
  ['帮我做个多客户横向判断', 'COMPLEX_CUSTOMER_COMPARE'], ['这张图里有啥客户信息', 'CAPTURE_REVIEW'],
  ['read this screenshot', 'CAPTURE_REVIEW'], ['照片里的需求帮我摘出来', 'CAPTURE_REVIEW'],
  ['看图识别一下客户说了什么', 'CAPTURE_REVIEW'], ['从上传内容里找可核对的事实', 'CAPTURE_REVIEW'],
  ['请把客户目前的整体情况讲清楚', 'CUSTOMER_SUMMARY'], ['接手这家前给我一个概览', 'CUSTOMER_SUMMARY'],
  ['用三点概括客户现状', 'CUSTOMER_SUMMARY'], ['brief me on the account', 'CUSTOMER_SUMMARY'],
  ['先说说合作进展', 'CUSTOMER_SUMMARY'], ['这个客户现在是什么局面', 'CUSTOMER_SUMMARY'],
  ['给我一份短版客户速览', 'CUSTOMER_SUMMARY'], ['把零散信息汇成全貌', 'CUSTOMER_SUMMARY'],
  ['列出这家客户目前的整体情况', 'CUSTOMER_SUMMARY'], ['别写话术，只说客户现状', 'CUSTOMER_SUMMARY'],
  ['指出这单最不稳的地方', 'CUSTOMER_RISK_ANALYSIS'], ['机会和风险各是什么', 'CUSTOMER_RISK_ANALYSIS'],
  ['列出客户风险，不要找客户', 'CUSTOMER_RISK_ANALYSIS'], ['成交前可能踩什么坑', 'CUSTOMER_RISK_ANALYSIS'],
  ['哪些隐患会拖慢推进', 'CUSTOMER_RISK_ANALYSIS'], ['还有没有突破口', 'CUSTOMER_RISK_ANALYSIS'],
  ['判断继续投入是否值得', 'CUSTOMER_RISK_ANALYSIS'], ['what are the account risks', 'CUSTOMER_RISK_ANALYSIS'],
  ['找出最可能掉链子的环节', 'CUSTOMER_RISK_ANALYSIS'], ['分析机会窗口', 'CUSTOMER_RISK_ANALYSIS'],
  ['下一步先做哪件事', 'NEXT_ACTION_PREPARATION'], ['接下来怎么往前推进', 'NEXT_ACTION_PREPARATION'],
  ['给出一个明确 next step', 'NEXT_ACTION_PREPARATION'], ['现在该先联系谁', 'NEXT_ACTION_PREPARATION'],
  ['告诉我下一拍怎么走', 'NEXT_ACTION_PREPARATION'], ['这个客户怎么破局', 'NEXT_ACTION_PREPARATION'],
  ['先手动作是什么', 'NEXT_ACTION_PREPARATION'], ['what is the next move', 'NEXT_ACTION_PREPARATION'],
  ['推进顺序怎么排', 'NEXT_ACTION_PREPARATION'], ['下一步建议要具体', 'NEXT_ACTION_PREPARATION'],
  ['帮我写一条自然的客户回复', 'FOLLOW_UP_DRAFT'], ['起草一段简短跟进消息', 'FOLLOW_UP_DRAFT'],
  ['拟一份不催促的微信文案', 'FOLLOW_UP_DRAFT'], ['draft a concise reply', 'FOLLOW_UP_DRAFT'],
  ['给客户回一句专业的话', 'FOLLOW_UP_DRAFT'], ['把跟进话术写得像真人', 'FOLLOW_UP_DRAFT'],
  ['写个能直接复制的消息', 'FOLLOW_UP_DRAFT'], ['准备一段邮件跟进文案', 'FOLLOW_UP_DRAFT'],
  ['怎么回复客户，请写出来', 'FOLLOW_UP_DRAFT'], ['帮我组织一条后续消息', 'FOLLOW_UP_DRAFT'],
  ['总结近期几轮交流', 'INTERACTION_SUMMARY'], ['把前面的对话重点串起来', 'INTERACTION_SUMMARY'],
  ['最近沟通发生了什么变化', 'INTERACTION_SUMMARY'], ['回顾一下客户往来', 'INTERACTION_SUMMARY'],
  ['recent interaction recap', 'INTERACTION_SUMMARY'], ['把近期交流压成两点', 'INTERACTION_SUMMARY'],
  ['前几次沟通都说了什么', 'INTERACTION_SUMMARY'], ['复盘最近的客户对话', 'INTERACTION_SUMMARY'],
  ['梳理近期互动脉络', 'INTERACTION_SUMMARY'], ['刚才几轮交流的重点', 'INTERACTION_SUMMARY'],
  ['把这几家并排比较', 'COMPLEX_CUSTOMER_COMPARE'], ['多客户之间谁更优先', 'COMPLEX_CUSTOMER_COMPARE'],
  ['A 和 B 哪家更值得跟', 'COMPLEX_CUSTOMER_COMPARE'], ['横向对照这些账户', 'COMPLEX_CUSTOMER_COMPARE'],
  ['compare the customer set', 'COMPLEX_CUSTOMER_COMPARE'], ['这批客户排个优先级', 'COMPLEX_CUSTOMER_COMPARE'],
  ['对比两家公司当前机会', 'COMPLEX_CUSTOMER_COMPARE'], ['几家客户谁先推进', 'COMPLEX_CUSTOMER_COMPARE'],
  ['做一个多账户比较', 'COMPLEX_CUSTOMER_COMPARE'], ['并排看看这些客户', 'COMPLEX_CUSTOMER_COMPARE'],
];

describe('reviewer-unseen-language-regression', () => {
  it('returns the correct intent or safe clarification for all 120 reviewer expressions with zero wrong execution', () => {
    expect(cases).toHaveLength(120);
    const results = cases.map(([phrase, expected]) => {
      const envelope = createAgentIntentEnvelope(phrase, NOW);
      const safe = envelope.clarification_required && envelope.intent === 'SAFE_FALLBACK';
      return { phrase, expected, actual: envelope.intent, safe, correct: envelope.intent === expected || safe };
    });
    expect(results.filter(result => !result.correct)).toEqual([]);
    expect(results.filter(result => result.actual !== result.expected && !result.safe)).toHaveLength(0);
  });
});
