import { describe, it, expect } from 'vitest';
import {
  buildWechatScreenshotPrompt,
  parseScreenshotAnalysis,
  createDraftFromScreenshotAnalysis,
  buildCallTranscriptPrompt,
  parseCallAnalysis,
  createDraftFromCallAnalysis,
  analyzeWechatScreenshot,
  analyzeCallTranscript,
} from '../lib/aiDraft';

describe('buildWechatScreenshotPrompt', () => {
  it('包含 CRM 业务规则关键词', () => {
    const prompt = buildWechatScreenshotPrompt();
    expect(prompt).toContain('微信');
    expect(prompt).toContain('客户');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('A');
    expect(prompt).toContain('B');
    expect(prompt).toContain('C');
    expect(prompt).toContain('D');
  });

  it('包含不自动升 A 规则', () => {
    const prompt = buildWechatScreenshotPrompt();
    expect(prompt.toLowerCase()).toMatch(/不能.*自动|建议升级|必须.*证据/);
  });

  it('包含 JSON schema 定义', () => {
    const prompt = buildWechatScreenshotPrompt();
    expect(prompt).toContain('customer_name');
    expect(prompt).toContain('wechat_id');
    expect(prompt).toContain('reply_status');
    expect(prompt).toContain('intent_level');
    expect(prompt).toContain('grade_suggestion');
    expect(prompt).toContain('follow_up_result');
  });
});

describe('parseScreenshotAnalysis', () => {
  it('合法 JSON 解析成功，字段完整', () => {
    const json = JSON.stringify({
      customer_name: '张三',
      wechat_id: 'zhangsan_wx',
      phone_number: '13800138000',
      reply_status: 'REPLIED',
      intent_level: 'HIGH',
      grade_suggestion: 'B',
      follow_up_result: 'POSITIVE',
      next_action: '约访',
      next_follow_up_text: '下周二下午',
      summary: '客户意向很高',
      evidence: '客户说价格不错',
      confidence: 0.85,
    });
    const result = parseScreenshotAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.customer_name).toBe('张三');
    expect(result!.intent_level).toBe('HIGH');
    expect(result!.grade_suggestion).toBe('B');
    expect(result!.confidence).toBe(0.85);
  });

  it('非法 JSON 返回 null', () => {
    const result = parseScreenshotAnalysis('这不是合法的 JSON');
    expect(result).toBeNull();
  });

  it('低置信度仍返回对象（不丢弃，仅标记）', () => {
    const json = JSON.stringify({
      customer_name: '李四',
      wechat_id: '',
      phone_number: '',
      reply_status: 'UNKNOWN',
      intent_level: 'UNKNOWN',
      grade_suggestion: 'UNKNOWN',
      follow_up_result: 'UNKNOWN',
      next_action: '',
      next_follow_up_text: '',
      summary: '',
      evidence: '',
      confidence: 0.3,
    });
    const result = parseScreenshotAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.3);
  });

  it('缺少字段时使用默认值', () => {
    const json = JSON.stringify({ customer_name: '王五' });
    const result = parseScreenshotAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.customer_name).toBe('王五');
    expect(result!.confidence).toBe(0);
    expect(result!.intent_level).toBe('UNKNOWN');
  });
});

describe('buildCallTranscriptPrompt', () => {
  it('包含 phone_feedback 枚举值说明', () => {
    const prompt = buildCallTranscriptPrompt('测试通话内容');
    expect(prompt).toContain('测试通话内容');
    expect(prompt).toContain('phone_feedback');
    expect(prompt).toContain('NOT_NEEDED');
    expect(prompt).toContain('CAN_LEARN');
    expect(prompt).toContain('INTERESTED');
    expect(prompt).toContain('CAN_MEET');
  });

  it('包含 CRM 等级和意向约束', () => {
    const prompt = buildCallTranscriptPrompt('通话文本');
    expect(prompt).toContain('grade_suggestion');
    expect(prompt).toContain('intent_level');
    expect(prompt).toContain('confidence');
    expect(prompt).toMatch(/建议.*不应|只能建议/);
  });
});

describe('parseCallAnalysis', () => {
  it('"可以了解" → CAN_LEARN', () => {
    const json = JSON.stringify({
      summary: '客户愿意了解',
      phone_feedback: 'CAN_LEARN',
      intent_level: 'MEDIUM',
      grade_suggestion: 'B',
      next_action: '再触达',
      next_follow_up_text: '下周联系',
      risk: '无',
      confidence: 0.75,
    });
    const result = parseCallAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.phone_feedback).toBe('CAN_LEARN');
  });

  it('"有兴趣" → INTERESTED', () => {
    const json = JSON.stringify({
      summary: '客户有兴趣',
      phone_feedback: 'INTERESTED',
      intent_level: 'HIGH',
      grade_suggestion: 'A',
      next_action: '约访',
      next_follow_up_text: '明天',
      risk: '',
      confidence: 0.8,
    });
    const result = parseCallAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.phone_feedback).toBe('INTERESTED');
  });

  it('"可以见面" → CAN_MEET', () => {
    const json = JSON.stringify({
      summary: '客户愿意见面',
      phone_feedback: 'CAN_MEET',
      intent_level: 'HIGH',
      grade_suggestion: 'A',
      next_action: '约访',
      next_follow_up_text: '明天下午',
      risk: '',
      confidence: 0.9,
    });
    const result = parseCallAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.phone_feedback).toBe('CAN_MEET');
  });

  it('低置信度不抛异常', () => {
    const json = JSON.stringify({
      summary: '',
      phone_feedback: 'UNKNOWN',
      intent_level: 'UNKNOWN',
      grade_suggestion: 'UNKNOWN',
      next_action: '',
      next_follow_up_text: '',
      risk: '',
      confidence: 0.2,
    });
    const result = parseCallAnalysis(json);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.2);
  });

  it('非法 JSON 返回 null', () => {
    const result = parseCallAnalysis('通话很顺利');
    expect(result).toBeNull();
  });
});

describe('createDraftFromScreenshotAnalysis', () => {
  it('生成正确的 AIDraftInput 结构', () => {
    const analysis = {
      customer_name: '测试客户',
      wechat_id: 'test_wx',
      phone_number: '13800000000',
      reply_status: 'REPLIED' as const,
      intent_level: 'HIGH' as const,
      grade_suggestion: 'A' as const,
      follow_up_result: 'POSITIVE' as const,
      next_action: '约访',
      next_follow_up_text: '明天下午',
      summary: '客户很感兴趣',
      evidence: '客户主动询问价格',
      confidence: 0.88,
    };
    const draft = createDraftFromScreenshotAnalysis(analysis, 'customer-1');
    expect(draft.source_type).toBe('SCREENSHOT');
    expect(draft.customer_id).toBe('customer-1');
    expect(draft.confidence).toBe(0.88);

    const parsed = JSON.parse(draft.ai_result_json);
    expect(parsed.customer_name).toBe('测试客户');
    expect(parsed.grade_suggestion).toBe('A');
  });

  it('不传 customerId 时 customer_id 为 null', () => {
    const analysis = {
      customer_name: '新客户',
      wechat_id: '',
      phone_number: '',
      reply_status: 'UNKNOWN' as const,
      intent_level: 'UNKNOWN' as const,
      grade_suggestion: 'UNKNOWN' as const,
      follow_up_result: 'UNKNOWN' as const,
      next_action: '',
      next_follow_up_text: '',
      summary: '',
      evidence: '',
      confidence: 0.5,
    };
    const draft = createDraftFromScreenshotAnalysis(analysis);
    expect(draft.customer_id).toBeNull();
    expect(draft.source_type).toBe('SCREENSHOT');
  });
});

describe('createDraftFromCallAnalysis', () => {
  it('生成正确的 AIDraftInput 结构', () => {
    const analysis = {
      summary: '客户对方案有兴趣，约下周面谈',
      phone_feedback: 'INTERESTED' as const,
      intent_level: 'HIGH' as const,
      grade_suggestion: 'A' as const,
      next_action: '约访',
      next_follow_up_text: '下周三下午',
      risk: '竞品对比中',
      confidence: 0.78,
    };
    const draft = createDraftFromCallAnalysis(analysis, 'customer-2');
    expect(draft.source_type).toBe('CALL_TEXT');
    expect(draft.customer_id).toBe('customer-2');
    expect(draft.confidence).toBe(0.78);

    const parsed = JSON.parse(draft.ai_result_json);
    expect(parsed.phone_feedback).toBe('INTERESTED');
    expect(parsed.risk).toBe('竞品对比中');
  });
});

// ── Bug 4: JSON 解析失败返回明确 error ──

describe('analyzeWechatScreenshot — JSON parse failure', () => {
  it('HTTP 200 但非 JSON content → analysis=null + error 有明确文字 + rawResponse 保留', async () => {
    const config = { provider: 'qwen' as const, apiKey: 'sk-test', visionModel: 'qwen-vl-max', baseUrl: 'https://test.example.com/v1', capabilities: { text: false, image: true, audio: false } };
    const result = await analyzeWechatScreenshot(config, 'fakebase64', 'image/png', { transport: async () => ({ ok: true, status: 200, content: '这不是合法的 JSON 结构' }) });

    expect(result.analysis).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toContain('JSON');
    expect(result.rawResponse).toBe('这不是合法的 JSON 结构');

  });
});

describe('analyzeCallTranscript — JSON parse failure', () => {
  it('HTTP 200 但非 JSON content → analysis=null + error 有明确文字 + rawResponse 保留', async () => {
    const config = { provider: 'deepseek' as const, apiKey: 'sk-test', model: 'deepseek-chat', baseUrl: 'https://test.example.com/v1' };
    const result = await analyzeCallTranscript(config, '测试通话内容', { transport: async () => ({ ok: true, status: 200, content: '通话很顺利，客户表示愿意进一步了解' }) });

    expect(result.analysis).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toContain('JSON');
    expect(result.rawResponse).toBe('通话很顺利，客户表示愿意进一步了解');

  });
});
