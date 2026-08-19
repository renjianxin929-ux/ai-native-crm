import type { AgentSessionResult } from '../salesAgentTools/agentSession';
import { t } from '../i18n/appLocale';

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

export interface ProjectedResultSection {
  readonly title: string;
  readonly body: string;
}

export interface ProjectedResultCards {
  readonly understanding: string;
  readonly risks: readonly string[];
  readonly opportunities: readonly string[];
  readonly nextSteps: readonly ProjectedNextStep[];
  readonly evidence: ProjectedEvidenceSummary;
  readonly headline: string;
  readonly sections: readonly ProjectedResultSection[];
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
  const intent = result.plan?.intent ?? '';
  const understanding = (structured?.customer_understanding || result.response || '').trim().slice(0, 280);
  const { risks, opportunities } = projectRisksAndOpportunities(structured?.risks_and_opportunities ?? '');
  const nextRaw = structured?.recommended_next_step ?? '';
  const nextSteps = splitList(nextRaw, 3).map(label => ({ label }));
  const refs = structured?.evidence_refs?.length ? structured.evidence_refs : result.evidence_refs;
  const evidence: ProjectedEvidenceSummary = {
    count: refs.length,
    kinds: inferEvidenceKinds(refs),
  };
  const base = {
    understanding: understanding || t('result.understandingFallback'),
    risks,
    opportunities,
    nextSteps,
    evidence,
  };

  if (intent === 'NEXT_ACTION_PREPARATION') {
    const conclusion = stripClaimPrefix(understanding) || t('result.nextFallback');
    const actionBody = nextSteps.map(item => item.label).filter(Boolean).slice(0, 3).join('\n')
      || stripClaimPrefix(nextRaw);
    const support = [stripClaimPrefix(structured?.recent_changes ?? ''), evidence.count ? `${evidence.count} ${t('result.records')}` : '']
      .filter(Boolean)
      .join('；');
    return {
      ...base,
      headline: t('agent.nextAction.title'),
      sections: [
        { title: t('agent.section.conclusion'), body: conclusion },
        { title: t('agent.section.suggestedNext'), body: actionBody || t('result.humanReview') },
        { title: t('agent.section.evidence'), body: support || t('result.keepRhythm') },
      ],
    };
  }

  if (intent === 'INTERACTION_SUMMARY') {
    const progress = stripClaimPrefix(understanding);
    const notes = stripClaimPrefix(structured?.recent_changes ?? '');
    const nextBody = nextStepBodyForReview(nextRaw, notes, nextSteps);
    return {
      ...base,
      headline: t('agent.review.title'),
      sections: [
        { title: t('agent.section.progress'), body: progress || t('result.noProgress') },
        { title: t('agent.section.notes'), body: notes || t('result.noNotes') },
        { title: t('agent.section.next'), body: nextBody },
      ],
    };
  }

  return {
    ...base,
    headline: t('agent.analysis.title'),
    sections: [
      { title: t('agent.section.judgement'), body: base.understanding },
      { title: t('agent.section.risks'), body: [
        risks.length ? `${risks.length} ${t('result.riskCount')}：${risks.join('、')}` : `0 ${t('result.riskCount')}`,
        opportunities.length ? `${opportunities.length} ${t('result.oppCount')}：${opportunities.join('、')}` : `0 ${t('result.oppCount')}`,
      ].join('\n') },
      { title: t('agent.section.advice'), body: nextSteps.map(item => item.label).join('\n') || t('result.keepRhythm') },
    ],
  };
}

function stripClaimPrefix(text: string): string {
  return text.replace(/【[^】]*】/g, '').trim();
}

function nextStepBodyForReview(
  nextRaw: string,
  notes: string,
  nextSteps: readonly ProjectedNextStep[],
): string {
  const generic = /请人工复核后再决定下一步|保持跟进节奏|Review the facts|Keep the follow-up cadence/.test(nextRaw);
  if (!generic && nextSteps.length > 0) return nextSteps.map(item => item.label).join('\n');
  const fromNotes = notes.split(/[;；\n]/).map(part => part.trim()).find(part => /下一步|next step/i.test(part));
  return fromNotes || (!generic ? nextRaw.trim() : t('result.decideFromProgress'));
}
