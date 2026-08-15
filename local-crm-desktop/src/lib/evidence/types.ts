/**
 * V0.2B / B1 — First-Class Evidence Domain Types.
 *
 * 一等 Evidence 实体 = 关于某客户的一条外部/导入信息的**有界观察快照**。
 * 它保存"信息来自哪里、何时被观察、属于哪个客户、以及它只是证据而非权威事实"。
 *
 * 语义不变量（任务 §5）：
 *   EVIDENCE ≠ CRM_FACT        —— 绝不自动升格为权威事实
 *   EVIDENCE ≠ HYPOTHESIS      —— 不是待验证假设
 *   EVIDENCE ≠ AUDIT_EVENT     —— 不是审计日志
 *   EVIDENCE ≠ AGENT_MEMORY    —— 不是 AI 记忆
 *   EVIDENCE_AUTO_PROMOTES_TO_CRM_FACT = false（见 contract.ts）
 *
 * 归属模型（任务 §7）：仅 CUSTOMER-linked（customer_id NOT NULL）。
 * 不做 GLOBAL / UNASSIGNED，防止跨客户泄漏。
 */

/** 证据来源类型（闭合枚举；B1 无网络，URL 仅作为手动提供的来源标识，不抓取）。 */
export type EvidenceSourceType = 'URL' | 'IMPORT' | 'MANUAL';

/** 证据生命周期状态。仅 status 可变；其余字段一经创建即不可变。 */
export type EvidenceStatus = 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';

/** 持久化行（decoder 契约字段顺序）。 */
export interface EvidenceRow {
  readonly id: string;
  readonly customer_id: string;
  readonly source_type: EvidenceSourceType;
  readonly source_url: string | null;
  readonly source_title: string | null;
  readonly source_ref: string | null;
  readonly captured_at: string;
  readonly summary: string;
  readonly excerpt: string | null;
  readonly content_hash: string;
  readonly status: EvidenceStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

/** 创建输入。content_hash 由仓储层从 summary/excerpt 确定性推导，调用方不可伪造。 */
export interface EvidenceInput {
  readonly id: string;
  readonly customer_id: string;
  readonly source_type: EvidenceSourceType;
  readonly source_url?: string | null;
  readonly source_title?: string | null;
  readonly source_ref?: string | null;
  readonly captured_at: string;
  readonly summary: string;
  readonly excerpt?: string | null;
}
