import type { ReasoningProvider } from '../salesAgent/provider';
import type { SalesAgentReasoningRequest } from '../salesAgent/types';
import type { LiveReasoningProviderConfig } from './config';
import type { OpenAICompatibleTransport } from './transport';

export function createLiveReasoningProvider(input: { id: string; config: LiveReasoningProviderConfig; transport: OpenAICompatibleTransport }): ReasoningProvider {
  if (!input.id.trim() || !input.config.model_id.trim()) throw new Error('Live reasoning provider identity is required.');
  return {
    id: input.id,
    capability: { providerKind: input.config.provider_kind, modelIdentifier: input.config.model_id, executionMode: 'LIVE', networkAccess: true, environmentAccess: false, liveEnabled: true },
    async reason(request) {
      return extractStructuredResult(await input.transport.complete({ config: input.config, body: buildOpenAICompatibleRequest(request, input.config.model_id) }));
    },
  };
}

function buildOpenAICompatibleRequest(request: SalesAgentReasoningRequest, model: string): object {
  return {
    model,
    stream: false,
    temperature: 0,
    messages: [{ role: 'system', content: 'Return only JSON matching the required schema. Never claim execution, CRM writes, or automatic actions.' }, { role: 'user', content: JSON.stringify({ objective: request.objective, context: request.context, vertical_profile: request.vertical_profile, required_schema: 'AIReasoningResult v1 with evidence and decision_basis', safety: { human_review_required: true, executable: false, writes_crm: false } }) }],
  };
}

function extractStructuredResult(payload: unknown): unknown {
  if (!isRecord(payload)) throw new Error('Live provider returned an invalid response envelope.');
  const choices = payload.choices;
  const first = Array.isArray(choices) ? choices[0] : null;
  const content = isRecord(first) && isRecord(first.message) ? first.message.content : null;
  if (typeof content !== 'string') throw new Error('Live provider returned no structured content.');
  try { return JSON.parse(content); } catch { throw new Error('Live provider returned invalid structured JSON.'); }
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null; }
