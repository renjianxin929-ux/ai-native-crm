/**
 * Battle Card Backend V1 — Stage 1 确定性章节解析。
 * 纯确定性，无 Provider 依赖；Provider 缺失时仍产出完整 Draft。
 * Stage 2 模型辅助分类仅作可选注入点（enhanceWithModel），不自动发起 Live 请求。
 */

import { BATTLE_CARD_PARSER_VERSION } from './schema';
import type { FactApplicability, FeishuValueStatement } from './types';
import {
  determineApplicabilityByContract,
  detectCompositeBusinessByContract,
  isFormulaConditionalByContract,
} from './applicabilityContract';
import { sha256HexSync, canonicalJsonStringify } from '../salesAgentTools/confirmedWrite';

/** 解析视图：不再全局归一化（P0-A 修复——Source Span 必须基于原始字节）。
 *  行尾 CRLF 由行扫描器识别（line_ending），Candidate 内部 CRLF 保留。 */
export function normalizeRawForParsing(rawContent: string): string {
  return rawContent;
}

/** Source Span Contract 版本（raw-byte line scanner 合同）。 */
export const SOURCE_SPAN_CONTRACT_VERSION = 'battle-card-source-span-v1';

/**
 * Authoritative Candidate ID（与 Rust build_candidate_id 同算法）：
 * SHA-256(canonical envelope {raw_content_sha256, parser_contract_version, candidate_kind,
 * source_section, start_byte, end_byte, statement_sha256})。
 * 稳定绑定：内容 / 契约版本 / 类型 / 章节 / 字节跨距 / 正文哈希。
 */
export function buildCandidateId(input: {
  readonly rawContentSha256: string;
  readonly parserContractVersion: string;
  readonly sourceSpanContractVersion: string;
  readonly customerId: string;
  readonly importScopeId: string;
  readonly candidateKind: 'FACT' | 'HYPOTHESIS';
  readonly sourceSection: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly sourceExcerptSha256: string;
  readonly statementSha256: string;
}): string {
  const envelope = {
    raw_content_sha256: input.rawContentSha256,
    parser_contract_version: input.parserContractVersion,
    source_span_contract_version: input.sourceSpanContractVersion,
    customer_id: input.customerId,
    import_scope_id: input.importScopeId,
    candidate_kind: input.candidateKind,
    source_section: input.sourceSection,
    start_byte: input.startByte,
    end_byte: input.endByte,
    source_excerpt_sha256: input.sourceExcerptSha256,
    statement_sha256: input.statementSha256,
  };
  return sha256HexSync(canonicalJsonStringify(envelope));
}

/**
 * Authoritative Import Scope：绑定 customer_id + raw_content_sha256 + 双契约版本。
 * import_scope_id = SHA-256(canonical envelope)。TS/Rust 同一合同。
 */
export function buildImportScopeId(input: {
  readonly customerId: string;
  readonly rawContentSha256: string;
  readonly parserContractVersion: string;
  readonly sourceSpanContractVersion: string;
  readonly sourceKind: string;
}): string {
  const envelope = {
    customer_id: input.customerId,
    raw_content_sha256: input.rawContentSha256,
    parser_contract_version: input.parserContractVersion,
    source_span_contract_version: input.sourceSpanContractVersion,
    source_kind: input.sourceKind,
  };
  return sha256HexSync(canonicalJsonStringify(envelope));
}

// ── 章节定义 ──

export type IntelligenceSectionKey =
  | 'company'
  | 'profile'
  | 'problem_hypotheses'
  | 'landing_points'
  | 'why_validate'
  | 'feishu_talk'
  | 'implementation'
  | 'peers'
  | 'first_questions'
  | 'human_gates'
  | 'poc'
  | 'adversarial'
  | 'recommendation'
  | 'sources';

export interface SectionDefinition {
  readonly key: IntelligenceSectionKey;
  readonly label: string;
  readonly aliases: readonly string[];
}

export const INTELLIGENCE_SECTIONS: readonly SectionDefinition[] = [
  { key: 'company', label: '主体与公开事实', aliases: ['主体与公开事实', '公司主体', '公开事实', '企业主体', '主体', '主体与事实'] },
  { key: 'profile', label: '五维战前画像', aliases: ['五维战前画像', '五维画像', '战前画像', '五维'] },
  { key: 'problem_hypotheses', label: '当前问题假设', aliases: ['当前问题假设', '问题假设', '痛点假设', '假设'] },
  { key: 'landing_points', label: 'FDE/FDA 推荐落地点', aliases: ['FDE/FDA', 'FDE', 'FDA', '推荐落地点', '落地点', 'FDE/FDA推荐落地点'] },
  { key: 'why_validate', label: '为什么值得验证', aliases: ['为什么值得验证', '值得验证', '验证价值', '为什么值得', '为什么确认这个痛点值得优先验证', '为什么确认', '痛点值得优先验证'] },
  { key: 'feishu_talk', label: '可直接复述的飞书话术', aliases: ['可直接复述的飞书话术', '飞书话术', '可复述话术', '话术', '可以直接复述的飞书解决方法话术', '飞书解决方法话术'] },
  { key: 'implementation', label: '具体实现路径', aliases: ['具体实现路径', '实现路径', '实施路径', '具体路径', '针对本公司的具体实现路径', '针对本公司'] },
  { key: 'peers', label: '同行校准', aliases: ['同行校准', '同行参照', '同行', '竞品参照', '竞品', '同体量、同阶段与同行校准', '同体量同阶段与同行校准', '同体量'] },
  { key: 'first_questions', label: '首轮挖需问题', aliases: ['首轮挖需问题', '挖需问题', '首轮问题', '挖需'] },
  { key: 'human_gates', label: '人工确认门禁', aliases: ['人工确认门禁', '确认门禁', '人工门禁', '门禁'] },
  { key: 'poc', label: 'POC 路径', aliases: ['POC 路径', 'POC', '试点路径', '试点', '两周POC最小路径', '两周POC'] },
  { key: 'adversarial', label: '对抗式审查', aliases: ['对抗式审查', '对抗审查', '对抗'] },
  { key: 'recommendation', label: '建议推进', aliases: ['建议推进', '推进建议', '建议'] },
  { key: 'sources', label: '来源', aliases: ['来源', '参考来源', '资料来源', '信息来源'] },
];

const SECTION_BY_KEY: Readonly<Record<IntelligenceSectionKey, SectionDefinition>> = Object.freeze(
  Object.fromEntries(INTELLIGENCE_SECTIONS.map(section => [section.key, section])) as Record<IntelligenceSectionKey, SectionDefinition>,
);

// ── Draft 输出类型 ──

export interface DraftFact {
  readonly fact_id: string;
  readonly fact_category: string;
  readonly statement: string;
  readonly confidence: number;
  readonly applicability: FactApplicability;
  readonly normalized_value: Record<string, unknown> | null;
  readonly evidence_refs: readonly { import_ref: string }[];
  readonly source_lines: readonly number[];
  /** 来源章节（保留 source section）。 */
  readonly source_section: IntelligenceSectionKey;
  /** 权威原文 excerpt（逐字保留，精确等于 raw UTF-8 Source Span）。 */
  readonly source_excerpt: string;
  /** Authoritative Candidate 字段（P0-A）：字节跨距与哈希。 */
  readonly start_byte: number;
  readonly end_byte: number;
  readonly excerpt_sha256: string;
  readonly statement_sha256: string;
  readonly parser_contract_version: string;
  readonly source_span_contract_version: string;
}

export interface DraftHypothesis {
  readonly hypothesis_id: string;
  readonly category: string;
  readonly statement: string;
  readonly rationale: string | null;
  readonly applicability: FactApplicability;
  readonly why_it_matters: string | null;
  readonly validation_question: string | null;
  readonly disconfirm_condition: string | null;
  readonly evidence_refs: readonly { import_ref: string }[];
  readonly source_lines: readonly number[];
  readonly source_section: IntelligenceSectionKey;
  /** 权威原文 excerpt（逐字保留，精确等于 raw UTF-8 Source Span）。 */
  readonly source_excerpt: string;
  /** Authoritative Candidate 字段（P0-A）：字节跨距与哈希。 */
  readonly start_byte: number;
  readonly end_byte: number;
  readonly excerpt_sha256: string;
  readonly statement_sha256: string;
  readonly parser_contract_version: string;
  readonly source_span_contract_version: string;
}

export interface DraftScenario {
  readonly scenario_name: string;
  readonly applicability: FactApplicability;
  readonly business_objects: readonly string[];
  readonly problem_hypothesis: string;
  readonly feishu_role: string;
  readonly ai_role: string;
  readonly human_gate: string;
  readonly systems_not_replaced: readonly string[];
  readonly acceptance_metrics: readonly string[];
  readonly evidence_refs: readonly { import_ref: string }[];
  readonly source_section: IntelligenceSectionKey;
  readonly source_excerpt: string;
}

export interface DraftPeerReference {
  readonly company_name: string;
  readonly comparison_level: string;
  readonly why_comparable: string;
  readonly reusable_pattern: string;
  readonly non_transferable_boundary: string;
  readonly source_refs: readonly { import_ref: string }[];
  readonly source_lines: readonly number[];
  readonly source_section: IntelligenceSectionKey;
  readonly source_excerpt: string;
}

export interface DraftFeishuTalkTrack {
  /** 完整话术段落，逐字保留。 */
  readonly paragraphs: readonly string[];
  readonly value_statement: FeishuValueStatement;
}

export interface SourceMappingEntry {
  readonly section: IntelligenceSectionKey;
  readonly start_line: number;
  readonly end_line: number;
  readonly matched_title: string;
  readonly item_count: number;
}

export interface IntelligenceDraft {
  readonly parser_version: string;
  readonly raw_content: string;
  readonly content_hash: string;
  readonly source_system: string;
  readonly source_label: string | null;
  readonly candidate_customer: { readonly name: string | null; readonly matched_names: readonly string[] } | null;
  readonly extracted_facts: readonly DraftFact[];
  readonly extracted_hypotheses: readonly DraftHypothesis[];
  readonly solution_scenarios: readonly DraftScenario[];
  readonly feishu_talk_track: DraftFeishuTalkTrack;
  readonly peer_references: readonly DraftPeerReference[];
  readonly validation_questions: readonly string[];
  readonly human_review_boundaries: readonly string[];
  readonly poc_hypothesis: string | null;
  readonly risk_boundaries: readonly string[];
  readonly conditional_applicability_items: readonly string[];
  readonly parse_warnings: readonly string[];
  readonly source_mapping: readonly SourceMappingEntry[];
  /** 推理模式：确定性与模型增强的区分，防止 Mock 冒充 AI。 */
  readonly reasoning: { readonly mode: 'DETERMINISTIC' | 'MODEL_ENHANCED'; readonly model_called: false };
}

// ── 关键词规则（类别词表仍为 parser 本地；适用性词表已收敛到共享合同）──

const FACT_CATEGORY_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  CERTIFICATION: ['认证', 'CE', 'FCC', 'UL', 'RoHS', '质检'],
  CHANNEL: ['达人', '内容', '平台', '亚马逊', 'TikTok', 'Shopee', '独立站', '直播', '分销'],
  MARKET: ['出海', '多国家', '海外', '跨境', '国家', '版本', '地区'],
  PRODUCT: ['产品', '小家电', '功效', '配方', '成分', '型号', '硬件'],
  OPERATION: ['售后', 'VOC', '包装', '说明书', '物流', '库存', '客服'],
};

// ── 行解析基础 ──

interface ParsedLine {
  readonly line_number: number;
  readonly text: string;
  readonly is_title: boolean;
  readonly is_item: boolean;
  readonly title: string | null;
  /** 行首在 rawContent 中的字符偏移（raw slice 保真）。 */
  readonly start_offset: number;
  /** 原始行文本长度（不含换行符；raw body 边界计算用）。 */
  readonly raw_length: number;
  /** 原始字节坐标（P0-A：Source Span 只来自原始字节位置）。 */
  readonly content_start_byte: number;
  readonly content_end_byte: number;
  readonly raw_end_byte: number;
  readonly line_ending: 'LF' | 'CRLF' | 'NONE';
}

/** 全角标点/数字转半角（仅用于标题识别的合理变体归一，正文保留原文）。 */
function normalizeFullWidth(text: string): string {
  let result = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x3000) {
      result += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += character;
    }
  }
  return result;
}

function normalizeLine(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.、）)]\s*/, '')
    .replace(/^【(.+?)】\s*/, '$1')
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, '')
    .trim();
}

/**
 * 编号/中文数字/全角标点标题检测：
 * `1. 主体与公开事实`、`4A. 为什么确认这个痛点值得优先验证`、`一、五维战前画像`、`１．来源`。
 * 只有编号后内容命中已知章节才判定为标题，避免把列表项误判。
 */
function detectNumberedTitle(text: string): string | null {
  const normalized = normalizeFullWidth(text.trim());
  const match = normalized.match(/^(\d+[A-Za-z]?|[一二三四五六七八九十]+)\s*[.、．。)）:：]\s*(.+)$/);
  if (!match) return null;
  const rest = match[2]?.trim() ?? '';
  if (rest.length < 2) return null;
  return matchSection(rest) ? rest : null;
}

function parseLines(rawContent: string): ParsedLine[] {
  const result: ParsedLine[] = [];
  let offset = 0;
  let byteOffset = 0;
  const encoder = new TextEncoder();
  const lines = rawContent.split('\n');
  const total = lines.length;
  for (const [index, line] of lines.entries()) {
    const start = offset;
    const rawLineBytes = encoder.encode(line);
    const hasCR = rawLineBytes.length > 0 && rawLineBytes[rawLineBytes.length - 1] === 0x0d;
    const contentByteLength = hasCR ? rawLineBytes.length - 1 : rawLineBytes.length;
    const contentStartByte = byteOffset;
    const contentEndByte = byteOffset + contentByteLength;
    const rawEndByte = byteOffset + rawLineBytes.length;
    const hasNewline = index < total - 1;
    const lineEnding: 'LF' | 'CRLF' | 'NONE' = !hasNewline ? 'NONE' : hasCR ? 'CRLF' : 'LF';
    const trimmed = line.trim();
    if (trimmed) {
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        result.push({ line_number: index + 1, text: normalizeLine(trimmed), is_title: true, is_item: false, title: normalizeLine(trimmed), start_offset: start, raw_length: line.length, content_start_byte: contentStartByte, content_end_byte: contentEndByte, raw_end_byte: rawEndByte, line_ending: lineEnding });
      } else {
        const numberedTitle = detectNumberedTitle(trimmed);
        if (numberedTitle) {
          result.push({ line_number: index + 1, text: numberedTitle, is_title: true, is_item: false, title: numberedTitle, start_offset: start, raw_length: line.length, content_start_byte: contentStartByte, content_end_byte: contentEndByte, raw_end_byte: rawEndByte, line_ending: lineEnding });
        } else {
          const itemMatch = trimmed.match(/^([-*•]|\d+[.、）)]|[一二三四五六七八九十]+[、.])\s*(.+)$/);
          result.push({ line_number: index + 1, text: normalizeLine(trimmed), is_title: false, is_item: Boolean(itemMatch), title: null, start_offset: start, raw_length: line.length, content_start_byte: contentStartByte, content_end_byte: contentEndByte, raw_end_byte: rawEndByte, line_ending: lineEnding });
        }
      }
    } else {
      result.push({ line_number: index + 1, text: trimmed, is_title: false, is_item: false, title: null, start_offset: start, raw_length: line.length, content_start_byte: contentStartByte, content_end_byte: contentEndByte, raw_end_byte: rawEndByte, line_ending: lineEnding });
    }
    offset += line.length + 1; // 含行尾换行符
    byteOffset += rawLineBytes.length + 1;
  }
  return result.filter(line => line.text.length > 0 || line.is_title);
}

function matchSection(title: string): IntelligenceSectionKey | null {
  const normalized = title.trim().toUpperCase();
  for (const section of INTELLIGENCE_SECTIONS) {
    if (normalized === section.label.toUpperCase()) return section.key;
    if (section.aliases.some(alias => normalized === alias.toUpperCase())) return section.key;
  }
  // 宽松包含匹配（避免误判，要求标题长度 >= 2）
  for (const section of INTELLIGENCE_SECTIONS) {
    if (section.label.length >= 4 && normalized.includes(section.label.toUpperCase())) return section.key;
    for (const alias of section.aliases) {
      if (alias.length >= 4 && normalized.includes(alias.toUpperCase())) return section.key;
    }
  }
  return null;
}

// ── 适用性判定（共享合同 battle-card-applicability-v1 驱动；TS/Rust 同一 JSON）──

export function determineApplicability(statement: string, contextComposite: boolean): FactApplicability {
  return determineApplicabilityByContract(statement, contextComposite);
}

export function detectCompositeBusiness(text: string): boolean {
  return detectCompositeBusinessByContract(text);
}

export function isFormulaConditional(statement: string): boolean {
  return isFormulaConditionalByContract(statement);
}

function factCategoryFor(statement: string, section: IntelligenceSectionKey): string {
  if (section === 'profile') return 'ASSESSMENT';
  if (section === 'problem_hypotheses' || section === 'first_questions') return 'PROBLEM';
  for (const [category, keywords] of Object.entries(FACT_CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => statement.includes(keyword))) return category;
  }
  if (section === 'company') return 'COMPANY';
  if (section === 'landing_points' || section === 'implementation') return 'OPERATION';
  return 'OTHER';
}

// ── 条目提取 ──

interface SectionContent {
  readonly section: IntelligenceSectionKey;
  readonly items: readonly { readonly text: string; readonly line_numbers: readonly number[] }[];
  readonly paragraphs: readonly { readonly text: string; readonly line_numbers: readonly number[] }[];
  /** 原始切片范围（raw 保真）：标题行文本结束后第一个字符 → 下一个标题行首字符。 */
  readonly raw_start_offset: number;
  readonly raw_end_offset: number;
}

function groupBySections(lines: readonly ParsedLine[], rawContent: string): { sections: SectionContent[]; unmapped: string[]; warnings: string[] } {
  const sections: SectionContent[] = [];
  const unmapped: string[] = [];
  const warnings: string[] = [];
  let current: SectionContent | null = null;

  const ensureSection = (key: IntelligenceSectionKey): SectionContent => {
    let existing = sections.find(section => section.section === key);
    if (!existing) {
      existing = { section: key, items: [], paragraphs: [], raw_start_offset: 0, raw_end_offset: 0 };
      sections.push(existing);
    }
    return existing;
  };

  // 标题行序列（含原始偏移），用于计算每个章节的 raw body 范围
  const titleLines = lines.filter(line => line.is_title && line.title);

  for (const line of lines) {
    if (line.is_title) {
      const key = matchSection(line.title ?? '');
      if (key) {
        current = ensureSection(key);
        const titleEnd = line.start_offset + line.raw_length; // 原始行尾（不含换行符）
        if (current.raw_start_offset === 0) {
          current = { ...current, raw_start_offset: titleEnd + 1 };
        }
        // 下一个标题行首字符（或文件末尾）为 raw_end_offset
        const nextTitle = titleLines.find(candidate => candidate.start_offset > line.start_offset);
        current = { ...current, raw_end_offset: nextTitle ? nextTitle.start_offset : rawContent.length };
        const index = sections.findIndex(section => section.section === key);
        sections[index] = current;
      } else {
        unmapped.push(`${line.line_number}:${line.title}`);
        current = null;
      }
      continue;
    }
    if (!line.text) continue;
    if (!current) {
      // 标题之前的内容：默认为 company 段落（材料通常以公司名开头）
      current = ensureSection('company');
    }
    if (line.is_item) {
      current = { ...current, items: [...current.items, { text: line.text, line_numbers: [line.line_number] }] };
      const index = sections.findIndex(section => section.section === current!.section);
      sections[index] = current;
    } else {
      current = { ...current, paragraphs: [...current.paragraphs, { text: line.text, line_numbers: [line.line_number] }] };
      const index = sections.findIndex(section => section.section === current!.section);
      sections[index] = current;
    }
  }

  for (const unmappedLine of unmapped) {
    warnings.push(`未识别的章节标题（已按上下文保留原文，请人工复核）: ${unmappedLine}`);
  }
  return { sections, unmapped, warnings };
}

/** 章节原始正文切片（标题后第一字符 → 下一标题前最后一字符；调用方决定是否 trim）。 */
function rawBodyOf(sections: readonly SectionContent[], key: IntelligenceSectionKey, rawContent: string): string {
  const found = sections.find(section => section.section === key);
  if (!found || found.raw_end_offset <= found.raw_start_offset) return '';
  return rawContent.slice(found.raw_start_offset, found.raw_end_offset);
}

function itemsOf(sections: readonly SectionContent[], key: IntelligenceSectionKey): readonly { text: string; line_numbers: readonly number[] }[] {
  const found = sections.find(section => section.section === key);
  return found ? [...found.items, ...found.paragraphs] : [];
}

function importRefFor(key: IntelligenceSectionKey, line: number): string {
  const section = SECTION_BY_KEY[key];
  return `${section.label}:${line}`;
}

// ── 解析器 ──

export function parseIntelligenceMaterial(rawContent: string, options: { customer_id?: string; source_kind?: string } = {}): IntelligenceDraft {
  const warnings: string[] = [];
  // 原始字节扫描（P0-A）：不做全局归一化；span 基于原始字节位置
  const view = normalizeRawForParsing(rawContent);
  const lines = parseLines(view);
  const { sections, warnings: groupingWarnings } = groupBySections(lines, view);
  warnings.push(...groupingWarnings);
  const composite = detectCompositeBusiness(rawContent);
  if (composite) {
    warnings.push('检测到复合业务属性（功效/内容/认证/版本/售后等并存），按复合业务处理，不判定为行业冲突。');
  }
  const rawContentSha256 = sha256HexSync(rawContent);
  const customerId = options.customer_id ?? '';
  const importScopeId = buildImportScopeId({
    customerId,
    rawContentSha256,
    parserContractVersion: BATTLE_CARD_PARSER_VERSION,
    sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
    sourceKind: options.source_kind ?? 'MANUAL_PASTE',
  });
  const viewBytes = new TextEncoder().encode(view);
  const viewDecoder = new TextDecoder('utf-8', { fatal: true });
  const lineByteMap = new Map(lines.map(line => [line.line_number, line] as const));
  const sliceRawBytes = (startByte: number, endByte: number): string => {
    const boundedEnd = Math.min(endByte, viewBytes.length);
    if (startByte < 0 || boundedEnd < startByte) return '';
    try {
      return viewDecoder.decode(viewBytes.subarray(startByte, boundedEnd));
    } catch {
      return '';
    }
  };

  // 1) 候选事实：仅章节 1（主体与公开事实）内的已核事实/证据条目与普通段落；
  //    元数据行（等级/来源/边界/口径）与“已核事实/证据”标记行不进入 statement。
  const extractedFacts: DraftFact[] = [];
  const companyItems = itemsOf(sections, 'company');
  const metaLabelPattern = /^(等级|来源|边界|口径|已核事实\/证据)\s*[：:]?/;
  const preamblePattern = /^(S\d+战前判断|企业类型|编号|\d+[｜|])|战前卡$/;
  for (const item of companyItems) {
    if (item.text.length < 4) continue;
    if (metaLabelPattern.test(item.text)) continue;
    if (preamblePattern.test(item.text)) continue;
    const statement = item.text;
    const firstLine = item.line_numbers[0] ?? 0;
    const lastLine = item.line_numbers[item.line_numbers.length - 1] ?? firstLine;
    const firstLineInfo = lineByteMap.get(firstLine);
    const lastLineInfo = lineByteMap.get(lastLine);
    // P0-A：Source Span 只来自原始字节位置（半开区间，不含末尾行结束符，保留内部行结束符）
    const startByte = firstLineInfo?.content_start_byte ?? 0;
    const endByte = lastLineInfo?.content_end_byte ?? startByte;
    const sourceExcerpt = sliceRawBytes(startByte, endByte) || statement.slice(0, 200);
    const statementSha256 = sha256HexSync(statement);
    const sourceExcerptSha256 = sha256HexSync(sourceExcerpt);
    const candidateId = buildCandidateId({
      rawContentSha256,
      parserContractVersion: BATTLE_CARD_PARSER_VERSION,
      sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
      customerId,
      importScopeId,
      candidateKind: 'FACT',
      sourceSection: 'company',
      startByte,
      endByte,
      sourceExcerptSha256,
      statementSha256,
    });
    const applicability = determineApplicability(statement, composite);
    extractedFacts.push({
      fact_id: candidateId,
      fact_category: factCategoryFor(statement, 'company'),
      statement,
      confidence: 0.8,
      applicability,
      normalized_value: null,
      evidence_refs: [{ import_ref: importRefFor('company', firstLine) }],
      source_lines: item.line_numbers,
      source_section: 'company',
      source_excerpt: sourceExcerpt,
      start_byte: startByte,
      end_byte: endByte,
      excerpt_sha256: sourceExcerptSha256,
      statement_sha256: statementSha256,
      parser_contract_version: BATTLE_CARD_PARSER_VERSION,
      source_span_contract_version: SOURCE_SPAN_CONTRACT_VERSION,
    });
    if (isFormulaConditional(statement)) {
      warnings.push(`“${statement.slice(0, 40)}…”含配方/成分表述且缺少具体产品线依据，已标为 CONDITIONAL。`);
    }
  }

  // 2) 当前问题假设 → 假设（H1/H2/H3/H4 等，永不进事实）；支持 `H1（待验证）：` 双行与 `H1：xxx` 单行
  const extractedHypotheses: DraftHypothesis[] = [];
  const problemItems = itemsOf(sections, 'problem_hypotheses');
  const questionItems = itemsOf(sections, 'first_questions');
  const validationQuestions = questionItems.map(item => item.text);

  let pendingMarker: { marker: string; line_numbers: readonly number[] } | null = null;
  for (const item of problemItems) {
    const markerMatch = item.text.match(/^(H\d+)(（待验证）)?\s*[：:]\s*(.+)$/);
    if (markerMatch) {
      // 单行：`H1：xxx`
      pendingMarker = null;
      extractedHypotheses.push(makeHypothesis(extractedHypotheses.length, markerMatch[1], markerMatch[3].trim(), item.line_numbers, validationQuestions[extractedHypotheses.length] ?? null, warnings, lineByteMap, rawContentSha256, sliceRawBytes, customerId, importScopeId));
      continue;
    }
    const markerOnly = item.text.match(/^(H\d+)(（待验证）)?\s*[：:]\s*$/);
    if (markerOnly) {
      pendingMarker = { marker: markerOnly[1], line_numbers: item.line_numbers };
      continue;
    }
    if (pendingMarker) {
      if (item.text.length < 4) continue;
      extractedHypotheses.push(makeHypothesis(extractedHypotheses.length, pendingMarker.marker, item.text, [...pendingMarker.line_numbers, ...item.line_numbers], validationQuestions[extractedHypotheses.length] ?? null, warnings, lineByteMap, rawContentSha256, sliceRawBytes, customerId, importScopeId));
      pendingMarker = null;
      continue;
    }
    // P1-A：非 H 编号段落（如“以上均不是已发生事实…”边界说明）不得 fallback 成 Hypothesis。
  }

  // 3) Solution scenarios：4 章落地点场景 + 4C 实现层（含验收指标）
  const landingItems = itemsOf(sections, 'landing_points');
  const implementationItems = itemsOf(sections, 'implementation');
  const solutionScenarios: DraftScenario[] = [];
  for (const item of landingItems) {
    if (item.text.length < 4) continue;
    const scenarioName = item.text.split(/[｜|]/)[0]?.trim() ?? item.text;
    solutionScenarios.push({
      scenario_name: scenarioName.slice(0, 60),
      applicability: determineApplicability(item.text, composite),
      business_objects: [],
      problem_hypothesis: '',
      feishu_role: '',
      ai_role: '',
      human_gate: '',
      systems_not_replaced: [],
      acceptance_metrics: [],
      evidence_refs: [{ import_ref: importRefFor('landing_points', item.line_numbers[0] ?? 0) }],
      source_section: 'landing_points',
      source_excerpt: item.text.slice(0, 200),
    });
  }
  for (const item of implementationItems) {
    if (item.text.length < 4) continue;
    const layerMatch = item.text.match(/^(.+?层)[：:]\s*(.+)$/);
    const scenarioName = layerMatch ? layerMatch[1] : item.text.split(/[：:]/)[0] ?? item.text;
    const acceptanceMetrics = [
      extractByKeyword(item.text, ['验收指标', '验收', '指标']),
    ].filter((metric): metric is string => Boolean(metric && metric.trim()));
    solutionScenarios.push({
      scenario_name: scenarioName.slice(0, 60),
      applicability: determineApplicability(item.text, composite),
      business_objects: [],
      problem_hypothesis: '',
      feishu_role: '',
      ai_role: '',
      human_gate: '',
      systems_not_replaced: [],
      acceptance_metrics: acceptanceMetrics,
      evidence_refs: [{ import_ref: importRefFor('implementation', item.line_numbers[0] ?? 0) }],
      source_section: 'implementation',
      source_excerpt: item.text.slice(0, 200),
    });
  }

  // 4) 飞书话术：原始切片保真（标题后第一字符 → 下一标题前最后一字符；trim 首尾空白，内部空行/引号/标点逐字保留）
  const feishuRaw = rawBodyOf(sections, 'feishu_talk', rawContent).replace(/^\s+|\s+$/g, '');
  if (feishuRaw.length === 0) {
    warnings.push('未找到“可直接复述的飞书话术”章节；如材料缺失请人工补充。');
  }
  const feishuTalkTrack: DraftFeishuTalkTrack = {
    paragraphs: feishuRaw.split('\n'),
    value_statement: {
      original: feishuRaw,
      current: feishuRaw,
      short_spoken_version: null,
      full_spoken_version: null,
      wechat_version: null,
      version_history: [],
    },
  };

  // 5) 候选客户（只给名称候选，不猜 customer_id）。同行排除只使用这份当前输入中已解析的主体名。
  const firstContentLine = lines.find(line => !line.is_title && line.text.length >= 2);
  const firstLineCompany = firstContentLine ? extractCompanyFromFirstLine(firstContentLine.text) : null;
  const candidateCustomer = firstLineCompany
    ? { name: firstLineCompany, matched_names: [firstLineCompany] as readonly string[] }
    : null;

  // 6) 同行校准：4D 章节内字段标签 + 值区；公司列表按 `、,，;；` 拆分；group context 继承给每个 peer
  const peers = parsePeerGroup(sections, composite, warnings, candidateCustomer?.name ?? null);

  // 7) 人工确认门禁 / POC / 风险边界 / 条件适用项
  const humanGateItems = itemsOf(sections, 'human_gates');
  const humanReviewBoundaries = humanGateItems.map(item => item.text);
  const pocItems = itemsOf(sections, 'poc');
  const pocHypothesis = pocItems.length > 0 ? pocItems[0].text : null;
  const adversarialItems = itemsOf(sections, 'adversarial');
  const riskBoundaries = adversarialItems.map(item => item.text);
  // 配方/成分 条件适用信息：全文相关行（含业务主链路/解决方案/门禁），不进入 facts
  const formulaItems = new Set<string>();
  for (const line of lines) {
    if (!line.text) continue;
    if (isFormulaConditional(line.text)) formulaItems.add(line.text.slice(0, 120));
  }
  for (const fact of extractedFacts) {
    if (fact.applicability === 'CONDITIONAL') formulaItems.add(fact.statement.slice(0, 120));
  }
  const conditionalItems = [...formulaItems];
  if (conditionalItems.length === 0) {
    conditionalItems.push(...extractedFacts.filter(fact => fact.applicability === 'CONDITIONAL').map(fact => fact.statement.slice(0, 120)));
  }

  // 8) 来源映射
  const sourceMapping: SourceMappingEntry[] = sections.map(section => {
    const all = [...section.items, ...section.paragraphs];
    return {
      section: section.section,
      start_line: all[0]?.line_numbers[0] ?? 0,
      end_line: all.length > 0 ? all[all.length - 1].line_numbers[0] ?? 0 : 0,
      matched_title: SECTION_BY_KEY[section.section].label,
      item_count: all.length,
    };
  });
  if (itemsOf(sections, 'sources').length === 0) {
    warnings.push('未找到“来源”章节，材料溯源不完整。');
  }

  return {
    parser_version: BATTLE_CARD_PARSER_VERSION,
    raw_content: rawContent,
    content_hash: '',
    source_system: 'MANUAL_PASTE',
    source_label: null,
    candidate_customer: candidateCustomer,
    extracted_facts: extractedFacts,
    extracted_hypotheses: extractedHypotheses,
    solution_scenarios: solutionScenarios,
    feishu_talk_track: feishuTalkTrack,
    peer_references: peers,
    validation_questions: validationQuestions,
    human_review_boundaries: humanReviewBoundaries,
    poc_hypothesis: pocHypothesis,
    risk_boundaries: riskBoundaries,
    conditional_applicability_items: conditionalItems,
    parse_warnings: warnings,
    source_mapping: sourceMapping,
    reasoning: { mode: 'DETERMINISTIC', model_called: false },
  };
}

function makeHypothesis(
  _index: number,
  marker: string | null,
  statement: string,
  lineNumbers: readonly number[],
  question: string | null,
  warnings: string[],
  lineByteMap: ReadonlyMap<number, ParsedLine>,
  rawContentSha256: string,
  sliceRawBytes: (startByte: number, endByte: number) => string,
  customerId: string,
  importScopeId: string,
): DraftHypothesis {
  if (!question) {
    warnings.push(`假设“${statement.slice(0, 30)}…”缺少对应验证问题（首轮挖需问题不足），需人工补充。`);
  }
  const firstLine = lineNumbers[0] ?? 0;
  const lastLine = lineNumbers[lineNumbers.length - 1] ?? firstLine;
  const firstLineInfo = lineByteMap.get(firstLine);
  const lastLineInfo = lineByteMap.get(lastLine);
  // P0-A：Source Span 只来自原始字节位置（半开区间，不含末尾行结束符，保留内部行结束符）
  const startByte = firstLineInfo?.content_start_byte ?? 0;
  const endByte = lastLineInfo?.content_end_byte ?? startByte;
  const sourceExcerpt = sliceRawBytes(startByte, endByte) || statement.slice(0, 200);
  const statementSha256 = sha256HexSync(statement);
  const sourceExcerptSha256 = sha256HexSync(sourceExcerpt);
  const candidateId = buildCandidateId({
    rawContentSha256,
    parserContractVersion: BATTLE_CARD_PARSER_VERSION,
    sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
    customerId,
    importScopeId,
    candidateKind: 'HYPOTHESIS',
    sourceSection: 'problem_hypotheses',
    startByte,
    endByte,
    sourceExcerptSha256,
    statementSha256,
  });
  return {
    hypothesis_id: candidateId,
    category: 'PROBLEM',
    statement,
    rationale: marker ? `${marker} 假设` : null,
    applicability: 'CONDITIONAL',
    why_it_matters: null,
    validation_question: question,
    disconfirm_condition: null,
    evidence_refs: [{ import_ref: importRefFor('problem_hypotheses', firstLine) }],
    source_lines: lineNumbers,
    source_section: 'problem_hypotheses',
    source_excerpt: sourceExcerpt,
    start_byte: startByte,
    end_byte: endByte,
    excerpt_sha256: sourceExcerptSha256,
    statement_sha256: statementSha256,
    parser_contract_version: BATTLE_CARD_PARSER_VERSION,
    source_span_contract_version: SOURCE_SPAN_CONTRACT_VERSION,
  };
}

/** 4D 同行 group 解析：字段标签 + 值区；公司仅来自明确参照标签的值区。 */
function parsePeerGroup(
  sections: readonly SectionContent[],
  _composite: boolean,
  warnings: string[],
  parsedCompanyName: string | null,
): DraftPeerReference[] {
  const peers: DraftPeerReference[] = [];
  const peerItems = itemsOf(sections, 'peers');
  if (peerItems.length === 0) return peers;

  // 字段标签（值区在下一非空行）：体量口径提醒 / 同类硬件出海参照 / 为什么可比 / 不可直接照搬 / 可借鉴
  const labelPattern = /^(体量口径提醒|同类硬件出海参照|同体量、同阶段与同行校准|同行校准|参照对象|样本|为什么可比|不可直接照搬|不能照搬|可借鉴|借鉴)[：:]\s*$/;
  const values: Record<string, string> = {};
  let currentLabel: string | null = null;
  let companyLines: readonly { text: string; line_numbers: readonly number[] }[] = [];

  for (const item of peerItems) {
    const labelMatch = item.text.match(labelPattern);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      continue;
    }
    if (!currentLabel) continue; // 说明句/正文不进入值区
    if (item.text.length < 2) continue;
    if (currentLabel === '同类硬件出海参照' || currentLabel === '同行校准' || currentLabel === '参照对象' || currentLabel === '样本' || currentLabel === '同体量、同阶段与同行校准') {
      companyLines = [...companyLines, item];
    } else {
      values[currentLabel] = item.text;
    }
    currentLabel = null;
  }

  const whyComparable = values['为什么可比'] ?? '';
  const boundary = values['不可直接照搬'] ?? values['不能照搬'] ?? '';
  const reusable = values['可借鉴'] ?? values['借鉴'] ?? (boundary.includes('借鉴') ? boundary : '');

  // 公司列表行按 `、,，;；` 拆分；每个实体成为一个 peer 并继承 group context
  for (const line of companyLines) {
    const names = line.text.split(/[、,，;；]/).map(name => name.trim()).filter(name => name.length >= 2);
    for (const name of names) {
      if (isPeerFalsePositive(name) || isCurrentSubjectEntityCandidate(name, parsedCompanyName)) {
        warnings.push(`同行候选“${name}”被判定为字段标签/平台/系统名或当前主体，未进入 peer references。`);
        continue;
      }
      peers.push({
        company_name: name,
        comparison_level: 'SAME_INDUSTRY',
        why_comparable: whyComparable,
        reusable_pattern: reusable,
        non_transferable_boundary: boundary,
        source_refs: [{ import_ref: importRefFor('peers', line.line_numbers[0] ?? 0) }],
        source_lines: line.line_numbers,
        source_section: 'peers',
        source_excerpt: line.text.slice(0, 200),
      });
    }
  }

  // 兼容 fallback：旧式行内格式（`公司名：描述，可借鉴…；不能照搬…`），仅当无标签结构时启用
  if (peers.length === 0) {
    for (const item of peerItems) {
      const companyName = extractCompanyName(item.text);
      if (!companyName || isPeerFalsePositive(companyName) || isCurrentSubjectEntityCandidate(companyName, parsedCompanyName)) continue;
      peers.push({
        company_name: companyName,
        comparison_level: item.text.includes('跨行业') || item.text.includes('其他行业') ? 'CROSS_INDUSTRY' : 'SAME_INDUSTRY',
        why_comparable: extractByKeyword(item.text, ['可比', '为什么可比', '同行业', '同品类', '相似']) ?? '',
        reusable_pattern: extractByKeyword(item.text, ['可借鉴', '借鉴', '可复用', '复用', '可以参考']) ?? '',
        non_transferable_boundary: extractByKeyword(item.text, ['不能照搬', '不可照搬', '不适用', '边界', '差异']) ?? '',
        source_refs: [{ import_ref: importRefFor('peers', item.line_numbers[0] ?? 0) }],
        source_lines: item.line_numbers,
        source_section: 'peers',
        source_excerpt: item.text.slice(0, 200),
      });
    }
  }
  return peers;
}

/** 误识别保护：平台名、业务系统缩写、字段标签、目标客户相关词不得成为 Peer。 */
export function isPeerFalsePositive(name: string): boolean {
  const normalized = name.trim();
  if (!normalized) return true;
  const exactForbidden = new Set([
    'Amazon', 'AliExpress', 'TEMU', 'SHEIN', 'TikTok', 'Shopee', 'Amazon平台', 'TikTok Shop',
    'ERP', 'PIM', 'PLM', 'WMS', 'MES', 'LIMS', 'QMS', 'CRM',
    'TINSOL', 'Bee sting',
    '同类硬件出海参照', '同体量', '同阶段', '同城对照', '体量口径提醒', '为什么可比', '不可直接照搬',
  ]);
  if (exactForbidden.has(normalized)) return true;
  if (/(平台|系统|参照|提醒|可比|照搬|口径|阶段|体量)/.test(normalized)) return true;
  return false;
}

/**
 * 当前材料主体的通用同行排除。
 *
 * 只比较已经从当前输入解析出的公司名：不维护客户名、别名或黄金样本的专用名单。
 * 中文必须是至少四个字符的连续、非纯通用实体片段；英文必须在完整 token 边界上匹配。
 */
export function isCurrentSubjectEntityCandidate(peerCandidate: string, parsedCompanyName: string | null | undefined): boolean {
  if (!parsedCompanyName) return false;

  const candidate = stripLegalEntitySuffix(normalizeEntityName(peerCandidate));
  const subject = stripLegalEntitySuffix(normalizeEntityName(parsedCompanyName));
  if (!candidate || !subject || !hasMeaningfulSubjectEntityCandidate(candidate)) return false;
  if (candidate === subject) return true;

  const usesChinese = /[\u4e00-\u9fff]/.test(candidate) || /[\u4e00-\u9fff]/.test(subject);
  if (usesChinese) {
    // 中文没有空格 token；只允许完整的、足够长的连续片段，绝不以任意两字命中为依据。
    return candidate.length >= 4 && (subject.includes(candidate) || candidate.includes(subject));
  }

  const candidateTokens = entityTokens(peerCandidate);
  const subjectTokens = entityTokens(parsedCompanyName);
  if (candidateTokens.length === 0 || subjectTokens.length === 0) return false;
  return containsWholeTokenSequence(subjectTokens, candidateTokens)
    || containsWholeTokenSequence(candidateTokens, subjectTokens);
}

function normalizeEntityName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    // 保留业务名称中的中文、英文与数字；空格及常见分隔符不影响同一主体判断。
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
}

function stripLegalEntitySuffix(value: string): string {
  const suffixes = [
    '有限责任公司', '股份有限公司', '有限公司', '集团有限公司',
    'limited', 'ltd', 'incorporated', 'inc', 'corporation', 'corp',
  ];
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length > suffix.length) return value.slice(0, -suffix.length);
  }
  return value;
}

function hasMeaningfulSubjectEntityCandidate(normalizedCandidate: string): boolean {
  if (/[\u4e00-\u9fff]/.test(normalizedCandidate)) {
    if (normalizedCandidate.length < 4) return false;
    // 纯地区/行业/法人形式词不能单独成为主体别名。
    const properPart = normalizedCandidate.replace(/有限责任公司|股份有限公司|有限公司|集团|公司|科技|贸易|发展|智能|设备|电子|实业|网络|信息|商务|服务|产业|供应链|品牌|企业/g, '');
    return properPart.length > 0;
  }
  return normalizedCandidate.length >= 4;
}

function entityTokens(value: string): readonly string[] {
  const suffixTokens = new Set(['limited', 'ltd', 'incorporated', 'inc', 'corporation', 'corp']);
  return (value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[a-z0-9]+/g) ?? [])
    .filter(token => !suffixTokens.has(token));
}

function containsWholeTokenSequence(container: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length > container.length) return false;
  return container.some((_, start) => sequence.every((token, offset) => container[start + offset] === token));
}

function extractCompanyName(text: string): string | null {
  // 1) 强模式：明确公司主体（条目开头）
  const strong = text.match(/^([\u4e00-\u9fa5A-Za-z0-9]{2,40}?(?:有限公司|有限责任公司|集团|公司))/);
  if (strong) return strong[1];
  // 2) 弱模式：行业主体词（条目开头）
  const weak = text.match(/^([\u4e00-\u9fa5]{2,40}?(?:科技|实业|贸易|电子|数码|生物|健康|家电|电器))/);
  if (weak) return weak[1];
  // 3) 品牌名：全大写前缀 + 可选驼峰尾巴（SUPRENT、FF FlashFish）
  const brand = text.match(/^((?:[A-Z]{2,})(?:\s+[A-Z][A-Za-z0-9]+)?)/);
  if (brand && brand[1].trim().length >= 2) return brand[1].trim();
  return null;
}

/** 第一行公司名提取：`XXX有限公司 战前卡` / `编号｜XXX有限公司`；不识别章节标题。 */
function extractCompanyFromFirstLine(text: string): string | null {
  // `编号｜XXX有限公司`（全角/半角分隔符）
  const bar = text.match(/[｜|]\s*([\u4e00-\u9fa5A-Za-z0-9]{2,40}?(?:有限公司|有限责任公司|集团|公司))/);
  if (bar) return bar[1];
  // 直接以公司名开头（`某主体有限公司 战前卡`）
  const direct = text.match(/^([\u4e00-\u9fa5A-Za-z0-9]{2,40}?(?:有限公司|有限责任公司|集团|公司))/);
  if (direct) return direct[1];
  return null;
}

function extractByKeyword(text: string, keywords: readonly string[]): string | null {
  for (const keyword of keywords) {
    const index = text.indexOf(keyword);
    if (index < 0) continue;
    // 以关键词所在子句为单位：上一个分隔符后 → 下一个分隔符前
    const separators = ['，', ',', '。', '；', ';'];
    let clauseStart = -1;
    for (const separator of separators) {
      const at = text.lastIndexOf(separator, index);
      if (at > clauseStart) clauseStart = at;
    }
    clauseStart += 1;
    let clauseEnd = -1;
    for (const separator of separators) {
      const at = text.indexOf(separator, index);
      if (at >= 0 && (clauseEnd < 0 || at < clauseEnd)) clauseEnd = at;
    }
    const segment = text.slice(clauseStart, clauseEnd < 0 ? text.length : clauseEnd).trim();
    if (segment.length > 0) return segment;
  }
  return null;
}

export function makeFeishuValueStatement(original: string): FeishuValueStatement {
  return {
    original,
    current: original,
    short_spoken_version: null,
    full_spoken_version: null,
    wechat_version: null,
    version_history: [],
  };
}

/** Stage 2 可选注入点：仅当 Production AI Provider 配置且用户明确发起时由调用方传入。 */
export type ModelEnhancement = (draft: IntelligenceDraft) => Promise<IntelligenceDraft>;
