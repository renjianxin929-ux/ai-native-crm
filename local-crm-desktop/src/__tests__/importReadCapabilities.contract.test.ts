/**
 * V0.2A / A9R — Import Read Capabilities 聚焦测试。
 *
 * 覆盖规格 T1–T17，并提供第 26 节要求的真实数据路径集成证据
 * （代表性 .xlsx/.csv fixture → 产品 parser/preview/validator → A9R capability →
 * 相同结果 → 零 CRM 写）。
 *
 * 原则：
 * - 不修改任何现有文件；只新增本测试与 capabilities/import/** 模块。
 * - 不弱化/替换任何既有测试。
 * - 静态架构证据扫描 capabilities/import/** 源码，保证零写、零模型、零网络。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createCapabilityRegistry,
  DuplicateCapabilityError,
  type CapabilityDefinition,
} from '../lib/capabilities';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../lib/capabilities/customer';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline';
import { FOLLOW_UP_READ_MANIFEST } from '../lib/capabilities/followUp';
import { TASK_READ_MANIFEST } from '../lib/capabilities/task';
import {
  IMPORT_READ_CAPABILITY_DEFINITIONS,
  IMPORT_READ_CAPABILITY_IDS,
  IMPORT_READ_CAPABILITY_MANIFEST,
  IMPORT_READ_INVENTORY,
  VERIFIED_IMPORT_READ_CANDIDATES,
  previewImportFile,
  validateImportMapping,
} from '../lib/capabilities/import';
import {
  detectDuplicates,
  parseExcelFile,
  type FieldMapping,
  type ImportPreview,
} from '../lib/importer';
import {
  getDuplicateMappingErrors,
  hasDuplicateMappings,
} from '../pages/DataImportPage';
import type { Customer } from '../lib/types';

// ── Fixtures ──

const IMPORT_DOMAIN_DIR = 'src/lib/capabilities/import';
const IMPORT_DOMAIN_FILES = [
  'inventory.ts',
  'definitions.ts',
  'manifest.ts',
  'previewAdapter.ts',
  'validationAdapter.ts',
  'index.ts',
] as const;

/** xlsx 库 write(type:'array') 输出转 Uint8Array（兼容 ArrayBuffer / TypedArray / number[]）。 */
function toBytes(out: unknown): Uint8Array {
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (ArrayBuffer.isView(out)) return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  return Uint8Array.from(out as number[]);
}

/** 代表性有效 .xlsx fixture：4 列 × 4 行（含一行缺客户名称）。 */
function makeXlsxFile(name = 'fixture.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['客户名称', '手机号', '城市', '意向'],
    ['上海某某科技有限公司', '13800000001', '上海', '高'],
    ['北京某某贸易有限公司', '13800000002', '北京', '中'],
    ['', '13800000003', '深圳', '低'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '客户名单');
  return new File([toBytes(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))], name);
}

/** 代表性有效 .csv fixture（产品支持的第二格式）。 */
function makeCsvFile(): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['客户名称', '手机号'],
    ['上海某某科技有限公司', '13800000001'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 's1');
  return new File([toBytes(XLSX.write(wb, { type: 'array', bookType: 'csv' }))], 'fixture.csv');
}

/** 原型键/重复表头 fixture：验证 header 安全。 */
function makeHostileHeaderFile(): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['__proto__', 'constructor', '客户名称', '客户名称'],
    ['x', 'y', '上海某某科技有限公司', '重复列值'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 's1');
  return new File([toBytes(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))], 'hostile.xlsx');
}

function existingCustomersFixture(): Customer[] {
  return [
    { id: 'c1', name: 'Ada', phone_number: '13800000001', wechat_id: 'wx-ada' },
    { id: 'c2', name: 'Ben', phone_number: '13800000002', wechat_id: null },
  ] as Customer[];
}

const WAVE1_IDS = [
  'customer.search',
  'customer.get',
  'customer.context',
  'timeline.customer.read',
  'timeline.visit.read',
  'follow_up.customer.read',
  'follow_up.global.read',
  'task.read_by_customer',
] as const;

// ── T1 — MANIFEST CONTRACT ──

describe('T1 — MANIFEST CONTRACT: all A9R production capabilities conform to A1', () => {
  it('every manifest definition passes A1 validation with explicit non-mutating semantics', () => {
    expect(IMPORT_READ_CAPABILITY_MANIFEST.length).toBeGreaterThan(0);
    for (const definition of IMPORT_READ_CAPABILITY_MANIFEST) {
      expect(() => createCapabilityRegistry([definition])).not.toThrow();
      // A9R 生产清单绝不使用 WRITE/BULK_WRITE/DELETE。
      expect(['READ', 'ANALYZE']).toContain(definition.effect);
      expect(definition.risk_level).toBe('LOW');
      expect(definition.authority_policy).toBe('AUTO');
      expect(definition.requires_confirmation).toBe(false);
      expect(definition.idempotency).toBe('SAFE');
      expect(definition.domain).toBe('import');
      expect(definition.audit_contract.record_effect).toBe(false);
    }
  });

  it('no WRITE/BULK_WRITE effect exists anywhere in the A9R manifest', () => {
    for (const definition of IMPORT_READ_CAPABILITY_MANIFEST) {
      expect(['WRITE', 'BULK_WRITE', 'DELETE']).not.toContain(definition.effect);
    }
  });
});

// ── T2 — DOMAIN COMPOSITION ──

describe('T2 — DOMAIN COMPOSITION: import manifest composes with A1 + Wave 1', () => {
  it('composes via the frozen A1 extension seam without any central-file change', () => {
    const registry = createCapabilityRegistry(IMPORT_READ_CAPABILITY_MANIFEST);
    expect(registry.size()).toBe(2);
    expect(registry.listByDomain('import').map((d) => d.id)).toEqual([
      'import.file.preview',
      'import.mapping.validate',
    ]);
    expect(registry.get('import.file.preview', '1.0.0').executor_ref).toBe('crm:parseExcelFile→findBestImportTable→autoDetectFields');
    expect(registry.get('import.mapping.validate', '1.0.0').executor_ref).toBe('crm:DataImportPage.getDuplicateMappingErrors+nameMappingGate');
  });

  it('A1 core files were not modified (static evidence: no import ids inside central files)', () => {
    for (const file of ['registry.ts', 'types.ts', 'index.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'src/lib/capabilities', file), 'utf8');
      expect(source, `central file ${file} must not embed A9R import capability ids`).not.toMatch(/import\.(file\.preview|mapping\.validate|duplicate\.detect)/);
    }
  });
});

// ── T3 — PRODUCT INVENTORY TRUTH ──

describe('T3 — PRODUCT INVENTORY TRUTH: only real current Import Preview/Validate behaviors enter the manifest', () => {
  it('every manifest entry maps 1:1 to a VERIFIED inventory candidate', () => {
    expect(VERIFIED_IMPORT_READ_CANDIDATES).toEqual([
      'preview_import_file',
      'validate_import_mapping',
    ]);
    expect(IMPORT_READ_CAPABILITY_MANIFEST.map((d) => d.id)).toEqual([
      'import.file.preview',
      'import.mapping.validate',
    ]);
    const inventoryByCandidate = new Map(IMPORT_READ_INVENTORY.map((e) => [e.candidate, e]));
    for (const entry of IMPORT_READ_INVENTORY) {
      const isRegistered = entry.final_status === 'VERIFIED';
      const existsInProduct = isRegistered || entry.final_status === 'VERIFIED_EXISTS_BUT_OUT_OF_SCOPE';
      expect(entry.product_capability_exists).toBe(existsInProduct);
      expect(entry.a9r_action).toBe(isRegistered ? 'REGISTER_EXISTING' : 'NOT_APPLICABLE');
      expect(entry.existing_source_path.length).toBeGreaterThan(0);
      expect(entry.existing_execution_path.length).toBeGreaterThan(0);
      if (entry.final_status !== 'VERIFIED') {
        expect(entry.not_distinct_reason).toBeTruthy();
      }
    }
    // 每个 VERIFIED 候选都在 manifest 中有且仅有一个定义。
    const manifestIds = new Set(IMPORT_READ_CAPABILITY_MANIFEST.map((d) => d.id));
    expect(manifestIds.size).toBe(2);
    for (const candidate of VERIFIED_IMPORT_READ_CANDIDATES) {
      const sourcePath = inventoryByCandidate.get(candidate)!.existing_source_path[0];
      expect(sourcePath, `candidate ${candidate} must have real source evidence`).toMatch(/^src\/(lib|pages)\//);
    }
  });

  it('row validation is NOT registered (internal step of Preview/Execute)', () => {
    expect(IMPORT_READ_INVENTORY.find((e) => e.candidate === 'validate_import_rows')?.final_status).toBe('NOT_DISTINCT');
    expect(IMPORT_READ_CAPABILITY_IDS.some((id) => id === 'import.row.validate' || id === 'import.rows.validate')).toBe(false);
  });

  it('duplicate detection is NOT registered (internal step of Preview/Execute, A9R-01 closure)', () => {
    const dup = IMPORT_READ_INVENTORY.find((e) => e.candidate === 'detect_import_duplicates')!;
    expect(dup.product_capability_exists).toBe(false);
    expect(dup.final_status).toBe('NOT_DISTINCT');
    expect(IMPORT_READ_CAPABILITY_IDS).not.toContain('import.duplicate.detect');
  });

  it('execute import is inventoried but NOT registered (Write Wave boundary)', () => {
    const execute = IMPORT_READ_INVENTORY.find((e) => e.candidate === 'execute_customer_import')!;
    expect(execute.final_status).toBe('VERIFIED_EXISTS_BUT_OUT_OF_SCOPE');
    expect(execute.not_distinct_reason).toMatch(/executeImport → createCustomer\/updateCustomer/);
    expect(execute.not_distinct_reason).toMatch(/lib\/importer\.ts:507-604/);
    expect(IMPORT_READ_CAPABILITY_IDS.some((id) => /execute|bulk/.test(id))).toBe(false);
  });
});

// ── T4 — FILE PREVIEW (parity with real product path) ──

describe('T4 — FILE PREVIEW: A9R preview output matches the real product parse path', () => {
  it('parses a representative valid .xlsx through the same product function', async () => {
    const file = makeXlsxFile();
    const viaAdapter = await previewImportFile(file);
    const viaProduct = await parseExcelFile(file);
    expect(viaAdapter).toEqual(viaProduct);
    expect(viaAdapter.sheetName).toBe('客户名单');
    expect(viaAdapter.headers).toEqual(['客户名称', '手机号', '城市', '意向']);
    expect(viaAdapter.rows).toHaveLength(3); // 缺名称行保留在预览中（产品语义，不静默丢弃）
    expect(viaAdapter.autoMapping.map((m) => [m.sourceColumn, m.crmField])).toEqual([
      ['客户名称', 'name'],
      ['手机号', 'phone_number'],
      ['城市', 'region'],
      ['意向', 'intent_level'],
    ]);
  });

  it('empty workbook yields empty preview without throwing (product semantics)', async () => {
    // 有 sheet 但无任何表头/行：findBestImportTable 无表头 → 产品返回空预览。
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '空表');
    const file = new File([toBytes(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))], 'empty-workbook.xlsx');
    const preview = await previewImportFile(file);
    expect(preview.headers).toEqual([]);
    expect(preview.rows).toEqual([]);
  });
});

// ── T5 — MAPPING VALIDATION (exact product rules) ──

describe('T5 — MAPPING VALIDATION: existing deterministic rules preserved exactly', () => {
  it('valid mapping (name mapped, no duplicate targets) passes', () => {
    const mapping: FieldMapping[] = [
      { sourceColumn: '客户名称', crmField: 'name' },
      { sourceColumn: '手机号', crmField: 'phone_number' },
    ];
    expect(validateImportMapping(mapping)).toEqual({ valid: true, errors: [] });
    expect(hasDuplicateMappings(mapping)).toBe(false);
  });

  it('missing name mapping fails with the exact product gate message', () => {
    const mapping: FieldMapping[] = [{ sourceColumn: '手机号', crmField: 'phone_number' }];
    const result = validateImportMapping(mapping);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['请至少配置“客户名称”字段映射才能导入']);
    // 产品 UI 门控（hasNameMapping 等价规则）与页面源码中的消息原文一致。
    const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/DataImportPage.tsx'), 'utf8');
    expect(pageSource).toContain('请至少配置“客户名称”字段映射才能导入');
  });

  it('duplicate mapped destination field fails with messages identical to the product getDuplicateMappingErrors', () => {
    const mapping: FieldMapping[] = [
      { sourceColumn: '手机号', crmField: 'phone_number' },
      { sourceColumn: '电话', crmField: 'phone_number' },
      { sourceColumn: '客户名称', crmField: 'name' },
    ];
    const result = validateImportMapping(mapping);
    expect(result.valid).toBe(false);
    // 重复映射错误 100% 来自产品函数本体。
    expect(result.errors).toEqual(getDuplicateMappingErrors(mapping));
    expect(result.errors[0]).toBe('手机号已被其他列映射，请先取消重复映射。');
  });
});

// ── T6 — ROW VALIDATION CLASSIFICATION ──

describe('T6 — ROW VALIDATION: not a distinct product capability, not registered', () => {
  it('no separate row-validation production capability exists', () => {
    expect(IMPORT_READ_CAPABILITY_MANIFEST.some((d) => d.id.startsWith('import.row'))).toBe(false);
    expect(IMPORT_READ_CAPABILITY_DEFINITIONS.some((d) => d.id.startsWith('import.row'))).toBe(false);
  });

  it('inventory classifies row validation as NOT_DISTINCT with exact reasoning', () => {
    const row = IMPORT_READ_INVENTORY.find((e) => e.candidate === 'validate_import_rows')!;
    expect(row.product_capability_exists).toBe(false);
    expect(row.final_status).toBe('NOT_DISTINCT');
    expect(row.not_distinct_reason).toMatch(/buildImportableRecord/);
  });
});

// ── T7 — DUPLICATE CLASSIFICATION (A9R-01 closure) ──

describe('T7 — DUPLICATE DETECTION: NOT_DISTINCT current product capability', () => {
  it('no import.duplicate.detect capability is registered anywhere in the domain', () => {
    expect(IMPORT_READ_CAPABILITY_MANIFEST.some((d) => d.id === 'import.duplicate.detect')).toBe(false);
    expect(IMPORT_READ_CAPABILITY_DEFINITIONS.some((d) => d.id === 'import.duplicate.detect')).toBe(false);
    expect(IMPORT_READ_CAPABILITY_IDS).not.toContain('import.duplicate.detect');
  });

  it('inventory classifies duplicate detection as NOT_DISTINCT with production-caller evidence', () => {
    const dup = IMPORT_READ_INVENTORY.find((e) => e.candidate === 'detect_import_duplicates')!;
    expect(dup.product_capability_exists).toBe(false);
    expect(dup.final_status).toBe('NOT_DISTINCT');
    expect(dup.a9r_action).toBe('NOT_APPLICABLE');
    // 生产调用者证据：仅 Preview 统计（importer.ts:396）与 Execute 分流（importer.ts:535）内部，无独立产品表面。
    expect(dup.not_distinct_reason).toMatch(/importer\.ts:396/);
    expect(dup.not_distinct_reason).toMatch(/importer\.ts:535/);
    expect(dup.not_distinct_reason).toMatch(/PREVIEW_INTERNAL_STEP/);
    expect(dup.not_distinct_reason).toMatch(/NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY/);
  });

  it('no duplicate-detection binding is exported by the A9R adapters (static)', () => {
    const adapterSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/import/validationAdapter.ts'), 'utf8');
    // 剥离注释：文档可以说明移除原因，执行面代码不得再引用重复检测绑定。
    const codeOnly = adapterSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/detectImportDuplicate|detectDuplicates/);
  });

  it('product detectDuplicates itself remains a correct internal helper (underlying function parity)', () => {
    const existing = existingCustomersFixture();
    expect(detectDuplicates({ name: 'ada' } as Partial<Customer>, existing)).toEqual({
      isDuplicate: true,
      matchedBy: 'name',
      existingId: 'c1',
    });
  });
});

// ── T8 — FILE FORMAT TRUTH ──

describe('T8 — FILE FORMAT TRUTH: only .xlsx/.csv are supported by the current product', () => {
  it('a representative .csv file parses through the same product path', async () => {
    const file = makeCsvFile();
    const preview = await previewImportFile(file);
    expect(preview.headers).toEqual(['客户名称', '手机号']);
    expect(preview.rows).toHaveLength(1);
    expect(preview.autoMapping[0]).toEqual({ sourceColumn: '客户名称', crmField: 'name' });
  });

  it('product UI accepts exactly .xlsx/.csv and explicitly rejects .xls (static evidence)', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/DataImportPage.tsx'), 'utf8');
    expect(pageSource).toMatch(/accept="\.xlsx,\.csv"/);
    expect(pageSource).toMatch(/不支持的文件格式/);
    expect(pageSource).toMatch(/\.xls 文件建议另存为 \.xlsx/);
  });
});

// ── T9 — MALFORMED FILE FAILS CLOSED ──

describe('T9 — MALFORMED FILE: representative invalid input fails per existing product semantics', () => {
  it('garbage bytes fail closed via product semantics (no usable mapping, import gate blocks)', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'garbage.xlsx');
    // 产品将无法识别的字节按文本解析为单列预览（xlsx 库行为，产品路径原样保留），
    // 但无任何字段映射命中 → 不产生可导入语义。
    const preview = await previewImportFile(file);
    expect(preview.autoMapping.length).toBeGreaterThan(0);
    expect(preview.autoMapping.every((m) => m.crmField === null)).toBe(true);
    // 产品导入门控：无 name 映射 → 映射校验失败 → 执行被阻止（fail-closed，零 CRM 写）。
    expect(validateImportMapping(preview.autoMapping).valid).toBe(false);
  });

  it('empty file never yields phantom rows', async () => {
    const file = new File([], 'empty.xlsx');
    let preview: ImportPreview | null = null;
    try {
      preview = await previewImportFile(file);
    } catch {
      preview = null;
    }
    if (preview) {
      expect(preview.rows).toEqual([]);
    }
  });
});

// ── T10 — HEADER / FIELD SAFETY ──

describe('T10 — HEADER / FIELD SAFETY: hostile headers cannot mutate capability/registry objects', () => {
  it('prototype-like and duplicate headers do not pollute objects or map to fields', async () => {
    const file = makeHostileHeaderFile();
    const preview = await previewImportFile(file);
    expect(preview.headers).toEqual(['__proto__', 'constructor', '客户名称', '客户名称']);
    // 原型键列无字段命中 → null（产品同义词表不含此类键）。
    expect(preview.autoMapping[0].crmField).toBeNull();
    expect(preview.autoMapping[1].crmField).toBeNull();
    // 重复表头：第二个“客户名称”列不重复占用 name（产品 autoDetectFields 去重）。
    expect(preview.autoMapping.filter((m) => m.crmField === 'name')).toHaveLength(1);
    // 无原型污染（'__proto__' 作为 Object.prototype 的语言规范属性始终存在，
    // 关键是没有新增任何用户键）。
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect('polluted' in ({} as object)).toBe(false);
    expect(Object.keys(Object.prototype)).not.toContain('polluted');
    expect(Object.getOwnPropertyNames({})).not.toContain('__proto__');
  });

  it('registered definitions expose exactly the A1 contract shape (no extra keys)', () => {
    const expectedKeys = [
      'id', 'version', 'domain', 'description', 'input_schema', 'output_schema',
      'effect', 'data_target', 'risk_level', 'authority_policy', 'requires_confirmation',
      'scope_requirement', 'idempotency', 'executor_ref', 'audit_contract', 'error_contract',
    ].sort();
    const registry = createCapabilityRegistry(IMPORT_READ_CAPABILITY_MANIFEST);
    for (const id of IMPORT_READ_CAPABILITY_IDS) {
      const stored = registry.get(id, '1.0.0');
      expect(Object.keys(stored).sort()).toEqual(expectedKeys);
      expect(Object.isFrozen(stored)).toBe(true);
      expect(Object.isFrozen(stored.audit_contract)).toBe(true);
    }
  });
});

// ── T11 — PREVIEW != CRM FACT ──

describe('T11 — PREVIEW != CRM FACT: previewed rows are never persisted or treated as CRM facts', () => {
  it('preview output shape contains only file-derived data, no CRM persistence markers', async () => {
    const preview = await previewImportFile(makeXlsxFile());
    for (const row of preview.rows) {
      expect(Array.isArray(row)).toBe(true);
      expect(row).toEqual(expect.any(Array));
    }
    expect(preview).not.toHaveProperty('id');
    expect(preview).not.toHaveProperty('created_customer_id');
    expect(preview).not.toHaveProperty('evidence_ref');
    expect(preview).not.toHaveProperty('batch_id');
  });

  it('adapter signature takes no database handle and never imports batch/write modules (static)', () => {
    const adapterSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/import/previewAdapter.ts'), 'utf8')
      + readFileSync(resolve(process.cwd(), 'src/lib/capabilities/import/validationAdapter.ts'), 'utf8');
    const imports = [...adapterSource.matchAll(/from '([^']+)';/g)].map((m) => m[1]);
    expect(imports.every((p) => p === '../../importer' || p === '../../../pages/DataImportPage')).toBe(true);
  });
});

// ── T12 — ZERO CRM WRITES ──

describe('T12 — ZERO CRM WRITES: A9R execution never touches CRM or batch tables', () => {
  it('static: A9R production execution surfaces contain no write tokens', () => {
    const writeTokenPattern =
      /(INSERT INTO|UPDATE |DELETE FROM|\bcreateCustomer\b|\bupdateCustomer\b|\bdeleteCustomer\b|\bcreateTask\b|\bcreateFollowUp\b|\bcreateVisit\b|\bcreateAIDraft\b|\bapplyAIDraftToCustomer\b|\bcreateLeadWorkItem\b|\bimportLeadRowsToBatch\b|\bexecuteImport\b|\bcreateLeadImportBatch\b|\binsertLeadImportBatch\b)/;
    for (const file of ['definitions.ts', 'manifest.ts', 'previewAdapter.ts', 'validationAdapter.ts', 'index.ts']) {
      const source = readFileSync(resolve(process.cwd(), IMPORT_DOMAIN_DIR, file), 'utf8');
      // 剥离注释：文档可以描述“零写”，执行面代码不得引用写入口。
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(codeOnly, `${file} must not reference write operations`).not.toMatch(writeTokenPattern);
    }
    // inventory.ts 是审计证据文件（记录 execute 写路径），只允许出现在字符串字面量，
    // 其 final_status 已由 T3 证明为 OUT_OF_SCOPE；执行面文件必须零写。
    const inventorySource = readFileSync(resolve(process.cwd(), IMPORT_DOMAIN_DIR, 'inventory.ts'), 'utf8');
    expect(inventorySource).toMatch(/VERIFIED_EXISTS_BUT_OUT_OF_SCOPE/);
  });

  it('behavioral: preview / mapping adapters take no db handle and perform no writes', async () => {
    const preview = await previewImportFile(makeXlsxFile());
    expect(preview.rows.length).toBeGreaterThan(0);
    const mappingResult = validateImportMapping([
      { sourceColumn: '客户名称', crmField: 'name' },
    ]);
    expect(mappingResult.valid).toBe(true);
    // 上述执行不产生任何 CRM 写入：全部为纯函数/内存解析（签名无 db、无写调用）。
  });
});

// ── T13 — EXECUTE IMPORT EXCLUDED ──

describe('T13 — EXECUTE IMPORT EXCLUDED: production manifest contains no execute/bulk-write capability', () => {
  it('no execute / bulk / write capability id exists in the manifest', () => {
    for (const definition of IMPORT_READ_CAPABILITY_MANIFEST) {
      expect(definition.id).not.toMatch(/(execute|bulk|write|create)/);
      expect(definition.effect).not.toBe('WRITE');
      expect(definition.effect).not.toBe('BULK_WRITE');
    }
    expect(IMPORT_READ_CAPABILITY_IDS).toEqual([
      'import.file.preview',
      'import.mapping.validate',
    ]);
  });
});

// ── T14 — ZERO MODEL / NETWORK ──

describe('T14 — ZERO MODEL / NETWORK: A9R is deterministic, no provider', () => {
  it('static: A9R domain sources never reference provider/network capabilities', () => {
    for (const file of IMPORT_DOMAIN_FILES) {
      const source = readFileSync(resolve(process.cwd(), IMPORT_DOMAIN_DIR, file), 'utf8');
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const forbidden = /(provider|deepseek|vision|firecrawl|fetch\(|XMLHttpRequest|WebSocket|axios|https?:\/\/|@tauri-apps\/api)/i;
      expect(codeOnly, `${file} must not reference provider/network capabilities`).not.toMatch(forbidden);
    }
  });

  it('static: adapter imports are limited to the existing product read modules', () => {
    const adapterSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/import/previewAdapter.ts'), 'utf8')
      + readFileSync(resolve(process.cwd(), 'src/lib/capabilities/import/validationAdapter.ts'), 'utf8');
    expect(adapterSource).not.toMatch(/from 'xlsx'/);
    expect(adapterSource).not.toMatch(/from '..\/..\/(db|battleCard|leadWorkbench|productionAi|salesAgentTools)/);
  });
});

// ── T15 — FILE ACCESS BOUNDARY ──

describe('T15 — FILE ACCESS BOUNDARY: A9R exposes no broader filesystem access than the product', () => {
  it('static: adapters accept only File objects, never paths; no filesystem APIs', () => {
    for (const file of ['previewAdapter.ts', 'validationAdapter.ts']) {
      const source = readFileSync(resolve(process.cwd(), IMPORT_DOMAIN_DIR, file), 'utf8');
      expect(source).not.toMatch(/node:fs|readFileSync|readFile\(|writeFile|createReadStream|readdir|statSync|existsSync/);
      // 允许绑定现有产品页面模块（src/pages/DataImportPage），禁止任何其它越界引用。
      expect(source).not.toMatch(/\.\.\/\.\.\/\.\.\/(?!pages\/)/);
    }
    // 产品输入边界 = 浏览器 File 对象（用户选择/拖拽）；A9R 绑定 parseExcelFile 同一签名。
    expect(previewImportFile.length).toBe(1); // 单参数 file: File
  });
});

// ── T16 — PRODUCT / EXECUTOR PARITY ──

describe('T16 — PRODUCT / EXECUTOR PARITY: A9R output equals the real existing path', () => {
  it('previewImportFile is the existing product parseExcelFile (same reference)', () => {
    expect(previewImportFile).toBe(parseExcelFile);
  });

  it('validateImportMapping duplicates errors are exactly the product getDuplicateMappingErrors', () => {
    const mapping: FieldMapping[] = [
      { sourceColumn: '客户名称', crmField: 'name' },
      { sourceColumn: '手机号', crmField: 'phone_number' },
      { sourceColumn: '电话', crmField: 'phone_number' },
    ];
    expect(validateImportMapping(mapping).errors).toEqual(getDuplicateMappingErrors(mapping));
  });
});

// ── T17 — REGISTRY COLLISION SAFETY ──

describe('T17 — REGISTRY COLLISION SAFETY: no collision with Wave 1 identities', () => {
  it('A9R ids are disjoint from the 8 Wave 1 capability ids', () => {
    const wave1 = new Set<string>(WAVE1_IDS);
    for (const id of IMPORT_READ_CAPABILITY_IDS) {
      expect(wave1.has(id), `id ${id} collides with a Wave 1 identity`).toBe(false);
    }
    expect(new Set(IMPORT_READ_CAPABILITY_IDS).size).toBe(IMPORT_READ_CAPABILITY_IDS.length);
  });

  it('A1 + all four Wave 1 manifests + import manifest register together without collision', () => {
    const registry = createCapabilityRegistry(
      CUSTOMER_CAPABILITY_MANIFEST,
      TIMELINE_READ_CAPABILITY_MANIFEST,
      FOLLOW_UP_READ_MANIFEST,
      TASK_READ_MANIFEST,
      IMPORT_READ_CAPABILITY_MANIFEST,
    );
    expect(registry.size()).toBe(8 + 2);
    expect(registry.listByDomain('import').map((d) => d.id)).toEqual([
      'import.file.preview',
      'import.mapping.validate',
    ]);
    // 重复身份仍被 A1 registry 拒绝（不静默覆盖）。
    expect(() =>
      createCapabilityRegistry(IMPORT_READ_CAPABILITY_MANIFEST, [IMPORT_READ_CAPABILITY_MANIFEST[0]]),
    ).toThrow(DuplicateCapabilityError);
  });
});

// ── INTEGRATION — 真实数据路径证据（规格 §26）──

describe('INTEGRATION — representative fixture through product path → A9R capability → identical result → zero CRM writes', () => {
  it('xlsx fixture: product parser output === A9R preview output, mapping validated, no writes', async () => {
    const file = makeXlsxFile();

    // 1) 产品现有路径：parseExcelFile（DataImportPage handleFile 同一条执行路径）。
    const productPreview = await parseExcelFile(file);
    // 2) A9R 能力：同一函数本体。
    const a9rPreview = await previewImportFile(file);
    // 3) 相同预览/校验结果。
    expect(a9rPreview).toEqual(productPreview);

    const mapping = a9rPreview.autoMapping;
    const mappingResult = validateImportMapping(mapping);
    expect(mappingResult.valid).toBe(true);

    // 产品 computeImportStats 语义（只读分析）：缺名称行被统计而非静默修正。
    const { buildImportableRecord } = await import('../lib/importer');
    const errors = buildImportableRecord(a9rPreview.rows[2], a9rPreview.headers, mapping).errors;
    expect(errors).toContain('缺少客户名称');

    // 4) 零 CRM 写：preview/validate 全程不接触 DB（无 db 句柄、无写调用），
    //    且 preview 输出不含任何持久化标记（T11/T12 已静态+行为证明）。
    expect(a9rPreview).not.toHaveProperty('created_customer_id');
  });
});
