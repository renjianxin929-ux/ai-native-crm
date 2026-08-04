/**
 * Battle Card Applicability Contract v1 — TypeScript 侧读取器。
 * 单一事实源：src/lib/battleCard/applicability-contract-v1.json
 * （Rust 侧 battle_card_authoritative.rs 通过 include_str! 读取同一文件）。
 * 禁止维护第二份词表。
 */

import contractJson from './applicability-contract-v1.json';

export interface ApplicabilityContractV1 {
  readonly contract_version: string;
  readonly normalization: { readonly mode: string };
  readonly precedence: readonly string[];
  readonly terms: {
    readonly GLOBAL: readonly string[];
    readonly PARTIAL: readonly string[];
    readonly CONDITIONAL: readonly string[];
    readonly UNSUPPORTED: readonly string[];
  };
  readonly formula_priority: {
    readonly formula_terms: readonly string[];
    readonly product_line_basis_terms: readonly string[];
  };
  readonly composite_fallback: {
    readonly composite_terms: readonly string[];
    readonly composite_threshold: number;
  };
  readonly golden_vectors: readonly { readonly statement: string; readonly expected: string }[];
}

export const APPLICABILITY_CONTRACT: ApplicabilityContractV1 = contractJson as ApplicabilityContractV1;

export const APPLICABILITY_CONTRACT_VERSION = APPLICABILITY_CONTRACT.contract_version;

export function contractNormalize(text: string): string {
  return text.toLowerCase();
}

/** 配方/成分优先规则（FORMULA_CONDITIONAL）。 */
export function isFormulaConditionalByContract(statement: string): boolean {
  const text = contractNormalize(statement);
  const { formula_terms, product_line_basis_terms } = APPLICABILITY_CONTRACT.formula_priority;
  const hasFormula = formula_terms.some(term => text.includes(contractNormalize(term)));
  const hasProductLineBasis = product_line_basis_terms.some(term => text.includes(contractNormalize(term)));
  return hasFormula && !hasProductLineBasis;
}

/** 复合业务判定（材料全文）。 */
export function detectCompositeBusinessByContract(text: string): boolean {
  const normalized = contractNormalize(text);
  const { composite_terms, composite_threshold } = APPLICABILITY_CONTRACT.composite_fallback;
  const hits = composite_terms.filter(term => normalized.includes(contractNormalize(term)));
  return hits.length >= composite_threshold;
}

export type ContractApplicability = 'GLOBAL' | 'PARTIAL' | 'CONDITIONAL' | 'UNSUPPORTED';

/**
 * 合同驱动的权威适用性判定。优先级（precedence）：
 * FORMULA_CONDITIONAL → GLOBAL → PARTIAL → CONDITIONAL → UNSUPPORTED → COMPOSITE_FALLBACK。
 * 与 Rust authoritative_applicability 逐字同源（同一 JSON + 同一归一化）。
 */
export function determineApplicabilityByContract(statement: string, contextComposite: boolean): ContractApplicability {
  const text = contractNormalize(statement);
  const { terms } = APPLICABILITY_CONTRACT;
  if (isFormulaConditionalByContract(statement)) return 'CONDITIONAL';
  if (terms.GLOBAL.some(term => text.includes(contractNormalize(term)))) return 'GLOBAL';
  if (terms.PARTIAL.some(term => text.includes(contractNormalize(term)))) return 'PARTIAL';
  if (terms.CONDITIONAL.some(term => text.includes(contractNormalize(term)))) return 'CONDITIONAL';
  if (terms.UNSUPPORTED.some(term => text.includes(contractNormalize(term)))) return 'UNSUPPORTED';
  return contextComposite ? 'GLOBAL' : 'CONDITIONAL';
}
