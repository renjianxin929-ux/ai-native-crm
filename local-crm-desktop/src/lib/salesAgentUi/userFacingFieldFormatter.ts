/**
 * One user-facing formatter for proposal fields and stored enum values.
 * Do not expose raw internal labels by default.
 */

import { SALES_AGENT_APP_CLOCK } from '../salesAgentTools/appClock';
import type { AgentWriteProposal } from '../salesAgentTools/confirmedWrite';
import { getAppLocale, t, tEnum, tField } from '../i18n/appLocale';

const HIDDEN_INTERNAL_KEYS = new Set([
  'capability_id',
  'executor_ref',
  'reason_code',
  'db',
  'snapshot',
  'context',
  'clock',
  'nonce',
  'proposal_id',
  'customer_id',
  'entity_id',
  'tool_id',
  'clarification_answer',
  'missing_fields',
  'parsed_arguments',
]);

const PRODUCT_DEFAULT_VALUES: Readonly<Record<string, unknown>> = {
  is_key_decision_maker: 0,
  wechat_add_status: 'NOT_ADDED',
  intent_level: 'UNKNOWN',
};

const INTERNAL_SCHEMA_NAME_PATTERN =
  /\b(?:title|feedback_notes|visit_notes|customer_concerns|next_follow_up_at|next_follow_up_time|due_at|missing_fields|capability_id|clarification_answer|parsed_arguments|industry|region|contact_person|name)\b/;

const CAPABILITY_CLARIFICATION_KEYS: Readonly<Record<string, string>> = {
  'follow_up.create': 'clarify.follow_up.create',
  'visit.create': 'clarify.visit.create',
  'customer.create': 'clarify.customer.create',
  'customer.profile.update': 'clarify.customer.profile.update',
};

/** Shared next-follow-up / schedule display. Never emit literal "Invalid Date". */
export function formatUserFacingScheduleDate(
  value: string | null | undefined,
  options?: { readonly withTime?: boolean },
): string {
  if (value == null) return t('common.unscheduled');
  const trimmed = String(value).trim();
  if (!trimmed) return t('common.unscheduled');
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return t('common.unconfirmed');
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return t('common.unconfirmed');
  if (options?.withTime) {
    const labeled = formatUserTimeLabel(trimmed);
    return !labeled || labeled.includes('Invalid') ? t('common.unconfirmed') : labeled;
  }
  const formatted = new Intl.DateTimeFormat(getAppLocale(), {
    timeZone: SALES_AGENT_APP_CLOCK.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
  if (!formatted || formatted.includes('Invalid')) return t('common.unconfirmed');
  return formatted;
}

export function formatUserTimeLabel(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  if (getAppLocale() === 'en-US') {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: SALES_AGENT_APP_CLOCK.timezone,
      month: 'short',
      day: 'numeric',
      hour: value.length <= 10 && !value.includes('T') ? undefined : 'numeric',
      minute: value.length <= 10 && !value.includes('T') ? undefined : '2-digit',
    }).format(date);
    return formatted;
  }
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SALES_AGENT_APP_CLOCK.timezone,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const month = formatted.find(part => part.type === 'month')?.value;
  const day = formatted.find(part => part.type === 'day')?.value;
  const hour = Number(formatted.find(part => part.type === 'hour')?.value ?? 0);
  const minute = formatted.find(part => part.type === 'minute')?.value ?? '00';
  const meridiem = hour < 12 ? '上午' : hour === 12 ? '中午' : '下午';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  if (value.length <= 10 && !value.includes('T')) {
    return `${month} 月 ${day} 日`;
  }
  return `${month} 月 ${day} 日 ${meridiem} ${displayHour}:${minute}`;
}

export function formatUserFacingValue(key: string, value: unknown): string {
  if (value == null || value === '') return t('common.empty');
  if (key === 'opportunity_amount' && typeof value === 'number') {
    return `¥${value.toLocaleString(getAppLocale())}`;
  }
  if (key === 'is_key_decision_maker') return value === 1 || value === true ? t('common.yes') : t('common.no');
  if (typeof value === 'string' && tEnum(value)) return tEnum(value)!;
  if (typeof value === 'string' && (key.endsWith('_at') || key.endsWith('_date') || /^\d{4}-\d{2}-\d{2}T/.test(value))) {
    return formatUserTimeLabel(value);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return t('common.complex');
}

export function isEmptyProposedValue(key: string, value: unknown): boolean {
  if (HIDDEN_INTERNAL_KEYS.has(key)) return true;
  if (value == null || value === '') return true;
  if (Object.prototype.hasOwnProperty.call(PRODUCT_DEFAULT_VALUES, key) && PRODUCT_DEFAULT_VALUES[key] === value) {
    return true;
  }
  return false;
}

export function formatProposalValues(values: Record<string, unknown>): string {
  return Object.entries(values)
    .filter(([key, value]) => !isEmptyProposedValue(key, value))
    .map(([key, value]) => `${tField(key)}：${formatUserFacingValue(key, value)}`)
    .join('\n');
}

export function isInternalFieldName(key: string): boolean {
  return HIDDEN_INTERNAL_KEYS.has(key);
}

export function containsInternalSchemaNames(text: string): boolean {
  return INTERNAL_SCHEMA_NAME_PATTERN.test(text);
}

/** Project planner/model missing-field names into user-facing Chinese. Never show schema identifiers. */
export function projectClarificationQuestion(
  capabilityId: string | null,
  missingFields: readonly string[],
  fallbackQuestion?: string,
  knownArguments?: Readonly<Record<string, unknown>>,
): string {
  const contact = typeof knownArguments?.contact_person === 'string' ? knownArguments.contact_person.trim() : '';
  if (capabilityId === 'customer.create' && missingFields.includes('name') && contact) {
    return `可以。联系人${contact}已经记下了，新客户叫什么？`;
  }
  const fallback = fallbackQuestion?.trim() ?? '';
  if (fallback && !containsInternalSchemaNames(fallback) && !/请补充缺失信息/.test(fallback)) return fallback;
  if (capabilityId && CAPABILITY_CLARIFICATION_KEYS[capabilityId]) {
    return t(CAPABILITY_CLARIFICATION_KEYS[capabilityId]);
  }
  const labels = missingFields
    .filter(field => !HIDDEN_INTERNAL_KEYS.has(field) && field !== 'clarification_answer')
    .map(field => tField(field));
  if (labels.length > 0) return `${t('clarify.prefix')}${labels.join(getAppLocale() === 'en-US' ? ', ' : '、')}。`;
  return t('clarify.generic');
}

const TOOL_TITLE_KEYS: Readonly<Record<string, string>> = {
  create_customer: 'confirmation.createCustomer',
  create_follow_up_record: 'confirmation.createFollowUp',
  create_visit_record: 'confirmation.createVisit',
  create_task: 'confirmation.createTask',
  update_next_follow_up_time: 'confirmation.updateFollowUp',
  update_customer_profile: 'confirmation.updateProfile',
  update_opportunity_amount: 'confirmation.updateAmount',
  delete_customer: 'confirmation.deleteCustomer',
};

const TOOL_CONFIRM_KEYS: Readonly<Record<string, string>> = {
  create_customer: 'confirmation.createCustomerAction',
  create_follow_up_record: 'confirmation.createFollowUpAction',
  create_visit_record: 'confirmation.createVisitAction',
  create_task: 'confirmation.createTaskAction',
  update_next_follow_up_time: 'confirmation.updateFollowUpAction',
  update_customer_profile: 'confirmation.updateProfileAction',
  update_opportunity_amount: 'confirmation.updateAmountAction',
  delete_customer: 'confirmation.deleteCustomerAction',
};

const TOOL_SUCCESS_KEYS: Readonly<Record<string, string>> = {
  create_customer: 'confirmation.createCustomerSuccess',
  create_follow_up_record: 'confirmation.createFollowUpSuccess',
  create_visit_record: 'confirmation.createVisitSuccess',
  create_task: 'confirmation.createTaskSuccess',
  update_next_follow_up_time: 'confirmation.updateFollowUpSuccess',
  update_customer_profile: 'confirmation.updateProfileSuccess',
  update_opportunity_amount: 'confirmation.updateAmountSuccess',
  delete_customer: 'confirmation.deleteCustomerSuccess',
};

export interface ConfirmationCardProjection {
  readonly title: string;
  readonly confirm_label: string;
  readonly cancel_label: string;
  readonly success_label: string;
  readonly strength: 'normal' | 'strong';
  readonly headline: string | null;
  readonly summary_lines: readonly string[];
  readonly footnote: string | null;
  readonly destructive_note: string | null;
}

export interface ConfirmationTechnicalDetails {
  readonly heading: string;
  readonly lines: readonly string[];
}

/** Secondary debug surface. Canonical proposal fields stay intact; this is not the default card. */
export function projectConfirmationTechnicalDetails(proposal: AgentWriteProposal): ConfirmationTechnicalDetails {
  const operation = proposal.operation === 'create'
    ? t('technicalDetails.createOp')
    : proposal.operation === 'delete'
      ? t('technicalDetails.deleteOp')
      : t('technicalDetails.updateOp');
  const current = formatProposalValues(proposal.current_values as Record<string, unknown>) || t('technicalDetails.none');
  const proposed = formatProposalValues(proposal.proposed_values as Record<string, unknown>) || t('technicalDetails.none');
  return {
    heading: t('technicalDetails.heading'),
    lines: [
      `${t('technicalDetails.operation')}：${operation}`,
      `${t('technicalDetails.current')}：${current}`,
      `${t('technicalDetails.proposed')}：${proposed}`,
      `${t('technicalDetails.reason')}：${proposal.reason}`,
      `${t('technicalDetails.evidence')}：${proposal.evidence_refs.join(getAppLocale() === 'en-US' ? ', ' : '、') || t('technicalDetails.userInstruction')}`,
      `${t('technicalDetails.reversible')}：${proposal.reversible ? t('common.yes') : t('common.no')}`,
      t('technicalDetails.manual'),
    ],
  };
}

function labeledEntries(values: Readonly<Record<string, unknown>>, omit: ReadonlySet<string> = new Set()): readonly string[] {
  return Object.entries(values)
    .filter(([key, value]) => !omit.has(key) && !isEmptyProposedValue(key, value))
    .map(([key, value]) => `${tField(key)}：${formatUserFacingValue(key, value)}`);
}

/** Central user-facing confirmation projection. Canonical proposal payload is unchanged. */
export function projectConfirmationCard(proposal: AgentWriteProposal): ConfirmationCardProjection {
  const strong = proposal.tool_id === 'delete_customer';
  const title = proposal.grouped_operations
    ? t('confirmation.grouped')
    : t(TOOL_TITLE_KEYS[proposal.tool_id] ?? 'confirmation.write');
  const confirm_label = proposal.grouped_operations
    ? t('confirmation.groupedConfirm')
    : t(TOOL_CONFIRM_KEYS[proposal.tool_id] ?? 'confirmation.confirm');
  const success_label = proposal.grouped_operations
    ? t('confirmation.groupedSuccess')
    : t(TOOL_SUCCESS_KEYS[proposal.tool_id] ?? 'confirmation.writeSuccess');

  if (proposal.tool_id === 'create_customer') {
    const name = typeof proposal.proposed_values.name === 'string' ? proposal.proposed_values.name.trim() : '';
    const contact = typeof proposal.proposed_values.contact_person === 'string' ? proposal.proposed_values.contact_person.trim() : '';
    const extras = labeledEntries(proposal.proposed_values, new Set(['name', 'contact_person']));
    const summary_lines = [
      ...(contact ? [`${t('common.contact')}：${contact}`] : []),
      ...extras,
    ];
    return {
      title,
      confirm_label,
      cancel_label: t('confirmation.cancel'),
      success_label,
      strength: 'normal',
      headline: name || null,
      summary_lines,
      footnote: extras.length === 0 ? t('confirmation.createFootnote') : null,
      destructive_note: null,
    };
  }

  if (proposal.tool_id === 'create_task') {
    const titleValue = typeof proposal.proposed_values.title === 'string' ? proposal.proposed_values.title.trim() : '';
    const summary_lines = titleValue ? [`${t('common.title')}：${titleValue}`] : [];
    return {
      title,
      confirm_label,
      cancel_label: t('confirmation.cancel'),
      success_label,
      strength: 'normal',
      headline: titleValue || null,
      summary_lines,
      footnote: null,
      destructive_note: null,
    };
  }

  if (strong) {
    const name = typeof proposal.current_values.name === 'string'
      ? proposal.current_values.name
      : typeof proposal.current_values.customer_name === 'string'
        ? proposal.current_values.customer_name
        : null;
    return {
      title,
      confirm_label,
      cancel_label: t('confirmation.cancel'),
      success_label,
      strength: 'strong',
      headline: name,
      summary_lines: [
        ...(name ? [`${t('common.customer')}：${name}`] : []),
        t('confirmation.deleteLine'),
      ],
      footnote: null,
      destructive_note: t('confirmation.deleteNote'),
    };
  }

  const proposed = labeledEntries(proposal.proposed_values);
  return {
    title,
    confirm_label,
    cancel_label: t('confirmation.cancel'),
    success_label,
    strength: 'normal',
    headline: null,
    summary_lines: proposed,
    footnote: null,
    destructive_note: null,
  };
}
