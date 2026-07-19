export type ProviderErrorCategory =
  | 'unconfigured'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'invalid_schema'
  | 'invalid_evidence'
  | 'cancelled'
  | 'response_too_large'
  | 'request_too_large'
  | 'provider_rejected'
  | 'unknown';

export interface MappedProviderError {
  readonly category: ProviderErrorCategory;
  readonly user_message: string;
  readonly retryable: boolean;
  readonly redacted_code: string;
}

const CATEGORY_MESSAGES: Record<ProviderErrorCategory, string> = {
  unconfigured: '大模型当前未配置或不可用，本次未生成 AI 分析。',
  unauthorized: '大模型凭据无效或未授权，本次未生成 AI 分析。',
  rate_limited: '大模型请求频率受限，请稍后再试。',
  timeout: '大模型请求超时，本次未生成 AI 分析。',
  network: '无法连接大模型服务，本次未生成 AI 分析。',
  invalid_schema: '模型输出未通过结构校验，已丢弃，未写入 CRM。',
  invalid_evidence: '模型引用了无效证据，已丢弃，未写入 CRM。',
  cancelled: '已取消本次模型请求。',
  response_too_large: '模型响应超出大小限制，已丢弃。',
  request_too_large: '请求上下文过大，已阻断模型调用。',
  provider_rejected: '大模型服务拒绝了本次请求。',
  unknown: '大模型调用失败，本次未生成 AI 分析。',
};

export function mapProviderError(reason: unknown): MappedProviderError {
  const text = normalizeReason(reason);
  const category = classify(text);
  return {
    category,
    user_message: CATEGORY_MESSAGES[category],
    retryable: category === 'network' || category === 'timeout' || category === 'rate_limited',
    redacted_code: category,
  };
}

function normalizeReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object') {
    const record = reason as Record<string, unknown>;
    if (typeof record.reason === 'string') return record.reason;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.category === 'string') return record.category;
  }
  return String(reason ?? 'unknown');
}

function classify(text: string): ProviderErrorCategory {
  const lower = text.toLowerCase();
  if (/missing_host_provider|unconfigured|not configured|no provider/.test(lower)) return 'unconfigured';
  if (/401|403|unauthorized|forbidden|invalid.?key|authorization/.test(lower)) return 'unauthorized';
  if (/429|rate.?limit/.test(lower)) return 'rate_limited';
  if (/timeout|timed out|deadline/.test(lower)) return 'timeout';
  if (/cancel/.test(lower)) return 'cancelled';
  if (/schema|invalid_json|invalid model output|host_provider_invalid/.test(lower)) return 'invalid_schema';
  if (/evidence/.test(lower)) return 'invalid_evidence';
  if (/too large|size.?limit|response_too_large|request_too_large/.test(lower)) {
    return lower.includes('request') ? 'request_too_large' : 'response_too_large';
  }
  if (/network|fetch failed|connection|host_provider_request_failed/.test(lower)) return 'network';
  if (/rejected|provider_response_rejected/.test(lower)) return 'provider_rejected';
  return 'unknown';
}

/** Formal logging fields — never include secrets, full prompts, or full customer payloads. */
export interface RedactedProviderLog {
  readonly request_id: string;
  readonly provider_kind: string | null;
  readonly model: string | null;
  readonly intent: string;
  readonly latency_ms: number | null;
  readonly token_usage: { prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null } | null;
  readonly success: boolean;
  readonly failure_category: ProviderErrorCategory | null;
}

export function buildRedactedProviderLog(input: RedactedProviderLog): RedactedProviderLog {
  return { ...input };
}
