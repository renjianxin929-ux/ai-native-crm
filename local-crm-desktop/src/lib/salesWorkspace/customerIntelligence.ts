import type { CustomerMemoryEntry } from '../customerMemory';
import { isCompletedHistoricalFollowUp } from '../planner/followUpInteractionContract';
import { createCustomerScopedSalesAgentEntry, type CustomerScopedSalesAgentEntry } from './customerScopedSalesAgentEntry';
import { sortByInstantDesc } from '../time/instantCompare';
import type { Customer, FollowUpRecord, VisitRecord } from '../types';
import { GRADE_LABELS, INTENT_LABELS, STAGE_LABELS } from '../types';
import { resolveVerticalAIProfile } from '../verticalAIProfiles/registry';

export type CustomerTimelineItem = {
  readonly id: string;
  readonly kind: 'call' | 'meeting' | 'email' | 'note' | 'interaction';
  readonly occurredAt: string;
  readonly title: string;
  readonly detail: string;
  readonly evidenceId: string;
};

export function buildCustomerTimeline(
  followUps: readonly FollowUpRecord[],
  visits: readonly VisitRecord[],
): readonly CustomerTimelineItem[] {
  const historicalFollowUps = followUps.filter(isCompletedHistoricalFollowUp);
  return sortByInstantDesc([
    ...historicalFollowUps.map<CustomerTimelineItem>(item => ({ id: `follow-up:${item.id}`, kind: item.contact_channel === 'phone' ? 'call' : item.contact_channel === 'wechat' ? 'interaction' : 'note', occurredAt: item.updated_at, title: item.title, detail: item.feedback_notes || item.contact_result || '已记录跟进', evidenceId: item.id })),
    ...visits.map<CustomerTimelineItem>(item => ({ id: `visit:${item.id}`, kind: 'meeting', occurredAt: item.visited_at || item.updated_at, title: item.title, detail: item.visit_notes || item.customer_concerns || item.visit_outcome || '已记录面访', evidenceId: item.id })),
  ], item => item.occurredAt);
}

export function describeCustomerContext(customer: Customer, timeline: readonly CustomerTimelineItem[]): string {
  const lastChange = timeline[0] ? `最近记录为“${timeline[0].title}”。` : '暂无互动记录。';
  return `${GRADE_LABELS[customer.customer_grade]}，处于${STAGE_LABELS[customer.stage]}，当前意向为${INTENT_LABELS[customer.intent_level]}。${lastChange}`;
}

export function buildCustomerScopedSalesAgentEntry(
  customer: Customer,
  activeMemory: readonly CustomerMemoryEntry[],
  timeline: readonly CustomerTimelineItem[],
): CustomerScopedSalesAgentEntry {
  return createCustomerScopedSalesAgentEntry({
    customer_id: customer.id,
    context_snapshot_reference: `customer:${customer.id}:on-demand`,
    active_memory_ids: activeMemory.map(item => item.id),
    timeline_evidence_ids: timeline.map(item => item.evidenceId),
    profile_identity: resolveVerticalAIProfile().identity.id,
  });
}
