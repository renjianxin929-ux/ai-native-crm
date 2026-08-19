import { ArrowLeft, History, Sparkles } from 'lucide-react';
import type { Customer } from '../../lib/types';
import { BATTLE_CARD_STATUS_LABELS, formatDateTime, stageLabel } from '../../lib/battleCardUi/battleCardLabels';
import type { CustomerStageCardRow } from '../../lib/battleCard/types';
import { t, tFormat } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';

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
  useAppLocale();
  const status = customer.battle_card_status ?? 'NONE';
  const cardVersion = currentCard ? `v${currentCard.version}` : '—';
  const updatedAt = currentCard ? currentCard.confirmed_at ?? currentCard.created_at : null;

  return (
    <header className="bc-header" data-testid="battle-card-header">
      <div className="bc-header-top">
        <div className="bc-header-title">
          <button type="button" className="bc-btn bc-btn-ghost bc-btn-sm" onClick={onBack} aria-label={t('battle.back')}>
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
            <History size={14} aria-hidden="true" />{t('battle.openHistory')}
          </button>
          <button type="button" className="bc-btn bc-btn-primary bc-btn-sm" onClick={onEnterAgent} data-testid="bc-enter-agent">
            <Sparkles size={14} aria-hidden="true" />{t('battle.enterAgent')}
          </button>
        </div>
      </div>
      <div className="bc-header-meta" data-testid="bc-header-meta">
        <span><span className="bc-meta-label">{t('battle.grade')}</span> {tFormat('battle.gradeClass', { g: customer.customer_grade })}</span>
        <span><span className="bc-meta-label">{t('battle.cardVersion')}</span> {cardVersion}</span>
        <span><span className="bc-meta-label">{t('battle.updatedAt')}</span> {formatDateTime(updatedAt)}</span>
        <span><span className="bc-meta-label">{t('battle.evidenceFreshness')}</span> {evidenceFreshness}</span>
        {customer.region ? <span><span className="bc-meta-label">{t('battle.region')}</span> {customer.region}</span> : null}
        {customer.industry ? <span><span className="bc-meta-label">{t('battle.industry')}</span> {customer.industry}</span> : null}
      </div>
    </header>
  );
}
