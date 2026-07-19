/** Formal production runtime modes — never disguise one as another. */
export type ProductionRuntimeMode = 'REAL_MODEL' | 'LOCAL_DETERMINISTIC' | 'MODEL_UNAVAILABLE';

export type RuntimeModeUiLabel =
  | '已使用真实模型'
  | '本地规则结果'
  | '模型不可用，未进行 AI 推理';

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

export function resolveRuntimeModeUiLabel(input: {
  readonly runtime_mode: ProductionRuntimeMode;
  readonly model_called: boolean;
  readonly degraded: boolean;
  readonly requires_real_model: boolean;
}): RuntimeModeUiLabel {
  if (input.runtime_mode === 'REAL_MODEL' && input.model_called && !input.degraded) return '已使用真实模型';
  if (input.requires_real_model && (!input.model_called || input.degraded)) {
    return '模型不可用，未进行 AI 推理';
  }
  return '本地规则结果';
}

export function buildRuntimeDetails(input: Omit<ProductionRuntimeDetails, 'ui_label' | 'execution_mode' | 'tools' | 'schema_validation_status'> & {
  readonly requires_real_model: boolean;
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
    }),
  };
}
