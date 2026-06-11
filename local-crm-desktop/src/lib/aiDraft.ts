import type {
  ScreenshotAnalysis,
  CallAnalysis,
  AIDraftInput,
  TextAIConfig,
  MultimodalConfig,
  MultimodalMessage,
  Customer,
} from './types';
import { buildDeepSeekChatRequest, normalizeTextProviderError } from './textAIProvider';
import {
  buildQwenMultimodalRequest,
  normalizeMultimodalProviderError,
} from './multimodalProvider';

// ── 截图识别 Prompt ──

export function buildWechatScreenshotPrompt(): string {
  return `你是一个销售 CRM 助手。请分析微信聊天截图，提取以下结构化信息。

业务规则（请严格遵守）：
1. 微信通过不能自动将客户等级升级为 A，只有基于明确的购买意向证据才能建议升级。
2. AI 只能建议客户等级，不能自动修改。如果建议 A，必须在 evidence 中给出充分证据。
3. confidence 低于 0.65 表示低置信度，应谨慎处理。
4. grade_suggestion 只能是 A/B/C/D/UNKNOWN。

请以 JSON 格式返回以下字段：
{
  "customer_name": "客户名称/昵称",
  "wechat_id": "微信号",
  "phone_number": "手机号（如果有）",
  "reply_status": "REPLIED | NO_REPLY | UNKNOWN",
  "intent_level": "HIGH | MEDIUM | LOW | NONE | UNKNOWN",
  "grade_suggestion": "A | B | C | D | UNKNOWN",
  "follow_up_result": "POSITIVE | NEGATIVE | NO_RESPONSE | UNKNOWN",
  "next_action": "下一步动作建议（中文描述）",
  "next_follow_up_text": "建议下次跟进时间描述（如：明天下午、下周二上午）",
  "summary": "对话摘要",
  "evidence": "支撑 grade_suggestion 的证据",
  "confidence": 0.0
}

只返回 JSON，不要其他文字。`;
}

export function parseScreenshotAnalysis(raw: string): ScreenshotAnalysis | null {
  let jsonStr = raw.trim();

  const codeBlock = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  }

  try {
    const obj = JSON.parse(jsonStr);
    return {
      customer_name: String(obj.customer_name ?? ''),
      wechat_id: String(obj.wechat_id ?? ''),
      phone_number: String(obj.phone_number ?? ''),
      reply_status: validateReplyStatus(obj.reply_status),
      intent_level: validateIntentLevel(obj.intent_level),
      grade_suggestion: validateGradeSuggestion(obj.grade_suggestion),
      follow_up_result: validateFollowUpResult(obj.follow_up_result),
      next_action: String(obj.next_action ?? ''),
      next_follow_up_text: String(obj.next_follow_up_text ?? ''),
      summary: String(obj.summary ?? ''),
      evidence: String(obj.evidence ?? ''),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    };
  } catch {
    return null;
  }
}

export function createDraftFromScreenshotAnalysis(
  result: ScreenshotAnalysis,
  customerId?: string,
): AIDraftInput {
  return {
    source_type: 'SCREENSHOT',
    customer_id: customerId ?? null,
    raw_input_summary: `截图识别: ${result.customer_name || '未识别客户名'}`,
    ai_result_json: JSON.stringify(result),
    confidence: result.confidence,
  };
}

// ── 通话文本分析 Prompt ──

export function buildCallTranscriptPrompt(transcript: string): string {
  return `你是一个销售 CRM 助手。请分析以下通话/语音转文字记录，提取结构化信息。

通话内容：
---
${transcript}
---

业务规则：
1. phone_feedback 只能取值：NOT_NEEDED（不需要）、CAN_LEARN（可以了解）、INTERESTED（有兴趣）、CAN_MEET（可以见面）、NO_ANSWER（未接）、INVALID_NUMBER（空号）、UNKNOWN（不确定）
2. intent_level 只能取值：HIGH（高意向）、MEDIUM（中意向）、LOW（低意向）、NONE（无意向）、UNKNOWN（未判断）
3. grade_suggestion 只能取值：A/B/C/D/UNKNOWN。AI 只能建议，不应自动修改客户数据。
4. 如果涉及时间（明天、下周、下周二下午等），在 next_follow_up_text 中保留原始中文描述。
5. confidence 低于 0.65 表示低置信度。

请以 JSON 格式返回：
{
  "summary": "通话摘要",
  "phone_feedback": "NOT_NEEDED | CAN_LEARN | INTERESTED | CAN_MEET | NO_ANSWER | INVALID_NUMBER | UNKNOWN",
  "intent_level": "HIGH | MEDIUM | LOW | NONE | UNKNOWN",
  "grade_suggestion": "A | B | C | D | UNKNOWN",
  "next_action": "下一步动作建议（中文）",
  "next_follow_up_text": "建议下次跟进时间（中文描述，如：下周三上午）",
  "risk": "风险提示（如有）",
  "confidence": 0.0
}

只返回 JSON，不要其他文字。`;
}

export function parseCallAnalysis(raw: string): CallAnalysis | null {
  let jsonStr = raw.trim();

  const codeBlock = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  }

  try {
    const obj = JSON.parse(jsonStr);
    return {
      summary: String(obj.summary ?? ''),
      phone_feedback: validatePhoneFeedback(obj.phone_feedback),
      intent_level: validateIntentLevel(obj.intent_level),
      grade_suggestion: validateGradeSuggestion(obj.grade_suggestion),
      next_action: String(obj.next_action ?? ''),
      next_follow_up_text: String(obj.next_follow_up_text ?? ''),
      risk: String(obj.risk ?? ''),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    };
  } catch {
    return null;
  }
}

export function createDraftFromCallAnalysis(
  result: CallAnalysis,
  customerId?: string,
): AIDraftInput {
  return {
    source_type: 'CALL_TEXT',
    customer_id: customerId ?? null,
    raw_input_summary: `通话文本分析: ${result.summary.slice(0, 100)}`,
    ai_result_json: JSON.stringify(result),
    confidence: result.confidence,
  };
}

// ── 文件处理 ──

export function imageFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // 提取 "data:image/png;base64,xxx" 中逗号后的 base64 部分
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

// ── API 调用函数 ──

export async function analyzeWechatScreenshot(
  config: MultimodalConfig,
  imageBase64: string,
  mimeType: string,
): Promise<{ analysis: ScreenshotAnalysis | null; rawResponse: string; error?: string }> {
  try {
    const messages: MultimodalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildWechatScreenshotPrompt() },
          { type: 'image_base64', imageBase64, mimeType },
        ],
      },
    ];

    const req = buildQwenMultimodalRequest(config, messages);
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        analysis: null,
        rawResponse: text,
        error: normalizeMultimodalProviderError({ status: res.status, message: text }),
      };
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? '';
    const analysis = parseScreenshotAnalysis(content);

    if (!analysis) {
      return {
        analysis: null,
        rawResponse: content,
        error: 'AI 返回内容不是有效 JSON，请重试或调整提示词',
      };
    }

    return { analysis, rawResponse: content };
  } catch (e) {
    return {
      analysis: null,
      rawResponse: '',
      error: normalizeMultimodalProviderError(e),
    };
  }
}

export async function analyzeCallTranscript(
  config: TextAIConfig,
  transcript: string,
): Promise<{ analysis: CallAnalysis | null; rawResponse: string; error?: string }> {
  try {
    const req = buildDeepSeekChatRequest(config, '你是一个销售 CRM 助手', buildCallTranscriptPrompt(transcript));
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        analysis: null,
        rawResponse: text,
        error: normalizeTextProviderError({ status: res.status, message: text }),
      };
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? '';
    const analysis = parseCallAnalysis(content);

    if (!analysis) {
      return {
        analysis: null,
        rawResponse: content,
        error: 'AI 返回内容不是有效 JSON，请重试或调整提示词',
      };
    }

    return { analysis, rawResponse: content };
  } catch (e) {
    return {
      analysis: null,
      rawResponse: '',
      error: normalizeTextProviderError(e),
    };
  }
}

export async function suggestNextActionWithDeepSeek(
  config: TextAIConfig,
  customer: Customer,
  recentNotes: string[],
): Promise<{ suggestion: string | null; rawResponse: string; error?: string }> {
  const context = `
客户名称: ${customer.name}
客户等级: ${customer.customer_grade}
当前阶段: ${customer.stage}
意向度: ${customer.intent_level}
电话反馈: ${customer.phone_feedback || '无'}
微信添加状态: ${customer.wechat_add_status}
最近备注: ${recentNotes.join('; ') || '无'}
`;

  try {
    const req = buildDeepSeekChatRequest(
      config,
      '你是一个资深销售教练。根据客户信息给出具体、可执行的下一步跟进建议。',
      `请分析这个客户并给出下一步建议：\n${context}\n\n给出 2-3 条具体可执行的建议。`,
    );
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        suggestion: null,
        rawResponse: text,
        error: normalizeTextProviderError({ status: res.status, message: text }),
      };
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? '';

    return { suggestion: content, rawResponse: content };
  } catch (e) {
    return {
      suggestion: null,
      rawResponse: '',
      error: normalizeTextProviderError(e),
    };
  }
}

// ── 字段校验 ──

function validateReplyStatus(v: unknown): ScreenshotAnalysis['reply_status'] {
  const valid = ['REPLIED', 'NO_REPLY', 'UNKNOWN'];
  return typeof v === 'string' && valid.includes(v)
    ? (v as ScreenshotAnalysis['reply_status'])
    : 'UNKNOWN';
}

function validateIntentLevel(v: unknown): ScreenshotAnalysis['intent_level'] {
  const valid = ['HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN'];
  return typeof v === 'string' && valid.includes(v)
    ? (v as ScreenshotAnalysis['intent_level'])
    : 'UNKNOWN';
}

function validateGradeSuggestion(v: unknown): ScreenshotAnalysis['grade_suggestion'] {
  const valid = ['A', 'B', 'C', 'D', 'UNKNOWN'];
  return typeof v === 'string' && valid.includes(v)
    ? (v as ScreenshotAnalysis['grade_suggestion'])
    : 'UNKNOWN';
}

function validateFollowUpResult(v: unknown): ScreenshotAnalysis['follow_up_result'] {
  const valid = ['POSITIVE', 'NEGATIVE', 'NO_RESPONSE', 'UNKNOWN'];
  return typeof v === 'string' && valid.includes(v)
    ? (v as ScreenshotAnalysis['follow_up_result'])
    : 'UNKNOWN';
}

function validatePhoneFeedback(v: unknown): CallAnalysis['phone_feedback'] {
  const valid = ['NOT_NEEDED', 'CAN_LEARN', 'INTERESTED', 'CAN_MEET', 'NO_ANSWER', 'INVALID_NUMBER', 'UNKNOWN'];
  return typeof v === 'string' && valid.includes(v)
    ? (v as CallAnalysis['phone_feedback'])
    : 'UNKNOWN';
}
