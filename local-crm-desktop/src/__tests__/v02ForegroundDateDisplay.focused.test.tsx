// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import type { Customer } from '../lib/types';
import CustomerList from '../pages/CustomerList';
import { draftWriteFields } from '../lib/salesAgentTools/writeIntent';
import { PRODUCTION_CAPABILITY_EXECUTION } from '../lib/capabilities/execution';
import { getCanonicalProposal } from '../lib/salesAgentTools/sessionWriteStateStore';
import { __setDbInstanceForTests } from '../lib/db';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { insertSeededCustomer } from './salesAgentFunctionalFixture';
import { sqliteFixture } from './salesAgentProductionHarness';
import { formatUserFacingScheduleDate } from '../lib/salesAgentUi/userFacingFieldFormatter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-07-15T12:00:00+08:00';
const customerListSrc = readFileSync('src/pages/CustomerList.tsx', 'utf8');
const customerDetailSrc = readFileSync('src/pages/CustomerDetail.tsx', 'utf8');

function makeCustomer(overrides: Partial<Customer>): Customer {
  return {
    id: 'c1',
    name: '广州ABC科技有限公司',
    customer_grade: 'A',
    stage: 'CONTACTED',
    contact_method: null,
    wechat_id: null,
    phone_number: null,
    wechat_search_status: null,
    is_key_decision_maker: 0,
    wechat_add_status: 'NOT_ADDED',
    has_replied: 0,
    intent_level: 'HIGH',
    phone_feedback: null,
    can_schedule_visit: 0,
    visit_scheduled_at: null,
    next_action: null,
    next_follow_up_at: null,
    last_contacted_at: '2026-07-10T00:00:00.000Z',
    last_feedback_type: 'UNKNOWN',
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    opportunity_amount: 200000,
    paid_at: null,
    closed_at: null,
    website: null,
    region: '广州',
    industry: '软件',
    notes: null,
    source: null,
    contact_person: '张总',
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="test-container"></div>';
  container = document.querySelector('#test-container') as HTMLDivElement;
});

afterEach(() => {
  act(() => { root?.unmount(); });
  document.body.innerHTML = '';
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function renderList(customers: Customer[]) {
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <CustomerList customers={customers} onRefresh={() => {}} />
      </MemoryRouter>,
    );
  });
}

describe('T6 — shared date display contract', () => {
  it('valid timestamp → human-readable date, never Invalid Date', () => {
    expect(formatUserFacingScheduleDate('2026-07-20T10:00:00+08:00')).not.toBe('Invalid Date');
    expect(formatUserFacingScheduleDate('2026-07-20T10:00:00+08:00')).not.toBe('未安排');
    expect(formatUserFacingScheduleDate('2026-07-20T10:00:00+08:00')).not.toBe('待确认');
    expect(formatUserFacingScheduleDate('2026-07-20T10:00:00+08:00')).toMatch(/7|20/);
  });

  it('null / missing → 未安排', () => {
    expect(formatUserFacingScheduleDate(null)).toBe('未安排');
    expect(formatUserFacingScheduleDate(undefined)).toBe('未安排');
    expect(formatUserFacingScheduleDate('')).toBe('未安排');
  });

  it('unparseable value → 待确认, never Invalid Date', () => {
    expect(formatUserFacingScheduleDate('下周一')).toBe('待确认');
    expect(formatUserFacingScheduleDate('8月10日')).toBe('待确认');
    expect(formatUserFacingScheduleDate('Invalid Date')).toBe('待确认');
    expect(formatUserFacingScheduleDate('   ')).toBe('未安排');
  });

  it('Customer List never renders Invalid Date for valid / null / unparseable next_follow_up_at', () => {
    renderList([
      makeCustomer({ id: 'valid', name: '有效日期客户', next_follow_up_at: '2026-07-20T10:00:00+08:00' }),
      makeCustomer({ id: 'missing', name: '空日期客户', next_follow_up_at: null }),
      makeCustomer({ id: 'bad', name: '畸形日期客户', next_follow_up_at: '下周一上午' }),
    ]);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Invalid Date');
    expect(text).toContain('未安排');
    expect(text).toContain('待确认');
    expect(customerListSrc).toContain('formatUserFacingScheduleDate');
    expect(customerListSrc).not.toMatch(/\{c\.next_follow_up_at \? new Date\(c\.next_follow_up_at\)\.toLocaleDateString/);
  });

  it('Customer Detail next_follow_up_at uses the shared formatter, never raw Date#toLocaleString', () => {
    expect(customerDetailSrc).toContain('formatUserFacingScheduleDate');
    expect(customerDetailSrc).not.toMatch(/new Date\(customer\.next_follow_up_at\)\.toLocaleString/);
    expect(formatUserFacingScheduleDate('2026-07-20T10:00:00+08:00')).not.toBe('Invalid Date');
    expect(formatUserFacingScheduleDate(null)).toBe('未安排');
    expect(formatUserFacingScheduleDate('下周一')).toBe('待确认');
  });
});

describe('T7 — date storage truth at the central write seam', () => {
  it('human scheduling via writeIntent yields a Date.parse-able canonical timestamp', () => {
    const draft = draftWriteFields('把下次跟进改到下周一上午10点', NOW);
    expect(draft?.tool_id).toBe('update_next_follow_up_time');
    const stored = typeof draft?.parsed_fields.next_follow_up_at === 'string'
      ? draft.parsed_fields.next_follow_up_at
      : typeof draft?.parsed_fields.next_follow_up_date === 'string'
        ? draft.parsed_fields.next_follow_up_date
        : '';
    expect(stored).toBeTruthy();
    const parseable = stored.length <= 10
      ? Date.parse(`${stored}T10:00:00+08:00`)
      : Date.parse(stored);
    expect(Number.isFinite(parseable)).toBe(true);
    expect(new Date(parseable).toLocaleDateString('zh-CN')).not.toBe('Invalid Date');
  });

  it('customer.next_follow_up_time.update rejects unparseable human text instead of persisting it', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    insertSeededCustomer(fixture.sqlite, {
      id: 'gz-abc',
      name: '广州ABC科技有限公司',
      region: '广州',
      industry: '软件',
      customer_grade: 'A',
      stage: 'CONTACTED',
      intent_level: 'HIGH',
      last_contacted_at: '2026-07-10T00:00:00.000Z',
      next_follow_up_at: '2026-07-20T10:00:00+08:00',
    });
    __setDbInstanceForTests(fixture.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.next_follow_up_time.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, next_follow_up_at: '下周一上午' },
        scope: { customer_id: 'gz-abc' },
      });
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(
          (outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id,
          'gz-abc',
        );
        const stored = String(proposal?.proposed_values.next_follow_up_at ?? '');
        expect(Number.isFinite(Date.parse(stored))).toBe(true);
        expect(stored).not.toBe('下周一上午');
      } else {
        expect(outcome.status).toBe('EXECUTION_ERROR');
      }
      const row = fixture.sqlite.prepare('SELECT next_follow_up_at AS v FROM customers WHERE id=?').get('gz-abc') as { v: string };
      expect(row.v).toBe('2026-07-20T10:00:00+08:00');
    } finally {
      fixture.close();
    }
  });
});
