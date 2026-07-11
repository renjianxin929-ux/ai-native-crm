export type ModelCapability = 'TEXT_REASONING' | 'VISION_ANALYSIS';

export type ModelProviderKind = 'DEEPSEEK_COMPATIBLE' | 'QWEN_VISION_COMPATIBLE';

export type ModelProviderExecutionMode = 'SKELETON';

export interface CapabilityProvider<TInput, TOutput> {
  readonly capability: ModelCapability;
  readonly providerKind: ModelProviderKind;
  readonly modelId: string;
  readonly executionMode: ModelProviderExecutionMode;
  execute(input: TInput): Promise<TOutput>;
}

export interface TextReasoningInput {
  readonly text: string;
}

export interface TextReasoningOutput {
  readonly text: string;
}

export type VisionFactType =
  | 'observed_object'
  | 'extracted_text'
  | 'visible_attribute'
  | 'document_information';

export interface VisionFact {
  readonly fact_type: VisionFactType;
  readonly content: string;
}

export interface VisionAnalysisInput {
  readonly imageReference: string;
}

export interface VisionAnalysisOutput {
  readonly visual_facts: readonly VisionFact[];
}
