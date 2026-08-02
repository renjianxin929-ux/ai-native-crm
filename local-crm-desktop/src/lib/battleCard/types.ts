/**
 * Battle Card Backend V1 — 数据对象与闭合 Schema 类型。
 * 字段契约以 docs/architecture/customer-battle-card-backend-v1.md（冻结 ADR）为准。
 */

// ── intelligence_imports ──

export type IntelligenceParseStatus = 'PENDING' | 'DRAFTED' | 'CONFIRMED' | 'CANCELLED';

export interface IntelligenceImportRow {
  readonly id: string;
  readonly customer_id: string | null;
  readonly source_system: string;
  readonly source_label: string | null;
  readonly raw_content: string;
  readonly content_hash: string;
  readonly parser_version: string;
  readonly parse_status: IntelligenceParseStatus;
  readonly confirmed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface IntelligenceImportInput {
  readonly id: string;
  readonly customer_id: string | null;
  readonly source_system: string;
  readonly source_label: string | null;
  readonly raw_content: string;
  readonly content_hash: string;
  readonly parser_version: string;
  readonly parse_status: IntelligenceParseStatus;
  readonly created_at: string;
}

// ── reviewed_facts ──

export type FactVerificationStatus = 'PENDING' | 'VERIFIED' | 'CONFLICTED' | 'SUPERSEDED';
export type FactApplicability = 'GLOBAL' | 'PARTIAL' | 'CONDITIONAL' | 'UNSUPPORTED';
export type FactCategory = 'COMPANY' | 'PRODUCT' | 'CHANNEL' | 'MARKET' | 'CERTIFICATION' | 'OPERATION' | 'OTHER';

/** 证据引用：复用现有 Evidence 引用风格（CUSTOMER/FOLLOW_UP_RECORD/VISIT_RECORD/TASK）或导入内来源引用。 */
export interface FactEvidenceRef {
  readonly evidence_type?: 'CUSTOMER' | 'FOLLOW_UP_RECORD' | 'VISIT_RECORD' | 'TASK';
  readonly evidence_id?: string;
  /** 指向 intelligence_imports 内的来源段落标识（如章节名 + 行号）。 */
  readonly import_ref?: string;
}

export interface ReviewedFactRow {
  readonly id: string;
  readonly customer_id: string;
  readonly source_import_id: string;
  readonly fact_category: FactCategory | string;
  readonly statement: string;
  readonly normalized_value_json: string | null;
  readonly verification_status: FactVerificationStatus;
  readonly confidence: number;
  readonly applicability: FactApplicability;
  readonly observed_at: string | null;
  readonly valid_until: string | null;
  readonly evidence_refs_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ReviewedFactInput {
  readonly id: string;
  readonly customer_id: string;
  readonly source_import_id: string;
  readonly fact_category: FactCategory | string;
  readonly statement: string;
  readonly normalized_value_json?: string | null;
  readonly verification_status: FactVerificationStatus;
  readonly confidence: number;
  readonly applicability: FactApplicability;
  readonly observed_at?: string | null;
  readonly valid_until?: string | null;
  readonly evidence_refs: readonly FactEvidenceRef[];
  readonly created_at: string;
}

// ── customer_hypotheses ──

export type HypothesisStatus = 'PENDING' | 'PARTIALLY_CONFIRMED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';

export interface HypothesisStatusAuditEntry {
  readonly at: string;
  readonly old_status: HypothesisStatus;
  readonly new_status: HypothesisStatus;
  readonly by: string;
  readonly reason: string | null;
}

export interface CustomerHypothesisRow {
  readonly id: string;
  readonly customer_id: string;
  readonly source_import_id: string | null;
  readonly category: string;
  readonly statement: string;
  readonly rationale: string | null;
  readonly status: HypothesisStatus;
  readonly applicability: FactApplicability;
  readonly why_it_matters: string | null;
  readonly validation_question: string | null;
  readonly disconfirm_condition: string | null;
  readonly evidence_refs_json: string;
  readonly status_audit_json: string;
  readonly created_at: string;
  readonly resolved_at: string | null;
  readonly updated_at: string;
}

export interface CustomerHypothesisInput {
  readonly id: string;
  readonly customer_id: string;
  readonly source_import_id: string | null;
  readonly category: string;
  readonly statement: string;
  readonly rationale?: string | null;
  readonly status: HypothesisStatus;
  readonly applicability: FactApplicability;
  readonly why_it_matters?: string | null;
  readonly validation_question?: string | null;
  readonly disconfirm_condition?: string | null;
  readonly evidence_refs: readonly FactEvidenceRef[];
  readonly created_at: string;
}

// ── customer_stage_cards ──

export type StageCardStatus = 'DRAFT' | 'CONFIRMED';
export type StageCardGeneratedBy = 'DETERMINISTIC' | 'MODEL_ENHANCED' | 'MANUAL';

export interface CustomerStageCardRow {
  readonly id: string;
  readonly customer_id: string;
  readonly stage_code: string;
  readonly version: number;
  readonly schema_version: string;
  readonly card_status: StageCardStatus;
  readonly source_import_id: string | null;
  readonly supersedes_card_id: string | null;
  readonly payload_json: string;
  readonly evidence_snapshot_hash: string;
  readonly generated_by: StageCardGeneratedBy;
  readonly confirmed_by: string | null;
  readonly created_at: string;
  readonly confirmed_at: string | null;
}

export interface CustomerStageCardInput {
  readonly id: string;
  readonly customer_id: string;
  readonly stage_code: string;
  readonly version: number;
  readonly schema_version: string;
  readonly card_status: StageCardStatus;
  readonly source_import_id: string | null;
  readonly supersedes_card_id: string | null;
  readonly payload_json: string;
  readonly evidence_snapshot_hash: string;
  readonly generated_by: StageCardGeneratedBy;
  readonly confirmed_by: string | null;
  readonly created_at: string;
  readonly confirmed_at: string | null;
}

// ── 阶段作战卡闭合 Schema（payload_json）──

export const BATTLE_CARD_SCHEMA_VERSION = 'battle-card-payload-v1';

export interface ActionCardKeyHypothesis {
  readonly hypothesis_id: string;
  readonly statement: string;
  readonly status: HypothesisStatus;
  readonly applicability: FactApplicability | string;
  readonly why_it_matters: string | null;
  readonly validation_question: string | null;
  readonly disconfirm_condition: string | null;
  readonly evidence_refs: readonly string[];
}

/** 关键假设不足时的强制占位，禁止编造凑数。 */
export const KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER = '关键假设不足，仍需补充信息';

export interface ActionCard {
  readonly current_situation: string;
  readonly stage_goal: string;
  readonly stage_entry_criteria: readonly string[];
  readonly stage_exit_criteria: readonly string[];
  readonly confirmed_facts: readonly {
    readonly fact_id: string;
    readonly statement: string;
    readonly applicability: FactApplicability | string;
    readonly evidence_refs: readonly string[];
  }[];
  readonly key_hypotheses: readonly ActionCardKeyHypothesis[];
  readonly target_roles: readonly string[];
  readonly must_ask_questions: readonly string[];
  readonly next_best_action: {
    readonly target_role: string;
    readonly channel: string;
    readonly recommended_time: string;
    readonly objective: string;
    readonly opening: string;
    readonly questions: readonly string[];
    readonly success_signal: string;
    readonly failure_signal: string;
    readonly fallback_action: string;
  };
  readonly success_signal: string;
  readonly failure_signal: string;
  readonly risks: readonly string[];
  readonly do_not_say: readonly string[];
  readonly changes_since_previous_card: readonly string[];
  readonly confidence: string;
  readonly evidence_refs: readonly string[];
}

export interface FeishuValueStatement {
  /** 来自导入原文，永不被覆盖。 */
  readonly original: string;
  /** 默认等于 original；人工可替换，original 保留。 */
  readonly current: string;
  readonly short_spoken_version: string | null;
  readonly full_spoken_version: string | null;
  readonly wechat_version: string | null;
  readonly version_history: readonly { readonly at: string; readonly from: string; readonly to: string }[];
}

export interface SolutionScenario {
  readonly scenario_name: string;
  readonly applicability: FactApplicability | string;
  readonly business_objects: readonly string[];
  readonly problem_hypothesis: string;
  readonly feishu_role: string;
  readonly ai_role: string;
  readonly human_gate: string;
  readonly systems_not_replaced: readonly string[];
  readonly acceptance_metrics: readonly string[];
  readonly evidence_refs: readonly string[];
}

export interface PeerReference {
  readonly company_name: string;
  readonly comparison_level: string;
  readonly why_comparable: string;
  readonly reusable_pattern: string;
  readonly non_transferable_boundary: string;
  readonly source_refs: readonly string[];
}

export interface SolutionReferenceCard {
  readonly feishu_value_statement: FeishuValueStatement;
  readonly solution_scenarios: readonly SolutionScenario[];
  readonly human_review_boundaries: readonly string[];
  readonly peer_references: readonly PeerReference[];
  readonly counterexamples_and_boundaries: readonly string[];
  readonly poc_path: readonly string[];
  readonly acceptance_metrics: readonly string[];
  readonly evidence_refs: readonly string[];
}

export interface BattleCardPayload {
  readonly action_card: ActionCard;
  readonly solution_reference_card: SolutionReferenceCard;
}

// ── customers 指针字段 ──

export type CustomerBattleCardStatus = 'NONE' | 'DRAFT' | 'CONFIRMED' | 'REVIEW_DUE';

export interface CustomerBattleCardPointers {
  readonly current_stage_card_id: string | null;
  readonly battle_card_status: CustomerBattleCardStatus;
  readonly last_battle_review_at: string | null;
}

// ── 审计与版本快照 ──

export interface CardComparison {
  readonly previous_card_id: string | null;
  readonly current_card_id: string;
  readonly stage_code: string;
  readonly previous_version: number | null;
  readonly current_version: number;
  readonly changed_sections: readonly string[];
  readonly changes: readonly {
    readonly section: string;
    readonly path: string;
    readonly from: unknown;
    readonly to: unknown;
  }[];
}
