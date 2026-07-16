import { v4 as uuid } from 'uuid';
import { createFollowUp, createTask, updateCustomer } from '../db';
import type { AgentWriteProposal } from './confirmedWrite';
import type { SafeWriteBoundary } from './agentSession';
import type { FollowUpRecord, Task } from '../types';
import { SALES_AGENT_APP_CLOCK, type AppClock } from './appClock';

export interface ApprovedCrmWriteRepository { createFollowUp(record: FollowUpRecord): Promise<void>; createTask(task: Task): Promise<void>; updateCustomer(id: string, values: Record<string, unknown>): Promise<void>; }

export function createApprovedCrmWriteBoundary(repository: ApprovedCrmWriteRepository, clock: AppClock = SALES_AGENT_APP_CLOCK): SafeWriteBoundary {
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

async function executeOne(proposal: AgentWriteProposal, repository: ApprovedCrmWriteRepository, clock: AppClock) {
      const now = clock.now(); const values = proposal.proposed_values;
      if (proposal.tool_id === 'create_follow_up_record') {
        const record: FollowUpRecord = { id: uuid(), customer_id: proposal.customer_id, title: String(values.title), contact_channel: null, contact_result: null, feedback_notes: typeof values.feedback_notes === 'string' ? values.feedback_notes : null, intent_assessment: null, suggested_grade: null, next_action: null, next_follow_up_at: typeof values.next_follow_up_at === 'string' ? values.next_follow_up_at : null, is_completed: 0, created_at: now, updated_at: now };
        await repository.createFollowUp(record); return { entity_id: record.id, fields: ['title', 'feedback_notes', 'next_follow_up_at'] };
      }
      if (proposal.tool_id === 'create_task') {
        const task: Task = { id: uuid(), customer_id: proposal.customer_id, title: String(values.title), due_at: typeof values.due_at === 'string' ? values.due_at : null, status: typeof values.status === 'string' ? values.status as Task['status'] : 'OPEN', priority: 'MEDIUM', source: 'MANUAL', created_at: now, updated_at: now };
        await repository.createTask(task); return { entity_id: task.id, fields: ['title', 'due_at', 'status'] };
      }
      if (proposal.tool_id === 'update_next_follow_up_time' || proposal.tool_id === 'update_customer_basic_fields') {
        await repository.updateCustomer(proposal.customer_id, values); return { entity_id: proposal.customer_id, fields: Object.keys(values) };
      }
      throw new Error('Requested write tool is not supported by the approved CRM boundary.');
}

/** Bounded adapter over existing manual CRM repository operations; no SQL is exposed to the Agent or UI. */
export const approvedCrmWriteBoundary = createApprovedCrmWriteBoundary({ createFollowUp, createTask, updateCustomer });
