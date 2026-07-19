/**
 * Typed user-facing error / result formatting boundary for Sales Agent UI.
 * Never renders raw objects, secrets, or stack traces in normal mode.
 */

const SECRET_PATTERN =
  /(authorization|api[_-]?key|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]+|password|secret|token)/i;

export interface FormattedUserFacingError {
  readonly message: string;
  readonly developer_detail?: string;
}

function redact(text: string): string {
  return text.replace(SECRET_PATTERN, '[redacted]');
}

function fromUnknownObject(value: Record<string, unknown>): string {
  const preferred = ['message', 'error', 'reason', 'detail', 'msg'] as const;
  for (const key of preferred) {
    const entry = value[key];
    if (typeof entry === 'string' && entry.trim()) return redact(entry.trim());
    if (entry instanceof Error) return redact(entry.message);
  }
  if (typeof value.code === 'string' && value.code.trim()) {
    return redact(`操作失败（${value.code.trim()}）`);
  }
  try {
    const json = JSON.stringify(value);
    if (json && json !== '{}' && json.length < 240) return redact(json);
  } catch {
    /* ignore */
  }
  return '发生未知错误，请重试或查看高级模式详情。';
}

/**
 * Format any thrown / blocked / invoke payload into a Chinese user-facing string.
 * Guarantees the return value is never the literal "[object Object]".
 */
export function formatUserFacingError(cause: unknown, options?: { readonly advanced?: boolean }): FormattedUserFacingError {
  let message: string;
  let developer_detail: string | undefined;

  if (cause instanceof Error) {
    message = cause.message.trim() || '操作失败。';
    if (options?.advanced && cause.stack) {
      developer_detail = redact(cause.stack.split('\n').slice(0, 4).join('\n'));
    }
  } else if (typeof cause === 'string') {
    message = cause.trim() || '操作失败。';
  } else if (cause == null) {
    message = '发生未知错误。';
  } else if (typeof cause === 'object') {
    message = fromUnknownObject(cause as Record<string, unknown>);
    if (options?.advanced) {
      try {
        developer_detail = redact(JSON.stringify(cause));
      } catch {
        developer_detail = 'unserializable error object';
      }
    }
  } else {
    message = String(cause);
  }

  message = redact(message);
  if (message === '[object Object]' || message === '[object object]') {
    message = '发生未知错误，请重试或查看高级模式详情。';
  }

  // Prefer Chinese surface for common English session blocks / internal codes
  if (message === 'A message is required.') message = '请输入销售问题或客户名称。';
  if (message === 'Sales Agent production dependencies are not configured.') {
    message = 'Sales Agent 生产依赖未配置。';
  }
  if (/Unknown or modified session-owned write proposal/i.test(message)) {
    message = '这项待确认操作已经失效，请重新生成后再确认。';
  }
  if (/Confirmation replay rejected/i.test(message)) {
    message = '该操作已经处理过，未再次写入。';
  }
  if (/Confirmation does not match the exact proposal/i.test(message)) {
    message = '确认信息与待确认操作不一致，请重新生成后再确认。';
  }
  if (/Write proposal identity is invalid/i.test(message)) {
    message = '待确认操作无效，请重新生成。';
  }
  if (/Trusted-host adapter is blocked/i.test(message)) {
    message = '当前未配置可用的分析服务，请检查设置后再试。';
  }
  if (/Capture source is required/i.test(message)) {
    message = '请先粘贴文本或选择图片后再分析。';
  }
  if (/^cancelled$/i.test(message)) {
    message = '已取消本次模型请求。';
  }

  return developer_detail ? { message, developer_detail } : { message };
}

/** Convenience for JSX text nodes — never returns "[object Object]". */
export function formatUserFacingErrorMessage(cause: unknown, advanced = false): string {
  const formatted = formatUserFacingError(cause, { advanced });
  return formatted.message;
}
