import type {
  ReadOnlyAgentAnswer,
  ReadOnlyAgentEvidenceRef,
  ReadOnlyAgentFinding,
  ReadOnlyAgentIntent,
} from '../readOnlyAgentReadiness';
import type { SuggestOnlyAgentRequest } from '../suggestOnlyAgentReadiness';
import { buildReadOnlyAgentSnapshotFixtureV1 } from '../readOnlyAgent/readOnlyAgentFixturesV1';

export function buildSuggestOnlyAgentRequestFixtureV1(): SuggestOnlyAgentRequest {
  const snapshot = buildReadOnlyAgentSnapshotFixtureV1();
  const readOnlyAnswer: ReadOnlyAgentAnswer = {
    kind: 'READ_ONLY_AGENT_ANSWER',
    version: 'v1',
    intent: 'next_best_read_only_summary',
    read_only_summary: 'READONLY_EVAL_SUMMARY_REVIEW_ONLY',
    findings: [
      finding('high_intent_leads', 'High intent customer priority signal', 'SUGGEST_EVAL_PRIORITY_REVIEW', [
        ref('customer', 'READONLY_EVAL_CUSTOMER_ALPHA', 'READONLY_EVAL_CUSTOMER_ALPHA'),
      ]),
      finding('high_intent_leads', 'Grade review signal', 'SUGGEST_EVAL_GRADE_REVIEW', [
        ref('collected_lead', 'READONLY_EVAL_COLLECTED_LEAD_ALPHA', 'READONLY_EVAL_COMPANY_ALPHA'),
        ref('import_row', 'READONLY_EVAL_IMPORT_ROW_ALPHA', 'READONLY_EVAL_COMPANY_ALPHA'),
      ]),
      finding('sync_failures', 'Failed replay evidence in snapshot', 'SUGGEST_EVAL_SYNC_FAILURE_REVIEW', [
        ref('lead_sync_log', 'READONLY_EVAL_SYNC_LOG_FAILED_ALPHA', 'READONLY_EVAL_SYNC_FAILURE_NEEDS_REVIEW'),
        ref('collected_lead', 'READONLY_EVAL_COLLECTED_LEAD_ALPHA', 'READONLY_EVAL_COMPANY_ALPHA'),
      ]),
      finding('today_priorities', 'Open task needs review', 'SUGGEST_EVAL_FOLLOW_UP_TASK_REVIEW', [
        ref('task', 'READONLY_EVAL_TASK_TODAY_ALPHA', 'READONLY_EVAL_TASK_REVIEW_ALPHA'),
      ]),
      finding('stuck_work_items', 'Stale work item in snapshot', 'SUGGEST_EVAL_STUCK_WORK_ITEM_REVIEW', [
        ref('lead_work_item', 'READONLY_EVAL_WORK_ITEM_SEARCHING', 'READONLY_EVAL_COMPANY_ALPHA'),
      ]),
      finding('next_best_read_only_summary', 'Read-only summary signal', 'SUGGEST_EVAL_NEXT_BEST_ACTION_REVIEW', [
        ref('eval_summary', 'READONLY_EVAL_EVAL_SUMMARY_ALPHA', 'READONLY_EVAL_EVAL_SUMMARY_ALPHA'),
        ref('prompt_plan', 'READONLY_EVAL_PROMPT_PLAN_ALPHA', 'READONLY_EVAL_PROMPT_PLAN_ALPHA'),
      ]),
      {
        kind: 'READ_ONLY_AGENT_FINDING',
        intent: 'evidence_for_customer',
        severity: 'info',
        title: 'Insufficient snapshot evidence',
        detail: 'SUGGEST_EVAL_EVIDENCE_GAP_REVIEW',
        evidence_refs: [],
        uncertainty: 'SUGGEST_EVAL_NO_MATCHING_EVIDENCE',
        represents_executed_action: false,
      },
    ],
    safety: {
      writes_database: false,
      no_side_effects: true,
      no_provider_calls: true,
      no_network: true,
      requires_human_review_for_actions: true,
      represents_true_agent: false,
      represents_executed_action: false,
      forbidden_answer_phrases: [],
    },
    represents_executed_action: false,
  };

  return {
    kind: 'SUGGEST_ONLY_AGENT_REQUEST',
    version: 'v1',
    request_id: 'SUGGEST_EVAL_REQUEST_V1',
    synthetic: true,
    fixture_only: true,
    read_only_answer: readOnlyAnswer,
    snapshot,
    attached_metadata: {
      active_profile_id: 'EVAL_PROFILE_GENERIC_SALES',
      source_gate: 'read_only_agent_v1',
      note: 'SUGGEST_EVAL_FIXTURE_ONLY',
    },
  };
}

function finding(
  intent: ReadOnlyAgentIntent,
  title: string,
  detail: string,
  evidenceRefs: readonly ReadOnlyAgentEvidenceRef[],
): ReadOnlyAgentFinding {
  return {
    kind: 'READ_ONLY_AGENT_FINDING',
    intent,
    severity: 'warning',
    title,
    detail,
    evidence_refs: evidenceRefs,
    represents_executed_action: false,
  };
}

function ref(type: ReadOnlyAgentEvidenceRef['type'], id: string, label: string): ReadOnlyAgentEvidenceRef {
  return {
    type,
    id,
    label,
    synthetic: true,
    persisted: false,
    represents_real_model_output: false,
  };
}
