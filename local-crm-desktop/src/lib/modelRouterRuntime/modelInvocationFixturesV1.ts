import { buildEvalPassingFixturesV1, buildEvalViolationFixturesV1 } from '../evalDataset/evalCandidateFixturesV1';
import type { ModelRouteCapability } from '../modelRouterReadiness';
import type {
  FixtureModelProviderAdapter,
  ModelInvocationPlan,
  ModelProviderResponse,
} from '../modelRouterRuntimeReadiness';

export const FIXTURE_MODEL_PROVIDER_ADAPTER: FixtureModelProviderAdapter = {
  kind: 'MODEL_PROVIDER_ADAPTER',
  adapter_id: 'fixture_v1',
  not_real_provider: true,
  network_allowed: false,
  represents_real_model: false,
  fixture_only: true,
  declared_capabilities: ['text', 'image'] satisfies ModelRouteCapability[],
  fixture_model_id: 'fixture-model-v1',
  fixture_provider_id: 'fixture_provider_v1',
};

export function getFixtureModelProviderResponse(
  plan: ModelInvocationPlan,
): ModelProviderResponse | null {
  const sampleId = plan.request.eval_sample_id;
  if (!sampleId) return null;

  const fixture = [
    ...buildEvalViolationFixturesV1().filter(candidate => candidate.parse_error),
    ...buildEvalPassingFixturesV1(),
  ].find(candidate => candidate.sample_id === sampleId);

  if (!fixture) return null;

  return {
    kind: 'MODEL_PROVIDER_RESPONSE',
    fixture_source: 'model_invocation_fixture_v1',
    raw_output: fixture.raw_output,
    parsed: fixture.parsed,
    parse_error: fixture.parse_error,
    represents_real_model_output: false,
  };
}
