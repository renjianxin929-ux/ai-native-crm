/**
 * V0.2A / A8R — Evidence Read Capability Inventory (audit evidence).
 *
 * 审计结论基于当前产品源码直接检查（只读），记录五项候选 Evidence 读取能力
 * 的真实性分类。生产 manifest（manifest.ts）只允许包含
 * product_capability_exists=true 且 final_status='VERIFIED' 的能力；
 * 本次审计结果为全部候选均 NOT_DISTINCT / NOT_EXISTING，
 * 因此生产 manifest 是空冻结数组（诚实反映当前产品无独立 Evidence 读取面）。
 *
 * ── 产品现状（EVIDENCE_PRODUCT_MODEL，见文件尾部）──
 * Evidence 不是一等实体：无 evidence 表、无 getEvidence/listEvidence/
 * evidenceById 等读取函数。当前产品的 Evidence 是"引用体系"：
 *   1. FactEvidenceRef 元数据（src/lib/battleCard/types.ts:44-61）：
 *      evidence_type（CUSTOMER/FOLLOW_UP_RECORD/VISIT_RECORD/TASK/IMPORT_SOURCE）、
 *      evidence_id、import_ref、import_id，及 IMPORT_SOURCE 专属字段
 *      （parser_contract_version/source_section/start_byte/end_byte/
 *       excerpt_sha256/statement_sha256）。
 *   2. reviewed_facts / customer_hypotheses 表的 evidence_refs_json 列
 *      （src/lib/battleCard/schema.ts，Battle Card 域表）。
 *   3. customer_stage_cards.payload_json 内的字符串引用数组
 *      （'import:...' / 'CUSTOMER:...' / 'FOLLOW_UP_RECORD:...' /
 *       'VISIT_RECORD:...' / 'TASK:...' 前缀风格）。
 *   4. 归属校验 SqliteCrmEvidenceResolver.exists（src/lib/customerMemory/
 *      repository.ts:104-113）：按 customer_id 过滤校验证据存在于
 *      customers/follow_up_records/visit_records/tasks 四表。
 *   5. 展示投影 splitEvidenceRefs / EvidenceDrawer（src/lib/battleCardUi/
 *      battleCardViewModels.ts:139-149；src/components/battleCard/
 *      EvidenceDrawer.tsx：纯展示、无数据获取）。
 *
 * ── 候选能力判定摘要 ──
 * A READ_CUSTOMER_EVIDENCE      → NOT_DISTINCT
 *   （无独立客户级 Evidence 视图；Evidence 仅嵌套于 Battle Card 投影
 *     src/pages/CustomerBattleCardPage.tsx:106-112 与 fact/hypothesis 行内）
 * B READ_EVIDENCE_DETAIL        → NOT_EXISTING
 *   （全 src 无 getEvidence/evidenceById；battleCard/repository.ts 的
 *     imports.get(id) 无产品 UI 消费方且 SELECT 无 customer 过滤 → 不注册）
 * C READ_BATTLE_CARD_EVIDENCE   → NOT_DISTINCT
 *   （EvidenceDrawer 真实存在，但属于 Battle Card 详情/投影行为 = A7R 域，
 *     A8R 不重复注册 Battle Card primitives，见任务 §9）
 * D READ_SUPPORTING_EVIDENCE    → NOT_DISTINCT
 *   （evidence_refs_json 随 CRM_FACT 行读取返回（battleCard 域表），
 *     无独立"读支撑证据"产品行为；data_target 应为 CRM_FACT 而非 EVIDENCE）
 * E SEARCH_FILTER_EVIDENCE      → NOT_EXISTING
 *   （无产品级 Evidence 搜索/过滤行为；数组 filter 不构成能力）
 *
 * V0_2B_EVIDENCE_SCHEMA_GAPS（仅记录，不在 A8R 修复）：
 *   source_type / url / published_at / retrieved_at / confidence（evidence 级）/
 *   claim / citation / source 等字段在当前产品 Evidence 体系中不存在。
 */

export type EvidenceReadCandidateId =
  | 'read_customer_evidence'
  | 'read_evidence_detail'
  | 'read_battle_card_evidence'
  | 'read_supporting_evidence'
  | 'search_filter_evidence';

export type EvidenceReadA8rAction = 'REGISTER_EXISTING' | 'NOT_APPLICABLE';

export type EvidenceReadFinalStatus = 'VERIFIED' | 'NOT_DISTINCT' | 'NOT_EXISTING';

export interface EvidenceReadInventoryEntry {
  readonly candidate: EvidenceReadCandidateId;
  readonly label: string;
  readonly product_capability_exists: boolean;
  /** 现有产品源码位置（只读审计证据，file:line 级）。 */
  readonly existing_source_path: readonly string[];
  /** 现有执行路径（生产行为；NOT_APPLICABLE 时说明缺失）。 */
  readonly existing_execution_path: string;
  readonly agent_capability_already_exists: boolean;
  readonly a8r_action: EvidenceReadA8rAction;
  readonly final_status: EvidenceReadFinalStatus;
  /** NOT_DISTINCT / NOT_EXISTING 时必须给出精确理由。 */
  readonly not_distinct_reason: string;
}

/** 深度冻结（条目对象含只读字符串字段，冻结对象本身即可防篡改）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const EVIDENCE_READ_INVENTORY: readonly EvidenceReadInventoryEntry[] = deepFreeze([
  {
    candidate: 'read_customer_evidence',
    label: 'Read Customer Evidence',
    product_capability_exists: false,
    existing_source_path: [
      'src/pages/CustomerBattleCardPage.tsx:106-112',
      'src/components/battleCard/EvidenceDrawer.tsx:13-56',
      'src/lib/battleCardUi/battleCardViewModels.ts:139-149',
    ],
    existing_execution_path:
      'N/A — no independent customer-scoped Evidence read view exists; evidence strings are embedded in the stage card payload projection (CustomerBattleCardPage → getCurrentStageCard → toStageCardBundle → action/solution.evidence_refs → EvidenceDrawer)',
    agent_capability_already_exists: false,
    a8r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    not_distinct_reason:
      'No independent customer-scoped Evidence read capability exists in the current product. Evidence appears only nested inside the Battle Card detail projection (stage card payload evidence_refs string arrays, CustomerBattleCardPage.tsx:106-112) and inside CRM_FACT rows (reviewed_facts/customer_hypotheses evidence_refs_json). There is no product surface whose semantics are "read the Evidence of customer X"; the only Evidence-adjacent customer view is the Battle Card page (A7R domain, §9 ownership boundary). Registering a customer evidence read would either duplicate battle-card read (A7R) or invent a synthetic projection. Therefore intentionally absent.',
  },
  {
    candidate: 'read_evidence_detail',
    label: 'Read Evidence by ID / Detail',
    product_capability_exists: false,
    existing_source_path: ['src/lib/battleCard/repository.ts:136-139'],
    existing_execution_path:
      'N/A — no getEvidence/evidenceById/loadEvidence exists anywhere in src; the only by-ID read over evidence-adjacent rows is imports.get(id) (intelligence_imports, repository.ts:136-139), which has no product UI consumer and whose SQL has no customer_id filter',
    agent_capability_already_exists: false,
    a8r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_EXISTING',
    not_distinct_reason:
      'No evidence-by-ID product behavior exists. imports.get(id) is a repository helper (battleCard/repository.ts:136-139): it is consumed only by tests, never by product UI, and its query (SELECT * FROM intelligence_imports WHERE id = ?) does not enforce customer scope — exposing it would widen access (IDOR risk, §17). Per the Product Capability Rule (repository helper != product capability), it is not registered and the intentional absence is recorded here.',
  },
  {
    candidate: 'read_battle_card_evidence',
    label: 'Read Battle Card Evidence',
    product_capability_exists: true,
    existing_source_path: [
      'src/pages/CustomerBattleCardPage.tsx:289,330,387-392',
      'src/components/battleCard/EvidenceDrawer.tsx:13-56',
      'src/lib/battleCardUi/battleCardClient.ts:52',
    ],
    existing_execution_path:
      "CustomerBattleCardPage → client.getCurrentStageCard(customerId) → agentTools.getCurrentStageCard → stageCardEngine → customer_stage_cards.payload_json → toStageCardBundle → action/solution.evidence_refs (string arrays) → EvidenceDrawer (display-only)",
    agent_capability_already_exists: false,
    a8r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    not_distinct_reason:
      'The Evidence Drawer is a real product behavior, but it is a Battle Card detail/projection behavior: its data source is the stage card payload (customer_stage_cards.payload_json), read through the Battle Card read path (getCurrentStageCard). Per §9 ownership boundary, A7R owns Battle Card read capabilities and may preserve embedded evidence refs; A8R must not duplicate battle_card.read or register Battle Card primitives. This capability therefore stays with the Battle Card domain and is intentionally absent from the Evidence manifest (T12).',
  },
  {
    candidate: 'read_supporting_evidence',
    label: 'Read Fact / Claim Supporting Evidence',
    product_capability_exists: false,
    existing_source_path: [
      'src/lib/battleCardUi/battleCardClient.ts:55-57,155-171',
      'src/lib/battleCard/repository.ts:157-166,205',
      'src/lib/battleCardUi/battleCardViewModels.ts:151-153',
    ],
    existing_execution_path:
      'N/A as an independent Evidence read — ReviewedFactRow/CustomerHypothesisRow (with evidence_refs_json column) are returned by the CRM_FACT read paths repos.facts.listByCustomer / repos.hypotheses.listByCustomer (battleCard domain tables); battleCardClient.listVerifiedFacts/listAllFacts have no product UI consumer (tests only); parseFactEvidenceRefs is a pure parse helper',
    agent_capability_already_exists: false,
    a8r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    not_distinct_reason:
      'Evidence refs are returned nested inside CRM_FACT rows (reviewed_facts/customer_hypotheses belong to the battleCard domain). There is no distinct stable product behavior whose semantics are "read the supporting evidence of a fact/claim": reading those rows is a CRM_FACT read (data_target=CRM_FACT, §15), and the fact/hypothesis read surface belongs to the Battle Card domain (A7R). listVerifiedFacts/listAllFacts are client interfaces without product UI consumers (repository-helper level), so they cannot justify registration. Evidence != CRM Fact boundary preserved: A8R registers nothing that would imply evidence.verify / fact.verify (§10).',
  },
  {
    candidate: 'search_filter_evidence',
    label: 'Search / Filter Evidence',
    product_capability_exists: false,
    existing_source_path: ['src/lib/battleCardUi/battleCardViewModels.ts:139-149'],
    existing_execution_path:
      'N/A — no product search/filter over Evidence exists; splitEvidenceRefs is a display-classification helper over an already-loaded string array',
    agent_capability_already_exists: false,
    a8r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_EXISTING',
    not_distinct_reason:
      'No product-level Evidence search/filter behavior exists. splitEvidenceRefs (battleCardViewModels.ts:139-149) merely classifies already-present strings for drawer display; per §8.E, filtering arrays does not constitute a product capability. Intentionally absent.',
  },
]);

/** 仅真实存在的能力才进入生产 manifest 的候选集合（本次为空数组 — 产品现状）。 */
export const VERIFIED_EVIDENCE_READ_CANDIDATES: readonly EvidenceReadCandidateId[] = deepFreeze(
  EVIDENCE_READ_INVENTORY
    .filter((entry) => entry.product_capability_exists && entry.final_status === 'VERIFIED')
    .map((entry) => entry.candidate),
);

// ── Evidence 产品字段模型（仅当前现实字段，无 roadmap 未来字段）──

export const EVIDENCE_FIRST_CLASS_ENTITY = false as const;

export interface EvidenceProductField {
  readonly field: string;
  readonly location: string;
  readonly notes: string;
}

export const CURRENT_EVIDENCE_FIELDS: readonly EvidenceProductField[] = deepFreeze([
  { field: 'evidence_type', location: 'src/lib/battleCard/types.ts:45', notes: 'CUSTOMER | FOLLOW_UP_RECORD | VISIT_RECORD | TASK | IMPORT_SOURCE' },
  { field: 'evidence_id', location: 'src/lib/battleCard/types.ts:46', notes: '被引用 CRM 记录 id（customers/follow_up_records/visit_records/tasks）' },
  { field: 'import_ref', location: 'src/lib/battleCard/types.ts:48', notes: 'intelligence_imports 内来源段落标识（章节名+行号）' },
  { field: 'import_id', location: 'src/lib/battleCard/types.ts:50', notes: 'IMPORT_SOURCE 专属：来源 import 行 id' },
  { field: 'parser_contract_version', location: 'src/lib/battleCard/types.ts:52', notes: 'IMPORT_SOURCE 专属' },
  { field: 'source_section', location: 'src/lib/battleCard/types.ts:54', notes: 'IMPORT_SOURCE 专属：来源章节' },
  { field: 'start_byte / end_byte', location: 'src/lib/battleCard/types.ts:56-57', notes: 'IMPORT_SOURCE 专属：字节跨距' },
  { field: 'excerpt_sha256 / statement_sha256', location: 'src/lib/battleCard/types.ts:58-59', notes: 'IMPORT_SOURCE 专属：哈希' },
  { field: 'evidence_refs_json', location: 'src/lib/battleCard/schema.ts:43', notes: 'reviewed_facts / customer_hypotheses 列（TEXT NOT NULL DEFAULT \'[]\'）' },
  { field: 'evidence_refs (string[])', location: 'src/lib/battleCard/types.ts:194,231,255,275', notes: 'stage card payload 内字符串引用（import:/CUSTOMER:/FOLLOW_UP_RECORD:/VISIT_RECORD:/TASK: 前缀）' },
  { field: 'source_system / source_label / raw_content', location: 'src/lib/battleCard/schema.ts:13-27', notes: 'intelligence_imports 行（导入来源内容，非独立 evidence 实体）' },
  { field: 'ai_memory_evidence_links', location: 'src-tauri/migrations/004:16-23', notes: 'memory_id ↔ (evidence_type, evidence_id) 链接表' },
]);

// ── V0.2B schema gaps（仅记录，A8R 不实现、不合成）──

export interface EvidenceSchemaGap {
  readonly field: string;
  readonly reason: string;
}

export const V0_2B_EVIDENCE_SCHEMA_GAPS: readonly EvidenceSchemaGap[] = deepFreeze([
  { field: 'source_type', reason: '不存在于当前 Evidence 体系（仅 ai_memory_entries 有 source_type，非 Evidence 域）' },
  { field: 'url', reason: '不存在；当前无任何 Evidence URL 字段' },
  { field: 'published_at', reason: '不存在；仅 intelligence_imports.created_at/confirmed_at（导入时间，非发布时间）' },
  { field: 'retrieved_at', reason: '不存在；无抓取/检索语义（A8R 无网络）' },
  { field: 'confidence (evidence-level)', reason: 'reviewed_facts.confidence 是 Fact 级字段，Evidence 引用本身无 confidence' },
  { field: 'claim', reason: '不存在独立 claim 实体；Fact/Hypothesis 是 Battle Card 域概念' },
  { field: 'citation', reason: '不存在独立 citation 实体' },
]);
