import type { SalesAgentRuntimeResult } from '../../lib/salesAgent/types';

const sectionStyle = { borderTop: '1px solid #e2e8f0', paddingTop: 10, marginTop: 10 } as const;

export function SalesAgentResultPanel({ runtime }: { runtime: SalesAgentRuntimeResult }) {
  const result = runtime.result;
  return (
    <article aria-label="AI Sales Agent Result">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong>AI Sales Agent Analysis</strong>
        <span>Sandbox / Mock reasoning · Confidence: {Math.round(result.confidence.value * 100)}%</span>
      </div>
      <div style={sectionStyle}><strong>Customer understanding</strong><div>{result.customer_summary.value}</div></div>
      <div style={sectionStyle}><strong>Current sales situation</strong><div>{result.customer_stage.value}</div></div>
      <ResultList title="Opportunity assessment" items={result.opportunities} />
      <ResultList title="Risk identification" items={result.risks} empty="No evidenced risk identified" />
      <ResultList title="Recommended next action" items={result.next_actions} />
      <div style={sectionStyle}>
        <strong>Evidence references</strong>
        <ul>{result.evidence.map(item => <li key={item.evidence_id}>{item.evidence_id} → {item.fact_type}:{item.fact_id}</li>)}</ul>
      </div>
      <div style={sectionStyle}>
        <strong>Decision basis</strong>
        <ul>{result.decision_basis.map(item => <li key={item.claim_path}>{item.claim_path}: {item.evidence_ids.join(', ')}</li>)}</ul>
      </div>
      <div style={sectionStyle}>
        <strong>Human review required</strong>
        <div>Pending human review · No automatic execution · Non-executable · No CRM Write</div>
      </div>
      <div style={{ ...sectionStyle, fontSize: 12, color: '#64748b' }}>
        Agent flow: {runtime.trace.map(item => `${item.step}:${item.status}`).join(' → ')} · Profile: {result.reasoning_metadata.profile_id}
        {' '}· Provider: {runtime.provider_id} · Model: {runtime.model_id} · Generated: {result.reasoning_metadata.generated_at}
      </div>
    </article>
  );
}

function ResultList({ title, items, empty }: {
  title: string;
  items: readonly { id: string; summary: string; evidence_ids: readonly string[] }[];
  empty?: string;
}) {
  return (
    <div style={sectionStyle}>
      <strong>{title}</strong>
      {items.length === 0 ? <div>{empty}</div> : <ul>{items.map(item => (
        <li key={item.id}>{item.summary} <small>[{item.evidence_ids.join(', ')}]</small></li>
      ))}</ul>}
    </div>
  );
}
