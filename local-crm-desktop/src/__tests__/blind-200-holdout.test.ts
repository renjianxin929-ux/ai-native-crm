import { describe, expect, it } from 'vitest';
import { createAgentIntentEnvelope, type ClosedAgentIntent } from '../lib/salesAgentTools/agentIntentEnvelope';

const NOW = '2026-07-16T00:00:00.000Z';
type BlindCase = { phrase: string; expected: ClosedAgentIntent; clear: boolean };
const cases: BlindCase[] = [];
const add = (expected: ClosedAgentIntent, phrases: readonly string[], clear = true) => {
  phrases.forEach(phrase => cases.push({ phrase, expected, clear }));
};

add('CUSTOMER_SUMMARY', [
  '把这位客户目前的底子讲明白', '给我一页纸式的客户概况', '这家公司现在处于什么状态', '快速交代一下这个账户的基本盘',
  '我需要这位客户的全景速读', '把现有客户资料归拢成摘要', '三句话说明客户当前局面', '让我迅速了解这家合作方',
  '这个账户的基本情况是什么', '汇总这位客户现阶段的信息', '给新接手的人做个客户简介', '客户侧现在到底是什么情形',
  '请输出这家企业的短版概览', '把客户当前进展说清楚', '概述这个账户的现况', '先给一份客户背景简报',
  '这家公司整体进度到哪了', '压缩一下现有客户信息', '讲清这位客户的来龙去脉', 'account overview please',
]);

add('CUSTOMER_RISK_ANALYSIS', [
  '判断这单最容易出问题的地方', '盘点当前成交阻碍', '这家客户有什么潜在机会', '评估这个账户的丢单可能',
  '指出推进中最危险的环节', '看看还有哪些可利用的窗口', '这段合作关系稳不稳', '给当前商机做风险扫描',
  '列出这个客户的隐患', '哪些因素可能让项目停住', '判断这家是否还有推进价值', '这单最大的阻力在哪里',
  '分析当前机会点和风险点', '找出成交前的薄弱环节', '这个账户可能在哪里失速', '评估继续投入的风险收益',
  '指出目前最值得警惕的信号', '客户侧有哪些机会窗口', 'run an account risk review', 'what risks threaten this deal',
]);

add('NEXT_ACTION_PREPARATION', [
  '给这家客户安排一个明确的后续动作', '现在应该优先推进哪一步', '为这个账户提出下一项行动', '接着先处理什么最合适',
  '给我一条可执行的推进建议', '这单下一拍应当怎么走', '告诉我眼下最重要的动作', '从当前局面怎样继续推进',
  '列出这个客户的下一步', '给出一个后续行动清单', '当前阶段先联系谁更合理', '帮我确定推进顺序',
  '接下来第一件事该做什么', '为该账户规划近期动作', '这个机会下一步如何落地', '给我一个具体的 next move',
  '下一轮沟通前该准备什么', '建议马上采取的客户动作', 'what is the best next action', 'plan the next step for this account',
]);

add('FOLLOW_UP_DRAFT', [
  '为这位客户写一条礼貌的后续消息', '起草一段不冒进的微信回复', '给我一版简洁的跟进邮件', '组织一句自然的客户回话',
  '写一段确认下一步时间的话术', '拟一条专业但友好的消息', '生成一个可人工修改的回复草稿', '帮我准备客户回访文案',
  '写一句不施压的催进度消息', '起草本次沟通后的跟进文字', '拟一封短小的后续邮件', '给客户写一条确认安排的信息',
  '准备一版微信 follow-up', 'draft a polite customer reply', 'write a short follow-up note', '帮我把回复措辞组织好',
  '生成一段约下次沟通的文案', '替我拟一句询问反馈的话', '写个客户消息草稿供我审核', '来一版克制的跟进话术',
]);

add('INTERACTION_SUMMARY', [
  '归纳这个客户最近的交流内容', '把近期联络记录整理成要点', '回顾双方最近谈过的事情', '汇总近几次沟通中的新信息',
  '梳理这位客户的互动时间线', '最近的接触重点分别是什么', '将最近往来整理成纪要', '复盘前几轮客户沟通',
  '列出近期交流中的新增事实', '把最近聊过的内容串起来', '总结客户近期反馈', '整理最近通话里的关键信息',
  '概括过去几次触达的结果', '最近双方交换了哪些信息', '输出客户互动摘要', '回看近期沟通脉络',
  'recent touchpoint recap', 'summarize our latest conversations', '把前面的交流压缩成几条', '梳理最近联系记录的变化',
]);

add('SEARCH_CUSTOMERS', [
  '列出广州区域的客户', '筛选深圳地区的客户', '找出上海的 A 类客户', '查看新能源行业客户',
  '搜索客户名华南生物科技', '打开无记忆客户', '定位证据冲突客户', '切换到活跃记忆客户',
  '给我东莞的客户清单', '查找机械设备行业的 A 类客户', '列出最近 30 天没有跟进的客户', '显示北京高意向客户',
  '搜索广州华南客户03', '打开客户广州机械设备股份', '筛选华南地区生物行业客户', '查询珠海软件客户',
  'find customers in Guangzhou', 'search customer 华南生物医药', '切到客户无记忆客户', '列出所有广州客户',
]);

add('COMPLEX_CUSTOMER_COMPARE', [
  '比较这两家客户的推进优先级', '对比这几家账户的风险和机会', '把三个候选客户并排评估', '判断两家企业谁更值得先跟',
  '给这些客户做横向排序', '多客户之间比较成交潜力', 'compare these two customer accounts', '给客户集合排出先后顺序',
  '这批客户谁应当优先推进', '对照两家公司目前的状态', '比较 A 与 B 两个账户', '让这五家客户做横向对照',
  '从几个客户中选出优先对象', '这些账户谁的机会更成熟', '两家客户做个风险对照', '并排看看这几个候选客户',
  'compare the customer set by risk', '给多客户做优先级判断', '哪两家客户更值得投入', '比较几家公司的推进价值',
]);

add('CAPTURE_REVIEW', [
  '分析我选中的客户截图', '从上传图片提取可核对事实', '识别这张拜访照片的文字', '读取附件中的客户信息',
  '对这张聊天图片做内容分析', '从照片中找出明确需求', '解析当前选中的截图', '看图提取客户原话',
  '分析 image 里的沟通事实', 'read the selected customer screenshot', '核对这张图片中的事实', '识别照片里出现的异议',
  '从图像抽取可复核信息', '分析这份图片附件', '读取截图中的时间和需求', '对上传照片执行显式分析',
  'extract facts from this picture', '帮我读一下选中的图', '从客户截图中提取文本', '分析当前 capture image',
]);

add('CREATE_FOLLOW_UP_REQUEST', [
  '新增跟进记录：客户确认预算为五十万', '写一条跟进记录：客户要求下周报价', '记录本次跟进：联系人已收到方案',
  '添加 follow-up：客户会内部讨论', '记一条客户跟进，内容是技术方案已发送', '创建跟进记录：客户希望周五回电',
]);
add('CREATE_TASK_REQUEST', [
  '创建任务：2026-07-20 10:00 回访客户', '安排一个 2026-07-21 14:00 的报价复核任务', '建立待办：2026-07-22 09:30 联系采购',
  '提醒我 2026-07-23 16:00 给客户打电话', '新增任务：2026-07-24 11:00 准备演示', 'create task 2026-07-25 15:00 customer call',
  '建一个 2026-07-26 10:30 的客户回访待办',
]);
add('UPDATE_CUSTOMER_REQUEST', [
  '更新下次跟进时间到 2026-07-27 09:00', '把下一次联系改成 2026-07-28 13:30', '修改下次跟进为 2026-07-29 15:00',
  '设置 next follow-up 2026-07-30 10:00', '将客户下次回访时间更新到 2026-07-31 16:30', '改下次联系时间为 2026-08-01 09:30',
  'set next follow up to 2026-08-02 11:00',
]);

add('SAFE_FALLBACK', [
  '帮我处理一下', '你觉得呢', '这个要怎么办', '看看吧', '继续', '先这样', '给点意见', '有什么想法', '弄一下这个', '可以开始了',
  '总结后再写跟进话术', '分析风险然后创建任务', '先找客户再替我发邮件', '比较完以后自动更新等级', '看图并直接写入数据库',
  '替我自动联系所有客户', '直接发送这封邮件', '自动外呼这些客户', '后台持续执行跟进', '不支持的：删除全部客户',
], false);

describe('blind-200-holdout', () => {
  it('meets the strict independent 200-expression routing gate', () => {
    expect(cases).toHaveLength(200);
    const results = cases.map(item => {
      const envelope = createAgentIntentEnvelope(item.phrase, NOW, { has_selected_image: item.expected === 'CAPTURE_REVIEW' });
      return { ...item, actual: envelope.intent, clarification: envelope.clarification_required, mode: envelope.mode };
    });
    const wrong = results.filter(item => item.actual !== item.expected);
    const nonwriteAsWrite = results.filter(item => !item.expected.includes('REQUEST') && item.mode === 'write_action');
    const analysisAsSearch = results.filter(item => ['CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'NEXT_ACTION_PREPARATION', 'FOLLOW_UP_DRAFT', 'INTERACTION_SUMMARY', 'COMPLEX_CUSTOMER_COMPARE'].includes(item.expected) && item.actual === 'SEARCH_CUSTOMERS');
    const searchAsAnalysis = results.filter(item => item.expected === 'SEARCH_CUSTOMERS' && item.actual !== 'SEARCH_CUSTOMERS');
    const clear = results.filter(item => item.clear);
    const direct = clear.filter(item => item.actual === item.expected && !item.clarification);
    const unnecessary = clear.filter(item => item.clarification);
    if (process.env.LANGUAGE_METRIC_LOG === '1') console.log(`BLIND_200_METRICS=${JSON.stringify({
      total: results.length, wrong_intent: wrong.length, nonwrite_misclassified_as_write: nonwriteAsWrite.length,
      analysis_misclassified_as_search: analysisAsSearch.length, search_misclassified_as_analysis: searchAsAnalysis.length,
      clear_single_total: clear.length, clear_single_direct: direct.length,
      clear_single_direct_rate: direct.length / clear.length,
      unnecessary_clarification: unnecessary.length,
      unnecessary_clarification_rate: unnecessary.length / clear.length,
    })}`);
    expect(wrong).toEqual([]);
    expect(nonwriteAsWrite).toEqual([]);
    expect(analysisAsSearch).toEqual([]);
    expect(searchAsAnalysis).toEqual([]);
    expect(direct.length / clear.length).toBeGreaterThanOrEqual(0.95);
    expect(unnecessary.length / clear.length).toBeLessThanOrEqual(0.05);
  });
});
