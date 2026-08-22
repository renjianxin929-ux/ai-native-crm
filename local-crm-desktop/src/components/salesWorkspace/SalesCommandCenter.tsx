import { Link } from 'react-router-dom';
import type { AIDraft, Customer, Task } from '../../lib/types';
import { GRADE_LABELS } from '../../lib/types';
import { buildSalesBrief } from '../../lib/salesWorkspace/salesBrief';

interface Props { readonly priorityCustomers: readonly Customer[]; readonly riskCustomers: readonly Customer[]; readonly pendingReviews: readonly Task[]; readonly existingInsights: readonly AIDraft[]; }

export function SalesCommandCenter({ priorityCustomers, riskCustomers, pendingReviews, existingInsights }: Props) {
  const brief = buildSalesBrief(priorityCustomers, riskCustomers, existingInsights);
  return <section className="card" aria-label="AI Sales Brief">
    <p className="sales-workspace-eyebrow">AI NATIVE DAILY BRIEF</p><h3 className="section-title">What needs attention today?</h3>
    <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>从既有 CRM 优先级、风险、下一步和已人工处理的 AI 结果生成的只读简报；不生成新推理，不调用 Provider。</p>
    <div className="detail-grid"><Summary label="Top priority" value={brief.length} /><Summary label="Existing risks" value={brief.filter(item => item.risk !== '暂无既有风险信号').length} /><Summary label="Pending reviews" value={pendingReviews.length} /><Summary label="Existing AI insights" value={existingInsights.filter(item => item.status === 'APPLIED').length} /></div>
    {brief.length === 0 ? <p className="empty-state">今天没有既有优先级信号。Sales Agent 分析仍需明确发起。</p> : <div className="sales-brief-list">{brief.slice(0, 5).map(item => <article className="sales-brief-item" key={item.customer.id}><div><Link to={`/customers/${item.customer.id}`}><strong>{item.customer.name}</strong></Link><span className={`badge badge-${item.customer.customer_grade.toLowerCase()}`}>{GRADE_LABELS[item.customer.customer_grade]}</span></div><p><strong>Opportunity:</strong> {item.opportunity}</p><p><strong>Risk:</strong> {item.risk}</p><p><strong>Next action:</strong> {item.nextAction}</p><small>Evidence: {item.evidenceReferences.join(' · ')} · Existing AI insights: {item.existingInsightCount}</small></article>)}</div>}
  </section>;
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="detail-item"><div className="label">{label}</div><div className="value">{value}</div></div>; }
