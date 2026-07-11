/**
 * The frontend intentionally has no live-provider configuration. Endpoints,
 * models and credentials are resolved only by the trusted native host.
 */
export const LIVE_REASONING_CONFIGURATION_OWNER = 'trusted_native_host' as const;
