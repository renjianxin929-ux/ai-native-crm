import type { TextAIConfig } from './types';

export function getDefaultDeepSeekConfig(): TextAIConfig {
  return {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  };
}

export function validateTextAIConfig(config: TextAIConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.apiKey || config.apiKey.trim() === '') {
    errors.push('API Key 不能为空');
  }
  if (!config.baseUrl || config.baseUrl.trim() === '') {
    errors.push('baseUrl 不能为空');
  }
  if (!config.model || config.model.trim() === '') {
    errors.push('model 不能为空');
  }
  return { valid: errors.length === 0, errors };
}

export function buildDeepSeekChatRequest(
  config: TextAIConfig,
  systemPrompt: string,
  userPrompt: string,
): { url: string; headers: Record<string, string>; body: string } {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return { url, headers, body };
}

export function parseTextJsonResponse(raw: string): { parsed: unknown; error?: string } {
  let jsonStr = raw.trim();

  // 尝试提取 markdown ```json ... ``` 块
  const codeBlock = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return { parsed };
  } catch {
    return { parsed: null, error: `无法解析 AI 返回的 JSON: ${raw.slice(0, 200)}` };
  }
}

export function normalizeTextProviderError(error: unknown): string {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return '网络连接失败，请检查网络和 baseUrl 配置';
  }

  const errObj = error as Record<string, unknown>;
  const status = errObj?.status;
  const message = String(errObj?.message ?? (error instanceof Error ? error.message : String(error)));

  // 移除消息中的 API Key
  const safeMessage = message.replace(/sk-[a-zA-Z0-9_-]+/g, '[API_KEY]');

  if (status === 401 || status === 403) {
    return 'API Key 无效或已过期，请检查 DeepSeek API Key';
  }
  if (status === 429) {
    return 'API 调用频率超限，请稍后重试';
  }
  if (status === 500 || status === 502 || status === 503) {
    return `服务器错误 (${status})，请稍后重试`;
  }

  return safeMessage;
}

export async function testTextAIConnection(config: TextAIConfig): Promise<{ ok: boolean; message: string }> {
  const validation = validateTextAIConfig(config);
  if (!validation.valid) {
    return { ok: false, message: validation.errors.join('; ') };
  }

  try {
    const req = buildDeepSeekChatRequest(config, '你是一个助手', '回复 OK');
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        message: normalizeTextProviderError({ status: res.status, message: errText }),
      };
    }

    return { ok: true, message: `连接成功 (model: ${config.model})` };
  } catch (e) {
    return { ok: false, message: normalizeTextProviderError(e) };
  }
}
