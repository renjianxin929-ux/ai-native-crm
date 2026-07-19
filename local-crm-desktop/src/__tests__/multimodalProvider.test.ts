import { describe, it, expect } from 'vitest';
import {
  getDefaultQwenMultimodalConfig,
  validateMultimodalConfig,
  getProviderCapabilities,
  buildQwenMultimodalRequest,
  parseMultimodalJsonResponse,
  normalizeMultimodalProviderError,
} from '../lib/multimodalProvider';
import type { MultimodalMessage } from '../lib/types';

describe('getDefaultQwenMultimodalConfig', () => {
  it('返回正确的默认 Qwen 多模态配置', () => {
    const config = getDefaultQwenMultimodalConfig();
    expect(config.provider).toBe('qwen');
    expect(config.visionModel).toBe('qwen-vl-max');
    expect(config.baseUrl).toContain('dashscope.aliyuncs.com');
    expect(config.apiKey).toBe('');
    expect(config.capabilities.text).toBe(true);
    expect(config.capabilities.image).toBe(true);
    expect(config.capabilities.audio).toBe(false);
  });
});

describe('getProviderCapabilities', () => {
  it('Qwen 默认支持 text+image，不支持 audio', () => {
    const config = getDefaultQwenMultimodalConfig();
    const caps = getProviderCapabilities(config);
    expect(caps.text).toBe(true);
    expect(caps.image).toBe(true);
    expect(caps.audio).toBe(false);
  });

  it('custom provider 由配置决定', () => {
    const caps = getProviderCapabilities({
      provider: 'custom',
      apiKey: 'test',
      visionModel: 'custom-model',
      baseUrl: 'https://example.com',
      capabilities: { text: true, image: false, audio: true },
    });
    expect(caps.text).toBe(true);
    expect(caps.image).toBe(false);
    expect(caps.audio).toBe(true);
  });
});

describe('validateMultimodalConfig', () => {
  it('apiKey 为空时返回错误', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = '';
    const result = validateMultimodalConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('API Key'))).toBe(true);
  });

  it('baseUrl 为空时返回错误', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-test';
    config.baseUrl = '';
    const result = validateMultimodalConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('baseUrl'))).toBe(true);
  });

  it('visionModel 为空时返回错误', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-test';
    config.visionModel = '';
    const result = validateMultimodalConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('visionModel'))).toBe(true);
  });

  it('全部合法返回 valid=true', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-test';
    const result = validateMultimodalConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('buildQwenMultimodalRequest', () => {
  it('纯文本消息构建正确的请求', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-qwen-test';
    const messages: MultimodalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: '你是 CRM 助手' }] },
      { role: 'user', content: [{ type: 'text', text: '分析客户数据' }] },
    ];
    const req = buildQwenMultimodalRequest(config, messages);

    expect(req.url).toBe('trusted-host://browser-provider-path-removed');
    expect(req.url).not.toContain('/chat/completions');
    expect(req.headers['Authorization']).toBeUndefined();

    const body = JSON.parse(req.body);
    expect(body.model).toBe('qwen-vl-max');
    expect(body.messages).toHaveLength(2);
  });

  it('image_base64 正确转换为 image_url 格式', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-qwen-test';
    const messages: MultimodalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张截图' },
          { type: 'image_base64', imageBase64: 'iVBORw0KGgo', mimeType: 'image/png' },
        ],
      },
    ];
    const req = buildQwenMultimodalRequest(config, messages);

    const body = JSON.parse(req.body);
    const userMsg = body.messages[0];
    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[0]).toEqual({ type: 'text', text: '请识别这张截图' });
    expect(userMsg.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0KGgo' },
    });
  });

  it('audio 请求抛出明确错误（P1 预留）', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-qwen-test';
    const messages: MultimodalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'audio_base64', audioBase64: 'base64data', mimeType: 'audio/mp3' },
        ],
      },
    ];
    expect(() => buildQwenMultimodalRequest(config, messages)).toThrow('Audio not yet supported');
  });

  it('不支持 image 但传入 image 时抛出错误', () => {
    const config = getDefaultQwenMultimodalConfig();
    config.apiKey = 'sk-qwen-test';
    config.capabilities.image = false;
    const messages: MultimodalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image_base64', imageBase64: 'iVBORw0KGgo', mimeType: 'image/png' },
        ],
      },
    ];
    expect(() => buildQwenMultimodalRequest(config, messages)).toThrow('does not support image');
  });
});

describe('parseMultimodalJsonResponse', () => {
  it('能解析 markdown JSON code block', () => {
    const result = parseMultimodalJsonResponse('```json\n{"customer_name":"张三"}\n```');
    expect(result.parsed).toEqual({ customer_name: '张三' });
    expect(result.error).toBeUndefined();
  });

  it('能解析纯 JSON 字符串', () => {
    const result = parseMultimodalJsonResponse('{"intent_level":"HIGH"}');
    expect(result.parsed).toEqual({ intent_level: 'HIGH' });
    expect(result.error).toBeUndefined();
  });

  it('非法 JSON 返回 error', () => {
    const result = parseMultimodalJsonResponse('AI 返回了无法解析的内容');
    expect(result.parsed).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toContain('无法解析');
  });
});

describe('normalizeMultimodalProviderError', () => {
  it('401 返回 API Key 无效提示', () => {
    const msg = normalizeMultimodalProviderError({ status: 401 });
    expect(msg).toContain('API Key');
    expect(msg).toContain('Qwen');
  });

  it('网络错误返回连接失败提示', () => {
    const msg = normalizeMultimodalProviderError(new TypeError('Failed to fetch'));
    expect(msg).toContain('网络');
  });

  it('不泄露 API Key', () => {
    const msg = normalizeMultimodalProviderError({
      status: 401,
      message: 'Invalid key: sk-qwen-secret-key-123',
    });
    expect(msg).not.toContain('sk-qwen-secret-key-123');
    expect(msg).not.toMatch(/sk-/);
  });
});
