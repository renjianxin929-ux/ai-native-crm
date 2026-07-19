import { describe, it, expect } from 'vitest';
import {
  getDefaultDeepSeekConfig,
  validateTextAIConfig,
  buildDeepSeekChatRequest,
  parseTextJsonResponse,
  normalizeTextProviderError,
} from '../lib/textAIProvider';

describe('getDefaultDeepSeekConfig', () => {
  it('返回正确的默认 DeepSeek 配置', () => {
    const config = getDefaultDeepSeekConfig();
    expect(config.provider).toBe('deepseek');
    expect(config.model).toBe('deepseek-chat');
    expect(config.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(config.apiKey).toBe('');
  });
});

describe('validateTextAIConfig', () => {
  it('apiKey 为空时返回错误', () => {
    const result = validateTextAIConfig({
      provider: 'deepseek',
      apiKey: '',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('API Key'))).toBe(true);
  });

  it('baseUrl 为空时返回错误', () => {
    const result = validateTextAIConfig({
      provider: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      baseUrl: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('baseUrl'))).toBe(true);
  });

  it('model 为空时返回错误', () => {
    const result = validateTextAIConfig({
      provider: 'deepseek',
      apiKey: 'sk-test',
      model: '',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('model'))).toBe(true);
  });

  it('全部合法返回 valid=true', () => {
    const result = validateTextAIConfig({
      provider: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('buildDeepSeekChatRequest', () => {
  it('构建正确的 OpenAI-compatible chat/completions 请求', () => {
    const config = getDefaultDeepSeekConfig();
    config.apiKey = 'sk-test-key';
    const req = buildDeepSeekChatRequest(config, '你是一个销售助手', '分析这段对话');

    expect(req.url).toBe('trusted-host://browser-provider-path-removed');
    expect(req.url).not.toContain('/chat/completions');
    expect(req.headers['Authorization']).toBeUndefined();
    expect(req.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(req.body);
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: '你是一个销售助手' });
    expect(body.messages[1]).toEqual({ role: 'user', content: '分析这段对话' });
  });
});

describe('parseTextJsonResponse', () => {
  it('能解析 markdown JSON code block', () => {
    const result = parseTextJsonResponse('```json\n{"name":"test","value":42}\n```');
    expect(result.parsed).toEqual({ name: 'test', value: 42 });
    expect(result.error).toBeUndefined();
  });

  it('能解析纯 JSON 字符串', () => {
    const result = parseTextJsonResponse('{"hello":"world"}');
    expect(result.parsed).toEqual({ hello: 'world' });
    expect(result.error).toBeUndefined();
  });

  it('非法 JSON 返回 error', () => {
    const result = parseTextJsonResponse('这不是 JSON');
    expect(result.parsed).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toContain('无法解析');
  });

  it('空字符串返回 error', () => {
    const result = parseTextJsonResponse('');
    expect(result.parsed).toBeNull();
    expect(result.error).toBeDefined();
  });
});

describe('normalizeTextProviderError', () => {
  it('401 返回 API Key 无效提示', () => {
    const err = { status: 401 };
    const msg = normalizeTextProviderError(err);
    expect(msg).toContain('API Key');
    expect(msg).toContain('无效');
  });

  it('网络错误返回连接失败提示', () => {
    const msg = normalizeTextProviderError(new TypeError('Failed to fetch'));
    expect(msg).toContain('网络');
  });

  it('不泄露 API Key', () => {
    const err = { status: 401, message: 'Invalid API key: sk-abc123xyz' };
    const msg = normalizeTextProviderError(err);
    expect(msg).not.toContain('sk-abc123xyz');
    expect(msg).not.toMatch(/sk-/);
  });

  it('一般错误不返回原始服务端信息', () => {
    const msg = normalizeTextProviderError(new Error('服务器繁忙'));
    expect(msg).not.toContain('服务器繁忙');
    expect(msg).toContain('Provider 请求失败');
  });
});
