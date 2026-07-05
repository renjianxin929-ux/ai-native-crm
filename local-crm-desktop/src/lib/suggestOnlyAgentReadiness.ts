import type {
  ReadOnlyAgentAnswer,
  ReadOnlyAgentEvidenceRef,
  ReadOnlyAgentFinding,
  ReadOnlyAgentIntent,
  ReadOnlyAgentSnapshot,
} from './readOnlyAgentReadiness';

export const SUGGEST_ONLY_AGENT_VERSION = 'v1';

export type SuggestOnlyAgentProposalType =
  | 'REVIEW_CUSTOMER_PRIORITY'
  | 'REVIEW_GRADE_CHANGE'
  | 'REVIEW_SYNC_FAILURE'
  | 'REVIEW_FOLLOW_UP_TASK'
  | 'REVIEW_EVIDENCE_GAP'
  | 'REVIEW_STUCK_WORK_ITEM'
  | 'REVIEW_NEXT_BEST_ACTION';

export type SuggestOnlyAgentConfidenceLevel = 'low' | 'medium' | 'high';

export type SuggestOnlyAgentRiskFlag =
  | 'fixture_only_signal'
  | 'insufficient_evidence'
  | 'sync_failed'
  | 'stale_work_item'
  | 'grade_upgrade_requires_review'
  | 'customer_creation_requires_review'
  | 'message_send_requires_review';

export type SuggestOnlyAgentEvidenceRef = ReadOnlyAgentEvidenceRef;

export interface SuggestOnlyAgentAttachedMetadata {
  active_profile_id?: string;
  source_gate?: 'read_only_agent_v1';
  note?: string;
}

export interface SuggestOnlyAgentRequest {
  kind: 'SUGGEST_ONLY_AGENT_REQUEST';
  version: typeof SUGGEST_ONLY_AGENT_VERSION;
  request_id: string;
  synthetic: true;
  fixture_only: true;
  read_only_answer: ReadOnlyAgentAnswer;
  snapshot: ReadOnlyAgentSnapshot;
  attached_metadata?: SuggestOnlyAgentAttachedMetadata;
}

export interface SuggestOnlyAgentSafety {
  writes_database: false;
  no_side_effects: true;
  no_provider_calls: true;
  no_network: true;
  requires_confirmation_for_all_proposals: true;
  represents_true_agent: false;
  represents_confirmed_action_agent: false;
  represents_executed_action: false;
  forbidden_proposal_phrases: readonly string[];
}

export interface SuggestOnlyAgentPlan {
  kind: 'SUGGEST_ONLY_AGENT_PLAN';
  version: typeof SUGGEST_ONLY_AGENT_VERSION;
  executable: false;
  persisted: false;
  reason: 'suggest_only_agent_readiness_only';
  request: SuggestOnlyAgentRequest;
  allowed_operations: readonly ['read_findings', 'emit_proposals'];
  forbidden_operations: readonly string[];
  safety: SuggestOnlyAgentSafety;
}

export interface SuggestOnlyAgentProposal {
  kind: 'SUGGEST_ONLY_AGENT_PROPOSAL';
  version: typeof SUGGEST_ONLY_AGENT_VERSION;
  proposal_id: string;
  proposal_type: SuggestOnlyAgentProposalType;
  title: string;
  summary: string;
  recommended_action_label: string;
  evidence_refs: readonly SuggestOnlyAgentEvidenceRef[];
  risk_flags: readonly SuggestOnlyAgentRiskFlag[];
  confidence_level: SuggestOnlyAgentConfidenceLevel;
  requires_confirmation: true;
  executable: false;
  persisted: false;
  represents_executed_action: false;
  forbidden_without_confirmation: true;
  source_finding_intent: ReadOnlyAgentIntent | string;
}

export interface SuggestOnlyAgentAnswer {
  kind: 'SUGGEST_ONLY_AGENT_ANSWER';
  version: typeof SUGGEST_ONLY_AGENT_VERSION;
  suggest_only_summary: string;
  proposals: readonly SuggestOnlyAgentProposal[];
  safety: SuggestOnlyAgentSafety;
  represents_executed_action: false;
}

export interface SuggestOnlyAgentTrace {
  kind: 'SUGGEST_ONLY_AGENT_TRACE';
  plan: SuggestOnlyAgentPlan;
  answer: SuggestOnlyAgentAnswer;
  persisted: false;
}

export function buildSuggestOnlyAgentPlan(request: SuggestOnlyAgentRequest): SuggestOnlyAgentPlan {
  return {
    kind: 'SUGGEST_ONLY_AGENT_PLAN',
    version: SUGGEST_ONLY_AGENT_VERSION,
    executable: false,
    persisted: false,
    reason: 'suggest_only_agent_readiness_only',
    request,
    allowed_operations: ['read_findings', 'emit_proposals'],
    forbidden_operations: [
      'write_db',
      'sync',
      'update_status',
      'create_customer',
      'update_customer',
      'update_grade',
      'create_task',
      'call_provider',
      'send_message',
      'execute_proposal',
      'persist_proposal',
    ],
    safety: buildSuggestOnlyAgentSafety(),
  };
}

export function proposeFromReadOnlyFindings(plan: SuggestOnlyAgentPlan): SuggestOnlyAgentProposal[] {
  return proposeFromReadOnlyAnswer(plan.request.read_only_answer);
}

export function proposeFromReadOnlyAnswer(answer: ReadOnlyAgentAnswer): SuggestOnlyAgentProposal[] {
  return answer.findings.map((finding, index) => buildProposal(finding, index));
}

export function buildSuggestOnlyAgentTrace(plan: SuggestOnlyAgentPlan): SuggestOnlyAgentTrace {
  const proposals = proposeFromReadOnlyFindings(plan);

  return {
    kind: 'SUGGEST_ONLY_AGENT_TRACE',
    plan,
    answer: {
      kind: 'SUGGEST_ONLY_AGENT_ANSWER',
      version: SUGGEST_ONLY_AGENT_VERSION,
      suggest_only_summary: `Suggest-only review has ${proposals.length} proposal(s); confirmation is required before any separate action path.`,
      proposals,
      safety: plan.safety,
      represents_executed_action: false,
    },
    persisted: false,
  };
}

function buildSuggestOnlyAgentSafety(): SuggestOnlyAgentSafety {
  return {
    writes_database: false,
    no_side_effects: true,
    no_provider_calls: true,
    no_network: true,
    requires_confirmation_for_all_proposals: true,
    represents_true_agent: false,
    represents_confirmed_action_agent: false,
    represents_executed_action: false,
    forbidden_proposal_phrases: [
      ['已', '发送'].join(''),
      ['已', '执行'].join(''),
      ['已更新', '客户'].join(''),
      ['已创建', '客户'].join(''),
      ['已', '同步'].join(''),
      ['已写入', ' CRM'].join(''),
      ['自动', '创建客户'].join(''),
      ['自动', '升级等级'].join(''),
    ],
  };
}

function buildProposal(finding: ReadOnlyAgentFinding, index: number): SuggestOnlyAgentProposal {
  const proposalType = proposalTypeFor(finding);
  const riskFlags = riskFlagsFor(proposalType);

  return {
    kind: 'SUGGEST_ONLY_AGENT_PROPOSAL',
    version: SUGGEST_ONLY_AGENT_VERSION,
    proposal_id: `SUGGEST_EVAL_${String(index + 1).padStart(3, '0')}`,
    proposal_type: proposalType,
    title: titleFor(proposalType),
    summary: summaryFor(proposalType, finding),
    recommended_action_label: actionLabelFor(proposalType),
    evidence_refs: proposalType === 'REVIEW_EVIDENCE_GAP' ? [] : finding.evidence_refs,
    risk_flags: riskFlags,
    confidence_level: confidenceFor(finding, riskFlags),
    requires_confirmation: true,
    executable: false,
    persisted: false,
    represents_executed_action: false,
    forbidden_without_confirmation: true,
    source_finding_intent: finding.intent,
  };
}

function proposalTypeFor(finding: ReadOnlyAgentFinding): SuggestOnlyAgentProposalType {
  if (finding.evidence_refs.length === 0 || finding.uncertainty) return 'REVIEW_EVIDENCE_GAP';
  if (finding.intent === 'sync_failures') return 'REVIEW_SYNC_FAILURE';
  if (finding.intent === 'stuck_work_items') return 'REVIEW_STUCK_WORK_ITEM';
  if (finding.intent === 'today_priorities') return 'REVIEW_FOLLOW_UP_TASK';
  if (finding.intent === 'next_best_read_only_summary') return 'REVIEW_NEXT_BEST_ACTION';
  if (finding.title.toLowerCase().includes('grade')) return 'REVIEW_GRADE_CHANGE';
  return 'REVIEW_CUSTOMER_PRIORITY';
}

function riskFlagsFor(proposalType: SuggestOnlyAgentProposalType): SuggestOnlyAgentRiskFlag[] {
  if (proposalType === 'REVIEW_SYNC_FAILURE') {
    return ['sync_failed', 'fixture_only_signal', 'message_send_requires_review'];
  }
  if (proposalType === 'REVIEW_STUCK_WORK_ITEM') return ['stale_work_item', 'fixture_only_signal'];
  if (proposalType === 'REVIEW_GRADE_CHANGE') return ['grade_upgrade_requires_review', 'fixture_only_signal'];
  if (proposalType === 'REVIEW_CUSTOMER_PRIORITY') return ['customer_creation_requires_review', 'fixture_only_signal'];
  if (proposalType === 'REVIEW_EVIDENCE_GAP') return ['insufficient_evidence', 'fixture_only_signal'];
  return ['fixture_only_signal', 'message_send_requires_review'];
}

function confidenceFor(
  finding: ReadOnlyAgentFinding,
  riskFlags: readonly SuggestOnlyAgentRiskFlag[],
): SuggestOnlyAgentConfidenceLevel {
  if (finding.evidence_refs.length === 0 || finding.uncertainty) return 'low';
  if (
    riskFlags.includes('sync_failed')
    || riskFlags.includes('grade_upgrade_requires_review')
    || riskFlags.includes('customer_creation_requires_review')
  ) {
    return 'medium';
  }
  return finding.evidence_refs.length > 1 ? 'high' : 'medium';
}

function titleFor(proposalType: SuggestOnlyAgentProposalType): string {
  return ({
    REVIEW_CUSTOMER_PRIORITY: 'Review customer priority signal',
    REVIEW_GRADE_CHANGE: 'Review grade-change signal',
    REVIEW_SYNC_FAILURE: 'Review sync failure evidence',
    REVIEW_FOLLOW_UP_TASK: 'Review follow-up task',
    REVIEW_EVIDENCE_GAP: 'Review evidence gap',
    REVIEW_STUCK_WORK_ITEM: 'Review stuck work item',
    REVIEW_NEXT_BEST_ACTION: 'Review next best action',
  })[proposalType];
}

function summaryFor(proposalType: SuggestOnlyAgentProposalType, finding: ReadOnlyAgentFinding): string {
  if (proposalType === 'REVIEW_EVIDENCE_GAP') {
    return `evidence review required: ${finding.uncertainty ?? finding.detail}`;
  }
  return `${titleFor(proposalType)} from read-only finding: ${finding.detail}`;
}

function actionLabelFor(proposalType: SuggestOnlyAgentProposalType): string {
  return ({
    REVIEW_CUSTOMER_PRIORITY: 'Review priority with human owner',
    REVIEW_GRADE_CHANGE: 'Review grade evidence with human owner',
    REVIEW_SYNC_FAILURE: 'Review sync failure details',
    REVIEW_FOLLOW_UP_TASK: 'Review follow-up timing',
    REVIEW_EVIDENCE_GAP: 'Review missing evidence',
    REVIEW_STUCK_WORK_ITEM: 'Review stale work item',
    REVIEW_NEXT_BEST_ACTION: 'Review next action suggestion',
  })[proposalType];
}
