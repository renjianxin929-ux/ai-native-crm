import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { hasExactModelCapabilitiesPhase13ChangedFileSet } from './modelCapabilitiesChangedFileCohort';

import { listSalesAiEvalDatasetV1, type SalesAiEvalSampleV1 } from '../lib/evalDatasetReadiness';
import {
  MODEL_ROUTER_RUNTIME_VERSION,
  buildModelInvocationPlan,
  invokeWithFixtureAdapter,
  matchRouteCapabilities,
  modelInvocationResultToEvalCandidateOutput,
} from '../lib/modelRouterRuntimeReadiness';
import { FIXTURE_MODEL_PROVIDER_ADAPTER } from '../lib/modelRouterRuntime/modelInvocationFixturesV1';
import { buildPromptRuntimePlanFromEvalSample } from '../lib/promptRuntimeReadiness';
import { getActiveVerticalProfile } from '../lib/verticalProfiles';

function sampleFor(sourceType: SalesAiEvalSampleV1['source_type']) {
  const sample = listSalesAiEvalDatasetV1().find(item => item.source_type === sourceType);
  if (!sample) throw new Error(`Missing eval sample for ${sourceType}`);
  return sample;
}

function sampleById(sampleId: string) {
  const sample = listSalesAiEvalDatasetV1().find(item => item.sample_id === sampleId);
  if (!sample) throw new Error(`Missing eval sample ${sampleId}`);
  return sample;
}

function promptPlanFor(sample: SalesAiEvalSampleV1) {
  return buildPromptRuntimePlanFromEvalSample(sample, getActiveVerticalProfile());
}

function invocationPlanFor(sample: SalesAiEvalSampleV1) {
  return buildModelInvocationPlan(promptPlanFor(sample), FIXTURE_MODEL_PROVIDER_ADAPTER);
}

describe('Model Router Runtime Adapter readiness gate', () => {
  it('declares a fixture-only provider adapter, not a real model selection', () => {
    expect(MODEL_ROUTER_RUNTIME_VERSION).toBe('v1');
    expect(FIXTURE_MODEL_PROVIDER_ADAPTER).toMatchObject({
      kind: 'MODEL_PROVIDER_ADAPTER',
      adapter_id: 'fixture_v1',
      not_real_provider: true,
      network_allowed: false,
      represents_real_model: false,
      fixture_only: true,
      fixture_model_id: 'fixture-model-v1',
      fixture_provider_id: 'fixture_provider_v1',
    });
    expect(FIXTURE_MODEL_PROVIDER_ADAPTER.declared_capabilities.length).toBeGreaterThan(0);
    expect(FIXTURE_MODEL_PROVIDER_ADAPTER).not.toHaveProperty('selected_model_id');
    expect(FIXTURE_MODEL_PROVIDER_ADAPTER).not.toHaveProperty('selected_provider');
  });

  it('builds non-executable invocation plans from PromptRuntimePlan without mutating it', () => {
    const promptPlan = promptPlanFor(sampleFor('wechat_screenshot'));
    const before = JSON.stringify(promptPlan);
    const plan = buildModelInvocationPlan(promptPlan, FIXTURE_MODEL_PROVIDER_ADAPTER);

    expect(JSON.stringify(promptPlan)).toBe(before);
    expect(plan).toMatchObject({
      kind: 'MODEL_INVOCATION_PLAN',
      runtime_version: 'v1',
      executable: false,
      fixture_execution_allowed: true,
      persisted: false,
      reason: 'model_router_runtime_readiness_only',
      prompt_plan: promptPlan,
      route_snapshot: {
        kind: 'NOOP_MODEL_ROUTE',
        executable: false,
        status: 'not_configured',
        selected_model_id: null,
        selected_provider: null,
      },
    });
    expect(plan.capability_match.matched).toBe(true);
    expect(plan.capability_errors).toEqual([]);
  });

  it('matches route capabilities without turning mismatches into provider errors', () => {
    const route = promptPlanFor(sampleFor('wechat_screenshot')).route;
    const match = matchRouteCapabilities(route, FIXTURE_MODEL_PROVIDER_ADAPTER);
    const mismatch = matchRouteCapabilities(route, {
      ...FIXTURE_MODEL_PROVIDER_ADAPTER,
      declared_capabilities: ['text'],
    });

    expect(match).toEqual({
      matched: true,
      required_capabilities: ['image', 'text'],
      adapter_capabilities: expect.arrayContaining(['image', 'text']),
      missing_capabilities: [],
      error_code: null,
      provider_error: false,
    });
    expect(mismatch).toMatchObject({
      matched: false,
      missing_capabilities: ['image'],
      error_code: 'capability_mismatch',
      provider_error: false,
    });
  });

  it('invokes only fixture outputs and reports mismatch or missing fixture as readiness errors', () => {
    const success = invokeWithFixtureAdapter(invocationPlanFor(sampleFor('call_transcript')));
    expect(success).toMatchObject({
      kind: 'MODEL_INVOCATION_RESULT',
      executable: false,
      persisted: false,
      represents_model_quality: false,
      safety: {
        network_allowed: false,
        fixture_only: true,
        represents_real_model_call: false,
      },
      response: {
        kind: 'MODEL_PROVIDER_RESPONSE',
        fixture_source: 'model_invocation_fixture_v1',
        represents_real_model_output: false,
      },
      metrics: {
        cost_usd: null,
        token_usage: {
          fixture: true,
        },
      },
    });
    expect(success.error).toBeNull();

    const mismatchPlan = buildModelInvocationPlan(promptPlanFor(sampleFor('wechat_screenshot')), {
      ...FIXTURE_MODEL_PROVIDER_ADAPTER,
      declared_capabilities: ['text'],
    });
    expect(invokeWithFixtureAdapter(mismatchPlan).error).toMatchObject({
      code: 'capability_mismatch',
      provider_error: false,
    });

    const missingPlan = {
      ...invocationPlanFor(sampleFor('next_action_suggestion')),
      request: {
        ...invocationPlanFor(sampleFor('next_action_suggestion')).request,
        eval_sample_id: 'EVAL_V1_MISSING_FIXTURE',
      },
    };
    expect(invokeWithFixtureAdapter(missingPlan).error).toMatchObject({
      code: 'fixture_missing',
      provider_error: false,
    });
  });

  it('supports all three prompt purposes through the fixture path', () => {
    const samples = [
      sampleFor('wechat_screenshot'),
      sampleFor('call_transcript'),
      sampleFor('next_action_suggestion'),
    ];

    for (const sample of samples) {
      const result = invokeWithFixtureAdapter(invocationPlanFor(sample));
      expect(result.error).toBeNull();
      expect(result.request.purpose).toBe(sample.source_type);
      expect(result.response.raw_output.trim().length).toBeGreaterThan(0);
      expect(result.response.represents_real_model_output).toBe(false);
    }
  });

  it('keeps invalid_json as malformed fixture output without mutating prompt or eval files', () => {
    const sample = sampleById('EVAL_V1_INVALID_JSON_OUTPUT_007');
    const promptPlan = promptPlanFor(sample);
    const before = JSON.stringify(promptPlan);
    const result = invokeWithFixtureAdapter(buildModelInvocationPlan(promptPlan, FIXTURE_MODEL_PROVIDER_ADAPTER));

    expect(JSON.stringify(promptPlan)).toBe(before);
    expect(result.response.raw_output).toContain('malformed');
    expect(result.response.parsed).toBeNull();
    expect(result.response.parse_error?.trim().length).toBeGreaterThan(0);
  });

  it('optionally bridges invocation result shape to eval candidate output without running evals', () => {
    const sample = sampleFor('next_action_suggestion');
    const result = invokeWithFixtureAdapter(invocationPlanFor(sample));
    const output = modelInvocationResultToEvalCandidateOutput(result);

    expect(output).toMatchObject({
      kind: 'EVAL_CANDIDATE_OUTPUT',
      sample_id: sample.sample_id,
      source: 'fixture_v1',
      synthetic: true,
      fixture_only: true,
      model_output: false,
    });
    expect(output.raw_output).toBe(result.response.raw_output);
  });

  it('keeps model runtime source free of network, provider, DB, UI, agent, and real-model claims', () => {
    const sources = [
      readFileSync('src/lib/modelRouterRuntimeReadiness.ts', 'utf8'),
      readFileSync('src/lib/modelRouterRuntime/modelInvocationFixturesV1.ts', 'utf8'),
    ].join('\n');
    const forbiddenTerms = [
      'fetch(',
      'axios',
      'process.env',
      'import.meta.env',
      'API_KEY',
      'apiKey',
      'localStorage',
      'AISettingsPage',
      'textAIProvider',
      'multimodalProvider',
      'aiDraft',
      'analyzeWechatScreenshot',
      'analyzeCallTranscript',
      'OpenAI',
      'DeepSeek',
      'Qwen',
      'Claude',
      'Gemini',
      'Ollama',
      'CREATE TABLE',
      'agent',
      'voice',
      'tool_call',
      'sendMessage',
      "selected_provider: 'deepseek'",
      "selected_provider: 'qwen'",
      "selected_model_id: 'deepseek'",
      "selected_model_id: 'qwen'",
      'represents_real_model_output: true',
      'represents_model_quality: true',
      'executable: true',
    ];

    for (const term of forbiddenTerms) {
      expect(sources).not.toContain(term);
    }
  });

  it('does not modify existing runtime, eval, UI, database, schema, state-machine, or provider files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean).map(file => file.replace(/^local-crm-desktop\//, ''));
    if (hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles)) return;
    const forbiddenFiles = [
      'src/lib/promptRuntimeReadiness.ts',
      'src/lib/modelRouterRuntimeReadiness.ts',
      'src/lib/modelRouterRuntime/modelInvocationFixturesV1.ts',
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
    expect(changedFiles.filter(file => file.startsWith('src-tauri/') && file !== 'src-tauri/src/lib.rs')).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
  });
});
