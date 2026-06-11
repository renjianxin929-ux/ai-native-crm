import type { MultimodalConfig, MultimodalMessage, ModalityCapability } from './types';

export function getDefaultQwenMultimodalConfig(): MultimodalConfig {
  return {
    provider: 'qwen',
    apiKey: '',
    visionModel: 'qwen-vl-max',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    capabilities: {
      text: true,
      image: true,
      audio: false,
    },
  };
}

export function getProviderCapabilities(config: MultimodalConfig): ModalityCapability {
  return { ...config.capabilities };
}

export function validateMultimodalConfig(config: MultimodalConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.apiKey || config.apiKey.trim() === '') {
    errors.push('API Key 不能为空');
  }
  if (!config.baseUrl || config.baseUrl.trim() === '') {
    errors.push('baseUrl 不能为空');
  }
  if (!config.visionModel || config.visionModel.trim() === '') {
    errors.push('visionModel 不能为空');
  }
  return { valid: errors.length === 0, errors };
}

export function buildQwenMultimodalRequest(
  config: MultimodalConfig,
  messages: MultimodalMessage[],
): { url: string; headers: Record<string, string>; body: string } {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  const hasAudio = messages.some(m =>
    m.content.some(c => c.type === 'audio_base64')
  );
  if (hasAudio) {
    throw new Error('Audio not yet supported for Qwen');
  }

  const hasImage = messages.some(m =>
    m.content.some(c => c.type === 'image_base64')
  );
  if (hasImage && !config.capabilities.image) {
    throw new Error('Provider does not support image capability');
  }

  const convertedMessages = messages.map(m => ({
    role: m.role,
    content: m.content.map(c => {
      if (c.type === 'text') {
        return { type: 'text', text: c.text };
      }
      if (c.type === 'image_base64') {
        return {
          type: 'image_url',
          image_url: { url: `data:${c.mimeType};base64,${c.imageBase64}` },
        };
      }
      return c;
    }),
  }));

  const body = JSON.stringify({
    model: config.visionModel,
    messages: convertedMessages,
  });

  return { url, headers, body };
}

export function parseMultimodalJsonResponse(raw: string): { parsed: unknown; error?: string } {
  let jsonStr = raw.trim();

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

export function normalizeMultimodalProviderError(error: unknown): string {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return '网络连接失败，请检查网络和 baseUrl 配置';
  }

  const errObj = error as Record<string, unknown>;
  const status = errObj?.status;
  const message = String(errObj?.message ?? (error instanceof Error ? error.message : String(error)));

  const safeMessage = message.replace(/sk-[a-zA-Z0-9_-]+/g, '[API_KEY]');

  if (status === 401 || status === 403) {
    return 'API Key 无效或已过期，请检查 Qwen / DashScope API Key';
  }
  if (status === 429) {
    return 'API 调用频率超限，请稍后重试';
  }
  if (status === 500 || status === 502 || status === 503) {
    return `服务器错误 (${status})，请稍后重试`;
  }

  return safeMessage;
}

export async function testMultimodalConnection(config: MultimodalConfig): Promise<{ ok: boolean; message: string }> {
  const validation = validateMultimodalConfig(config);
  if (!validation.valid) {
    return { ok: false, message: validation.errors.join('; ') };
  }

  try {
    const messages: MultimodalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '回复 OK' }] },
    ];
    const req = buildQwenMultimodalRequest(config, messages);
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        message: normalizeMultimodalProviderError({ status: res.status, message: errText }),
      };
    }

    return { ok: true, message: `连接成功 (visionModel: ${config.visionModel})` };
  } catch (e) {
    return { ok: false, message: normalizeMultimodalProviderError(e) };
  }
}
