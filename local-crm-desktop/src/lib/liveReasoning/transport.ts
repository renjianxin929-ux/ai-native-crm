import type { LiveReasoningProviderConfig } from './config';

export interface OpenAICompatibleTransport {
  complete(input: { config: LiveReasoningProviderConfig; body: unknown }): Promise<unknown>;
}

/** The sole Stage5 production network boundary. It performs one bounded, non-streaming request. */
export function createOpenAICompatibleTransport(fetchImplementation: typeof fetch = fetch): OpenAICompatibleTransport {
  return {
    async complete({ config, body }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeout_ms);
      try {
        const response = await fetchImplementation(config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api_key}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await readBoundedText(response, config.max_response_bytes);
        if (!response.ok) throw new Error(`Live provider returned HTTP ${response.status}.`);
        return JSON.parse(text);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Live reasoning request timed out.');
        throw error instanceof Error ? new Error(redactTransportError(error.message)) : new Error('Live provider request failed.');
      } finally { clearTimeout(timer); }
    },
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Live provider response exceeded the configured bound.');
  return text;
}

function redactTransportError(message: string): string {
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
}
