import { invoke } from '@tauri-apps/api/core';

import type { ModelCapability, ModelProviderKind } from './types';

export interface TrustedHostCapabilityBinding {
  readonly capability: ModelCapability;
  readonly providerKind: ModelProviderKind;
  readonly modelId: string;
  readonly customerId: string;
  readonly contextSnapshotId: string;
  readonly workflowKind: 'customer_intelligence' | 'interaction_intelligence' | 'provider_health';
  readonly profileId: string;
  readonly requestedByUser: true;
}

export interface TrustedHostCapabilityBlockedResult {
  readonly state: 'blocked';
  readonly reason: string;
}

export interface TrustedHostAuthorizationResult {
  readonly state: 'authorized';
  readonly authorizationId: string;
  readonly capability: ModelCapability;
  readonly providerKind: ModelProviderKind;
  readonly modelId: string;
}

export interface TrustedHostTokenUsage {
  readonly promptTokens?: number | null;
  readonly completionTokens?: number | null;
  readonly totalTokens?: number | null;
}

export interface TrustedHostCompletionResult {
  readonly state: 'completed';
  readonly providerKind: ModelProviderKind;
  readonly modelId: string;
  readonly output: unknown;
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly tokenUsage?: TrustedHostTokenUsage | null;
}

export interface TrustedHostProviderHealth {
  readonly capability: string;
  readonly providerKind: string;
  readonly modelId: string;
  readonly status: 'configured' | 'unconfigured' | 'healthy' | 'unhealthy' | 'unauthorized' | 'rate_limited' | 'timeout' | string;
  readonly configured: boolean;
  readonly checkedAt: string;
  readonly detail: string;
}

export interface LegacyCredentialMigrationStatus {
  readonly detected: boolean;
  readonly migrationVersion: string | null;
  readonly state: 'not_detected' | 'detected' | 'migrated' | 'failed';
  readonly checkedAt: string;
}

export type TrustedHostCapabilityResult = TrustedHostCapabilityBlockedResult | TrustedHostAuthorizationResult | TrustedHostCompletionResult;

export function authorizeTrustedHostCapability(
  request: TrustedHostCapabilityBinding,
): Promise<TrustedHostAuthorizationResult> {
  return invoke<TrustedHostAuthorizationResult>('authorize_model_capability', { request });
}

export function executeTrustedHostCapability(input: {
  readonly authorizationId: string;
  readonly binding: TrustedHostCapabilityBinding;
  readonly input: unknown;
}): Promise<TrustedHostCompletionResult> {
  return invoke<TrustedHostCompletionResult>('execute_model_capability', { request: input });
}

/** Explicit user-triggered health probe — never call on page load. */
export function probeTrustedHostProviderHealth(input: {
  readonly capability: ModelCapability;
  readonly providerKind: ModelProviderKind;
}): Promise<TrustedHostProviderHealth> {
  return invoke<TrustedHostProviderHealth>('probe_trusted_host_provider_health', input);
}

/** Configuration status only — does not send a live model completion request. */
export function listTrustedHostProviderStatus(): Promise<TrustedHostProviderHealth[]> {
  return invoke<TrustedHostProviderHealth[]>('list_trusted_host_provider_status');
}

/** Opens an OS-native credential prompt. No secret is returned to or entered in React. */
export function configureTrustedHostCredential(capability: ModelCapability): Promise<TrustedHostProviderHealth> {
  return invoke<TrustedHostProviderHealth>('configure_trusted_host_credential', { capability });
}

export function deleteTrustedHostCredential(capability: ModelCapability): Promise<TrustedHostProviderHealth> {
  return invoke<TrustedHostProviderHealth>('delete_trusted_host_credential', { capability });
}

/** Explicit click only: minimal provider request, no CRM context and no CRM write. */
export function testTrustedHostProviderConnection(capability: ModelCapability): Promise<TrustedHostProviderHealth> {
  return invoke<TrustedHostProviderHealth>('test_trusted_host_provider_connection', { capability });
}

export function inspectLegacyProviderCredentials(): Promise<LegacyCredentialMigrationStatus> {
  return invoke<LegacyCredentialMigrationStatus>('inspect_legacy_provider_credentials');
}

export function migrateLegacyProviderCredentials(): Promise<LegacyCredentialMigrationStatus> {
  return invoke<LegacyCredentialMigrationStatus>('migrate_legacy_provider_credentials');
}

export function cancelTrustedHostRequest(requestId: string): Promise<boolean> {
  return invoke<boolean>('cancel_trusted_host_request', { requestId });
}
