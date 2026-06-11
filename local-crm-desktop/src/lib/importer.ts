import type { Customer, WechatSearchStatus, WechatAddStatus, IntentLevel, CustomerGrade, PhoneFeedback } from './types';
import { v4 as uuidv4 } from 'uuid';
import { parseRoughTime } from './timeParser';
import { calculateNextFollowUpAt } from './rules';
import { createCustomer, updateCustomer } from './db';

// ── Types ──

export type ImportableCrmField =
  | 'name' | 'customer_grade' | 'wechat_id' | 'phone_number' | 'is_key_decision_maker'
  | 'wechat_search_status' | 'wechat_add_status' | 'intent_level'
  | 'phone_feedback' | 'next_follow_up_at'
  | 'website' | 'region' | 'industry'
  | 'contact_person' | 'email' | 'address'
  | 'pitch_angle' | 'qualification_reason' | 'source'
  | 'notes';

export interface FieldMapping {
  sourceColumn: string;
  crmField: ImportableCrmField | null;
}

export type DuplicateMode = 'skip' | 'update' | 'always_add';

export interface ImportPreview {
  sheetName?: string;
  headers: string[];
  rows: string[][];
  autoMapping: FieldMapping[];
}

export interface ImportStats {
  totalRows: number;
  importableRows: number;
  missingNameRows: number;
  possibleDuplicates: number;
}

export interface ImportFailure {
  row: number;
  reason: string;
  rawData: Record<string, string>;
}

export interface ImportResult {
  success: number;
  skipped: number;
  updated: number;
  failed: number;
  failures: ImportFailure[];
}

// ── Field synonym map ──

export const FIELD_SYNONYMS: Record<ImportableCrmField, string[]> = {
  name: ['客户名称', '客户名', '姓名', '名称', '客户', '公司名称', '公司'],
  customer_grade: ['客户等级', '等级', '客户分层', 'A1-A3等级', 'A1A3等级', '原始等级/分数', '优先级'],
  wechat_id: ['微信', '微信号', '微信ID', '微信账号', 'wx', 'wechat'],
  phone_number: ['手机', '手机号', '手机/电话', '电话/手机', '电话', '联系电话', 'phone', 'mobile'],
  is_key_decision_maker: ['是否关键KP', '关键KP', 'KP', '决策人', '关键人', '是否决策人'],
  wechat_search_status: ['微信搜索状态', '是否搜到', '搜索状态', '账号状态'],
  wechat_add_status: ['微信添加状态', '添加状态', '是否添加', '是否通过', '微信是否通过'],
  intent_level: ['意向', '意向度', '客户意向', '意向等级'],
  phone_feedback: ['电话反馈', '沟通反馈', '反馈', '电话结果'],
  next_follow_up_at: ['下次跟进', '下次跟进时间', '约访时间', '面访时间', '跟进时间'],
  website: ['官网', '域名', '网站'],
  region: ['城市/区域', '城市', '区域'],
  industry: ['行业/产品', '行业'],
  contact_person: ['联系人'],
  email: ['邮箱'],
  address: ['地址'],
  pitch_angle: ['推荐切入点'],
  qualification_reason: ['判断原因'],
  source: ['来源文件', '来源Sheet', '来源行', '来源'],
  notes: [
    '备注', '备注/风险', '跟进备注', '说明', '记录', '跟进内容', '客户情况',
    '风险/待补信息', '下一步动作', '原始信息摘要', '首句方向',
  ],
};

// ── Data cleaning ──

export function cleanValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function mapToBoolean(value: string): number {
  const normalized = value.trim().toLowerCase();
  const truthy = ['是', '有', '关键', '决策人', '1', 'true', 'y', 'yes'];
  if (truthy.includes(normalized)) return 1;
  return 0;
}

export function mapToIntent(value: string): IntentLevel {
  const v = value.trim();
  const high = ['高', '高意向', 'a', 'high', '强'];
  const medium = ['中', '中意向', 'b', 'medium', '一般'];
  const low = ['低', '低意向', 'c', 'low', '弱'];
  const none = ['无', '不需要', '没意向', 'd', 'none'];

  const lower = v.toLowerCase();
  if (high.some(k => v === k || lower === k.toLowerCase())) return 'HIGH';
  if (medium.some(k => v === k || lower === k.toLowerCase())) return 'MEDIUM';
  if (low.some(k => v === k || lower === k.toLowerCase())) return 'LOW';
  if (none.some(k => v === k || lower === k.toLowerCase())) return 'NONE';
  return 'UNKNOWN';
}

export function mapToCustomerGrade(value: string): CustomerGrade {
  const normalized = value.trim().toUpperCase();
  if (normalized.startsWith('A1') || normalized === 'A') return 'A';
  if (normalized.startsWith('A2') || normalized === 'B') return 'B';
  if (normalized.startsWith('A3') || normalized === 'C') return 'C';
  if (normalized.includes('暂缓') || normalized.includes('剔除') || normalized === 'D') return 'D';
  return 'C';
}

export function mapToWechatAddStatus(value: string): WechatAddStatus {
  const v = value.trim();
  if (v === '已通过' || v === '通过') return 'PASSED';
  if (v === '已添加' || v === '添加') return 'ADDED';
  if (v === '未添加') return 'NOT_ADDED';
  if (v === '拒绝' || v === '被拒') return 'REJECTED';
  if (v === '无响应' || v === '没回') return 'NO_RESPONSE';
  return undefined as unknown as WechatAddStatus;
}

export function mapToWechatSearchStatus(value: string): WechatSearchStatus {
  const v = value.trim();
  if (v === '正常' || v === '搜到' || v === '可搜到') return 'FOUND';
  if (v === '搜不到' || v === '找不到') return 'NOT_FOUND';
  if (v === '异常' || v === '封号' || v === '账号异常') return 'ABNORMAL';
  if (v === '不确定' || v === '未知') return 'UNCERTAIN';
  return undefined as unknown as WechatSearchStatus;
}

// ── Field detection ──

export function detectCrmField(header: string): ImportableCrmField | null {
  if (!header || !header.trim()) return null;
  const h = header.trim().toLowerCase();

  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    if (synonyms.some(s => s.toLowerCase() === h)) {
      return field as ImportableCrmField;
    }
  }
  return null;
}

export function autoDetectFields(headers: string[]): FieldMapping[] {
  const usedFields = new Set<ImportableCrmField>();

  return headers.map(h => {
    const field = detectCrmField(h);
    if (field === 'notes') {
      return { sourceColumn: h, crmField: field };
    }
    if (field && !usedFields.has(field)) {
      usedFields.add(field);
      return { sourceColumn: h, crmField: field };
    }
    return { sourceColumn: h, crmField: null };
  });
}

function tableScore(headers: string[]): number {
  const mapping = autoDetectFields(headers);
  const fields = mapping.map(m => m.crmField).filter(Boolean);
  const hasName = fields.includes('name');

  return fields.length + (hasName ? 3 : 0);
}

export function findBestImportTable(sheets: Record<string, string[][]>): ImportPreview & { sheetName: string } {
  let best = {
    sheetName: '',
    headerIndex: 0,
    score: -1,
    headers: [] as string[],
    rows: [] as string[][],
  };

  for (const [sheetName, data] of Object.entries(sheets)) {
    const maxHeaderRows = Math.min(data.length, 20);

    for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex++) {
      const headers = (data[rowIndex] || []).map(h => String(h ?? ''));
      const rows = data.slice(rowIndex + 1);
      const nonEmptyRows = rows.filter(row => row.some(cell => String(cell ?? '').trim().length > 0)).length;
      const mergedSheetBonus = /合并|去重|总表|全部/.test(sheetName) ? 1000 : 0;
      const score = tableScore(headers) * 100 + Math.min(nonEmptyRows, 999) + mergedSheetBonus;

      if (score > best.score) {
        best = {
          sheetName,
          headerIndex: rowIndex,
          score,
          headers,
          rows,
        };
      }
    }
  }

  const rows = best.rows
    .map(row => row.map(cell => String(cell ?? '')))
    .filter(row => row.some(cell => String(cell ?? '').trim().length > 0));

  return {
    sheetName: best.sheetName,
    headers: best.headers,
    rows,
    autoMapping: autoDetectFields(best.headers),
  };
}

// ── Record building ──

function valueByHeader(row: string[], headers: string[], sourceColumn: string): string {
  const idx = headers.indexOf(sourceColumn);
  if (idx === -1 || idx >= row.length) return '';
  return String(row[idx] ?? '');
}

export function buildImportableRecord(
  row: string[],
  headers: string[],
  mapping: FieldMapping[],
): { record: Partial<Customer>; errors: string[] } {
  const record: Partial<Customer> = {};
  const errors: string[] = [];
  const mappedNoteCount = mapping.filter(m => m.crmField === 'notes').length;
  const noteParts: string[] = [];

  for (const m of mapping) {
    if (!m.crmField) continue;

    const raw = valueByHeader(row, headers, m.sourceColumn);
    const cleaned = cleanValue(raw);

    switch (m.crmField) {
      case 'name':
        if (!cleaned) {
          errors.push('缺少客户名称');
          record.name = null as unknown as string;
        } else {
          record.name = cleaned;
        }
        break;
      case 'customer_grade':
        record.customer_grade = cleaned ? mapToCustomerGrade(cleaned) : undefined;
        break;
      case 'wechat_id':
        record.wechat_id = cleaned;
        break;
      case 'phone_number':
        record.phone_number = cleaned;
        break;
      case 'is_key_decision_maker':
        record.is_key_decision_maker = cleaned ? mapToBoolean(cleaned) : 0;
        break;
      case 'wechat_search_status':
        record.wechat_search_status = cleaned ? mapToWechatSearchStatus(cleaned) : undefined;
        break;
      case 'wechat_add_status':
        record.wechat_add_status = cleaned ? mapToWechatAddStatus(cleaned) : undefined;
        break;
      case 'intent_level':
        record.intent_level = cleaned ? mapToIntent(cleaned) : 'UNKNOWN';
        break;
      case 'phone_feedback':
        record.phone_feedback = (cleaned || undefined) as PhoneFeedback | null | undefined;
        break;
      case 'next_follow_up_at':
        record.next_follow_up_at = cleaned || undefined;
        break;
      case 'website':
        record.website = cleaned;
        break;
      case 'region':
        record.region = cleaned;
        break;
      case 'industry':
        record.industry = cleaned;
        break;
      case 'contact_person':
        record.contact_person = cleaned;
        break;
      case 'email':
        record.email = cleaned;
        break;
      case 'address':
        record.address = cleaned;
        break;
      case 'pitch_angle':
        record.pitch_angle = cleaned;
        break;
      case 'qualification_reason':
        record.qualification_reason = cleaned;
        break;
      case 'source':
        record.source = cleaned;
        break;
      case 'notes':
        if (cleaned) {
          noteParts.push(mappedNoteCount > 1 ? `${m.sourceColumn}: ${cleaned}` : cleaned);
        }
        break;
    }
  }

  if (noteParts.length > 0) {
    record.notes = noteParts.join('\n');
  } else if (mappedNoteCount > 0) {
    record.notes = null;
  }

  return { record, errors };
}

// ── Duplicate detection ──

export function detectDuplicates(
  record: Partial<Customer>,
  existingCustomers: Customer[],
): { isDuplicate: boolean; matchedBy: string | null; existingId: string | null } {
  if (!existingCustomers.length) {
    return { isDuplicate: false, matchedBy: null, existingId: null };
  }

  // Priority: wechat_id > phone_number > name
  if (record.wechat_id) {
    const match = existingCustomers.find(
      c => c.wechat_id && c.wechat_id.toLowerCase() === record.wechat_id!.toLowerCase(),
    );
    if (match) return { isDuplicate: true, matchedBy: 'wechat_id', existingId: match.id };
  }

  if (record.phone_number) {
    const match = existingCustomers.find(
      c => c.phone_number && c.phone_number === record.phone_number,
    );
    if (match) return { isDuplicate: true, matchedBy: 'phone_number', existingId: match.id };
  }

  if (record.name) {
    const match = existingCustomers.find(
      c => c.name.toLowerCase() === record.name!.toLowerCase(),
    );
    if (match) return { isDuplicate: true, matchedBy: 'name', existingId: match.id };
  }

  return { isDuplicate: false, matchedBy: null, existingId: null };
}

// ── Stats ──

export function computeImportStats(
  rows: string[][],
  headers: string[],
  mapping: FieldMapping[],
  existingCustomers: Customer[],
): ImportStats {
  let missingNameRows = 0;
  let possibleDuplicates = 0;

  for (const row of rows) {
    const { record, errors } = buildImportableRecord(row, headers, mapping);
    if (errors.some(e => e === '缺少客户名称')) {
      missingNameRows++;
    }
    const dup = detectDuplicates(record, existingCustomers);
    if (dup.isDuplicate) {
      possibleDuplicates++;
    }
  }

  return {
    totalRows: rows.length,
    importableRows: rows.length - missingNameRows,
    missingNameRows,
    possibleDuplicates,
  };
}

// ── Import business rules ──

export function applyImportBusinessRules(record: Partial<Customer>): Partial<Customer> {
  const result = { ...record };

  // Grade calculation: only auto-calculate if not already provided by import
  if (!result.customer_grade) {
    if (
      result.wechat_search_status === 'NOT_FOUND' ||
      result.wechat_search_status === 'ABNORMAL'
    ) {
      result.customer_grade = 'D';
    } else if (
      result.phone_feedback === 'CAN_MEET' ||
      result.phone_feedback === 'INTERESTED' ||
      result.intent_level === 'HIGH'
    ) {
      result.customer_grade = 'A';
    } else if (result.is_key_decision_maker === 1) {
      result.customer_grade = 'B';
    } else {
      result.customer_grade = 'C';
    }
  }

  // Parse rough time if provided
  if (result.rough_visit_time_text) {
    const parsed = parseRoughTime(result.rough_visit_time_text);
    result.parsed_visit_reminder_at = parsed.parsed_at;
    result.time_parse_status = parsed.status;
    result.time_parse_note = parsed.note;
  }

  // Calculate next follow-up based on grade
  result.next_follow_up_at = calculateNextFollowUpAt(result.customer_grade as CustomerGrade);

  return result;
}

// ── Export failures ──

export function exportFailuresAsCSV(failures: ImportFailure[]): string {
  const header = '行号,失败原因,原始数据';
  if (failures.length === 0) return header;

  const rows = failures.map(f => {
    const rawStr = Object.entries(f.rawData)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    const escapedReason = f.reason.includes(',') || f.reason.includes('"')
      ? `"${f.reason.replace(/"/g, '""')}"`
      : f.reason;
    const escapedRaw = rawStr.includes(',') || rawStr.includes('"')
      ? `"${rawStr.replace(/"/g, '""')}"`
      : rawStr;
    return `${f.row},${escapedReason},${escapedRaw}`;
  });

  return [header, ...rows].join('\n');
}

// ── File parsing ──

export async function parseExcelFile(file: File): Promise<ImportPreview> {
  // Dynamic import to avoid build-time issues
  const XLSX = await import('xlsx');

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  if (workbook.SheetNames.length === 0) {
    return { headers: [], rows: [], autoMapping: [] };
  }

  const sheets = Object.fromEntries(
    workbook.SheetNames.map(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
      const rows = data.map(row => (row as unknown[]).map(cell => String(cell ?? '')));
      return [sheetName, rows];
    }),
  );
  const table = findBestImportTable(sheets);

  if (table.headers.length === 0) {
    return { headers: [], rows: [], autoMapping: [] };
  }

  return {
    sheetName: table.sheetName,
    headers: table.headers,
    rows: table.rows,
    autoMapping: table.autoMapping,
  };
}

// ── Import execution ──

export async function executeImport(
  rows: string[][],
  headers: string[],
  mapping: FieldMapping[],
  mode: DuplicateMode,
  existingCustomers: Customer[],
): Promise<ImportResult> {
  const result: ImportResult = {
    success: 0,
    skipped: 0,
    updated: 0,
    failed: 0,
    failures: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const { record, errors } = buildImportableRecord(rows[i], headers, mapping);

    if (errors.length > 0) {
      result.failed++;
      result.failures.push({
        row: i + 1,
        reason: errors.join('; '),
        rawData: Object.fromEntries(headers.map((h, j) => [h, rows[i][j] ?? ''])),
      });
      continue;
    }

    const dup = detectDuplicates(record, existingCustomers);

    if (dup.isDuplicate) {
      if (mode === 'skip') {
        result.skipped++;
        continue;
      }
      if (mode === 'update' && dup.existingId) {
        const processed = applyImportBusinessRules(record);
        try {
          await updateCustomer(dup.existingId, processed);
          result.updated++;
        } catch {
          result.failed++;
          result.failures.push({
            row: i + 1,
            reason: '更新失败',
            rawData: Object.fromEntries(headers.map((h, j) => [h, rows[i][j] ?? ''])),
          });
        }
        continue;
      }
    }

    // Create new customer
    const processed = applyImportBusinessRules(record);
    const id = uuidv4();

    try {
      await createCustomer(
        id,
        processed.name || '未命名',
        null,
        processed.wechat_id || null,
        processed.phone_number || null,
        processed.wechat_search_status || null,
        processed.is_key_decision_maker || 0,
        processed.customer_grade || 'C',
        processed.wechat_add_status || 'NOT_ADDED',
        processed.intent_level || 'UNKNOWN',
        processed.phone_feedback || null,
        processed.rough_visit_time_text || null,
        processed.parsed_visit_reminder_at || null,
        processed.time_parse_status || 'NOT_PARSED',
        processed.time_parse_note || null,
        processed.next_follow_up_at || null,
        processed.notes || null,
        processed.website || null,
        processed.region || null,
        processed.industry || null,
        processed.contact_person || null,
        processed.email || null,
        processed.address || null,
        processed.pitch_angle || null,
        processed.qualification_reason || null,
        processed.source || null,
      );
      result.success++;
    } catch {
      result.failed++;
      result.failures.push({
        row: i + 1,
        reason: '创建失败',
        rawData: Object.fromEntries(headers.map((h, j) => [h, rows[i][j] ?? ''])),
      });
    }
  }

  return result;
}
