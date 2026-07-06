import {
  buildModelProviderSandboxResponseEnvelope,
  type FixtureModelProviderTransport,
  type ModelProviderReadOnlySandboxRequest,
  type NormalizedModelProviderReadOnlySandboxRequest,
} from '../modelProviderReadOnlySandboxReadiness';

interface SandboxMessageOptions {
  contains_secret?: boolean;
  contains_pii?: boolean;
  persisted?: boolean;
}

interface SandboxRequestOptions {
  kind?: string;
  input_messages?: ModelProviderReadOnlySandboxRequest['input_messages'];
  allow_network?: boolean;
  allow_db?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  allow_tool_calls?: boolean;
  allow_env_read?: boolean;
  provider_config_resolved?: boolean;
  provider_config_reads_env?: boolean;
  provider_config_contains_secret?: boolean;
  provider_config_usable_for_live_call?: boolean;
}

const FIXTURE_OUTPUT_TEXT_BY_REQUEST_ID: Record<string, string> = {
  MODEL_SANDBOX_FIXTURE_REQUEST_A: 'Read only sandbox fixture response. No CRM state is changed.',
  MODEL_SANDBOX_FIXTURE_REQUEST_B: 'Second deterministic sandbox fixture response. Output remains non executable.',
};

export function buildModelProviderReadOnlySandboxRequestFixtureV1(
  options: SandboxRequestOptions = {},
): ModelProviderReadOnlySandboxRequest {
  return {
    kind: (options.kind ?? 'MODEL_PROVIDER_READ_ONLY_SANDBOX_REQUEST') as 'MODEL_PROVIDER_READ_ONLY_SANDBOX_REQUEST',
    version: 'v1',
    request_id: 'MODEL_SANDBOX_FIXTURE_REQUEST_A',
    provider_kind: 'fixture_provider_v1',
    model_id: 'fixture-model-v1',
    input_messages: options.input_messages ?? [
      buildModelSandboxMessageFixtureV1('system', 'Read only sandbox system instruction.', { persisted: false }),
      buildModelSandboxMessageFixtureV1('user', 'Summarize this fixture-only context.', { persisted: false }),
    ],
    sandbox_context: {
      kind: 'MODEL_SANDBOX_CONTEXT',
      context_only: true,
      source: 'fixture_or_caller_provided',
      reads_database: false,
      writes_database: false,
      from_live_customer_data: false,
      from_secret: false,
      persisted: false,
    },
    safety_policy: {
      kind: 'MODEL_PROVIDER_SANDBOX_SAFETY_POLICY',
      read_only: true,
      allow_network: false,
      allow_db: false,
      allow_runner: false,
      allow_execution: false,
      allow_tool_calls: (options.allow_tool_calls ?? false) as false,
      allow_file_write: false,
      allow_env_read: (options.allow_env_read ?? false) as false,
      redact_secrets: true,
      require_fixture_transport: true,
    },
    provider_config_placeholder: {
      kind: 'MODEL_PROVIDER_CONFIG_PLACEHOLDER',
      placeholder_only: true,
      resolved: (options.provider_config_resolved ?? false) as false,
      contains_secret: (options.provider_config_contains_secret ?? false) as false,
      reads_env: (options.provider_config_reads_env ?? false) as false,
      persisted: false,
      usable_for_live_call: (options.provider_config_usable_for_live_call ?? false) as false,
    },
    caller_provided_only: true,
    read_only: true,
    allow_network: (options.allow_network ?? false) as false,
    allow_db: (options.allow_db ?? false) as false,
    allow_runner: (options.allow_runner ?? false) as false,
    allow_execution: (options.allow_execution ?? false) as false,
  };
}

export function buildModelSandboxMessageFixtureV1(
  role: ModelProviderReadOnlySandboxRequest['input_messages'][number]['role'],
  content: string,
  options: SandboxMessageOptions = {},
): ModelProviderReadOnlySandboxRequest['input_messages'][number] {
  return {
    role,
    content,
    contains_secret: (options.contains_secret ?? false) as false,
    contains_pii: (options.contains_pii ?? false) as false,
    source: 'fixture',
    persisted: (options.persisted ?? false) as false,
  };
}

export function createFixtureModelProviderTransportV1(): FixtureModelProviderTransport {
  return {
    kind: 'FIXTURE_MODEL_PROVIDER_TRANSPORT',
    transport_kind: 'fixture',
    calls_real_provider: false,
    uses_network: false,
    invoke(request: NormalizedModelProviderReadOnlySandboxRequest) {
      const entries = Object.entries(FIXTURE_OUTPUT_TEXT_BY_REQUEST_ID);
      const foundIndex = entries.findIndex(([requestId]) => requestId === request.request_id);
      const index = foundIndex >= 0 ? foundIndex : 0;
      const outputText = entries[index]?.[1] ?? FIXTURE_OUTPUT_TEXT_BY_REQUEST_ID.MODEL_SANDBOX_FIXTURE_REQUEST_A;
      return buildModelProviderSandboxResponseEnvelope(request, index, outputText);
    },
  };
}
