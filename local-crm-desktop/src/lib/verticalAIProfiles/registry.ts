import type { VerticalProfile } from './types';
import feishuSaasProfile from './profiles/feishuSaas';
import foreignTradeGeoProfile from './profiles/foreignTradeGeo';

export const verticalAIProfilesRegistry = Object.freeze({
  foreign_trade_geo: foreignTradeGeoProfile,
  feishu_saas: feishuSaasProfile,
}) satisfies Readonly<Record<string, VerticalProfile>>;

export type VerticalAIProfileId = keyof typeof verticalAIProfilesRegistry;

export const DEFAULT_VERTICAL_AI_PROFILE_ID: VerticalAIProfileId = 'foreign_trade_geo';

export function listVerticalAIProfiles(): readonly VerticalProfile[] {
  return Object.values(verticalAIProfilesRegistry)
    .toSorted((left, right) => left.identity.id.localeCompare(right.identity.id));
}

export function resolveVerticalAIProfile(
  profileId: string = DEFAULT_VERTICAL_AI_PROFILE_ID,
): VerticalProfile {
  const profile = verticalAIProfilesRegistry[profileId as VerticalAIProfileId];
  if (!profile) throw new Error(`Unknown AI vertical profile: ${profileId}`);
  return profile;
}
