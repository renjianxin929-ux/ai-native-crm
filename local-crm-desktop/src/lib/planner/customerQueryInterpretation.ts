/**
 * Central customer-query interpretation contract.
 *
 * LIST MODE is independent of FILTER FIELDS. A list query may still carry name_query.
 * Product rule (user-defined, authoritative):
 *   “广州客户有哪些” / “找一下广州客户” / “列出广州客户”
 *     → name contains 广州
 *   “广州 C 级客户”
 *     → name contains 广州 AND customer_grade = C
 *   Explicit geographic language (“广州地区的客户” / “位于广州的客户” / “地区在广州的客户”)
 *     → region = 广州
 * Named entity evidence outranks an inferred geographic token unless explicit region language exists.
 */

export const KNOWN_REGION_TOKENS = [
  '东莞', '广州', '深圳', '佛山', '中山', '珠海', '惠州', '江门', '肇庆',
  '上海', '北京', '杭州', '苏州', '南京', '成都', '武汉', '西安', '天津',
  '重庆', '青岛', '大连', '厦门', '福州', '长沙', '郑州', '合肥', '宁波',
  '华南', '华北', '华东', '华西', '华中', '西南', '东北',
] as const;

export type CustomerQueryMode = 'list' | 'lookup' | 'direct_fact';
export type DirectFactKind = 'last_contact';

export interface CustomerQueryInterpretation {
  readonly mode: CustomerQueryMode;
  readonly list_mode: boolean;
  readonly name_query?: string;
  readonly region?: string;
  readonly customer_grade?: string;
  readonly industry?: string;
  readonly explicit_region: boolean;
  readonly direct_fact?: DirectFactKind;
}

const REGION_SORTED = [...KNOWN_REGION_TOKENS].sort((a, b) => b.length - a.length);

const EXPLICIT_GEO = /地区|区域|位于|地处|当地|这边|范围内|地区在|region\s*(?:是|=|为|:)/i;

const LIST_PHRASE = /客户有哪些|有哪些客户|客户列表|哪些.{0,12}客户|列出.{0,12}客户|筛选.{0,12}客户|显示.{0,12}客户|所有客户|全部客户/;

const LOOKUP_VERB = /(?:找一下|帮我找|给我找|查找|搜索|搜|定位|打开|切到|切换到|找出|看看|查询|帮我找|给我查)/;

const LAST_CONTACT = /上次(?:联系|沟通|互动)|最近一次(?:联系|沟通|互动)|什么时候(?:联系|沟通过|联系的)/;

const COMPANY_SPAN = /[\u4e00-\u9fffA-Za-z0-9]{2,40}(?:有限公司|股份有限公司|股份|集团|科技有限公司|实业|有限|科技|公司)/;

const QUERY_SCAFFOLD = /(?:请|麻烦)?(?:帮我|给我)?(?:找一下|帮我找|给我找|给我查|查找|搜索|搜|筛选|列出|找出|看看|看下|查看|了解|关注|推荐|查询|显示|定位|打开|切到|切换到)/g;

const BROWSE_DEICTIC = /哪家|这家|那家|这些|那些|哪些|什么|怎么|看看|看下|查看|了解|关注|推荐/;

const KNOWN_INDUSTRIES = [
  '机械设备', '新能源', '生物', '医疗', '制造', '贸易', '电子', '软件',
  '化工', '食品', '零售', '汽车', '物流', '建材', '纺织',
] as const;

function normalizeRegionToken(token: string): string {
  return token.replace(/市$/, '');
}

export function explicitRegionLanguage(utterance: string, token?: string): boolean {
  const text = utterance.trim();
  if (!token) return EXPLICIT_GEO.test(text);
  if (text.includes(`${token}市`) || text.includes(`${normalizeRegionToken(token)}市`)) return true;
  if (new RegExp(`(?:位于|地处|在)${token}`).test(text)) return true;
  if (new RegExp(`${token}(?:地区|区域|当地|这边|范围内)`).test(text)) return true;
  if (new RegExp(`地区在${token}`).test(text)) return true;
  if (EXPLICIT_GEO.test(text)) return true;
  return false;
}

function extractRegionToken(utterance: string): string | undefined {
  return REGION_SORTED.find(item => utterance.includes(item));
}

function extractGrade(utterance: string): string | undefined {
  const match = utterance.match(/([ABCD])\s*[类级]/);
  if (match) return match[1];
  const english = utterance.match(/\bgrade\s*[=:]?\s*([ABCD])\b/i);
  return english ? english[1]!.toUpperCase() : undefined;
}

function extractIndustry(utterance: string): string | undefined {
  const sorted = [...KNOWN_INDUSTRIES].sort((a, b) => b.length - a.length);
  const exact = sorted.find(item => utterance.includes(item));
  if (exact) return exact;
  if (/(?:机械相关|机械类|工业机械|机械企业)/.test(utterance)) return '机械设备';
  return undefined;
}

function extractCompanySpan(text: string): string | undefined {
  if (BROWSE_DEICTIC.test(text) && !/(有限|股份|集团|科技|实业|ABC)/i.test(text)) return undefined;
  if (/[的得做]/.test(text) && /(公司|企业)\s*$/.test(text) && !/(有限公司|股份|集团)/.test(text)) return undefined;
  const stripped = stripQueryScaffold(text).replace(/^(?:帮我|给我|请)\s*/, '').trim();
  const match = stripped.match(COMPANY_SPAN);
  if (!match) return undefined;
  const value = match[0]!.replace(/(?:有哪些|是什么时候|的时间)$/g, '').trim();
  if (/^(?:哪家|这家|那家|哪些|所有|全部)公司$/.test(value)) return undefined;
  return value.length >= 4 ? value : undefined;
}

function extractAlphanumericEntity(text: string, regionToken?: string): string | undefined {
  // Require mixed CJK+latin (广州ABC / ABC科技). Bare English words such as
  // "context me" / "followup wording" are not company names.
  const match = text.match(
    /[\u4e00-\u9fff]+[A-Za-z][A-Za-z0-9]{1,19}[\u4e00-\u9fffA-Za-z0-9]*|[A-Za-z][A-Za-z0-9]{1,19}[\u4e00-\u9fff]+[\u4e00-\u9fffA-Za-z0-9]*/,
  );
  if (!match) return undefined;
  const value = match[0]!.replace(/(?:是什么时候|的时间)$/g, '').trim();
  if (value.length < 4) return undefined;
  const hasCompanySuffix = /(有限公司|股份|集团|科技|实业|公司)/.test(value);
  const hasRegionPrefix = Boolean(regionToken && value.includes(regionToken))
    || REGION_SORTED.some(token => value.startsWith(token));
  if (!hasCompanySuffix && !hasRegionPrefix) return undefined;
  if (regionToken && !value.includes(regionToken) && value.length < 6) return undefined;
  return value;
}

function stripQueryScaffold(text: string): string {
  return text
    .replace(QUERY_SCAFFOLD, ' ')
    .replace(/有哪些|哪些|列表|全部|所有/g, ' ')
    .replace(/[的得了吗呢着过，。？?！!：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leftoverAfterPlace(text: string, regionToken: string): string {
  return stripQueryScaffold(text)
    .replace(new RegExp(regionToken, 'g'), ' ')
    .replace(/客户|公司|企业/g, ' ')
    .replace(/[A-D]\s*[类级]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLastContactName(utterance: string): string | undefined {
  const untilWhen = utterance.match(/(?:上次|最近一次)\s*(?:联系|沟通|互动)\s*(.+?)(?:是什么时候|的时间)/);
  if (untilWhen) {
    const value = untilWhen[1]!
      .replace(/^(?:一下|了)/, '')
      .replace(/的$/, '')
      .trim();
    if (value && !/^(客户|公司|企业)$/.test(value)) return value;
  }
  const company = extractCompanySpan(utterance) ?? extractAlphanumericEntity(utterance);
  if (company && !/^(客户|公司|企业)$/.test(company)) return company;
  return undefined;
}

function isGluedIndustryEntity(text: string, regionToken: string, industry: string): boolean {
  const glued = text.includes(`${regionToken}${industry}`);
  if (!glued) return false;
  if (/客户|公司|企业|行业|地区|区域/.test(text)) return false;
  if (/[的得做]/.test(text.replace(`${regionToken}${industry}`, ''))) return false;
  return LOOKUP_VERB.test(text);
}

/**
 * Single interpretation seam for place tokens vs name search vs last-contact facts.
 * Industry/other structural filters are supplied by the caller when already extracted.
 */
export function interpretCustomerQuery(
  utterance: string,
  extras?: { readonly industry?: string },
): CustomerQueryInterpretation {
  const text = utterance.trim();
  const grade = extractGrade(text);
  const industry = extras?.industry ?? extractIndustry(text);
  const regionToken = extractRegionToken(text);
  const lastContact = LAST_CONTACT.test(text);
  const explicit = regionToken ? explicitRegionLanguage(text, regionToken) : false;
  const company = extractCompanySpan(text);
  const alphaEntity = extractAlphanumericEntity(text, regionToken);
  const namedEntity = company ?? alphaEntity;
  const wantsList = LIST_PHRASE.test(text)
    || (LOOKUP_VERB.test(text) && /客户/.test(text) && !namedEntity && !/比较|对比|对照/.test(text));

  if (lastContact) {
    const lastContactName = extractLastContactName(text);
    const entity = lastContactName && !/^(客户|公司|企业)$/.test(lastContactName)
      ? lastContactName
      : undefined;
    return {
      mode: 'direct_fact',
      list_mode: false,
      direct_fact: 'last_contact',
      explicit_region: false,
      ...(entity ? { name_query: entity } : {}),
      ...(grade ? { customer_grade: grade } : {}),
    };
  }

  if (explicit && regionToken) {
    return {
      mode: 'list',
      list_mode: true,
      region: normalizeRegionToken(regionToken),
      explicit_region: true,
      ...(grade ? { customer_grade: grade } : {}),
      ...(industry ? { industry } : {}),
    };
  }

  if (regionToken && industry && isGluedIndustryEntity(text, regionToken, industry)) {
    return {
      mode: 'lookup',
      list_mode: false,
      name_query: `${normalizeRegionToken(regionToken)}${industry}`,
      explicit_region: false,
    };
  }

  if (namedEntity && !explicit) {
    const leftoverIsOnlyPlace = leftoverAfterPlace(text, regionToken ?? '') === '';
    const browseCompany = Boolean(regionToken && leftoverIsOnlyPlace && /客户|公司|企业/.test(text) && namedEntity === `${regionToken}公司`);
    if (!browseCompany) {
      return {
        mode: wantsList && /有哪些|列出|所有|全部|筛选/.test(text) ? 'list' : 'lookup',
        list_mode: wantsList && /有哪些|列出|所有|全部|筛选/.test(text),
        name_query: namedEntity,
        explicit_region: false,
        ...(grade ? { customer_grade: grade } : {}),
      };
    }
  }

  if (regionToken && industry && !explicit) {
    return {
      mode: wantsList || /客户|公司|企业/.test(text) ? 'list' : 'lookup',
      list_mode: wantsList || /客户|公司|企业/.test(text),
      name_query: normalizeRegionToken(regionToken),
      industry,
      explicit_region: false,
      ...(grade ? { customer_grade: grade } : {}),
    };
  }

  if (regionToken && /客户|公司|企业/.test(text) && !industry) {
    return {
      mode: 'list',
      list_mode: true,
      name_query: normalizeRegionToken(regionToken),
      explicit_region: false,
      ...(grade ? { customer_grade: grade } : {}),
    };
  }

  if (regionToken && leftoverAfterPlace(text, regionToken).length >= 2 && !industry) {
    const leftover = leftoverAfterPlace(text, regionToken);
    return {
      mode: LOOKUP_VERB.test(text) && !wantsList ? 'lookup' : (wantsList ? 'list' : 'lookup'),
      list_mode: wantsList,
      name_query: `${normalizeRegionToken(regionToken)}${leftover}`.replace(/\s+/g, ''),
      explicit_region: false,
      ...(grade ? { customer_grade: grade } : {}),
    };
  }

  return {
    mode: LIST_PHRASE.test(text) || LOOKUP_VERB.test(text) || wantsList ? 'list' : 'lookup',
    list_mode: LIST_PHRASE.test(text) || wantsList,
    explicit_region: false,
    ...(grade ? { customer_grade: grade } : {}),
    ...(industry ? { industry } : {}),
  };
}

export function isLastContactQuestion(utterance: string): boolean {
  return LAST_CONTACT.test(utterance.trim());
}
