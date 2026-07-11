import type {
  CapabilityProvider,
  TextReasoningInput,
  TextReasoningOutput,
  VisionAnalysisInput,
  VisionAnalysisOutput,
} from './types';

export class DeepSeekCompatibleProvider implements CapabilityProvider<TextReasoningInput, TextReasoningOutput> {
  readonly capability = 'TEXT_REASONING' as const;
  readonly providerKind = 'DEEPSEEK_COMPATIBLE' as const;
  readonly modelId = 'deepseek-compatible-skeleton-v1';
  readonly executionMode = 'SKELETON' as const;

  async execute(_input: TextReasoningInput): Promise<TextReasoningOutput> {
    return { text: '' };
  }
}

export class QwenVisionCompatibleProvider implements CapabilityProvider<VisionAnalysisInput, VisionAnalysisOutput> {
  readonly capability = 'VISION_ANALYSIS' as const;
  readonly providerKind = 'QWEN_VISION_COMPATIBLE' as const;
  readonly modelId = 'qwen-vision-compatible-skeleton-v1';
  readonly executionMode = 'SKELETON' as const;

  async execute(_input: VisionAnalysisInput): Promise<VisionAnalysisOutput> {
    return { visual_facts: [] };
  }
}
