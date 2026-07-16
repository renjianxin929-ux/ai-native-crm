/**
 * Isolated SQLite fixture for Sales Agent production-path search / resolution / daily focus.
 * Seeds real customers table rows via better-sqlite3 — not React candidate objects.
 */

import type Database from 'better-sqlite3';
import { sqliteFixture } from './salesAgentProductionHarness';

export interface SeededCustomer {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly industry: string;
  readonly customer_grade: string;
  readonly stage: string;
  readonly intent_level: string;
  readonly last_contacted_at: string | null;
  readonly next_follow_up_at: string | null;
}

/** Canonical fixture set meeting the functional closure requirements. */
export const SALES_AGENT_FIXTURE_CUSTOMERS: readonly SeededCustomer[] = [
  {
    id: 'dg-a-jm',
    name: '东莞 JM 新能源科技有限公司',
    region: '东莞',
    industry: '新能源',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-06-01T00:00:00.000Z',
    next_follow_up_at: '2026-07-01T00:00:00.000Z', // overdue vs 2026-07-14
  },
  {
    id: 'dg-c-other',
    name: '东莞其它贸易',
    region: '东莞',
    industry: '贸易',
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    intent_level: 'LOW',
    last_contacted_at: '2026-07-10T00:00:00.000Z',
    next_follow_up_at: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'gz-a-mech',
    name: '广州机械设备股份',
    region: '广州',
    industry: '机械设备',
    customer_grade: 'A',
    stage: 'VISIT_READY',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-12T00:00:00.000Z',
    next_follow_up_at: '2026-07-20T00:00:00.000Z',
  },
  {
    id: 'gz-new-lead',
    name: '广州新线索客户',
    region: '广州',
    industry: '贸易',
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    intent_level: 'UNKNOWN',
    last_contacted_at: null,
    next_follow_up_at: null,
  },
  {
    id: 'similar-alpha',
    name: '华南生物科技',
    region: '华南',
    industry: '生物',
    customer_grade: 'B',
    stage: 'CONTACTED',
    intent_level: 'MEDIUM',
    last_contacted_at: '2026-07-01T00:00:00.000Z',
    next_follow_up_at: '2026-07-15T00:00:00.000Z',
  },
  {
    id: 'similar-beta',
    name: '华南生物医药',
    region: '华南',
    industry: '生物',
    customer_grade: 'B',
    stage: 'CONTACTED',
    intent_level: 'MEDIUM',
    last_contacted_at: '2026-07-02T00:00:00.000Z',
    next_follow_up_at: '2026-07-16T00:00:00.000Z',
  },
  {
    id: 'unique-exact',
    name: '深圳精确唯一客户有限公司',
    region: '深圳',
    industry: '电子',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-13T00:00:00.000Z',
    next_follow_up_at: '2026-07-18T00:00:00.000Z',
  },
  {
    id: 'recent-follow',
    name: '近期跟进活跃客户',
    region: '上海',
    industry: '软件',
    customer_grade: 'B',
    stage: 'REPLIED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-13T12:00:00.000Z',
    next_follow_up_at: '2026-07-16T00:00:00.000Z',
  },
  {
    id: 'stale-30',
    name: '三十天未跟进客户',
    region: '杭州',
    industry: '制造',
    customer_grade: 'B',
    stage: 'CONTACTED',
    intent_level: 'MEDIUM',
    last_contacted_at: '2026-05-01T00:00:00.000Z',
    next_follow_up_at: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'high-priority',
    name: '高意向优先客户',
    region: '北京',
    industry: '医疗',
    customer_grade: 'A',
    stage: 'CONTRACTING',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-05T00:00:00.000Z',
    next_follow_up_at: '2026-07-10T00:00:00.000Z', // overdue
  },
] as const;

export function insertSeededCustomer(sqlite: Database.Database, customer: SeededCustomer) {
  sqlite.prepare(
    `INSERT INTO customers (
      id, name, customer_grade, stage, intent_level, region, industry,
      last_contacted_at, next_follow_up_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    customer.id,
    customer.name,
    customer.customer_grade,
    customer.stage,
    customer.intent_level,
    customer.region,
    customer.industry,
    customer.last_contacted_at,
    customer.next_follow_up_at,
    '2026-06-01T00:00:00.000Z',
    '2026-07-01T00:00:00.000Z',
  );
}

export async function openSalesAgentSqliteFixture() {
  const fixture = sqliteFixture();
  await fixture.initialize();
  for (const customer of SALES_AGENT_FIXTURE_CUSTOMERS) {
    insertSeededCustomer(fixture.sqlite, customer);
  }
  return fixture;
}
