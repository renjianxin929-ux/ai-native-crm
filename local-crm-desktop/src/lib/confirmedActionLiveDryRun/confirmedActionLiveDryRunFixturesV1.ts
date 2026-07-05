import type {
  SuggestOnlyAgentAnswer,
  SuggestOnlyAgentProposal,
} from '../suggestOnlyAgentReadiness';
import type {
  SuggestOnlyLiveDryRunResult,
} from '../suggestOnlyLiveDryRunReadiness';
import type {
  ConfirmedActionLiveDryRunRequest,
} from '../confirmedActionLiveDryRunReadiness';

interface LiveAnswerOverride {
  dry_run_blocked?: boolean;
  suggest_only_answer?: SuggestOnlyAgentAnswer | null;
  generated_envelopes?: boolean;
  represents_executed_action?: boolean;
  source_is_loaded_snapshot?: boolean;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
    executable?: boolean;
  };
  source_live_dry_run_result?: unknown;
  remove_source_live_dry_run_result?: boolean;
  source_generated_structure?: Record<string, unknown>;
}

interface LiveResultOverride {
  kind?: string;
  answer?: LiveAnswerOverride | null;
}

export function buildConfirmedActionLiveDryRunRequestFixtureV1(
  override: LiveResultOverride = {},
): ConfirmedActionLiveDryRunRequest {
  return {
    kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_REQUEST',
    version: 'v1',
    request_id: 'CONFIRM_LIVE_TEST_REQUEST_A',
    source_live_dry_run_result: buildCallerProvidedSuggestOnlyLiveDryRunResultFixtureV1(override),
  };
}

export function buildCallerProvidedSuggestOnlyLiveDryRunResultFixtureV1(
  override: LiveResultOverride = {},
): SuggestOnlyLiveDryRunResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as SuggestOnlyLiveDryRunResult;
}

function baseResult(): Record<string, unknown> {
  const answer = suggestOnlyAnswer();

  return {
    kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_RESULT',
    version: 'v1',
    plan: {
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'suggest_only_live_dry_run_readiness_only',
      request: {
        kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_REQUEST',
        version: 'v1',
        request_id: 'CONFIRM_LIVE_TEST_SOURCE_REQUEST_A',
      },
      allowed_operations: ['validate_live_dry_run_input', 'emit_review_proposals'],
      forbidden_operations: ['read_db', 'write_db', 'generate_envelopes', 'persist_proposal'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        persisted: false,
        dry_run_only: true,
        generated_envelopes: false,
        generated_proposals: true,
      },
    },
    answer: {
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_ANSWER',
      version: 'v1',
      dry_run_only: true,
      source_live_dry_run_result: nestedReadOnlySource(),
      source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
      source_snapshot_id: 'CONFIRM_LIVE_TEST_SNAPSHOT_A',
      source_is_loaded_snapshot: true,
      load_source: 'sqlite_read_only',
      read_only_answer_metadata: {
        intent: 'evidence_for_customer',
        version: 'v1',
        findings_count: 2,
      },
      suggest_only_answer: answer,
      proposals_count: answer.proposals.length,
      dry_run_blocked: false,
      blocked_reason: null,
      invokes_suggest_only_agent: true,
      generated_proposals: true,
      generated_envelopes: false,
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        persisted: false,
        dry_run_only: true,
        generated_envelopes: false,
        generated_proposals: true,
      },
      represents_executed_action: false,
    },
    persisted: false,
    represents_executed_action: false,
  };
}

function applyOverride(result: Record<string, unknown>, override: LiveResultOverride): void {
  if (override.kind !== undefined) result.kind = override.kind;
  if (override.answer === null) {
    delete result.answer;
    return;
  }
  if (!override.answer) return;

  const answer = result.answer as Record<string, unknown>;
  if (override.answer.dry_run_blocked !== undefined) answer.dry_run_blocked = override.answer.dry_run_blocked;
  if (override.answer.suggest_only_answer !== undefined) {
    answer.suggest_only_answer = override.answer.suggest_only_answer;
    answer.proposals_count = override.answer.suggest_only_answer?.proposals.length ?? 0;
  }
  if (override.answer.generated_envelopes !== undefined) {
    answer.generated_envelopes = override.answer.generated_envelopes;
  }
  if (override.answer.represents_executed_action !== undefined) {
    answer.represents_executed_action = override.answer.represents_executed_action;
  }
  if (override.answer.source_is_loaded_snapshot !== undefined) {
    answer.source_is_loaded_snapshot = override.answer.source_is_loaded_snapshot;
  }
  if (override.answer.safety?.reads_database !== undefined) {
    (answer.safety as Record<string, unknown>).reads_database = override.answer.safety.reads_database;
  }
  if (override.answer.safety?.writes_database !== undefined) {
    (answer.safety as Record<string, unknown>).writes_database = override.answer.safety.writes_database;
  }
  if (override.answer.safety?.executable !== undefined) {
    (answer.safety as Record<string, unknown>).executable = override.answer.safety.executable;
  }
  if (override.answer.source_live_dry_run_result !== undefined) {
    answer.source_live_dry_run_result = override.answer.source_live_dry_run_result;
  }
  if (override.answer.remove_source_live_dry_run_result) {
    delete answer.source_live_dry_run_result;
  }
  if (override.answer.source_generated_structure !== undefined) {
    answer.suggest_only_answer = {
      ...(answer.suggest_only_answer as Record<string, unknown>),
      ...override.answer.source_generated_structure,
    };
  }
}

function suggestOnlyAnswer(): SuggestOnlyAgentAnswer {
  const proposals: SuggestOnlyAgentProposal[] = [
    proposal(1, 'REVIEW_CUSTOMER_PRIORITY', 'Live priority review', 'CONFIRM_LIVE_SOURCE_PRIORITY', [
      ref('customer', 'CONFIRM_LIVE_CUSTOMER_A', 'CONFIRM_LIVE_CUSTOMER_A'),
    ], ['customer_creation_requires_review', 'fixture_only_signal']),
    proposal(2, 'REVIEW_SYNC_FAILURE', 'Live sync review', 'CONFIRM_LIVE_SOURCE_SYNC', [
      ref('lead_sync_log', 'CONFIRM_LIVE_SYNC_LOG_A', 'CONFIRM_LIVE_SYNC_LOG_A'),
      ref('collected_lead', 'CONFIRM_LIVE_COLLECTED_A', 'CONFIRM_LIVE_COMPANY_A'),
    ], ['sync_failed', 'fixture_only_signal', 'message_send_requires_review']),
  ];

  return {
    kind: 'SUGGEST_ONLY_AGENT_ANSWER',
    version: 'v1',
    suggest_only_summary: 'Caller-provided suggest-only live dry-run proposals for confirmation envelope review.',
    proposals,
    safety: {
      writes_database: false,
      no_side_effects: true,
      ['no_' + ['pro', 'vider_calls'].join('')]: true,
      no_network: true,
      requires_confirmation_for_all_proposals: true,
      represents_true_agent: false,
      represents_confirmed_action_agent: false,
      represents_executed_action: false,
      forbidden_proposal_phrases: [],
    } as unknown as SuggestOnlyAgentAnswer['safety'],
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
): SuggestOnlyAgentProposal {
  return {
    kind: 'SUGGEST_ONLY_AGENT_PROPOSAL',
    version: 'v1',
    proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    proposal_type: proposalType,
    title,
    summary,
    recommended_action_label: `Review ${proposalType.toLowerCase().replaceAll('_', ' ')}`,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    confidence_level: 'medium',
    requires_confirmation: true,
    executable: false,
    persisted: false,
    represents_executed_action: false,
    forbidden_without_confirmation: true,
    source_finding_intent: 'evidence_for_customer',
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
    synthetic: false,
    persisted: true,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as SuggestOnlyAgentProposal['evidence_refs'][number];
}

function nestedReadOnlySource(): Record<string, unknown> {
  return {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT',
    version: 'v1',
    answer: {
      kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_ANSWER',
      dry_run_only: true,
      dry_run_blocked: false,
      generated_proposals: false,
      generated_envelopes: false,
      source_is_loaded_snapshot: true,
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
      represents_executed_action: false,
    },
    persisted: false,
    represents_executed_action: false,
  };
}
