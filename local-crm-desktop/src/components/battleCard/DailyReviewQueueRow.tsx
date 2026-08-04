import type { DailyReviewRowView } from '../../lib/battleCardUi/battleCardViewModels';
import { stageLabel } from '../../lib/battleCardUi/battleCardLabels';

export interface DailyReviewRowProps {
  readonly item: DailyReviewRowView;
  readonly onOpenCard: (customerId: string) => void;
  readonly onHandToAgent: (item: DailyReviewRowView) => void;
  readonly onRecordFollowUp: (customerId: string, customerName: string) => void;
}

/** 每日复盘队列行：展示进入原因（后端确定性）、目标、假设、下一步、卡片年龄、Evidence 变化、紧急度。 */
export function DailyReviewQueueRow({ item, onOpenCard, onHandToAgent, onRecordFollowUp }: DailyReviewRowProps) {
  return (
    <article className="bcr-row" data-testid="bcr-row" data-customer-id={item.customer_id} data-urgency={item.urgency_score}>
      <div className="bcr-row-head">
        <span className="bcr-row-name">
          {item.customer_name}
          <span className="bc-pill bc-pill-neutral">{stageLabel(item.stage)}</span>
          <span className="bc-pill bc-pill-accent">{item.priority} 类</span>
          {item.is_overdue ? <span className="bc-pill bc-pill-danger">已逾期</span> : null}
          {item.is_due_today ? <span className="bc-pill bc-pill-warning">今天到期</span> : null}
        </span>
        <span className="bcr-score" data-testid="bcr-urgency">紧急度 {item.urgency_score}</span>
      </div>
      <ul className="bcr-reasons" data-testid="bcr-reasons">
        {item.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
      </ul>
      <div className="bcr-body">
        <div className="bc-detail-item"><span className="bc-detail-label">当前目标</span><span>{item.current_goal}</span></div>
        <div className="bc-detail-item"><span className="bc-detail-label">下一步最佳行动</span><span>{item.next_best_action}</span></div>
        <div className="bc-detail-item"><span className="bc-detail-label">卡片年龄</span><span>{item.card_age_days == null ? '—' : `${item.card_age_days} 天`}</span></div>
        <div className="bc-detail-item"><span className="bc-detail-label">关键假设</span><span>{item.key_hypotheses.join('；') || '—'}</span></div>
      </div>
      {item.evidence_changes.length > 0 ? (
        <div className="bcr-evidence-changes" data-testid="bcr-evidence-changes">
          {item.evidence_changes.map((change, index) => <div key={index}>{change}</div>)}
        </div>
      ) : null}
      <div className="bcr-actions">
        <button type="button" className="bc-btn bc-btn-sm" onClick={() => onOpenCard(item.customer_id)} data-testid="bcr-open-card">
          进入完整作战卡
        </button>
        <button type="button" className="bc-btn bc-btn-sm" onClick={() => onHandToAgent(item)} data-testid="bcr-hand-to-agent">
          交给 Sales Agent
        </button>
        <button type="button" className="bc-btn bc-btn-sm" onClick={() => onRecordFollowUp(item.customer_id, item.customer_name)} data-testid="bcr-record-followup">
          记录跟进
        </button>
      </div>
    </article>
  );
}
