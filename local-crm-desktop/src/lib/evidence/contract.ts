/**
 * V0.2B / B1 — First-Class Evidence 不变式与能力面分类（任务 §5 / §7 / §13）。
 *
 * B1 只建"证据容器 + 信任边界"，不注册 Agent 能力。
 * repository helper ≠ Agent capability。
 */

export const EVIDENCE_AUTO_PROMOTES_TO_CRM_FACT = false as const;
export const CROSS_CUSTOMER_EVIDENCE_LEAKAGE = false as const;
export const EVIDENCE_FIRST_CLASS_ENTITY = true as const;

/** B1 结束时的独立 Evidence Agent 能力数量（0 = 仅基础，不是失败）。 */
export const CURRENT_INDEPENDENT_EVIDENCE_CAPABILITY_COUNT = 0 as const;

export type EvidenceCapabilityCandidateId =
  | 'evidence.read'
  | 'evidence.search'
  | 'evidence.get'
  | 'evidence.list_by_customer';

export type EvidenceCapabilityClassification =
  | 'EXISTING_PRODUCT_BEHAVIOR'
  | 'NEW_FOUNDATION_REQUIRED'
  | 'NOT_DISTINCT'
  | 'DEFER_TO_B3'
  | 'DEFER_TO_B4';

export interface EvidenceCapabilityClassificationEntry {
  readonly candidate: EvidenceCapabilityCandidateId;
  readonly classification: EvidenceCapabilityClassification;
  readonly reason: string;
}

/**
 * 任务 §13 能力面分类。B1 只交付仓储层（customer-scoped），
 * 不做 Agent 读/搜索能力，因此全部 DEFER，注册数保持 0。
 */
export const EVIDENCE_CAPABILITY_CANDIDATE_CLASSIFICATION: readonly EvidenceCapabilityClassificationEntry[] =
  Object.freeze([
    {
      candidate: 'evidence.get',
      classification: 'DEFER_TO_B3',
      reason:
        'B1 提供 customer-scoped 仓储 helper evidence.get(id)；作为 Agent 对外能力属于 B3 读取面，不在 B1 注册。',
    },
    {
      candidate: 'evidence.list_by_customer',
      classification: 'DEFER_TO_B3',
      reason:
        'B1 提供 listByCustomer(customerId)（强制客户作用域）；注册为 Agent 能力属 B3 读取面，不在 B1 注册。',
    },
    {
      candidate: 'evidence.read',
      classification: 'DEFER_TO_B3',
      reason:
        'B1 建立一等实体 + 信任边界；"Agent 读取证据" 的产品能力属 B3，B1 只建容器不建能力。',
    },
    {
      candidate: 'evidence.search',
      classification: 'DEFER_TO_B4',
      reason:
        'B1 只做确定性指纹/来源身份去重；语义/检索式搜索（可能含 embedding）明确不在 B1，属 B4。',
    },
  ]);
