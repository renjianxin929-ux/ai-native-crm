import { STAGE2_EVALUATION_FIXTURES } from '../eval/fixtures';

export interface SalesAgentEvaluationFixture {
  case_id: string;
  profile_id: string;
  objective: string;
  context: (typeof STAGE2_EVALUATION_FIXTURES)[number]['context'];
  minimum_evidence_coverage: number;
}

export const SALES_AGENT_EVALUATION_FIXTURES: readonly SalesAgentEvaluationFixture[] =
  STAGE2_EVALUATION_FIXTURES.map((fixture, index) => ({
    case_id: `sales-agent-eval-${index + 1}`,
    profile_id: fixture.profile.identity.id,
    objective: 'Produce an evidence-backed sales assessment for human review.',
    context: fixture.context,
    minimum_evidence_coverage: 1,
  }));

