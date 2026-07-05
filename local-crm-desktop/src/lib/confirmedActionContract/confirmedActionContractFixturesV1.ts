import type { SuggestOnlyAgentAnswer, SuggestOnlyAgentProposal } from '../suggestOnlyAgentReadiness';
import type { ConfirmedActionRequest } from '../confirmedActionContractReadiness';

export function buildConfirmedActionRequestFixtureV1(): ConfirmedActionRequest {
  return {
    kind: 'CONFIRMED_ACTION_REQUEST',
    version: 'v1',
    request_id: 'CONFIRM_EVAL_REQUEST_V1',
    synthetic: true,
    fixture_only: true,
    suggest_only_answer: buildSuggestOnlyAnswerFixture(),
  };
}

function buildSuggestOnlyAnswerFixture(): SuggestOnlyAgentAnswer {
  const proposals: SuggestOnlyAgentProposal[] = [
    proposal(1, 'REVIEW_CUSTOMER_PRIORITY', 'Priority review signal', 'SUGGEST_EVAL_PRIORITY_REVIEW', [
      ref('customer', 'READONLY_EVAL_CUSTOMER_ALPHA', 'READONLY_EVAL_CUSTOMER_ALPHA'),
    ], ['customer_creation_requires_review', 'fixture_only_signal'], 'high_intent_leads'),
    proposal(2, 'REVIEW_GRADE_CHANGE', 'Grade review signal', 'SUGGEST_EVAL_GRADE_REVIEW', [
      ref('collected_lead', 'READONLY_EVAL_COLLECTED_LEAD_ALPHA', 'READONLY_EVAL_COMPANY_ALPHA'),
      ref('import_row', 'READONLY_EVAL_IMPORT_ROW_ALPHA', 'READONLY_EVAL_COMPANY_ALPHA'),
    ], ['grade_upgrade_requires_review', 'fixture_only_signal'], 'high_intent_leads'),
    proposal(3, 'REVIEW_SYNC_FAILURE', 'Sync failure review signal', 'SUGGEST_EVAL_SYNC_FAILURE_REVIEW', [
      ref('lead_sync_log', 'READONLY_EVAL_SYNC_LOG_FAILED_ALPHA', 'READONLY_EVAL_SYNC_FAILURE_NEEDS_REVIEW'),
      ref('collected_lead', 'READONLY_EVAL_COLLECTED_LEAD_ALPHA', 'READONLY_EVAL_COMPANY_ALPHA'),
    ], ['sync_failed', 'fixture_only_signal', 'message_send_requires_review'], 'sync_failures'),
    proposal(4, 'REVIEW_FOLLOW_UP_TASK', 'Follow-up task review signal', 'SUGGEST_EVAL_FOLLOW_UP_TASK_REVIEW', [
      ref('task', 'READONLY_EVAL_TASK_TODAY_ALPHA', 'READONLY_EVAL_TASK_REVIEW_ALPHA'),
    ], ['fixture_only_signal', 'message_send_requires_review'], 'today_priorities'),
    proposal(5, 'REVIEW_EVIDENCE_GAP', 'Evidence gap review signal', 'SUGGEST_EVAL_EVIDENCE_GAP_REVIEW', [], [
      'insufficient_evidence',
      'fixture_only_signal',
    ], 'evidence_for_customer'),
    proposal(6, 'REVIEW_STUCK_WORK_ITEM', 'Stuck work-item review signal', 'SUGGEST_EVAL_STUCK_WORK_ITEM_REVIEW', [
      ref('lead_work_item', 'READONLY_EVAL_WORK_ITEM_SEARCHING', 'READONLY_EVAL_COMPANY_ALPHA'),
    ], ['stale_work_item', 'fixture_only_signal'], 'stuck_work_items'),
    proposal(7, 'REVIEW_NEXT_BEST_ACTION', 'Next-step review signal', 'SUGGEST_EVAL_NEXT_BEST_ACTION_REVIEW', [
      ref('eval_summary', 'READONLY_EVAL_EVAL_SUMMARY_ALPHA', 'READONLY_EVAL_EVAL_SUMMARY_ALPHA'),
      ref('prompt_plan', 'READONLY_EVAL_PROMPT_PLAN_ALPHA', 'READONLY_EVAL_PROMPT_PLAN_ALPHA'),
    ], ['fixture_only_signal', 'message_send_requires_review'], 'next_best_read_only_summary'),
  ];

  return {
    kind: 'SUGGEST_ONLY_AGENT_ANSWER',
    version: 'v1',
    suggest_only_summary: 'SUGGEST_EVAL_SUMMARY_CONTRACT_INPUT_ONLY',
    proposals,
    safety: {
      writes_database: false,
      no_side_effects: true,
      no_provider_calls: true,
      no_network: true,
      requires_confirmation_for_all_proposals: true,
      represents_true_agent: false,
      represents_confirmed_action_agent: false,
      represents_executed_action: false,
      forbidden_proposal_phrases: [],
    },
    represents_executed_action: false,
  };
}

function proposal(
  index: number,
  proposalType: SuggestOnlyAgentProposal['proposal_type'],
  title: string,
  summary: string,
  evidenceRefs: SuggestOnlyAgentProposal['evidence_refs'],
  riskFlags: SuggestOnlyAgentProposal['risk_flags'],
  sourceFindingIntent: string,
): SuggestOnlyAgentProposal {
  return {
    kind: 'SUGGEST_ONLY_AGENT_PROPOSAL',
    version: 'v1',
    proposal_id: `SUGGEST_EVAL_${String(index).padStart(3, '0')}`,
    proposal_type: proposalType,
    title,
    summary,
    recommended_action_label: `Review ${proposalType.toLowerCase().replaceAll('_', ' ')}`,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    confidence_level: proposalType === 'REVIEW_EVIDENCE_GAP' ? 'low' : 'medium',
    requires_confirmation: true,
    executable: false,
    persisted: false,
    represents_executed_action: false,
    forbidden_without_confirmation: true,
    source_finding_intent: sourceFindingIntent,
  };
}

function ref(
  type: SuggestOnlyAgentProposal['evidence_refs'][number]['type'],
  id: string,
  label: string,
): SuggestOnlyAgentProposal['evidence_refs'][number] {
  return {
    type,
    id,
    label,
    synthetic: true,
    persisted: false,
    represents_real_model_output: false,
  };
}
