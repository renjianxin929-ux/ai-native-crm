import { v4 as uuid } from 'uuid';
import { createFollowUp, createTask, deleteCustomer, getDb, persistOccurredFollowUp, updateCustomer, type OccurredFollowUpWrite } from '../db';
import type { AgentWriteProposal } from './confirmedWrite';
import type { SafeWriteBoundary } from './agentSession';
import type { FollowUpRecord, Task } from '../types';
import { SALES_AGENT_APP_CLOCK, type AppClock } from './appClock';
import { createBattleCardWriteExecutor } from '../battleCard/agentTools';
import { createCustomerWithProductRules, type CustomerCreateInput } from '../customerCreate';
import { updateCustomerProfile } from '../customerProfileUpdate';
import { updateCustomerOpportunityAmount } from '../customerOpportunityAmountUpdate';
import { createVisitWithProductRules, type VisitCreateInput } from '../visitCreate';

export interface ApprovedCrmWriteRepository { createFollowUp(record: FollowUpRecord): Promise<void>; createTask(task: Task): Promise<void>; updateCustomer(id: string, values: Record<string, unknown>): Promise<void>; persistOccurredFollowUp?(input: OccurredFollowUpWrite): Promise<void>; }

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
    async execute(proposal: AgentWriteProposal, confirmationId: string) {
      void confirmationId;
      if (proposal.grouped_operations) {
        const selected = proposal.grouped_operations.filter(item => item.selected);
        if (selected.length === 0) throw new Error('组合建议没有选中的操作。');
        const followUp = selected.find(item => item.tool_id === 'create_follow_up_record');
        const schedule = selected.find(item => item.tool_id === 'update_next_follow_up_time');
        if (followUp && schedule && selected.length === 2) {
          const next = schedule.proposed_values.next_follow_up_at;
          return persistOccurredFollowUpProposal(
            { ...proposal, tool_id: 'create_follow_up_record', proposed_values: { ...followUp.proposed_values, next_follow_up_at: next }, grouped_operations: undefined },
            repository,
            clock,
          );
        }
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
        return persistOccurredFollowUpProposal(proposal, repository, clock);
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
      // W4-2 customer.profile.update：确认后走真实产品"编辑客户资料"语义
      // （共享产品服务 updateCustomerProfile = CustomerForm edit-mode 的资料字段
      // 部分更新：存在性校验 → 仅资料列写入 → { customer_id }，绝不触发规则）。
      // proposed_values 只含 16 个资料白名单字段（allowedFields['update_customer_profile']
      // 白名单，经 canonical proposal hash 复核，不可被确认侧篡改）；共享服务在
      // 运行时再次闭合白名单（纵深防御第 3 层），绝不把 proposed_values 广度透传
      // 给 repository.updateCustomer。
      if (proposal.tool_id === 'update_customer_profile') {
        const outcome = await updateCustomerProfile(proposal.customer_id, proposal.proposed_values);
        return { entity_id: outcome.customer_id, fields: Object.keys(proposal.proposed_values) };
      }
      // C0 customer.opportunity_amount.update：确认后走真实窄义"更新商机金额"语义
      // （共享产品服务 updateCustomerOpportunityAmount：值闭合校验（有限正数或 null）
      // → 存在性校验 → 仅写 opportunity_amount 列 → { customer_id }，绝不触发规则）。
      // proposed_values 只含 opportunity_amount（allowedFields['update_opportunity_amount']
      // 白名单，经 canonical proposal hash 复核，不可被确认侧篡改）；共享服务在运行时
      // 再次闭合值约束（纵深防御第 3 层），绝不写入 deal_amount 或任何其它列。
      if (proposal.tool_id === 'update_opportunity_amount') {
        const outcome = await updateCustomerOpportunityAmount(proposal.customer_id, values.opportunity_amount);
        return { entity_id: outcome.customer_id, fields: ['opportunity_amount'] };
      }
      // W4-4 customer.delete：确认后走真实产品"删除客户"路径
      // （共享产品服务 deleteCustomer = CustomerDetail handleDelete 同一函数：
      // 硬删除客户行 + 应用层级联删除 follow_up/visit/task/battle-card 记录）。
      // 客户身份只来自 proposal.customer_id（= scope.customer_id，经 canonical
      // proposal hash + nonce/replay 复核，不可被确认侧篡改）；绝不创建第二份删除实现。
      if (proposal.tool_id === 'delete_customer') {
        await deleteCustomer(proposal.customer_id);
        return { entity_id: proposal.customer_id, fields: [] };
      }
      // W4-3 visit.create：确认后走真实产品"新增面访记录"语义
      // （共享产品服务 createVisitWithProductRules = VisitForm create-mode +
      // CustomerDetail.handleVisitSaved：存在性校验 → 可选面访结论规则更新客户
      // （只取 customer，丢弃 tasks）→ db.createVisit 插入 → { visit_id }）。
      // proposed_values 只含 7 个面访白名单字段（allowedFields['create_visit_record']
      // 白名单，经 canonical proposal hash 复核，不可被确认侧篡改）；共享服务在
      // 运行时再次闭合白名单 + 枚举（纵深防御第 3 层），绝不把 proposed_values
      // 广度透传给 db.createVisit 之外的任意表。
      if (proposal.tool_id === 'create_visit_record') {
        const outcome = await createVisitWithProductRules({
          id: uuid(),
          customer_id: proposal.customer_id,
          ...(proposal.proposed_values as Readonly<Record<string, unknown>>),
        } as unknown as VisitCreateInput);
        return { entity_id: outcome.visit_id, fields: Object.keys(proposal.proposed_values) };
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
export const approvedCrmWriteBoundary = createApprovedCrmWriteBoundary({ createFollowUp, createTask, updateCustomer, persistOccurredFollowUp, battleCard: productionBattleCardProxy });

async function persistOccurredFollowUpProposal(
  proposal: AgentWriteProposal,
  repository: ApprovedCrmWriteRepositoryWithBattleCard,
  clock: AppClock,
) {
  const now = clock.now();
  const values = proposal.proposed_values;
  const record: FollowUpRecord = {
    id: uuid(),
    customer_id: proposal.customer_id,
    title: String(values.title),
    contact_channel: null,
    contact_result: null,
    feedback_notes: typeof values.feedback_notes === 'string' ? values.feedback_notes : null,
    intent_assessment: null,
    suggested_grade: null,
    next_action: null,
    next_follow_up_at: null,
    is_completed: 1,
    created_at: now,
    updated_at: now,
  };
  const next = typeof values.next_follow_up_at === 'string' && values.next_follow_up_at.trim()
    ? values.next_follow_up_at
    : undefined;
  const input: OccurredFollowUpWrite = {
    record,
    last_contacted_at: now,
    ...(next ? { next_follow_up_at: next } : {}),
  };
  if (repository.persistOccurredFollowUp) await repository.persistOccurredFollowUp(input);
  else await persistOccurredFollowUp(input, () => now);
  return {
    entity_id: record.id,
    fields: next ? ['title', 'feedback_notes', 'is_completed', 'next_follow_up_at'] : ['title', 'feedback_notes', 'is_completed'],
  };
}
