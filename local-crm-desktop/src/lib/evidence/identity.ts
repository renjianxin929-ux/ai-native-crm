/**
 * V0.2B / B1 — Evidence 确定性身份与指纹（dedup 基础）。
 *
 * 任务 §6 / §9：
 *   - content_hash = SHA-256(summary + '\n' + excerpt)（确定性、从已存内容推导、不可伪造）；
 *   - dedup 身份 = customer_id + source_type + source_identity + content_hash；
 *   - 语义相似度去重（vector/embedding）明确不在 B1（未来 seam）。
 */

import type { EvidenceSourceType } from './types';

/** 与 battleCard/repository.ts 相同的 SHA-256（TextEncoder + WebCrypto），模块内自包含。 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 确定性内容指纹：SHA-256(summary + '\n' + (excerpt ?? ''))。
 * - 同页同内容 → 同 hash（dedup 命中）；
 * - 同页改内容 → 不同 hash（新证据行）；
 * - 不同页相似文本 → 不同 source_identity（新证据行；语义去重为未来工作）。
 */
export async function computeContentHash(summary: string, excerpt: string | null): Promise<string> {
  const canonical = excerpt && excerpt.length > 0 ? `${summary}\n${excerpt}` : summary;
  return sha256Hex(canonical);
}

/**
 * 确定性来源身份：source_type + ':' + (source_url ?? source_ref)。
 * 调用方必须保证 provenance 已通过 policy 校验（url/ref 至少一个非空）。
 */
export function sourceIdentity(
  sourceType: EvidenceSourceType,
  sourceUrl: string | null,
  sourceRef: string | null,
): string {
  const url = sourceUrl?.trim() ?? '';
  const ref = sourceRef?.trim() ?? '';
  const locator = url.length > 0 ? url : ref;
  return `${sourceType}:${locator}`;
}

/**
 * 语义去重 seam（未来 B3/B4）：B1 明确不做 vector/embedding 相似度。
 * 当前唯一真实语义 = 确定性指纹 + 确定性来源身份。
 */
export const SEMANTIC_DEDUP_IMPLEMENTED = false as const;
