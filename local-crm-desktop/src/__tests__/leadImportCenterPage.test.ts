import { describe, expect, it } from 'vitest';

import { buildLeadImportPreview } from '../pages/LeadImportCenterPage';

describe('lead import center preview', () => {
  it('parses JSON array and uses lead importer defaults for decisions', () => {
    const preview = buildLeadImportPreview(JSON.stringify([
      { company_name: 'Phone Co', mobile: '13800138000', score: 10 },
      { company_name: 'High Score Co', score: 80 },
      { company_name: 'Lookup Co', score: 75 },
      { company_name: 'Reserve Co', score: 60 },
    ]));

    expect(preview.error).toBeNull();
    expect(preview.rows.map(row => row.decision)).toEqual([
      'DIRECT_TO_CRM',
      'CRM_WITH_LOOKUP',
      'LOOKUP_FIRST',
      'RESERVE',
    ]);
    expect(preview.inputRows).toHaveLength(4);
  });

  it('marks blank company names as preview row errors', () => {
    const preview = buildLeadImportPreview(JSON.stringify([
      { company_name: '', mobile: '13800138000', score: 90 },
      { company_name: 'Valid Co', score: 80 },
    ]));

    expect(preview.error).toBeNull();
    expect(preview.rows[0].error).toContain('company_name is required');
    expect(preview.rows[0].decision).toBeNull();
    expect(preview.rows[1].decision).toBe('CRM_WITH_LOOKUP');
  });

  it('returns a clear error for invalid JSON', () => {
    const preview = buildLeadImportPreview('[not-json');

    expect(preview.rows).toHaveLength(0);
    expect(preview.inputRows).toHaveLength(0);
    expect(preview.error).toContain('JSON');
  });
});
