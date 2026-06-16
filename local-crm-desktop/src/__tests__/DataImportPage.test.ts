import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { FieldMapping } from '../lib/importer';
import {
  buildFinalImportPreviewRows,
  getDuplicateMappingErrors,
  getFinalImportPreviewColumns,
  getSourceColumnDisplayName,
  hasDuplicateMappings,
  normalizeImportPreviewSourceColumns,
} from '../pages/DataImportPage';

describe('DataImportPage mapping preview helpers', () => {
  const headers = ['客户名称', '', '', ''];
  const rows = [
    ['广州样例客户', '13800138000', 'A', '重要客户'],
  ];

  it('uses the latest manual mapping for final import preview fields', () => {
    const preview = normalizeImportPreviewSourceColumns({
      headers,
      rows,
      autoMapping: headers.map(sourceColumn => ({ sourceColumn, crmField: null })),
    });
    const mapping: FieldMapping[] = [
      { sourceColumn: '客户名称', crmField: 'name' },
      { sourceColumn: '第2列', crmField: 'phone_number' },
      { sourceColumn: '第3列', crmField: 'customer_grade' },
      { sourceColumn: '第4列', crmField: 'notes' },
    ];

    expect(preview.headers).toEqual(['客户名称', '第2列', '第3列', '第4列']);
    expect(getFinalImportPreviewColumns(mapping).map(column => column.label)).toEqual([
      '客户名称',
      '手机号',
      '客户等级',
      '备注摘要',
    ]);

    expect(buildFinalImportPreviewRows(preview.rows, preview.headers, mapping)).toEqual([
      {
        index: 1,
        values: {
          name: '广州样例客户',
          phone_number: '13800138000',
          customer_grade: 'A',
          notes: '重要客户',
        },
      },
    ]);
  });

  it('shows unnamed source columns as readable column numbers', () => {
    expect(getSourceColumnDisplayName('', 1)).toBe('第2列');
    expect(getSourceColumnDisplayName('   ', 2)).toBe('第3列');
    expect(getSourceColumnDisplayName('手机号', 3)).toBe('手机号');
  });

  it('reports duplicate target field mappings and blocks import', () => {
    const mapping: FieldMapping[] = [
      { sourceColumn: '客户名称', crmField: 'name' },
      { sourceColumn: '', crmField: 'phone_number' },
      { sourceColumn: '', crmField: 'phone_number' },
    ];

    expect(hasDuplicateMappings(mapping)).toBe(true);
    expect(getDuplicateMappingErrors(mapping)).toEqual([
      '手机号已被其他列映射，请先取消重复映射。',
    ]);
  });

  it('clears duplicate errors after the repeated target field is cancelled', () => {
    const mapping: FieldMapping[] = [
      { sourceColumn: '客户名称', crmField: 'name' },
      { sourceColumn: '', crmField: 'phone_number' },
      { sourceColumn: '', crmField: null },
    ];

    expect(hasDuplicateMappings(mapping)).toBe(false);
    expect(getDuplicateMappingErrors(mapping)).toEqual([]);
  });

  it('does not touch the newer lead import center or workbench pages', () => {
    const dataImportSource = readFileSync(new URL('../pages/DataImportPage.tsx', import.meta.url), 'utf8');
    const leadImportSource = readFileSync(new URL('../pages/LeadImportCenterPage.tsx', import.meta.url), 'utf8');
    const leadWorkbenchSource = readFileSync(new URL('../pages/LeadWorkbenchPage.tsx', import.meta.url), 'utf8');

    expect(dataImportSource).toContain('最终导入预览');
    expect(dataImportSource).toContain('executeImport(preview.rows, preview.headers, mapping, mode, customers)');
    expect(dataImportSource).toContain('disabled={!hasNameMapping || hasMappingErrors}');
    expect(leadImportSource.length).toBeGreaterThan(0);
    expect(leadWorkbenchSource.length).toBeGreaterThan(0);
  });
});
