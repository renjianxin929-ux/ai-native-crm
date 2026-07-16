/**
 * Explicit NL → CRM field normalization for Sales Agent customer search.
 * Maps product language onto real schema fields only (region, customer_grade, stage, …).
 * Never equates grade with stage, city with invented columns, or A-class with NEW_LEAD.
 */

export interface NormalizedCustomerSearchFilters {
  /** Name / alias substring match against customers.name */
  readonly name_query?: string;
  /** Maps to customers.region (CRM has no city column; lead city imports into region) */
  readonly region?: string;
  readonly industry?: string;
  /** Exact customers.customer_grade (A|B|C|D) */
  readonly customer_grade?: string;
  /** Exact customers.stage — never used as a stand-in for grade */
  readonly stage?: string;
  /** Exact customers.intent_level */
  readonly intent_level?: string;
  /** Match when last_contacted_at is null or older than N days */
  readonly inactive_days?: number;
  readonly now?: string;
}

export interface FilterNormalizationResult {
  readonly filters: NormalizedCustomerSearchFilters;
  /** Filters the user asked for that have no real schema mapping */
  readonly unsupported: readonly string[];
  /** Human-readable notes (e.g. partial-match labels) */
  readonly notes: readonly string[];
  /** True when the utterance is primarily a portfolio/list query */
  readonly is_portfolio_query: boolean;
  /** True when the utterance is an explicit customer switch */
  readonly is_explicit_switch: boolean;
  /** True when the utterance clears scoped customer */
  readonly is_clear_scope: boolean;
  /** True when the utterance requires locating a named/described customer */
  readonly is_customer_lookup: boolean;
  /** True when the utterance is a customer-scoped analysis ask (summary/risk/…) */
  readonly is_scoped_analysis: boolean;
}

const KNOWN_REGIONS = [
  '东莞', '广州', '深圳', '佛山', '中山', '珠海', '惠州', '江门', '肇庆',
  '上海', '北京', '杭州', '苏州', '南京', '成都', '武汉', '西安', '天津',
  '重庆', '青岛', '大连', '厦门', '福州', '长沙', '郑州', '合肥', '宁波',
  '华南', '华北', '华东', '华西', '华中', '西南', '东北',
] as const;

const KNOWN_INDUSTRIES = [
  '机械设备', '新能源', '生物', '医疗', '制造', '贸易', '电子', '软件',
  '化工', '食品', '零售', '汽车', '物流', '建材', '纺织',
] as const;

const SCOPED_ANALYSIS =
  /(总结\s*(客户)?\s*现状|分析\s*(风险|机会)|整理\s*(最新)?\s*互动|准备\s*(下一次)?\s*跟进|最近怎么样|下一步应该做什么|这个客户)/;

const LOOKUP_VERB =
  /(?:^(?:帮我|给我|请)?\s*(?:找一下|找|查一下|查询|查找|查|搜索|筛选|列出|定位|找出)|有哪些|切换到|切换至)/;

const CLEAR_SCOPE = /(清除客户|清除上下文|取消客户|退出客户|解除绑定)/;

const PORTFOLIO =
  /(今天有哪些|高意向|值得联系|值得关注|没有跟进|未跟进|久未联系|最近\s*\d+\s*天|有哪些|所有|全部|哪些客户|的客户|客户列表|筛选客户|列出客户|组合查询)/;

function extractRegion(message: string): string | undefined {
  // Prefer longer / more specific tokens first
  const sorted = [...KNOWN_REGIONS].sort((a, b) => b.length - a.length);
  return sorted.find(item => message.includes(item));
}

function extractIndustry(message: string): string | undefined {
  const sorted = [...KNOWN_INDUSTRIES].sort((a, b) => b.length - a.length);
  return sorted.find(item => message.includes(item));
}

function extractGrade(message: string): string | undefined {
  const match = message.match(/([ABCD])\s*类/);
  if (match) return match[1];
  const english = message.match(/\bgrade\s*[=:]?\s*([ABCD])\b/i);
  if (english) return english[1]!.toUpperCase();
  return undefined;
}

function extractIntent(message: string): string | undefined {
  if (/高意向|高优先|值得联系|值得关注/.test(message)) return 'HIGH';
  if (/中意向/.test(message)) return 'MEDIUM';
  if (/低意向/.test(message)) return 'LOW';
  return undefined;
}

function extractInactiveDays(message: string): number | undefined {
  const match = message.match(/最近\s*(\d+)\s*天.*(?:没有|未).*跟进/);
  if (match) return Number(match[1]);
  if (/没有跟进|未跟进|久未联系/.test(message)) return 30;
  return undefined;
}

function extractStage(message: string): string | undefined {
  // Explicit stage tokens only — never infer from grade language
  const stages: Array<[RegExp, string]> = [
    [/新线索|NEW_LEAD/i, 'NEW_LEAD'],
    [/已联系|CONTACTED/i, 'CONTACTED'],
    [/可拜访|VISIT_READY/i, 'VISIT_READY'],
    [/已拜访|VISITED/i, 'VISITED'],
    [/签约中|CONTRACTING/i, 'CONTRACTING'],
    [/已成交|WON/i, 'WON'],
    [/已失败|LOST/i, 'LOST'],
  ];
  for (const [pattern, stage] of stages) {
    if (pattern.test(message)) return stage;
  }
  return undefined;
}

function extractQuotedOrMarkedName(message: string): string | null {
  // Cut trailing follow-on clauses ("，然后总结…") before name extraction
  const head = message.split(/[，,]?\s*然后/)[0]!.trim();
  const patterns = [
    /[「『""](.+?)[」』""]/,
    /^(?:帮我|给我|请)?\s*(?:找一下|查一下|查询|查找|搜索|定位|切换到|切换至|找出|找|查)\s*(.+?)(?:\s*这个客户)?$/,
    /总结\s*(.+?)\s*最近/,
    /查一下\s*(.+?)(?:\s*这个客户)?$/,
  ];
  for (const pattern of patterns) {
    const match = head.match(pattern);
    const value = match?.[1]?.trim();
    if (value && value.length >= 2 && value.length <= 40) return value;
  }
  return null;
}

/** Strip known structured filter tokens so leftover text can be treated as a name fragment. */
function stripFilterTokens(raw: string, filters: NormalizedCustomerSearchFilters): string {
  let text = raw;
  if (filters.region) text = text.split(filters.region).join(' ');
  if (filters.industry) text = text.split(filters.industry).join(' ');
  if (filters.customer_grade) text = text.replace(new RegExp(`${filters.customer_grade}\\s*类`, 'g'), ' ');
  text = text
    // Inactivity is a structured filter, not a company-name fragment. Strip the
    // complete phrase before generic filler removal so "30天没有跟进" cannot
    // accidentally become name_query and eliminate the portfolio result set.
    .replace(/最近\s*\d+\s*天\s*(?:都\s*)?(?:没有|未)\s*跟进(?:的)?/g, ' ')
    .replace(/(?:没有|未)\s*跟进|久未联系/g, ' ')
    .replace(/帮我找一下|帮我找|给我找|帮我|给我|请|找一下|查一下|查询|查找|搜索|筛选|列出|定位|找出|查|找|切换到|切换至|所有|全部|区域|地区|这个客户|客户|公司|企业|的|做|一下|最近|情况|总结|分析/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/**
 * Normalize a Chinese/English Sales Agent utterance into real CRM filter fields.
 */
export function normalizeCustomerSearchFilters(message: string, nowIso?: string): FilterNormalizationResult {
  const trimmed = message.trim();
  const unsupported: string[] = [];
  const notes: string[] = [];

  if (/城市|city/i.test(trimmed) && !/东莞|广州|深圳|上海|北京/.test(trimmed)) {
    notes.push('系统使用 region 字段表示地区；未识别到具体地区名时不会按城市过滤。');
  }

  // Explicit unsupported product language that must not be silently ignored
  if (/置信度|confidence\s*%/i.test(trimmed)) {
    unsupported.push('confidence_percent');
  }

  let region = extractRegion(trimmed);
  let industry = extractIndustry(trimmed);
  const customer_grade = extractGrade(trimmed);
  const intent_level = extractIntent(trimmed);
  const inactive_days = extractInactiveDays(trimmed);
  const stage = extractStage(trimmed);
  const is_explicit_switch = /切换到|切换至/.test(trimmed);
  const is_clear_scope = CLEAR_SCOPE.test(trimmed);
  const is_scoped_analysis = SCOPED_ANALYSIS.test(trimmed) && !LOOKUP_VERB.test(trimmed) && !is_explicit_switch;

  const markedRaw = extractQuotedOrMarkedName(trimmed);
  const hasExplicitQuotedName = /[「『""](.+?)[」』""]/.test(trimmed);
  // Company-name lookups may embed region/industry tokens (华南生物) — do not treat those as structural filters.
  if (markedRaw && LOOKUP_VERB.test(trimmed) && !/[的做]/.test(markedRaw)) {
    if (region && markedRaw.startsWith(region) && markedRaw.length > region.length + 1) {
      region = undefined;
    }
    if (industry && markedRaw.endsWith(industry) && markedRaw.length > industry.length + 1) {
      industry = undefined;
    }
  }
  const structural = Boolean(region || industry || customer_grade || intent_level || inactive_days || stage);
  // Prefer structured filters — do not treat "广州做机械设备的" or "东莞的 A 类" as a customer name.
  let name_query: string | undefined;
  if (hasExplicitQuotedName && markedRaw) {
    // Quotation is an explicit entity boundary. Preserve the full company name
    // even when it happens to contain region/industry vocabulary (华南生物).
    name_query = markedRaw;
  } else if (!structural && markedRaw) {
    name_query = markedRaw;
  } else if (markedRaw && structural) {
    const leftover = stripFilterTokens(markedRaw, {
      region,
      industry,
      customer_grade,
      intent_level,
      inactive_days,
      stage,
    });
    // Ignore filler leftovers like "的"/"做的" — only keep substantive company-name fragments
    if (leftover.length >= 4 && !/^[的了吗呢着过做]+$/.test(leftover)) {
      name_query = leftover;
    }
  } else if (!structural) {
    const leftover = stripFilterTokens(trimmed, {});
    if (leftover.length >= 2 && LOOKUP_VERB.test(trimmed)) {
      name_query = leftover;
    }
  }

  // leftover "客户" after stripping region/industry is NOT a company name
  if (name_query && /^(客户|公司|企业)$/.test(name_query)) {
    name_query = undefined;
  }

  // Portfolio = list/browse intent without a single company entity to bind.
  // "帮我找一下广州的客户" / region+industry(+grade) without company name → portfolio.
  const portfolioPhrase = PORTFOLIO.test(trimmed) || /的客户|有哪些客户|客户有哪些|客户列表|哪些.*客户/.test(trimmed);
  const hasStructuralBrowse = Boolean(region || industry || customer_grade || intent_level || inactive_days);
  const is_portfolio_query =
    !is_explicit_switch
    && !name_query
    && (portfolioPhrase || hasStructuralBrowse);

  const filters: NormalizedCustomerSearchFilters = {
    ...(name_query ? { name_query } : {}),
    ...(region ? { region } : {}),
    ...(industry ? { industry } : {}),
    ...(customer_grade ? { customer_grade } : {}),
    ...(stage ? { stage } : {}),
    ...(intent_level ? { intent_level } : {}),
    ...(typeof inactive_days === 'number' ? { inactive_days } : {}),
    ...(nowIso ? { now: nowIso } : {}),
  };

  const hasAnyFilter = Object.keys(filters).some(key => key !== 'now');
  const is_customer_lookup =
    !is_clear_scope
    && !is_scoped_analysis
    && !is_portfolio_query
    && (Boolean(name_query) || is_explicit_switch || (LOOKUP_VERB.test(trimmed) && Boolean(name_query)));

  // Portfolio filters still count as a customer-search action for routing
  const is_search_action =
    is_customer_lookup
    || is_portfolio_query
    || is_explicit_switch
    || (LOOKUP_VERB.test(trimmed) && hasAnyFilter);

  if (customer_grade) {
    notes.push(`A/B/C/D 类映射为 customers.customer_grade，不等于 stage。`);
  }
  if (region) {
    notes.push(`地区“${region}”映射为 customers.region。`);
  }

  return {
    filters,
    unsupported,
    notes,
    is_portfolio_query,
    is_explicit_switch,
    is_clear_scope,
    is_customer_lookup: is_customer_lookup || (is_search_action && Boolean(name_query) && !is_portfolio_query),
    is_scoped_analysis,
  };
}

/** After bind, search-only prompts resume as a customer summary objective. */
export function resumeInstructionAfterScope(pending: string): string {
  const trimmed = pending.trim();
  // Never rewrite closed write intents into a generic summary.
  if (/(写\s*(一\s*)?条\s*跟进|新增\s*.*跟进|添加\s*.*跟进|创建\s*.*任务|提醒我|更新\s*下次|修改\s*下次|跟进记录|create\s+task|log\s+a\s+follow|set\s+next\s+follow)/i.test(trimmed)) {
    return trimmed;
  }
  const norm = normalizeCustomerSearchFilters(pending);
  if (norm.is_customer_lookup && !norm.is_scoped_analysis && !/总结|分析|整理|准备|下一步/.test(pending)) {
    return '总结客户现状';
  }
  // Strip explicit switch prefix so runtime receives the follow-on ask when present
  const afterSwitch = pending.replace(/^.*?切换到[^，,]+[，,]?\s*(?:然后)?/, '').trim();
  if (norm.is_explicit_switch && afterSwitch && afterSwitch !== pending.trim()) {
    return afterSwitch;
  }
  if (norm.is_explicit_switch && !/总结|分析|整理|准备/.test(pending)) {
    return '总结客户现状';
  }
  return trimmed;
}
