import { describe, expect, it } from 'vitest';
import { buildRuntimeDetails, resolveRuntimeModeUiLabel } from '../lib/productionAi/runtimeMode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('runtime-transparency suite', () => {
  it('labels real, local deterministic and unavailable modes from execution metadata', () => {
    expect(resolveRuntimeModeUiLabel({ runtime_mode: 'REAL_MODEL', model_called: true, degraded: false, requires_real_model: true })).toBe('已使用真实模型');
    expect(resolveRuntimeModeUiLabel({ runtime_mode: 'LOCAL_DETERMINISTIC', model_called: false, degraded: false, requires_real_model: false })).toBe('本地规则结果');
    expect(resolveRuntimeModeUiLabel({ runtime_mode: 'MODEL_UNAVAILABLE', model_called: false, degraded: true, requires_real_model: true })).toBe('模型不可用，未进行 AI 推理');
  });

  it('carries provider/model/request/latency/tokens/validation without prompts, responses or secrets', () => {
    const details = buildRuntimeDetails({
      runtime_mode: 'REAL_MODEL', provider: 'DEEPSEEK_COMPATIBLE', model: 'deepseek-chat', model_called: true, request_id: 'req-1', latency_ms: 41,
      token_usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }, tools_used: ['get_customer'], evidence_count: 1,
      degraded: false, degradation_reason: null, validation_status: 'passed', evidence_validation_status: 'passed', cancellation_status: 'not_requested', requires_real_model: true,
    });
    expect(details).toMatchObject({ runtime_mode: 'REAL_MODEL', provider: 'DEEPSEEK_COMPATIBLE', model: 'deepseek-chat', request_id: 'req-1', latency_ms: 41, validation_status: 'passed' });
    expect(JSON.stringify(details)).not.toMatch(/raw_prompt|raw_response|api[_-]?key|bearer/i);
  });

  it('runtime-metadata-all-surfaces exposes execution truth for chat, capture and Daily Focus', () => {
    const workspace = readFileSync(resolve(process.cwd(), 'src/components/aiNative/SalesAgentInteractionWorkspace.tsx'), 'utf8');
    const capture = readFileSync(resolve(process.cwd(), 'src/lib/customerCapture/review.ts'), 'utf8');
    const daily = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentUi/dailyFocus.ts'), 'utf8');
    for (const marker of ['runtime_details.runtime_mode', 'runtime_details.provider', 'runtime_details.model', 'runtime_details.request_id', 'runtime_details.evidence_validation_status', 'runtime_details.cancellation_status']) {
      expect(workspace).toContain(marker);
    }
    expect(workspace).toContain('captureReview.runtime_metadata');
    expect(capture).toContain('runtime_metadata');
    expect(daily).toContain('runtime_metadata: buildRuntimeDetails');
    expect(daily).toContain("runtime_mode: 'LOCAL_DETERMINISTIC'");
  });
});
