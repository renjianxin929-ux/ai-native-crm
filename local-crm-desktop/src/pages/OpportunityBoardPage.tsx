import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { Customer } from '../lib/types';
import { projectOpportunityBoard, type BoardStage } from '../lib/opportunityBoard/opportunityBoardProjection';
import {
  BOARD_COLUMN_LABELS,
  BOARD_COLUMN_ORDER,
  countThisWeekFollowUps,
  formatFollowUpDate,
  formatOpenPipelineMetric,
  formatOpportunityAmount,
  rowsForBoardStage,
} from '../lib/opportunityBoard/boardPresentation';
import { t, tStage } from '../lib/i18n/appLocale';
import { useAppLocale } from '../lib/i18n/LocaleProvider';
import CustomerForm from '../components/CustomerForm';

interface Props {
  customers: Customer[];
  onRefresh: () => void;
}

const COLUMN_DOT: Record<BoardStage, string> = {
  NEW: 'board-dot-new',
  ACTIVE: 'board-dot-active',
  PENDING: 'board-dot-pending',
  WON: 'board-dot-won',
  LOST: 'board-dot-lost',
};

export default function OpportunityBoardPage({ customers, onRefresh }: Props) {
  const navigate = useNavigate();
  useAppLocale();
  const [showCreate, setShowCreate] = useState(false);
  const projection = useMemo(() => projectOpportunityBoard(customers), [customers]);
  const weekCount = useMemo(() => countThisWeekFollowUps(projection.rows), [projection.rows]);
  const visibleColumns = BOARD_COLUMN_ORDER.filter(stage => stage !== 'LOST' || projection.summary.lost_count > 0);

  return (
    <div className="product-page board-page" data-testid="opportunity-board-page">
      <div className="page-header board-header">
        <div>
          <h2>{t('board.title')}</h2>
          <p className="page-subtitle">{t('board.subtitle')}</p>
          <p className="board-quiet-metrics" data-testid="board-metrics">
            <span>{t('board.openPipeline')} <strong data-testid="board-open-pipeline">{formatOpenPipelineMetric(projection)}</strong></span>
            <span>{t('board.weekFollowUps')} <strong data-testid="board-week-followups">{weekCount}</strong></span>
            <span>{t('board.pending')} <strong data-testid="board-pending-count">{projection.summary.pending_count}</strong></span>
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> {t('board.addCustomer')}
        </button>
      </div>

      <div className="page-body board-body">
        <div className="board-columns" data-testid="board-columns">
          {visibleColumns.map(stage => {
            const rows = rowsForBoardStage(projection.rows, stage);
            return (
              <section key={stage} className="board-column" data-board-stage={stage} aria-label={BOARD_COLUMN_LABELS[stage]}>
                <header className="board-column-header">
                  <span className={`board-dot ${COLUMN_DOT[stage]}`} aria-hidden="true" />
                  <h3>{BOARD_COLUMN_LABELS[stage]}</h3>
                  <small>{rows.length}</small>
                </header>
                <div className="board-column-cards">
                  {rows.length === 0 ? (
                    <p className="board-column-empty">{t('board.empty')}</p>
                  ) : rows.map(row => (
                    <button
                      key={row.customer_id}
                      type="button"
                      className="board-card"
                      data-testid={`board-card-${row.customer_id}`}
                      onClick={() => navigate(`/customers/${row.customer_id}`)}
                    >
                      <strong>{row.name}</strong>
                      <span className="board-card-stage">{tStage(row.stage)}</span>
                      <span className="board-card-amount" data-testid={`board-amount-${row.customer_id}`}>
                        {formatOpportunityAmount(row.opportunity_amount)}
                      </span>
                      {formatFollowUpDate(row.next_follow_up_at) ? (
                        <span className="board-card-date">{formatFollowUpDate(row.next_follow_up_at)}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {showCreate ? (
        <CustomerForm
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); onRefresh(); }}
        />
      ) : null}
    </div>
  );
}
