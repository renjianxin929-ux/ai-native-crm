import { v4 as uuid } from 'uuid';
import { createFollowUp, createTask, getDb, updateCustomer } from '../db';
import type { AgentWriteProposal } from './confirmedWrite';
import type { SafeWriteBoundary } from './agentSession';
import type { FollowUpRecord, Task } from '../types';
import { SALES_AGENT_APP_CLOCK, type AppClock } from './appClock';
import { createBattleCardWriteExecutor } from '../battleCard/agentTools';
import { createCustomerWithProductRules, type CustomerCreateInput } from '../customerCreate';

export interface ApprovedCrmWriteRepository { createFollowUp(record: FollowUpRecord): Promise<void>; createTask(task: Task): Promise<void>; updateCustomer(id: string, values: Record<string, unknown>): Promise<void>; }

/**
 * Battle Card V1 写工具执行器（可选注入）。
 * 确认动作发生在人工确认 Proposal 之后；执行器内部使用领域服务/Repository，不暴露 SQL。
 */
export interface BattleCardWriteExecutor {
  confirmIntelligenceImport(proposal: AgentWriteProposal): Promise<{ entity_id: string; effect: Record<string, unknown> }>;
  confirmStageCard(proposal: AgentWriteProposal): Promise<{ entity_id: string; effect: Record<string, unknown> }>;
  updateHypothesisStatus(proposal: AgentWriteProposal): Promise<{ entity_id: string; effect: Record<string, unknown> }>;
}

export interface ApprovedCrmWriteRepositoryWithBattleCard extends ApprovedCrmWriteRepository {
  readonly battleCard?: BattleCardWriteExecutor;
}

export function createApprovedCrmWriteBoundary(repository: ApprovedCrmWriteRepositoryWithBattleCard, clock: AppClock = SALES_AGENT_APP_CLOCK): SafeWriteBoundary {
  return {
    async execute(proposal: AgentWriteProposal, _confirmationId: string) {
      if (proposal.grouped_operations) {
        const selected = proposal.grouped_operations.filter(item => item.selected);
        if (selected.length === 0) throw new Error('组合建议没有选中的操作。');
        const entityIds: string[] = [];
        const fields: string[] = [];
        for (const item of selected) {
          const outcome = await executeOne({ ...proposal, tool_id: item.tool_id, current_values: item.current_values, proposed_values: item.proposed_values, grouped_operations: undefined }, repository, clock);
          entityIds.push(outcome.entity_id);
          fields.push(...outcome.fields);
        }
        return { entity_id: entityIds.join(','), fields: [...new Set(fields)] };
      }
      return executeOne(proposal, repository, clock);
    },
  };
}

async function executeOne(proposal: AgentWriteProposal, repository: ApprovedCrmWriteRepositoryWithBattleCard, clock: AppClock) {
      const now = clock.now(); const values = proposal.proposed_values;
      if (proposal.tool_id === 'create_follow_up_record') {
        const record: FollowUpRecord = { id: uuid(), customer_id: proposal.customer_id, title: String(values.title), contact_channel: null, contact_result: null, feedback_notes: typeof values.feedback_notes === 'string' ? values.feedback_notes : null, intent_assessment: null, suggested_grade: null, next_action: null, next_follow_up_at: typeof values.next_follow_up_at === 'string' ? values.next_follow_up_at : null, is_completed: 0, created_at: now, updated_at: now };
        await repository.createFollowUp(record); return { entity_id: record.id, fields: ['title', 'feedback_notes', 'next_follow_up_at'] };
      }
      if (proposal.tool_id === 'create_task') {
        const task: Task = { id: uuid(), customer_id: proposal.customer_id, title: String(values.title), due_at: typeof values.due_at === 'string' ? values.due_at : null, status: typeof values.status === 'string' ? values.status as Task['status'] : 'OPEN', priority: 'MEDIUM', source: 'MANUAL', created_at: now, updated_at: now };
        await repository.createTask(task); return { entity_id: task.id, fields: ['title', 'due_at', 'status'] };
      }
      // W4-1 customer.create：确认后走真实产品"新增客户"语义
      // （共享产品服务 createCustomerWithProductRules = CustomerForm create-mode：
      // 时间解析 → 初始等级 → 跟进时间 → 插入 → 后置产品规则）。
      // proposed_values 只含人工表单 20 字段（allowedFields['create_customer'] 白名单，
      // 经 canonical proposal hash 复核，不可被确认侧篡改）。
      if (proposal.tool_id === 'create_customer') {
        const outcome = await createCustomerWithProductRules({
          id: proposal.customer_id,
          ...(proposal.proposed_values as Readonly<Record<string, unknown>>),
        } as unknown as CustomerCreateInput);
        return { entity_id: outcome.customer_id, fields: Object.keys(proposal.proposed_values) };
      }
      if (proposal.tool_id === 'update_next_follow_up_time' || proposal.tool_id === 'update_customer_basic_fields') {
        await repository.updateCustomer(proposal.customer_id, values); return { entity_id: proposal.customer_id, fields: Object.keys(values) };
      }
      if (proposal.tool_id === 'confirm_battle_intelligence_import') {
        if (!repository.battleCard) throw new Error('Battle Card write executor is not configured.');
        const outcome = await repository.battleCard.confirmIntelligenceImport(proposal);
        return { entity_id: outcome.entity_id, fields: ['import_id', 'facts', 'hypotheses', ...Object.keys(outcome.effect)] };
      }
      if (proposal.tool_id === 'confirm_stage_card') {
        if (!repository.battleCard) throw new Error('Battle Card write executor is not configured.');
        const outcome = await repository.battleCard.confirmStageCard(proposal);
        return { entity_id: outcome.entity_id, fields: ['card_status', 'current_stage_card_id', ...Object.keys(outcome.effect)] };
      }
      if (proposal.tool_id === 'update_hypothesis_status') {
        if (!repository.battleCard) throw new Error('Battle Card write executor is not configured.');
        const outcome = await repository.battleCard.updateHypothesisStatus(proposal);
        return { entity_id: outcome.entity_id, fields: ['status', 'audit', ...Object.keys(outcome.effect)] };
      }
      throw new Error('Requested write tool is not supported by the approved CRM boundary.');
}

/**
 * 生产惰性 Battle Card executor：模块加载零副作用，每次写确认时经 getDb() 取当前实例
 * （getDb 内部缓存 dbInstance，生产路径仍为单例；测试环境可经 __setDbInstanceForTests 切换）。
 */
const productionBattleCardProxy: BattleCardWriteExecutor = {
  async confirmIntelligenceImport(proposal) {
    return createBattleCardWriteExecutor({ db: await getDb() }).confirmIntelligenceImport(proposal);
  },
  async confirmStageCard(proposal) {
    return createBattleCardWriteExecutor({ db: await getDb() }).confirmStageCard(proposal);
  },
  async updateHypothesisStatus(proposal) {
    return createBattleCardWriteExecutor({ db: await getDb() }).updateHypothesisStatus(proposal);
  },
};

/** Bounded adapter over existing manual CRM repository operations; no SQL is exposed to the Agent or UI. */
export const approvedCrmWriteBoundary = createApprovedCrmWriteBoundary({ createFollowUp, createTask, updateCustomer, battleCard: productionBattleCardProxy });
