import { describe, expect, it } from 'vitest';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const NOW = '2026-07-16T00:00:00.000Z';
// Hand-authored independently from parser expressions. These deliberately emphasize ambiguity,
// omissions, typos, punctuation loss, code-switching, multi-action turns and capture state.
const HOLDOUT = [
  '这家咋样', '给个全景', '接手前扫一眼', 'account brief pls', '把脉一下', '现况呢', '先讲背景', '我需要快速上手', '三句话认识它', 'context me',
  '有雷没', '哪儿悬', '靠谱不', 'risk check pls', '成交还有戏么', '卡点找下', '最坏会怎样', '机会窗在哪', '哪里不稳', '值不值继续追',
  '咋往下走', '先做啥', 'next move', '给个先后手', '往哪推', '下一拍呢', '怎么破', '先联系谁', '接下来安排下', 'what now',
  '替我回下', '别太硬帮我写句', 'draft a reply', '微信怎么说', '催一下但自然点', '整段能复制的', '回客户一句', '写得像真人', 'followup wording', '帮组织语言',
  '前面聊啥了', '把交流串起来', 'recent convo recap', '最近口径变没', '漏了啥进展', '沟通脉络', '三点回顾', '前几轮重点', '对话复盘', 'latest touchpoints',
  '几家排个序', '横向看看', 'who first', '哪个先跟', '多账户对照', 'A跟B咋选', '比较下这批', '优先级怎么排', '谁更值得', '账户PK',
  '图里写啥', '看下截图', 'read the pic', '照片提信息', '识图', '附件还没传先别跑', '图已选但我只想问文字', '截图事实摘下', '看照片里的需求', 'image check',
  '总结完再帮我写一句', '先切到另一家然后概括', '风险看看顺便建任务', '比较后直接更新等级', '写话术并发送', '分析图片然后入库', '概括并改下次跟进', '看完就替我确认', '先找客户再做风险', '总结和排序一起',
  '这事怎么看', '嗯继续', '能弄吗', '帮个忙', '你决定', '照旧', '处理一下', '看看呗', '然后呢', '有想法吗',
  'zhe jia zen me yang', '客戸现壮咋样', '下一部咋搞', 'follow up咋写', '最进聊啥', 'duibi这几个', '图片没传呢', '图传了但先别分析', 'A/B who first?', 'summary + reply?',
  '先给个客户鸟瞰', '三十秒讲清这家', 'account snapshot', '说说当前盘面', '接管前快速扫盲',
  '哪里会卡住', '这单最脆弱的是啥', '机会点漏没漏', '值得继续耗资源吗', 'risk and upside check',
  '下一动作定一下', '先手给我', '接着往哪走', 'one concrete next step', '怎么把局面推起来',
  '帮回一条不油腻的', '给微信拟一句', 'reply draft please', '写个克制的催办', '组织一段后续措辞',
  '把这周交流复个盘', '最新对话梳理下', 'what changed in recent talks', '前几次往来重点', '沟通时间线概括',
  '这组客户横向排下', '两家谁先投入', 'compare A versus B', '多账户做优先判断', '并排看这些公司',
  '这张附件能看吗', '截图中的文字是什么', '图片事实提取', 'read visible facts only', '先选图再分析',
  '概括后顺便创建待办', '看风险并改客户等级', '写回复然后替我发送', '比较完直接入库', '识图之后自动更新',
  '这句话什么意思', '先别做任何动作', '我还没想好', '需要你问清楚', '不确定要哪种分析',
  '先停一下别猜', '范围还没说清', '让我再想想需求', '不要自行选择动作', '请先问我一个澄清问题',
] as const;

type HoldoutIntent = ReturnType<typeof createAgentIntentEnvelope>['intent'];

// Reviewer labels are explicit and positionally paired with HOLDOUT. Keeping the phrases
// independent from parser vocabulary prevents this gate from becoming a parser-template test.
const EXPECTED_INTENTS: readonly HoldoutIntent[] = [
  ...Array<HoldoutIntent>(10).fill('CUSTOMER_SUMMARY'),
  ...Array<HoldoutIntent>(10).fill('CUSTOMER_RISK_ANALYSIS'),
  ...Array<HoldoutIntent>(10).fill('NEXT_ACTION_PREPARATION'),
  ...Array<HoldoutIntent>(10).fill('FOLLOW_UP_DRAFT'),
  ...Array<HoldoutIntent>(10).fill('INTERACTION_SUMMARY'),
  ...Array<HoldoutIntent>(10).fill('COMPLEX_CUSTOMER_COMPARE'),
  ...Array<HoldoutIntent>(10).fill('IMAGE_CAPTURE_ANALYSIS'),
  ...Array<HoldoutIntent>(10).fill('SAFE_FALLBACK'),
  ...Array<HoldoutIntent>(10).fill('SAFE_FALLBACK'),
  'CUSTOMER_SUMMARY',
  'CUSTOMER_RISK_ANALYSIS',
  'NEXT_ACTION_PREPARATION',
  'FOLLOW_UP_DRAFT',
  'INTERACTION_SUMMARY',
  'COMPLEX_CUSTOMER_COMPARE',
  'IMAGE_CAPTURE_ANALYSIS',
  'SAFE_FALLBACK',
  'COMPLEX_CUSTOMER_COMPARE',
  'SAFE_FALLBACK',
  ...Array<HoldoutIntent>(5).fill('CUSTOMER_SUMMARY'),
  ...Array<HoldoutIntent>(5).fill('CUSTOMER_RISK_ANALYSIS'),
  ...Array<HoldoutIntent>(5).fill('NEXT_ACTION_PREPARATION'),
  ...Array<HoldoutIntent>(5).fill('FOLLOW_UP_DRAFT'),
  ...Array<HoldoutIntent>(5).fill('INTERACTION_SUMMARY'),
  ...Array<HoldoutIntent>(5).fill('COMPLEX_CUSTOMER_COMPARE'),
  ...Array<HoldoutIntent>(5).fill('IMAGE_CAPTURE_ANALYSIS'),
  ...Array<HoldoutIntent>(15).fill('SAFE_FALLBACK'),
];

describe('independent-holdout-routing', () => {
  it('achieves at least 97% correct-intent-or-safe-clarification across 150 independent expressions', () => {
    expect(HOLDOUT).toHaveLength(150);
    expect(EXPECTED_INTENTS).toHaveLength(HOLDOUT.length);
    const results = HOLDOUT.map((phrase, index) => {
      const envelope = createAgentIntentEnvelope(phrase, NOW);
      const safe = envelope.clarification_required && envelope.mode !== 'write_action';
      return { phrase, expected: EXPECTED_INTENTS[index], envelope, correctOrSafe: envelope.intent === EXPECTED_INTENTS[index] || safe };
    });
    expect(results.filter(result => !result.correctOrSafe)).toEqual([]);
    expect(results.filter(result => result.envelope.intent === 'SAFE_FALLBACK' && !result.envelope.clarification_required)).toHaveLength(0);
    expect(results.filter(result => result.envelope.mode === 'write_action')).toHaveLength(0);
    expect(results.slice(0, 60).filter(result => result.envelope.mode === 'portfolio_search' || result.envelope.mode === 'control')).toHaveLength(0);
    const unsafeMultiAction = [0, 2, 3, 4, 5, 6, 7, 9].map(offset => ({ phrase: HOLDOUT[70 + offset], result: results[70 + offset] }))
      .filter(item => !(item.result.envelope.intent === 'SAFE_FALLBACK' && item.result.envelope.clarification_required));
    expect(unsafeMultiAction).toEqual([]);
  });
});
