import { DeepSeekCompatibleProvider, QwenVisionCompatibleProvider } from './providers';
import type { CapabilityProvider, ModelCapability, ModelProviderKind } from './types';

export type RegisteredCapabilityProvider = CapabilityProvider<unknown, unknown>;

export interface CapabilityProviderRequest {
  readonly capability: ModelCapability;
  readonly providerKind: ModelProviderKind;
}

export class CapabilityProviderRegistry {
  private readonly providers: readonly RegisteredCapabilityProvider[];

  constructor(providers: readonly RegisteredCapabilityProvider[]) {
    const identities = new Set<string>();
    for (const provider of providers) {
      const identity = `${provider.capability}:${provider.providerKind}`;
      if (identities.has(identity)) throw new Error(`Duplicate capability provider registration: ${identity}.`);
      identities.add(identity);
    }
    this.providers = [...providers];
  }

  resolve(request: CapabilityProviderRequest): RegisteredCapabilityProvider {
    const provider = this.providers.find(candidate => (
      candidate.capability === request.capability
      && candidate.providerKind === request.providerKind
    ));
    if (!provider) throw new Error(`No provider registered for ${request.capability}:${request.providerKind}.`);
    return provider;
  }

  list(): readonly RegisteredCapabilityProvider[] {
    return this.providers;
  }
}

export function createCapabilityProviderRegistry(): CapabilityProviderRegistry {
  return new CapabilityProviderRegistry([
    new DeepSeekCompatibleProvider(),
    new QwenVisionCompatibleProvider(),
  ]);
}
