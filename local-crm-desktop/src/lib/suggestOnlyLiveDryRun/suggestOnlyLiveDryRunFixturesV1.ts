import type {
  ReadOnlyAgentAnswer,
  ReadOnlyAgentEvidenceRef,
  ReadOnlyAgentFinding,
  ReadOnlyAgentIntent,
} from '../readOnlyAgentReadiness';
import type {
  ReadOnlyAgentSnapshotAdapterResult,
} from '../readOnlyAgentSnapshotAdapterReadiness';
import type {
  LoadedReadOnlyAgentSnapshot,
  LoadedSnapshotEvidenceRef,
} from '../readOnlySnapshotLoaderReadiness';
import type {
  ReadOnlyAgentLiveDryRunResult,
} from '../readOnlyAgentLiveDryRunReadiness';
import type {
  SuggestOnlyLiveDryRunRequest,
} from '../suggestOnlyLiveDryRunReadiness';

interface LiveDryRunOverride {
  answer?: {
    dry_run_blocked?: boolean;
    read_only_answer?: ReadOnlyAgentAnswer | null;
    generated_proposals?: boolean;
    generated_envelopes?: boolean;
    represents_executed_action?: boolean;
    source_is_loaded_snapshot?: boolean;
    safety?: {
      reads_database?: boolean;
      writes_database?: boolean;
    };
    adapter_result?: {
      adaptation_blocked?: boolean;
      pii_check?: {
        passed?: boolean;
      };
    };
  };
}

interface MutableLiveResult {
  kind: string;
  version: string;
  plan: {
    kind: string;
    version: string;
    executable: boolean;
    persisted: boolean;
    reason: string;
    request: {
      kind: string;
      version: string;
      request_id: string;
      intent: ReadOnlyAgentIntent;
      loaded_snapshot: LoadedReadOnlyAgentSnapshot;
      context: LoadedReadOnlyAgentSnapshot['context'];
      target_customer_id: string;
      target_work_item_id: string;
    };
    allowed_operations: readonly string[];
    forbidden_operations: readonly string[];
    safety: MutableLiveSafety;
  };
  answer: MutableLiveAnswer;
  persisted: boolean;
  represents_executed_action: boolean;
}

interface MutableLiveAnswer {
  kind: string;
  version: string;
  dry_run_only: boolean;
  source_snapshot_kind: string;
  source_snapshot_id: string;
  load_source: string;
  source_is_loaded_snapshot: boolean;
  adapter_result: ReadOnlyAgentSnapshotAdapterResult;
  read_only_answer: ReadOnlyAgentAnswer | null;
  dry_run_blocked: boolean;
  blocked_reason: string | null;
  invokes_read_only_agent: boolean;
  generated_findings: boolean;
  generated_proposals: boolean;
  generated_envelopes: boolean;
  finding_evidence_uses_agent_internal_refs: boolean;
  safety: MutableLiveSafety;
  represents_executed_action: boolean;
}

interface MutableLiveSafety {
  reads_database: boolean;
  writes_database: boolean;
  no_side_effects: boolean;
  no_provider_calls: boolean;
  no_network: boolean;
  executable: boolean;
  persisted: boolean;
  represents_executed_action: boolean;
  represents_live_agent_product: boolean;
  dry_run_only: boolean;
  generated_proposals: boolean;
  generated_envelopes: boolean;
  invokes_read_only_agent: boolean;
}

export function buildSuggestOnlyLiveDryRunRequestFixtureV1(
  override: LiveDryRunOverride = {},
): SuggestOnlyLiveDryRunRequest {
  return {
    kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_REQUEST',
    version: 'v1',
    request_id: 'SUGGEST_LIVE_TEST_REQUEST_A',
    source_live_dry_run_result: buildCallerProvidedLiveDryRunResult(override),
  };
}

export function buildCallerProvidedLiveDryRunResult(
  override: LiveDryRunOverride = {},
): ReadOnlyAgentLiveDryRunResult {
  const result = baseMutableLiveResult();
  applyOverride(result, override);
  return result as unknown as ReadOnlyAgentLiveDryRunResult;
}

function baseMutableLiveResult(): MutableLiveResult {
  const loadedSnapshot = loadedSnapshotFixture();
  const safety = liveSafety(true);
  const adapterResult = adapterResultFixture(loadedSnapshot);
  const readOnlyAnswer = readOnlyAnswerFixture();

  return {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT',
    version: 'v1',
    plan: {
      kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'read_only_agent_live_dry_run_readiness_only',
      request: {
        kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_REQUEST',
        version: 'v1',
        request_id: 'LIVE_DRY_RUN_TEST_CALLER_SOURCE_A',
        intent: 'evidence_for_customer',
        loaded_snapshot: loadedSnapshot,
        context: loadedSnapshot.context,
        target_customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
        target_work_item_id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
      },
      allowed_operations: ['adapt_loaded_snapshot', 'bridge_collections', 'emit_dry_run_answer'],
      forbidden_operations: [
        'read_db',
        'write_db',
        'load_snapshot',
        'generate_proposals',
        'emit_envelopes',
        'call_provider',
        'execute_action',
        'persist_answer',
      ],
      safety: liveSafety(false),
    },
    answer: {
      kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_ANSWER',
      version: 'v1',
      dry_run_only: true,
      source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
      source_snapshot_id: 'SUGGEST_LIVE_TEST_SNAPSHOT_A',
      load_source: 'sqlite_read_only',
      source_is_loaded_snapshot: true,
      adapter_result: adapterResult,
      read_only_answer: readOnlyAnswer,
      dry_run_blocked: false,
      blocked_reason: null,
      invokes_read_only_agent: true,
      generated_findings: true,
      generated_proposals: false,
      generated_envelopes: false,
      finding_evidence_uses_agent_internal_refs: true,
      safety,
      represents_executed_action: false,
    },
    persisted: false,
    represents_executed_action: false,
  };
}

function applyOverride(result: MutableLiveResult, override: LiveDryRunOverride): void {
  const answer = override.answer;
  if (!answer) return;

  if (answer.dry_run_blocked !== undefined) result.answer.dry_run_blocked = answer.dry_run_blocked;
  if (answer.read_only_answer !== undefined) result.answer.read_only_answer = answer.read_only_answer;
  if (answer.generated_proposals !== undefined) result.answer.generated_proposals = answer.generated_proposals;
  if (answer.generated_envelopes !== undefined) result.answer.generated_envelopes = answer.generated_envelopes;
  if (answer.represents_executed_action !== undefined) {
    result.answer.represents_executed_action = answer.represents_executed_action;
  }
  if (answer.source_is_loaded_snapshot !== undefined) {
    result.answer.source_is_loaded_snapshot = answer.source_is_loaded_snapshot;
  }
  if (answer.safety?.reads_database !== undefined) {
    result.answer.safety.reads_database = answer.safety.reads_database;
  }
  if (answer.safety?.writes_database !== undefined) {
    result.answer.safety.writes_database = answer.safety.writes_database;
  }
  if (answer.adapter_result?.adaptation_blocked !== undefined) {
    result.answer.adapter_result = {
      ...result.answer.adapter_result,
      adaptation_blocked: answer.adapter_result.adaptation_blocked,
      blocked_reason: answer.adapter_result.adaptation_blocked ? 'SUGGEST_LIVE_TEST_ADAPTER_BLOCKED' : null,
    };
  }
  if (answer.adapter_result?.pii_check?.passed !== undefined) {
    result.answer.adapter_result = {
      ...result.answer.adapter_result,
      pii_check: {
        ...result.answer.adapter_result.pii_check,
        passed: answer.adapter_result.pii_check.passed,
      },
    };
  }
}

function readOnlyAnswerFixture(): ReadOnlyAgentAnswer {
  return {
    kind: 'READ_ONLY_AGENT_ANSWER',
    version: 'v1',
    intent: 'evidence_for_customer',
    read_only_summary: 'Suggest live test read-only summary; review evidence before any action.',
    findings: [
      finding('evidence_for_customer', 'Snapshot evidence found for requested target', 'SUGGEST_LIVE_TEST_REVIEW_DETAIL', [
        ref('customer', 'SUGGEST_LIVE_TEST_CUSTOMER_A', 'SUGGEST_LIVE_TEST_CUSTOMER_A'),
        ref('lead_work_item', 'SUGGEST_LIVE_TEST_WORK_ITEM_A', 'SUGGEST_LIVE_TEST_COMPANY_A'),
      ]),
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
}

function adapterResultFixture(
  loadedSnapshot: LoadedReadOnlyAgentSnapshot,
): ReadOnlyAgentSnapshotAdapterResult {
  return {
    kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_RESULT',
    version: 'v1',
    plan: {
      kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'read_only_agent_snapshot_adapter_readiness_only',
      request: {
        kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_REQUEST',
        version: 'v1',
        request_id: 'SUGGEST_LIVE_TEST_ADAPTER_REQUEST_A',
        intent: 'evidence_for_customer',
        loaded_snapshot: loadedSnapshot,
        context: loadedSnapshot.context,
        target_customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
        target_work_item_id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
      },
      allowed_operations: ['validate_loaded_snapshot', 'map_snapshot_candidate', 'build_request_candidate'],
      forbidden_operations: [
        'read_db',
        'write_db',
        'load_snapshot',
        'invoke_read_only_agent',
        'generate_findings',
        'generate_proposals',
        'emit_envelopes',
        'call_provider',
        'execute_action',
      ],
      safety: {
        reads_database: false,
        writes_database: false,
        no_side_effects: true,
        no_provider_calls: true,
        no_network: true,
        executable: false,
        persisted: false,
        represents_executed_action: false,
        invokes_read_only_agent: false,
        pii_recheck_required: true,
      },
    },
    safety: {
      reads_database: false,
      writes_database: false,
      no_side_effects: true,
      no_provider_calls: true,
      no_network: true,
      executable: false,
      persisted: false,
      represents_executed_action: false,
      invokes_read_only_agent: false,
      pii_recheck_required: true,
    },
    snapshot_candidate: {
      kind: 'ADAPTED_READ_ONLY_AGENT_SNAPSHOT_CANDIDATE',
      version: 'v1',
      snapshot_id: 'SUGGEST_LIVE_TEST_ADAPTER_CANDIDATE_A',
      source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
      source_snapshot_id: 'SUGGEST_LIVE_TEST_SNAPSHOT_A',
      load_source: 'sqlite_read_only',
      synthetic: false,
      persisted: true,
      adapted_at: '2026-07-05T09:00:00.000Z',
      context: loadedSnapshot.context,
      work_items: [{
        id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
        customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
        collected_lead_id: 'SUGGEST_LIVE_TEST_COLLECTED_LEAD_A',
        company_name: 'SUGGEST_LIVE_TEST_COMPANY_A',
        status: 'SEARCHING',
        priority: 90,
        updated_at: '2026-06-28T00:00:00.000Z',
        due_at: null,
        lookup_goal: 'FIND_WEBSITE',
      }],
      collected_leads: [{
        id: 'SUGGEST_LIVE_TEST_COLLECTED_LEAD_A',
        work_item_id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
        customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
        company_name: 'SUGGEST_LIVE_TEST_COMPANY_A',
        intent_level: 'UNKNOWN',
        lead_grade: 'UNKNOWN',
        sync_status: 'PENDING',
      }],
      replay_evidence: [],
      import_rows: [],
      customers: [{
        id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
        name: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
        customer_grade: 'A',
        intent_level: 'HIGH',
      }],
      tasks: [],
      capture_events: [],
      prompt_plans: [],
      model_invocations: [],
      eval_summaries: [],
      evidence_refs: [
        {
          type: 'customer',
          id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
          label: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
          synthetic: false,
          persisted: true,
          represents_real_model_output: false,
        },
      ],
    },
    request_candidate: {
      kind: 'READ_ONLY_AGENT_REQUEST_CANDIDATE',
      version: 'v1',
      intent: 'evidence_for_customer',
      snapshot: {
        kind: 'ADAPTED_READ_ONLY_AGENT_SNAPSHOT_CANDIDATE',
        version: 'v1',
        snapshot_id: 'SUGGEST_LIVE_TEST_ADAPTER_CANDIDATE_A',
        source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
        source_snapshot_id: 'SUGGEST_LIVE_TEST_SNAPSHOT_A',
        load_source: 'sqlite_read_only',
        synthetic: false,
        persisted: true,
        adapted_at: '2026-07-05T09:00:00.000Z',
        context: loadedSnapshot.context,
        work_items: [],
        collected_leads: [],
        replay_evidence: [],
        import_rows: [],
        customers: [],
        tasks: [],
        capture_events: [],
        prompt_plans: [],
        model_invocations: [],
        eval_summaries: [],
        evidence_refs: [],
      },
      context: loadedSnapshot.context,
      target_customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
      target_work_item_id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
      source_is_loaded_snapshot: true,
    },
    pii_check: {
      passed: true,
      violations: [],
    },
    validation_warnings: [],
    adaptation_blocked: false,
    blocked_reason: null,
    represents_executed_action: false,
  };
}

function loadedSnapshotFixture(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'SUGGEST_LIVE_TEST_SNAPSHOT_A',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: '2026-07-05T09:00:00.000Z',
    context: {
      active_profile_id: 'SUGGEST_LIVE_TEST_PROFILE',
      now: '2026-07-05T09:00:00.000Z',
    },
    work_items: [{
      id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
      customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
      company_name: 'SUGGEST_LIVE_TEST_COMPANY_A',
      status: 'SEARCHING',
      priority: 90,
      updated_at: '2026-06-28T00:00:00.000Z',
      lookup_goal: 'FIND_WEBSITE',
      evidence_ref: loadedRef('lead_work_item', 'SUGGEST_LIVE_TEST_WORK_ITEM_A', 'SUGGEST_LIVE_TEST_COMPANY_A'),
    }],
    collected_leads: [{
      id: 'SUGGEST_LIVE_TEST_COLLECTED_LEAD_A',
      work_item_id: 'SUGGEST_LIVE_TEST_WORK_ITEM_A',
      customer_id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
      company_name: 'SUGGEST_LIVE_TEST_COMPANY_A',
      sync_status: 'PENDING',
      evidence_ref: loadedRef('collected_lead', 'SUGGEST_LIVE_TEST_COLLECTED_LEAD_A', 'SUGGEST_LIVE_TEST_COMPANY_A'),
    }],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    customers: [{
      id: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
      name: 'SUGGEST_LIVE_TEST_CUSTOMER_A',
      customer_grade: 'A',
      intent_level: 'HIGH',
      evidence_ref: loadedRef('customer', 'SUGGEST_LIVE_TEST_CUSTOMER_A', 'SUGGEST_LIVE_TEST_CUSTOMER_A'),
    }],
    tasks: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
}

function liveSafety(invokesReadOnlyAgent: boolean): MutableLiveSafety {
  return {
    reads_database: false,
    writes_database: false,
    no_side_effects: true,
    no_provider_calls: true,
    no_network: true,
    executable: false,
    persisted: false,
    represents_executed_action: false,
    represents_live_agent_product: false,
    dry_run_only: true,
    generated_proposals: false,
    generated_envelopes: false,
    invokes_read_only_agent: invokesReadOnlyAgent,
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

function loadedRef(
  type: LoadedSnapshotEvidenceRef['type'],
  id: string,
  label: string,
): LoadedSnapshotEvidenceRef {
  return {
    type,
    id,
    label,
    synthetic: false,
    persisted: true,
  };
}
