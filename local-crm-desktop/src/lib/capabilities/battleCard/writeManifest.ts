/**
 * V0.2A / W3-3 — Battle Card WRITE Capability Manifest (domain: battle-card).
 *
 * 本模块是 W3-3（Existing Write Capability Registration）的 Battle Card 域写能力
 * manifest：草稿生成、卡片确认、假设状态更新、战前情报导入确认。
 * - 纯声明式：只声明 A1 CapabilityDefinition，不包含任何执行 / DB / 网络 / 模型语义。
 * - 唯一允许的 import 是 type-only 的 '../types'。
 * - 不修改 A1 中央文件、authority/**、现有读 manifest、生产写运行时
 *   （battleCard/agentTools.ts、battleCard/repository.ts、stageCardEngine.ts、
 *    importService.ts、battleCardUi/**、Rust 命令一律不动）。
 * - 通过 A1 扩展缝独立组合；测试直接 import。
 *
 * ── 执行器真值（W3-3 独立审计）──────────────────────────────────────────
 * 生产写链路由 battleCardUi/battleCardClient.ts（产品唯一前端入口）装配：
 *   proposeXxx()（createBattleCardAgentTools）→ registerCanonicalProposal →
 *   SalesAgentSession.confirmWriteByRef(..., approvedCrmWriteBoundary)（生产默认边界
 *   含 battleCard executor proxy）→ createBattleCardWriteExecutor → repository/Rust。
 * 产品 UI 表面：pages/CustomerBattleCardPage.tsx（草稿生成/卡片确认/假设状态）、
 * components/battleCard/ImportWizard.tsx（情报导入确认）。
 *
 * 每条能力独立核对：REAL_PRODUCT_CAPABILITY + REAL_PRODUCTION_REACHABLE_EXECUTOR
 * + SEMANTIC_PARITY，见各定义注释。
 */

import type { CapabilityDefinition } from '../types';

/** W3-3 Battle Card 写能力版本。 */
export const BATTLE_CARD_WRITE_VERSION = '1.0.0' as const;

/** W3-3 Battle Card 写能力身份（稳定身份 = id + version）。 */
export const BATTLE_CARD_WRITE_CAPABILITY_IDS = {
  draftCreate: 'battle_card.draft.create',
  confirm: 'battle_card.confirm',
  hypothesisStatusUpdate: 'battle_card.hypothesis.status.update',
  intelligenceImportConfirm: 'battle_card.intelligence_import.confirm',
} as const;

/** Battle Card 写能力审计契约：写操作要求审计，记录输入与效果。 */
const BATTLE_CARD_WRITE_AUDIT: CapabilityDefinition['audit_contract'] = {
  audit_required: true,
  record_input: true,
  record_output: false,
  record_effect: true,
};

/**
 * W3-3 AUTO 写硬门（§18）——唯一允许的 AUTO 声明及其逐能力证明。
 * 仅 battle_card.draft.create 声明 authority_policy=AUTO；其余全部真实写能力
 * 均为 POLICY_CONTROLLED / CONFIRM / STRONG_CONFIRM。禁止扩大该白名单。
 */
export const BATTLE_CARD_DRAFT_AUTO_JUSTIFICATION: Readonly<{
  readonly capability_id: string;
  readonly why_auto_is_safe: string;
  readonly what_state_can_change: string;
  readonly undo_reversibility: string;
  readonly why_human_confirmation_is_not_required: string;
}> = Object.freeze({
  capability_id: 'battle_card.draft.create',
  why_auto_is_safe:
    'Draft generation is a proposal/document-artifact action in the product: it creates an append-only customer_stage_cards row with card_status=DRAFT and sets the customer draft indicator (customers.battle_card_status=DRAFT). It never changes authoritative committed state — it does not change the customer stage, does not touch customers.current_stage_card_id, and never promotes any card to CONFIRMED. A10 policy itself classifies DRAFT as non-mutating (NON_MUTATING_EFFECTS) for authority purposes.',
  what_state_can_change:
    'INSERT into customer_stage_cards (one row, card_status=DRAFT, version = nextVersion) and UPDATE customers.battle_card_status = DRAFT for the explicit customer scope. The canonical/current stage card pointer (customers.current_stage_card_id) and stage are unchanged.',
  undo_reversibility:
    'Draft rows are append-only and never become canonical until an explicit confirm; the product discard action is a no-op refresh (CustomerBattleCardPage handleDiscardDraft: "草稿不删除（append-only）；仅刷新状态提示"). No pointer/stage change to revert.',
  why_human_confirmation_is_not_required:
    'Product semantics: generate_stage_card_draft is declared requires_confirmation=false and is invoked directly by the product UI (CustomerBattleCardPage.handleGenerateDraft → battleCardClient.generateStageCardDraft) without any confirmation gate. The consequential transition is governed by the separate battle_card.confirm capability, which is classified CONFIRM and requires exact human confirmation before promoting DRAFT → CONFIRMED.',
});

/**
 * W3-3 Battle Card 域生产写 manifest：仅注册经独立审计证明真实存在、
 * 生产可达且语义对齐的四项写/草稿/状态迁移能力。冻结数组。
 */
export const BATTLE_CARD_WRITE_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  /**
   * battle_card.draft.create — 阶段作战卡草稿生成。
   *
   * REAL_PRODUCT_CAPABILITY：CustomerBattleCardPage "生成草稿"（handleGenerateDraft）
   *   直接调用 client.generateStageCardDraft（无确认门）。
   * EXECUTOR：battleCardClient.generateStageCardDraft → createBattleCardAgentTools
   *   → engine.generateStageCardDraft（stageCardEngine.ts:232-395）：读取客户/已核实事实/
   *   开放假设/互动/任务/ACTIVE Memory/上一张卡/最新导入，组装 payload，INSERT
   *   customer_stage_cards 行（card_status='DRAFT'、append-only version），并
   *   UPDATE customers.battle_card_status='DRAFT'。不推进阶段、不调整等级、不确认。
   * PERSISTENCE_BEHAVIOR：DRAFT 行确实持久化（append-only 版本），但 canonical
   *   指针/阶段/CONFIRMED 状态不变 —— DRAFT 语义下如实报告持久化行为。
   * PARITY：生成的是 DRAFT 卡（生成后卡仍以 DRAFT 呈现），不自动确认。
   *
   * A1 分类：effect=DRAFT（A1 的 DRAFT 代表提案/草稿语义；A10 将 DRAFT 视为
   * 非变更 effect）；data_target=CRM_STATE（与 A7R 读 manifest 一致，作战卡是
   * 带 DRAFT/CONFIRMED 生命周期与版本指针的可变状态实体）；risk=LOW；
   * authority=AUTO（见 BATTLE_CARD_DRAFT_AUTO_JUSTIFICATION，唯一 AUTO 白名单项）；
   * requires_confirmation=false（产品无确认门）；scope=CUSTOMER；
   * idempotency=NONE（每次生成都追加一个新 DRAFT 行，版本递增）。
   */
  {
    id: BATTLE_CARD_WRITE_CAPABILITY_IDS.draftCreate,
    version: BATTLE_CARD_WRITE_VERSION,
    domain: 'battle-card',
    description:
      'Generate a stage battle card draft for an explicit customer through the real product path (battleCardClient.generateStageCardDraft → engine.generateStageCardDraft): an append-only customer_stage_cards row with card_status=DRAFT is persisted and the customer draft indicator (battle_card_status=DRAFT) is set. The generation never changes the customer stage, never changes the canonical current_stage_card_id pointer, and never promotes any card to CONFIRMED; the draft remains explicitly DRAFT until the separate battle_card.confirm capability is exercised. Draft generation has no confirmation gate in the product (declared requires_confirmation=false).',
    input_schema: 'battle_card.draft.create.query.v1',
    output_schema: 'battle_card.draft.create.result.v1',
    effect: 'DRAFT',
    data_target: 'CRM_STATE',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'battleCard:generateStageCardDraft',
    audit_contract: { ...BATTLE_CARD_WRITE_AUDIT },
    error_contract: 'UNSPECIFIED',
  },

  /**
   * battle_card.confirm — 阶段作战卡确认（DRAFT → CONFIRMED）。
   *
   * REAL_PRODUCT_CAPABILITY：CustomerBattleCardPage "确认生效"（handleConfirmDraft）
   *   → client.proposeConfirmStageCard → client.confirmProposal（人工确认）。
   * EXECUTOR：proposeConfirmStageCard（agentTools.ts:164-186）生成
   *   confirm_stage_card Proposal（含 expected_version 乐观锁、idempotency_key）；
   *   approvedCrmWriteBoundary → createBattleCardWriteExecutor.confirmStageCard →
   *   engine.confirmStageCard → repos.cards.confirm（repository.ts:413-453）：
   *   生产路径单次 Tauri invoke（Rust 同一连接单事务）或单连接事务，
   *   UPDATE customer_stage_cards.card_status='CONFIRMED' +
   *   UPDATE customers.current_stage_card_id=cardId, battle_card_status='CONFIRMED'。
   * MUTATION_SEMANTICS：canonical/current 状态迁移 —— 高影响状态转换。
   * PARITY：与真实确认语义一致（仅 DRAFT 卡可确认，二次确认抛错）。
   *
   * A1 分类：effect=WRITE；data_target=CRM_STATE；risk=HIGH（canonical 指针变更）；
   * authority=CONFIRM（不得随意自主确认；产品对该转换要求人工确认）；
   * requires_confirmation=true；scope=CUSTOMER；idempotency=NONE（一次性状态迁移，
   * 重复确认同一卡失败）。
   */
  {
    id: BATTLE_CARD_WRITE_CAPABILITY_IDS.confirm,
    version: BATTLE_CARD_WRITE_VERSION,
    domain: 'battle-card',
    description:
      'Confirm a stage battle card draft (DRAFT → CONFIRMED) for an explicit customer through the real product path (battleCardClient.proposeConfirmStageCard + confirmProposal → approvedCrmWriteBoundary → battleCardWriteExecutor.confirmStageCard → engine.confirmStageCard → repos.cards.confirm). The confirmation atomically updates customer_stage_cards.card_status=CONFIRMED and the customer canonical pointer (customers.current_stage_card_id, battle_card_status=CONFIRMED) in one Rust single-connection transaction (Tauri invoke) or single-connection transaction fallback. Only a DRAFT card can be confirmed; a second confirmation of the same card fails. This is a consequential canonical state transition and executes only after exact human confirmation.',
    input_schema: 'battle_card.confirm.proposal.v1',
    output_schema: 'battle_card.confirm.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'HIGH',
    authority_policy: 'CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'battleCard:confirmStageCard',
    audit_contract: { ...BATTLE_CARD_WRITE_AUDIT },
    error_contract: 'UNSPECIFIED',
  },

  /**
   * battle_card.hypothesis.status.update — 客户假设状态更新。
   *
   * REAL_PRODUCT_CAPABILITY：CustomerBattleCardPage 假设状态更新
   *   （handleUpdateHypothesis）→ client.proposeUpdateHypothesisStatus →
   *   client.confirmProposal（人工确认）。
   * EXECUTOR：proposeUpdateHypothesisStatus（agentTools.ts:199-225）生成
   *   update_hypothesis_status Proposal（含 expected_version=updated_at 乐观锁）；
   *   approvedCrmWriteBoundary → createBattleCardWriteExecutor.updateHypothesisStatus
   *   → repos.hypotheses.updateStatus（repository.ts:324-342）：仅允许
   *   PENDING / PARTIALLY_CONFIRMED / CONFIRMED / REJECTED / EXPIRED；
   *   乐观锁校验 expected updated_at；status_audit_json 追加审计；
   *   终态（CONFIRMED/REJECTED/EXPIRED）写 resolved_at；REJECTED 不删除。
   * EXACT_STATE_TRANSITION：仅状态字段迁移 + 追加审计，不创建/删除假设，
   *   不更新假设正文 —— 不泛化为 hypothesis.update。
   * PARITY：与真实状态迁移语义一致。
   *
   * A1 分类：effect=WRITE；data_target=CRM_STATE；risk=MEDIUM（状态迁移带审计，
   * 非破坏性）；authority=CONFIRM；requires_confirmation=true；scope=CUSTOMER；
   * idempotency=NONE（每次执行追加审计条目并可能改变状态）。
   */
  {
    id: BATTLE_CARD_WRITE_CAPABILITY_IDS.hypothesisStatusUpdate,
    version: BATTLE_CARD_WRITE_VERSION,
    domain: 'battle-card',
    description:
      'Update the status of one customer hypothesis through the real product path (battleCardClient.proposeUpdateHypothesisStatus + confirmProposal → approvedCrmWriteBoundary → battleCardWriteExecutor.updateHypothesisStatus → repos.hypotheses.updateStatus). Only the status field transitions (PENDING / PARTIALLY_CONFIRMED / CONFIRMED / REJECTED / EXPIRED) with an optimistic lock on expected updated_at, an append-only status audit entry, and resolved_at set on terminal states; REJECTED does not delete the hypothesis. The semantic is status transition only — it is NOT a general hypothesis.update (no statement/rationale editing, no create/delete). Executes only after exact human confirmation.',
    input_schema: 'battle_card.hypothesis.status.update.proposal.v1',
    output_schema: 'battle_card.hypothesis.status.update.result.v1',
    effect: 'WRITE',
    data_target: 'CRM_STATE',
    risk_level: 'MEDIUM',
    authority_policy: 'CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'NONE',
    executor_ref: 'battleCard:updateHypothesisStatus',
    audit_contract: { ...BATTLE_CARD_WRITE_AUDIT },
    error_contract: 'UNSPECIFIED',
  },

  /**
   * battle_card.intelligence_import.confirm — 战前情报导入确认（BULK_WRITE）。
   *
   * REAL_PRODUCT_CAPABILITY：components/battleCard/ImportWizard.tsx（产品导入向导，
   *   步骤 4→5：客户绑定 → 事实/假设保留与核实 → 生成 Proposal → 人工确认）。
   * EXECUTOR：proposeConfirmIntelligenceImport（agentTools.ts:119-151）生成
   *   confirm_battle_intelligence_import Proposal（含 fact_verifications 闭合
   *   runtime schema、expected_version、idempotency_key）；
   *   approvedCrmWriteBoundary → createBattleCardWriteExecutor.confirmIntelligenceImport
   *   → importService.confirmIntelligenceImport（importService.ts:100-186）：
   *   生产路径单次 Tauri invoke —— Rust 在同一物理连接的一个 sqlx Transaction 内
   *   完成全部写入（atomicWriteBackend.ts + battle_card_transactions.rs）；
   *   无 Tauri 环境回退单连接事务。
   * MUTATION_CARDINALITY：一次确认写入多条 CRM 记录 ——
   *   1 条 intelligence_imports 行（parse_status=CONFIRMED）
   *   + N 条 reviewed_facts（KEEP/VERIFY 决策；VERIFIED 需人工核实门禁）
   *   + M 条 customer_hypotheses（保留项）
   *   + 旧 CONFLICTED/SUPERSEDED 同语句事实的 SUPERSEDED 迁移。
   *   按 W3-3 §15：材料性多记录写入不得降级为普通 WRITE → effect=BULK_WRITE。
   * DEDUP/IDEMPOTENCY：按 (customer_id, source_system, content_hash) 去重 +
   *   idempotency_key —— 相同材料重复确认返回 deduped=true 不重复写入（业务级幂等）。
   * PARITY：与真实确认语义一致（权威重解析 + 语义门禁 + 原子事务）。
   *
   * A1 分类：effect=BULK_WRITE（A10 破坏性 effect 楼层 → REQUIRE_STRONG_CONFIRMATION）；
   * data_target=CRM_FACT（写入的是客户事实/证据化记录：reviewed_facts 与
   *   customer_hypotheses 陈述；Evidence 不是当前一等实体，不声明 EVIDENCE）；
   * risk=HIGH（多记录批量写入，虽原子且去重，仍保守声明高影响）；
   * authority=STRONG_CONFIRM（BULK_WRITE 强控制；A10 楼层 3 无论如何都
   *   REQUIRE_STRONG_CONFIRMATION）；requires_confirmation=true；
   * scope=CUSTOMER（产品向导绑定 effectiveCustomer；agent 工具强制 customer_id）；
   * idempotency=REQUIRED（执行器经去重键 + idempotency_key 保证业务幂等）。
   */
  {
    id: BATTLE_CARD_WRITE_CAPABILITY_IDS.intelligenceImportConfirm,
    version: BATTLE_CARD_WRITE_VERSION,
    domain: 'battle-card',
    description:
      'Confirm a battle intelligence import for an explicit customer through the real product path (ImportWizard propose + confirm → approvedCrmWriteBoundary → battleCardWriteExecutor.confirmIntelligenceImport → importService.confirmIntelligenceImport). One confirmation atomically writes multiple CRM records in a single Rust sqlx transaction (Tauri invoke; single-connection fallback in non-Tauri): one intelligence_imports row (parse_status=CONFIRMED), the human-kept reviewed facts (KEEP/VERIFY; VERIFIED requires the explicit verification gate), the human-kept hypotheses, and SUPERSEDED transitions of stale same-statement facts. Dedup by (customer, source_system, content_hash) plus idempotency_key makes repeated confirmation of identical content a no-op (business-level idempotency). Executes only after exact human confirmation; classified BULK_WRITE because multiple CRM records are written as one confirmation.',
    input_schema: 'battle_card.intelligence_import.confirm.proposal.v1',
    output_schema: 'battle_card.intelligence_import.confirm.result.v1',
    effect: 'BULK_WRITE',
    data_target: 'CRM_FACT',
    risk_level: 'HIGH',
    authority_policy: 'STRONG_CONFIRM',
    requires_confirmation: true,
    scope_requirement: 'CUSTOMER',
    idempotency: 'REQUIRED',
    executor_ref: 'battleCard:confirmIntelligenceImport',
    audit_contract: { ...BATTLE_CARD_WRITE_AUDIT },
    error_contract: 'UNSPECIFIED',
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const BATTLE_CARD_WRITE_CAPABILITY_IDS_LIST: readonly string[] = Object.freeze(
  BATTLE_CARD_WRITE_MANIFEST.map((definition) => definition.id),
);
