/**
 * Shared Applicability Contract — 100+ golden vectors parity（TypeScript 侧）。
 * 与 Rust 测试（battle_card_authoritative.rs contract vectors）读取同一 JSON 合同，
 * 两端必须全部通过。
 */
import { describe, expect, it } from 'vitest';
import { APPLICABILITY_CONTRACT, determineApplicabilityByContract, detectCompositeBusinessByContract, isFormulaConditionalByContract } from '../lib/battleCard/applicabilityContract';

describe('battle-card-applicability-v1 shared contract (TS)', () => {
  it('contract version is battle-card-applicability-v1', () => {
    expect(APPLICABILITY_CONTRACT.contract_version).toBe('battle-card-applicability-v1');
  });

  it('golden vectors count >= 100', () => {
    expect(APPLICABILITY_CONTRACT.golden_vectors.length).toBeGreaterThanOrEqual(100);
  });

  it('every golden vector passes (composite context = true)', () => {
    for (const vector of APPLICABILITY_CONTRACT.golden_vectors) {
      const actual = determineApplicabilityByContract(vector.statement, true);
      expect(actual, `statement: ${vector.statement}`).toBe(vector.expected);
    }
  });

  it('every golden vector passes (composite context = false)', () => {
    for (const vector of APPLICABILITY_CONTRACT.golden_vectors) {
      const actual = determineApplicabilityByContract(vector.statement, false);
      expect(actual, `statement: ${vector.statement}`).toBe(vector.expected);
    }
  });

  it('VOC case variants are identical across normalization (P1-B regression)', () => {
    expect(determineApplicabilityByContract('VOC数据回流给产品团队。', true)).toBe('CONDITIONAL');
    expect(determineApplicabilityByContract('voc数据回流给产品团队。', true)).toBe('CONDITIONAL');
    expect(determineApplicabilityByContract('Voc 分析报告。', true)).toBe('CONDITIONAL');
    expect(isFormulaConditionalByContract('产品配方温和。')).toBe(true);
    expect(isFormulaConditionalByContract('配方有产品线依据。')).toBe(false);
  });

  it('composite fallback rules', () => {
    expect(detectCompositeBusinessByContract('功效、内容、达人、版本、电压并存')).toBe(true);
    expect(detectCompositeBusinessByContract('功效与内容')).toBe(false);
    expect(determineApplicabilityByContract('公司专注消费电子。', false)).toBe('CONDITIONAL');
    expect(determineApplicabilityByContract('公司专注消费电子。', true)).toBe('GLOBAL');
  });
});
