/**
 * Battle Card — 最终状态推导（TS 测试后端与 Rust derive_verification_status 同一规则）。
 */

export function deriveVerificationStatusForWriteSet(input: {
  readonly decision: 'KEEP' | 'VERIFY';
  readonly applicability: string;
  readonly hasScopeOrProductLine: boolean;
  /** Primary Import Source Evidence 是否存在（Rust 自动生成；VERIFY 必须存在）。 */
  readonly primaryEvidencePresent: boolean;
}): 'PENDING' | 'VERIFIED' {
  if (input.decision === 'KEEP') return 'PENDING';
  if (!input.primaryEvidencePresent) {
    throw new Error('Import confirm rejected: VERIFY requires authoritative Import Source Evidence.');
  }
  if (input.applicability === 'CONDITIONAL') {
    if (!input.hasScopeOrProductLine) {
      throw new Error('Import confirm rejected: CONDITIONAL fact requires applicable_scope/product_line before VERIFIED.');
    }
    return 'VERIFIED';
  }
  if (input.applicability === 'GLOBAL' || input.applicability === 'PARTIAL') return 'VERIFIED';
  throw new Error(`Import confirm rejected: unsupported authoritative applicability ${input.applicability}.`);
}
