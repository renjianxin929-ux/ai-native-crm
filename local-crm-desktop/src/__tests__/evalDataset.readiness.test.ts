import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EVAL_DATASET_VERSION,
  EVAL_FATAL_ERROR_TAGS,
  EVAL_SAMPLE_SOURCE_TYPES,
  listSalesAiEvalDatasetV1,
  validateEvalSample,
} from '../lib/evalDatasetReadiness';

const REQUIRED_FATAL_TAGS = [
  'fabricated_evidence',
  'unsafe_auto_execute',
  'wrong_high_intent_upgrade',
  'ignores_risk',
  'invalid_json',
  'sample_as_real_data',
  'speculation_as_fact',
  'unauthorized_grade_upgrade',
];

const REQUIRED_SOURCE_TYPES = [
  'wechat_screenshot',
  'call_transcript',
  'next_action_suggestion',
];

const ROUTE_PURPOSES = [
  'wechat_screenshot_analysis',
  'call_transcript_analysis',
  'next_action_suggestion',
];

describe('Sales AI Eval Dataset v1 readiness gate', () => {
  it('exposes a readonly static v1 dataset and fatal error taxonomy', () => {
    const dataset = listSalesAiEvalDatasetV1();

    expect(EVAL_DATASET_VERSION).toBe('v1');
    expect(dataset.length).toBeGreaterThanOrEqual(8);
    expect(dataset.length).toBeLessThanOrEqual(12);
    expect(Object.isFrozen(dataset)).toBe(true);
    expect(EVAL_FATAL_ERROR_TAGS).toEqual(expect.arrayContaining(REQUIRED_FATAL_TAGS));
    expect(EVAL_SAMPLE_SOURCE_TYPES).toEqual(expect.arrayContaining(REQUIRED_SOURCE_TYPES));
  });

  it('keeps every sample synthetic, eval-only, validated, and globally identifiable', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const sampleIds = new Set<string>();

    for (const sample of dataset) {
      expect(Object.isFrozen(sample)).toBe(true);
      expect(validateEvalSample(sample)).toEqual({ valid: true, errors: [] });
      expect(sample.kind).toBe('EVAL_SAMPLE');
      expect(sample.dataset_version).toBe('v1');
      expect(sample.persisted).toBe(false);
      expect(sample.synthetic).toBe(true);
      expect(sample.sample_id).toMatch(/^EVAL_V1_/);
      expect(sample.sample_id.trim().length).toBeGreaterThan(0);
      expect(sampleIds.has(sample.sample_id)).toBe(false);
      sampleIds.add(sample.sample_id);

      expect(sample.profile_id.trim().length).toBeGreaterThan(0);
      expect(REQUIRED_SOURCE_TYPES).toContain(sample.source_type);
      expect(ROUTE_PURPOSES).toContain(sample.route_purpose);
      expect(sample.raw_input.trim().length).toBeGreaterThan(0);
      expect(sample.expected_intent_level).toBeTruthy();
      expect(sample.expected_grade).toBeTruthy();
      expect(sample.expected_risks.length).toBeGreaterThan(0);
      expect(sample.expected_actions.length).toBeGreaterThan(0);
      expect(sample.required_evidence.length).toBeGreaterThan(0);
      expect(sample.forbidden_errors.length).toBeGreaterThan(0);
      expect(sample.fatal_error_tags.length).toBeGreaterThan(0);
      expect(sample.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('covers the required source types and risk-oriented sample scenarios', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const sources = new Set(dataset.map(sample => sample.source_type));
    const tags = new Set(dataset.flatMap(sample => sample.fatal_error_tags));
    const notes = dataset.map(sample => sample.notes).join('\n').toLowerCase();

    expect([...sources].sort()).toEqual([...REQUIRED_SOURCE_TYPES].sort());
    expect(dataset.some(sample => sample.expected_outcome === 'negative')).toBe(true);
    expect(notes).toContain('low confidence');
    expect(notes).toContain('wechat pass is not grade a evidence');
    expect(notes).toContain('company-name industry speculation');
    expect(tags.has('unsafe_auto_execute')).toBe(true);
    expect(tags.has('fabricated_evidence')).toBe(true);
  });

  it('uses evidence substrings and explicit forbidden-error boundaries', () => {
    const dataset = listSalesAiEvalDatasetV1();
    const forbiddenErrors = dataset.flatMap(sample => sample.forbidden_errors).join('\n').toLowerCase();

    expect(forbiddenErrors).toContain('do not auto-create customer');
    expect(forbiddenErrors).toContain('do not auto-upgrade grade');
    expect(forbiddenErrors).toContain('do not treat speculation as fact');

    for (const sample of dataset) {
      for (const evidence of sample.required_evidence) {
        expect(evidence.trim().length).toBeGreaterThan(0);
        expect(sample.raw_input).toContain(evidence);
        expect(evidence).not.toBe(sample.raw_input);
        expect(evidence.length).toBeLessThan(sample.raw_input.length);
      }
    }
  });

  it('keeps negative samples as input material, not fake model output', () => {
    const negativeSamples = listSalesAiEvalDatasetV1()
      .filter(sample => sample.expected_outcome === 'negative');
    const invalidJsonSamples = negativeSamples
      .filter(sample => sample.fatal_error_tags.includes('invalid_json'));

    expect(negativeSamples.length).toBeGreaterThan(0);
    expect(invalidJsonSamples.length).toBeGreaterThan(0);
    for (const sample of negativeSamples) {
      expect(sample.raw_input.toLowerCase()).not.toContain('model output');
      expect(sample.raw_input.toLowerCase()).not.toContain('assistant response');
    }
    for (const sample of invalidJsonSamples) {
      expect(sample.notes.toLowerCase()).toContain('future model output');
    }
  });

  it('keeps all synthetic company and customer names prefixed and avoids real contact data', () => {
    const datasetText = JSON.stringify(listSalesAiEvalDatasetV1());
    const possibleEmails = datasetText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

    for (const sample of listSalesAiEvalDatasetV1()) {
      expect(sample.entity_names.length).toBeGreaterThan(0);
      for (const entityName of sample.entity_names) {
        expect(entityName).toMatch(/^(EVAL_SAMPLE_|EVAL_V1_)/);
      }
    }

    expect(datasetText).not.toMatch(/\b1[3-9]\d{9}\b/);
    expect(datasetText).not.toMatch(/\b(?:wxid_[A-Za-z0-9_-]{6,}|WECHAT_REAL_ID_[A-Za-z0-9_-]+)\b/);
    expect(possibleEmails.every(email => /@(example|invalid|eval)\.test$/i.test(email))).toBe(true);
  });

  it('keeps dataset readiness source free of execution, storage, provider, and runner behavior', () => {
    const sources = [
      readFileSync('src/lib/evalDatasetReadiness.ts', 'utf8'),
      readFileSync('src/lib/evalDataset/salesAiEvalDatasetV1.ts', 'utf8'),
    ].join('\n');
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
      'CREATE TABLE',
      'runEval',
      'eval_runner',
      'scoreModel',
      'agent',
      'provider execution',
    ];

    for (const term of forbiddenTerms) {
      expect(sources.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it('does not modify forbidden runtime, UI, provider, schema, db, or state-machine files', () => {
    const changedFiles = [
      ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/),
    ].filter(Boolean);
    const forbiddenFiles = [
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
