import { describe, expect, it } from 'vitest';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { normalizeCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';

describe('semantic-search-synonyms', () => {
  it.each(['所有广州机械设备行业客户', '广州的机械设备客户', '广州区域机械相关企业', '找一下广州做机械设备的公司'])('%s maps to the same real CRM filters', phrase => {
    const normalized = normalizeCustomerSearchFilters(phrase, '2026-07-19T12:00:00+08:00');
    expect(normalized.filters).toMatchObject({ region: '广州', industry: '机械设备' });
    expect(normalized.is_portfolio_query).toBe(true);
    expect(createAgentIntentEnvelope(phrase, '2026-07-19T12:00:00+08:00')).toMatchObject({ intent: 'SEARCH_CUSTOMERS', mode: 'portfolio_search', portfolio_filters: { region: '广州', industry: '机械设备' } });
  });
});
