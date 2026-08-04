/**
 * Battle Card UI — UTF-8 字节工具。
 * 与后端 confirmedWrite.ts 使用同一编码契约（new TextEncoder().encode(...).byteLength）。
 */

/** UTF-8 字节数（与 SHA-256 输入使用同一编码）。 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export const MAX_PROPOSAL_ENVELOPE_BYTES = 262_144;

/**
 * 导入输入的前端硬门禁：原始材料本身超过单 Proposal 上限时禁止进入 Preview。
 * 后端在 Proposal 注册时仍会以权威 Envelope 字节上限二次拦截。
 */
export function assertImportRawWithinProposalLimit(rawContent: string): void {
  const bytes = utf8ByteLength(rawContent);
  if (bytes > MAX_PROPOSAL_ENVELOPE_BYTES) {
    throw new Error(`战前材料过大（${bytes.toLocaleString()} 字节），超过单 Proposal 上限 256 KiB（262,144 字节）。请拆分材料后分批导入。`);
  }
}

export function formatByteCount(text: string): string {
  const bytes = utf8ByteLength(text);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}
