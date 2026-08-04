/**
 * Battle Card UI — 生产客户端（前端唯一入口，组合冻结后端服务）。
 *
 * 构造规则与 battleCard.productionConstruction.acceptance.test.ts 一致：
 * - read 工具：createBattleCardAgentTools({ db: await getDb() }) 直接调用；
 * - 事实/假设读取：createBattleCardRepositories（与后端服务内部同一仓库实现）；
 * - write 工具：proposeXxx() → Canonical Proposal（sessionWriteStateStore）
 *   → SalesAgentSession.confirmWriteByRef(..., approvedCrmWriteBoundary)（生产默认边界，含 battleCard executor proxy）；
 * - 取消：cancelCanonicalProposal(proposal)（invalidate nonce，零写入）。
 *
 * 本文件不包含任何模型调用；模型未配置时，确定性能力完整可用。
 */

import { getDb } from '../db';
import { createBattleCardAgentTools } from '../battleCard/agentTools';
import { createBattleCardRepositories } from '../battleCard/repository';
import { SalesAgentSession } from '../salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../salesAgentTools/approvedCrmWriteBoundary';
import { cancelCanonicalProposal } from '../salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../salesAgentTools/appClock';
import type { AgentWriteProposal } from '../salesAgentTools/confirmedWrite';
import type { BattleReviewQueueFilters, BattleReviewQueueResult } from '../battleCard/dailyReview';
import type { ConfirmImportDecisions, ImportPreviewResult } from '../battleCard/importService';
import type {
  CardComparison,
  CustomerHypothesisRow,
  CustomerStageCardRow,
  HypothesisStatus,
  ReviewedFactRow,
} from '../battleCard/types';
import type { Customer, CustomerStage } from '../types';

export interface ConfirmWriteOutcome {
  readonly entity_id: string;
  readonly fields: readonly string[];
}

export interface BattleCardUiClient {
  previewImport(rawContent: string, options?: { source_system?: string; source_label?: string | null; customer_id?: string }): Promise<ImportPreviewResult>;
  proposeConfirmImport(input: {
    customer_id: string;
    raw_content: string;
    keep_fact_ids: readonly string[];
    keep_hypothesis_ids: readonly string[];
    fact_overrides?: ConfirmImportDecisions['fact_overrides'];
    fact_verifications?: ConfirmImportDecisions['fact_verifications'];
  }): Promise<AgentWriteProposal>;
  cancelProposal(proposal: AgentWriteProposal | null): void;
  confirmProposal(proposal: AgentWriteProposal): Promise<ConfirmWriteOutcome>;
  generateStageCardDraft(customerId: string, stageCode: CustomerStage): Promise<CustomerStageCardRow>;
  proposeConfirmStageCard(customerId: string, cardId: string, expectedVersion: number): Promise<AgentWriteProposal>;
  getCurrentStageCard(customerId: string): Promise<CustomerStageCardRow | null>;
  listStageCardHistory(customerId: string): Promise<CustomerStageCardRow[]>;
  compareStageCards(previousId: string, currentId: string): Promise<CardComparison>;
  listVerifiedFacts(customerId: string): Promise<ReviewedFactRow[]>;
  listAllFacts(customerId: string): Promise<ReviewedFactRow[]>;
  listHypotheses(customerId: string): Promise<CustomerHypothesisRow[]>;
  proposeUpdateHypothesisStatus(input: {
    customer_id: string;
    hypothesis_id: string;
    new_status: HypothesisStatus;
    reason?: string | null;
    expected_version: string;
  }): Promise<AgentWriteProposal>;
  buildDailyReviewQueue(filters?: BattleReviewQueueFilters): Promise<BattleReviewQueueResult>;
  getCustomerBattleContext(customerId: string): Promise<Awaited<ReturnType<ReturnType<typeof createBattleCardAgentTools>['getCustomerBattleContext']>>>;
  getCustomer(customerId: string): Promise<Customer | null>;
}

/**
 * 生产 Composition Root。每次调用经 getDb() 取当前数据库实例；
 * 测试环境经 __setDbInstanceForTests 指向隔离库，UI 代码零改动。
 */
export function createBattleCardUiClient(): BattleCardUiClient {
  return {
    async previewImport(rawContent, options = {}) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.preview(rawContent, {
        source_system: options.source_system ?? 'MANUAL_PASTE',
        source_label: options.source_label ?? null,
        customer_id: options.customer_id ?? '',
      });
    },

    async proposeConfirmImport(input) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.proposeConfirmIntelligenceImport({
        customer_id: input.customer_id,
        raw_content: input.raw_content,
        keep_fact_ids: input.keep_fact_ids,
        keep_hypothesis_ids: input.keep_hypothesis_ids,
        fact_overrides: input.fact_overrides ?? {},
        fact_verifications: input.fact_verifications ?? [],
        source_system: 'MANUAL_PASTE',
        created_at: SALES_AGENT_APP_CLOCK.now(),
      });
    },

    cancelProposal(proposal) {
      cancelCanonicalProposal(proposal);
    },

    async confirmProposal(proposal) {
      const session = new SalesAgentSession(
        proposal.customer_id,
        null,
        () => SALES_AGENT_APP_CLOCK.now(),
        undefined,
      );
      const outcome = await session.confirmWriteByRef({
        proposal_id: proposal.proposal_id,
        nonce: proposal.nonce ?? '',
        confirmed_at: SALES_AGENT_APP_CLOCK.now(),
      }, approvedCrmWriteBoundary);
      return outcome as ConfirmWriteOutcome;
    },

    async generateStageCardDraft(customerId, stageCode) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.generateStageCardDraft(customerId, stageCode);
    },

    async proposeConfirmStageCard(customerId, cardId, expectedVersion) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.proposeConfirmStageCard({
        customer_id: customerId,
        card_id: cardId,
        expected_version: expectedVersion,
        created_at: SALES_AGENT_APP_CLOCK.now(),
      });
    },

    async getCurrentStageCard(customerId) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.getCurrentStageCard(customerId);
    },

    async listStageCardHistory(customerId) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.listStageCardHistory(customerId);
    },

    async compareStageCards(previousId, currentId) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.compareStageCards(previousId, currentId);
    },

    async listVerifiedFacts(customerId) {
      const db = await getDb();
      const repos = createBattleCardRepositories(db, () => SALES_AGENT_APP_CLOCK.now());
      return repos.facts.listByCustomer(customerId, { verification_status: 'VERIFIED' });
    },

    async listAllFacts(customerId) {
      const db = await getDb();
      const repos = createBattleCardRepositories(db, () => SALES_AGENT_APP_CLOCK.now());
      return repos.facts.listByCustomer(customerId);
    },

    async listHypotheses(customerId) {
      const db = await getDb();
      const repos = createBattleCardRepositories(db, () => SALES_AGENT_APP_CLOCK.now());
      return repos.hypotheses.listByCustomer(customerId);
    },

    async proposeUpdateHypothesisStatus(input) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.proposeUpdateHypothesisStatus({
        customer_id: input.customer_id,
        hypothesis_id: input.hypothesis_id,
        new_status: input.new_status,
        reason: input.reason ?? null,
        expected_version: input.expected_version,
        created_at: SALES_AGENT_APP_CLOCK.now(),
      });
    },

    async buildDailyReviewQueue(filters = {}) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.buildDailyReviewQueue(filters);
    },

    async getCustomerBattleContext(customerId) {
      const db = await getDb();
      const tools = createBattleCardAgentTools({ db, clock: () => SALES_AGENT_APP_CLOCK.now() });
      return tools.getCustomerBattleContext(customerId);
    },

    async getCustomer(customerId) {
      const db = await getDb();
      const rows = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', [customerId]);
      return rows[0] ?? null;
    },
  };
}

/** 单例生产客户端（UI 各处共享；无状态，内部每次经 getDb 取当前实例）。 */
let sharedClient: BattleCardUiClient | null = null;
export function getBattleCardUiClient(): BattleCardUiClient {
  if (!sharedClient) sharedClient = createBattleCardUiClient();
  return sharedClient;
}
