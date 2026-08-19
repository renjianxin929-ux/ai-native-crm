/**
 * Customer Detail user-facing projection.
 * Display only — does not change CRM truth, capabilities, or schema.
 */

import { isCompletedHistoricalFollowUp } from '../planner/followUpInteractionContract';
import { sortByInstantDesc } from '../time/instantCompare';
import type { Customer, FollowUpRecord, VisitRecord } from '../types';
import type { CustomerTimelineItem } from '../../components/salesWorkspace/CustomerIntelligencePanel';

export const CUSTOMER_DETAIL_LAYER2_ACCORDIONS = [
  'profile',
  'timeline',
  'intelligence',
  'management',
] as const;

export type CustomerDetailLayer2Accordion = (typeof CUSTOMER_DETAIL_LAYER2_ACCORDIONS)[number];

function isEmptyText(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === '';
}

const OPTIONAL_PROFILE_KEYS = [
  'contact_person',
  'phone_number',
  'wechat_id',
  'email',
  'industry',
  'region',
  'website',
  'address',
  'source',
  'pitch_angle',
  'qualification_reason',
  'notes',
  'wechat_search_status',
  'phone_feedback',
  'next_action',
  'next_follow_up_at',
  'rough_visit_time_text',
  'parsed_visit_reminder_at',
  'time_parse_note',
  'deal_amount',
] as const;

export type CustomerProfileFieldKey =
  | 'name'
  | 'customer_grade'
  | 'stage'
  | 'is_key_decision_maker'
  | 'wechat_add_status'
  | 'intent_level'
  | 'payment_status'
  | 'no_show_count'
  | 'time_parse_status'
  | (typeof OPTIONAL_PROFILE_KEYS)[number];

function optionalEmpty(customer: Customer, key: (typeof OPTIONAL_PROFILE_KEYS)[number]): boolean {
  switch (key) {
    case 'deal_amount':
      return customer.deal_amount == null || !Number.isFinite(customer.deal_amount);
    case 'next_follow_up_at':
      return isEmptyText(customer.next_follow_up_at);
    case 'parsed_visit_reminder_at':
      return isEmptyText(customer.parsed_visit_reminder_at);
    case 'wechat_search_status':
      return customer.wechat_search_status == null;
    case 'phone_feedback':
      return customer.phone_feedback == null;
    case 'next_action':
      return customer.next_action == null;
    default:
      return isEmptyText(customer[key] as string | null | undefined);
  }
}

export interface CustomerProfileProjection {
  readonly presentKeys: readonly CustomerProfileFieldKey[];
  readonly emptyKeys: readonly CustomerProfileFieldKey[];
  readonly emptyCount: number;
}

export function projectCustomerProfileFields(customer: Customer): CustomerProfileProjection {
  const presentKeys: CustomerProfileFieldKey[] = [
    'name',
    'customer_grade',
    'stage',
    'is_key_decision_maker',
    'wechat_add_status',
    'intent_level',
    'payment_status',
  ];
  if (customer.no_show_count > 0) presentKeys.push('no_show_count');
  if (customer.time_parse_status !== 'NOT_PARSED') presentKeys.push('time_parse_status');

  const emptyKeys: CustomerProfileFieldKey[] = [];
  for (const key of OPTIONAL_PROFILE_KEYS) {
    if (optionalEmpty(customer, key)) emptyKeys.push(key);
    else presentKeys.push(key);
  }

  return { presentKeys, emptyKeys, emptyCount: emptyKeys.length };
}

export interface RecentActivityItem {
  readonly kind: 'follow_up' | 'visit' | 'change';
  readonly title: string;
  readonly occurredAt: string;
  readonly detail: string;
}

export interface RecentActivityProjection {
  readonly lastFollowUp: RecentActivityItem | null;
  readonly lastVisit: RecentActivityItem | null;
  readonly lastKeyChange: RecentActivityItem | null;
}

export function projectRecentActivity(
  followUps: readonly FollowUpRecord[],
  visits: readonly VisitRecord[],
  timeline: readonly CustomerTimelineItem[],
): RecentActivityProjection {
  const lastFollowUpRow = sortByInstantDesc(
    followUps.filter(isCompletedHistoricalFollowUp),
    item => item.updated_at,
  )[0] ?? null;
  const lastVisitRow = sortByInstantDesc(visits, item => item.visited_at || item.updated_at)[0] ?? null;
  const lastChange = timeline[0] ?? null;

  return {
    lastFollowUp: lastFollowUpRow
      ? {
          kind: 'follow_up',
          title: lastFollowUpRow.title,
          occurredAt: lastFollowUpRow.updated_at,
          detail: lastFollowUpRow.feedback_notes || lastFollowUpRow.contact_result || '',
        }
      : null,
    lastVisit: lastVisitRow
      ? {
          kind: 'visit',
          title: lastVisitRow.title,
          occurredAt: lastVisitRow.visited_at || lastVisitRow.updated_at,
          detail: lastVisitRow.visit_notes || lastVisitRow.customer_concerns || lastVisitRow.visit_outcome || '',
        }
      : null,
    lastKeyChange: lastChange
      ? {
          kind: 'change',
          title: lastChange.title,
          occurredAt: lastChange.occurredAt,
          detail: lastChange.detail,
        }
      : null,
  };
}

export interface CustomerDetailFirstLayer {
  readonly name: string;
  readonly grade: Customer['customer_grade'];
  readonly stage: Customer['stage'];
  readonly opportunityAmount: number | null;
  readonly nextFollowUpAt: string | null;
  readonly contactPerson: string | null;
  readonly contactMethods: readonly string[];
  readonly nextAction: Customer['next_action'];
  readonly recent: RecentActivityProjection;
  readonly timelineExpanded: false;
}

export function projectCustomerDetailFirstLayer(
  customer: Customer,
  followUps: readonly FollowUpRecord[],
  visits: readonly VisitRecord[],
  timeline: readonly CustomerTimelineItem[],
): CustomerDetailFirstLayer {
  return {
    name: customer.name,
    grade: customer.customer_grade,
    stage: customer.stage,
    opportunityAmount: customer.opportunity_amount ?? null,
    nextFollowUpAt: customer.next_follow_up_at,
    contactPerson: isEmptyText(customer.contact_person) ? null : customer.contact_person,
    contactMethods: [
      customer.phone_number,
      customer.wechat_id,
    ].filter((value): value is string => !isEmptyText(value)),
    nextAction: customer.next_action,
    recent: projectRecentActivity(followUps, visits, timeline),
    timelineExpanded: false,
  };
}
