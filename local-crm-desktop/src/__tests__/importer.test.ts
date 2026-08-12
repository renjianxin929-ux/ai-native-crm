import { describe, it, expect } from 'vitest';
import {
  cleanValue,
  mapToBoolean,
  mapToIntent,
  mapToWechatAddStatus,
  mapToWechatSearchStatus,
  detectCrmField,
  autoDetectFields,
  findBestImportTable,
  buildImportableRecord,
  detectDuplicates,
  computeImportStats,
  applyImportBusinessRules,
  exportFailuresAsCSV,
} from '../lib/importer';
import type { FieldMapping } from '../lib/importer';
import type { Customer } from '../lib/types';

// ── Helper ──

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    name: '测试客户',
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    contact_method: null,
    wechat_id: null,
    phone_number: null,
    website: null,
    region: null,
    industry: null,
    contact_person: null,
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    source: null,
    wechat_search_status: null,    is_key_decision_maker: 0,
    wechat_add_status: 'NOT_ADDED',
    has_replied: 0,
    intent_level: 'UNKNOWN',
    phone_feedback: null,
    can_schedule_visit: 0,
    visit_scheduled_at: null,
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: null,
    last_contacted_at: null,
    last_feedback_type: 'UNKNOWN',
    next_action: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    paid_at: null,
    closed_at: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// Suite 1: cleanValue
// ═══════════════════════════════════════════

describe('cleanValue', () => {
  it('trim 前后空格', () => {
    expect(cleanValue('  张三  ')).toBe('张三');
  });

  it('空字符串返回 null', () => {
    expect(cleanValue('')).toBeNull();
  });

  it('纯空格字符串返回 null', () => {
    expect(cleanValue('   ')).toBeNull();
  });

  it('normal value preserved', () => {
    expect(cleanValue('正常值')).toBe('正常值');
  });

  it('数字转为字符串', () => {
    expect(cleanValue(123)).toBe('123');
  });

  it('null 返回 null', () => {
    expect(cleanValue(null)).toBeNull();
  });

  it('undefined 返回 null', () => {
    expect(cleanValue(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Suite 2: mapToBoolean
// ═══════════════════════════════════════════

describe('mapToBoolean', () => {
  it.each(['是', '有', '关键', '决策人'])('%s → 1', (v) => {
    expect(mapToBoolean(v)).toBe(1);
  });

  it.each(['1', 'true', 'TRUE', 'y', 'Y', 'yes', 'YES'])('%s → 1', (v) => {
    expect(mapToBoolean(v)).toBe(1);
  });

  it.each(['否', '无'])('%s → 0', (v) => {
    expect(mapToBoolean(v)).toBe(0);
  });

  it.each(['0', 'false', 'FALSE', 'n', 'N', 'no', 'NO'])('%s → 0', (v) => {
    expect(mapToBoolean(v)).toBe(0);
  });

  it('空字符串返回 0', () => {
    expect(mapToBoolean('')).toBe(0);
  });

  it('未知值返回 0', () => {
    expect(mapToBoolean('不知道')).toBe(0);
  });
});

// ═══════════════════════════════════════════
// Suite 3: mapToIntent
// ═══════════════════════════════════════════

describe('mapToIntent', () => {
  it.each(['高', '高意向', 'A', 'a', '强'])('%s → HIGH', (v) => {
    expect(mapToIntent(v)).toBe('HIGH');
  });

  it.each(['中', '中意向', 'B', 'b', '一般'])('%s → MEDIUM', (v) => {
    expect(mapToIntent(v)).toBe('MEDIUM');
  });

  it.each(['低', '低意向', 'C', 'c', '弱'])('%s → LOW', (v) => {
    expect(mapToIntent(v)).toBe('LOW');
  });

  it.each(['无', '不需要', '没意向', 'D', 'd'])('%s → NONE', (v) => {
    expect(mapToIntent(v)).toBe('NONE');
  });

  it('未识别值返回 UNKNOWN', () => {
    expect(mapToIntent('随便')).toBe('UNKNOWN');
  });

  it('空字符串返回 UNKNOWN', () => {
    expect(mapToIntent('')).toBe('UNKNOWN');
  });

  it('大小写不敏感', () => {
    expect(mapToIntent(' HIGH ')).toBe('HIGH');
  });
});

// ═══════════════════════════════════════════
// Suite 4: mapToWechatAddStatus
// ═══════════════════════════════════════════

describe('mapToWechatAddStatus', () => {
  it.each(['已通过', '通过'])('%s → PASSED', (v) => {
    expect(mapToWechatAddStatus(v)).toBe('PASSED');
  });

  it.each(['已添加', '添加'])('%s → ADDED', (v) => {
    expect(mapToWechatAddStatus(v)).toBe('ADDED');
  });

  it('未添加 → NOT_ADDED', () => {
    expect(mapToWechatAddStatus('未添加')).toBe('NOT_ADDED');
  });

  it.each(['拒绝', '被拒'])('%s → REJECTED', (v) => {
    expect(mapToWechatAddStatus(v)).toBe('REJECTED');
  });

  it.each(['无响应', '没回'])('%s → NO_RESPONSE', (v) => {
    expect(mapToWechatAddStatus(v)).toBe('NO_RESPONSE');
  });

  it('未识别返回 undefined，保持原值逻辑在外层处理', () => {
    // 未识别时返回 undefined，调用方决定回退策略
    expect(mapToWechatAddStatus('不认识的状态')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// Suite 5: mapToWechatSearchStatus
// ═══════════════════════════════════════════

describe('mapToWechatSearchStatus', () => {
  it.each(['正常', '搜到', '可搜到'])('%s → FOUND', (v) => {
    expect(mapToWechatSearchStatus(v)).toBe('FOUND');
  });

  it.each(['搜不到', '找不到'])('%s → NOT_FOUND', (v) => {
    expect(mapToWechatSearchStatus(v)).toBe('NOT_FOUND');
  });

  it.each(['异常', '封号', '账号异常'])('%s → ABNORMAL', (v) => {
    expect(mapToWechatSearchStatus(v)).toBe('ABNORMAL');
  });

  it.each(['不确定', '未知'])('%s → UNCERTAIN', (v) => {
    expect(mapToWechatSearchStatus(v)).toBe('UNCERTAIN');
  });

  it('未识别返回 undefined', () => {
    expect(mapToWechatSearchStatus('不懂')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// Suite 6: detectCrmField + autoDetectFields
// ═══════════════════════════════════════════

describe('detectCrmField', () => {
  it.each([
    ['客户名称', 'name'],
    ['客户名', 'name'],
    ['姓名', 'name'],
    ['公司名称', 'name'],
    ['公司', 'name'],
    ['客户', 'name'],
  ])('%s → name', (header, expected) => {
    expect(detectCrmField(header)).toBe(expected);
  });

  it.each([
    ['微信', 'wechat_id'],
    ['微信号', 'wechat_id'],
    ['微信ID', 'wechat_id'],
    ['wx', 'wechat_id'],
  ])('%s → wechat_id', (header, expected) => {
    expect(detectCrmField(header)).toBe(expected);
  });

  it.each([
    ['手机', 'phone_number'],
    ['手机号', 'phone_number'],
    ['电话', 'phone_number'],
    ['联系电话', 'phone_number'],
    ['phone', 'phone_number'],
    ['mobile', 'phone_number'],
  ])('%s → phone_number', (header, expected) => {
    expect(detectCrmField(header)).toBe(expected);
  });

  it.each([
    ['是否关键KP', 'is_key_decision_maker'],
    ['关键KP', 'is_key_decision_maker'],
    ['决策人', 'is_key_decision_maker'],
    ['关键人', 'is_key_decision_maker'],
  ])('%s → is_key_decision_maker', (header, expected) => {
    expect(detectCrmField(header)).toBe(expected);
  });

  it.each([
    ['意向', 'intent_level'],
    ['意向度', 'intent_level'],
    ['客户意向', 'intent_level'],
  ])('%s → intent_level', (header, expected) => {
    expect(detectCrmField(header)).toBe(expected);
  });

  it.each([
    ['备注', 'notes'],
    ['说明', 'notes'],
    ['跟进内容', 'notes'],
    ['客户情况', 'notes'],
  ])('%s → notes', (header, expected) => {
    expect(detectCrmField(header)).toBe(expected);
  });

  it('不认识的列名返回 null', () => {
    expect(detectCrmField('奇怪字段')).toBeNull();
    expect(detectCrmField('')).toBeNull();
  });

  it('大小写不敏感', () => {
    expect(detectCrmField('WECHAT')).toBe('wechat_id');
    expect(detectCrmField('Phone')).toBe('phone_number');
  });

  it('容错：括号标注/全角空格/星号表头仍可识别', () => {
    expect(detectCrmField('客户名称（必填）')).toBe('name');
    expect(detectCrmField('客户名称(必填)')).toBe('name');
    expect(detectCrmField('公司名称　')).toBe('name');
    expect(detectCrmField('手机号*')).toBe('phone_number');
    expect(detectCrmField('姓名【必填】')).toBe('name');
  });

  it('容错：英文表头可识别', () => {
    expect(detectCrmField('Name')).toBe('name');
    expect(detectCrmField('Company')).toBe('name');
    expect(detectCrmField('Company Name')).toBe('name');
    expect(detectCrmField('Customer Name')).toBe('name');
    expect(detectCrmField('Mobile')).toBe('phone_number');
    expect(detectCrmField('Phone Number')).toBe('phone_number');
    expect(detectCrmField('Email')).toBe('email');
    expect(detectCrmField('WeChat')).toBe('wechat_id');
  });

  it('容错：包含匹配按最长同义词优先，不误伤无关列', () => {
    // “客户等级”既是客户等级的精确同义词，也包含“客户”，必须优先精确/更长同义词
    expect(detectCrmField('客户等级')).toBe('customer_grade');
    expect(detectCrmField('客户名称/公司名称')).toBe('name');
    expect(detectCrmField('手机号码')).toBe('phone_number');
    expect(detectCrmField('奇怪字段')).toBeNull();
  });
});

describe('autoDetectFields', () => {
  it('全表头正确映射', () => {
    const headers = ['客户名称', '微信号', '手机号', '是否关键KP', '意向度', '备注'];
    const result = autoDetectFields(headers);
    expect(result).toHaveLength(6);
    expect(result.map(m => m.crmField)).toEqual([
      'name', 'wechat_id', 'phone_number', 'is_key_decision_maker', 'intent_level', 'notes',
    ]);
  });

  it('重复字段首位优先', () => {
    const headers = ['客户名称', '客户名'];
    const result = autoDetectFields(headers);
    expect(result[0].crmField).toBe('name');
    expect(result[1].crmField).toBeNull();
  });

  it('混合识别与未识别', () => {
    const headers = ['姓名', '奇怪列', 'wx'];
    const result = autoDetectFields(headers);
    expect(result.map(m => m.crmField)).toEqual(['name', null, 'wechat_id']);
  });

  it('空表头返回空数组', () => {
    expect(autoDetectFields([])).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
// Suite 7: buildImportableRecord
// ═══════════════════════════════════════════

describe('findBestImportTable', () => {
  it('skips summary sheets and chooses the first customer sheet', () => {
    const result = findBestImportTable({
      '总览': [
        ['A1-A3客户分层汇总（合并去重版）', '', ''],
        ['核心统计', '', ''],
      ],
      'A1_优先当天触达': [
        ['A1-A3等级', '评分', '公司名称', '联系人', '手机/电话', '跟进备注'],
        ['A1-优先当天触达', '100', '万信达(广州)科技制品有限公司', '周韵萍', '13650734113', '适合当天触达'],
      ],
    });

    expect(result.sheetName).toBe('A1_优先当天触达');
    expect(result.headers).toEqual(['A1-A3等级', '评分', '公司名称', '联系人', '手机/电话', '跟进备注']);
    expect(result.rows).toHaveLength(1);
    expect(result.autoMapping.map(m => m.crmField)).toContain('name');
    expect(result.autoMapping.map(m => m.crmField)).toContain('phone_number');
    expect(result.autoMapping.map(m => m.crmField)).toContain('notes');
  });

  it('finds a header row below a title row', () => {
    const result = findBestImportTable({
      '客户表': [
        ['导入模板'],
        ['说明', '请从下一行开始'],
        ['客户名称', '手机号', '备注'],
        ['测试客户', '13800138000', '高意向'],
      ],
    });

    expect(result.headers).toEqual(['客户名称', '手机号', '备注']);
    expect(result.rows).toEqual([['测试客户', '13800138000', '高意向']]);
  });

  it('prefers a merged all-customer sheet over a smaller A1 sheet', () => {
    const result = findBestImportTable({
      'A1_优先当天触达': [
        ['A1-A3等级', '公司名称', '手机/电话', '跟进备注'],
        ['A1', '客户A', '13800138000', '先触达'],
      ],
      '合并去重总表': [
        ['A1-A3等级', '公司名称', '手机/电话', '跟进备注'],
        ['A1', '客户A', '13800138000', '先触达'],
        ['A2', '客户B', '13900139000', '补信息'],
        ['A3', '客户C', '13700137000', '培育'],
      ],
    });

    expect(result.sheetName).toBe('合并去重总表');
    expect(result.rows).toHaveLength(3);
  });

  it('automatically maps known CRM fields and stores extra business columns in notes', () => {
    const headers = ['A1-A3等级', '公司名称', '官网', '行业/产品', '联系人', '手机/电话', '邮箱', '地址', '推荐切入点', '判断原因', '跟进备注'];
    const mapping = autoDetectFields(headers);

    expect(mapping.find(m => m.sourceColumn === 'A1-A3等级')?.crmField).toBe('customer_grade');
    expect(mapping.find(m => m.sourceColumn === '公司名称')?.crmField).toBe('name');
    expect(mapping.find(m => m.sourceColumn === '手机/电话')?.crmField).toBe('phone_number');
    // v0.3.0: structured fields now map to dedicated fields, not notes
    expect(mapping.find(m => m.sourceColumn === '官网')?.crmField).toBe('website');
    expect(mapping.find(m => m.sourceColumn === '行业/产品')?.crmField).toBe('industry');
    expect(mapping.find(m => m.sourceColumn === '联系人')?.crmField).toBe('contact_person');
    expect(mapping.find(m => m.sourceColumn === '邮箱')?.crmField).toBe('email');
    expect(mapping.find(m => m.sourceColumn === '地址')?.crmField).toBe('address');
    expect(mapping.find(m => m.sourceColumn === '推荐切入点')?.crmField).toBe('pitch_angle');
    expect(mapping.find(m => m.sourceColumn === '判断原因')?.crmField).toBe('qualification_reason');
    // Only 跟进备注 stays in notes
    expect(mapping.filter(m => m.crmField === 'notes').map(m => m.sourceColumn)).toEqual(['跟进备注']);

    const { record } = buildImportableRecord(
      ['A2-补信息后跟进', '客户B', 'https://example.com', '照明', '李四', '13900139000', 'a@example.com', '广州', '官网诊断', '有独立站', '先电话'],
      headers,
      mapping,
    );

    expect(record.customer_grade).toBe('B');
    expect(record.website).toBe('https://example.com');
    expect(record.industry).toBe('照明');
    expect(record.contact_person).toBe('李四');
    expect(record.phone_number).toBe('13900139000');
    expect(record.email).toBe('a@example.com');
    expect(record.address).toBe('广州');
    expect(record.pitch_angle).toBe('官网诊断');
    expect(record.qualification_reason).toBe('有独立站');
    expect(record.notes).toBe('先电话');
  });
});

describe('buildImportableRecord', () => {
  const headers = ['客户名称', '微信号', '手机号', '是否关键KP', '意向度', '备注'];
  const mapping: FieldMapping[] = [
    { sourceColumn: '客户名称', crmField: 'name' },
    { sourceColumn: '微信号', crmField: 'wechat_id' },
    { sourceColumn: '手机号', crmField: 'phone_number' },
    { sourceColumn: '是否关键KP', crmField: 'is_key_decision_maker' },
    { sourceColumn: '意向度', crmField: 'intent_level' },
    { sourceColumn: '备注', crmField: 'notes' },
  ];

  it('完整行映射正确', () => {
    const row = ['张三', 'wx_zhangsan', '13800138000', '是', '高', '重要客户'];
    const { record, errors } = buildImportableRecord(row, headers, mapping);
    expect(errors).toHaveLength(0);
    expect(record.name).toBe('张三');
    expect(record.wechat_id).toBe('wx_zhangsan');
    expect(record.phone_number).toBe('13800138000');
    expect(record.is_key_decision_maker).toBe(1);
    expect(record.intent_level).toBe('HIGH');
    expect(record.notes).toBe('重要客户');
  });

  it('空值映射为 null', () => {
    const row = ['李四', '', '', '', '', ''];
    const { record } = buildImportableRecord(row, headers, mapping);
    expect(record.wechat_id).toBeNull();
    expect(record.phone_number).toBeNull();
    expect(record.notes).toBeNull();
  });

  it('缺失客户名称返回错误', () => {
    const row = ['', 'wx_test', '', '', '', ''];
    const { record, errors } = buildImportableRecord(row, headers, mapping);
    expect(errors).toContain('缺少客户名称');
    expect(record.name).toBeNull();
  });

  it('不需要的列不会映射', () => {
    const headers2 = ['姓名', '奇怪列'];
    const mapping2: FieldMapping[] = [
      { sourceColumn: '姓名', crmField: 'name' },
      { sourceColumn: '奇怪列', crmField: null },
    ];
    const { record } = buildImportableRecord(['王五', '无所谓'], headers2, mapping2);
    expect(record.name).toBe('王五');
  });

  it('布尔值清洗: "否" → 0', () => {
    const row = ['赵六', '', '', '否', '', ''];
    const { record } = buildImportableRecord(row, headers, mapping);
    expect(record.is_key_decision_maker).toBe(0);
  });

  it('意向度清洗: "低意向" → LOW', () => {
    const row = ['钱七', '', '', '', '低意向', ''];
    const { record } = buildImportableRecord(row, headers, mapping);
    expect(record.intent_level).toBe('LOW');
  });
});

// ═══════════════════════════════════════════
// Suite 8: detectDuplicates
// ═══════════════════════════════════════════

describe('detectDuplicates', () => {
  const existing: Customer[] = [
    makeCustomer({ id: '1', wechat_id: 'wx_existing', phone_number: '13900001111', name: '已存在客户' }),
    makeCustomer({ id: '2', wechat_id: 'wx_another', phone_number: null, name: '另一个客户' }),
    makeCustomer({ id: '3', wechat_id: null, phone_number: '13800002222', name: '号段客户' }),
  ];

  it('按微信号匹配重复', () => {
    const result = detectDuplicates({ wechat_id: 'wx_existing' } as Partial<Customer>, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.matchedBy).toBe('wechat_id');
    expect(result.existingId).toBe('1');
  });

  it('按手机号匹配重复', () => {
    const result = detectDuplicates({ phone_number: '13800002222' } as Partial<Customer>, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.matchedBy).toBe('phone_number');
    expect(result.existingId).toBe('3');
  });

  it('按客户名称匹配重复（大小写不敏感）', () => {
    const result = detectDuplicates({ name: '已存在客户' } as Partial<Customer>, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.matchedBy).toBe('name');
    expect(result.existingId).toBe('1');
  });

  it('微信号优先于手机号和名称', () => {
    const result = detectDuplicates(
      { wechat_id: 'wx_existing', phone_number: '13800002222' } as Partial<Customer>,
      existing,
    );
    expect(result.matchedBy).toBe('wechat_id');
  });

  it('不重复返回 false', () => {
    const result = detectDuplicates(
      { name: '全新客户', wechat_id: 'wx_new', phone_number: '13999999999' } as Partial<Customer>,
      existing,
    );
    expect(result.isDuplicate).toBe(false);
  });

  it('没有关键字段时不报重复', () => {
    const result = detectDuplicates({} as Partial<Customer>, existing);
    expect(result.isDuplicate).toBe(false);
  });
});

// ═══════════════════════════════════════════
// Suite 9: computeImportStats
// ═══════════════════════════════════════════

describe('computeImportStats', () => {
  const headers = ['客户名称', '微信号'];
  const mapping: FieldMapping[] = [
    { sourceColumn: '客户名称', crmField: 'name' },
    { sourceColumn: '微信号', crmField: 'wechat_id' },
  ];

  it('正确计算统计数据', () => {
    const rows = [
      ['张三', 'wx_zhang'],
      ['', 'wx_empty'],
      ['李四', 'wx_li'],
    ];
    const existing: Customer[] = [
      makeCustomer({ id: '1', wechat_id: 'wx_zhang', name: '张三' }),
    ];
    const stats = computeImportStats(rows, headers, mapping, existing);
    expect(stats.totalRows).toBe(3);
    expect(stats.importableRows).toBe(2);
    expect(stats.missingNameRows).toBe(1);
    expect(stats.possibleDuplicates).toBe(1);
  });

  it('空数据返回全零', () => {
    const stats = computeImportStats([], headers, mapping, []);
    expect(stats.totalRows).toBe(0);
    expect(stats.importableRows).toBe(0);
  });
});

// ═══════════════════════════════════════════
// Suite 10: applyImportBusinessRules
// ═══════════════════════════════════════════

describe('applyImportBusinessRules', () => {
  it('搜不到微信 → 等级 D', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      wechat_search_status: 'NOT_FOUND',
    });
    expect(result.customer_grade).toBe('D');
  });

  it('账号异常 → 等级 D', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      wechat_search_status: 'ABNORMAL',
    });
    expect(result.customer_grade).toBe('D');
  });

  it('关键KP且微信正常 → 等级 B', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      is_key_decision_maker: 1,
      wechat_search_status: 'FOUND',
    });
    expect(result.customer_grade).toBe('B');
  });

  it('高意向 → 等级 A', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      intent_level: 'HIGH',
    });
    expect(result.customer_grade).toBe('A');
  });

  it('电话反馈 可以见面 → 等级 A', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      phone_feedback: 'CAN_MEET',
    });
    expect(result.customer_grade).toBe('A');
  });

  it('有兴趣 → 等级 A', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      phone_feedback: 'INTERESTED',
    });
    expect(result.customer_grade).toBe('A');
  });

  it('无特殊信号 → 等级 C', () => {
    const result = applyImportBusinessRules({ name: '测试' });
    expect(result.customer_grade).toBe('C');
  });

  it('微信已通过不自动升级等级', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      wechat_add_status: 'PASSED',
    });
    expect(result.customer_grade).toBe('C');
    // 不会创建任务（导入时不调applyWechatPassed）
  });

  it('模糊时间解析', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      rough_visit_time_text: '下周二下午',
    });
    expect(result.parsed_visit_reminder_at).toBeTruthy();
    expect(result.time_parse_status).toBe('PARSED');
  });

  it('无声明的模糊时间不做解析', () => {
    const result = applyImportBusinessRules({ name: '测试' });
    expect(result.time_parse_status).toBeUndefined();
  });

  it('next_follow_up_at 被计算', () => {
    const result = applyImportBusinessRules({ name: '测试' });
    expect(result.next_follow_up_at).toBeTruthy();
  });

  it('KP+搜不到: 搜不到优先级更高 → D', () => {
    const result = applyImportBusinessRules({
      name: '测试',
      is_key_decision_maker: 1,
      wechat_search_status: 'NOT_FOUND',
    });
    expect(result.customer_grade).toBe('D');
  });
});

// ═══════════════════════════════════════════
// Suite 11: exportFailuresAsCSV
// ═══════════════════════════════════════════

describe('exportFailuresAsCSV', () => {
  it('空失败列表返回只有表头的 CSV', () => {
    const csv = exportFailuresAsCSV([]);
    expect(csv).toBe('行号,失败原因,原始数据');
  });

  it('单条失败记录生成正确 CSV 行', () => {
    const csv = exportFailuresAsCSV([
      { row: 3, reason: '缺少客户名称', rawData: { '客户名称': '', '手机号': '13800138000' } },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('行号,失败原因,原始数据');
    expect(lines[1]).toContain('3');
    expect(lines[1]).toContain('缺少客户名称');
    expect(lines[1]).toContain('客户名称:');
  });

  it('多条失败记录生成多行 CSV', () => {
    const csv = exportFailuresAsCSV([
      { row: 1, reason: '缺少客户名称', rawData: { '名称': '' } },
      { row: 5, reason: '创建失败', rawData: { '名称': '测试' } },
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it('CSV 中逗号和引号被正确转义', () => {
    const csv = exportFailuresAsCSV([
      { row: 2, reason: '字段包含"特殊"字符', rawData: { '备注': 'hello, world' } },
    ]);
    // 整个 rawData 字段被引号包裹
    expect(csv).toContain('"备注: hello, world"');
    // reason 中的引号被转义
    expect(csv).toContain('"字段包含""特殊""字符"');
  });
});
