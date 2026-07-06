import type { DashboardDataProjectionResult } from '../../lib/dashboardDataProjectionReadiness';
import { buildDashboardProjectionViewModel } from './dashboardProjectionViewModel';

export interface DashboardProjectionPanelProps {
  projection: DashboardDataProjectionResult;
  title?: string;
  compact?: boolean;
  showTrace?: boolean;
}

export function DashboardProjectionPanel({
  projection,
  title = 'AI Safety Dashboard Projection',
  compact = false,
  showTrace = false,
}: DashboardProjectionPanelProps) {
  const viewModel = buildDashboardProjectionViewModel(projection);

  return (
    <section className={compact ? 'page-body dashboard-projection compact' : 'page-body dashboard-projection'}>
      <header className="page-header">
        <div>
          <p className="section-title">{viewModel.stage}</p>
          <h1>{title}</h1>
        </div>
        <div className="dashboard-projection__badges" aria-label="Projection safety status">
          {viewModel.statusBadges.map(badge => (
            <span className="badge" key={badge}>{badge}</span>
          ))}
        </div>
      </header>

      {!viewModel.valid && (
        <section className="card" aria-label="Invalid projection notice">
          <h2 className="section-title">Invalid projection</h2>
          <p>Invalid projection - not shown as valid.</p>
          {viewModel.errorMessage && <p>{viewModel.errorMessage}</p>}
        </section>
      )}

      <section className="card" aria-label="Non-executable notice">
        <h2 className="section-title">Read-only notice</h2>
        {viewModel.notices.map(notice => (
          <p key={notice}>{notice}</p>
        ))}
      </section>

      <section className="summary-cards" aria-label="Safety summary">
        {viewModel.safetyItems.map(item => (
          <article className="summary-card" key={item.label}>
            <h2>{item.label}</h2>
            <p>{item.value}</p>
          </article>
        ))}
      </section>

      <section className="summary-cards" aria-label="Projection summary">
        {viewModel.summaryCards.map(item => (
          <article className="summary-card" key={item.label}>
            <h2>{item.label}</h2>
            <p>{item.value}</p>
          </article>
        ))}
      </section>

      <section className="card" aria-label="Blocked reason distribution">
        <h2 className="section-title">Blocked reason distribution</h2>
        {viewModel.blockedReasons.length > 0 ? (
          <dl>
            {viewModel.blockedReasons.map(reason => (
              <div key={reason.label}>
                <dt>{reason.label}</dt>
                <dd>{reason.count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No blocked rows available for display.</p>
        )}
      </section>

      <section className="card" aria-label="Projection rows">
        <h2 className="section-title">Projection rows</h2>
        {viewModel.rows.map(row => (
          <article className="card" key={row.id}>
            <h3>{row.title}</h3>
            <p>{row.displaySummary}</p>
            <dl>
              <div>
                <dt>Action type</dt>
                <dd>{row.actionType}</dd>
              </div>
              <div>
                <dt>Row status</dt>
                <dd>{row.rowStatus}</dd>
              </div>
              <div>
                <dt>Attention level</dt>
                <dd>{row.attentionLevel}</dd>
              </div>
              <div>
                <dt>Blocked reason</dt>
                <dd>{row.blockedReason}</dd>
              </div>
              <div>
                <dt>Evidence refs</dt>
                <dd>{row.evidenceRefCount}</dd>
              </div>
              <div>
                <dt>Risk flags</dt>
                <dd>{row.riskFlagCount}</dd>
              </div>
            </dl>
            <div>
              <h4 className="section-title">Missing proof</h4>
              <ul>
                {row.missingRequirementNames.map(name => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
            {showTrace && (
              <dl>
                {row.sourceRefs.map(ref => (
                  <div key={ref.label}>
                    <dt>{ref.label}</dt>
                    <dd>{ref.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        ))}
      </section>

      <section className="card" aria-label="Missing proof summary">
        <h2 className="section-title">Missing proof summary</h2>
        {viewModel.missingProofs.length > 0 ? (
          <dl>
            {viewModel.missingProofs.map(proof => (
              <div key={proof.name}>
                <dt>{proof.name}</dt>
                <dd>{proof.missingCount} rows: {proof.affectedRows.join(', ')}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No missing proof rows available for display.</p>
        )}
      </section>
    </section>
  );
}
