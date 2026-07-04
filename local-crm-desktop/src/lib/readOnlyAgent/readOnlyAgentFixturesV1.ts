import type { ReadOnlyAgentSnapshot } from '../readOnlyAgentReadiness';

export function buildReadOnlyAgentSnapshotFixtureV1(): ReadOnlyAgentSnapshot {
  return {
    kind: 'READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'READONLY_EVAL_SNAPSHOT_V1',
    synthetic: true,
    persisted: false,
    work_items: [
      {
        id: 'READONLY_EVAL_WORK_ITEM_TODO',
        customer_id: 'READONLY_EVAL_CUSTOMER_BETA',
        collected_lead_id: null,
        company_name: 'READONLY_EVAL_COMPANY_BETA',
        status: 'TODO',
        priority: 2,
        updated_at: '2026-07-03T00:00:00.000Z',
        due_at: '2026-07-04T00:00:00.000Z',
        lookup_goal: 'READONLY_EVAL_FIND_CONTACT',
      },
      {
        id: 'READONLY_EVAL_WORK_ITEM_SEARCHING',
        customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        collected_lead_id: 'READONLY_EVAL_COLLECTED_LEAD_ALPHA',
        company_name: 'READONLY_EVAL_COMPANY_ALPHA',
        status: 'SEARCHING',
        priority: 1,
        updated_at: '2026-06-28T00:00:00.000Z',
        due_at: '2026-07-01T00:00:00.000Z',
        lookup_goal: 'READONLY_EVAL_VERIFY_INTEREST',
      },
      {
        id: 'READONLY_EVAL_WORK_ITEM_STAGED',
        customer_id: 'READONLY_EVAL_CUSTOMER_GAMMA',
        collected_lead_id: 'READONLY_EVAL_COLLECTED_LEAD_GAMMA',
        company_name: 'READONLY_EVAL_COMPANY_GAMMA',
        status: 'STAGED',
        priority: 3,
        updated_at: '2026-06-29T00:00:00.000Z',
        due_at: null,
        lookup_goal: 'READONLY_EVAL_REVIEW_DRAFT',
      },
    ],
    collected_leads: [
      {
        id: 'READONLY_EVAL_COLLECTED_LEAD_ALPHA',
        work_item_id: 'READONLY_EVAL_WORK_ITEM_SEARCHING',
        customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        company_name: 'READONLY_EVAL_COMPANY_ALPHA',
        intent_level: 'HIGH',
        lead_grade: 'A',
        sync_status: 'FAILED',
      },
      {
        id: 'READONLY_EVAL_COLLECTED_LEAD_GAMMA',
        work_item_id: 'READONLY_EVAL_WORK_ITEM_STAGED',
        customer_id: 'READONLY_EVAL_CUSTOMER_GAMMA',
        company_name: 'READONLY_EVAL_COMPANY_GAMMA',
        intent_level: 'MEDIUM',
        lead_grade: 'B',
        sync_status: 'PENDING',
      },
    ],
    replay_evidence: [
      {
        id: 'READONLY_EVAL_SYNC_LOG_FAILED_ALPHA',
        work_item_id: 'READONLY_EVAL_WORK_ITEM_SEARCHING',
        collected_lead_id: 'READONLY_EVAL_COLLECTED_LEAD_ALPHA',
        customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        status: 'FAILED',
        message: 'READONLY_EVAL_SYNC_FAILURE_NEEDS_REVIEW',
        created_at: '2026-07-03T08:00:00.000Z',
      },
      {
        id: 'READONLY_EVAL_SYNC_LOG_OK_GAMMA',
        work_item_id: 'READONLY_EVAL_WORK_ITEM_STAGED',
        collected_lead_id: 'READONLY_EVAL_COLLECTED_LEAD_GAMMA',
        customer_id: 'READONLY_EVAL_CUSTOMER_GAMMA',
        status: 'OK',
        message: 'READONLY_EVAL_SYNC_OK_REFERENCE',
        created_at: '2026-07-03T09:00:00.000Z',
      },
    ],
    import_rows: [
      {
        id: 'READONLY_EVAL_IMPORT_ROW_ALPHA',
        customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        company_name: 'READONLY_EVAL_COMPANY_ALPHA',
        decision: 'CRM_WITH_LOOKUP',
        decision_status: 'DONE',
        intent_level: 'HIGH',
        lead_grade: 'A',
      },
      {
        id: 'READONLY_EVAL_IMPORT_ROW_BETA',
        customer_id: 'READONLY_EVAL_CUSTOMER_BETA',
        company_name: 'READONLY_EVAL_COMPANY_BETA',
        decision: 'LOOKUP_FIRST',
        decision_status: 'PENDING',
        intent_level: 'LOW',
        lead_grade: 'C',
      },
    ],
    customers: [
      {
        id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        name: 'READONLY_EVAL_CUSTOMER_ALPHA',
        customer_grade: 'A',
        intent_level: 'HIGH',
      },
      {
        id: 'READONLY_EVAL_CUSTOMER_BETA',
        name: 'READONLY_EVAL_CUSTOMER_BETA',
        customer_grade: 'C',
        intent_level: 'LOW',
      },
      {
        id: 'READONLY_EVAL_CUSTOMER_GAMMA',
        name: 'READONLY_EVAL_CUSTOMER_GAMMA',
        customer_grade: 'B',
        intent_level: 'MEDIUM',
      },
    ],
    tasks: [
      {
        id: 'READONLY_EVAL_TASK_TODAY_ALPHA',
        customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        title: 'READONLY_EVAL_TASK_REVIEW_ALPHA',
        status: 'TODO',
        priority: 1,
        due_at: '2026-07-04T12:00:00.000Z',
      },
    ],
    capture_events: [
      {
        id: 'READONLY_EVAL_CAPTURE_EVENT_ALPHA',
        work_item_id: 'READONLY_EVAL_WORK_ITEM_SEARCHING',
        customer_id: 'READONLY_EVAL_CUSTOMER_ALPHA',
        summary: 'READONLY_EVAL_CAPTURE_SUMMARY_ALPHA',
      },
    ],
    prompt_plans: [
      {
        id: 'READONLY_EVAL_PROMPT_PLAN_ALPHA',
        purpose: 'READONLY_EVAL_READ_ATTACHED_PLAN',
        executable: false,
      },
    ],
    model_invocations: [
      {
        id: 'READONLY_EVAL_MODEL_INVOCATION_ALPHA',
        fixture_only: true,
        represents_real_model_output: false,
      },
    ],
    eval_summaries: [
      {
        id: 'READONLY_EVAL_EVAL_SUMMARY_ALPHA',
        synthetic: true,
        represents_real_model_output: false,
      },
    ],
  };
}
