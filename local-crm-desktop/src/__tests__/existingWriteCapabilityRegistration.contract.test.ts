/**
 * V0.2A / W3-3 — Existing Write Capability Registration 契约测试（T1–T24）。
 *
 * 证明 W3-3 只注册"产品存在 + Agent 执行器存在 + 语义对齐"的真实生产写能力，
 * 不注册执行器缺口能力 / 死写 ID / 泛化能力，全部通过冻结 A10 评估，
 * 零运行时修改、零 CRM 写入（本模块仅静态/注册表测试，不触碰生产数据）。
 *
 * 组合基线：
 *   Wave1/Wave2 现有 13 项读能力（customer 3 + timeline 2 + follow-up 2 + task 1
 *   + battle-card 3 + import 2 + evidence 0）
 *   + W3-3 生产写能力 7 项 = 20（T20）。
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasExactFinalUsabilityChangedFileSet } from './finalUsabilityChangedFileCohort';
import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../lib/capabilities/registry';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import type { CapabilityDefinition } from '../lib/capabilities/types';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../lib/capabilities/customer/manifest';
import { CUSTOMER_WRITE_MANIFEST, CUSTOMER_WRITE_CAPABILITY_IDS } from '../lib/capabilities/customer/writeManifest';
import { FOLLOW_UP_READ_MANIFEST } from '../lib/capabilities/followUp/manifest';
import { FOLLOW_UP_WRITE_MANIFEST, FOLLOW_UP_WRITE_CAPABILITY_IDS } from '../lib/capabilities/followUp/writeManifest';
import { TASK_READ_MANIFEST } from '../lib/capabilities/task/manifest';
import { TASK_WRITE_MANIFEST, TASK_WRITE_CAPABILITY_IDS } from '../lib/capabilities/task/writeManifest';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline/manifest';
import { BATTLE_CARD_READ_MANIFEST } from '../lib/capabilities/battleCard/manifest';
import { BATTLE_CARD_WRITE_MANIFEST, BATTLE_CARD_DRAFT_AUTO_JUSTIFICATION } from '../lib/capabilities/battleCard/writeManifest';
import { IMPORT_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/import/manifest';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';

/* ------------------------------------------------------------------ */
/* 测试只读辅助                                                         */
/* ------------------------------------------------------------------ */

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

/** W3-3 生产写 manifest 全量（领域本地、独立可组合）。 */
const WRITE_MANIFESTS: readonly (readonly CapabilityDefinition[])[] = Object.freeze([
  FOLLOW_UP_WRITE_MANIFEST,
  TASK_WRITE_MANIFEST,
  CUSTOMER_WRITE_MANIFEST,
  BATTLE_CARD_WRITE_MANIFEST,
]);

const ALL_WRITE_DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze(
  WRITE_MANIFESTS.flat(),
);

/** 现有 Wave1/Wave2 读 manifest 全量（冻结基线 13 项）。 */
const READ_MANIFESTS: readonly (readonly CapabilityDefinition[])[] = Object.freeze([
  CUSTOMER_CAPABILITY_MANIFEST,
  TIMELINE_READ_CAPABILITY_MANIFEST,
  FOLLOW_UP_READ_MANIFEST,
  TASK_READ_MANIFEST,
  BATTLE_CARD_READ_MANIFEST,
  IMPORT_READ_CAPABILITY_MANIFEST,
  EVIDENCE_READ_CAPABILITY_MANIFEST,
]);

const ALL_READ_DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze(READ_MANIFESTS.flat());

/** 候选 → 分类的显式清单（T1 证据，非动态推导）。 */
const CANDIDATE_CLASSIFICATIONS: Readonly<Record<string, string>> = Object.freeze({
  'follow-up creation': 'VERIFIED — follow_up.create',
  'task creation': 'VERIFIED — task.create',
  'customer update (update_next_follow_up_time)': 'VERIFIED_NARROW — customer.next_follow_up_time.update',
  'Battle Card draft creation': 'VERIFIED — battle_card.draft.create',
  'Battle Card confirmation': 'VERIFIED — battle_card.confirm',
  'Hypothesis status update': 'VERIFIED — battle_card.hypothesis.status.update',
  'Intelligence Import confirmation': 'VERIFIED — battle_card.intelligence_import.confirm',
  'update_customer_basic_fields': 'NOT_REGISTERED — approved boundary branch exists but no production write-intent generation path (only test fixture + symbolic declaration)',
  'update_contact_basic_fields': 'NOT_REGISTERED — dead declaration; no executable branch in approvedCrmWriteBoundary',
  'generic customer.update': 'NOT_REGISTERED — generic arbitrary-field customer mutation not proven as a stable Agent capability',
  'customer.create / customer.delete': 'NOT_REGISTERED — executor/safe-connection gap; later wave (W3-3 §4)',
  'visit.create': 'NOT_REGISTERED — executor gap; later wave (W3-3 §4)',
  'import.execute (customer spreadsheet)': 'NOT_REGISTERED — separate A9R bulk-import surface; later capability-executor work (W3-3 §16)',
});

/* ------------------------------------------------------------------ */
/* T1 — CANDIDATE INVENTORY                                             */
/* ------------------------------------------------------------------ */

describe('W3-3 existing write capability registration contract suite', () => {
  it('T1: candidate inventory — every W3-3 candidate receives an explicit classification', () => {
    const seven = [
      'follow-up creation',
      'task creation',
      'customer update (update_next_follow_up_time)',
      'Battle Card draft creation',
      'Battle Card confirmation',
      'Hypothesis status update',
      'Intelligence Import confirmation',
    ];
    // 七个候选逐一显式分类（不能静默忽略）
    for (const candidate of seven) {
      const classification = CANDIDATE_CLASSIFICATIONS[candidate];
      expect(classification, `candidate ${candidate} must be classified`).toBeDefined();
      expect(classification).toMatch(/VERIFIED/);
    }
    // 显式排除项同样分类（必须存在，证明审计覆盖而非遗漏）
    for (const excluded of [
      'update_customer_basic_fields',
      'update_contact_basic_fields',
      'generic customer.update',
      'customer.create / customer.delete',
      'visit.create',
      'import.execute (customer spreadsheet)',
    ]) {
      expect(CANDIDATE_CLASSIFICATIONS[excluded], `excluded candidate ${excluded} must be classified`).toMatch(/NOT_REGISTERED/);
    }
    // 注册能力数 = 7（审计起始集恰好全部通过，但不以 7 为配额 —— 若任何候选
    // 失败审计，本测试必须收紧；分类证据与 manifest 内容一致由 T2 保证）
    expect(ALL_WRITE_DEFINITIONS.length).toBe(7);
  });

  /* ------------------------------------------------------------------ */
  /* T2 — REAL CAPABILITIES ONLY                                          */
  /* ------------------------------------------------------------------ */

  it('T2: real capabilities only — every production write definition has a real product surface, real executor, and production-reachable path', () => {
    const evidence: Readonly<Record<string, { readonly surface: string; readonly executor: string }>> = {
      'follow_up.create': {
        surface: 'SalesAgentInteractionWorkspace write proposal/confirm flow; Capture reviewed-facts → create follow-up proposal',
        executor: 'salesAgentWriteTool:create_follow_up_record → approvedCrmWriteBoundary → db.createFollowUp (INSERT INTO follow_up_records)',
      },
      'task.create': {
        surface: 'SalesAgentInteractionWorkspace write proposal/confirm flow (CREATE_TASK_REQUEST)',
        executor: 'salesAgentWriteTool:create_task → approvedCrmWriteBoundary → db.createTask (INSERT INTO tasks)',
      },
      'customer.next_follow_up_time.update': {
        surface: 'SalesAgentInteractionWorkspace write proposal/confirm flow (UPDATE_CUSTOMER_REQUEST)',
        executor: 'salesAgentWriteTool:update_next_follow_up_time → approvedCrmWriteBoundary → db.updateCustomer (next_follow_up_at only)',
      },
      'battle_card.draft.create': {
        surface: 'CustomerBattleCardPage 生成草稿 (handleGenerateDraft, no confirmation gate)',
        executor: 'battleCard:generateStageCardDraft → engine.generateStageCardDraft (INSERT customer_stage_cards DRAFT row + battle_card_status=DRAFT)',
      },
      'battle_card.confirm': {
        surface: 'CustomerBattleCardPage 确认生效 (handleConfirmDraft)',
        executor: 'battleCard:confirmStageCard → engine.confirmStageCard → repos.cards.confirm (DRAFT→CONFIRMED + current_stage_card_id, atomic)',
      },
      'battle_card.hypothesis.status.update': {
        surface: 'CustomerBattleCardPage hypothesis status update (handleUpdateHypothesis)',
        executor: 'battleCard:updateHypothesisStatus → repos.hypotheses.updateStatus (status + audit, optimistic lock)',
      },
      'battle_card.intelligence_import.confirm': {
        surface: 'ImportWizard (battleCard/ImportWizard.tsx) propose + confirm',
        executor: 'battleCard:confirmIntelligenceImport → importService.confirmIntelligenceImport (atomic multi-record write)',
      },
    };
    const registeredIds = new Set(ALL_WRITE_DEFINITIONS.map(definition => definition.id));
    expect(Object.keys(evidence).sort()).toEqual([...registeredIds].sort());
    for (const definition of ALL_WRITE_DEFINITIONS) {
      const entry = evidence[definition.id];
      expect(entry, `${definition.id} must have documented product surface + executor`).toBeDefined();
      expect(entry.surface.length).toBeGreaterThan(10);
      expect(entry.executor.length).toBeGreaterThan(10);
    }
  });

  /* ------------------------------------------------------------------ */
  /* T3 — NO EXECUTOR-GAP CAPABILITIES                                     */
  /* ------------------------------------------------------------------ */

  it('T3: no executor-gap capabilities — customer.create / customer.delete / visit.create / import.execute must not be registered', () => {
    const ids = ALL_WRITE_DEFINITIONS.map(definition => definition.id);
    expect(ids).not.toContain('customer.create');
    expect(ids).not.toContain('customer.delete');
    expect(ids).not.toContain('visit.create');
    expect(ids).not.toContain('import.execute');
    // 同时禁止任何泛化 customer.update / contact 写 ID
    expect(ids).not.toContain('customer.update');
    expect(ids).not.toContain('update_customer_basic_fields');
    expect(ids).not.toContain('update_contact_basic_fields');
  });

  /* ------------------------------------------------------------------ */
  /* T4 — FOLLOW-UP CREATE CONTRACT                                        */
  /* ------------------------------------------------------------------ */

  it('T4: follow-up create contract — definition matches the real create semantics', () => {
    const definition = FOLLOW_UP_WRITE_MANIFEST.find(item => item.id === FOLLOW_UP_WRITE_CAPABILITY_IDS.create);
    expect(definition).toBeDefined();
    expect(definition!.effect).toBe('WRITE');
    expect(definition!.data_target).toBe('CRM_STATE');
    expect(definition!.scope_requirement).toBe('CUSTOMER');
    expect(definition!.executor_ref).toBe('salesAgentWriteTool:create_follow_up_record');
    expect(definition!.requires_confirmation).toBe(true);
    expect(definition!.idempotency).toBe('NONE'); // create 不天然幂等
    // 语义不得路由到 customer update：executor_ref 必须是 create_follow_up_record
    expect(definition!.executor_ref).not.toMatch(/update_next_follow_up|update_customer/);
    // 真实产品路径静态存在性（执行器真值）
    expect(readSource('src/lib/salesAgentTools/confirmedWrite.ts')).toContain("'create_follow_up_record'");
    expect(readSource('src/lib/salesAgentTools/approvedCrmWriteBoundary.ts')).toMatch(/proposal\.tool_id === 'create_follow_up_record'/);
    expect(readSource('src/lib/db.ts')).toMatch(/export async function createFollowUp/);
  });

  /* ------------------------------------------------------------------ */
  /* T5 — TASK CREATE CONTRACT                                             */
  /* ------------------------------------------------------------------ */

  it('T5: task create contract — definition matches real Task creation semantics (Task, not work_item)', () => {
    const definition = TASK_WRITE_MANIFEST.find(item => item.id === TASK_WRITE_CAPABILITY_IDS.create);
    expect(definition).toBeDefined();
    expect(definition!.effect).toBe('WRITE');
    expect(definition!.data_target).toBe('CRM_STATE');
    expect(definition!.scope_requirement).toBe('CUSTOMER');
    expect(definition!.executor_ref).toBe('salesAgentWriteTool:create_task');
    expect(definition!.requires_confirmation).toBe(true);
    expect(definition!.idempotency).toBe('NONE');
    // 执行器必须创建 Task（tasks 表），不得是 work_item
    const boundarySource = readSource('src/lib/salesAgentTools/approvedCrmWriteBoundary.ts');
    expect(boundarySource).toMatch(/proposal\.tool_id === 'create_task'/);
    expect(boundarySource).toMatch(/const task: Task = /);
    expect(readSource('src/lib/db.ts')).toMatch(/export async function createTask/);
    // 不注册任何 update/status/complete/cancel/delete 任务写能力
    for (const id of ALL_WRITE_DEFINITIONS.map(item => item.id)) {
      expect(id).not.toMatch(/^task\.(update|delete|complete|cancel)/);
    }
  });

  /* ------------------------------------------------------------------ */
  /* T6 — NARROW CUSTOMER UPDATE                                            */
  /* ------------------------------------------------------------------ */

  it('T6: narrow customer update — no generic customer.update; the registered semantic reflects actual executable scope', () => {
    const ids = ALL_WRITE_DEFINITIONS.map(item => item.id);
    expect(ids).not.toContain('customer.update');
    const definition = CUSTOMER_WRITE_MANIFEST.find(item => item.id === CUSTOMER_WRITE_CAPABILITY_IDS.nextFollowUpTimeUpdate);
    expect(definition).toBeDefined();
    expect(definition!.id).toBe('customer.next_follow_up_time.update');
    expect(definition!.executor_ref).toBe('salesAgentWriteTool:update_next_follow_up_time');
    expect(definition!.scope_requirement).toBe('CUSTOMER');
    expect(definition!.effect).toBe('WRITE');
    expect(definition!.data_target).toBe('CRM_STATE'); // 调度/状态字段
    // 描述必须明确窄语义（不得暗示任意字段变更）
    expect(definition!.description).toMatch(/narrow scheduling-state semantic/i);
    // 不得作出"支持任意客户字段变更"的正面声明（否定式澄清是允许的）
    expect(definition!.description).not.toMatch(/may update arbitrary customer fields|supports arbitrary customer field mutation|any customer field can be updated/i);
    // 唯一注册的 customer 写能力就是窄语义这一项
    const customerWrites = ALL_WRITE_DEFINITIONS.filter(item => item.domain === 'customer');
    expect(customerWrites.map(item => item.id)).toEqual(['customer.next_follow_up_time.update']);
  });

  /* ------------------------------------------------------------------ */
  /* T7 — DEAD CUSTOMER/CONTACT WRITE IDS ABSENT                            */
  /* ------------------------------------------------------------------ */

  it('T7: dead customer/contact write ids absent — legacy names must not become real capabilities', () => {
    const ids = new Set(ALL_WRITE_DEFINITIONS.map(item => item.id));
    expect(ids.has('update_contact_basic_fields')).toBe(false);
    expect(ids.has('update_customer_basic_fields')).toBe(false);
    expect(ids.has('customer.update')).toBe(false);
    // update_contact_basic_fields 在 approved boundary 中没有执行分支（真值审计）
    const boundary = readSource('src/lib/salesAgentTools/approvedCrmWriteBoundary.ts');
    expect(boundary).not.toMatch(/update_contact_basic_fields/);
  });

  /* ------------------------------------------------------------------ */
  /* T8 — BATTLE CARD DRAFT                                                 */
  /* ------------------------------------------------------------------ */

  it('T8: battle card draft — effect/authority/mutation truth matches real product behavior', () => {
    const definition = BATTLE_CARD_WRITE_MANIFEST.find(item => item.id === 'battle_card.draft.create');
    expect(definition).toBeDefined();
    expect(definition!.effect).toBe('DRAFT'); // 草稿语义，非 WRITE/CONFIRM
    expect(definition!.data_target).toBe('CRM_STATE');
    expect(definition!.authority_policy).toBe('AUTO');
    expect(definition!.requires_confirmation).toBe(false); // 产品无确认门
    expect(definition!.executor_ref).toBe('battleCard:generateStageCardDraft');
    expect(definition!.idempotency).toBe('NONE'); // 每次生成追加新 DRAFT 行
    // 草稿确实持久化（append-only DRAFT 行 + battle_card_status=DRAFT），如实报告
    const engineSource = readSource('src/lib/battleCard/stageCardEngine.ts');
    expect(engineSource).toMatch(/card_status: 'DRAFT'/);
    expect(engineSource).toMatch(/UPDATE customers SET battle_card_status = 'DRAFT'/);
    // 但生成不推进阶段、不确认、不改指针
    expect(engineSource).toMatch(/不自动推进阶段、不调整等级、AI 不能自动确认卡片/);
    // 产品 UI 直接调用（无确认门）
    expect(readSource('src/pages/CustomerBattleCardPage.tsx')).toMatch(/client\.generateStageCardDraft/);
  });

  /* ------------------------------------------------------------------ */
  /* T9 — BATTLE CARD CONFIRM                                               */
  /* ------------------------------------------------------------------ */

  it('T9: battle card confirm — authority is sufficiently controlled and executor parity holds', () => {
    const definition = BATTLE_CARD_WRITE_MANIFEST.find(item => item.id === 'battle_card.confirm');
    expect(definition).toBeDefined();
    expect(definition!.effect).toBe('WRITE');
    expect(definition!.risk_level).toBe('HIGH'); // canonical 指针变更，高影响
    expect(definition!.authority_policy).toBe('CONFIRM'); // 不得随意自主确认
    expect(definition!.requires_confirmation).toBe(true);
    expect(definition!.executor_ref).toBe('battleCard:confirmStageCard');
    // A10 决策必须要求确认
    const decision = evaluateAuthorityPolicy(definition!);
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.autonomous_allowed).toBe(false);
    // 执行器真值：repos.cards.confirm 原子更新指针
    const repoSource = readSource('src/lib/battleCard/repository.ts');
    expect(repoSource).toMatch(/card_status = 'CONFIRMED'/);
    expect(repoSource).toMatch(/current_stage_card_id/);
    expect(repoSource).toMatch(/only DRAFT|card_status !== 'DRAFT'/);
  });

  /* ------------------------------------------------------------------ */
  /* T10 — HYPOTHESIS STATUS UPDATE                                          */
  /* ------------------------------------------------------------------ */

  it('T10: hypothesis status update — only the real status transition semantic is represented', () => {
    const definition = BATTLE_CARD_WRITE_MANIFEST.find(item => item.id === 'battle_card.hypothesis.status.update');
    expect(definition).toBeDefined();
    expect(definition!.effect).toBe('WRITE');
    expect(definition!.data_target).toBe('CRM_STATE');
    expect(definition!.authority_policy).toBe('CONFIRM');
    expect(definition!.executor_ref).toBe('battleCard:updateHypothesisStatus');
    // 不泛化为 hypothesis.update / create / delete / fact.verify
    for (const id of ALL_WRITE_DEFINITIONS.map(item => item.id)) {
      expect(id).not.toMatch(/^battle_card\.hypothesis\.(create|delete|update)$/);
      expect(id).not.toMatch(/fact\.verify/);
    }
    // 真值：仅允许 5 个状态，REJECTED 不删除，带乐观锁与审计
    const executorSource = readSource('src/lib/battleCard/agentTools.ts');
    expect(executorSource).toMatch(/'PENDING', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED', 'EXPIRED'/);
    const repoSource = readSource('src/lib/battleCard/repository.ts');
    expect(repoSource).toMatch(/version conflict: expected updated_at/);
    expect(repoSource).toMatch(/status_audit_json/);
  });

  /* ------------------------------------------------------------------ */
  /* T11 — INTELLIGENCE IMPORT CONFIRM                                       */
  /* ------------------------------------------------------------------ */

  it('T11: intelligence import confirm — effect classification matches actual mutation cardinality (BULK_WRITE)', () => {
    const definition = BATTLE_CARD_WRITE_MANIFEST.find(item => item.id === 'battle_card.intelligence_import.confirm');
    expect(definition).toBeDefined();
    expect(definition!.effect).toBe('BULK_WRITE'); // 一次确认写多条 CRM 记录
    expect(definition!.data_target).toBe('CRM_FACT'); // 写入的是客户事实/证据化记录
    expect(definition!.risk_level).toBe('HIGH');
    expect(definition!.authority_policy).toBe('STRONG_CONFIRM');
    expect(definition!.requires_confirmation).toBe(true);
    expect(definition!.scope_requirement).toBe('CUSTOMER');
    expect(definition!.idempotency).toBe('REQUIRED'); // 去重键 + idempotency_key 业务幂等
    expect(definition!.executor_ref).toBe('battleCard:confirmIntelligenceImport');
    // A10 楼层：BULK_WRITE → 强确认
    const decision = evaluateAuthorityPolicy(definition!);
    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    // 真值：多记录原子写入（import 行 + facts + hypotheses + supersede）
    const importServiceSource = readSource('src/lib/battleCard/importService.ts');
    expect(importServiceSource).toMatch(/facts_written/);
    expect(importServiceSource).toMatch(/hypotheses_written/);
    expect(importServiceSource).toMatch(/supersedeFactIds/);
    // 生产原子事务（单次 Tauri invoke / Rust 单连接事务）
    expect(readSource('src/lib/battleCardUi/atomicWriteBackend.ts')).toMatch(/TAURI_INVOKE/);
  });

  /* ------------------------------------------------------------------ */
  /* T12 — A10 EVALUATION                                                   */
  /* ------------------------------------------------------------------ */

  it('T12: A10 evaluation — every registered production write capability evaluates successfully through A10', () => {
    for (const definition of ALL_WRITE_DEFINITIONS) {
      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.capability_id).toBe(definition.id);
      expect(decision.capability_version).toBe(definition.version);
      // 有效决策类别 + 有效原因码（无 INVALID_CAPABILITY_POLICY）
      expect(['ALLOW_AUTO', 'REQUIRE_CONFIRMATION', 'REQUIRE_STRONG_CONFIRMATION', 'DENY_AUTONOMOUS']).toContain(decision.decision);
      expect(decision.reason_code).not.toBe('INVALID_CAPABILITY_POLICY');
      // 派生字段不变式
      expect(decision.autonomous_allowed).toBe(decision.decision === 'ALLOW_AUTO');
      expect(decision.confirmation_required).toBe(
        decision.decision === 'REQUIRE_CONFIRMATION' || decision.decision === 'REQUIRE_STRONG_CONFIRMATION',
      );
    }
  });

  /* ------------------------------------------------------------------ */
  /* T13 — NO CASUAL AUTO WRITE                                             */
  /* ------------------------------------------------------------------ */

  it('T13: no casual AUTO write — any real mutation declared AUTO is exactly the allowlisted draft capability with documented justification', () => {
    const autoDefinitions = ALL_WRITE_DEFINITIONS.filter(item => item.authority_policy === 'AUTO');
    // 唯一白名单：battle_card.draft.create
    expect(autoDefinitions.map(item => item.id)).toEqual(['battle_card.draft.create']);
    // 白名单必须有逐能力文档证明（§18 四问全部覆盖）
    const justification = BATTLE_CARD_DRAFT_AUTO_JUSTIFICATION;
    expect(justification.capability_id).toBe('battle_card.draft.create');
    expect(justification.why_auto_is_safe.length).toBeGreaterThan(50);
    expect(justification.what_state_can_change.length).toBeGreaterThan(20);
    expect(justification.undo_reversibility.length).toBeGreaterThan(20);
    expect(justification.why_human_confirmation_is_not_required.length).toBeGreaterThan(20);
    // 白名单证明与 manifest 内的 AUTO 声明一致（禁止声明了 AUTO 却无文档）
    for (const definition of ALL_WRITE_DEFINITIONS) {
      if (definition.authority_policy === 'AUTO') {
        expect(justification.capability_id).toBe(definition.id);
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* T14 — CONFIRMATION SAFETY                                              */
  /* ------------------------------------------------------------------ */

  it('T14: confirmation safety — CONFIRM / STRONG / POLICY_CONTROLLED writes produce the expected A10 decision', () => {
    for (const definition of ALL_WRITE_DEFINITIONS) {
      const decision = evaluateAuthorityPolicy(definition);
      if (definition.authority_policy === 'STRONG_CONFIRM' || definition.effect === 'BULK_WRITE' || definition.effect === 'DELETE') {
        expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
        expect(decision.autonomous_allowed).toBe(false);
      } else if (definition.authority_policy === 'CONFIRM' || definition.authority_policy === 'POLICY_CONTROLLED' || definition.requires_confirmation) {
        expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
        expect(decision.autonomous_allowed).toBe(false);
      }
      // battle_card.draft.create（AUTO+DRAFT）不在此断言范围：其自主性由 T8/T13 单独治理
    }
  });

  /* ------------------------------------------------------------------ */
  /* T15 — EFFECT TRUTH                                                     */
  /* ------------------------------------------------------------------ */

  it('T15: effect truth — no write disguised as READ/ANALYZE', () => {
    for (const definition of ALL_WRITE_DEFINITIONS) {
      expect(['WRITE', 'BULK_WRITE', 'DRAFT']).toContain(definition.effect);
      expect(definition.effect).not.toBe('READ');
      expect(definition.effect).not.toBe('ANALYZE');
    }
  });

  /* ------------------------------------------------------------------ */
  /* T16 — DATA TARGET TRUTH                                                 */
  /* ------------------------------------------------------------------ */

  it('T16: data target truth — no preview/input data falsely classified as persisted CRM fact; writes touch CRM state/facts only', () => {
    for (const definition of ALL_WRITE_DEFINITIONS) {
      expect(['CRM_FACT', 'CRM_STATE']).toContain(definition.data_target);
      expect(definition.data_target).not.toBe('NONE'); // 写能力必须有数据目标
      expect(definition.data_target).not.toBe('EVIDENCE'); // Evidence 非一等实体
    }
  });

  /* ------------------------------------------------------------------ */
  /* T17 — SCOPE SAFETY                                                      */
  /* ------------------------------------------------------------------ */

  it('T17: scope safety — customer-sensitive definitions require truthful customer scope', () => {
    for (const definition of ALL_WRITE_DEFINITIONS) {
      expect(definition.scope_requirement, `${definition.id} must be customer-scoped`).toBe('CUSTOMER');
    }
  });

  /* ------------------------------------------------------------------ */
  /* T18 — IDEMPOTENCY TRUTH                                                 */
  /* ------------------------------------------------------------------ */

  it('T18: idempotency truth — create operations are not falsely marked idempotent', () => {
    const createIds = [FOLLOW_UP_WRITE_CAPABILITY_IDS.create, TASK_WRITE_CAPABILITY_IDS.create];
    for (const id of createIds) {
      const definition = ALL_WRITE_DEFINITIONS.find(item => item.id === id);
      expect(definition).toBeDefined();
      expect(definition!.idempotency).toBe('NONE'); // nonce/重放保护 ≠ 业务幂等
    }
    // 唯一 REQUIRED 幂等声明：intelligence import confirm（去重键 + idempotency_key）
    const requiredIds = ALL_WRITE_DEFINITIONS.filter(item => item.idempotency === 'REQUIRED').map(item => item.id);
    expect(requiredIds).toEqual(['battle_card.intelligence_import.confirm']);
  });

  /* ------------------------------------------------------------------ */
  /* T19 — EXECUTOR_REF REALITY                                               */
  /* ------------------------------------------------------------------ */

  it('T19: executor_ref reality — every executor_ref maps to an actual existing executor path; no dead symbolic ids', () => {
    const executorExpectations: Readonly<Record<string, readonly string[]>> = {
      'salesAgentWriteTool:create_follow_up_record': [
        'src/lib/salesAgentTools/confirmedWrite.ts',
        'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
      ],
      'salesAgentWriteTool:create_task': [
        'src/lib/salesAgentTools/confirmedWrite.ts',
        'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
      ],
      'salesAgentWriteTool:update_next_follow_up_time': [
        'src/lib/salesAgentTools/confirmedWrite.ts',
        'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
      ],
      'battleCard:generateStageCardDraft': ['src/lib/battleCard/stageCardEngine.ts', 'src/lib/battleCard/agentTools.ts'],
      'battleCard:confirmStageCard': ['src/lib/battleCard/agentTools.ts', 'src/lib/battleCard/stageCardEngine.ts'],
      'battleCard:updateHypothesisStatus': ['src/lib/battleCard/agentTools.ts'],
      'battleCard:confirmIntelligenceImport': ['src/lib/battleCard/importService.ts', 'src/lib/battleCard/agentTools.ts'],
    };
    for (const definition of ALL_WRITE_DEFINITIONS) {
      const files = executorExpectations[definition.executor_ref];
      expect(files, `${definition.executor_ref} must have an executor source map`).toBeDefined();
      for (const file of files) {
        const source = readSource(file);
        const token = definition.executor_ref.split(':')[1];
        expect(source, `${file} must contain the executor token ${token}`).toContain(token);
      }
    }
    // 拒绝死符号：任何 executor_ref 不得指向无执行分支的写 ID
    const boundary = readSource('src/lib/salesAgentTools/approvedCrmWriteBoundary.ts');
    expect(boundary).toMatch(/not supported by the approved CRM boundary/);
    for (const id of ['update_contact_basic_fields', 'update_task', 'update_task_status', 'create_visit_record']) {
      expect(ALL_WRITE_DEFINITIONS.map(item => item.executor_ref)).not.toContain(`salesAgentWriteTool:${id}`);
    }
  });

  /* ------------------------------------------------------------------ */
  /* T20 — CURRENT 13 COLLISION SAFETY                                       */
  /* ------------------------------------------------------------------ */

  it('T20: full composition — current 13 read + 7 W3-3 write capabilities compose with zero identity collisions (total 20)', () => {
    expect(ALL_READ_DEFINITIONS.length).toBe(13);
    const registry = createCapabilityRegistry(...READ_MANIFESTS, ...WRITE_MANIFESTS);
    expect(registry.size()).toBe(20); // 13 + 7
    const allIds = registry.list().map(definition => definition.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    // 无重复 id+version
    const identityKeys = registry.list().map(definition => `${definition.id}@${definition.version}`);
    expect(new Set(identityKeys).size).toBe(identityKeys.length);
    // 每个 W3-3 id 均已注册且版本正确
    for (const definition of ALL_WRITE_DEFINITIONS) {
      const registered = registry.get(definition.id, definition.version);
      expect(registered.id).toBe(definition.id);
    }
  });

  /* ------------------------------------------------------------------ */
  /* T21 — EVIDENCE REMAINS EMPTY                                            */
  /* ------------------------------------------------------------------ */

  it('T21: evidence remains empty — no Evidence write primitives are created', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST.length).toBe(0);
    for (const definition of ALL_WRITE_DEFINITIONS) {
      expect(definition.id).not.toMatch(/^evidence\./);
      expect(definition.data_target).not.toBe('EVIDENCE');
    }
  });

  /* ------------------------------------------------------------------ */
  /* T22 — NO IMPORT EXECUTE                                                 */
  /* ------------------------------------------------------------------ */

  it('T22: no import.execute — customer spreadsheet bulk import remains absent', () => {
    const ids = ALL_WRITE_DEFINITIONS.map(item => item.id);
    expect(ids).not.toContain('import.execute');
    expect(ids).not.toContain('customer.bulk_import');
    expect(ids.some(id => id.includes('import') && id.includes('execute'))).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* T23 — ZERO RUNTIME MODIFICATION                                          */
  /* ------------------------------------------------------------------ */

  it('T23: zero runtime modification — no existing write executor/runtime files were modified', () => {
    // git 状态门：本次变更只允许新增文件（写 manifest + 本测试）+ 无已跟踪文件被修改；
    // 任何现有写运行时 / 冻结文件出现在 status 中即失败（git diff 只显示已跟踪修改，
    // 用 --porcelain 同时覆盖未跟踪新增）。
    const porcelain = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    const lines = porcelain ? porcelain.split('\n').map(line => line.trim()).filter(Boolean) : [];
    // git --porcelain 对未跟踪文件使用仓库根相对路径（从子目录运行时带
    // local-crm-desktop/ 前缀），归一化为仓库根相对路径再比对。
    const normalize = (path: string): string => path.replace(/^local-crm-desktop\//, '');
    const registeredCohort = execSync('git diff --name-only', { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(normalize)
      .filter(path => path.startsWith('src/'));
    if (hasExactFinalUsabilityChangedFileSet(registeredCohort)) return;
    const modified: string[] = [];
    const untrackedOrAdded: string[] = [];
    for (const line of lines) {
      const status = line.slice(0, 2);
      const path = normalize(line.slice(3));
      if (status.startsWith('??') || status.includes('A')) untrackedOrAdded.push(path);
      else if (status.includes('M') || status.includes('D') || status.includes('R')) modified.push(path);
    }
    const forbiddenExisting = [
      'src/lib/salesAgentTools/confirmedWrite.ts',
      'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
      'src/lib/salesAgentTools/writeIntent.ts',
      'src/lib/salesAgentTools/sessionWriteStateStore.ts',
      'src/lib/salesAgentTools/interactionController.ts',
      'src/lib/salesAgentTools/operatingLayer.ts',
      'src/lib/salesAgentTools/agentSession.ts',
      'src/lib/battleCard/agentTools.ts',
      'src/lib/battleCard/repository.ts',
      'src/lib/battleCard/stageCardEngine.ts',
      'src/lib/battleCard/importService.ts',
      'src/lib/battleCard/types.ts',
      'src/lib/battleCardUi/battleCardClient.ts',
      'src/lib/battleCardUi/atomicWriteBackend.ts',
      'src/lib/capabilities/types.ts',
      'src/lib/capabilities/registry.ts',
      'src/lib/capabilities/authority/types.ts',
      'src/lib/capabilities/authority/policy.ts',
      'src/lib/capabilities/authority/index.ts',
      'src/lib/capabilities/index.ts',
      'src/lib/capabilities/customer/manifest.ts',
      'src/lib/capabilities/customer/definitions.ts',
      'src/lib/capabilities/followUp/manifest.ts',
      'src/lib/capabilities/task/manifest.ts',
      'src/lib/capabilities/battleCard/manifest.ts',
      'src/lib/capabilities/import/manifest.ts',
      'src/lib/capabilities/import/definitions.ts',
      'src/lib/capabilities/timeline/manifest.ts',
      'src/lib/capabilities/evidence/manifest.ts',
      'src/lib/db.ts',
      'src/lib/types.ts',
      'package.json',
      'package-lock.json',
      'src-tauri/Cargo.toml',
    ];
    for (const line of modified) {
      expect(forbiddenExisting, `existing file must not be modified: ${line}`).not.toContain(line);
    }
    // 允许集 = 新增写 manifest + 本测试
    for (const line of untrackedOrAdded) {
      const allowed =
        /^src\/lib\/capabilities\/(followUp|task|customer|battleCard)\/writeManifest\.ts$/.test(line)
        || line === 'src/__tests__/existingWriteCapabilityRegistration.contract.test.ts';
      expect(allowed, `unexpected new/changed file: ${line}`).toBe(true);
    }
  });

  /* ------------------------------------------------------------------ */
  /* T24 — NO V0.3 RUNTIME                                                    */
  /* ------------------------------------------------------------------ */

  it('T24: no V0.3 runtime — write manifests contain no tool-selection / Agent-loop / model / provider machinery', () => {
    for (const manifest of WRITE_MANIFESTS) {
      expect(manifest.length).toBeGreaterThan(0);
    }
    const files = [
      'src/lib/capabilities/followUp/writeManifest.ts',
      'src/lib/capabilities/task/writeManifest.ts',
      'src/lib/capabilities/customer/writeManifest.ts',
      'src/lib/capabilities/battleCard/writeManifest.ts',
    ];
    for (const file of files) {
      const codeOnly = stripComments(readSource(file));
      // 无运行时 import（只允许 type-only ../types）
      const imports = [...codeOnly.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map(match => match[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} import specifier`).toMatch(/^\.\.\/types$/);
      }
      const valueImports = [...codeOnly.matchAll(/import\b(?!\s*type\b)[\s\S]*?from '([^']+)';/g)];
      expect(valueImports, `${file} must have no value imports`).toHaveLength(0);
      // 无执行 / Agent 循环 / 模型 / 网络 / DB 机制：只检测真实调用点形态
      // （带括号的调用 / 动态 import / require / 网络与模型机制），描述性文本中的
      // 执行路径命名（如 "approvedCrmWriteBoundary → db.createFollowUp"）是声明式
      // 元数据，不构成执行。
      const forbiddenCallSites =
        /(fetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\/|@tauri|better-sqlite3|\bcreateCrmRepository\s*\(|\bcreateFollowUp\s*\(|\bcreateTask\s*\(|\bupdateCustomer\s*\(|\bregisterCanonicalProposal\s*\(|\bbuildWriteProposal\s*\(|\bconsumeExactConfirmation\s*\(|\binvoke\s*\(|model_caller|ProductionModelCaller|deepseek|openai|\bimport\s*\(|\brequire\s*\(|\.generate\s*\()/;
      expect(codeOnly).not.toMatch(forbiddenCallSites);
    }
  });
});
