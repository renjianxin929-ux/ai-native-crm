import type { VerticalProfile } from '../types';

const feishuSaasProfile = {
  identity: {
    id: 'feishu_saas',
    name: 'Feishu SaaS',
    industry: 'enterprise-collaboration',
  },
  domainContext: [
    'Enterprise digitalization and collaboration modernization',
    'Organization efficiency and responsible AI adoption',
  ],
  importantSignals: [
    'cross-team collaboration friction',
    'organization efficiency initiative',
    'enterprise AI adoption signal',
  ],
  promptExtension: 'Prioritize evidenced digitalization, collaboration, organization-efficiency, and AI-adoption signals.',
  evaluationCriteria: [
    'Suggestions identify the observed organization signal',
    'AI adoption is not inferred without evidence',
    'Recommendations remain human-reviewed and non-executable',
  ],
} satisfies VerticalProfile;

export default feishuSaasProfile;
