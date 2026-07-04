import {
  buildNoopModelRoute,
  type ModelRoutePurpose,
  type NoopModelRoute,
} from './modelRouterReadiness';
import {
  buildPromptRegistryDefinitions,
  renderPromptRegistryDefinition,
  type PromptRegistryDefinition,
} from './promptRegistryReadiness';
import type { VerticalRuleProfile } from './verticalProfiles';

export const PROMPT_RUNTIME_VERSION = 'v1';

export type PromptRuntimePurpose =
  | 'wechat_screenshot'
  | 'call_transcript'
  | 'next_action_suggestion';

export interface PromptRuntimeContext {
  screenshot_note?: string;
  screenshot_base64?: string;
  transcript?: string;
  customer?: Readonly<Record<string, string | number | null | undefined>>;
  recent_notes?: readonly string[];
  raw_input?: string;
}

export interface PromptRuntimeRequest {
  purpose: PromptRuntimePurpose;
  profile_id: string;
  context: PromptRuntimeContext;
}

export interface RenderedPrompt {
  kind: 'RENDERED_PROMPT';
  role: 'system' | 'user';
  prompt_id: string;
  prompt_version: 'readiness-v1';
  profile_id: string;
  content: string;
  rendered_from: 'prompt_registry' | 'request_context';
  represents_model_output: false;
}

export interface PromptOutputContract {
  expected_format: string;
  schema_ref: 'ScreenshotAnalysis' | 'CallAnalysis' | 'NextActionSuggestionText';
  required_fields: readonly string[];
  evidence_field: string;
  confidence_field: string;
}

export interface PromptRuntimeSafety {
  non_executing: true;
  no_side_effects: true;
  requires_human_review_before_apply: true;
  represents_model_call: false;
  forbidden_result_phrases: readonly string[];
}

export interface PromptRuntimePlan {
  kind: 'PROMPT_RUNTIME_PLAN';
  runtime_version: typeof PROMPT_RUNTIME_VERSION;
  executable: false;
  persisted: false;
  reason: 'prompt_runtime_readiness_only';
  purpose: PromptRuntimePurpose;
  profile_id: string;
  prompt_id: string;
  prompt_version: 'readiness-v1';
  route: NoopModelRoute;
  rendered_prompts: readonly RenderedPrompt[];
  output_contract: PromptOutputContract;
  safety: PromptRuntimeSafety;
  eval_sample_id?: string;
}

export interface PromptRuntimeInputMaterialDigest {
  kind: 'INPUT_MATERIAL_DIGEST';
  source: 'request_context';
  fields: readonly string[];
  character_counts: Readonly<Record<string, number>>;
  persisted: false;
  writes_database: false;
}

export interface PromptRuntimeTrace {
  kind: 'PROMPT_RUNTIME_TRACE';
  request: PromptRuntimeRequest;
  plan: PromptRuntimePlan;
  input_material_digest: PromptRuntimeInputMaterialDigest;
}

interface EvalPromptRuntimeSample {
  sample_id: string;
  source_type: PromptRuntimePurpose;
  raw_input: string;
  context?: Readonly<Record<string, string>>;
}

const routePurposeByPromptPurpose: Record<PromptRuntimePurpose, ModelRoutePurpose> = {
  wechat_screenshot: 'wechat_screenshot_analysis',
  call_transcript: 'call_transcript_analysis',
  next_action_suggestion: 'next_action_suggestion',
};

const capabilitiesByPromptPurpose: Record<PromptRuntimePurpose, NoopModelRoute['required_capabilities']> = {
  wechat_screenshot: ['image', 'text'],
  call_transcript: ['text'],
  next_action_suggestion: ['text'],
};

export function buildPromptRuntimePlan(
  request: PromptRuntimeRequest,
  profile: VerticalRuleProfile,
): PromptRuntimePlan {
  const definitions = buildPromptRegistryDefinitions(profile);
  const mainDefinition = findDefinition(definitions, request.purpose);
  const route = buildNoopModelRoute({
    purpose: routePurposeByPromptPurpose[request.purpose],
    prompt_id: mainDefinition.prompt_id,
    required_capabilities: capabilitiesByPromptPurpose[request.purpose],
  });

  return {
    kind: 'PROMPT_RUNTIME_PLAN',
    runtime_version: PROMPT_RUNTIME_VERSION,
    executable: false,
    persisted: false,
    reason: 'prompt_runtime_readiness_only',
    purpose: request.purpose,
    profile_id: profile.key,
    prompt_id: mainDefinition.prompt_id,
    prompt_version: mainDefinition.prompt_version,
    route,
    rendered_prompts: buildRenderedPrompts(request, profile, definitions, mainDefinition),
    output_contract: outputContractFor(request.purpose),
    safety: buildPromptRuntimeSafety(),
  };
}

export function buildPromptRuntimeTrace(
  request: PromptRuntimeRequest,
  profile: VerticalRuleProfile,
): PromptRuntimeTrace {
  return {
    kind: 'PROMPT_RUNTIME_TRACE',
    request,
    plan: buildPromptRuntimePlan(request, profile),
    input_material_digest: buildInputMaterialDigest(request.context),
  };
}

export function buildPromptRuntimePlanFromEvalSample(
  sample: EvalPromptRuntimeSample,
  profile: VerticalRuleProfile,
): PromptRuntimePlan {
  const request: PromptRuntimeRequest = {
    purpose: sample.source_type,
    profile_id: profile.key,
    context: {
      raw_input: sample.raw_input,
      transcript: sample.source_type === 'call_transcript' ? sample.raw_input : undefined,
      screenshot_note: sample.source_type === 'wechat_screenshot' ? sample.raw_input : undefined,
      customer: sample.source_type === 'next_action_suggestion' ? sample.context ?? { notes: sample.raw_input } : undefined,
    },
  };

  return {
    ...buildPromptRuntimePlan(request, profile),
    eval_sample_id: sample.sample_id,
  };
}

function buildRenderedPrompts(
  request: PromptRuntimeRequest,
  profile: VerticalRuleProfile,
  definitions: readonly PromptRegistryDefinition[],
  mainDefinition: PromptRegistryDefinition,
): RenderedPrompt[] {
  if (request.purpose === 'call_transcript') {
    const systemDefinition = findDefinition(definitions, 'call_transcript_system');
    return [
      fromRegistry(systemDefinition, 'system', renderPromptRegistryDefinition(systemDefinition)),
      fromRegistry(mainDefinition, 'user', renderPromptRegistryDefinition(mainDefinition, {
        transcript: request.context.transcript ?? request.context.raw_input ?? '',
      })),
    ];
  }

  if (request.purpose === 'next_action_suggestion') {
    return [
      fromRegistry(mainDefinition, 'system', renderPromptRegistryDefinition(mainDefinition)),
      {
        kind: 'RENDERED_PROMPT',
        role: 'user',
        prompt_id: mainDefinition.prompt_id,
        prompt_version: mainDefinition.prompt_version,
        profile_id: profile.key,
        content: buildNextActionContextPrompt(request.context, profile),
        rendered_from: 'request_context',
        represents_model_output: false,
      },
    ];
  }

  return [
    fromRegistry(mainDefinition, 'user', renderPromptRegistryDefinition(mainDefinition)),
  ];
}

function fromRegistry(
  definition: PromptRegistryDefinition,
  role: RenderedPrompt['role'],
  content: string,
): RenderedPrompt {
  return {
    kind: 'RENDERED_PROMPT',
    role,
    prompt_id: definition.prompt_id,
    prompt_version: definition.prompt_version,
    profile_id: definition.profile_id,
    content,
    rendered_from: 'prompt_registry',
    represents_model_output: false,
  };
}

function findDefinition(
  definitions: readonly PromptRegistryDefinition[],
  purpose: PromptRegistryDefinition['purpose'],
): PromptRegistryDefinition {
  const definition = definitions.find(item => item.purpose === purpose);
  if (!definition) {
    throw new Error(`Missing prompt definition for ${purpose}`);
  }
  return definition;
}

function outputContractFor(purpose: PromptRuntimePurpose): PromptOutputContract {
  if (purpose === 'wechat_screenshot') {
    return {
      expected_format: 'json',
      schema_ref: 'ScreenshotAnalysis',
      required_fields: [
        'customer_name',
        'reply_status',
        'intent_level',
        'grade_suggestion',
        'next_action',
        'evidence',
        'confidence',
      ],
      evidence_field: 'evidence',
      confidence_field: 'confidence',
    };
  }

  if (purpose === 'call_transcript') {
    return {
      expected_format: 'json',
      schema_ref: 'CallAnalysis',
      required_fields: [
        'summary',
        'phone_feedback',
        'intent_level',
        'grade_suggestion',
        'next_action',
        'risk',
        'confidence',
      ],
      evidence_field: 'risk',
      confidence_field: 'confidence',
    };
  }

  return {
    expected_format: 'plain_text',
    schema_ref: 'NextActionSuggestionText',
    required_fields: [
      'short_suggestions',
      'risk_boundary',
      'human_review',
    ],
    evidence_field: 'context_block',
    confidence_field: 'human_review_required',
  };
}

function buildPromptRuntimeSafety(): PromptRuntimeSafety {
  return {
    non_executing: true,
    no_side_effects: true,
    requires_human_review_before_apply: true,
    represents_model_call: false,
    forbidden_result_phrases: [
      ['已', '发送'].join(''),
      ['已', '执行'].join(''),
      ['已更新', '客户'].join(''),
      ['已写入', ' CRM'].join(''),
      ['自动', '创建客户'].join(''),
      ['自动', '升级等级'].join(''),
    ],
  };
}

function buildNextActionContextPrompt(
  context: PromptRuntimeContext,
  profile: VerticalRuleProfile,
): string {
  const policy = profile.aiDraft.nextActionSuggestion;
  const labels = policy.contextLabels;
  const customer = context.customer ?? {};
  const emptyValue = policy.emptyValue;
  const rows = [
    [labels.customerName, pick(customer, 'name', 'customerName')],
    [labels.customerGrade, pick(customer, 'customer_grade', 'customerGrade')],
    [labels.stage, pick(customer, 'stage')],
    [labels.intentLevel, pick(customer, 'intent_level', 'intentLevel')],
    [labels.phoneFeedback, pick(customer, 'phone_feedback', 'phoneFeedback')],
    [labels.wechatAddStatus, pick(customer, 'wechat_add_status', 'wechatAddStatus')],
    [labels.phoneNumber, pick(customer, 'phone_number', 'phoneNumber')],
    [labels.wechatId, pick(customer, 'wechat_id', 'wechatId')],
    [labels.contactPerson, pick(customer, 'contact_person', 'contactPerson')],
    [labels.website, pick(customer, 'website')],
    [labels.industry, pick(customer, 'industry')],
    [labels.source, pick(customer, 'source')],
    [labels.notes, pick(customer, 'notes')],
    [labels.recentNotes, (context.recent_notes ?? []).join('; ')],
  ].map(([label, value]) => `${label}: ${formatContextValue(value, emptyValue)}`);

  return [
    ...rows,
    ...policy.instructionLines,
  ].join('\n');
}

function pick(
  values: Readonly<Record<string, string | number | null | undefined>>,
  ...keys: readonly string[]
): string | number | null | undefined {
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function formatContextValue(value: string | number | null | undefined, emptyValue: string): string {
  if (value === null || value === undefined) return emptyValue;
  const text = String(value).trim();
  return text.length > 0 ? text : emptyValue;
}

function buildInputMaterialDigest(context: PromptRuntimeContext): PromptRuntimeInputMaterialDigest {
  const fields = Object.keys(context)
    .filter(key => !key.toLowerCase().includes('base64'))
    .sort();
  const characterCounts = Object.fromEntries(fields.map(field => [
    field,
    String(context[field as keyof PromptRuntimeContext] ?? '').length,
  ]));

  return {
    kind: 'INPUT_MATERIAL_DIGEST',
    source: 'request_context',
    fields,
    character_counts: characterCounts,
    persisted: false,
    writes_database: false,
  };
}
