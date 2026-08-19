/**
 * Explicit NL → CRM field normalization for Sales Agent customer search.
 * Maps product language onto real schema fields only (region, customer_grade, stage, …).
 * Place-token vs name-search is owned by interpretCustomerQuery (one central seam).
 * Never equates grade with stage, city with invented columns, or A-class with NEW_LEAD.
 */

import { interpretCustomerQuery, KNOWN_REGION_TOKENS, isLastContactQuestion } from '../planner/customerQueryInterpretation';

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

const KNOWN_REGIONS = KNOWN_REGION_TOKENS;

const KNOWN_INDUSTRIES = [
  '机械设备', '新能源', '生物', '医疗', '制造', '贸易', '电子', '软件',
  '化工', '食品', '零售', '汽车', '物流', '建材', '纺织',
] as const;

const SCOPED_ANALYSIS =
  /(总结\s*(客户)?\s*现状|分析\s*(风险|机会)|整理\s*(最新)?\s*互动|准备\s*(下一次)?\s*跟进|最近怎么样|下一步应该做什么|这个客户)/;

const LOOKUP_VERB =
  /(?:^(?:帮我|给我|请)?\s*(?:找一下|找|查一下|查询|查找|查|搜索客户名?\s*[:：]?|搜索|搜客户|搜|筛选|列出|定位|找出|打开客户?|打开|切到客户?\s*[:：]?|切到|切换客户到|把当前客户换成)|切换到|切换至)/;

const DIRECT_ENTITY_LOOKUP_VERB =
  /(?:打开客户?|打开|切到客户?\s*[:：]?|切到|切换客户到|切换到|切换至|把当前客户换成|搜索客户名?\s*[:：]?|定位客户?\s*[:：]?)/;

const CLEAR_SCOPE = /(清除(?:当前)?客户|清除上下文|取消客户|退出客户|解除绑定)/;

const PORTFOLIO =
  /(今天有哪些客户|高意向客户|值得联系的客户|值得关注的客户|没有跟进的客户|未跟进的客户|久未联系的客户|最近\s*\d+\s*天.*客户|所有客户|全部客户|哪些客户|客户列表|筛选客户|列出客户|组合查询)/;

function extractRegion(message: string): string | undefined {
  // Prefer longer / more specific tokens first
  const sorted = [...KNOWN_REGIONS].sort((a, b) => b.length - a.length);
  return sorted.find(item => message.includes(item));
}

function extractIndustry(message: string): string | undefined {
  const sorted = [...KNOWN_INDUSTRIES].sort((a, b) => b.length - a.length);
  const exact = sorted.find(item => message.includes(item));
  if (exact) return exact;
  if (/(?:机械相关|机械类|工业机械|机械企业)/.test(message)) return '机械设备';
  return undefined;
}

function extractGrade(message: string): string | undefined {
  const match = message.match(/([ABCD])\s*[类级]/);
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

/**
 * Strip a leading analysis verb (总结/概括/分析/整理 …) from a whole-utterance
 * company name so the extracted name_query is the bare entity name. The search
 * tool matches against customers.name, and "总结一下广州ABC科技有限公司" must
 * resolve to name_query "广州ABC科技有限公司" — not a LIKE pattern that can
 * never match because of the verb prefix.
 *
 * The verb must be followed by an explicit complement ("一下"/"下") or a colon,
 * so real company names that merely start with such characters
 * ("分析测试技术有限公司") are never mutilated.
 */
function stripLeadingAnalysisPrefix(text: string): string {
  return text
    .replace(/^(?:请|麻烦)?\s*(?:帮我|给我)?\s*(?:总结|概括|分析|梳理|整理)\s*(?:(?:一下|下)|[:：])\s*(?:这个|该|这家)?\s*(?:客户|公司)?\s*[:：]?\s*/u, '')
    .trim();
}

function extractQuotedOrMarkedName(message: string): string | null {
  // Cut trailing follow-on clauses ("，然后总结…") before name extraction
  const head = message.split(/[，,]?\s*然后/)[0]!.trim();
  const patterns = [
    /[「『""](.+?)[」』""]/,
    /^(?:帮我|给我|请)?\s*(?:找一下|查一下|查询|查找|搜索客户名?\s*[:：]?|搜索|搜客户|搜|定位客户?\s*[:：]?|定位|切换到|切换至|切到客户?\s*[:：]?|切到|切换客户到|把当前客户换成|打开客户?|打开|找出|找|查)\s*(.+?)(?:\s*这个客户)?$/,
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

/**
 * Strong company-name suffixes. Used to recognize a whole utterance as an
 * entity name when no lookup verb / quote boundary is present, so that a name
 * like "广州ABC科技有限公司" is not misread as a region-only portfolio query.
 */
const STRONG_COMPANY_NAME_SUFFIX = /(公司|有限|股份|集团|科技|实业)$/;

function looksLikeWholeCompanyName(text: string): boolean {
  const t = text.trim();
  const core = t.replace(STRONG_COMPANY_NAME_SUFFIX, '');
  return (
    t.length >= 4 && t.length <= 40
    && STRONG_COMPANY_NAME_SUFFIX.test(t)
    && !/[的得做]/.test(t)
    // Browse / compare / deictic phrases ending in a company suffix are NOT
    // entity names ("并排看这些公司", "所有公司", "哪家公司", "看看广州公司").
    && !/(这些|那些|这家|那家|哪家|所有|全部|并排|哪些|什么|怎么|看看|看下|查看|了解|关注|推荐|这家公司|那家公司)/.test(t)
    // A bare "known region/industry token + company suffix" is a browse phrase
    // ("广州公司", "生物公司"), not an entity name. Multi-token company names
    // like "广州生物科技有限公司" keep the full name_query.
    && !((KNOWN_REGIONS as readonly string[]).includes(core) || (KNOWN_INDUSTRIES as readonly string[]).includes(core))
    && !LOOKUP_VERB.test(t)
    && !PORTFOLIO.test(t)
    && !CLEAR_SCOPE.test(t)
  );
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
    .replace(/帮我找一下|帮我找|给我找|帮我|给我|请|找一下|查一下|查询|查找|搜索客户名?|搜索|搜客户|搜|筛选|列出|定位客户|定位|找出|查|找|切换客户到|切换到|切换至|切到客户|切到|把当前客户换成|打开客户|打开|所有|全部|区域|地区|这个客户|客户|公司|企业|的|得|做|一下|最近|情况|总结|分析/g, ' ')
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

  const place = interpretCustomerQuery(trimmed, { industry: extractIndustry(trimmed) });
  let industry = place.industry ?? extractIndustry(trimmed);
  const customer_grade = extractGrade(trimmed) ?? place.customer_grade;
  const intent_level = extractIntent(trimmed);
  const inactive_days = extractInactiveDays(trimmed);
  const stage = extractStage(trimmed);
  const is_explicit_switch = /切换到|切换至|切到(?:客户)?|切换客户到|把当前客户换成/.test(trimmed);
  const is_clear_scope = CLEAR_SCOPE.test(trimmed);
  const is_scoped_analysis = SCOPED_ANALYSIS.test(trimmed) && !LOOKUP_VERB.test(trimmed) && !is_explicit_switch;
  const regionToken = extractRegion(trimmed);

  const extractedMarkedRaw = extractQuotedOrMarkedName(trimmed);
  // A whole utterance that is itself a company name (no lookup verb / no browse
  // phrase) must keep its name_query instead of degrading to region/industry
  // structural filters — "广州ABC科技有限公司" is an entity, not a region browse.
  const wholeCompanyNameCandidate = !extractedMarkedRaw && looksLikeWholeCompanyName(trimmed);
  const markedRaw = extractedMarkedRaw ?? (wholeCompanyNameCandidate ? trimmed : null);
  const hasExplicitQuotedName = /[「『""](.+?)[」』""]/.test(trimmed);
  const isDirectEntityLookup = Boolean(markedRaw && DIRECT_ENTITY_LOOKUP_VERB.test(trimmed));
  const markedRawIsStructuredPortfolioTarget = Boolean(
    markedRaw
      && /(?:客户|公司|企业)\s*$/.test(markedRaw)
      && stripFilterTokens(markedRaw, {
        region: place.region,
        industry,
        customer_grade,
        intent_level,
        inactive_days,
        stage,
      }).length === 0,
  );
  // Company-name lookups may embed region/industry tokens (华南生物) — do not treat those as structural filters.
  const markedNameEntityBoundary = wholeCompanyNameCandidate
    || LOOKUP_VERB.test(trimmed)
    || Boolean(markedRaw && regionToken && markedRaw.startsWith(regionToken) && !/[的得做]/.test(markedRaw));
  if (markedRaw && markedNameEntityBoundary && !markedRawIsStructuredPortfolioTarget && !/[的得做]/.test(markedRaw)) {
    if (wholeCompanyNameCandidate) {
      industry = undefined;
    } else if (industry && markedRaw.length > industry.length + 1
      && (isDirectEntityLookup || markedRaw.endsWith(industry))) {
      industry = undefined;
    }
  }
  const region = place.explicit_region ? place.region : undefined;
  if (place.industry && !wholeCompanyNameCandidate) industry = place.industry;
  const structural = Boolean(region || industry || customer_grade || intent_level || inactive_days || stage);
  // Prefer the central interpretation seam for name vs region. Quoted / whole-company
  // / direct-entity lookups may still override with the full entity span.
  let name_query: string | undefined;
  if (place.name_query && !place.explicit_region) {
    name_query = place.name_query;
  }
  if ((hasExplicitQuotedName || isDirectEntityLookup || wholeCompanyNameCandidate) && markedRaw) {
    // Quotation / direct-entity verb / whole-utterance-company-name is an explicit
    // entity boundary. Preserve the full company name even when it contains
    // region/industry vocabulary (华南生物, 广州生物科技有限公司). A leading
    // analysis verb ("总结一下…") is not part of the entity name and must be
    // stripped, otherwise the LIKE match against customers.name can never hit.
    const cleaned = wholeCompanyNameCandidate ? stripLeadingAnalysisPrefix(markedRaw) : markedRaw;
    // Trailing task language ("分析一下" / "，然后总结") is not part of the CRM name.
    // Prefer the already-extracted company span when it is a prefix of the capture.
    name_query = place.name_query && cleaned.startsWith(place.name_query)
      ? place.name_query
      : cleaned;
    if (name_query.length < 2) name_query = undefined;
  } else if (!name_query && !structural && markedRaw && !markedRawIsStructuredPortfolioTarget) {
    name_query = markedRaw;
  } else if (!name_query && markedRaw && structural) {
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
  } else if (!name_query && !structural) {
    const leftover = stripFilterTokens(trimmed, {});
    if (leftover.length >= 2 && LOOKUP_VERB.test(trimmed)) {
      name_query = leftover;
    }
  }

  // leftover "客户" after stripping region/industry is NOT a company name
  if (name_query && /^(客户|公司|企业)$/.test(name_query)) {
    name_query = undefined;
  }

  // List mode is independent of name_query: “广州客户有哪些” is a list WITH name_query.
  const portfolioPhrase = PORTFOLIO.test(trimmed) || /有哪些客户|客户列表|哪些.*客户/.test(trimmed) || place.list_mode;
  const hasStructuralBrowse = Boolean(region || industry || (!place.name_query && (customer_grade || intent_level || inactive_days)));
  const is_portfolio_query =
    !is_explicit_switch
    && place.mode !== 'direct_fact'
    && !wholeCompanyNameCandidate
    && !isDirectEntityLookup
    && (place.list_mode || portfolioPhrase || (hasStructuralBrowse && !name_query));

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
    && (Boolean(name_query) || is_explicit_switch || place.mode === 'direct_fact' || (LOOKUP_VERB.test(trimmed) && Boolean(name_query)));

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function remainingInstructionAfterNamedBind(pending: string, nameQuery: string): string {
  const escaped = escapeRegExp(nameQuery);
  return pending.replace(
    new RegExp(`^(?:请|麻烦)?(?:帮我|给我)?\\s*(?:打开客户?|打开|定位客户?|定位|切到客户?|切到|切换到|切换至|切换客户到|把当前客户换成|找一下|查找)?\\s*${escaped}[，,。.\\s]*(?:然后)?\\s*`),
    '',
  ).trim();
}

/** After bind, search-only prompts resume as a customer summary objective. */
export function resumeInstructionAfterScope(pending: string): string {
  const trimmed = pending.trim();
  if (isLastContactQuestion(trimmed)) return trimmed;
  // Never rewrite closed write intents into a generic summary.
  if (/(写\s*(一\s*)?条\s*跟进|新增\s*.*跟进|添加\s*.*跟进|创建\s*.*任务|提醒我|更新\s*下次|修改\s*下次|跟进记录|create\s+task|log\s+a\s+follow|set\s+next\s+follow)/i.test(trimmed)) {
    return trimmed;
  }
  const norm = normalizeCustomerSearchFilters(pending);
  const nameQuery = norm.filters.name_query?.trim();
  if (nameQuery) {
    const remaining = remainingInstructionAfterNamedBind(trimmed, nameQuery);
    if (remaining && remaining !== trimmed) {
      if (/^(?:请)?(?:总结|分析|概括)(?:一下|下)?$/.test(remaining)) return '总结客户现状';
      return remaining;
    }
  }
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
