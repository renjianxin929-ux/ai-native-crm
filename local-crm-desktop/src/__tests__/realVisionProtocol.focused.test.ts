import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectImageMime, validateVisionImageMetadata, VISION_INPUT_LIMITS } from '../lib/productionAi/visionInput';
import { validateModelOutputSchema } from '../lib/productionAi/modelOutputSchemas';
import { buildAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const webp = new TextEncoder().encode('RIFF0000WEBP');

describe('real-vision-protocol suite', () => {
  it('accepts JPEG/PNG/WebP and rejects MIME spoof, corruption, size and dimensions', () => {
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    expect(detectImageMime(png)).toBe('image/png');
    expect(detectImageMime(webp)).toBe('image/webp');
    expect(validateVisionImageMetadata({ declaredMime: 'image/png', fileName: 'x.png', bytes: png, width: 1, height: 1 })).toBe('image/png');
    expect(() => validateVisionImageMetadata({ declaredMime: 'image/jpeg', fileName: 'x.jpg', bytes: png, width: 1, height: 1 })).toThrow(/MIME/);
    expect(() => validateVisionImageMetadata({ declaredMime: 'image/png', fileName: 'x.png', bytes: new Uint8Array([1]), width: 1, height: 1 })).toThrow(/MIME/);
    expect(() => validateVisionImageMetadata({ declaredMime: 'image/png', fileName: 'x.png', bytes: png, width: VISION_INPUT_LIMITS.max_dimension + 1, height: 1 })).toThrow(/尺寸/);
    expect(VISION_INPUT_LIMITS.max_images).toBe(1);
  });

  it('clarifies without an image and routes explicit Analyze to real multimodal capability', () => {
    const missing = buildAgentIntentEnvelope('分析这张聊天截图', '2026-07-16T00:00:00Z');
    expect(missing).toMatchObject({ intent: 'CAPTURE_REVIEW', model_capability: 'VISION_ANALYSIS', requires_real_model: true, clarification_required: true, missing_fields: ['selected_image'] });
    expect(buildAgentIntentEnvelope('分析这张聊天截图', '2026-07-16T00:00:00Z', { has_selected_image: true }).clarification_required).toBe(false);
  });

  it('uses a real image_url content part and a closed review-only image schema', () => {
    const rust = readFileSync(resolve(process.cwd(), 'src-tauri/src/trusted_host.rs'), 'utf8');
    expect(rust).toContain('{"type":"image_url","image_url":{"url":data_url}}');
    expect(rust).not.toContain('{"type":"text","text":data_url}');
    const output = { extracted_facts: [{ fact_id: 'f1', fact_type: 'visible_text', content: '客户要求报价', source_reference: 'region:1', confidence: 0.9 }], source_reference: 'selected-image', confidence: 0.9, evidence_regions: ['region:1'], unsupported_assumptions: [], requires_fact_review: true };
    expect(validateModelOutputSchema('image_capture_analysis_v1', output).valid).toBe(true);
    expect(validateModelOutputSchema('image_capture_analysis_v1', { ...output, recommendation: '直接写入' }).valid).toBe(false);
  });
});
