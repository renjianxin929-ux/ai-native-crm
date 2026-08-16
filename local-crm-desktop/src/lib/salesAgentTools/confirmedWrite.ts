export const AGENT_WRITE_TOOL_IDS = ['create_follow_up_record', 'create_visit_record', 'create_customer', 'create_task', 'update_task', 'update_task_status', 'update_next_follow_up_time', 'update_customer_profile', 'update_customer_basic_fields', 'update_contact_basic_fields', 'confirm_battle_intelligence_import', 'confirm_stage_card', 'update_hypothesis_status', 'delete_customer', 'update_opportunity_amount'] as const;
export type AgentWriteToolId = typeof AGENT_WRITE_TOOL_IDS[number];

// ── Fact Verifications 闭合运行时 Schema（唯一权威结构校验）──

export const FACT_VERIFICATION_DECISIONS = ['KEEP', 'VERIFY'] as const;
export type FactVerificationDecision = typeof FACT_VERIFICATION_DECISIONS[number];

export const FACT_VERIFICATION_APPLICABILITY = ['GLOBAL', 'PARTIAL', 'CONDITIONAL', 'UNSUPPORTED'] as const;
export type FactVerificationApplicability = typeof FACT_VERIFICATION_APPLICABILITY[number];

export const FACT_VERIFICATION_ITEM_FIELDS = ['fact_id', 'decision', 'applicability', 'applicable_scope', 'product_line', 'evidence_refs', 'reason'] as const;

export const FACT_VERIFICATION_EVIDENCE_TYPES = ['CUSTOMER', 'FOLLOW_UP_RECORD', 'VISIT_RECORD', 'TASK'] as const;

/** Canonical Proposal Snapshot 的 Schema 版本（hash 输入之一；旧格式 hash 不会被误解释）。 */
export const PROPOSAL_SCHEMA_VERSION = 'battle-card-proposal-v2';
/** Snapshot 闭合 Envelope 的 Schema 版本。 */
export const SNAPSHOT_SCHEMA_VERSION = 'canonical-proposal-snapshot-v1';
/** Hash 算法标识（闭合 Envelope 字段；未知算法拒绝，不降级）。 */
export const HASH_ALGORITHM = 'SHA-256';

/** Registry 唯一真源：canonical Envelope JSON + hash；不保存调用者可变引用。 */
export interface CanonicalProposalSnapshot {
  readonly snapshot_schema_version: string;
  readonly proposal_schema_version: string;
  readonly hash_algorithm: string;
  readonly canonical_envelope_json: string;
  readonly proposal_hash: string;
  readonly proposal_id: string;
  readonly customer_id: string;
  readonly tool_id: string;
  readonly nonce: string;
  readonly created_at: string;
}

/**
 * Canonical Proposal Envelope 总字节上限（UTF-8 bytes）。
 * - 当前单 Proposal 最大 256 KiB（262,144 bytes）
 * - 超限操作必须拆分（拆分属资源与人工确认边界）
 * - 上限是单 Proposal 资源限制，不是 CRM 数据库总容量限制
 */
export const MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES = 262_144;

/** 超限错误（脱敏：不包含任何 payload 内容）。 */
export const PROPOSAL_ENVELOPE_TOO_LARGE = `Canonical proposal envelope exceeds the ${MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES}-byte limit (UTF-8); split the operation and retry.`;

/** UTF-8 字节数（与 SHA-256 输入使用同一编码：new TextEncoder().encode(...).byteLength）。 */
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * 纯函数：注册侧与 Confirm 侧共用同一权威上限与同一 UTF-8 编码（不得复制另一份数值）。
 * 超限立即抛错（不输出 payload、不静默截断、不自动拆分、不进入 SHA-256）。
 */
export function assertCanonicalEnvelopeByteLimit(canonicalEnvelopeJson: string): void {
  if (utf8ByteLength(canonicalEnvelopeJson) > MAX_CANONICAL_PROPOSAL_ENVELOPE_BYTES) {
    throw new Error(PROPOSAL_ENVELOPE_TOO_LARGE);
  }
}

// ── SHA-256（同步，FIPS 180-4；无依赖，与 Web Crypto 交叉验证）──

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function sha256Rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** UTF-8 编码（含 surrogate pair 处理）。 */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const low = input.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        const cp = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        index += 1;
      } else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/**
 * 同步 SHA-256（FIPS 180-4）：UTF-8 → SHA-256 → 固定 64 位小写 hex。
 * 生产/测试双环境同步可用（Web Crypto subtle.digest 为异步，会迫使 Registry 全链 async 化）。
 * 正确性：与 crypto.subtle 交叉验证 + NIST 官方向量（见 crypto tests）。
 */
export function sha256HexSync(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >> 6) << 6) + 64;
  const message = new Uint8Array(paddedLen);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  const h = new Uint32Array(SHA256_H0);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = sha256Rotr(w[t - 15]!, 7) ^ sha256Rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = sha256Rotr(w[t - 2]!, 17) ^ sha256Rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let t = 0; t < 64; t++) {
      const s1 = sha256Rotr(e, 6) ^ sha256Rotr(e, 11) ^ sha256Rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[t]! + w[t]!) >>> 0;
      const s0 = sha256Rotr(a, 2) ^ sha256Rotr(a, 13) ^ sha256Rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return Array.from(h, word => word.toString(16).padStart(8, '0')).join('');
}

/** 闭合 Schema 的 canonical plain object；任何未知根/嵌套字段都不存在。 */
export interface FactVerificationItem {
  readonly fact_id: string;
  readonly decision: FactVerificationDecision;
  readonly applicability?: FactVerificationApplicability;
  readonly applicable_scope?: string;
  readonly product_line?: string;
  readonly evidence_refs?: readonly string[];
  readonly reason?: string;
}

const MAX_FACT_VERIFICATION_ITEMS = 100;
const MAX_STRING_LENGTH = 512;
const MAX_EVIDENCE_REFS = 20;
const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FACT_VERIFICATION_ITEM_FIELD_SET = new Set<string>(FACT_VERIFICATION_ITEM_FIELDS);
const FACT_VERIFICATION_EVIDENCE_TYPE_SET = new Set<string>(FACT_VERIFICATION_EVIDENCE_TYPES);

/** 构造期可变形态（canonical 输出仍为只读 FactVerificationItem）。 */
interface MutableFactVerificationItem {
  fact_id: string;
  decision: FactVerificationDecision;
  applicability?: FactVerificationApplicability;
  applicable_scope?: string;
  product_line?: string;
  evidence_refs?: readonly string[];
  reason?: string;
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  // 仅接受 Object.prototype 原型：Object.create(null) / class instance / Date / Map / Set / Proxy(getPrototypeOf trap 非 Object.prototype) 一律拒绝
  return Object.getPrototypeOf(value) === Object.prototype;
}

/** accessor 检查：getter/setter 直接拒绝，绝不读取 accessor 值（getterCalls 保持 0）。 */
function assertNoAccessors(value: object, path: string): void {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = descriptors[key];
    if (descriptor && (typeof descriptor.get === 'function' || typeof descriptor.set === 'function')) {
      throw new Error(`${path} must not contain accessor property: ${key}`);
    }
  }
}

function requireString(value: unknown, field: string, max = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string') throw new Error(`fact_verification ${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`fact_verification ${field} must not be empty.`);
  if (value.length > max) throw new Error(`fact_verification ${field} exceeds max length ${max}.`);
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`fact_verification ${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** 字符串不得承载 JSON 指令（对象/数组字面量）或控制字符。 */
function requireJsonSafeString(value: unknown, field: string): string {
  const result = requireString(value, field);
  const trimmed = result.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && canParseJson(trimmed)) {
    throw new Error(`fact_verification ${field} must not carry a JSON payload.`);
  }
  if (/[\u0000-\u001f]/.test(result)) throw new Error(`fact_verification ${field} must not contain control characters.`);
  return result;
}

function canParseJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function parseEvidenceRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('fact_verification evidence_refs must be an array.');
  if (value.length > MAX_EVIDENCE_REFS) throw new Error(`fact_verification evidence_refs exceeds max length ${MAX_EVIDENCE_REFS}.`);
  const seen = new Set<string>();
  const refs: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) throw new Error('fact_verification evidence_refs must not be sparse.');
    const ref = requireString(value[index], `evidence_refs[${index}]`, 256);
    if (!/^(import|CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):.+/.test(ref)) {
      throw new Error(`fact_verification evidence_ref ${ref.slice(0, 40)} must use import: or a CRM evidence type prefix.`);
    }
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }
  return Object.freeze(refs); // 嵌套数组必须冻结：杜绝注册后 push 共享引用
}

// ── Canonical Snapshot 核心（plain-data graph / deterministic JSON / hash）──

/** 递归 plain-data graph 验证：仅普通对象（Object.prototype 原型）+ 非稀疏数组 + JSON 原始值。 */
export function assertPlainDataGraph(value: unknown, seen = new WeakSet<object>(), path = 'root'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Canonical payload ${path} must not contain NaN/Infinity.`);
    return;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`Canonical payload ${path} must not contain ${typeof value}.`);
  }
  if (typeof value !== 'object') throw new Error(`Canonical payload ${path} has unsupported type ${typeof value}.`);
  if (seen.has(value)) throw new Error(`Canonical payload ${path} contains a circular reference.`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new Error(`Canonical payload ${path} must not be sparse.`);
      assertPlainDataGraph(value[index], seen, `${path}[${index}]`);
    }
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype) {
    // Object.create(null) / class instance / Date / Map / Set / RegExp / Error / Promise / typed arrays / ArrayBuffer / Proxy(getPrototypeOf trap 返回非 Object.prototype) 一律拒绝
    throw new Error(`Canonical payload ${path} must be a plain object (Object.prototype prototype).`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) throw new Error(`Canonical payload ${path} contains forbidden key: ${key}`);
    const descriptor = descriptors[key];
    if (descriptor && (typeof descriptor.get === 'function' || typeof descriptor.set === 'function')) {
      throw new Error(`Canonical payload ${path}.${key} must not be an accessor (getter/setter).`);
    }
    assertPlainDataGraph((value as Record<string, unknown>)[key], seen, `${path}.${key}`);
  }
}

/**
 * Deterministic canonical JSON：对象键稳定排序、数组保序；仅接受 Schema 允许的 JSON 数据。
 * undefined/function/Symbol/BigInt/NaN/Infinity/循环引用在 assertPlainDataGraph 已拒绝。
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJsonStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(key => `${JSON.stringify(key)}:${canonicalJsonStringify((value as Record<string, unknown>)[key])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error(`Canonical JSON does not support ${typeof value}.`);
}

/**
 * Canonical Envelope 构造：闭合结构（hash_algorithm / 双 schema version / canonical_payload），
 * 同一 deterministic serializer 序列化后作为 SHA-256 输入；杜绝简单拼接歧义。
 */
export function buildCanonicalEnvelope(payload: unknown): Record<string, unknown> {
  return {
    hash_algorithm: HASH_ALGORITHM,
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    proposal_schema_version: PROPOSAL_SCHEMA_VERSION,
    canonical_payload: payload,
  };
}

/**
 * SHA-256 hash（FIPS 180-4）：对闭合 Envelope 的 deterministic JSON 计算，固定 64 位小写 hex。
 * schemaVersion 参数进入 Envelope 的 proposal_schema_version 字段（版本变化 ⇒ hash 变化）。
 */
export function computeProposalHash(schemaVersion: string, canonicalPayloadJson: string): string {
  const envelope = buildCanonicalEnvelope(canonicalPayloadJson);
  envelope.proposal_schema_version = schemaVersion;
  return sha256HexSync(canonicalJsonStringify(envelope));
}

/** structuredClone 防护：透明 Proxy 会抛 DataCloneError → fail-closed（绝不回退原对象）。 */
export function cloneValidatedPayload<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error(`Canonical payload cannot be cloned (proxy or non-cloneable): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 从 AgentWriteProposal 提取 canonical payload 数据（不含 proposal_hash；hash 由 schema_version + canonical JSON 计算）。 */
function proposalPayloadOf(proposal: AgentWriteProposal): Record<string, unknown> {
  return {
    proposal_id: proposal.proposal_id,
    tool_id: proposal.tool_id,
    customer_id: proposal.customer_id,
    entity_type: proposal.entity_type,
    entity_id: proposal.entity_id ?? null,
    operation: proposal.operation,
    current_values: proposal.current_values,
    proposed_values: proposal.proposed_values,
    reason: proposal.reason,
    evidence_refs: proposal.evidence_refs,
    reversible: proposal.reversible,
    nonce: proposal.nonce ?? null,
    created_at: proposal.created_at,
    status: proposal.status,
    executable: proposal.executable,
    requires_confirmation: proposal.requires_confirmation,
    grouped_operations: proposal.grouped_operations ?? null,
  };
}

/** 从 AgentWriteProposal 构建 Registry 唯一真源 snapshot（canonical Envelope JSON + SHA-256）。 */
export function createCanonicalProposalSnapshot(proposal: AgentWriteProposal): CanonicalProposalSnapshot {
  const payload = proposalPayloadOf(proposal);
  assertPlainDataGraph(payload);
  const cloned = cloneValidatedPayload(payload);
  const envelope = buildCanonicalEnvelope(cloned);
  const envelopeJson = canonicalJsonStringify(envelope);
  // pre-hash 字节上限检查：超限不进入 SHA-256，不进入 Registry
  assertCanonicalEnvelopeByteLimit(envelopeJson);
  const proposalHash = sha256HexSync(envelopeJson);
  return Object.freeze({
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    proposal_schema_version: PROPOSAL_SCHEMA_VERSION,
    hash_algorithm: HASH_ALGORITHM,
    canonical_envelope_json: envelopeJson,
    proposal_hash: proposalHash,
    proposal_id: proposal.proposal_id,
    customer_id: proposal.customer_id,
    tool_id: proposal.tool_id,
    nonce: proposal.nonce ?? '',
    created_at: proposal.created_at,
  });
}

/**
 * 从 snapshot 重建全新执行对象（Confirm 唯一数据来源）：
 * 1) 验证 hash_algorithm === 'SHA-256'（未知算法拒绝，不降级）；
 * 2) 验证受支持的 snapshot_schema_version（未知版本拒绝，不猜测）；
 * 3) 对 canonical_envelope_json 重算 SHA-256 并与 proposal_hash 比较（不一致 fail-closed）；
 * 4) JSON.parse Envelope → 验证 Envelope 闭合字段 → 提取 canonical_payload；
 * 5) fact_verifications 同一 Runtime Schema 再验证；
 * 6) 返回新对象（不含 registry/调用者引用）。
 */
export function rebuildProposalFromSnapshot(snapshot: CanonicalProposalSnapshot): AgentWriteProposal {
  // 防御性字节上限检查（最先执行）：超限立即拒绝，不进入 SHA-256 / Runtime Schema / Semantic / Executor
  assertCanonicalEnvelopeByteLimit(snapshot.canonical_envelope_json);
  if (snapshot.hash_algorithm !== HASH_ALGORITHM) {
    throw new Error(`Canonical proposal hash algorithm unsupported (${snapshot.hash_algorithm}); confirmation rejected.`);
  }
  if (snapshot.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Canonical proposal snapshot schema unsupported (${snapshot.snapshot_schema_version}); confirmation rejected.`);
  }
  const recomputed = sha256HexSync(snapshot.canonical_envelope_json);
  if (recomputed !== snapshot.proposal_hash) {
    throw new Error('Canonical proposal hash mismatch; confirmation rejected.');
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(snapshot.canonical_envelope_json) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Canonical proposal envelope is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Envelope 闭合 Schema 验证（防止只用 payload JSON 在 Confirm 时另拼 Envelope）
  if (envelope.hash_algorithm !== HASH_ALGORITHM
    || envelope.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION
    || envelope.proposal_schema_version !== PROPOSAL_SCHEMA_VERSION
    || envelope.canonical_payload === undefined || envelope.canonical_payload === null) {
    throw new Error('Canonical proposal envelope schema is invalid; confirmation rejected.');
  }
  const p = envelope.canonical_payload as Record<string, unknown>;
  if (p.tool_id === 'confirm_battle_intelligence_import' && p.proposed_values !== undefined && p.proposed_values !== null) {
    const values = p.proposed_values as Record<string, unknown>;
    if (values.fact_verifications !== undefined) {
      values.fact_verifications = parseFactVerificationsRuntime(values.fact_verifications);
    }
  }
  const proposal: AgentWriteProposal = {
    proposal_id: String(p.proposal_id),
    proposal_hash: snapshot.proposal_hash,
    tool_id: p.tool_id as AgentWriteToolId,
    customer_id: String(p.customer_id),
    entity_type: p.entity_type as AgentWriteProposal['entity_type'],
    ...(p.entity_id ? { entity_id: String(p.entity_id) } : {}),
    operation: p.operation as AgentWriteProposal['operation'],
    current_values: (p.current_values ?? {}) as Record<string, unknown>,
    proposed_values: (p.proposed_values ?? {}) as Record<string, unknown>,
    reason: String(p.reason),
    evidence_refs: Array.isArray(p.evidence_refs) ? (p.evidence_refs as string[]) : [],
    reversible: p.reversible === true,
    ...(p.nonce ? { nonce: String(p.nonce) } : {}),
    created_at: String(p.created_at),
    status: 'awaiting_confirmation',
    executable: false,
    requires_confirmation: true,
    ...(p.grouped_operations ? { grouped_operations: p.grouped_operations as unknown as GroupedWriteOperation[] } : {}),
  };
  return proposal;
}

/**
 * 权威运行时结构校验（唯一入口）：返回新建 canonical plain object，绝不引用调用者输入。
 * 未知根字段 / 未知嵌套字段 / prototype pollution key / 稀疏数组 / 非 JSON 值一律拒绝（不 strip）。
 */
export function parseFactVerificationsRuntime(input: unknown): readonly FactVerificationItem[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('fact_verifications must be an array.');
  if (input.length > MAX_FACT_VERIFICATION_ITEMS) {
    throw new Error(`fact_verifications exceeds max items ${MAX_FACT_VERIFICATION_ITEMS}.`);
  }
  // 先对原始输入做 accessor 检查（不读取 accessor 值），再 structuredClone（proxy 探测）
  for (let index = 0; index < input.length; index++) {
    if (!(index in input)) throw new Error('fact_verifications must not be sparse.');
    const rawItem = input[index];
    if (!isPlainObject(rawItem)) {
      throw new Error(`fact_verifications[${index}] must be a plain object.`);
    }
    assertNoAccessors(rawItem, `fact_verifications[${index}]`);
  }
  // Proxy / 不可克隆对象探测：在读取任何属性值之前对原始输入 structuredClone（fail-closed，绝不回退原对象）
  let source: unknown[];
  try {
    source = structuredClone(input);
  } catch (error) {
    throw new Error(`fact_verifications contains a non-cloneable value (proxy or unsupported object): ${error instanceof Error ? error.message : String(error)}`);
  }
  const seenFactIds = new Set<string>();
  const items: FactVerificationItem[] = [];
  for (let index = 0; index < source.length; index++) {
    if (!(index in source)) throw new Error('fact_verifications must not be sparse.');
    const raw = source[index];
    if (!isPlainObject(raw)) {
      throw new Error(`fact_verifications[${index}] must be a plain object.`);
    }
    const record = raw as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) throw new Error(`fact_verifications[${index}] contains forbidden key: ${key}`);
      if (!FACT_VERIFICATION_ITEM_FIELD_SET.has(key)) {
        throw new Error(`fact_verifications[${index}] contains unknown field: ${key}`);
      }
    }
    const factId = requireString(record.fact_id, `fact_verifications[${index}].fact_id`, 128);
    const decision = requireEnum(record.decision, FACT_VERIFICATION_DECISIONS, `fact_verifications[${index}].decision`);
    if (seenFactIds.has(factId)) throw new Error(`fact_verifications contains duplicate fact_id: ${factId}`);
    seenFactIds.add(factId);
    const item: MutableFactVerificationItem = { fact_id: factId, decision };
    if (record.applicability !== undefined) {
      item.applicability = requireEnum(record.applicability, FACT_VERIFICATION_APPLICABILITY, `fact_verifications[${index}].applicability`);
    }
    if (record.applicable_scope !== undefined) item.applicable_scope = requireJsonSafeString(record.applicable_scope, `fact_verifications[${index}].applicable_scope`);
    if (record.product_line !== undefined) item.product_line = requireJsonSafeString(record.product_line, `fact_verifications[${index}].product_line`);
    if (record.evidence_refs !== undefined) item.evidence_refs = parseEvidenceRefs(record.evidence_refs);
    if (record.reason !== undefined) item.reason = requireJsonSafeString(record.reason, `fact_verifications[${index}].reason`);
    items.push(Object.freeze(item) as unknown as FactVerificationItem);
  }
  return Object.freeze(items);
}

export function isFactVerificationEvidenceRef(ref: string): boolean {
  const match = ref.match(/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):(.+)$/);
  if (!match) return false;
  return FACT_VERIFICATION_EVIDENCE_TYPE_SET.has(match[1] ?? '') && (match[2]?.length ?? 0) > 0;
}
export interface GroupedWriteOperation {
  readonly operation_id: string;
  readonly label: string;
  readonly tool_id: AgentWriteToolId;
  readonly current_values: Readonly<Record<string, unknown>>;
  readonly proposed_values: Readonly<Record<string, unknown>>;
  readonly selected: boolean;
}
export interface AgentWriteProposal {
  readonly proposal_id: string; readonly proposal_hash: string; readonly tool_id: AgentWriteToolId;
  readonly customer_id: string; readonly entity_type: 'customer' | 'contact' | 'follow_up' | 'visit' | 'task'; readonly entity_id?: string;
  readonly operation: 'create' | 'update' | 'delete'; readonly current_values: Readonly<Record<string, unknown>>; readonly proposed_values: Readonly<Record<string, unknown>>;
  readonly reason: string; readonly evidence_refs: readonly string[]; readonly reversible: boolean; readonly nonce?: string; readonly created_at: string;
  readonly status: 'awaiting_confirmation'; readonly executable: false; readonly requires_confirmation: true;
  readonly grouped_operations?: readonly GroupedWriteOperation[];
}
export interface ExactConfirmation { readonly proposal_id: string; readonly proposal_hash: string; readonly tool_id: AgentWriteToolId; readonly customer_id: string; readonly entity_id?: string; readonly payload_hash?: string; readonly nonce: string; readonly confirmed_at: string; }

const consumed = new Set<string>();
let proposalSequence = 0;
const allowedFields: Readonly<Record<AgentWriteToolId, readonly string[]>> = Object.freeze({
  create_follow_up_record: ['title', 'feedback_notes', 'next_follow_up_at'], create_visit_record: ['title', 'visit_notes', 'customer_concerns', 'intent_after_visit', 'visit_outcome', 'next_action', 'expected_contract_at'], create_task: ['title', 'due_at', 'status'], update_task: ['title', 'due_at'], update_task_status: ['status'], update_next_follow_up_time: ['next_follow_up_at'], update_customer_basic_fields: ['name', 'industry', 'address', 'phone'], update_contact_basic_fields: ['name', 'phone', 'email', 'position'],
  // W4-2 customer.profile.update：仅 16 个经审计的普通客户资料字段（与
  // CUSTOMER_PROFILE_UPDATE_KEYS / 能力绑定层输入白名单同一集合；测试断言一致）。
  // 刻意不包含规则自有信号（wechat_add_status / intent_level / phone_feedback）、
  // 派生/系统列（rough_visit_time_text 及其 parse 派生列）、调度/状态/支付/
  // 战斗卡字段。绝不复活 update_customer_basic_fields（死符号，allowedFields
  // 与资料契约不一致）——本工具身份只存在于 W4-2 确认链路。
  update_customer_profile: ['name', 'wechat_id', 'phone_number', 'wechat_search_status', 'is_key_decision_maker', 'contact_method', 'notes', 'website', 'region', 'industry', 'contact_person', 'email', 'address', 'pitch_angle', 'qualification_reason', 'source'],
  // W4-1 customer.create：仅人工"新增客户"表单的 20 个用户可编辑字段（与
  // CustomerForm 白名单一致；系统/规则/领域字段一律拒绝，见 create_customer 分支）。
  create_customer: ['name', 'wechat_id', 'phone_number', 'contact_method', 'wechat_search_status', 'is_key_decision_maker', 'wechat_add_status', 'intent_level', 'phone_feedback', 'rough_visit_time_text', 'notes', 'website', 'region', 'industry', 'contact_person', 'email', 'address', 'pitch_angle', 'qualification_reason', 'source'],
  // Battle Card V1 写工具（全部经 Proposal/Confirm/Replay 边界）
  confirm_battle_intelligence_import: ['raw_content', 'source_system', 'source_label', 'customer_id', 'keep_fact_ids', 'keep_hypothesis_ids', 'fact_overrides', 'fact_verifications', 'expected_version', 'idempotency_key'],
  confirm_stage_card: ['card_id', 'expected_version', 'idempotency_key'],
  update_hypothesis_status: ['hypothesis_id', 'new_status', 'reason', 'expected_version', 'idempotency_key'],
  // W4-4 customer.delete：硬删除无 proposed 字段（删除后无剩余字段；current_values
  // 携带被删除客户的 bounded 展示摘要）。空白名单 = 任何 proposed 字段都 fail closed。
  delete_customer: [],
  // C0 customer.opportunity_amount.update：仅一个窄义字段（期望商业金额）。
  // 绝不承载 customer_id / stage / grade / deal_amount 等任何其它列。
  update_opportunity_amount: ['opportunity_amount'],
});

export function validateAgentWriteProposal(proposal: AgentWriteProposal): void {
  if (!AGENT_WRITE_TOOL_IDS.includes(proposal.tool_id) || !proposal.customer_id.trim() || !proposal.proposal_id.trim() || !proposal.proposal_hash.trim() || (proposal.nonce !== undefined && !proposal.nonce.trim())) throw new Error('Write proposal identity is invalid.');
  if (proposal.status !== 'awaiting_confirmation' || proposal.executable !== false || !proposal.reason.trim()) throw new Error('Write proposal must remain awaiting exact confirmation.');
  const fields = Object.keys(proposal.proposed_values);
  // W4-4 customer.delete：硬删除的 proposed_values 合法为空（删除后无剩余字段）；
  // 其它写工具仍必须携带至少一个白名单字段。空白名单 delete_customer 使任何
  // 被走私进来的 proposed 字段都 fail closed（fields.some 命中空数组 → 拒绝）。
  const isHardDelete = proposal.tool_id === 'delete_customer' && proposal.operation === 'delete';
  if ((!isHardDelete && fields.length === 0) || fields.some(field => !allowedFields[proposal.tool_id].includes(field))) throw new Error('Write proposal includes a forbidden field.');
  // Confirm 执行前 fail-closed：fact_verifications 必须通过闭合运行时 Schema（与 Proposal 构造时同一版本）
  if (proposal.tool_id === 'confirm_battle_intelligence_import' && proposal.proposed_values.fact_verifications !== undefined) {
    parseFactVerificationsRuntime(proposal.proposed_values.fact_verifications);
  }
  if (proposal.grouped_operations) {
    if (proposal.grouped_operations.length < 2 || !proposal.grouped_operations.some(item => item.selected)) throw new Error('Grouped proposal must disclose at least two operations and select at least one.');
    const ids = new Set<string>();
    for (const item of proposal.grouped_operations) {
      if (!item.operation_id.trim() || ids.has(item.operation_id)) throw new Error('Grouped proposal operation identity is invalid.');
      ids.add(item.operation_id);
      const childFields = Object.keys(item.proposed_values);
      if (!AGENT_WRITE_TOOL_IDS.includes(item.tool_id) || childFields.length === 0 || childFields.some(field => !allowedFields[item.tool_id].includes(field))) throw new Error('Grouped proposal includes a forbidden operation.');
    }
  }
}

/** Consumes one exact proposal confirmation. The caller may invoke its existing Safe Write boundary only after this succeeds. */
export function consumeExactConfirmation(proposal: AgentWriteProposal, confirmation: ExactConfirmation): { readonly confirmation_id: string; readonly proposal: AgentWriteProposal } {
  validateAgentWriteProposal(proposal);
  if (consumed.has(confirmation.nonce)) throw new Error('Confirmation replay rejected.');
  if (!Number.isFinite(Date.parse(confirmation.confirmed_at)) || confirmation.confirmed_at < proposal.created_at) throw new Error('Confirmation timestamp is invalid.');
  if (confirmation.proposal_id !== proposal.proposal_id || confirmation.proposal_hash !== proposal.proposal_hash || confirmation.tool_id !== proposal.tool_id || confirmation.customer_id !== proposal.customer_id || confirmation.entity_id !== proposal.entity_id || confirmation.payload_hash !== proposal.proposal_hash || (proposal.nonce !== undefined && confirmation.nonce !== proposal.nonce) || !confirmation.nonce.trim()) throw new Error('Confirmation does not match the exact proposal.');
  consumed.add(confirmation.nonce);
  return { confirmation_id: confirmation.nonce, proposal };
}

/** Invalidate a cancelled proposal so the same nonce cannot be replayed later. */
export function isWriteConfirmationReplay(nonce: string | undefined): boolean {
  const normalized = nonce?.trim();
  if (!normalized) return false;
  return consumed.has(normalized);
}

export function invalidateWriteProposal(proposal: AgentWriteProposal): void {
  if (proposal.nonce) consumed.add(proposal.nonce);
}

export interface BuildWriteProposalInput {
  readonly customer_id: string;
  readonly message: string;
  readonly evidence_refs: readonly string[];
  readonly created_at: string;
  readonly current_values?: Readonly<Record<string, unknown>>;
  /** Session-owned tool selection — never re-inferred from weekday tokens in React. */
  readonly tool_id?: AgentWriteToolId;
  readonly proposed_values?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly grouped_operations?: readonly GroupedWriteOperation[];
  /** 显式操作语义（默认 create/update 由 tool_id 派生）；W4-4 delete 必须显式声明。 */
  readonly operation?: AgentWriteProposal['operation'];
  /** 可回滚声明（默认 true）；W4-4 硬删除必须显式 false。 */
  readonly reversible?: boolean;
}

/** Offline parsing is deliberately bounded and owned by the session layer, never React. */
export function buildWriteProposal(input: BuildWriteProposalInput): AgentWriteProposal {
  const text = input.message.trim();
  const tool_id: AgentWriteToolId = input.tool_id
    ?? (/task|待办|提醒/.test(text.toLowerCase()) ? 'create_task'
      : /next\s*follow|下次.*跟进|更新.*跟进|改.*跟进/.test(text.toLowerCase()) ? 'update_next_follow_up_time'
        : 'create_follow_up_record');

  let proposed_values: Readonly<Record<string, unknown>>;
  if (input.proposed_values !== undefined) {
    // 闭合运行时 Schema：构造时即 canonical 化（非法载荷在 Proposal 注册前被拒绝）
    if (tool_id === 'confirm_battle_intelligence_import' && input.proposed_values.fact_verifications !== undefined) {
      const canonical = parseFactVerificationsRuntime(input.proposed_values.fact_verifications);
      proposed_values = { ...input.proposed_values, fact_verifications: canonical };
    } else {
      proposed_values = input.proposed_values;
    }
  } else if (tool_id === 'create_task') {
    proposed_values = { title: text, status: 'OPEN' };
  } else if (tool_id === 'update_next_follow_up_time') {
    const schedule = parseProposedSchedule(text, input.created_at);
    if (!schedule) throw new Error('A deterministic proposed follow-up schedule is required before confirmation.');
    proposed_values = { next_follow_up_at: schedule };
  } else {
    proposed_values = { title: '跟进记录', feedback_notes: text };
  }

  const current_values = input.current_values ?? {};
  if (tool_id === 'update_next_follow_up_time' && !Object.prototype.hasOwnProperty.call(current_values, 'next_follow_up_at')) {
    throw new Error('The stored next follow-up value is required before confirmation.');
  }
  if (tool_id === 'update_next_follow_up_time' && typeof proposed_values.next_follow_up_at !== 'string') {
    throw new Error('A deterministic proposed follow-up schedule is required before confirmation.');
  }

  const nonce = `proposal:${input.customer_id}:${tool_id}:${input.created_at}:${++proposalSequence}`;
  const operation: AgentWriteProposal['operation'] = input.operation ?? (tool_id.startsWith('create') ? 'create' : 'update');
  const reversible = input.reversible ?? true;
  const proposal: AgentWriteProposal = {
    proposal_id: `proposal-${input.created_at}-${proposalSequence}`,
    proposal_hash: '',
    tool_id,
    customer_id: input.customer_id,
    entity_type: tool_id === 'create_task' ? 'task' : tool_id === 'create_follow_up_record' ? 'follow_up' : tool_id === 'create_visit_record' ? 'visit' : 'customer',
    ...(tool_id === 'update_next_follow_up_time' ? { entity_id: input.customer_id } : {}),
    operation,
    current_values,
    proposed_values,
    reason: input.reason ?? '用户本次明确指令',
    evidence_refs: input.evidence_refs,
    reversible,
    nonce,
    created_at: input.created_at,
    status: 'awaiting_confirmation',
    executable: false,
    requires_confirmation: true,
    ...(input.grouped_operations ? { grouped_operations: input.grouped_operations } : {}),
  };
  // Hash 与 Canonical Snapshot 同源：闭合 Envelope（hash_algorithm + 双 schema version + payload）→ SHA-256
  const payload = proposalPayloadOf(proposal);
  assertPlainDataGraph(payload);
  const cloned = cloneValidatedPayload(payload);
  const envelopeJson = canonicalJsonStringify(buildCanonicalEnvelope(cloned));
  // pre-hash 字节上限检查：超限不进入 SHA-256（与 snapshot 路径同一权威函数）
  assertCanonicalEnvelopeByteLimit(envelopeJson);
  const proposalHash = sha256HexSync(envelopeJson);
  return { ...proposal, proposal_hash: proposalHash };
}

/** Deliberately bounded: ambiguous natural language becomes a blocked proposal, never an invented date. */
function parseProposedSchedule(message: string, now: string): string | null {
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?Z?))?\b/);
  if (iso) {
    if (iso[2]) {
      const raw = iso[2].endsWith('Z') ? iso[2] : `${iso[2]}Z`;
      const candidate = `${iso[1]}T${raw}`;
      return Number.isFinite(Date.parse(candidate)) ? candidate : null;
    }
    // Date-only ISO in legacy English paths defaults to 09:00Z for prior fixtures.
    const candidate = `${iso[1]}T09:00:00Z`;
    return Number.isFinite(Date.parse(candidate)) ? candidate : null;
  }
  const nextWednesday = /next\s+wednesday|下周三/i.test(message);
  if (!nextWednesday) return null;
  const date = new Date(now); const delta = ((3 - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + delta); date.setUTCHours(9, 0, 0, 0);
  return date.toISOString();
}
