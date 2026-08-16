import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

describe('database module', () => {
  it('getDb function is importable', async () => {
    const { getDb } = await import('../lib/db');
    expect(typeof getDb).toBe('function');
  });

  it('getDbError starts as null', async () => {
    const { getDbError } = await import('../lib/db');
    expect(getDbError()).toBeNull();
  });

  it('createCustomer accepts 26 params (v0.3.0: +9 fields)', async () => {
    const { createCustomer } = await import('../lib/db');
    expect(typeof createCustomer).toBe('function');
    expect(createCustomer.length).toBe(26);
  });

  it('listTasks is usable', async () => {
    const { listTasks } = await import('../lib/db');
    expect(typeof listTasks).toBe('function');
  });

  it('updateCustomer filters unknown fields and still updates allowed customer fields', async () => {
    const { createCustomer, getCustomer, updateCustomer } = await import('../lib/db');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const id = `update-whitelist-${Date.now()}`;

    try {
      await createCustomer(
        id, 'Original name', 'PHONE', null, '13800000000', null, 0, 'C',
        'NOT_ADDED', 'UNKNOWN', null, null, null, 'NOT_PARSED', null, null,
        null, null, null, null, null, null, null, null, null, null,
      );

      await updateCustomer(id, {
        name: 'Updated name',
        stage: 'CONTACTED',
        hacked_field: 'should not reach sql',
      } as never);

      const customer = await getCustomer(id);
      expect(customer?.name).toBe('Updated name');
      expect(customer?.stage).toBe('CONTACTED');
      expect((customer as Record<string, unknown>).hacked_field).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'updateCustomer ignored unknown customer fields',
        ['hacked_field'],
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('Tauri capability allows SQL load/select/execute', () => {
    const raw = readFileSync(new URL('../../src-tauri/capabilities/default.json', import.meta.url), 'utf8');
    const capability = JSON.parse(raw) as { permissions: string[] };

    expect(capability.permissions).toContain('sql:allow-load');
    expect(capability.permissions).toContain('sql:allow-select');
    expect(capability.permissions).toContain('sql:allow-execute');
  });

  it('does not register checksum-based SQL migrations in Tauri runtime', () => {
    const raw = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    expect(raw).not.toContain('add_migrations');
  });

  it('creates base tables from the frontend database layer', async () => {
    const { ensureBaseSchema } = await import('../lib/db');
    const db = {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };

    await ensureBaseSchema(db);

    const executedSql = db.execute.mock.calls.map(([sql]) => String(sql));
    expect(executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS customers'))).toBe(true);
    expect(executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS follow_up_records'))).toBe(true);
    expect(executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS visit_records'))).toBe(true);
    expect(executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS tasks'))).toBe(true);
    expect(executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS settings'))).toBe(true);
  });

  it('adds phone_number column when missing', async () => {
    const { ensureCustomerSchema } = await import('../lib/db');
    const db = {
      select: vi.fn().mockResolvedValue([
        { name: 'id' },
        { name: 'name' },
        { name: 'wechat_id' },
      ]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };

    await ensureCustomerSchema(db);

    expect(db.select).toHaveBeenCalledWith('PRAGMA table_info(customers)');
    expect(db.execute).toHaveBeenCalledWith('ALTER TABLE customers ADD COLUMN phone_number TEXT');
  });

  it('does not alter when all columns exist', async () => {
    const { ensureCustomerSchema } = await import('../lib/db');
    const db = {
      select: vi.fn().mockResolvedValue([
        { name: 'id' }, { name: 'name' }, { name: 'phone_number' },
        { name: 'website' }, { name: 'region' }, { name: 'industry' },
        { name: 'contact_person' }, { name: 'email' }, { name: 'address' },
        { name: 'pitch_angle' }, { name: 'qualification_reason' }, { name: 'source' },
        { name: 'opportunity_amount' },
      ]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };

    await ensureCustomerSchema(db);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('adds v0.3.0 fields when missing', async () => {
    const { ensureCustomerSchema } = await import('../lib/db');
    const db = {
      select: vi.fn().mockResolvedValue([
        { name: 'id' },
        { name: 'name' },
        { name: 'phone_number' },
      ]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };

    await ensureCustomerSchema(db);

    const calls = db.execute.mock.calls.map(([sql]) => String(sql));
    const v030fields = ['website', 'region', 'industry', 'contact_person', 'email',
      'address', 'pitch_angle', 'qualification_reason', 'source'];
    for (const field of v030fields) {
      expect(calls.some(c => c.includes(`ADD COLUMN ${field}`))).toBe(true);
    }
  });

  it('createCustomer INSERT columns = VALUES placeholders = bindings count', async () => {
    const src = readFileSync(new URL('../../src/lib/db.ts', import.meta.url), 'utf8');

    // 提取 createCustomer 函数体
    const fnStart = src.indexOf('export async function createCustomer(');
    const fnEnd = src.indexOf('export async function listCustomers', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);

    // 提取 INSERT 列名：从 `INSERT INTO customers (` 到 `) VALUES`
    const colMatch = fnBody.match(/INSERT INTO customers \(([\s\S]*?)\)\s*VALUES/);
    if (!colMatch) throw new Error('Could not parse INSERT columns');
    const columns = colMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean);

    // 提取 VALUES 中的 ? 占位符：从 `VALUES (` 到对应的 `)`，
    // 然后数 `?` 的数量
    const afterValues = fnBody.slice(fnBody.indexOf('VALUES ('));
    const parenEnd = afterValues.indexOf(')`');
    const valuesClause = afterValues.slice(0, parenEnd + 1);
    const placeholderCount = (valuesClause.match(/\?/g) || []).length;

    // 提取 bindings 数组：从 SQL 字符串后的 `,\n    [` 到 `],\n  );`
    // 先找到 VALUES 行之后的第一个 `[`（在下一行）
    const afterSql = fnBody.slice(fnBody.indexOf('VALUES (') + 100);
    const bindingsStart = afterSql.indexOf('[');
    const bindingsSection = afterSql.slice(bindingsStart);
    // 找到匹配的 `]`（这个 ] 后紧跟 `,` 然后是 `);`）
    let bracketDepth = 0;
    let bindingsEnd = -1;
    for (let i = 0; i < bindingsSection.length; i++) {
      if (bindingsSection[i] === '[') bracketDepth++;
      else if (bindingsSection[i] === ']') {
        bracketDepth--;
        if (bracketDepth === 0) {
          bindingsEnd = i;
          break;
        }
      }
    }
    const bindingsRaw = bindingsSection.slice(1, bindingsEnd);
    // 按顶层逗号拆分
    const bindings: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of bindingsRaw) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) {
        bindings.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) bindings.push(current.trim());

    expect(columns.length).toBe(placeholderCount);
    expect(placeholderCount).toBe(bindings.length);
    expect(columns.length).toBe(bindings.length);
  });

  // ── v0.4.0 ai_drafts tests ──

  it('ai_drafts table exists in schema', async () => {
    const { ensureBaseSchema } = await import('../lib/db');
    const db = {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };

    await ensureBaseSchema(db);

    const executedSql = db.execute.mock.calls.map(([sql]) => String(sql));
    expect(executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS ai_drafts'))).toBe(true);
  });

  it('createAIDraft and getAIDraft work', async () => {
    const { createAIDraft, getAIDraft } = await import('../lib/db');
    const draft = await createAIDraft({
      source_type: 'SCREENSHOT',
      customer_id: 'customer-1',
      raw_input_summary: '测试截图识别',
      ai_result_json: JSON.stringify({ customer_name: '张三', confidence: 0.85 }),
      confidence: 0.85,
    });

    expect(draft.id).toBeDefined();
    expect(draft.status).toBe('DRAFT');
    expect(draft.source_type).toBe('SCREENSHOT');

    const fetched = await getAIDraft(draft.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.customer_id).toBe('customer-1');
    expect(fetched!.confidence).toBe(0.85);
  });

  it('listAIDrafts filters by customerId', async () => {
    const { createAIDraft, listAIDrafts } = await import('../lib/db');
    await createAIDraft({
      source_type: 'CALL_TEXT',
      customer_id: 'customer-a',
      raw_input_summary: '通话A',
      ai_result_json: '{}',
      confidence: 0.7,
    });
    await createAIDraft({
      source_type: 'CALL_TEXT',
      customer_id: 'customer-b',
      raw_input_summary: '通话B',
      ai_result_json: '{}',
      confidence: 0.8,
    });

    const aDrafts = await listAIDrafts('customer-a');
    expect(aDrafts.every(d => d.customer_id === 'customer-a')).toBe(true);
  });

  it('applyAIDraftToCustomer writes customer and marks APPLIED', async () => {
    const { createAIDraft, getAIDraft, applyAIDraftToCustomer } = await import('../lib/db');

    const draft = await createAIDraft({
      source_type: 'SCREENSHOT',
      customer_id: null,
      raw_input_summary: '新客户截图',
      ai_result_json: JSON.stringify({
        customer_name: '李四',
        wechat_id: 'lisi_wx',
        intent_level: 'HIGH',
        grade_suggestion: 'B',
        follow_up_result: 'POSITIVE',
        summary: '客户对产品很满意',
        confidence: 0.82,
      }),
      confidence: 0.82,
    });

    const result = await applyAIDraftToCustomer(draft.id);
    expect(result.customer).not.toBeNull();
    expect(result.customer.name).toBe('李四');
    expect(result.followUpRecord).toBeDefined();

    const updated = await getAIDraft(draft.id);
    expect(updated!.status).toBe('APPLIED');
    expect(updated!.applied_at).toBeDefined();
  });

  it('applyAIDraftToCustomer rejects already APPLIED draft', async () => {
    const { createAIDraft, applyAIDraftToCustomer } = await import('../lib/db');

    const draft = await createAIDraft({
      source_type: 'CALL_TEXT',
      customer_id: 'customer-c',
      raw_input_summary: '通话',
      ai_result_json: JSON.stringify({ summary: 'test', confidence: 0.9 }),
      confidence: 0.9,
    });

    await applyAIDraftToCustomer(draft.id);
    await expect(applyAIDraftToCustomer(draft.id)).rejects.toThrow('无法应用');
  });

  it('discardAIDraft marks draft as DISCARDED', async () => {
    const { createAIDraft, getAIDraft, discardAIDraft } = await import('../lib/db');

    const draft = await createAIDraft({
      source_type: 'MANUAL',
      customer_id: null,
      raw_input_summary: '手动草稿',
      ai_result_json: '{}',
      confidence: 0.5,
    });

    await discardAIDraft(draft.id);
    const updated = await getAIDraft(draft.id);
    expect(updated!.status).toBe('DISCARDED');
  });

  it('discardAIDraft rejects already APPLIED draft', async () => {
    const { createAIDraft, applyAIDraftToCustomer, discardAIDraft } = await import('../lib/db');

    const draft = await createAIDraft({
      source_type: 'CALL_TEXT',
      customer_id: null,
      raw_input_summary: '通话',
      ai_result_json: JSON.stringify({ summary: 'test', confidence: 0.9 }),
      confidence: 0.9,
    });
    await applyAIDraftToCustomer(draft.id);
    await expect(discardAIDraft(draft.id)).rejects.toThrow('无法丢弃');
  });

  // ── P1 Bug: MANUAL deepseek_next_action 草稿应用 ──

  it('MANUAL deepseek_next_action 草稿应用后不修改客户字段', async () => {
    const { createAIDraft, applyAIDraftToCustomer, getCustomer } = await import('../lib/db');

    // 先有一个客户
    const { createCustomer } = await import('../lib/db');
    const cid = 'manual-test-cust';
    await createCustomer(
      cid, '测试客户', 'PHONE', null, '13800000001', null, 0, 'B',
      'NOT_ADDED', 'MEDIUM', 'CAN_LEARN', null, null, 'NOT_PARSED', null, null,
      null, null, null, null, null, null, null, null, null, null,
    );

    const draft = await createAIDraft({
      source_type: 'MANUAL',
      customer_id: cid,
      raw_input_summary: '跟进建议: 测试客户',
      ai_result_json: JSON.stringify({
        suggestion: '建议下周安排面访，客户对价格方案有兴趣',
        rawResponse: '建议下周安排面访，客户对价格方案有兴趣',
        source: 'deepseek_next_action',
        created_from: 'customer_detail',
      }),
      confidence: 0.7,
    });

    const result = await applyAIDraftToCustomer(draft.id);

    // 验证 followUpRecord
    expect(result.followUpRecord).toBeDefined();
    expect(result.followUpRecord!.title).toBe('AI 跟进建议');
    expect(result.followUpRecord!.feedback_notes).toContain('面访');
    expect(result.followUpRecord!.contact_channel).toBeNull();

    // 验证客户字段未被修改
    const customer = await getCustomer(cid);
    expect(customer!.intent_level).toBe('MEDIUM');
    expect(customer!.phone_feedback).toBe('CAN_LEARN');
    expect(customer!.customer_grade).toBe('B');

    // 验证草稿状态
    const { getAIDraft } = await import('../lib/db');
    const updated = await getAIDraft(draft.id);
    expect(updated!.status).toBe('APPLIED');
  });

  it('MANUAL deepseek_next_action 草稿无 customer_id 时抛错', async () => {
    const { createAIDraft, applyAIDraftToCustomer } = await import('../lib/db');

    const draft = await createAIDraft({
      source_type: 'MANUAL',
      customer_id: null,
      raw_input_summary: '跟进建议: 无客户',
      ai_result_json: JSON.stringify({
        suggestion: '建议触达',
        source: 'deepseek_next_action',
      }),
      confidence: 0.7,
    });

    await expect(applyAIDraftToCustomer(draft.id)).rejects.toThrow('关联客户');

    // 草稿仍为 DRAFT
    const { getAIDraft } = await import('../lib/db');
    const stillDraft = await getAIDraft(draft.id);
    expect(stillDraft!.status).toBe('DRAFT');
  });

  it('CALL_TEXT 草稿原逻辑仍可用', async () => {
    const { createAIDraft, applyAIDraftToCustomer } = await import('../lib/db');

    const draft = await createAIDraft({
      source_type: 'CALL_TEXT',
      customer_id: null,
      raw_input_summary: '通话文本分析: 客户有兴趣',
      ai_result_json: JSON.stringify({
        summary: '客户对产品有兴趣',
        phone_feedback: 'INTERESTED',
        intent_level: 'HIGH',
        grade_suggestion: 'A',
        next_action: '约访',
        next_follow_up_text: '明天下午',
        risk: '',
        confidence: 0.78,
      }),
      confidence: 0.78,
    });

    const result = await applyAIDraftToCustomer(draft.id);
    expect(result.customer).toBeDefined();
    expect(result.followUpRecord).toBeDefined();

    const { getAIDraft } = await import('../lib/db');
    const updated = await getAIDraft(draft.id);
    expect(updated!.status).toBe('APPLIED');
  });
});
