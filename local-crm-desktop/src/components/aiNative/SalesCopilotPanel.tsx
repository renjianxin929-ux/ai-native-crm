import type { SalesCopilotWorkflowResult } from '../../lib/salesCopilot/types';
import { SalesAgentResultPanel } from './SalesAgentResultPanel';

export function SalesCopilotPanel({ results }: { results: readonly SalesCopilotWorkflowResult[] }) {
  return (
    <section aria-label="AI Sales Copilot Workflow">
      <header>
        <h3>AI Sales Copilot</h3>
        <p>Mock reasoning · Read-only · Evidence-backed · Human review required · Not executable · No CRM write</p>
      </header>
      {results.map(result => {
        if (result.kind === 'customer_intelligence') return (
          <article key={result.kind} aria-label="Customer Intelligence">
            <h4>Customer Intelligence</h4>
            <SalesAgentResultPanel runtime={result.runtime} />
          </article>
        );
        if (result.kind === 'sales_priority') return (
          <article key={result.kind} aria-label="Sales Priority">
            <h4>Sales Priority</h4>
            <ol>{result.items.map(item => <li key={item.customer_id}>
              <strong>#{item.rank} {item.customer_name} · {item.priority_level}</strong>
              <div>{item.priority_reason} [{item.priority_reason_evidence_ids.join(', ')}]</div>
              <div>Next: {item.recommended_next_action.summary} [{item.recommended_next_action.evidence_ids.join(', ')}]</div>
              <small>Profile: {item.selected_profile_id} · Confidence: {Math.round(item.confidence.value * 100)}% · {item.review_status.replaceAll('_', ' ')}</small>
            </li>)}</ol>
          </article>
        );
        return (
          <article key={result.kind} aria-label="Interaction Intelligence">
            <h4>Interaction Intelligence</h4>
            <p>Explicit manual reassessment · Source event: {result.source_event_id}</p>
            <p>Signals reviewed: {result.detection_categories.join(', ')}</p>
            <SalesAgentResultPanel runtime={result.runtime} />
          </article>
        );
      })}
    </section>
  );
}
