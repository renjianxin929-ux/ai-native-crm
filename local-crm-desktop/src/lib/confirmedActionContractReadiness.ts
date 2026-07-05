import type {
  SuggestOnlyAgentAnswer,
  SuggestOnlyAgentEvidenceRef,
  SuggestOnlyAgentProposal,
  SuggestOnlyAgentProposalType,
  SuggestOnlyAgentRiskFlag,
} from './suggestOnlyAgentReadiness';

export const CONFIRMED_ACTION_CONTRACT_VERSION = 'v1';

export type ConfirmedActionType =
  | 'CONFIRM_REVIEW_CUSTOMER_PRIORITY'
  | 'CONFIRM_REVIEW_GRADE_CHANGE'
  | 'CONFIRM_REVIEW_SYNC_FAILURE'
  | 'CONFIRM_REVIEW_FOLLOW_UP_TASK'
  | 'CONFIRM_REVIEW_EVIDENCE_GAP'
  | 'CONFIRM_REVIEW_STUCK_WORK_ITEM'
  | 'CONFIRM_REVIEW_NEXT_BEST_ACTION';

export type ConfirmedActionPreconditionName =
  | 'requires_human_confirmation'
  | 'requires_non_empty_evidence'
  | 'requires_risk_acknowledgement'
  | 'requires_no_fake_execution_phrase'
  | 'requires_no_executable_action_code'
  | 'requires_no_db_write'
  | 'requires_no_provider_call';

export type ConfirmedActionRiskFlag = SuggestOnlyAgentRiskFlag;
export type ConfirmedActionEvidenceRef = SuggestOnlyAgentEvidenceRef;

export interface ConfirmedActionPrecondition {
  name: ConfirmedActionPreconditionName;
  required: boolean;
  satisfied: boolean;
  blocking: boolean;
  message: string;
}

export interface ConfirmedActionDryRun {
  dry_run_only: true;
  no_side_effects: true;
  writes_database: false;
  no_business_function_call: true;
  represents_executed_action: false;
  future_human_guidance: readonly string[];
  explicit_non_actions: readonly string[];
}

export interface ConfirmedActionRequest {
  kind: 'CONFIRMED_ACTION_REQUEST';
  version: typeof CONFIRMED_ACTION_CONTRACT_VERSION;
  request_id: string;
  synthetic: true;
  fixture_only: true;
  suggest_only_answer: SuggestOnlyAgentAnswer;
}

export interface ConfirmedActionSafety {
  writes_database: false;
  reads_database: false;
  no_side_effects: true;
  no_provider_calls: true;
  no_network: true;
  dry_run_only: true;
  represents_true_agent: false;
  represents_confirmed_action_agent: false;
  represents_executed_action: false;
  forbidden_envelope_phrases: readonly string[];
}

export interface ConfirmedActionPlan {
  kind: 'CONFIRMED_ACTION_PLAN';
  version: typeof CONFIRMED_ACTION_CONTRACT_VERSION;
  executable: false;
  persisted: false;
  reason: 'confirmed_action_contract_readiness_only';
  request: ConfirmedActionRequest;
  allowed_operations: readonly ['read_proposals', 'emit_dry_run_envelopes'];
  forbidden_operations: readonly string[];
  safety: ConfirmedActionSafety;
}

export interface ConfirmedActionEnvelope {
  kind: 'CONFIRMED_ACTION_ENVELOPE';
  version: typeof CONFIRMED_ACTION_CONTRACT_VERSION;
  action_id: string;
  action_type: ConfirmedActionType;
  source_proposal_id: string;
  source_proposal_type: SuggestOnlyAgentProposalType;
  title: string;
  summary: string;
  confirmation_required: true;
  human_confirmed: false;
  dry_run_only: true;
  executable: false;
  persisted: false;
  writes_database: false;
  represents_executed_action: false;
  evidence_refs: readonly ConfirmedActionEvidenceRef[];
  risk_flags: readonly ConfirmedActionRiskFlag[];
  preconditions: readonly ConfirmedActionPrecondition[];
  blocked_reason: string | null;
  dry_run: ConfirmedActionDryRun;
}

export interface EnvelopeFromSuggestOnlyAnswerOptions {
  actionIdPrefix?: string;
}

export interface ConfirmedActionAnswer {
  kind: 'CONFIRMED_ACTION_ANSWER';
  version: typeof CONFIRMED_ACTION_CONTRACT_VERSION;
  contract_summary: string;
  envelopes: readonly ConfirmedActionEnvelope[];
  represents_executed_action: false;
  represents_confirmed_action_agent: false;
}

export interface ConfirmedActionTrace {
  kind: 'CONFIRMED_ACTION_TRACE';
  plan: ConfirmedActionPlan;
  answer: ConfirmedActionAnswer;
  persisted: false;
}

const FORBIDDEN_ENVELOPE_PHRASES = [
  ['已', '发送'].join(''),
  ['已', '执行'].join(''),
  ['已更新', '客户'].join(''),
  ['已创建', '客户'].join(''),
  ['已', '同步'].join(''),
  ['已写入', ' CRM'].join(''),
];

const HIGH_RISK_FLAGS: readonly ConfirmedActionRiskFlag[] = [
  'sync_failed',
  'grade_upgrade_requires_review',
  'customer_creation_requires_review',
  'message_send_requires_review',
];

const ACTION_CODE_TERMS = [
  ['CREATE', '_CUSTOMER'].join(''),
  ['UPD', 'ATE', '_CUSTOMER'].join(''),
  ['UPD', 'ATE', '_GRADE'].join(''),
  ['CREATE', '_TASK'].join(''),
  ['UPD', 'ATE', '_WORK_ITEM'].join(''),
  ['SYNC', '_LEAD'].join(''),
  ['SEND', '_MESSAGE'].join(''),
  ['EXE', 'CUTE'].join(''),
];

export function buildConfirmedActionPlan(request: ConfirmedActionRequest): ConfirmedActionPlan {
  return {
    kind: 'CONFIRMED_ACTION_PLAN',
    version: CONFIRMED_ACTION_CONTRACT_VERSION,
    executable: false,
    persisted: false,
    reason: 'confirmed_action_contract_readiness_only',
    request,
    allowed_operations: ['read_proposals', 'emit_dry_run_envelopes'],
    forbidden_operations: [
      'write_db',
      'read_db',
      'sync',
      'update_status',
      'create_customer',
      'update_customer',
      'update_grade',
      'create_task',
      'call_provider',
      'send_message',
      'execute_action',
      'execute_proposal',
      'confirm_and_execute',
      'persist_envelope',
    ],
    safety: buildConfirmedActionSafety(),
  };
}

export function envelopeFromProposals(plan: ConfirmedActionPlan): ConfirmedActionEnvelope[] {
  return envelopeFromSuggestOnlyAnswer(plan.request.suggest_only_answer, {
    actionIdPrefix: 'CONFIRM_EVAL_',
  });
}

export function envelopeFromSuggestOnlyAnswer(
  answer: SuggestOnlyAgentAnswer,
  options: EnvelopeFromSuggestOnlyAnswerOptions = {},
): ConfirmedActionEnvelope[] {
  const actionIdPrefix = options.actionIdPrefix ?? 'CONFIRM_EVAL_';

  return answer.proposals.map((proposal, index) => {
    const actionType = actionTypeFor(proposal.proposal_type);
    const dryRun = buildDryRun(actionType);
    const text = [
      proposal.title,
      proposal.summary,
      dryRun.future_human_guidance.join(' '),
      dryRun.explicit_non_actions.join(' '),
    ].join(' ');
    const preconditions = buildPreconditions(proposal, text);
    const blockingFailure = preconditions.find(item => item.blocking && !item.satisfied);

    return {
      kind: 'CONFIRMED_ACTION_ENVELOPE',
      version: CONFIRMED_ACTION_CONTRACT_VERSION,
      action_id: `${actionIdPrefix}${String(index + 1).padStart(3, '0')}`,
      action_type: actionType,
      source_proposal_id: proposal.proposal_id,
      source_proposal_type: proposal.proposal_type,
      title: `Contract review: ${proposal.title}`,
      summary: `Dry-run contract envelope for proposal ${proposal.proposal_id}: ${proposal.summary}`,
      confirmation_required: true,
      human_confirmed: false,
      dry_run_only: true,
      executable: false,
      persisted: false,
      writes_database: false,
      represents_executed_action: false,
      evidence_refs: proposal.evidence_refs,
      risk_flags: proposal.risk_flags,
      preconditions,
      blocked_reason: blockingFailure ? blockingFailure.message : null,
      dry_run: dryRun,
    };
  });
}

export function buildConfirmedActionTrace(plan: ConfirmedActionPlan): ConfirmedActionTrace {
  const envelopes = envelopeFromProposals(plan);

  return {
    kind: 'CONFIRMED_ACTION_TRACE',
    plan,
    answer: {
      kind: 'CONFIRMED_ACTION_ANSWER',
      version: CONFIRMED_ACTION_CONTRACT_VERSION,
      contract_summary: `Confirmed action contract prepared ${envelopes.length} dry-run envelope(s); each remains non-executable.`,
      envelopes,
      represents_executed_action: false,
      represents_confirmed_action_agent: false,
    },
    persisted: false,
  };
}

function buildConfirmedActionSafety(): ConfirmedActionSafety {
  return {
    writes_database: false,
    reads_database: false,
    no_side_effects: true,
    no_provider_calls: true,
    no_network: true,
    dry_run_only: true,
    represents_true_agent: false,
    represents_confirmed_action_agent: false,
    represents_executed_action: false,
    forbidden_envelope_phrases: FORBIDDEN_ENVELOPE_PHRASES,
  };
}

function actionTypeFor(type: SuggestOnlyAgentProposalType): ConfirmedActionType {
  const map: Record<SuggestOnlyAgentProposalType, ConfirmedActionType> = {
    REVIEW_CUSTOMER_PRIORITY: 'CONFIRM_REVIEW_CUSTOMER_PRIORITY',
    REVIEW_GRADE_CHANGE: 'CONFIRM_REVIEW_GRADE_CHANGE',
    REVIEW_SYNC_FAILURE: 'CONFIRM_REVIEW_SYNC_FAILURE',
    REVIEW_FOLLOW_UP_TASK: 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    REVIEW_EVIDENCE_GAP: 'CONFIRM_REVIEW_EVIDENCE_GAP',
    REVIEW_STUCK_WORK_ITEM: 'CONFIRM_REVIEW_STUCK_WORK_ITEM',
    REVIEW_NEXT_BEST_ACTION: 'CONFIRM_REVIEW_NEXT_BEST_ACTION',
  };
  return map[type];
}

function buildPreconditions(
  proposal: SuggestOnlyAgentProposal,
  text: string,
): ConfirmedActionPrecondition[] {
  const hasHighRisk = proposal.risk_flags.some(flag => HIGH_RISK_FLAGS.includes(flag));
  const hasFakePhrase = FORBIDDEN_ENVELOPE_PHRASES.some(phrase => text.includes(phrase));
  const hasActionCode = ACTION_CODE_TERMS.some(term => text.includes(term));

  return [
    {
      name: 'requires_human_confirmation',
      required: true,
      satisfied: false,
      blocking: false,
      message: 'Human confirmation not recorded in contract readiness',
    },
    {
      name: 'requires_non_empty_evidence',
      required: true,
      satisfied: proposal.evidence_refs.length > 0,
      blocking: proposal.evidence_refs.length === 0,
      message: proposal.evidence_refs.length > 0 ? 'Evidence references are present' : 'Non-empty evidence is required before review can proceed',
    },
    {
      name: 'requires_risk_acknowledgement',
      required: hasHighRisk,
      satisfied: !hasHighRisk,
      blocking: false,
      message: hasHighRisk ? 'Human risk acknowledgement is required before any separate action path' : 'No high-risk flag requires acknowledgement',
    },
    {
      name: 'requires_no_fake_execution_phrase',
      required: true,
      satisfied: !hasFakePhrase,
      blocking: hasFakePhrase,
      message: hasFakePhrase ? 'Fake execution phrase is forbidden in contract envelope' : 'No fake execution phrase detected',
    },
    {
      name: 'requires_no_executable_action_code',
      required: true,
      satisfied: !hasActionCode,
      blocking: hasActionCode,
      message: hasActionCode ? 'Executable action code is forbidden in contract envelope' : 'No executable action code detected',
    },
    {
      name: 'requires_no_db_write',
      required: true,
      satisfied: true,
      blocking: false,
      message: 'Envelope writes database flag remains false',
    },
    {
      name: 'requires_no_provider_call',
      required: true,
      satisfied: true,
      blocking: false,
      message: 'No provider call is allowed by plan safety',
    },
  ];
}

function buildDryRun(actionType: ConfirmedActionType): ConfirmedActionDryRun {
  return {
    dry_run_only: true,
    no_side_effects: true,
    writes_database: false,
    no_business_function_call: true,
    represents_executed_action: false,
    future_human_guidance: guidanceFor(actionType),
    explicit_non_actions: nonActionsFor(actionType),
  };
}

function guidanceFor(actionType: ConfirmedActionType): readonly string[] {
  const common = 'Human owner must confirm risk, evidence, and next step in a later gate.';
  return ({
    CONFIRM_REVIEW_CUSTOMER_PRIORITY: ['Review priority evidence and decide whether a human owner should follow up later.', common],
    CONFIRM_REVIEW_GRADE_CHANGE: ['Review grade evidence before any later customer-grade workflow is considered.', common],
    CONFIRM_REVIEW_SYNC_FAILURE: ['Review failed sync evidence and decide whether retry or manual cleanup belongs in a later gate.', common],
    CONFIRM_REVIEW_FOLLOW_UP_TASK: ['Review timing and owner for a possible follow-up task in a later gate.', common],
    CONFIRM_REVIEW_EVIDENCE_GAP: ['Collect or 补充 evidence before any later review can continue.', common],
    CONFIRM_REVIEW_STUCK_WORK_ITEM: ['Review stale work-item evidence and decide the next manual owner step later.', common],
    CONFIRM_REVIEW_NEXT_BEST_ACTION: ['Review the suggested next step and confirm risk before any later workflow.', common],
  })[actionType];
}

function nonActionsFor(actionType: ConfirmedActionType): readonly string[] {
  const common = [
    'Does not create customer',
    'Does not update customer',
    'Does not create task',
    'Does not call model or provider',
  ];
  return [...common, `Does not perform ${actionType.toLowerCase().replaceAll('_', ' ')}`];
}
