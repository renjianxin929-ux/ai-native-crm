import type { AgentSessionResult } from '../salesAgentTools/agentSession';

export interface ProjectedRiskOpportunity {
  readonly risks: readonly string[];
  readonly opportunities: readonly string[];
}

export interface ProjectedNextStep {
  readonly label: string;
}

export interface ProjectedEvidenceSummary {
  readonly count: number;
  readonly kinds: readonly string[];
}

export interface ProjectedResultCards {
  readonly understanding: string;
  readonly risks: readonly string[];
  readonly opportunities: readonly string[];
  readonly nextSteps: readonly ProjectedNextStep[];
  readonly evidence: ProjectedEvidenceSummary;
  readonly headline: string;
}

function splitList(text: string, max: number): string[] {
  const parts = text
    .split(/[;；\n]|、(?=[^，]*)|·/)
    .map(part => part.replace(/^[\d.、\s]+/, '').trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    const compact = text.trim();
    return compact ? [compact.slice(0, 80)] : [];
  }
  return parts.slice(0, max);
}

export function projectRisksAndOpportunities(raw: string): ProjectedRiskOpportunity {
  const lower = raw.toLowerCase();
  const riskMatch = raw.match(/风险[^：:]*[：:]([^机会]*)/i);
  const oppMatch = raw.match(/机会[^：:]*[：:]([\s\S]*)/i);
  if (riskMatch || oppMatch) {
    return {
      risks: splitList(riskMatch?.[1] ?? '', 2),
      opportunities: splitList(oppMatch?.[1] ?? '', 3),
    };
  }
  if (lower.includes('机会') && lower.includes('风险')) {
    const [riskPart, oppPart] = raw.split(/机会/);
    return {
      risks: splitList(riskPart.replace(/风险/g, ''), 2),
      opportunities: splitList(oppPart ?? '', 3),
    };
  }
  const items = splitList(raw, 5);
  return {
    risks: items.slice(0, Math.min(2, items.length)),
    opportunities: items.slice(2, 5),
  };
}

function inferEvidenceKinds(refs: readonly string[]): string[] {
  const kinds = new Set<string>();
  for (const ref of refs) {
    const value = ref.toLowerCase();
    if (value.includes('docx') || value.includes('纪要') || value.includes('meeting')) kinds.add('DOCX');
    else if (value.includes('pdf') || value.includes('方案')) kinds.add('PDF');
    else if (value.includes('xls') || value.includes('报价') || value.includes('quote')) kinds.add('XLSX');
    else if (value.includes('memory')) kinds.add('Memory');
    else if (value.includes('interaction') || value.includes('互动')) kinds.add('互动');
    else kinds.add('记录');
  }
  return [...kinds].slice(0, 3);
}

/** Compact 3–4 card projection for the unified result stage. */
export function projectResultCards(result: AgentSessionResult): ProjectedResultCards {
  const structured = result.structured;
  const understanding = (structured?.customer_understanding || result.response || '').trim().slice(0, 280);
  const { risks, opportunities } = projectRisksAndOpportunities(structured?.risks_and_opportunities ?? '');
  const nextRaw = structured?.recommended_next_step ?? '';
  const nextSteps = splitList(nextRaw, 3).map(label => ({ label }));
  const refs = structured?.evidence_refs?.length ? structured.evidence_refs : result.evidence_refs;
  return {
    understanding: understanding || '已生成客户洞察摘要。',
    risks,
    opportunities,
    nextSteps,
    evidence: {
      count: refs.length,
      kinds: inferEvidenceKinds(refs),
    },
    headline: understanding.split(/[。！？\n]/)[0]?.slice(0, 64) || 'Sales Agent 为你生成了洞察',
  };
}
