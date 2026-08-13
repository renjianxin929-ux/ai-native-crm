import type { ProviderErrorCategory } from './providerErrorMapping';

/** Formal production runtime modes — never disguise one as another. */
export type ProductionRuntimeMode = 'REAL_MODEL' | 'LOCAL_DETERMINISTIC' | 'MODEL_UNAVAILABLE';

/**
 * Closed classification of the real provider execution result.
 * A schema-invalid model answer must never surface as "provider unavailable".
 */
export type ProductionRuntimeOutcome =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'MODEL_OUTPUT_INVALID'
  | 'MODEL_OUTPUT_VALID'
  | 'LOCAL_FALLBACK';

export type RuntimeModeUiLabel =
  | '已使用真实模型'
  | '本地规则结果'
  | '模型不可用，未进行 AI 推理'
  | '模型请求失败，未生成 AI 分析'
  | 'AI 返回结果未通过结构校验，已使用本地数据回退。';

export interface ProductionRuntimeDetails {
  readonly execution_mode: ProductionRuntimeMode;
  readonly runtime_mode: ProductionRuntimeMode;
  readonly provider: string | null;
  readonly model: string | null;
  readonly model_called: boolean;
  readonly request_id: string;
  readonly latency_ms: number | null;
  readonly token_usage: {
    readonly prompt_tokens: number | null;
    readonly completion_tokens: number | null;
    readonly total_tokens: number | null;
  } | null;
  readonly tools_used: readonly string[];
  readonly tools: readonly string[];
  readonly evidence_count: number;
  readonly degraded: boolean;
  readonly degradation_reason: string | null;
  readonly validation_status: 'passed' | 'failed' | 'not_applicable' | 'skipped_no_model';
  readonly schema_validation_status: 'passed' | 'failed' | 'not_applicable' | 'skipped_no_model';
  readonly evidence_validation_status: 'passed' | 'failed' | 'not_applicable' | 'skipped_no_model';
  readonly cancellation_status: 'not_requested' | 'cancelled_at_host' | 'completed_before_cancel';
  readonly ui_label: RuntimeModeUiLabel;
}

export function resolveProductionRuntimeOutcome(input: {
  readonly runtime_mode: ProductionRuntimeMode;
  readonly model_called: boolean;
  readonly degraded: boolean;
  readonly validation_status: ProductionRuntimeDetails['validation_status'];
  readonly evidence_validation_status: ProductionRuntimeDetails['evidence_validation_status'];
  readonly failure_category: ProviderErrorCategory | null;
}): ProductionRuntimeOutcome {
  // The provider was really called: the outcome is about the model output, not availability.
  if (input.runtime_mode === 'REAL_MODEL' && input.model_called) {
    if (!input.degraded) return 'MODEL_OUTPUT_VALID';
    if (input.validation_status === 'failed' || input.evidence_validation_status === 'failed') return 'MODEL_OUTPUT_INVALID';
    return 'PROVIDER_REQUEST_FAILED';
  }
  if (input.runtime_mode === 'MODEL_UNAVAILABLE') {
    return (input.failure_category === null || input.failure_category === 'unconfigured') ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_FAILED';
  }
  return 'LOCAL_FALLBACK';
}

export function resolveRuntimeModeUiLabel(input: {
  readonly runtime_mode: ProductionRuntimeMode;
  readonly model_called: boolean;
  readonly degraded: boolean;
  readonly requires_real_model: boolean;
  readonly validation_status?: ProductionRuntimeDetails['validation_status'];
  readonly evidence_validation_status?: ProductionRuntimeDetails['evidence_validation_status'];
  readonly failure_category?: ProviderErrorCategory | null;
}): RuntimeModeUiLabel {
  if (input.runtime_mode === 'REAL_MODEL' && input.model_called && !input.degraded) return '已使用真实模型';
  if (input.runtime_mode === 'REAL_MODEL' && input.model_called && input.degraded) {
    // Model was called and answered; only the structure/evidence validation failed.
    if (input.validation_status === 'failed' || input.evidence_validation_status === 'failed') {
      return 'AI 返回结果未通过结构校验，已使用本地数据回退。';
    }
    return '模型请求失败，未生成 AI 分析';
  }
  if (input.runtime_mode === 'MODEL_UNAVAILABLE') {
    // Missing/unconfigured provider vs an actual request failure are different states.
    if (input.failure_category && input.failure_category !== 'unconfigured') {
      return '模型请求失败，未生成 AI 分析';
    }
    return '模型不可用，未进行 AI 推理';
  }
  if (input.requires_real_model && !input.model_called) return '模型不可用，未进行 AI 推理';
  return '本地规则结果';
}

export function buildRuntimeDetails(input: Omit<ProductionRuntimeDetails, 'ui_label' | 'execution_mode' | 'tools' | 'schema_validation_status'> & {
  readonly requires_real_model: boolean;
  readonly failure_category?: ProviderErrorCategory | null;
}): ProductionRuntimeDetails {
  return {
    ...input,
    execution_mode: input.runtime_mode,
    tools: input.tools_used,
    schema_validation_status: input.validation_status,
    ui_label: resolveRuntimeModeUiLabel({
      runtime_mode: input.runtime_mode,
      model_called: input.model_called,
      degraded: input.degraded,
      requires_real_model: input.requires_real_model,
      validation_status: input.validation_status,
      evidence_validation_status: input.evidence_validation_status,
      failure_category: input.failure_category ?? null,
    }),
  };
}
