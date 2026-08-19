/**
 * V0.2B / B1 — Evidence Raw Content & Provenance Policy（fail-closed）。
 *
 * 任务 §8 / §10：
 *   - 不自动存储整页 HTML / 网页正文；
 *   - 只存有界 summary、有界 excerpt、content hash、来源引用；
 *   - 缺失必需 provenance 时 fail closed（拒绝写入）。
 *
 * "AI 说 X" 不够；"AI 基于来源 Y、在时间 Z 捕获说 X" 才可审计。
 */

import type { EvidenceSourceType } from './types';

/** 原始内容策略：只允许有界摘要 + 有界摘录 + 指纹 + 来源引用。 */
export const EVIDENCE_RAW_CONTENT_POLICY = 'BOUNDED_SUMMARY_EXCERPT_ONLY' as const;

/** MAX_PAYLOAD_POLICY：单条证据允许存下的总字符预算（summary + excerpt 上限，比单项之和更严格）。 */
export const EVIDENCE_MAX_PAYLOAD_CHARS = 5000;

/** SUMMARY_POLICY：有界摘要上限。 */
export const EVIDENCE_MAX_SUMMARY_CHARS = 2000;

/** EXCERPT_POLICY：有界摘录上限（verbatim 切片）。 */
export const EVIDENCE_MAX_EXCERPT_CHARS = 4000;

export const EVIDENCE_MAX_SOURCE_URL_CHARS = 2048;
export const EVIDENCE_MAX_SOURCE_TITLE_CHARS = 500;
export const EVIDENCE_MAX_SOURCE_REF_CHARS = 2048;

/** 证据来源类型闭合集合（用于校验，永不外扩除非架构决策）。 */
export const EVIDENCE_SOURCE_TYPES: readonly EvidenceSourceType[] = Object.freeze([
  'URL',
  'IMPORT',
  'MANUAL',
]);

export type EvidencePolicyErrorCode =
  | 'MISSING_CUSTOMER_ID'
  | 'MISSING_SOURCE_TYPE'
  | 'UNKNOWN_SOURCE_TYPE'
  | 'MISSING_PROVENANCE'
  | 'MISSING_CAPTURED_AT'
  | 'INVALID_CAPTURED_AT'
  | 'MISSING_SUMMARY'
  | 'SUMMARY_TOO_LONG'
  | 'EXCERPT_TOO_LONG'
  | 'PAYLOAD_TOO_LONG'
  | 'SOURCE_URL_TOO_LONG'
  | 'SOURCE_TITLE_TOO_LONG'
  | 'SOURCE_REF_TOO_LONG'
  | 'SOURCE_URL_REQUIRED_FOR_URL_TYPE';

export class EvidencePolicyError extends Error {
  readonly code: EvidencePolicyErrorCode;

  constructor(code: EvidencePolicyErrorCode, message: string) {
    super(message);
    this.name = 'EvidencePolicyError';
    this.code = code;
  }
}

function requireText(value: unknown, code: EvidencePolicyErrorCode, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EvidencePolicyError(code, `${label} is required (fail closed).`);
  }
  return value.trim();
}

function boundText(
  value: string | null | undefined,
  maxChars: number,
  code: EvidencePolicyErrorCode,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new EvidencePolicyError(code, `${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxChars) {
    throw new EvidencePolicyError(code, `${label} exceeds ${maxChars} chars (got ${trimmed.length}).`);
  }
  return trimmed;
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export interface NormalizedEvidenceInput {
  readonly id: string;
  readonly customer_id: string;
  readonly source_type: EvidenceSourceType;
  readonly source_url: string | null;
  readonly source_title: string | null;
  readonly source_ref: string | null;
  readonly captured_at: string;
  readonly summary: string;
  readonly excerpt: string | null;
}

/**
 * 归一化 + 校验创建输入（fail-closed provenance 门）。
 * - customer_id / source_type / captured_at / summary 必需；
 * - source_type === 'URL' 时 source_url 必需；
 * - 至少存在一个来源定位符（source_url 或 source_ref）；
 * - summary/excerpt 有界，总量 ≤ MAX_PAYLOAD。
 */
export function normalizeEvidenceInput(input: {
  readonly id: string;
  readonly customer_id: string;
  readonly source_type: EvidenceSourceType;
  readonly source_url?: string | null;
  readonly source_title?: string | null;
  readonly source_ref?: string | null;
  readonly captured_at: string;
  readonly summary: string;
  readonly excerpt?: string | null;
}): NormalizedEvidenceInput {
  const id = requireText(input.id, 'MISSING_CUSTOMER_ID', 'evidence.id');
  const customer_id = requireText(input.customer_id, 'MISSING_CUSTOMER_ID', 'customer_id');
  const source_type = input.source_type;
  if (!EVIDENCE_SOURCE_TYPES.includes(source_type)) {
    throw new EvidencePolicyError('UNKNOWN_SOURCE_TYPE', `source_type "${String(source_type)}" is not a closed Evidence source type.`);
  }
  const captured_at = requireText(input.captured_at, 'MISSING_CAPTURED_AT', 'captured_at');
  if (!isValidTimestamp(captured_at)) {
    throw new EvidencePolicyError('INVALID_CAPTURED_AT', 'captured_at must be a valid ISO timestamp.');
  }
  const summary = requireText(input.summary, 'MISSING_SUMMARY', 'summary');
  if (summary.length > EVIDENCE_MAX_SUMMARY_CHARS) {
    throw new EvidencePolicyError('SUMMARY_TOO_LONG', `summary exceeds ${EVIDENCE_MAX_SUMMARY_CHARS} chars.`);
  }

  const source_url = boundText(input.source_url, EVIDENCE_MAX_SOURCE_URL_CHARS, 'SOURCE_URL_TOO_LONG', 'source_url');
  const source_title = boundText(input.source_title, EVIDENCE_MAX_SOURCE_TITLE_CHARS, 'SOURCE_TITLE_TOO_LONG', 'source_title');
  const source_ref = boundText(input.source_ref, EVIDENCE_MAX_SOURCE_REF_CHARS, 'SOURCE_REF_TOO_LONG', 'source_ref');
  const excerpt = boundText(input.excerpt, EVIDENCE_MAX_EXCERPT_CHARS, 'EXCERPT_TOO_LONG', 'excerpt');

  if (source_type === 'URL' && !source_url) {
    throw new EvidencePolicyError('SOURCE_URL_REQUIRED_FOR_URL_TYPE', 'source_type URL requires a non-empty source_url (fail closed).');
  }
  if (!source_url && !source_ref) {
    throw new EvidencePolicyError('MISSING_PROVENANCE', 'Evidence provenance requires at least one of source_url or source_ref (fail closed).');
  }
  if (summary.length + (excerpt?.length ?? 0) > EVIDENCE_MAX_PAYLOAD_CHARS) {
    throw new EvidencePolicyError('PAYLOAD_TOO_LONG', `payload (summary + excerpt) exceeds ${EVIDENCE_MAX_PAYLOAD_CHARS} chars.`);
  }

  return {
    id,
    customer_id,
    source_type,
    source_url,
    source_title,
    source_ref,
    captured_at,
    summary,
    excerpt,
  };
}
