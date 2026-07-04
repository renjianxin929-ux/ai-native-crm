import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PROMPT_RUNTIME_VERSION,
  buildPromptRuntimePlan,
  buildPromptRuntimePlanFromEvalSample,
  buildPromptRuntimeTrace,
  type PromptRuntimePurpose,
} from '../lib/promptRuntimeReadiness';
import { getActiveVerticalProfile } from '../lib/verticalProfiles';

const PURPOSES: PromptRuntimePurpose[] = [
  'wechat_screenshot',
  'call_transcript',
  'next_action_suggestion',
];

function requestFor(purpose: PromptRuntimePurpose) {
  return {
    purpose,
    profile_id: 'default_geo_export',
    context: {
      screenshot_note: 'Wechat chat contains a cautious buyer reply.',
      screenshot_base64: 'BASE64_SHOULD_NOT_APPEAR',
      transcript: '客户说可以下周三上午再沟通，但还没有预算。',
      customer: {
        name: 'EVAL_SAMPLE_CUSTOMER',
        customer_grade: 'C',
        stage: 'NEW_LEAD',
        intent_level: 'LOW',
        phone_feedback: 'UNKNOWN',
        wechat_add_status: 'NOT_ADDED',
        phone_number: '',
        wechat_id: '',
        contact_person: '',
        website: '',
        industry: '',
        source: 'eval',
        notes: '信息不足',
      },
      recent_notes: ['首次导入，还未人工复核'],
    },
  } as const;
}

describe('Prompt Runtime readiness gate', () => {
  it('builds non-executable prompt runtime plans for every supported purpose', () => {
    const profile = getActiveVerticalProfile();

    for (const purpose of PURPOSES) {
      const plan = buildPromptRuntimePlan(requestFor(purpose), profile);

      expect(PROMPT_RUNTIME_VERSION).toBe('v1');
      expect(plan).toMatchObject({
        kind: 'PROMPT_RUNTIME_PLAN',
        runtime_version: 'v1',
        executable: false,
        persisted: false,
        reason: 'prompt_runtime_readiness_only',
        purpose,
        profile_id: profile.key,
      });
      expect(plan.prompt_id).toMatch(new RegExp(`^${profile.key}:aiDraft\\.`));
      expect(plan.prompt_version).toBe('readiness-v1');
      expect(plan.route).toMatchObject({
        kind: 'NOOP_MODEL_ROUTE',
        executable: false,
        status: 'not_configured',
        reason: 'router_readiness_only',
        selected_model_id: null,
        selected_provider: null,
      });
      expect(plan.rendered_prompts.length).toBeGreaterThan(0);
      expect(plan.output_contract.expected_format.trim().length).toBeGreaterThan(0);
      expect(plan.output_contract.schema_ref.trim().length).toBeGreaterThan(0);
      expect(plan.output_contract.required_fields.length).toBeGreaterThan(0);
      expect(plan.output_contract.evidence_field).toBeTruthy();
      expect(plan.output_contract.confidence_field).toBeTruthy();
      expect(plan.safety).toMatchObject({
        non_executing: true,
        no_side_effects: true,
        requires_human_review_before_apply: true,
        represents_model_call: false,
      });
      expect(plan.safety.forbidden_result_phrases).toEqual(expect.arrayContaining([
        '已发送',
        '已执行',
        '已更新客户',
        '已写入 CRM',
        '自动创建客户',
        '自动升级等级',
      ]));
    }
  });

  it('renders wechat screenshot prompt text without embedding image bytes or calling multimodal runtime', () => {
    const profile = getActiveVerticalProfile();
    const plan = buildPromptRuntimePlan(requestFor('wechat_screenshot'), profile);
    const renderedText = plan.rendered_prompts.map(prompt => prompt.content).join('\n');

    expect(plan.route.purpose).toBe('wechat_screenshot_analysis');
    expect(plan.route.required_capabilities).toEqual(['image', 'text']);
    expect(plan.rendered_prompts.map(prompt => prompt.role)).toEqual(['user']);
    expect(renderedText).toContain('微信');
    expect(renderedText).not.toContain('BASE64_SHOULD_NOT_APPEAR');
    expect(plan.rendered_prompts[0]).toMatchObject({
      kind: 'RENDERED_PROMPT',
      role: 'user',
      prompt_id: plan.prompt_id,
      prompt_version: plan.prompt_version,
      profile_id: profile.key,
      rendered_from: 'prompt_registry',
      represents_model_output: false,
    });
  });

  it('renders call transcript system and user prompts from registry definitions', () => {
    const profile = getActiveVerticalProfile();
    const plan = buildPromptRuntimePlan(requestFor('call_transcript'), profile);

    expect(plan.route.purpose).toBe('call_transcript_analysis');
    expect(plan.route.required_capabilities).toEqual(['text']);
    expect(plan.rendered_prompts.map(prompt => prompt.role)).toEqual(['system', 'user']);
    expect(plan.rendered_prompts[0].content).toBe(profile.aiDraft.callTranscriptSystemPrompt);
    expect(plan.rendered_prompts[1].content).toContain('客户说可以下周三上午再沟通');
    expect(plan.rendered_prompts.every(prompt => prompt.rendered_from === 'prompt_registry')).toBe(true);
  });

  it('renders next action context with a pure context block and no final action claim', () => {
    const profile = getActiveVerticalProfile();
    const plan = buildPromptRuntimePlan(requestFor('next_action_suggestion'), profile);
    const userPrompt = plan.rendered_prompts.find(prompt => prompt.role === 'user')?.content ?? '';

    expect(plan.route.purpose).toBe('next_action_suggestion');
    expect(plan.route.required_capabilities).toEqual(['text']);
    expect(plan.rendered_prompts.map(prompt => prompt.role)).toEqual(['system', 'user']);
    expect(plan.rendered_prompts[0].content).toBe(profile.aiDraft.nextActionSuggestion.systemPrompt);
    expect(userPrompt).toContain('客户名称: EVAL_SAMPLE_CUSTOMER');
    expect(userPrompt).toContain('最近备注: 首次导入，还未人工复核');
    expect(userPrompt).toContain('请基于以上 CRM 字段给出短行动建议。');
    expect(userPrompt).not.toContain('已更新客户');
  });

  it('builds an audit trace with input digest but no database write semantics', () => {
    const profile = getActiveVerticalProfile();
    const request = requestFor('call_transcript');
    const trace = buildPromptRuntimeTrace(request, profile);

    expect(trace.kind).toBe('PROMPT_RUNTIME_TRACE');
    expect(trace.request).toEqual(request);
    expect(trace.plan).toEqual(buildPromptRuntimePlan(request, profile));
    expect(trace.input_material_digest).toMatchObject({
      kind: 'INPUT_MATERIAL_DIGEST',
      persisted: false,
      writes_database: false,
      source: 'request_context',
    });
    expect(trace.input_material_digest.fields).toEqual(expect.arrayContaining([
      'transcript',
      'customer',
      'recent_notes',
    ]));
  });

  it('can derive a readiness plan from an eval sample without running the eval runner', () => {
    const profile = getActiveVerticalProfile();
    const plan = buildPromptRuntimePlanFromEvalSample({
      sample_id: 'EVAL_V1_PROMPT_RUNTIME',
      source_type: 'call_transcript',
      raw_input: 'EVAL_V1 transcript body',
      context: {},
    }, profile);

    expect(plan.purpose).toBe('call_transcript');
    expect(plan.eval_sample_id).toBe('EVAL_V1_PROMPT_RUNTIME');
    expect(plan.rendered_prompts.map(prompt => prompt.content).join('\n')).toContain('EVAL_V1 transcript body');
  });

  it('keeps prompt runtime source free of execution, storage, providers, agents, and fake results', () => {
    const source = readFileSync('src/lib/promptRuntimeReadiness.ts', 'utf8');
    const forbiddenTerms = [
      'fetch(',
      'axios',
      'process.env',
      'import.meta.env',
      'API_KEY',
      'apiKey',
      'OpenAI',
      'DeepSeek',
      'Qwen',
      'Claude',
      'Gemini',
      'Ollama',
      'textAIProvider',
      'multimodalProvider',
      'analyzeWechatScreenshot',
      'analyzeCallTranscript',
      'CREATE TABLE',
      'agent',
      'voice',
      'tool_call',
      'sendMessage',
      '已发送',
      '已执行',
      '已更新客户',
      '已写入 CRM',
    ];

    for (const term of forbiddenTerms) {
      expect(source).not.toContain(term);
    }
  });

  it('does not modify existing runtime, eval, UI, database, schema, state-machine, or provider files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean);
    const forbiddenFiles = [
      'src/lib/aiRuntimeReadiness.ts',
      'src/lib/evalRunnerReadiness.ts',
      'src/lib/evalDatasetReadiness.ts',
      'src/lib/evalDataset/salesAiEvalDatasetV1.ts',
      'src/lib/evalDataset/evalCandidateFixturesV1.ts',
      'src/lib/aiDraft.ts',
      'src/lib/promptRegistryReadiness.ts',
      'src/lib/modelRouterReadiness.ts',
      'src/lib/leadWorkbench/syncAdapter.ts',
      'src/lib/leadWorkbench/stateMachine.ts',
      'src/lib/leadWorkbench/schema.ts',
      'src/lib/db.ts',
      'src/lib/textAIProvider.ts',
      'src/lib/multimodalProvider.ts',
    ];

    expect(changedFiles.filter(file => forbiddenFiles.includes(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
  });
});
