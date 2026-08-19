import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { executeSearchCustomersTool } from '../lib/salesAgentTools/executeSearchCustomersTool';
import { normalizeCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';
import {
  SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE,
  SEARCH_CUSTOMERS_RESOLUTION_MAX,
} from '../lib/salesAgentTools/searchCustomers';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import {
  insertSeededCustomer,
  openSalesAgentSqliteFixture,
  SALES_AGENT_FIXTURE_CUSTOMERS,
} from './salesAgentFunctionalFixture';

const NOW = '2026-07-14T12:00:00.000Z';

function sessionFor(customerId: string, name: string) {
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: `snap-${customerId}`,
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [{
      id: customerId,
      name,
      customer_grade: 'A',
      intent_level: 'HIGH',
      evidence_ref: { type: 'customer', id: customerId, label: name, synthetic: false, persisted: true },
    }],
    tasks: [],
    work_items: [],
    collected_leads: [],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
  const context = buildContextSnapshot({
    snapshotId: `snap-${customerId}`,
    capturedAt: NOW,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
    customers: [{
      customerId,
      name,
      grade: 'A',
      intentLevel: 'HIGH',
      observedAt: NOW,
      evidenceIds: [customerId],
    }],
    accounts: [],
    interactions: [],
  });
  return new SalesAgentSession(customerId, null, () => NOW, {
    snapshot,
    context,
    profile_id: 'foreign_trade_geo',
    planning_mode: 'deterministic',
  });
}

describe('Sales Agent portfolio search', () => {
  it('normalizeCustomerSearchFilters: 帮我找一下广州的客户 → portfolio, name contains 广州', () => {
    const norm = normalizeCustomerSearchFilters('帮我找一下广州的客户', NOW);
    expect(norm.is_portfolio_query).toBe(true);
    expect(norm.filters.name_query).toBe('广州');
    expect(norm.filters.region).toBeUndefined();
    expect(norm.is_customer_lookup).toBe(false);
  });

  it('exact company name lookup is NOT portfolio', () => {
    const norm = normalizeCustomerSearchFilters('帮我找深圳精确唯一客户有限公司', NOW);
    expect(norm.is_portfolio_query).toBe(false);
    expect(norm.filters.name_query).toBeTruthy();
    expect(norm.is_customer_lookup).toBe(true);
  });

  it('direct entity lookup preserves company names containing region and industry words', () => {
    const norm = normalizeCustomerSearchFilters('打开华南生物科技', NOW);
    expect(norm.is_portfolio_query).toBe(false);
    expect(norm.filters).toMatchObject({ name_query: '华南生物科技' });
    expect(norm.filters.region).toBeUndefined();
    expect(norm.filters.industry).toBeUndefined();
    expect(norm.is_customer_lookup).toBe(true);
  });

  it('whole-utterance company name with embedded region word keeps full name_query (real-app discovery fix)', () => {
    const norm = normalizeCustomerSearchFilters('广州ABC科技有限公司', NOW);
    expect(norm.is_portfolio_query).toBe(false);
    expect(norm.filters).toMatchObject({ name_query: '广州ABC科技有限公司' });
    expect(norm.filters.region).toBeUndefined();
    expect(norm.is_customer_lookup).toBe(true);
  });

  it('whole-utterance company name with embedded region AND industry words keeps full name_query', () => {
    const norm = normalizeCustomerSearchFilters('广州生物科技有限公司', NOW);
    expect(norm.is_portfolio_query).toBe(false);
    expect(norm.filters).toMatchObject({ name_query: '广州生物科技有限公司' });
    expect(norm.filters.region).toBeUndefined();
    expect(norm.filters.industry).toBeUndefined();
    expect(norm.is_customer_lookup).toBe(true);
  });

  it('browse phrase ending in company suffix is a name-contains list, not region=city', () => {
    for (const phrase of ['看看广州公司', '关注广州公司', '推荐广州公司']) {
      const norm = normalizeCustomerSearchFilters(phrase, NOW);
      expect(norm.is_portfolio_query).toBe(true);
      expect(norm.filters).toMatchObject({ name_query: '广州' });
      expect(norm.filters.region).toBeUndefined();
    }
  });

  it('bare known region token + company suffix is a name-contains list', () => {
    const norm = normalizeCustomerSearchFilters('广州公司', NOW);
    expect(norm.is_portfolio_query).toBe(true);
    expect(norm.filters.name_query).toBe('广州');
    expect(norm.filters.region).toBeUndefined();
  });

  it('deictic "哪家公司" is not treated as an entity name', () => {
    const norm = normalizeCustomerSearchFilters('哪家公司', NOW);
    expect(norm.filters.name_query).toBeUndefined();
    expect(norm.is_customer_lookup).toBe(false);
  });

  it('executeSearchCustomersTool portfolio returns SQLite total_matches and page_size 20', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const norm = normalizeCustomerSearchFilters('帮我找一下广州的客户', NOW);
      const search = await executeSearchCustomersTool({
        filters: norm.filters,
        notes: norm.notes,
        list_kind: 'portfolio',
        db: fixture.db,
      });
      expect(search.list_kind).toBe('portfolio');
      expect(search.page_size).toBe(SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE);
      expect(search.total_matches).toBeGreaterThanOrEqual(2);
      expect(search.candidates.every(item => item.name.includes('广州'))).toBe(true);
      expect(search.read_only).toBe(true);
      expect(search.writes_crm).toBe(false);
    } finally {
      fixture.close();
    }
  });

  it('controller submit portfolio → portfolio_browse, 共找到, pending null, not auto-bound', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      let activeSession: SalesAgentSession | null = null;
      const controller = new SalesAgentInteractionController({
        db: fixture.db,
        createSession: () => activeSession,
        clock: () => NOW,
      });
      const turn = await controller.submit('帮我找一下广州的客户');
      expect(turn.state.phase).toBe('portfolio_browse');
      expect(turn.state.phase).not.toBe('awaiting_candidate_selection');
      expect(turn.state.agent_message).toMatch(/广州机械|找到/);
      expect(turn.state.pending_original_instruction).toBeNull();
      expect(turn.state.scoped_customer_id).toBeNull();
      expect(turn.event.type).toBe('portfolio_list');
      expect(turn.state.candidate_results.length).toBeGreaterThan(0);
      expect(turn.state.candidate_results.length).toBeLessThanOrEqual(SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE);
    } finally {
      fixture.close();
    }
  });

  it('multi name disambiguation stays awaiting_candidate_selection ≤5', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const controller = new SalesAgentInteractionController({
        db: fixture.db,
        createSession: () => null,
        clock: () => NOW,
      });
      const turn = await controller.submit('找一下华南生物');
      expect(turn.state.phase).toBe('awaiting_candidate_selection');
      expect(turn.state.candidate_results.length).toBeGreaterThan(1);
      expect(turn.state.candidate_results.length).toBeLessThanOrEqual(SEARCH_CUSTOMERS_RESOLUTION_MAX);
      expect(turn.state.pending_original_instruction).toBeTruthy();
    } finally {
      fixture.close();
    }
  });

  it('grade A ≠ NEW_LEAD; region/industry filters via fixture', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const norm = normalizeCustomerSearchFilters('帮我找一下东莞的 A 类客户', NOW);
      const search = await executeSearchCustomersTool({
        filters: norm.filters,
        notes: norm.notes,
        list_kind: 'portfolio',
        db: fixture.db,
      });
      expect(search.candidates.every(item => item.customer_grade === 'A')).toBe(true);
      expect(search.candidates.some(item => item.stage === 'NEW_LEAD' && item.customer_grade === 'A')).toBe(false);
      expect(search.candidates.map(item => item.id)).toContain('dg-a-jm');
      expect(search.candidates.some(item => item.id === 'gz-new-lead')).toBe(false);

      const mechNorm = normalizeCustomerSearchFilters('查一下广州做机械设备的客户', NOW);
      const mechSearch = await executeSearchCustomersTool({
        filters: mechNorm.filters,
        notes: mechNorm.notes,
        list_kind: 'portfolio',
        db: fixture.db,
      });
      expect(mechNorm.filters.region).toBeUndefined();
      expect(mechNorm.filters.name_query).toBe('广州');
      expect(mechSearch.candidates.every(item => item.name.includes('广州'))).toBe(true);
      expect(mechSearch.candidates.every(item => item.industry?.includes('机械'))).toBe(true);
      expect(mechSearch.candidates.map(item => item.id)).toContain('gz-a-mech');
    } finally {
      fixture.close();
    }
  });

  it('loadMorePortfolio merges without duplicates when has_more', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      for (let i = 0; i < 22; i += 1) {
        insertSeededCustomer(fixture.sqlite, {
          id: `gz-bulk-${i}`,
          name: `广州批量客户 ${String(i).padStart(2, '0')}`,
          region: '广州',
          industry: '贸易',
          customer_grade: 'B',
          stage: 'CONTACTED',
          intent_level: 'MEDIUM',
          last_contacted_at: '2026-07-01T00:00:00.000Z',
          next_follow_up_at: '2026-07-20T00:00:00.000Z',
        });
      }

      let activeSession: SalesAgentSession | null = null;
      const controller = new SalesAgentInteractionController({
        db: fixture.db,
        createSession: () => activeSession,
        clock: () => NOW,
      });
      const first = await controller.submit('帮我找一下广州的客户');
      expect(first.state.phase).toBe('portfolio_browse');
      expect(first.state.portfolio_has_more).toBe(true);
      const firstIds = first.state.candidate_results.map(item => item.id);
      expect(firstIds.length).toBe(SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE);

      const second = await controller.loadMorePortfolio();
      expect(second.state.phase).toBe('portfolio_browse');
      const mergedIds = second.state.candidate_results.map(item => item.id);
      expect(mergedIds.length).toBeGreaterThan(firstIds.length);
      expect(new Set(mergedIds).size).toBe(mergedIds.length);
      expect(mergedIds.slice(0, firstIds.length)).toEqual(firstIds);
      expect(second.state.agent_message).toMatch(/共找到/);
    } finally {
      fixture.close();
    }
  });
});
