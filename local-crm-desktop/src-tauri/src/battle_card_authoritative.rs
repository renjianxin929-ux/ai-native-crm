//! Battle Card Authoritative Candidate Parser V1 (Rust).
//!
//! 与 TypeScript parser（src/lib/battleCard/parser.ts）**同规则**地从 raw_content
//! 重新生成权威候选（Fact / Hypothesis），供 atomic import command 在事务内
//! 建立 Candidate ID → Candidate Map，并拒绝任何无法匹配的 Renderer 提交。
//!
//! 一致性契约：
//! - 原始 UTF-8 字节视图：Source Span / excerpt / candidate ID 均直接基于 raw_content；
//! - 章节识别、行/条目分组、Fact/Hypothesis 提取规则与 TS 逐字同源；
//! - 适用性判定读取共享合同 applicability-contract-v1.json（与 TS 同一文件）；
//! - Candidate ID = SHA-256(canonical envelope)（与 TS buildCandidateId 同算法）。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PARSER_CONTRACT_VERSION: &str = "battle-card-parser-v1";
pub const SOURCE_SPAN_CONTRACT_VERSION: &str = "battle-card-source-span-v1";
const CONTRACT_JSON: &str = include_str!("../../src/lib/battleCard/applicability-contract-v1.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicabilityContractV1 {
  pub contract_version: String,
  pub normalization: ContractNormalization,
  pub precedence: Vec<String>,
  pub terms: ContractTerms,
  pub formula_priority: ContractFormulaPriority,
  pub composite_fallback: ContractCompositeFallback,
  #[serde(default)]
  pub golden_vectors: Vec<ContractVector>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractNormalization {
  pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractTerms {
  pub GLOBAL: Vec<String>,
  pub PARTIAL: Vec<String>,
  pub CONDITIONAL: Vec<String>,
  pub UNSUPPORTED: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractFormulaPriority {
  pub rule: String,
  pub formula_terms: Vec<String>,
  pub product_line_basis_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractCompositeFallback {
  pub rule: String,
  pub composite_terms: Vec<String>,
  pub composite_threshold: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractVector {
  pub statement: String,
  pub expected: String,
}

/// 共享合同实例（模块加载时解析一次；JSON 失败即 panic——合同文件必须存在）。
pub static CONTRACT: std::sync::LazyLock<ApplicabilityContractV1> =
  std::sync::LazyLock::new(|| serde_json::from_str(CONTRACT_JSON).expect("applicability contract v1 must parse"));

pub fn contract_version() -> &'static str {
  &CONTRACT.contract_version
}

pub fn contract_normalize(text: &str) -> String {
  text.to_lowercase()
}

pub fn is_formula_conditional_by_contract(statement: &str) -> bool {
  let text = contract_normalize(statement);
  let has_formula = CONTRACT
    .formula_priority
    .formula_terms
    .iter()
    .any(|term| text.contains(&contract_normalize(term)));
  let has_product_line_basis = CONTRACT
    .formula_priority
    .product_line_basis_terms
    .iter()
    .any(|term| text.contains(&contract_normalize(term)));
  has_formula && !has_product_line_basis
}

pub fn detect_composite_business_by_contract(text: &str) -> bool {
  let normalized = contract_normalize(text);
  let hits = CONTRACT
    .composite_fallback
    .composite_terms
    .iter()
    .filter(|term| normalized.contains(&contract_normalize(term)))
    .count();
  hits >= CONTRACT.composite_fallback.composite_threshold
}

/// 合同驱动权威适用性判定（与 TS determineApplicabilityByContract 同规则）。
pub fn authoritative_applicability(statement: &str, context_composite: bool) -> &'static str {
  let text = contract_normalize(statement);
  if is_formula_conditional_by_contract(statement) {
    return "CONDITIONAL";
  }
  if CONTRACT.terms.GLOBAL.iter().any(|term| text.contains(&contract_normalize(term))) {
    return "GLOBAL";
  }
  if CONTRACT.terms.PARTIAL.iter().any(|term| text.contains(&contract_normalize(term))) {
    return "PARTIAL";
  }
  if CONTRACT.terms.CONDITIONAL.iter().any(|term| text.contains(&contract_normalize(term))) {
    return "CONDITIONAL";
  }
  if CONTRACT.terms.UNSUPPORTED.iter().any(|term| text.contains(&contract_normalize(term))) {
    return "UNSUPPORTED";
  }
  if context_composite {
    "GLOBAL"
  } else {
    "CONDITIONAL"
  }
}

pub fn sha256_hex(input: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(input);
  let digest = hasher.finalize();
  digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ── 原始字节行解析（与 TS parseLines 的 raw-byte 语义对齐）──

fn normalize_full_width(text: &str) -> String {
  let mut result = String::with_capacity(text.len());
  for character in text.chars() {
    let code = character as u32;
    if code == 0x3000 {
      result.push(' ');
    } else if (0xff01..=0xff5e).contains(&code) {
      result.push(char::from_u32(code - 0xfee0).unwrap_or(character));
    } else {
      result.push(character);
    }
  }
  result
}

fn normalize_line(text: &str) -> String {
  let mut result = text
    .replace("**", "")
    .trim()
    .to_string();
  if let Some(rest) = result.strip_prefix('#') {
    let rest = rest.trim_start_matches('#').trim_start();
    result = rest.to_string();
  }
  for prefix in ["- ", "* ", "• "] {
    if let Some(rest) = result.strip_prefix(prefix) {
      result = rest.to_string();
      break;
    }
  }
  if let Some(rest) = strip_numbered_prefix(&result) {
    result = rest.to_string();
  }
  if let Some(rest) = result.strip_prefix('【').and_then(|r| r.find('】').map(|end| &r[end + 1..])) {
    result = rest.trim_start().to_string();
  }
  result.trim().to_string()
}

fn strip_numbered_prefix(text: &str) -> Option<&str> {
  let digit_len = text.chars().take_while(|c| c.is_ascii_digit()).map(|c| c.len_utf8()).sum::<usize>();
  if digit_len > 0 {
    let rest = &text[digit_len..];
    if let Some(first) = rest.chars().next() {
      if matches!(first, '.' | '、' | '）' | ')') {
        return Some(&rest[first.len_utf8()..]);
      }
    }
  }
  // 中文数字
  let cn = "一二三四五六七八九十";
  let mut cn_len = 0;
  for ch in text.chars() {
    if cn.contains(ch) {
      cn_len += ch.len_utf8();
    } else {
      break;
    }
  }
  if cn_len > 0 {
    let rest = &text[cn_len..];
    if let Some(first) = rest.chars().next() {
      if matches!(first, '、' | '.') {
        return Some(&rest[first.len_utf8()..]);
      }
    }
  }
  None
}

#[derive(Debug, Clone)]
struct ParsedLine {
  line_number: usize,
  /// 当前行在原始 UTF-8 bytes 中的起点（含正文，不含前一行的行结束符）。
  raw_start_byte: usize,
  text: String,
  /// 未去除前后空白、未含行结束符的原始行正文。
  raw_text: String,
  /// 仅供标题/编号/业务规则判断使用，绝不能作为 Source Span 的坐标来源。
  normalized_text_for_matching: String,
  is_title: bool,
  is_item: bool,
  title: Option<String>,
  content_start_byte: usize,
  content_end_byte: usize,
  /// 当前行在原始 UTF-8 bytes 中的半开结束位置，包含 LF 或 CRLF。
  raw_end_byte: usize,
  line_ending: &'static str,
}

/// 章节 key（与 TS IntelligenceSectionKey 对齐；仅权威解析需要的章节）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionKey {
  Company,
  ProblemHypotheses,
  Other,
}

fn section_key_of(key: &str) -> SectionKey {
  match key {
    "company" => SectionKey::Company,
    "problem_hypotheses" => SectionKey::ProblemHypotheses,
    _ => SectionKey::Other,
  }
}

/// 章节定义（与 TS INTELLIGENCE_SECTIONS 全部 14 章节同源；非目标章节映射 other）。
const SECTIONS: &[(&str, &str, &[&str])] = &[
  ("company", "主体与公开事实", &["公司主体", "公开事实", "企业主体", "主体", "主体与事实"]),
  ("other", "五维战前画像", &["五维画像", "战前画像", "五维"]),
  ("problem_hypotheses", "当前问题假设", &["问题假设", "痛点假设", "假设"]),
  ("other", "FDE/FDA 推荐落地点", &["FDE/FDA", "FDE", "FDA", "推荐落地点", "落地点", "FDE/FDA推荐落地点"]),
  ("other", "为什么值得验证", &["值得验证", "验证价值", "为什么值得", "为什么确认这个痛点值得优先验证", "为什么确认", "痛点值得优先验证"]),
  ("other", "可直接复述的飞书话术", &["飞书话术", "可复述话术", "话术", "可以直接复述的飞书解决方法话术", "飞书解决方法话术"]),
  ("other", "具体实现路径", &["实现路径", "实施路径", "具体路径", "针对本公司的具体实现路径", "针对本公司"]),
  ("other", "同行校准", &["同行参照", "同行", "竞品参照", "竞品", "同体量、同阶段与同行校准", "同体量同阶段与同行校准", "同体量"]),
  ("other", "首轮挖需问题", &["挖需问题", "首轮问题", "挖需"]),
  ("other", "人工确认门禁", &["确认门禁", "人工门禁", "门禁"]),
  ("other", "POC 路径", &["POC", "试点路径", "试点", "两周POC最小路径", "两周POC"]),
  ("other", "对抗式审查", &["对抗审查", "对抗"]),
  ("other", "建议推进", &["推进建议", "建议"]),
  ("other", "来源", &["参考来源", "资料来源", "信息来源"]),
];

fn match_section(title: &str) -> Option<&'static str> {
  let normalized = title.trim().to_uppercase();
  for (key, label, aliases) in SECTIONS {
    if normalized == label.to_uppercase() {
      return Some(key);
    }
    if aliases.iter().any(|alias| normalized == alias.to_uppercase()) {
      return Some(key);
    }
  }
  // 宽松包含匹配（要求长度 >= 4）
  for (key, label, aliases) in SECTIONS {
    if label.chars().count() >= 4 && normalized.contains(&label.to_uppercase()) {
      return Some(key);
    }
    for alias in *aliases {
      if alias.chars().count() >= 4 && normalized.contains(&alias.to_uppercase()) {
        return Some(key);
      }
    }
  }
  None
}

fn detect_numbered_title(text: &str) -> Option<String> {
  let normalized = normalize_full_width(text.trim());
  // 数字/中文数字 + 分隔符 + 内容
  let (prefix_len, _) = numbered_prefix_len(&normalized)?;
  let rest = &normalized[prefix_len..];
  if rest.chars().count() < 2 {
    return None;
  }
  match_section(rest).map(|_| rest.to_string())
}

fn numbered_prefix_len(text: &str) -> Option<(usize, String)> {
  let digit_len = text.chars().take_while(|c| c.is_ascii_digit()).map(|c| c.len_utf8()).sum::<usize>();
  if digit_len > 0 {
    let rest = &text[digit_len..];
    if let Some(first) = rest.chars().next() {
      if matches!(first, '.' | '、' | '．' | '。' | ')' | '）' | ':' | '：') {
        return Some((digit_len + first.len_utf8(), String::from("num")));
      }
    }
  }
  let cn = "一二三四五六七八九十";
  let mut cn_len = 0;
  for ch in text.chars() {
    if cn.contains(ch) {
      cn_len += ch.len_utf8();
    } else {
      break;
    }
  }
  if cn_len > 0 {
    let rest = &text[cn_len..];
    if let Some(first) = rest.chars().next() {
      if matches!(first, '.' | '、' | '．' | '。' | ')' | '）' | ':' | '：') {
        return Some((cn_len + first.len_utf8(), String::from("cn")));
      }
    }
  }
  None
}

fn is_item_line(text: &str) -> bool {
  let digit_len = text.chars().take_while(|c| c.is_ascii_digit()).map(|c| c.len_utf8()).sum::<usize>();
  if digit_len > 0 {
    let rest = &text[digit_len..];
    if let Some(first) = rest.chars().next() {
      if matches!(first, '.' | '、' | '）' | ')') {
        return true;
      }
    }
  }
  let cn = "一二三四五六七八九十";
  let mut cn_len = 0;
  for ch in text.chars() {
    if cn.contains(ch) {
      cn_len += ch.len_utf8();
    } else {
      break;
    }
  }
  if cn_len > 0 {
    if let Some(first) = text[cn_len..].chars().next() {
      if matches!(first, '、' | '.') {
        return true;
      }
    }
  }
  text.starts_with("- ") || text.starts_with("* ") || text.starts_with("• ")
}

fn markdown_heading(text: &str) -> Option<String> {
  let mut hash_count = 0usize;
  let mut byte_index = 0usize;
  for ch in text.chars() {
    if ch == '#' {
      hash_count += 1;
      byte_index += ch.len_utf8();
      if hash_count > 6 {
        return None;
      }
    } else if ch.is_whitespace() && hash_count >= 1 && hash_count <= 6 {
      let rest = text[byte_index..].trim_start();
      if rest.is_empty() {
        return None;
      }
      return Some(normalize_line(rest));
    } else {
      return None;
    }
  }
  None
}

fn parse_lines(raw_content: &str) -> Vec<ParsedLine> {
  let mut result: Vec<ParsedLine> = Vec::new();
  let bytes = raw_content.as_bytes();
  let mut raw_start_byte = 0usize;
  let mut line_number = 1usize;

  while raw_start_byte < bytes.len() {
    let mut cursor = raw_start_byte;
    while cursor < bytes.len() && bytes[cursor] != b'\n' {
      cursor += 1;
    }
    let (content_end_byte, raw_end_byte, line_ending) = if cursor == bytes.len() {
      (cursor, cursor, "NONE")
    } else if cursor > raw_start_byte && bytes[cursor - 1] == b'\r' {
      (cursor - 1, cursor + 1, "CRLF")
    } else {
      (cursor, cursor + 1, "LF")
    };
    let content_start_byte = raw_start_byte;
    debug_assert!(raw_content.is_char_boundary(content_start_byte));
    debug_assert!(raw_content.is_char_boundary(content_end_byte));
    let raw_text = raw_content[content_start_byte..content_end_byte].to_string();
    let normalized_text_for_matching = raw_text.trim().to_string();
    let trimmed = normalized_text_for_matching.as_str();
    if !trimmed.is_empty() {
      if let Some(heading_text) = markdown_heading(trimmed) {
        result.push(ParsedLine { line_number, raw_start_byte, text: heading_text.clone(), raw_text, normalized_text_for_matching, is_title: true, is_item: false, title: Some(heading_text), content_start_byte, content_end_byte, raw_end_byte, line_ending });
      } else if let Some(numbered_title) = detect_numbered_title(trimmed) {
        result.push(ParsedLine { line_number, raw_start_byte, text: numbered_title.clone(), raw_text, normalized_text_for_matching, is_title: true, is_item: false, title: Some(numbered_title), content_start_byte, content_end_byte, raw_end_byte, line_ending });
      } else {
        let text = normalize_line(trimmed);
        let is_item = is_item_line(trimmed);
        result.push(ParsedLine { line_number, raw_start_byte, text, raw_text, normalized_text_for_matching, is_title: false, is_item, title: None, content_start_byte, content_end_byte, raw_end_byte, line_ending });
      }
    } else {
      result.push(ParsedLine { line_number, raw_start_byte, text: String::new(), raw_text, normalized_text_for_matching, is_title: false, is_item: false, title: None, content_start_byte, content_end_byte, raw_end_byte, line_ending });
    }
    raw_start_byte = raw_end_byte;
    line_number += 1;
  }
  result.retain(|line| !line.text.is_empty() || line.is_title);
  result
}

#[derive(Debug, Clone)]
struct SectionContent {
  key: String,
  items: Vec<SectionItem>,
  paragraphs: Vec<SectionItem>,
}

#[derive(Debug, Clone)]
struct SectionItem {
  text: String,
  line_numbers: Vec<usize>,
}

fn group_by_sections(lines: &[ParsedLine]) -> Vec<SectionContent> {
  let mut sections: Vec<SectionContent> = Vec::new();
  let mut current_key: Option<String> = None;
  for line in lines {
    if line.is_title {
      if let Some(title) = &line.title {
        if let Some(key) = match_section(title) {
          current_key = Some(key.to_string());
          continue;
        }
      }
    }
    if let Some(key) = &current_key {
      let section_index = sections.iter().position(|section| &section.key == key);
      let section_index = match section_index {
        Some(index) => index,
        None => {
          sections.push(SectionContent { key: key.clone(), items: Vec::new(), paragraphs: Vec::new() });
          sections.len() - 1
        }
      };
      if line.text.is_empty() {
        continue;
      }
      let item = SectionItem { text: line.text.clone(), line_numbers: vec![line.line_number] };
      if line.is_item {
        sections[section_index].items.push(item);
      } else {
        sections[section_index].paragraphs.push(item);
      }
    }
  }
  sections
}

fn items_of<'a>(sections: &'a [SectionContent], key: &str) -> Vec<&'a SectionItem> {
  let mut result: Vec<&'a SectionItem> = Vec::new();
  if let Some(section) = sections.iter().find(|section| section.key == key) {
    result.extend(section.items.iter());
    result.extend(section.paragraphs.iter());
  }
  result
}

fn line_byte_map(lines: &[ParsedLine]) -> HashMap<usize, &ParsedLine> {
  lines.iter().map(|line| (line.line_number, line)).collect()
}

// ── 权威候选 ──

#[derive(Debug, Clone, Serialize)]
pub struct AuthoritativeCandidate {
  pub candidate_id: String,
  pub candidate_kind: String,
  pub statement: String,
  pub statement_sha256: String,
  pub source_section: String,
  pub start_byte: usize,
  pub end_byte: usize,
  pub excerpt: String,
  pub excerpt_sha256: String,
  pub applicability: String,
  /// FACT 专属：TS factCategoryFor 同规则（COMPANY/MARKET/CERTIFICATION/...）。
  #[serde(default)]
  pub fact_category: String,
  /// HYPOTHESIS 专属：如 "H1 假设"（TS makeHypothesis rationale 同规则）。
  #[serde(default)]
  pub rationale: Option<String>,
  /// HYPOTHESIS 专属：首轮挖需问题（TS validationQuestions[index] 同规则）。
  #[serde(default)]
  pub validation_question: Option<String>,
}

/// Candidate ID：SHA-256(canonical envelope)，与 TS buildCandidateId 同算法（含 customer/scope 绑定）。
pub fn build_candidate_id(
  raw_content_sha256: &str,
  parser_contract_version: &str,
  source_span_contract_version: &str,
  customer_id: &str,
  import_scope_id: &str,
  candidate_kind: &str,
  source_section: &str,
  start_byte: usize,
  end_byte: usize,
  source_excerpt_sha256: &str,
  statement_sha256: &str,
) -> String {
  let envelope = serde_json::json!({
    "raw_content_sha256": raw_content_sha256,
    "parser_contract_version": parser_contract_version,
    "source_span_contract_version": source_span_contract_version,
    "customer_id": customer_id,
    "import_scope_id": import_scope_id,
    "candidate_kind": candidate_kind,
    "source_section": source_section,
    "start_byte": start_byte,
    "end_byte": end_byte,
    "source_excerpt_sha256": source_excerpt_sha256,
    "statement_sha256": statement_sha256,
  });
  // serde_json 默认 Map = BTreeMap（键排序）+ 紧凑序列化 → 与 TS canonicalJsonStringify 一致
  let canonical = serde_json::to_string(&envelope).expect("candidate envelope must serialize");
  sha256_hex(canonical.as_bytes())
}

/// Authoritative Import Scope：与 TS buildImportScopeId 同算法。
pub fn build_import_scope_id(
  customer_id: &str,
  raw_content_sha256: &str,
  parser_contract_version: &str,
  source_span_contract_version: &str,
  source_kind: &str,
) -> String {
  let envelope = serde_json::json!({
    "customer_id": customer_id,
    "raw_content_sha256": raw_content_sha256,
    "parser_contract_version": parser_contract_version,
    "source_span_contract_version": source_span_contract_version,
    "source_kind": source_kind,
  });
  let canonical = serde_json::to_string(&envelope).expect("import scope envelope must serialize");
  sha256_hex(canonical.as_bytes())
}

#[derive(Debug, Clone)]
pub struct AuthoritativeDraft {
  pub raw_content_sha256: String,
  pub import_scope_id: String,
  pub composite: bool,
  pub candidates: Vec<AuthoritativeCandidate>,
}

/// TS factCategoryFor 同规则（company 章节）。
fn fact_category_for(statement: &str) -> &'static str {
  const CATEGORY_KEYWORDS: &[(&str, &[&str])] = &[
    ("CERTIFICATION", &["认证", "CE", "FCC", "UL", "RoHS", "质检"]),
    ("CHANNEL", &["达人", "内容", "平台", "亚马逊", "TikTok", "Shopee", "独立站", "直播", "分销"]),
    ("MARKET", &["出海", "多国家", "海外", "跨境", "国家", "版本", "地区"]),
    ("PRODUCT", &["产品", "小家电", "功效", "配方", "成分", "型号", "硬件"]),
    ("OPERATION", &["售后", "VOC", "包装", "说明书", "物流", "库存", "客服"]),
  ];
  for (category, keywords) in CATEGORY_KEYWORDS {
    if keywords.iter().any(|keyword| statement.contains(*keyword)) {
      return category;
    }
  }
  "COMPANY"
}

/// 权威重新解析：与 TS parseIntelligenceMaterial 的 Fact/Hypothesis 提取规则逐字同源。
pub fn parse_authoritative_material(raw_content: &str, customer_id: &str, source_kind: &str) -> AuthoritativeDraft {
  // Source spans must stay anchored to raw_content. Matching normalizes only a
  // per-line view after its raw byte range has been captured by parse_lines.
  let lines = parse_lines(raw_content);
  let sections = group_by_sections(&lines);
  let byte_map = line_byte_map(&lines);
  let raw_content_sha256 = sha256_hex(raw_content.as_bytes());
  let composite = detect_composite_business_by_contract(raw_content);
  let raw_content_bytes = raw_content.as_bytes();
  let import_scope_id = build_import_scope_id(
    customer_id,
    &raw_content_sha256,
    PARSER_CONTRACT_VERSION,
    SOURCE_SPAN_CONTRACT_VERSION,
    source_kind,
  );

  let mut candidates: Vec<AuthoritativeCandidate> = Vec::new();

  // 1) Fact 候选：仅 company 章节（与 TS metaLabelPattern / preamblePattern 同规则）
  let meta_label = |text: &str| -> bool {
    let prefixes = ["等级", "来源", "边界", "口径", "已核事实/证据"];
    prefixes.iter().any(|prefix| {
      text.starts_with(prefix)
        && text[prefix.len()..].chars().next().map(|c| c == '：' || c == ':').unwrap_or(false)
          || text.starts_with(prefix) && text[prefix.len()..].is_empty()
    })
  };
  let preamble = |text: &str| -> bool {
    text.starts_with("S") && text.contains("战前判断")
      || text.starts_with("企业类型")
      || text.starts_with("编号")
      || text.contains("战前卡")
      || text.starts_with(|c: char| c.is_ascii_digit()) && text.contains('｜')
      || text.starts_with(|c: char| c.is_ascii_digit()) && text.contains('|')
  };

  for item in items_of(&sections, "company") {
    let statement = item.text.trim();
    if statement.chars().count() < 4 {
      continue;
    }
    if meta_label(statement) {
      continue;
    }
    if preamble(statement) {
      continue;
    }
    let first_line = item.line_numbers.first().copied().unwrap_or(0);
    let last_line = item.line_numbers.last().copied().unwrap_or(first_line);
    // P0-A：Source Span 只来自原始字节位置（半开区间，不含末尾行结束符，保留内部行结束符）
    let start_byte = byte_map.get(&first_line).map(|line| line.content_start_byte).unwrap_or(0);
    let end_byte = byte_map.get(&last_line).map(|line| line.content_end_byte).unwrap_or(start_byte);
    let excerpt = std::str::from_utf8(&raw_content_bytes[start_byte..end_byte])
      .expect("candidate spans must be valid raw UTF-8 boundaries")
      .to_string();
    let statement_sha256 = sha256_hex(statement.as_bytes());
    let source_excerpt_sha256 = sha256_hex(excerpt.as_bytes());
    let candidate_id = build_candidate_id(
      &raw_content_sha256,
      PARSER_CONTRACT_VERSION,
      SOURCE_SPAN_CONTRACT_VERSION,
      customer_id,
      &import_scope_id,
      "FACT",
      "company",
      start_byte,
      end_byte,
      &source_excerpt_sha256,
      &statement_sha256,
    );
    let applicability = authoritative_applicability(statement, composite).to_string();
    let fact_category = fact_category_for(statement).to_string();
    candidates.push(AuthoritativeCandidate {
      candidate_id,
      candidate_kind: "FACT".into(),
      statement: statement.to_string(),
      statement_sha256,
      source_section: "company".into(),
      start_byte,
      end_byte,
      excerpt,
      excerpt_sha256: source_excerpt_sha256,
      applicability,
      fact_category,
      rationale: None,
      validation_question: None,
    });
  }

  // 2) Hypothesis 候选：仅显式 H 编号项（与 TS 同规则；无编号段落不 fallback）
  //    首轮挖需问题按假设提取顺序关联（TS validationQuestions[index] 同规则）
  let validation_questions: Vec<String> = items_of(&sections, "first_questions")
    .iter()
    .map(|item| item.text.trim().to_string())
    .collect();
  let question_items = items_of(&sections, "problem_hypotheses");
  let mut pending_marker: Option<(String, Vec<usize>)> = None;
  let mut hypothesis_order: usize = 0;
  for item in question_items {
    let text = item.text.trim();
    let marker_match = marker_of(text);
    if let Some((marker, content)) = marker_match {
      if !content.is_empty() {
        // 单行：H1：xxx
        pending_marker = None;
        let lines = item.line_numbers.clone();
        push_hypothesis_candidate(
          &mut candidates,
          &raw_content_sha256,
          raw_content_bytes,
          &byte_map,
          &lines,
          &content,
          &marker,
          validation_questions.get(hypothesis_order).cloned(),
          customer_id,
          &import_scope_id,
        );
        hypothesis_order += 1;
        continue;
      }
      // markerOnly：H1（待验证）：
      pending_marker = Some((marker, item.line_numbers.clone()));
      continue;
    }
    if let Some((marker, marker_lines)) = &pending_marker {
      if text.chars().count() < 4 {
        continue;
      }
      let mut lines = marker_lines.clone();
      lines.extend(item.line_numbers.iter().copied());
      push_hypothesis_candidate(
        &mut candidates,
        &raw_content_sha256,
          raw_content_bytes,
        &byte_map,
        &lines,
        text,
        marker,
        validation_questions.get(hypothesis_order).cloned(),
        customer_id,
        &import_scope_id,
      );
      hypothesis_order += 1;
      pending_marker = None;
      continue;
    }
    // P1-A：非 H 编号段落（边界说明等）不得成为 Hypothesis。
  }

  AuthoritativeDraft { raw_content_sha256, import_scope_id, composite, candidates }
}

fn marker_of(text: &str) -> Option<(String, String)> {
  // /^(H\d+)(（待验证）)?\s*[：:]\s*(.+)$/
  let rest = text.strip_prefix('H')?;
  let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
  if digits.is_empty() {
    return None;
  }
  let after = &rest[digits.len()..];
  let after = after.strip_prefix("（待验证）").unwrap_or(after);
  let after = after.strip_prefix("(待验证)").unwrap_or(after);
  let after = after.trim_start();
  let sep = after.chars().next()?;
  if sep != '：' && sep != ':' {
    return None;
  }
  let content = after[sep.len_utf8()..].trim().to_string();
  Some((format!("H{digits}"), content))
}

fn push_hypothesis_candidate(
  candidates: &mut Vec<AuthoritativeCandidate>,
  raw_content_sha256: &str,
  raw_content_bytes: &[u8],
  byte_map: &HashMap<usize, &ParsedLine>,
  lines: &[usize],
  statement: &str,
  marker: &str,
  validation_question: Option<String>,
  customer_id: &str,
  import_scope_id: &str,
) {
  let first_line = lines.first().copied().unwrap_or(0);
  let last_line = lines.last().copied().unwrap_or(first_line);
  // P0-A：Source Span 只来自原始字节位置（半开区间，不含末尾行结束符，保留内部行结束符）
  let start_byte = byte_map.get(&first_line).map(|line| line.content_start_byte).unwrap_or(0);
  let end_byte = byte_map.get(&last_line).map(|line| line.content_end_byte).unwrap_or(start_byte);
  let excerpt = std::str::from_utf8(&raw_content_bytes[start_byte..end_byte])
    .expect("candidate spans must be valid raw UTF-8 boundaries")
    .to_string();
  let statement_sha256 = sha256_hex(statement.as_bytes());
  let source_excerpt_sha256 = sha256_hex(excerpt.as_bytes());
  let candidate_id = build_candidate_id(
    raw_content_sha256,
    PARSER_CONTRACT_VERSION,
    SOURCE_SPAN_CONTRACT_VERSION,
    customer_id,
    import_scope_id,
    "HYPOTHESIS",
    "problem_hypotheses",
    start_byte,
    end_byte,
    &source_excerpt_sha256,
    &statement_sha256,
  );
  candidates.push(AuthoritativeCandidate {
    candidate_id,
    candidate_kind: "HYPOTHESIS".into(),
    statement: statement.to_string(),
    statement_sha256,
    source_section: "problem_hypotheses".into(),
    start_byte,
    end_byte,
    excerpt,
    excerpt_sha256: source_excerpt_sha256,
    applicability: "CONDITIONAL".into(),
    fact_category: String::new(),
    rationale: Some(format!("{marker} 假设")),
    validation_question,
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Test-only bridge: the TypeScript parity suite supplies fixtures through a
  /// temporary JSON file, then this calls the real production parser for each
  /// case. It is compiled only under `cfg(test)` and does not alter runtime
  /// parsing, DTOs, or transaction behavior.
  #[derive(Debug, serde::Deserialize)]
  struct ParityFixture {
    fixture_id: String,
    raw_content: String,
    customer_id: String,
    source_kind: String,
  }

  fn parity_case_from_fixture(fixture: &ParityFixture) -> serde_json::Value {
    let draft = parse_authoritative_material(
      &fixture.raw_content,
      &fixture.customer_id,
      &fixture.source_kind,
    );

    let candidates: Vec<_> = draft
      .candidates
      .iter()
      .map(|candidate| {
        assert!(fixture.raw_content.is_char_boundary(candidate.start_byte), "{} start must be a UTF-8 boundary", candidate.candidate_id);
        assert!(fixture.raw_content.is_char_boundary(candidate.end_byte), "{} end must be a UTF-8 boundary", candidate.candidate_id);
        let raw_excerpt = &fixture.raw_content.as_bytes()[candidate.start_byte..candidate.end_byte];
        assert_eq!(candidate.excerpt.as_bytes(), raw_excerpt, "{} source_excerpt must equal the raw UTF-8 byte span", candidate.candidate_id);
        assert_eq!(candidate.excerpt_sha256, sha256_hex(raw_excerpt), "{} source_excerpt SHA must cover the raw UTF-8 byte span", candidate.candidate_id);
        serde_json::json!({
          "candidate_kind": candidate.candidate_kind,
          "candidate_id": candidate.candidate_id,
          "import_scope_id": draft.import_scope_id,
          "source_section": candidate.source_section,
          "start_byte": candidate.start_byte,
          "end_byte": candidate.end_byte,
          "source_excerpt": candidate.excerpt,
          "source_excerpt_utf8_bytes": raw_excerpt,
          "source_excerpt_sha256": candidate.excerpt_sha256,
          "statement": candidate.statement,
          "statement_sha256": candidate.statement_sha256,
          "applicability": candidate.applicability,
          "fact_category": candidate.fact_category,
          "rationale": candidate.rationale,
          "validation_question": candidate.validation_question,
          "parser_contract_version": PARSER_CONTRACT_VERSION,
          "source_span_contract_version": SOURCE_SPAN_CONTRACT_VERSION,
        })
      })
      .collect();

    serde_json::json!({
      "fixture_id": fixture.fixture_id,
      "raw_content_sha256": draft.raw_content_sha256,
      "import_scope_id": draft.import_scope_id,
      "parser_contract_version": PARSER_CONTRACT_VERSION,
      "source_span_contract_version": SOURCE_SPAN_CONTRACT_VERSION,
      "candidates": candidates,
    })
  }

  #[test]
  fn contract_version_is_v1() {
    assert_eq!(contract_version(), "battle-card-applicability-v1");
  }

  #[test]
  fn contract_has_100_plus_golden_vectors() {
    assert!(CONTRACT.golden_vectors.len() >= 100);
  }

  #[test]
  fn every_golden_vector_passes_composite_true() {
    for vector in &CONTRACT.golden_vectors {
      let actual = authoritative_applicability(&vector.statement, true);
      assert_eq!(actual, vector.expected, "statement: {}", vector.statement);
    }
  }

  #[test]
  fn every_golden_vector_passes_composite_false() {
    for vector in &CONTRACT.golden_vectors {
      let actual = authoritative_applicability(&vector.statement, false);
      assert_eq!(actual, vector.expected, "statement: {}", vector.statement);
    }
  }

  #[test]
  fn voc_case_variants_identical_across_normalization() {
    assert_eq!(authoritative_applicability("VOC数据回流给产品团队。", true), "CONDITIONAL");
    assert_eq!(authoritative_applicability("voc数据回流给产品团队。", true), "CONDITIONAL");
    assert_eq!(authoritative_applicability("Voc 分析报告。", true), "CONDITIONAL");
    assert!(is_formula_conditional_by_contract("产品配方温和。"));
    assert!(!is_formula_conditional_by_contract("配方有产品线依据。"));
  }

  #[test]
  fn composite_fallback_rules() {
    assert!(detect_composite_business_by_contract("功效、内容、达人、版本、电压并存"));
    assert!(!detect_composite_business_by_contract("功效与内容"));
    assert_eq!(authoritative_applicability("公司专注消费电子。", false), "CONDITIONAL");
    assert_eq!(authoritative_applicability("公司专注消费电子。", true), "GLOBAL");
  }

  #[test]
  fn crlf_candidates_reconstruct_from_original_utf8_bytes() {
    if let Some(fixture_path) = std::env::var_os("BATTLE_CARD_PARITY_FIXTURE_FILE") {
      let fixture_json = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|error| panic!("cannot read BATTLE_CARD_PARITY_FIXTURE_FILE {:?}: {error}", fixture_path));
      let fixtures: Vec<ParityFixture> = serde_json::from_str(&fixture_json)
        .unwrap_or_else(|error| panic!("BATTLE_CARD_PARITY_FIXTURE_FILE must contain a JSON fixture array: {error}"));
      assert!(!fixtures.is_empty(), "BATTLE_CARD_PARITY_FIXTURE_FILE must contain at least one fixture");
      let parity_cases: Vec<_> = fixtures.iter().map(parity_case_from_fixture).collect();
      println!("BATTLE_CARD_RUST_PARITY_JSON:{}", serde_json::to_string(&serde_json::json!({ "cases": parity_cases })).unwrap());
      return;
    }

    // Reproducer: every candidate span, excerpt hash, and ID must be rebuilt
    // directly from the unmodified CRLF source, including Chinese and emoji.
    const RAW: &str = "# 主体与公开事实\r\n广州电秀科技发展有限公司专注生活电器与个人护理小家电。\r\n官方案例披露2023年在Amazon销售额突破7000万元。😊\r\n产品配方与成分属于在售商品的一部分。\r\n# 当前问题假设\r\nH1（待验证）：\r\n新品状态可能被聊天信息淹没。😊\r\n";
    let draft = parse_authoritative_material(RAW, "customer-crlf", "MANUAL_PASTE");
    assert_eq!(draft.candidates.iter().filter(|candidate| candidate.candidate_kind == "FACT").count(), 3);
    assert_eq!(draft.candidates.iter().filter(|candidate| candidate.candidate_kind == "HYPOTHESIS").count(), 1);

    if std::env::var_os("BATTLE_CARD_PARITY_DUMP").is_some() {
      let parity = serde_json::json!({
        "raw_content_sha256": draft.raw_content_sha256,
        "import_scope_id": draft.import_scope_id,
        "parser_contract_version": PARSER_CONTRACT_VERSION,
        "source_span_contract_version": SOURCE_SPAN_CONTRACT_VERSION,
        "candidates": draft.candidates,
      });
      println!("BATTLE_CARD_RUST_PARITY_JSON:{}", serde_json::to_string(&parity).unwrap());
    }

    for candidate in &draft.candidates {
      assert!(RAW.is_char_boundary(candidate.start_byte), "{} start is not a UTF-8 boundary", candidate.candidate_id);
      assert!(RAW.is_char_boundary(candidate.end_byte), "{} end is not a UTF-8 boundary", candidate.candidate_id);
      let raw_excerpt = std::str::from_utf8(&RAW.as_bytes()[candidate.start_byte..candidate.end_byte]).unwrap();
      assert_eq!(candidate.excerpt, raw_excerpt, "{} excerpt must be an original raw-byte slice", candidate.candidate_id);
      assert_eq!(candidate.excerpt_sha256, sha256_hex(raw_excerpt.as_bytes()), "{} hash must cover the original raw-byte slice", candidate.candidate_id);
      assert_eq!(
        candidate.candidate_id,
        build_candidate_id(
          &draft.raw_content_sha256,
          PARSER_CONTRACT_VERSION,
          SOURCE_SPAN_CONTRACT_VERSION,
          "customer-crlf",
          &draft.import_scope_id,
          &candidate.candidate_kind,
          &candidate.source_section,
          candidate.start_byte,
          candidate.end_byte,
          &sha256_hex(raw_excerpt.as_bytes()),
          &candidate.statement_sha256,
        ),
        "{} ID must bind the original raw-byte span",
        candidate.candidate_id,
      );
    }
  }

  fn assert_raw_byte_candidate_bindings(raw: &str, customer_id: &str) -> AuthoritativeDraft {
    let draft = parse_authoritative_material(raw, customer_id, "MANUAL_PASTE");
    for candidate in &draft.candidates {
      assert!(raw.is_char_boundary(candidate.start_byte), "{} start must stay at a UTF-8 boundary", candidate.candidate_id);
      assert!(raw.is_char_boundary(candidate.end_byte), "{} end must stay at a UTF-8 boundary", candidate.candidate_id);
      let excerpt = std::str::from_utf8(&raw.as_bytes()[candidate.start_byte..candidate.end_byte]).unwrap();
      assert_eq!(candidate.excerpt, excerpt, "{} must retain internal original line endings", candidate.candidate_id);
      assert!(!candidate.excerpt.ends_with('\n') && !candidate.excerpt.ends_with('\r'), "{} must exclude its trailing line ending", candidate.candidate_id);
      let excerpt_sha256 = sha256_hex(excerpt.as_bytes());
      assert_eq!(candidate.excerpt_sha256, excerpt_sha256, "{} hash must be recomputable from raw bytes", candidate.candidate_id);
      assert_eq!(
        candidate.candidate_id,
        build_candidate_id(
          &draft.raw_content_sha256,
          PARSER_CONTRACT_VERSION,
          SOURCE_SPAN_CONTRACT_VERSION,
          customer_id,
          &draft.import_scope_id,
          &candidate.candidate_kind,
          &candidate.source_section,
          candidate.start_byte,
          candidate.end_byte,
          &excerpt_sha256,
          &candidate.statement_sha256,
        ),
        "{} must bind the raw source span",
        candidate.candidate_id,
      );
    }
    draft
  }

  #[test]
  fn raw_byte_scanner_covers_lf_crlf_mixed_and_eof_variants() {
    let lf = "# 主体与公开事实\n\n广州电秀科技发展有限公司专注生活电器与个人护理小家电。\n官方案例披露2023年在Amazon销售额突破7000万元。😊\n产品配方与成分属于在售商品的一部分。\n\n# 当前问题假设\nH1（待验证）：\n新品状态可能被聊天信息淹没。😊\n";
    let crlf = lf.replace('\n', "\r\n");
    let mixed = "# 主体与公开事实\r\n\r\n广州电秀科技发展有限公司专注生活电器与个人护理小家电。\n官方案例披露2023年在Amazon销售额突破7000万元。😊\r\n产品配方与成分属于在售商品的一部分。\n\n# 当前问题假设\r\nH1（待验证）：\r\n新品状态可能被聊天信息淹没。😊";

    let lf_draft = assert_raw_byte_candidate_bindings(lf, "customer-parity");
    let crlf_draft = assert_raw_byte_candidate_bindings(&crlf, "customer-parity");
    let mixed_draft = assert_raw_byte_candidate_bindings(mixed, "customer-parity");
    for draft in [&lf_draft, &crlf_draft, &mixed_draft] {
      assert_eq!(draft.candidates.iter().filter(|candidate| candidate.candidate_kind == "FACT").count(), 3);
      assert_eq!(draft.candidates.iter().filter(|candidate| candidate.candidate_kind == "HYPOTHESIS").count(), 1);
    }
    assert_ne!(lf_draft.import_scope_id, crlf_draft.import_scope_id, "LF and CRLF raw inputs must bind different raw-content scopes");
    assert_ne!(
      lf_draft.candidates.iter().map(|candidate| &candidate.candidate_id).collect::<Vec<_>>(),
      crlf_draft.candidates.iter().map(|candidate| &candidate.candidate_id).collect::<Vec<_>>(),
      "CRLF must produce IDs distinct from the corresponding LF raw bytes",
    );

    let lines = parse_lines(mixed);
    assert_eq!(lines[0].raw_start_byte, 0);
    assert_eq!(lines[0].content_end_byte, "# 主体与公开事实".len());
    assert_eq!(lines[0].raw_end_byte, "# 主体与公开事实\r\n".len());
    assert_eq!(lines[0].line_ending, "CRLF");
    assert_eq!(lines.iter().find(|line| line.raw_text.starts_with("广州电秀科技")).unwrap().line_ending, "LF");
    assert_eq!(lines.last().unwrap().line_ending, "NONE");
    assert_eq!(lines.last().unwrap().raw_text, "新品状态可能被聊天信息淹没。😊");
    assert_eq!(lines.last().unwrap().normalized_text_for_matching, "新品状态可能被聊天信息淹没。😊");

    let guangzhou_full_width_crlf = "广州电秀科技发展有限公司 战前卡\r\n１．主体与公开事实\r\n广州品牌出海案例明确其专注生活电器与个人护理小家电，销售覆盖80多个国家和地区。\r\n官方案例披露2023年在Amazon销售额突破7000万元。\r\n产品配方与成分属于在售商品的一部分。\r\n３．当前问题假设\r\nH1：新品状态可能被聊天信息淹没。\r\nH2：跨部门协作可能缺少统一推进节奏。\r\nH3：合规信息可能在销售前未被完整核验。\r\nH4：售后反馈可能没有形成产品改进闭环。\r\n";
    let full_draft = assert_raw_byte_candidate_bindings(guangzhou_full_width_crlf, "customer-guangzhou-crlf");
    assert_eq!(full_draft.candidates.iter().filter(|candidate| candidate.candidate_kind == "FACT").count(), 3);
    let hypothesis_markers: Vec<_> = full_draft.candidates.iter().filter(|candidate| candidate.candidate_kind == "HYPOTHESIS").map(|candidate| candidate.rationale.as_deref()).collect();
    assert_eq!(hypothesis_markers, vec![Some("H1 假设"), Some("H2 假设"), Some("H3 假设"), Some("H4 假设")]);
  }

  #[test]
  fn source_span_parser_cannot_reintroduce_global_crlf_normalization() {
    let source = include_str!("battle_card_authoritative.rs");
    assert!(source.contains("let bytes = raw_content.as_bytes()"));
    assert!(!source.contains("raw_content.replace(\"\\r\\n\", \"\\n\")"));
    assert!(!source.contains("raw_content.replace('\\r', \"\\n\")"));
    assert!(!source.contains("raw_content.replace(\"\\r\", \"\\n\")"));
  }
}
