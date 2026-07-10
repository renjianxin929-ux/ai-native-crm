import type { VerticalProfile } from '../types';

const foreignTradeGeoProfile = {
  identity: {
    id: 'foreign_trade_geo',
    name: 'Foreign Trade GEO',
    industry: 'overseas-growth',
  },
  domainContext: [
    'Global expansion and foreign-trade customer development',
    'Generative-engine and AI-search discoverability',
  ],
  importantSignals: [
    'overseas market intent',
    'AI search visibility gap',
    'qualified international lead signal',
  ],
  promptExtension: 'Prioritize evidenced GEO, overseas-growth, AI-search visibility, and lead signals.',
  evaluationCriteria: [
    'Every claim is tied to CRM evidence',
    'Recommendations distinguish visibility signals from verified demand',
    'Low-evidence leads remain explicitly uncertain',
  ],
} satisfies VerticalProfile;

export default foreignTradeGeoProfile;
