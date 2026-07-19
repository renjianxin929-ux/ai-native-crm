import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaptureRuntimeMetadata } from '../components/aiNative/SalesAgentInteractionWorkspace';
import { buildRuntimeDetails } from '../lib/productionAi/runtimeMode';
import { buildDailyFocusItems } from '../lib/salesAgentUi/dailyFocus';

describe('runtime-metadata-surfaces', () => {
  it('renders complete Capture runtime provenance without raw prompts or responses', () => {
    const details = buildRuntimeDetails({
      runtime_mode: 'REAL_MODEL', provider: 'QWEN_VISION_COMPATIBLE', model: 'qwen-vl-plus', model_called: true,
      request_id: 'capture-1', latency_ms: 42, token_usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      tools_used: ['vision_extract'], evidence_count: 2, degraded: false, degradation_reason: null,
      validation_status: 'passed', evidence_validation_status: 'passed', cancellation_status: 'not_requested', requires_real_model: true,
    });
    const html = renderToStaticMarkup(React.createElement(CaptureRuntimeMetadata, { details }));
    for (const value of ['REAL_MODEL', 'QWEN_VISION_COMPATIBLE', 'qwen-vl-plus', 'capture-1', '42 ms', 'Token usage: 9', 'vision_extract', 'Evidence count: 2', 'Schema status: passed', 'Evidence status: passed', 'Cancellation status: not_requested', 'Degradation reason: none']) {
      expect(html).toContain(value);
    }
    expect(html).not.toMatch(/raw_prompt|raw_response|api[_-]?key/i);
  });

  it('keeps Daily Focus metadata lightweight and explicitly local', () => {
    const [item] = buildDailyFocusItems([{ id: 'c1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', stage: 'CONTACTED', next_follow_up_at: null, last_contacted_at: null }], '2026-07-16T08:00:00.000Z');
    expect(item).toMatchObject({ data_source: 'LOCAL_CRM', generated_at: '2026-07-16T08:00:00.000Z', runtime_metadata: { execution_mode: 'LOCAL_DETERMINISTIC', model_called: false } });
  });
});
