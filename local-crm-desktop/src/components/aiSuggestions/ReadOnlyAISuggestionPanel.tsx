import type { ReadOnlyAISuggestionServiceResponse } from '../../lib/readOnlyAISuggestionServiceReadiness';
import { buildReadOnlyAISuggestionViewModel } from './readOnlyAISuggestionViewModel';

export interface ReadOnlyAISuggestionPanelProps {
  response: ReadOnlyAISuggestionServiceResponse;
  title?: string;
  compact?: boolean;
  showProvenance?: boolean;
  showTrace?: boolean;
}

export function ReadOnlyAISuggestionPanel({
  response,
  title = 'Read-only AI Suggestions',
  compact = false,
  showProvenance = true,
  showTrace = false,
}: ReadOnlyAISuggestionPanelProps) {
  const viewModel = buildReadOnlyAISuggestionViewModel(response);

  return (
    <section className={compact ? 'page-body ai-suggestions compact' : 'page-body ai-suggestions'}>
      <header className="page-header">
        <div>
          <p className="section-title">Preview</p>
          <h1>{title}</h1>
        </div>
        <div className="ai-suggestions__badges" aria-label="Read-only AI suggestion safety labels">
          {viewModel.statusBadges.map(badge => (
            <span className="badge" key={badge}>{badge}</span>
          ))}
        </div>
      </header>

      <section className="card" aria-label="Read-only AI suggestion notice">
        <h2 className="section-title">Read-only preview notice</h2>
        {viewModel.notices.map(notice => (
          <p key={notice}>{notice}</p>
        ))}
      </section>

      <section className="summary-cards" aria-label="Read-only AI suggestion safety summary">
        {viewModel.safetyItems.map(item => (
          <article className="summary-card" key={item}>
            <h2>{item}</h2>
            <p>Informational only</p>
          </article>
        ))}
      </section>

      <section className="summary-cards" aria-label="Read-only AI suggestion summary">
        {viewModel.summaryItems.map(item => (
          <article className="summary-card" key={item.label}>
            <h2>{item.label}</h2>
            <p>{item.value}</p>
          </article>
        ))}
      </section>

      {showProvenance && (
        <section className="card" aria-label="Read-only AI suggestion provenance">
          <h2 className="section-title">Provenance - informational only, not trusted for action</h2>
          <dl>
            {viewModel.provenanceItems.map(item => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="card" aria-label="Read-only AI suggestion cards">
        <h2 className="section-title">Suggestion cards</h2>
        {viewModel.cards.length === 0 ? (
          <p>No read-only suggestion cards to preview.</p>
        ) : (
          viewModel.cards.map(card => (
            <article className="card" key={card.cardId}>
              <h3>{card.title}</h3>
              <p>{card.summary}</p>
              <dl>
                <div>
                  <dt>Card ID</dt>
                  <dd>{card.cardId}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{card.status}</dd>
                </div>
                <div>
                  <dt>Requires human review</dt>
                  <dd>{card.requiresHumanReview ? 'true' : 'false'}</dd>
                </div>
                <div>
                  <dt>Action state</dt>
                  <dd>Not executable</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </section>

      {showTrace && (
        <section className="card" aria-label="Read-only AI suggestion trace summary">
          <h2 className="section-title">Trace summary</h2>
          <dl>
            {viewModel.traceItems.map(item => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </section>
  );
}
