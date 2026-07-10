import type {
  ReadOnlyAISuggestionCard,
  ReadOnlyAISuggestionServiceResponse,
} from '../../lib/readOnlyAISuggestionServiceReadiness';

export interface ReadOnlyAISuggestionViewModel {
  valid: boolean;
  blockedReason: string | null;
  statusBadges: readonly string[];
  notices: readonly string[];
  provenanceItems: readonly ReadOnlyAISuggestionLabelValue[];
  cards: readonly ReadOnlyAISuggestionCardView[];
  safetyItems: readonly string[];
  summaryItems: readonly ReadOnlyAISuggestionLabelValue[];
  traceItems: readonly ReadOnlyAISuggestionLabelValue[];
}

export interface ReadOnlyAISuggestionLabelValue {
  label: string;
  value: string;
}

export interface ReadOnlyAISuggestionCardView {
  cardId: string;
  title: string;
  summary: string;
  status: string;
  requiresHumanReview: boolean;
}

const SAFETY_LABELS = [
  'Read-only',
  'Preview',
  'Requires human review',
  'Not executable',
  'Untrusted',
  'Informational only',
];

export function buildReadOnlyAISuggestionViewModel(
  response: ReadOnlyAISuggestionServiceResponse,
): ReadOnlyAISuggestionViewModel {
  const validation = validateResponse(response);
  if (!validation.valid) {
    return {
      valid: false,
      blockedReason: validation.reason,
      statusBadges: SAFETY_LABELS,
      notices: [
        'Blocked preview',
        validation.reason,
        'Informational only',
      ],
      provenanceItems: [],
      cards: [],
      safetyItems: SAFETY_LABELS,
      summaryItems: [
        { label: 'Cards', value: '0' },
        { label: 'Preview state', value: 'Blocked preview' },
      ],
      traceItems: [],
    };
  }

  if (response.answer.service_blocked) {
    const reason = response.answer.blocked_reason ?? 'blocked_preview';
    return {
      valid: true,
      blockedReason: reason,
      statusBadges: SAFETY_LABELS,
      notices: [
        'Blocked preview',
        reason,
        'Informational only',
      ],
      provenanceItems: buildProvenanceItems(response),
      cards: [],
      safetyItems: SAFETY_LABELS,
      summaryItems: buildSummaryItems(response, 0),
      traceItems: buildTraceItems(response),
    };
  }

  const cards = hasCards(response) ? response.answer.suggestion_cards.map(mapCard) : [];
  return {
    valid: true,
    blockedReason: null,
    statusBadges: SAFETY_LABELS,
    notices: cards.length > 0
      ? [
          'Read-only',
          'Preview',
          'Informational only',
        ]
      : [
          'No read-only suggestion cards to preview.',
          'Informational only',
        ],
    provenanceItems: buildProvenanceItems(response),
    cards,
    safetyItems: SAFETY_LABELS,
    summaryItems: buildSummaryItems(response, cards.length),
    traceItems: buildTraceItems(response),
  };
}

function validateResponse(response: ReadOnlyAISuggestionServiceResponse): { valid: boolean; reason: string } {
  if (response?.kind !== 'READ_ONLY_AI_SUGGESTION_SERVICE_RESPONSE') {
    return { valid: false, reason: 'Invalid response kind' };
  }
  if (response.service_read_only !== true) return { valid: false, reason: 'Invalid read-only flag' };
  if (response.source_reference_only !== true) return { valid: false, reason: 'Invalid source reference flag' };
  if (response.requires_human_review !== true) return { valid: false, reason: 'Invalid human review flag' };
  if (response.trusted_for_action !== false) return { valid: false, reason: 'Invalid trust flag' };
  if (response.executable !== false) return { valid: false, reason: 'Invalid executable flag' };
  if (response.uses_network !== false) return { valid: false, reason: 'Invalid network flag' };
  if (response.calls_real_provider !== false) return { valid: false, reason: 'Invalid provider flag' };
  if (response.reads_env !== false) return { valid: false, reason: 'Invalid env flag' };
  if (response.reads_database !== false) return { valid: false, reason: 'Invalid database read flag' };
  if (response.writes_database !== false) return { valid: false, reason: 'Invalid database write flag' };
  if (!response.answer) return { valid: false, reason: 'Missing response answer' };
  return { valid: true, reason: '' };
}

function hasCards(response: ReadOnlyAISuggestionServiceResponse): boolean {
  return response.answer.cards_count > 0 && response.answer.suggestion_cards.length > 0;
}

function mapCard(card: ReadOnlyAISuggestionCard): ReadOnlyAISuggestionCardView {
  return {
    cardId: card.card_id,
    title: card.title,
    summary: card.summary,
    status: card.suggestion_status,
    requiresHumanReview: card.requires_human_review,
  };
}

function buildProvenanceItems(
  response: ReadOnlyAISuggestionServiceResponse,
): readonly ReadOnlyAISuggestionLabelValue[] {
  return [
    { label: 'source_kind', value: displayValue(response.answer.source_kind) },
    { label: 'source_provider_kind', value: displayValue(response.answer.source_provider_kind) },
    { label: 'source_model_name', value: displayValue(response.answer.source_model_name) },
    { label: 'source_request_id', value: displayValue(response.answer.source_request_id) },
  ];
}

function buildSummaryItems(
  response: ReadOnlyAISuggestionServiceResponse,
  visibleCards: number,
): readonly ReadOnlyAISuggestionLabelValue[] {
  return [
    { label: 'Cards', value: String(visibleCards) },
    { label: 'Reported cards_count', value: String(response.answer.cards_count) },
    { label: 'Requires human review', value: response.requires_human_review ? 'true' : 'false' },
    { label: 'Read-only', value: response.service_read_only ? 'true' : 'false' },
  ];
}

function buildTraceItems(
  response: ReadOnlyAISuggestionServiceResponse,
): readonly ReadOnlyAISuggestionLabelValue[] {
  return [
    { label: 'trace_summary.kind', value: response.answer.trace_summary.kind },
    { label: 'trace_summary.request_id', value: response.answer.trace_summary.request_id },
    { label: 'trace_summary.validation_checked', value: String(response.answer.trace_summary.validation_checked) },
    { label: 'trace_summary.projection_only', value: String(response.answer.trace_summary.projection_only) },
    { label: 'trace_summary.persisted', value: String(response.answer.trace_summary.persisted) },
  ];
}

function displayValue(value: string | null): string {
  return value === null || value.length === 0 ? 'unavailable' : value;
}
