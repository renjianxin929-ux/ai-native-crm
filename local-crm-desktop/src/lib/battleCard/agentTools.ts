/**
 * Battle Card Backend V1 — Sales Agent 后端工具契约。
 * 10 个工具：只读工具直接执行；写工具生成 Proposal，经现有 Confirm/Replay 边界后由
 * BattleCardWriteExecutor 执行。模型不能直接执行 SQL/阶段修改/等级调整/Fact 确认/卡片确认。
 */

import type { DatabaseLike } from '../db';
import type { CustomerStage } from '../types';
import type { AgentWriteProposal } from '../salesAgentTools/confirmedWrite';
import { buildWriteProposal, type FactVerificationItem } from '../salesAgentTools/confirmedWrite';
import { registerCanonicalProposal } from '../salesAgentTools/sessionWriteStateStore';
import type { BattleCardWriteExecutor } from '../salesAgentTools/approvedCrmWriteBoundary';
import {
  confirmIntelligenceImport,
  previewIntelligenceImport,
  type ConfirmImportDecisions,
  type ImportPreviewResult,
} from './importService';
import { createBattleCardRepositories, sha256Hex, type BattleCardRepositories } from './repository';
import { createStageCardEngine } from './stageCardEngine';
import { createDailyReviewEngine, type BattleReviewQueueFilters } from './dailyReview';
import type { HypothesisStatus } from './types';
import { BATTLE_CARD_SCHEMA_VERSION } from './schema';

export type BattleCardToolId =
  | 'preview_battle_intelligence_import'
  | 'confirm_battle_intelligence_import'
  | 'get_current_stage_card'
  | 'generate_stage_card_draft'
  | 'confirm_stage_card'
  | 'list_stage_card_history'
  | 'compare_stage_cards'
  | 'update_hypothesis_status'
  | 'build_daily_battle_review_queue'
  | 'get_customer_battle_context';

export interface BattleCardToolDefinition {
  readonly id: BattleCardToolId;
  readonly name: string;
  readonly description: string;
  readonly access: 'read' | 'write';
  readonly requires_confirmation: boolean;
}

export const BATTLE_CARD_TOOL_REGISTRY: Readonly<Record<BattleCardToolId, BattleCardToolDefinition>> = Object.freeze({
  preview_battle_intelligence_import: {
    id: 'preview_battle_intelligence_import', name: 'Preview battle intelligence import', description: '解析完整战前背调材料并生成结构化预览（零写入）。',
    access: 'read', requires_confirmation: false,
  },
  confirm_battle_intelligence_import: {
    id: 'confirm_battle_intelligence_import', name: 'Confirm battle intelligence import', description: '人工确认后，将导入材料的事实/假设写入 CRM（单一事务，经 Proposal 边界）。',
    access: 'write', requires_confirmation: true,
  },
  get_current_stage_card: {
    id: 'get_current_stage_card', name: 'Get current stage card', description: '读取客户当前已确认的阶段作战卡。',
    access: 'read', requires_confirmation: false,
  },
  generate_stage_card_draft: {
    id: 'generate_stage_card_draft', name: 'Generate stage card draft', description: '按当前销售阶段生成完整作战卡草稿（DRAFT，不改变阶段，不自动确认）。',
    access: 'write', requires_confirmation: false,
  },
  confirm_stage_card: {
    id: 'confirm_stage_card', name: 'Confirm stage card', description: '人工确认作战卡草稿（DRAFT → CONFIRMED），更新客户当前卡指针。',
    access: 'write', requires_confirmation: true,
  },
  list_stage_card_history: {
    id: 'list_stage_card_history', name: 'List stage card history', description: '列出客户全部历史作战卡版本（append-only）。',
    access: 'read', requires_confirmation: false,
  },
  compare_stage_cards: {
    id: 'compare_stage_cards', name: 'Compare stage cards', description: '比较两张作战卡（上一张 vs 当前）的字段级差异。',
    access: 'read', requires_confirmation: false,
  },
  update_hypothesis_status: {
    id: 'update_hypothesis_status', name: 'Update hypothesis status', description: '更新待验证假设状态（含审计，REJECTED 不删除），经 Proposal 边界。',
    access: 'write', requires_confirmation: true,
  },
  build_daily_battle_review_queue: {
    id: 'build_daily_battle_review_queue', name: 'Build daily battle review queue', description: '确定性规则构建每日复盘队列（排序不依赖模型）。',
    access: 'read', requires_confirmation: false,
  },
  get_customer_battle_context: {
    id: 'get_customer_battle_context', name: 'Get customer battle context', description: '聚合客户作战上下文：事实/假设/当前卡/历史版本/导入。',
    access: 'read', requires_confirmation: false,
  },
});

export const BATTLE_CARD_TOOL_IDS = Object.freeze(Object.keys(BATTLE_CARD_TOOL_REGISTRY) as BattleCardToolId[]);

// ── 装配 ──

export interface BattleCardAgentToolsDeps {
  readonly db: DatabaseLike;
  readonly repos?: BattleCardRepositories;
  readonly clock?: () => string;
}

export function createBattleCardAgentTools(deps: BattleCardAgentToolsDeps) {
  const repos = deps.repos ?? createBattleCardRepositories(deps.db, deps.clock);
  const engine = createStageCardEngine({ db: deps.db, repos, clock: deps.clock });
  const review = createDailyReviewEngine({ db: deps.db, repos, clock: deps.clock });

  return {
    registry: BATTLE_CARD_TOOL_REGISTRY,

    // ── 1. 只读：预览导入（零写入） ──
    async preview(rawContent: string, options: { source_system?: string; source_label?: string | null } = {}): Promise<ImportPreviewResult> {
      return previewIntelligenceImport(rawContent, {
        db: deps.db,
        repos,
        clock: deps.clock,
        source_system: options.source_system ?? 'FEISHU_BTABLE',
        source_label: options.source_label ?? null,
      });
    },

    // ── 2. 写 Proposal：确认导入 ──
    async proposeConfirmIntelligenceImport(input: {
      customer_id: string;
      raw_content: string;
      keep_fact_ids?: readonly string[];
      keep_hypothesis_ids?: readonly string[];
      fact_overrides?: ConfirmImportDecisions['fact_overrides'];
      fact_verifications?: readonly FactVerificationItem[];
      source_system?: string;
      message?: string;
      created_at?: string;
    }): Promise<AgentWriteProposal> {
      const at = input.created_at ?? deps.clock?.() ?? new Date().toISOString();
      const idempotencyKey = `confirm-import:${input.customer_id}:${await sha256Hex(input.raw_content)}:${at}`;
      return registerCanonicalProposal(buildWriteProposal({
        customer_id: input.customer_id,
        message: input.message ?? '确认战前材料导入',
        evidence_refs: [`customer:${input.customer_id}`],
        created_at: at,
        tool_id: 'confirm_battle_intelligence_import',
        proposed_values: {
          raw_content: input.raw_content,
          source_system: input.source_system ?? 'FEISHU_BTABLE',
          customer_id: input.customer_id,
          keep_fact_ids: input.keep_fact_ids ?? [],
          keep_hypothesis_ids: input.keep_hypothesis_ids ?? [],
          fact_overrides: input.fact_overrides ?? {},
          fact_verifications: input.fact_verifications ?? [],
          expected_version: 'import:any',
          idempotency_key: idempotencyKey,
        },
        reason: '用户确认战前材料导入（事实/假设经人工筛选）',
      }));
    },

    // ── 3. 只读：当前卡 ──
    async getCurrentStageCard(customerId: string) {
      return engine.getCurrentStageCard(customerId);
    },

    // ── 4. 生成草稿（写 DRAFT，不自动确认） ──
    async generateStageCardDraft(customerId: string, stageCode: CustomerStage) {
      return engine.generateStageCardDraft(customerId, stageCode);
    },

    // ── 5. 写 Proposal：确认卡片 ──
    async proposeConfirmStageCard(input: {
      customer_id: string;
      card_id: string;
      expected_version: number;
      message?: string;
      created_at?: string;
    }): Promise<AgentWriteProposal> {
      const at = input.created_at ?? deps.clock?.() ?? new Date().toISOString();
      const idempotencyKey = `confirm-card:${input.customer_id}:${input.card_id}:${at}`;
      return registerCanonicalProposal(buildWriteProposal({
        customer_id: input.customer_id,
        message: input.message ?? '确认阶段作战卡',
        evidence_refs: [`card:${input.card_id}`, `customer:${input.customer_id}`],
        created_at: at,
        tool_id: 'confirm_stage_card',
        proposed_values: {
          card_id: input.card_id,
          expected_version: input.expected_version,
          idempotency_key: idempotencyKey,
        },
        reason: '用户确认作战卡草稿生效',
      }));
    },

    // ── 6. 只读：历史 ──
    async listStageCardHistory(customerId: string) {
      return engine.listStageCardHistory(customerId);
    },

    // ── 7. 只读：比较 ──
    async compareStageCards(previousId: string, currentId: string) {
      return engine.compareStageCards(previousId, currentId);
    },

    // ── 8. 写 Proposal：假设状态 ──
    async proposeUpdateHypothesisStatus(input: {
      customer_id: string;
      hypothesis_id: string;
      new_status: HypothesisStatus;
      reason?: string | null;
      expected_version: string;
      message?: string;
      created_at?: string;
    }): Promise<AgentWriteProposal> {
      const at = input.created_at ?? deps.clock?.() ?? new Date().toISOString();
      const idempotencyKey = `hyp-status:${input.customer_id}:${input.hypothesis_id}:${input.new_status}:${at}`;
      return registerCanonicalProposal(buildWriteProposal({
        customer_id: input.customer_id,
        message: input.message ?? `更新假设状态为 ${input.new_status}`,
        evidence_refs: [`hypothesis:${input.hypothesis_id}`, `customer:${input.customer_id}`],
        created_at: at,
        tool_id: 'update_hypothesis_status',
        proposed_values: {
          hypothesis_id: input.hypothesis_id,
          new_status: input.new_status,
          reason: input.reason ?? null,
          expected_version: input.expected_version,
          idempotency_key: idempotencyKey,
        },
        reason: '用户确认假设状态变更',
      }));
    },

    // ── 9. 只读：每日复盘队列 ──
    async buildDailyReviewQueue(filters: BattleReviewQueueFilters = {}) {
      return review.buildDailyBattleReviewQueue(filters);
    },

    // ── 10. 只读：客户作战上下文 ──
    async getCustomerBattleContext(customerId: string) {
      const [facts, hypotheses, cards, imports, currentCard] = await Promise.all([
        repos.facts.listByCustomer(customerId),
        repos.hypotheses.listByCustomer(customerId),
        repos.cards.listByCustomer(customerId),
        repos.imports.listByCustomer(customerId),
        engine.getCurrentStageCard(customerId),
      ]);
      return {
        customer_id: customerId,
        schema_version: BATTLE_CARD_SCHEMA_VERSION,
        current_stage_card: currentCard,
        card_history_count: cards.length,
        card_versions: cards.map(card => ({ id: card.id, stage_code: card.stage_code, version: card.version, card_status: card.card_status, supersedes_card_id: card.supersedes_card_id })),
        verified_facts: facts.filter(fact => fact.verification_status === 'VERIFIED').map(fact => ({ id: fact.id, statement: fact.statement, applicability: fact.applicability })),
        conflicted_facts: facts.filter(fact => fact.verification_status === 'CONFLICTED').length,
        hypotheses: hypotheses.map(hypothesis => ({ id: hypothesis.id, statement: hypothesis.statement, status: hypothesis.status })),
        imports: imports.map(item => ({ id: item.id, source_system: item.source_system, parse_status: item.parse_status, confirmed_at: item.confirmed_at, raw_len: item.raw_content.length })),
      };
    },
  };
}

// ── BattleCardWriteExecutor：Proposal 确认后的执行器（经 SafeWriteBoundary 调用） ──

export function createBattleCardWriteExecutor(deps: BattleCardAgentToolsDeps): BattleCardWriteExecutor {
  const repos = deps.repos ?? createBattleCardRepositories(deps.db, deps.clock);
  const engine = createStageCardEngine({ db: deps.db, repos, clock: deps.clock });
  const now = () => deps.clock?.() ?? new Date().toISOString();

  return {
    async confirmIntelligenceImport(proposal) {
      const values = proposal.proposed_values;
      const rawContent = String(values.raw_content ?? '');
      const customerId = String(values.customer_id ?? '');
      if (!rawContent.trim() || !customerId.trim()) throw new Error('Battle intelligence import confirmation requires raw content and customer.');
      const preview = await previewIntelligenceImport(rawContent, {
        db: deps.db,
        repos,
        clock: deps.clock,
        source_system: String(values.source_system ?? 'FEISHU_BTABLE'),
      });
      const decisions: ConfirmImportDecisions = {
        customer_id: customerId,
        keep_fact_ids: Array.isArray(values.keep_fact_ids) ? (values.keep_fact_ids as string[]) : [],
        keep_hypothesis_ids: Array.isArray(values.keep_hypothesis_ids) ? (values.keep_hypothesis_ids as string[]) : [],
        fact_overrides: (values.fact_overrides ?? {}) as ConfirmImportDecisions['fact_overrides'],
        fact_verifications: (values.fact_verifications ?? {}) as ConfirmImportDecisions['fact_verifications'],
        confirmed_by: 'HUMAN_CONFIRM',
      };
      const result = await confirmIntelligenceImport(preview, decisions, { db: deps.db, repos, clock: deps.clock });
      return {
        entity_id: result.import_id,
        effect: {
          facts_written: result.facts_written,
          hypotheses_written: result.hypotheses_written,
          deduped: result.deduped,
          idempotency_key: String(values.idempotency_key ?? ''),
        },
      };
    },

    async confirmStageCard(proposal) {
      const values = proposal.proposed_values;
      const cardId = String(values.card_id ?? '');
      const expectedVersion = Number(values.expected_version);
      const card = await repos.cards.get(cardId);
      if (!card) throw new Error(`Stage card does not exist: ${cardId}`);
      if (Number.isFinite(expectedVersion) && card.version !== expectedVersion) {
        throw new Error(`Stage card version conflict: expected ${expectedVersion}, actual ${card.version}`);
      }
      const confirmed = await engine.confirmStageCard(cardId, 'HUMAN_CONFIRM');
      return {
        entity_id: cardId,
        effect: {
          card_status: confirmed.card_status,
          confirmed_at: confirmed.confirmed_at,
          idempotency_key: String(values.idempotency_key ?? ''),
        },
      };
    },

    async updateHypothesisStatus(proposal) {
      const values = proposal.proposed_values;
      const hypothesisId = String(values.hypothesis_id ?? '');
      const newStatus = String(values.new_status ?? '') as HypothesisStatus;
      if (!['PENDING', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED', 'EXPIRED'].includes(newStatus)) {
        throw new Error(`Invalid hypothesis status: ${newStatus}`);
      }
      const updated = await repos.hypotheses.updateStatus({
        id: hypothesisId,
        newStatus,
        by: 'HUMAN_CONFIRM',
        reason: typeof values.reason === 'string' ? values.reason : null,
        expectedUpdatedAt: typeof values.expected_version === 'string' ? values.expected_version : undefined,
        at: now(),
      });
      return {
        entity_id: hypothesisId,
        effect: {
          status: updated.status,
          resolved_at: updated.resolved_at,
          audit_entries: JSON.parse(updated.status_audit_json).length,
          idempotency_key: String(values.idempotency_key ?? ''),
        },
      };
    },
  };
}

export function isBattleCardToolId(value: string): value is BattleCardToolId {
  return (BATTLE_CARD_TOOL_IDS as readonly string[]).includes(value);
}
