import type {
  ScreenshotAnalysis,
  CallAnalysis,
  AIDraftInput,
  TextAIConfig,
  MultimodalConfig,
  Customer,
} from './types';
import { getActiveVerticalProfile, type VerticalRuleProfile } from './verticalProfiles';

export type LegacyDraftTestTransport = (request: {
  readonly capability: 'TEXT_REASONING' | 'VISION_ANALYSIS';
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly image?: { readonly mime_type: string; readonly base64: string };
}) => Promise<{ readonly ok: boolean; readonly status: number; readonly content: string }>;

export interface AIDraftProfileOptions {
  profile?: VerticalRuleProfile;
  /** Test-only seam. Production pages do not import or execute this legacy module. */
  transport?: LegacyDraftTestTransport;
}

// ── 截图识别 Prompt ──

export function buildWechatScreenshotPrompt(options: AIDraftProfileOptions = {}): string {
  const profile = options.profile ?? getActiveVerticalProfile();
  return profile.aiDraft.wechatScreenshotPrompt;
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
  options: AIDraftProfileOptions = {},
): AIDraftInput {
  const profile = options.profile ?? getActiveVerticalProfile();
  const summaries = profile.aiDraft.draftSummaries;
  return {
    source_type: 'SCREENSHOT',
    customer_id: customerId ?? null,
    raw_input_summary: `${summaries.screenshotPrefix}: ${result.customer_name || summaries.screenshotUnknownCustomer}`,
    ai_result_json: JSON.stringify(result),
    confidence: result.confidence,
  };
}

// ── 通话文本分析 Prompt ──

export function buildCallTranscriptPrompt(
  transcript: string,
  options: AIDraftProfileOptions = {},
): string {
  const profile = options.profile ?? getActiveVerticalProfile();
  const prompt = profile.aiDraft.callTranscriptPrompt;
  return `${prompt.beforeTranscript}${transcript}${prompt.afterTranscript}`;
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
  options: AIDraftProfileOptions = {},
): AIDraftInput {
  const profile = options.profile ?? getActiveVerticalProfile();
  const summaries = profile.aiDraft.draftSummaries;
  return {
    source_type: 'CALL_TEXT',
    customer_id: customerId ?? null,
    raw_input_summary: `${summaries.callPrefix}: ${result.summary.slice(0, summaries.callSummaryMaxLength)}`,
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
  options: AIDraftProfileOptions = {},
): Promise<{ analysis: ScreenshotAnalysis | null; rawResponse: string; error?: string }> {
  try {
    if (!options.transport) return { analysis: null, rawResponse: '', error: '旧版浏览器 Provider 路径已移除，请使用 Sales Agent Trusted Host。' };
    const response = await options.transport({
      capability: 'VISION_ANALYSIS', model: config.visionModel, system: 'Return reviewed visual facts only.',
      user: buildWechatScreenshotPrompt(options), image: { mime_type: mimeType, base64: imageBase64 },
    });
    if (!response.ok) return { analysis: null, rawResponse: '', error: `测试传输失败 (${response.status})` };
    const content = response.content;
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
    return { analysis: null, rawResponse: '', error: e instanceof Error ? e.message : '测试传输失败' };
  }
}

export async function analyzeCallTranscript(
  config: TextAIConfig,
  transcript: string,
  options: AIDraftProfileOptions = {},
): Promise<{ analysis: CallAnalysis | null; rawResponse: string; error?: string }> {
  const profile = options.profile ?? getActiveVerticalProfile();
  try {
    if (!options.transport) return { analysis: null, rawResponse: '', error: '旧版浏览器 Provider 路径已移除，请使用 Sales Agent Trusted Host。' };
    const response = await options.transport({
      capability: 'TEXT_REASONING', model: config.model, system: profile.aiDraft.callTranscriptSystemPrompt,
      user: buildCallTranscriptPrompt(transcript, { profile }),
    });
    if (!response.ok) return { analysis: null, rawResponse: '', error: `测试传输失败 (${response.status})` };
    const content = response.content;
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
    return { analysis: null, rawResponse: '', error: e instanceof Error ? e.message : '测试传输失败' };
  }
}

export async function suggestNextActionWithDeepSeek(
  config: TextAIConfig,
  customer: Customer,
  recentNotes: string[],
  options: AIDraftProfileOptions = {},
): Promise<{ suggestion: string | null; rawResponse: string; error?: string }> {
  const profile = options.profile ?? getActiveVerticalProfile();
  const policy = profile.aiDraft.nextActionSuggestion;
  const labels = policy.contextLabels;
  const emptyValue = policy.emptyValue;
  const context = `
${labels.customerName}: ${customer.name}
${labels.customerGrade}: ${customer.customer_grade}
${labels.stage}: ${customer.stage}
${labels.intentLevel}: ${customer.intent_level}
${labels.phoneFeedback}: ${customer.phone_feedback || emptyValue}
${labels.wechatAddStatus}: ${customer.wechat_add_status}
${labels.phoneNumber}: ${customer.phone_number || emptyValue}
${labels.wechatId}: ${customer.wechat_id || emptyValue}
${labels.contactPerson}: ${customer.contact_person || emptyValue}
${labels.website}: ${customer.website || emptyValue}
${labels.industry}: ${customer.industry || emptyValue}
${labels.source}: ${customer.source || emptyValue}
${labels.notes}: ${customer.notes || emptyValue}
${labels.recentNotes}: ${recentNotes.join('; ') || emptyValue}
`;

  try {
    if (!options.transport) return { suggestion: null, rawResponse: '', error: '旧版浏览器 Provider 路径已移除，请使用 Sales Agent Trusted Host。' };
    const response = await options.transport({
      capability: 'TEXT_REASONING', model: config.model, system: policy.systemPrompt,
      user: [context, ...policy.instructionLines].join('\n'),
    });
    if (!response.ok) return { suggestion: null, rawResponse: '', error: `测试传输失败 (${response.status})` };
    const content = response.content;

    return { suggestion: content, rawResponse: content };
  } catch (e) {
    return { suggestion: null, rawResponse: '', error: e instanceof Error ? e.message : '测试传输失败' };
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
