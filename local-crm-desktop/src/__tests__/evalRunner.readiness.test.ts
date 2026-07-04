import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EVAL_FATAL_ERROR_TAGS, listSalesAiEvalDatasetV1 } from '../lib/evalDatasetReadiness';
import {
  EVAL_RUNNER_VERSION,
  runEvalDatasetV1,
  type EvalCandidateOutput,
} from '../lib/evalRunnerReadiness';
import {
  buildEvalPassingFixturesV1,
  buildEvalViolationFixturesV1,
} from '../lib/evalDataset/evalCandidateFixturesV1';

const FATAL_TAGS = [
  'fabricated_evidence',
  'unsafe_auto_execute',
  'wrong_high_intent_upgrade',
  'ignores_risk',
  'invalid_json',
  'sample_as_real_data',
  'speculation_as_fact',
  'unauthorized_grade_upgrade',
] as const;

const SAFE_SOURCE_TERMS = [
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
  'CREATE TABLE',
  'provider execution',
  'analyzeWechatScreenshot',
  'analyzeCallTranscript',
  'textAIProvider',
  'multimodalProvider',
  'agent',
  'voice',
  'tool_call',
];

describe('Eval Runner v1 readiness gate', () => {
  it('builds fixture-only candidate outputs for every dataset sample', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const fixtures = buildEvalPassingFixturesV1();
    const sampleIds = new Set(dataset.map(sample => sample.sample_id));

    expect(EVAL_RUNNER_VERSION).toBe('v1');
    expect(fixtures).toHaveLength(dataset.length);

    for (const candidate of fixtures) {
      expect(candidate.kind).toBe('EVAL_CANDIDATE_OUTPUT');
      expect(sampleIds.has(candidate.sample_id)).toBe(true);
      expect(candidate.raw_output.trim().length).toBeGreaterThan(0);
      expect(candidate.parsed === null || typeof candidate.parsed === 'object').toBe(true);
      expect(candidate.source).toBe('fixture_v1');
      expect(candidate.synthetic).toBe(true);
      expect(candidate.fixture_only).toBe(true);
      expect(candidate.model_output).toBe(false);
    }
  });

  it('runs fixture_pass as deterministic fixture evaluation, not model scoring', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const result = runEvalDatasetV1({
      mode: 'fixture_pass',
      samples: dataset,
      candidates: buildEvalPassingFixturesV1(),
    });

    expect(result).toMatchObject({
      kind: 'EVAL_RUN_RESULT',
      runner_version: 'v1',
      mode: 'fixture_pass',
      executable: false,
      persisted: false,
      represents_model_quality: false,
    });
    expect(result.results).toHaveLength(dataset.length);
    expect(result.summary.total_samples).toBe(dataset.length);
    expect(result.summary.passed).toBe(dataset.length);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.fatal_detected_count).toBe(0);
    expect(result.summary.check_pass_rate).toBe(1);
    expect(result.summary).not.toHaveProperty('model_score');
    expect(result.results.every(sampleResult => sampleResult.passed)).toBe(true);
    expect(result.results.every(sampleResult => sampleResult.checks.length > 0)).toBe(true);
  });

  it('runs fixture_violation with fatal tags detected by deterministic rules', () => {
    const result = runEvalDatasetV1({
      mode: 'fixture_violation',
      samples: listSalesAiEvalDatasetV1(),
      candidates: buildEvalViolationFixturesV1(),
    });
    const detected = new Set(result.results.flatMap(sample => sample.detected_fatal_tags));
    const invalidJson = result.results.find(sample => sample.detected_fatal_tags.includes('invalid_json'));

    expect(EVAL_FATAL_ERROR_TAGS).toEqual(expect.arrayContaining(FATAL_TAGS));
    expect([...detected].sort()).toEqual([...FATAL_TAGS].sort());
    expect(result.summary.fatal_detected_count).toBeGreaterThanOrEqual(FATAL_TAGS.length);
    expect(result.summary.failed).toBeGreaterThan(0);
    expect(invalidJson?.candidate.parsed).toBeNull();
    expect(invalidJson?.candidate.parse_error?.trim().length).toBeGreaterThan(0);

    for (const sampleResult of result.results) {
      expect(sampleResult.detected_fatal_tags).not.toEqual(sampleResult.sample.fatal_error_tags);
      for (const fatal of sampleResult.fatal_checks) {
        expect(fatal.source).toBe('deterministic_detection');
      }
    }
  });

  it('checks every required evidence item instead of only evidence presence', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const candidates = buildEvalPassingFixturesV1();
    const first = dataset[0];
    const original = candidates.find(candidate => candidate.sample_id === first.sample_id)!;
    const brokenCandidate = {
      ...original,
      parsed: {
        ...(original.parsed as Record<string, unknown>),
        evidence: ['unrelated non-empty evidence'],
      },
      raw_output: 'unrelated non-empty evidence',
    } satisfies EvalCandidateOutput;

    const result = runEvalDatasetV1({
      mode: 'fixture_pass',
      samples: dataset,
      candidates: candidates.map(candidate => (
        candidate.sample_id === first.sample_id ? brokenCandidate : candidate
      )),
    });
    const broken = result.results.find(sample => sample.sample.sample_id === first.sample_id)!;

    expect(broken.passed).toBe(false);
    expect(broken.checks.find(check => check.name === 'required_evidence')?.passed).toBe(false);
  });

  it('detects forbidden errors with content rules', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const sample = dataset.find(item => item.fatal_error_tags.includes('unsafe_auto_execute'))!;
    const candidates = buildEvalPassingFixturesV1();
    const original = candidates.find(candidate => candidate.sample_id === sample.sample_id)!;
    const brokenCandidate: EvalCandidateOutput = {
      ...original,
      raw_output: `${original.raw_output}\nI already auto-created the customer and auto-sent the message.`,
      parsed: {
        ...(original.parsed as Record<string, unknown>),
        actions: ['already auto-created the customer', 'auto-sent the message'],
      },
    };

    const result = runEvalDatasetV1({
      mode: 'fixture_pass',
      samples: dataset,
      candidates: candidates.map(candidate => (
        candidate.sample_id === sample.sample_id ? brokenCandidate : candidate
      )),
    });
    const broken = result.results.find(item => item.sample.sample_id === sample.sample_id)!;

    expect(broken.detected_fatal_tags).toContain('unsafe_auto_execute');
    expect(broken.checks.find(check => check.name === 'forbidden_errors')?.passed).toBe(false);
  });

  it('checks expected fields and risk/action substrings', () => {
    const result = runEvalDatasetV1({
      mode: 'fixture_pass',
      samples: listSalesAiEvalDatasetV1(),
      candidates: buildEvalPassingFixturesV1(),
    });

    for (const sampleResult of result.results) {
      expect(sampleResult.checks.find(check => check.name === 'expected_intent_level')?.passed).toBe(true);
      expect(sampleResult.checks.find(check => check.name === 'expected_grade')?.passed).toBe(true);
      expect(sampleResult.checks.find(check => check.name === 'expected_phone_feedback')?.passed).toBe(true);
      expect(sampleResult.checks.find(check => check.name === 'expected_risks')?.passed).toBe(true);
      expect(sampleResult.checks.find(check => check.name === 'expected_actions')?.passed).toBe(true);
    }
  });

  it('keeps runner and fixture source free of execution, provider, storage, agent, and voice behavior', () => {
    const sources = [
      readFileSync('src/lib/evalRunnerReadiness.ts', 'utf8'),
      readFileSync('src/lib/evalDataset/evalCandidateFixturesV1.ts', 'utf8'),
    ].join('\n');

    for (const term of SAFE_SOURCE_TERMS) {
      expect(sources.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it('does not modify existing dataset, runtime, UI, provider, schema, db, or state-machine files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean);
    const forbiddenFiles = [
      'src/lib/evalDataset/salesAiEvalDatasetV1.ts',
      'src/lib/evalDatasetReadiness.ts',
      'src/lib/aiRuntimeReadiness.ts',
      'src/pages/LeadWorkbenchPage.tsx',
      'src/lib/leadWorkbench/syncAdapter.ts',
      'src/lib/leadWorkbench/schema.ts',
      'src/lib/leadWorkbench/stateMachine.ts',
      'src/lib/db.ts',
      'src/lib/aiDraft.ts',
      'src/lib/textAIProvider.ts',
      'src/lib/multimodalProvider.ts',
    ];

    expect(changedFiles.filter(file => forbiddenFiles.includes(file))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
  });
});
