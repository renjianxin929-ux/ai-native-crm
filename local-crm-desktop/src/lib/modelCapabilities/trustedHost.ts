import { invoke } from '@tauri-apps/api/core';

import type { ModelCapability, ModelProviderKind } from './types';

export interface TrustedHostCapabilityBinding {
  readonly capability: ModelCapability;
  readonly providerKind: ModelProviderKind;
  readonly modelId: string;
  readonly customerId: string;
  readonly contextSnapshotId: string;
  readonly workflowKind: 'customer_intelligence' | 'interaction_intelligence';
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

export interface TrustedHostCompletionResult {
  readonly state: 'completed';
  readonly providerKind: ModelProviderKind;
  readonly modelId: string;
  readonly output: unknown;
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
  return invoke<TrustedHostCompletionResult>('execute_model_capability', input);
}
