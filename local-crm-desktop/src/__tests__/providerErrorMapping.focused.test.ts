import { describe, expect, it } from 'vitest';
import { mapProviderError } from '../lib/productionAi/providerErrorMapping';

describe('provider-error-mapping suite', () => {
  it('maps host and HTTP failure categories without leaking secrets', () => {
    expect(mapProviderError('missing_host_provider').category).toBe('unconfigured');
    expect(mapProviderError('unauthorized').category).toBe('unauthorized');
    expect(mapProviderError('429 rate limit').category).toBe('rate_limited');
    expect(mapProviderError('timeout').category).toBe('timeout');
    expect(mapProviderError('cancelled').category).toBe('cancelled');
    expect(mapProviderError('invalid_schema').category).toBe('invalid_schema');
    expect(mapProviderError({ reason: 'host_provider_request_failed' }).category).toBe('network');
    for (const mapped of [
      mapProviderError('Authorization: Bearer sk-test'),
      mapProviderError('missing_host_provider'),
    ]) {
      expect(mapped.user_message).not.toMatch(/sk-|Bearer|api[_-]?key/i);
      expect(mapped.redacted_code).not.toMatch(/sk-|Bearer/i);
    }
  });
});
