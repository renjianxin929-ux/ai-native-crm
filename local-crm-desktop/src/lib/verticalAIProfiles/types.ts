export interface VerticalProfileIdentity {
  id: string;
  name: string;
  industry: string;
}

export interface VerticalProfile {
  identity: VerticalProfileIdentity;
  domainContext: readonly string[];
  importantSignals: readonly string[];
  promptExtension: string;
  evaluationCriteria: readonly string[];
}

export interface VerticalProfileModule {
  default: VerticalProfile;
}
