import type { Customer, FollowUpRecord, VisitRecord, AIDraft } from '../../lib/types';
import type { CustomerMemoryEntry } from '../../lib/customerMemory';
import { GRADE_LABELS, INTENT_LABELS, STAGE_LABELS } from '../../lib/types';
import { resolveVerticalAIProfile } from '../../lib/verticalAIProfiles/registry';
import { createCustomerScopedSalesAgentEntry, type CustomerScopedSalesAgentEntry } from '../../lib/salesWorkspace/customerScopedSalesAgentEntry';

export type CustomerTimelineItem = {
  readonly id: string;
  readonly kind: 'call' | 'meeting' | 'email' | 'note' | 'interaction';
  readonly occurredAt: string;
  readonly title: string;
  readonly detail: string;
  readonly evidenceId: string;
};

export function buildCustomerTimeline(followUps: readonly FollowUpRecord[], visits: readonly VisitRecord[]): readonly CustomerTimelineItem[] {
  return [
    ...followUps.map<CustomerTimelineItem>(item => ({ id: `follow-up:${item.id}`, kind: item.contact_channel === 'phone' ? 'call' : item.contact_channel === 'wechat' ? 'interaction' : 'note', occurredAt: item.updated_at, title: item.title, detail: item.feedback_notes || item.contact_result || '已记录跟进', evidenceId: item.id })),
    ...visits.map<CustomerTimelineItem>(item => ({ id: `visit:${item.id}`, kind: 'meeting', occurredAt: item.visited_at || item.updated_at, title: item.title, detail: item.visit_notes || item.customer_concerns || item.visit_outcome || '已记录面访', evidenceId: item.id })),
  ].toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function describeCustomerContext(customer: Customer, timeline: readonly CustomerTimelineItem[]): string {
  const lastChange = timeline[0] ? `最近记录为“${timeline[0].title}”。` : '暂无互动记录。';
  return `${GRADE_LABELS[customer.customer_grade]}，处于${STAGE_LABELS[customer.stage]}，当前意向为${INTENT_LABELS[customer.intent_level]}。${lastChange}`;
}

export function buildCustomerScopedSalesAgentEntry(customer: Customer, activeMemory: readonly CustomerMemoryEntry[], timeline: readonly CustomerTimelineItem[]): CustomerScopedSalesAgentEntry {
  return createCustomerScopedSalesAgentEntry({ customer_id: customer.id, context_snapshot_reference: `customer:${customer.id}:on-demand`, active_memory_ids: activeMemory.map(item => item.id), timeline_evidence_ids: timeline.map(item => item.evidenceId), profile_identity: resolveVerticalAIProfile().identity.id });
}

interface Props { readonly customer: Customer; readonly followUps: readonly FollowUpRecord[]; readonly visits: readonly VisitRecord[]; readonly activeMemory: readonly CustomerMemoryEntry[]; readonly drafts: readonly AIDraft[]; }

export function CustomerIntelligencePanel({ customer, followUps, visits, activeMemory, drafts }: Props) {
  const timeline = buildCustomerTimeline(followUps, visits);
  const reviewedDrafts = drafts.filter(item => item.status === 'APPLIED');
  const existingRecommendation = customer.next_action || '暂无已有建议；如需新建议，请明确发起 Sales Agent。';

  return <section className="card sales-workspace-card" aria-label="Customer Intelligence">
    <header className="sales-workspace-header">
      <div><p className="sales-workspace-eyebrow">AI NATIVE CUSTOMER WORKSPACE</p><h3 className="section-title">客户理解</h3><p className="sales-workspace-summary">{describeCustomerContext(customer, timeline)}</p></div>
      <div className="sales-workspace-actions"><span className="badge badge-medium">Human review required</span><span className="sales-workspace-entry-note">Sales Agent 从页面顶部的主入口发起。</span></div>
    </header>
    <p className="sales-workspace-truth">此视图只加载已有 CRM 上下文、ACTIVE memory 与已处理 AI 结果；不会自动分析客户、调用模型或产生新推理。</p>

    <div className="sales-workspace-grid">
      <InsightCard label="Current status" value={`${STAGE_LABELS[customer.stage]} · ${INTENT_LABELS[customer.intent_level]}`} evidence="客户 CRM 记录" />
      <InsightCard label="Existing priority signal" value={GRADE_LABELS[customer.customer_grade]} evidence="客户等级字段" />
      <InsightCard label="Opportunities" value={customer.industry || '行业/主营产品待补充'} evidence="客户 CRM 记录" />
      <InsightCard label="Risks" value={customer.next_follow_up_at ? '请人工核对下次跟进安排' : '未设置下次跟进时间'} evidence="客户 CRM 记录" />
      <InsightCard label="Recommended next action" value={existingRecommendation} evidence="已有 CRM 建议字段" />
      <InsightCard label="Evidence references" value={`${timeline.length} 条互动 · ${activeMemory.length} 条 ACTIVE memory`} evidence="可追溯记录" />
    </div>

    <div className="sales-workspace-columns">
      <section aria-label="Recent changes"><h4>Recent changes</h4>{timeline.length === 0 ? <Empty copy="暂无 follow-up、visit 或 interaction 记录。" /> : <ol className="sales-workspace-timeline">{timeline.slice(0, 5).map(item => <li key={item.id}><span className="sales-workspace-kind">{item.kind}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>Evidence: {item.evidenceId}</small></div></li>)}</ol>}</section>
      <section aria-label="Active customer memory"><h4>Active memory context</h4>{activeMemory.length === 0 ? <Empty copy="暂无 ACTIVE memory。" /> : <ul className="sales-workspace-memory">{activeMemory.map(item => <li key={item.id}><strong>{item.memory_type}</strong><p>{item.content}</p><small>Evidence: {item.evidence.map(link => link.evidence_id).join(', ') || '未关联'}</small></li>)}</ul>}</section>
    </div>

    <section className="sales-workspace-results" aria-label="Existing AI results"><h4>Existing AI results</h4>{reviewedDrafts.length === 0 ? <Empty copy="暂无已人工处理的 AI 结果。新的客户分析需要明确发起。" /> : reviewedDrafts.map(item => <p key={item.id}><strong>Human-handled result</strong> · {item.raw_input_summary} <small>Evidence: draft {item.id}</small></p>)}</section>
  </section>;
}

function InsightCard({ label, value, evidence }: { label: string; value: string; evidence: string }) { return <div className="sales-workspace-insight"><span>{label}</span><strong>{value}</strong><small>Evidence: {evidence}</small></div>; }
function Empty({ copy }: { copy: string }) { return <p className="sales-workspace-empty">{copy}</p>; }
