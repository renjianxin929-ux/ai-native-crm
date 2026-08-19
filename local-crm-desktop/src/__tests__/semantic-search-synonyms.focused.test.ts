import { describe, expect, it } from 'vitest';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { normalizeCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';

describe('semantic-search-synonyms', () => {
  it.each(['所有广州机械设备行业客户', '广州的机械设备客户', '找一下广州做机械设备的公司'])('%s is name contains 广州 + industry, not region', phrase => {
    const normalized = normalizeCustomerSearchFilters(phrase, '2026-07-19T12:00:00+08:00');
    expect(normalized.filters).toMatchObject({ name_query: '广州', industry: '机械设备' });
    expect(normalized.filters.region).toBeUndefined();
    expect(normalized.is_portfolio_query).toBe(true);
    expect(createAgentIntentEnvelope(phrase, '2026-07-19T12:00:00+08:00')).toMatchObject({ intent: 'SEARCH_CUSTOMERS', mode: 'portfolio_search', portfolio_filters: { name_query: '广州', industry: '机械设备' } });
  });

  it('广州区域机械相关企业 uses explicit geographic language as region', () => {
    const normalized = normalizeCustomerSearchFilters('广州区域机械相关企业', '2026-07-19T12:00:00+08:00');
    expect(normalized.filters).toMatchObject({ region: '广州', industry: '机械设备' });
    expect(normalized.filters.name_query).toBeUndefined();
  });

  it.each(['找一下广州客户', '帮我找一下广州得客户', '帮我找一下东莞得客户'])('%s is a name-contains list, not region=city', phrase => {
    const normalized = normalizeCustomerSearchFilters(phrase, '2026-08-01T12:00:00+08:00');
    const token = phrase.includes('东莞') ? '东莞' : '广州';
    expect(normalized.filters).toEqual({ name_query: token, now: '2026-08-01T12:00:00+08:00' });
    expect(normalized.is_portfolio_query).toBe(true);
    expect(normalized.is_customer_lookup).toBe(false);
    expect(createAgentIntentEnvelope(phrase, '2026-08-01T12:00:00+08:00')).toMatchObject({
      intent: 'SEARCH_CUSTOMERS',
      mode: 'portfolio_search',
      portfolio_filters: { name_query: token },
    });
  });

  it('keeps a named lookup with region-like company words as an entity search', () => {
    const normalized = normalizeCustomerSearchFilters('找一下华南生物', '2026-08-01T12:00:00+08:00');
    expect(normalized.filters).toEqual({ name_query: '华南生物', now: '2026-08-01T12:00:00+08:00' });
    expect(normalized.is_portfolio_query).toBe(false);
    expect(normalized.is_customer_lookup).toBe(true);
  });
});
