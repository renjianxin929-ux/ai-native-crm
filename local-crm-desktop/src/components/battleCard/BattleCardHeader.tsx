import { ArrowLeft, History, Sparkles } from 'lucide-react';
import type { Customer } from '../../lib/types';
import { BATTLE_CARD_STATUS_LABELS, formatDateTime, stageLabel } from '../../lib/battleCardUi/battleCardLabels';
import type { CustomerStageCardRow } from '../../lib/battleCard/types';

export interface BattleCardHeaderProps {
  readonly customer: Customer;
  readonly currentCard: CustomerStageCardRow | null;
  readonly evidenceFreshness: string;
  readonly onBack: () => void;
  readonly onOpenHistory: () => void;
  readonly onEnterAgent: () => void;
}

export function BattleCardHeader({
  customer,
  currentCard,
  evidenceFreshness,
  onBack,
  onOpenHistory,
  onEnterAgent,
}: BattleCardHeaderProps) {
  const status = customer.battle_card_status ?? 'NONE';
  const cardVersion = currentCard ? `v${currentCard.version}` : '—';
  const updatedAt = currentCard ? currentCard.confirmed_at ?? currentCard.created_at : null;

  return (
    <header className="bc-header" data-testid="battle-card-header">
      <div className="bc-header-top">
        <div className="bc-header-title">
          <button type="button" className="bc-btn bc-btn-ghost bc-btn-sm" onClick={onBack} aria-label="返回客户详情">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <span>{customer.name}</span>
          <span className="bc-pill bc-pill-neutral" data-testid="bc-header-stage">{stageLabel(customer.stage)}</span>
          <span className="bc-pill bc-pill-accent" data-testid="bc-header-card-status">
            {BATTLE_CARD_STATUS_LABELS[status] ?? status}
          </span>
        </div>
        <div className="bc-header-actions">
          <button type="button" className="bc-btn bc-btn-sm" onClick={onOpenHistory} data-testid="bc-open-history">
            <History size={14} aria-hidden="true" />版本历史
          </button>
          <button type="button" className="bc-btn bc-btn-primary bc-btn-sm" onClick={onEnterAgent} data-testid="bc-enter-agent">
            <Sparkles size={14} aria-hidden="true" />进入 Sales Agent
          </button>
        </div>
      </div>
      <div className="bc-header-meta" data-testid="bc-header-meta">
        <span><span className="bc-meta-label">客户等级</span> {customer.customer_grade} 类</span>
        <span><span className="bc-meta-label">当前卡版本</span> {cardVersion}</span>
        <span><span className="bc-meta-label">更新时间</span> {formatDateTime(updatedAt)}</span>
        <span><span className="bc-meta-label">Evidence 新鲜度</span> {evidenceFreshness}</span>
        <span><span className="bc-meta-label">地区</span> {customer.region ?? '—'}</span>
        <span><span className="bc-meta-label">行业</span> {customer.industry ?? '—'}</span>
      </div>
    </header>
  );
}
