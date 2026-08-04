//! Battle Card Production Atomic Transactions V1 — Fact Authority 版。
//!
//! 生产单事务写入模块：把 TS 侧已完成的人工决策（Proposal / Canonical SHA-256 /
//! 人工确认 / 语义门禁 / 权威重解析）落库为**同一条物理 SQLite 连接上的一个
//! sqlx Transaction**。任何一步失败自动 rollback，不允许部分残留。
//!
//! ## 信任边界（V1）
//! 1. 已打包应用 Renderer 是可信应用代码；
//! 2. Rust Host 与本地 SQLite 是可信执行层；
//! 3. 大模型 / Agent 输出 / 用户导入文本 / 客户 ID / Evidence ID / 全部 DTO 字段不可信；
//! 4. Rust 独立校验全部数据库业务不变量（见下）；
//! 5. 本版本不声称防御任意 Renderer RCE；
//! 6. 本版本不声称密码学证明“真人物理点击”；Human Confirm 由正式 UI/Proposal
//!    流程提供，Rust 只负责确保 Renderer 无法直接指定最终事实状态。
//!
//! ## Fact Authority（本轮核心）
//! - DTO 不再接受 `verificationStatus` / `evidenceRefsJson` / `applicability`；
//! - Renderer 只提供业务决策：fact_id / statement / decision(KEEP|VERIFY) /
//!   结构化 evidence_refs / applicable_scope / product_line / reason；
//! - Rust 在事务内：移植 parser 关键词表独立判定权威 applicability →
//!   逐条解析并验证 evidence（真实查表，跨客户/不存在/伪造一律拒绝）→
//!   按决策推导最终 verification_status → 自行生成 evidence_refs_json 与行 id。

use std::path::PathBuf;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Connection, Row, SqliteConnection};
use tauri::{AppHandle, Manager};

use crate::battle_card_authoritative;

const DB_FILE_NAME: &str = "personal-crm.db";
const MAX_STRING: usize = 1024 * 1024;
const MAX_ITEMS: usize = 200;
const MAX_EVIDENCE_REFS: usize = 20;
const MAX_SCOPE_LEN: usize = 512;

// ── 闭合 DTO（deny_unknown_fields：未知字段 fail-closed）──

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BattleCardImportSourceV1 {
  pub source_system: String,
  #[serde(default)]
  pub source_label: Option<String>,
  pub raw_content: String,
  pub content_hash: String,
  pub parser_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BattleCardFactDecisionV1 {
  /// 权威 Candidate ID（Rust 从 raw_content 重新解析后校验；Renderer 不得自行生成）。
  pub candidate_id: String,
  /// KEEP | VERIFY（枚举校验；非法值拒绝）。
  pub decision: String,
  #[serde(default)]
  pub applicable_scope: Option<String>,
  #[serde(default)]
  pub product_line: Option<String>,
  #[serde(default)]
  pub reason: Option<String>,
  /// 补充 CRM Evidence（CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK:id；真实查表）。
  #[serde(default)]
  pub supplemental_evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BattleCardSupersedeV1 {
  pub fact_id: String,
  pub customer_id: String,
  pub at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BattleCardImportPayloadV1 {
  pub customer_id: String,
  pub import_row: BattleCardImportSourceV1,
  #[serde(default)]
  pub supersede_fact_ids: Vec<BattleCardSupersedeV1>,
  pub fact_decisions: Vec<BattleCardFactDecisionV1>,
  /// 保留的 Hypothesis 权威 Candidate ID 列表（Rust 从 Candidate 恢复正文；无编号段落不落库）。
  pub hypothesis_candidate_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleCardImportResultV1 {
  pub import_id: String,
  pub facts_written: usize,
  pub hypotheses_written: usize,
  pub duplicates_skipped: usize,
  pub deduped: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BattleCardStageCardPayloadV1 {
  pub customer_id: String,
  pub card_id: String,
  pub expected_version: i64,
  pub confirmed_by: String,
  pub confirmed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleCardStageCardResultV1 {
  pub card_id: String,
  pub card_status: String,
  pub confirmed_at: String,
  pub current_stage_card_id: String,
}

// ── 连接与路径解析 ──

fn validate_text(value: &str, label: &str, max: usize) -> Result<(), String> {
  if value.trim().is_empty() {
    return Err(format!("battle card atomic payload {label} must not be empty"));
  }
  if value.len() > max {
    return Err(format!("battle card atomic payload {label} exceeds max length"));
  }
  if value.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t') {
    return Err(format!("battle card atomic payload {label} contains control characters"));
  }
  Ok(())
}

fn resolve_database_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|_| "battle card atomic: app data directory unavailable".to_string())?;
  Ok(dir.join(DB_FILE_NAME))
}

async fn open_connection(path: &std::path::Path) -> Result<SqliteConnection, String> {
  let options = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(false)
    .foreign_keys(true)
    .busy_timeout(Duration::from_secs(5))
    .journal_mode(SqliteJournalMode::Wal);
  SqliteConnection::connect_with(&options)
    .await
    .map_err(|_| "battle card atomic: production database unavailable".to_string())
}

// ── Failpoint（仅 test / e2e 编译分支）──

#[cfg(any(test, feature = "e2e"))]
fn e2e_failpoint_from_env() -> Option<String> {
  std::env::var("BATTLE_CARD_E2E_FAILPOINT").ok()
}

#[cfg(not(any(test, feature = "e2e")))]
fn e2e_failpoint_from_env() -> Option<String> {
  None
}

fn check_failpoint(failpoint: Option<&str>, name: &str) -> Result<(), String> {
  if failpoint == Some(name) {
    return Err(format!("injected battle card transaction failure at {name}"));
  }
  Ok(())
}

// ── 权威 Applicability 判定（移植自 parser.ts determineApplicability，逐字同源）──

enum ResolvedEvidence {
  /// 材料内来源引用（属于本次导入事务）。
  ImportRef { ref_text: String },
  /// 真实 CRM 记录（已查表验证存在且属于当前客户）。
  CrmRecord { evidence_type: String, evidence_id: String },
}

async fn resolve_battle_card_evidence(
  transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
  customer_id: &str,
  ref_text: &str,
) -> Result<ResolvedEvidence, String> {
  validate_text(ref_text, "evidenceRef", 256)?;
  if let Some(rest) = ref_text.strip_prefix("import:") {
    if rest.trim().is_empty() {
      return Err("battle card atomic: import evidence ref must not be empty".into());
    }
    return Ok(ResolvedEvidence::ImportRef { ref_text: ref_text.to_string() });
  }
  let Some((evidence_type, evidence_id)) = ref_text.split_once(':') else {
    return Err(format!("battle card atomic: evidence ref {} has no type prefix", ref_text.chars().take(24).collect::<String>()));
  };
  if evidence_id.trim().is_empty() {
    return Err("battle card atomic: evidence id must not be empty".into());
  }
  match evidence_type {
    "CUSTOMER" => {
      let row = sqlx::query("SELECT id FROM customers WHERE id = ?")
        .bind(evidence_id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| "battle card atomic: customer evidence lookup failed".to_string())?;
      if row.is_none() {
        return Err("battle card atomic: evidence does not exist (CUSTOMER)".into());
      }
      if evidence_id != customer_id {
        return Err("battle card atomic: evidence customer mismatch (CUSTOMER)".into());
      }
      Ok(ResolvedEvidence::CrmRecord { evidence_type: "CUSTOMER".into(), evidence_id: evidence_id.to_string() })
    }
    "FOLLOW_UP_RECORD" | "VISIT_RECORD" | "TASK" => {
      let table = match evidence_type {
        "FOLLOW_UP_RECORD" => "follow_up_records",
        "VISIT_RECORD" => "visit_records",
        _ => "tasks",
      };
      let row = sqlx::query(&format!(
        "SELECT id, customer_id FROM {table} WHERE id = ?"
      ))
      .bind(evidence_id)
      .fetch_optional(&mut **transaction)
      .await
      .map_err(|_| "battle card atomic: evidence lookup failed".to_string())?;
      let Some(row) = row else {
        return Err(format!("battle card atomic: evidence does not exist ({evidence_type})"));
      };
      let row_customer: String = row
        .try_get("customer_id")
        .map_err(|_| "battle card atomic: evidence row invalid".to_string())?;
      if row_customer != customer_id {
        return Err(format!("battle card atomic: evidence customer mismatch ({evidence_type})"));
      }
      Ok(ResolvedEvidence::CrmRecord { evidence_type: evidence_type.to_string(), evidence_id: evidence_id.to_string() })
    }
    _ => Err(format!(
      "battle card atomic: evidence ref {} has unsupported type {}",
      ref_text.chars().take(24).collect::<String>(),
      evidence_type.chars().take(16).collect::<String>()
    )),
  }
}

/// 生成闭合 evidence_refs_json（与 TS FactEvidenceRef 结构一致）。

fn derive_verification_status(
  decision: &str,
  authoritative: &str,
  has_scope_or_product_line: bool,
  evidence_count: usize,
) -> Result<&'static str, String> {
  match decision {
    "KEEP" => Ok("PENDING"),
    "VERIFY" => {
      if evidence_count == 0 {
        return Err("battle card atomic: VERIFY requires at least one resolved evidence ref".into());
      }
      match authoritative {
        "CONDITIONAL" => {
          if !has_scope_or_product_line {
            return Err("battle card atomic: CONDITIONAL VERIFY requires applicable_scope or product_line".into());
          }
          Ok("VERIFIED")
        }
        "GLOBAL" | "PARTIAL" => Ok("VERIFIED"),
        other => Err(format!("battle card atomic: unsupported authoritative applicability {other}")),
      }
    }
    other => Err(format!("battle card atomic: unsupported decision {other}")),
  }
}

// ── 核心事务：Confirm Intelligence Import ──

async fn run_confirm_import(
  connection: &mut SqliteConnection,
  payload: &BattleCardImportPayloadV1,
  failpoint: Option<&str>,
) -> Result<BattleCardImportResultV1, String> {
  validate_text(&payload.customer_id, "customerId", MAX_STRING)?;
  validate_text(&payload.import_row.raw_content, "importRow.rawContent", MAX_STRING)?;
  validate_text(&payload.import_row.source_system, "importRow.sourceSystem", 128)?;
  validate_text(&payload.import_row.content_hash, "importRow.contentHash", 256)?;
  validate_text(&payload.import_row.parser_version, "importRow.parserVersion", 128)?;
  if payload.fact_decisions.len() > MAX_ITEMS || payload.supersede_fact_ids.len() > MAX_ITEMS {
    return Err("battle card atomic: too many rows".into());
  }

  // 决策载荷闭合校验：candidate_id / enum / 去重 / 数量 / 长度
  let mut seen_candidate_ids = std::collections::HashSet::new();
  for fact in &payload.fact_decisions {
    validate_text(&fact.candidate_id, "fact.candidateId", 128)?;
    if fact.candidate_id.len() != 64 || !fact.candidate_id.chars().all(|c| c.is_ascii_hexdigit()) {
      return Err("battle card atomic: fact candidateId must be a 64-hex authoritative candidate id".into());
    }
    if !seen_candidate_ids.insert(fact.candidate_id.clone()) {
      return Err(format!("battle card atomic: duplicate candidate_id {}", fact.candidate_id.chars().take(24).collect::<String>()));
    }
    if fact.decision != "KEEP" && fact.decision != "VERIFY" {
      return Err(format!("battle card atomic: unsupported decision for {}", fact.candidate_id.chars().take(24).collect::<String>()));
    }
    if fact.supplemental_evidence_refs.len() > MAX_EVIDENCE_REFS {
      return Err(format!("battle card atomic: too many supplemental evidence refs for {}", fact.candidate_id.chars().take(24).collect::<String>()));
    }
    if let Some(scope) = &fact.applicable_scope {
      if scope.len() > MAX_SCOPE_LEN {
        return Err("battle card atomic: applicable_scope exceeds max length".into());
      }
    }
    if let Some(product_line) = &fact.product_line {
      if product_line.len() > MAX_SCOPE_LEN {
        return Err("battle card atomic: product_line exceeds max length".into());
      }
    }
  }
  let mut seen_hypothesis_ids = std::collections::HashSet::new();
  for candidate_id in &payload.hypothesis_candidate_ids {
    validate_text(candidate_id, "hypothesis.candidateId", 128)?;
    if candidate_id.len() != 64 || !candidate_id.chars().all(|c| c.is_ascii_hexdigit()) {
      return Err("battle card atomic: hypothesis candidateId must be a 64-hex authoritative candidate id".into());
    }
    if !seen_hypothesis_ids.insert(candidate_id.clone()) {
      return Err("battle card atomic: duplicate hypothesis candidate_id".into());
    }
  }
  if payload.fact_decisions.len() + payload.hypothesis_candidate_ids.len() > MAX_ITEMS {
    return Err("battle card atomic: too many rows".into());
  }

  let mut transaction = connection
    .begin()
    .await
    .map_err(|_| "battle card atomic: transaction unavailable".to_string())?;

  // 幂等去重：customer_id + source_system + content_hash
  let existing = sqlx::query_scalar::<_, String>(
    "SELECT id FROM intelligence_imports WHERE customer_id = ? AND source_system = ? AND content_hash = ? LIMIT 1",
  )
  .bind(&payload.customer_id)
  .bind(&payload.import_row.source_system)
  .bind(&payload.import_row.content_hash)
  .fetch_optional(&mut *transaction)
  .await
  .map_err(|_| "battle card atomic: dedup lookup failed".to_string())?;

  if let Some(import_id) = existing {
    transaction
      .commit()
      .await
      .map_err(|_| "battle card atomic: dedup commit failed".to_string())?;
    return Ok(BattleCardImportResultV1 {
      import_id,
      facts_written: 0,
      hypotheses_written: 0,
      duplicates_skipped: 0,
      deduped: true,
    });
  }

  // 统一时间与行 id（Renderer 不提供持久化标识/状态/时间）
  let now = Utc::now().to_rfc3339();
  let now_digits: String = now.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
  let import_id = format!(
    "import-{}-{}",
    now_digits,
    uuid::Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>()
  );

  // 权威重新解析：同一事务内从 raw_content 生成 Candidate Map（Renderer 提交的 candidate_id 必须命中）
  let authoritative = battle_card_authoritative::parse_authoritative_material(
    &payload.import_row.raw_content,
    &payload.customer_id,
    &payload.import_row.source_system,
  );
  let candidate_map: std::collections::HashMap<String, &battle_card_authoritative::AuthoritativeCandidate> =
    authoritative.candidates.iter().map(|candidate| (candidate.candidate_id.clone(), candidate)).collect();

  // 1) import 行
  let affected = sqlx::query(
    "INSERT INTO intelligence_imports (id, customer_id, source_system, source_label, raw_content, content_hash, parser_version, parse_status, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  .bind(&import_id)
  .bind(&payload.customer_id)
  .bind(&payload.import_row.source_system)
  .bind(&payload.import_row.source_label)
  .bind(&payload.import_row.raw_content)
  .bind(&payload.import_row.content_hash)
  .bind(&payload.import_row.parser_version)
  .bind("CONFIRMED")
  .bind(&now)
  .bind(&now)
  .bind(&now)
  .execute(&mut *transaction)
  .await
  .map_err(|_| "battle card atomic: import row insert failed".to_string())?;
  if affected.rows_affected() != 1 {
    return Err("battle card atomic: import row affected rows mismatch".into());
  }
  check_failpoint(failpoint, "after-import")?;

  // 2) 旧 CONFLICTED/SUPERSEDED 同语句事实 → SUPERSEDED（TS 层已决策）
  for supersede in &payload.supersede_fact_ids {
    if supersede.customer_id != payload.customer_id {
      return Err("battle card atomic: supersede customer mismatch".into());
    }
    let affected = sqlx::query(
      "UPDATE reviewed_facts SET verification_status = 'SUPERSEDED', updated_at = ? WHERE id = ? AND customer_id = ? AND verification_status != 'SUPERSEDED'",
    )
    .bind(&supersede.at)
    .bind(&supersede.fact_id)
    .bind(&supersede.customer_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "battle card atomic: supersede update failed".to_string())?;
    if affected.rows_affected() > 1 {
      return Err("battle card atomic: supersede affected rows mismatch".into());
    }
  }
  check_failpoint(failpoint, "after-supersede")?;

  // 3) Fact 权威处理：Candidate 校验 → 自动 Primary Import Source Evidence →
  //    Supplemental 查表 → 状态推导（正文/适用性/证据 JSON 全部来自权威 Candidate）
  for (index, fact) in payload.fact_decisions.iter().enumerate() {
    let candidate = candidate_map.get(&fact.candidate_id).ok_or_else(|| {
      format!(
        "battle card atomic: candidate_id {} not found in authoritative reparse",
        fact.candidate_id.chars().take(24).collect::<String>()
      )
    })?;
    if candidate.candidate_kind != "FACT" {
      return Err(format!(
        "battle card atomic: candidate_id {} is not a FACT candidate",
        fact.candidate_id.chars().take(24).collect::<String>()
      ));
    }
    // Primary Import Source Evidence（Rust 自动生成；Renderer 不能构造）
    let primary = serde_json::json!({
      "evidence_type": "IMPORT_SOURCE",
      "import_id": import_id,
      "customer_id": payload.customer_id,
      "import_scope_id": authoritative.import_scope_id,
      "parser_contract_version": battle_card_authoritative::PARSER_CONTRACT_VERSION,
      "source_span_contract_version": battle_card_authoritative::SOURCE_SPAN_CONTRACT_VERSION,
      "source_section": candidate.source_section,
      "start_byte": candidate.start_byte,
      "end_byte": candidate.end_byte,
      "excerpt_sha256": candidate.excerpt_sha256,
      "statement_sha256": candidate.statement_sha256,
    });
    // Supplemental CRM Evidence（真实查表；同客户）
    let mut supplemental_json: Vec<serde_json::Value> = Vec::new();
    let mut seen_refs = std::collections::HashSet::new();
    for ref_text in &fact.supplemental_evidence_refs {
      if !seen_refs.insert(ref_text.clone()) {
        return Err("battle card atomic: duplicate supplemental evidence ref".into());
      }
      let resolved = resolve_battle_card_evidence(&mut transaction, &payload.customer_id, ref_text).await?;
      match resolved {
        ResolvedEvidence::CrmRecord { evidence_type, evidence_id } => {
          supplemental_json.push(serde_json::json!({ "evidence_type": evidence_type, "evidence_id": evidence_id }));
        }
        ResolvedEvidence::ImportRef { .. } => {
          return Err("battle card atomic: supplemental evidence ref must be a CRM record (import: refs are generated by Rust)".into());
        }
      }
    }
    // evidence_refs_json = [primary, ...supplemental]
    let mut evidence_values: Vec<serde_json::Value> = Vec::with_capacity(1 + supplemental_json.len());
    evidence_values.push(primary);
    evidence_values.extend(supplemental_json.iter().cloned());
    let evidence_refs_json = serde_json::Value::Array(evidence_values).to_string();
    // 状态推导（VERIFY 必须 Primary Import Source Evidence——自动存在；Supplemental 不单独满足）
    let has_scope = fact.applicable_scope.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
      || fact.product_line.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    let status = derive_verification_status(&fact.decision, &candidate.applicability, has_scope, 1)?;
    // 行 id 用顺序索引（candidate_id 为权威身份，不参与持久化行 id，保证同 created_at 排序稳定）
    let fact_row_id = format!("fact-{import_id}-{}", index + 1);

    let affected = sqlx::query(
      "INSERT INTO reviewed_facts (id, customer_id, source_import_id, fact_category, statement, normalized_value_json, verification_status, confidence, applicability, observed_at, valid_until, evidence_refs_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&fact_row_id)
    .bind(&payload.customer_id)
    .bind(&import_id)
    .bind(&candidate.fact_category)
    .bind(&candidate.statement)
    .bind(Option::<String>::None)
    .bind(status)
    .bind(0.8f64)
    .bind(&candidate.applicability)
    .bind(&now)
    .bind(Option::<String>::None)
    .bind(&evidence_refs_json)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "battle card atomic: fact insert failed".to_string())?;
    if affected.rows_affected() != 1 {
      return Err("battle card atomic: fact affected rows mismatch".into());
    }
    check_failpoint(failpoint, &format!("after-fact-{index}"))?;
  }

  // 4) Hypotheses：仅通过权威 Candidate ID 恢复正文（status PENDING；applicability CONDITIONAL；audit 本模块生成）
  for (index, candidate_id) in payload.hypothesis_candidate_ids.iter().enumerate() {
    let candidate = candidate_map.get(candidate_id).ok_or_else(|| {
      format!(
        "battle card atomic: hypothesis candidate_id {} not found in authoritative reparse",
        candidate_id.chars().take(24).collect::<String>()
      )
    })?;
    if candidate.candidate_kind != "HYPOTHESIS" {
      return Err("battle card atomic: candidate is not a HYPOTHESIS candidate".into());
    }
    let primary = serde_json::json!({
      "evidence_type": "IMPORT_SOURCE",
      "import_id": import_id,
      "customer_id": payload.customer_id,
      "import_scope_id": authoritative.import_scope_id,
      "parser_contract_version": battle_card_authoritative::PARSER_CONTRACT_VERSION,
      "source_span_contract_version": battle_card_authoritative::SOURCE_SPAN_CONTRACT_VERSION,
      "source_section": candidate.source_section,
      "start_byte": candidate.start_byte,
      "end_byte": candidate.end_byte,
      "excerpt_sha256": candidate.excerpt_sha256,
      "statement_sha256": candidate.statement_sha256,
    });
    let evidence_refs_json = serde_json::Value::Array(vec![primary]).to_string();
    let audit = serde_json::json!([{
      "at": now,
      "old_status": "PENDING",
      "new_status": "PENDING",
      "by": "HUMAN_CONFIRM",
      "reason": "导入确认时创建",
    }])
    .to_string();
    let hypothesis_row_id = format!("hyp-{import_id}-{}", index + 1);
    let affected = sqlx::query(
      "INSERT INTO customer_hypotheses (id, customer_id, source_import_id, category, statement, rationale, status, applicability, why_it_matters, validation_question, disconfirm_condition, evidence_refs_json, status_audit_json, created_at, resolved_at, updated_at)
       VALUES (?, ?, ?, 'PROBLEM', ?, ?, 'PENDING', 'CONDITIONAL', ?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(&hypothesis_row_id)
    .bind(&payload.customer_id)
    .bind(&import_id)
    .bind(&candidate.statement)
    .bind(&candidate.rationale)
    .bind(Option::<String>::None)
    .bind(&candidate.validation_question)
    .bind(Option::<String>::None)
    .bind(&evidence_refs_json)
    .bind(&audit)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|e| format!("battle card atomic: hypothesis insert failed: {e}"))?;
    if affected.rows_affected() != 1 {
      return Err("battle card atomic: hypothesis affected rows mismatch".into());
    }
    check_failpoint(failpoint, &format!("after-hypothesis-{index}"))?;
  }

  check_failpoint(failpoint, "before-commit")?;

  transaction
    .commit()
    .await
    .map_err(|_| "battle card atomic: commit failed".to_string())?;

  Ok(BattleCardImportResultV1 {
    import_id,
    facts_written: payload.fact_decisions.len(),
    hypotheses_written: payload.hypothesis_candidate_ids.len(),
    duplicates_skipped: 0,
    deduped: false,
  })
}

// ── 核心事务：Confirm Stage Card ──

async fn run_confirm_stage_card(
  connection: &mut SqliteConnection,
  payload: &BattleCardStageCardPayloadV1,
  failpoint: Option<&str>,
) -> Result<BattleCardStageCardResultV1, String> {
  validate_text(&payload.customer_id, "customerId", MAX_STRING)?;
  validate_text(&payload.card_id, "cardId", MAX_STRING)?;
  validate_text(&payload.confirmed_by, "confirmedBy", 128)?;
  validate_text(&payload.confirmed_at, "confirmedAt", 128)?;

  let mut transaction = connection
    .begin()
    .await
    .map_err(|_| "battle card atomic: transaction unavailable".to_string())?;

  let card = sqlx::query(
    "SELECT id, customer_id, card_status, version FROM customer_stage_cards WHERE id = ?",
  )
  .bind(&payload.card_id)
  .fetch_optional(&mut *transaction)
  .await
  .map_err(|_| "battle card atomic: stage card lookup failed".to_string())?;

  let Some(card) = card else {
    return Err("battle card atomic: stage card does not exist".into());
  };
  let card_customer: String = card.try_get("customer_id").map_err(|_| "battle card atomic: stage card row invalid".to_string())?;
  if card_customer != payload.customer_id {
    return Err("battle card atomic: stage card customer mismatch".into());
  }
  let card_status: String = card.try_get("card_status").map_err(|_| "battle card atomic: stage card row invalid".to_string())?;
  if card_status != "DRAFT" {
    return Err("battle card atomic: stage card is not a draft (replay or already confirmed)".into());
  }
  let version: i64 = card.try_get("version").map_err(|_| "battle card atomic: stage card row invalid".to_string())?;
  if version != payload.expected_version {
    return Err(format!(
      "battle card atomic: stage card version conflict: expected {}, actual {}",
      payload.expected_version, version
    ));
  }

  let affected = sqlx::query(
    "UPDATE customer_stage_cards SET card_status = 'CONFIRMED', confirmed_by = ?, confirmed_at = ? WHERE id = ? AND card_status = 'DRAFT'",
  )
  .bind(&payload.confirmed_by)
  .bind(&payload.confirmed_at)
  .bind(&payload.card_id)
  .execute(&mut *transaction)
  .await
  .map_err(|_| "battle card atomic: stage card confirm update failed".to_string())?;
  if affected.rows_affected() != 1 {
    return Err("battle card atomic: stage card update affected rows mismatch".into());
  }
  check_failpoint(failpoint, "after-card-update")?;

  let affected = sqlx::query(
    "UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ? WHERE id = ?",
  )
  .bind(&payload.card_id)
  .bind(&payload.confirmed_at)
  .bind(&payload.confirmed_at)
  .bind(&payload.customer_id)
  .execute(&mut *transaction)
  .await
  .map_err(|_| "battle card atomic: customer pointer update failed".to_string())?;
  if affected.rows_affected() != 1 {
    return Err("battle card atomic: customer pointer affected rows mismatch".into());
  }
  check_failpoint(failpoint, "after-pointer-update")?;

  check_failpoint(failpoint, "before-commit")?;

  transaction
    .commit()
    .await
    .map_err(|_| "battle card atomic: commit failed".to_string())?;

  Ok(BattleCardStageCardResultV1 {
    card_id: payload.card_id.clone(),
    card_status: "CONFIRMED".to_string(),
    confirmed_at: payload.confirmed_at.clone(),
    current_stage_card_id: payload.card_id.clone(),
  })
}

// ── 对外：打开一条专用连接并执行事务（command 与测试共用）──

async fn open_and_run_import(
  app: Option<&AppHandle>,
  db_path: Option<&std::path::Path>,
  payload: BattleCardImportPayloadV1,
  failpoint: Option<&str>,
) -> Result<BattleCardImportResultV1, String> {
  let path = match (db_path, app) {
    (Some(path), _) => path.to_path_buf(),
    (None, Some(app)) => resolve_database_path(app)?,
    (None, None) => return Err("battle card atomic: no database path source".into()),
  };
  let mut connection = open_connection(&path).await?;
  let result = run_confirm_import(&mut connection, &payload, failpoint).await;
  connection.close().await.map_err(|_| "battle card atomic: close failed".to_string())?;
  result
}

async fn open_and_run_stage_card(
  app: Option<&AppHandle>,
  db_path: Option<&std::path::Path>,
  payload: BattleCardStageCardPayloadV1,
  failpoint: Option<&str>,
) -> Result<BattleCardStageCardResultV1, String> {
  let path = match (db_path, app) {
    (Some(path), _) => path.to_path_buf(),
    (None, Some(app)) => resolve_database_path(app)?,
    (None, None) => return Err("battle card atomic: no database path source".into()),
  };
  let mut connection = open_connection(&path).await?;
  let result = run_confirm_stage_card(&mut connection, &payload, failpoint).await;
  connection.close().await.map_err(|_| "battle card atomic: close failed".to_string())?;
  result
}

// ── Tauri commands（生产入口）──

#[tauri::command]
pub async fn confirm_battle_card_import_atomic_v1(
  app: AppHandle,
  payload: BattleCardImportPayloadV1,
) -> Result<BattleCardImportResultV1, String> {
  let failpoint = e2e_failpoint_from_env();
  open_and_run_import(Some(&app), None, payload, failpoint.as_deref()).await
}

#[tauri::command]
pub async fn confirm_battle_card_stage_card_atomic_v1(
  app: AppHandle,
  payload: BattleCardStageCardPayloadV1,
) -> Result<BattleCardStageCardResultV1, String> {
  let failpoint = e2e_failpoint_from_env();
  open_and_run_stage_card(Some(&app), None, payload, failpoint.as_deref()).await
}

// ── 单元测试（临时隔离数据库；Fact Authority 对抗矩阵）──

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicU64, Ordering};
  use std::time::{SystemTime, UNIX_EPOCH};

  const MIGRATION_001: &str = include_str!("../migrations/001_initial.sql");
  const MIGRATION_003: &str = include_str!("../migrations/003_customer_fields.sql");
  const MIGRATION_005: &str = include_str!("../migrations/005_customer_battle_card.sql");
  const GOLDEN_SAMPLE: &str = include_str!("../../src/__tests__/fixtures/battle-card/guangzhou-dianxiu-appendix-a-raw.txt");

  static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

  fn temp_db_path() -> PathBuf {
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("battle-card-authority-test-{nonce}-{seq}-{}.db", std::process::id()))
  }

  async fn setup_db(path: &std::path::Path, customer_id: &str) -> Result<(), String> {
    let options = SqliteConnectOptions::new()
      .filename(path)
      .create_if_missing(true)
      .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options)
      .await
      .map_err(|_| "test db connect failed".to_string())?;
    // 幂等 schema：表已存在则跳过（005 的 ALTER 不可重复执行）
    let existing_tables = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_stage_cards'")
      .fetch_all(&mut connection)
      .await
      .map_err(|_| "test schema probe failed".to_string())?;
    if existing_tables.is_empty() {
      for sql in [MIGRATION_001, MIGRATION_005] {
        sqlx::raw_sql(sql)
          .execute(&mut connection)
          .await
          .map_err(|_| "test schema failed".to_string())?;
      }
      let columns = sqlx::query("PRAGMA table_info(customers)")
        .fetch_all(&mut connection)
        .await
        .map_err(|_| "test pragma failed".to_string())?;
      let has_region = columns.iter().any(|row| row.try_get::<String, _>("name").unwrap_or_default() == "region");
      if !has_region {
        sqlx::raw_sql(MIGRATION_003)
          .execute(&mut connection)
          .await
          .map_err(|_| "test schema 003 failed".to_string())?;
      }
    }
    let now = "2026-08-03T00:00:00.000Z";
    sqlx::query(
      "INSERT INTO customers (id, name, customer_grade, stage, intent_level, wechat_add_status, has_replied, can_schedule_visit, no_show_count, last_feedback_type, payment_status, time_parse_status, is_key_decision_maker, region, industry, battle_card_status, created_at, updated_at)
       VALUES (?, '广州电秀科技发展有限公司', 'A', 'NEW_LEAD', 'HIGH', 'NOT_ADDED', 0, 0, 0, 'UNKNOWN', 'NOT_STARTED', 'NOT_PARSED', 0, '广东', '个人护理小家电出海', 'NONE', ?, ?)",
    )
    .bind(customer_id)
    .bind(now)
    .bind(now)
    .execute(&mut connection)
    .await
    .map_err(|_| "test customer seed failed".to_string())?;
    connection.close().await.map_err(|_| "test db close failed".to_string())?;
    Ok(())
  }

  async fn seed_crm_evidence(path: &std::path::Path, customer_id: &str, kind: &str, id: &str) {
    let options = SqliteConnectOptions::new().filename(path).create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    let now = "2026-08-02T00:00:00.000Z";
    match kind {
      "FOLLOW_UP_RECORD" => {
        sqlx::query("INSERT INTO follow_up_records (id, customer_id, title, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)")
          .bind(id).bind(customer_id).bind(now).bind(now)
          .execute(&mut connection).await.unwrap();
      }
      "VISIT_RECORD" => {
        sqlx::query("INSERT INTO visit_records (id, customer_id, title, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)")
          .bind(id).bind(customer_id).bind(now).bind(now)
          .execute(&mut connection).await.unwrap();
      }
      "TASK" => {
        sqlx::query("INSERT INTO tasks (id, customer_id, title, created_at, updated_at) VALUES (?, ?, 'test', ?, ?)")
          .bind(id).bind(customer_id).bind(now).bind(now)
          .execute(&mut connection).await.unwrap();
      }
      _ => {}
    }
    connection.close().await.unwrap();
  }

  const SAMPLE_RAW: &str = "广州电秀科技发展有限公司 战前卡\n1. 主体与公开事实\n广州品牌出海案例明确其专注生活电器与个人护理小家电，销售覆盖80多个国家和地区。\n官方案例披露2023年在Amazon销售额突破7000万元。\n产品配方与成分属于在售商品的一部分。\n3. 当前问题假设\nH1（待验证）：\n新品状态可能被聊天信息淹没。\n";

  fn sample_payload(customer_id: &str) -> BattleCardImportPayloadV1 {
    let draft = battle_card_authoritative::parse_authoritative_material(SAMPLE_RAW, "cust-tx", "MANUAL_PASTE");
    let facts: Vec<_> = draft.candidates.iter().filter(|c| c.candidate_kind == "FACT").collect();
    let hyps: Vec<_> = draft.candidates.iter().filter(|c| c.candidate_kind == "HYPOTHESIS").collect();
    assert!(facts.len() >= 3, "sample must yield >=3 facts");
    assert!(hyps.len() >= 1, "sample must yield >=1 hypothesis");
    BattleCardImportPayloadV1 {
      customer_id: customer_id.to_string(),
      import_row: BattleCardImportSourceV1 {
        source_system: "MANUAL_PASTE".into(),
        source_label: None,
        raw_content: SAMPLE_RAW.into(),
        content_hash: "abc123hash".into(),
        parser_version: "battle-card-parser-v1".into(),
      },
      supersede_fact_ids: vec![],
      fact_decisions: vec![
        BattleCardFactDecisionV1 {
          candidate_id: facts[0].candidate_id.clone(),
          decision: "KEEP".into(),
          applicable_scope: None,
          product_line: None,
          reason: None,
          supplemental_evidence_refs: vec![],
        },
        BattleCardFactDecisionV1 {
          candidate_id: facts[1].candidate_id.clone(),
          decision: "VERIFY".into(),
          applicable_scope: None,
          product_line: None,
          reason: Some("人工核实".into()),
          supplemental_evidence_refs: vec![],
        },
        BattleCardFactDecisionV1 {
          candidate_id: facts[2].candidate_id.clone(),
          decision: "VERIFY".into(),
          applicable_scope: Some("仅中国区".into()),
          product_line: None,
          reason: None,
          supplemental_evidence_refs: vec![],
        },
      ],
      hypothesis_candidate_ids: vec![hyps[0].candidate_id.clone()],
    }
  }

  async fn counts(path: &std::path::Path) -> (i64, i64, i64, i64) {
    let options = SqliteConnectOptions::new().filename(path).create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    let imports: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM intelligence_imports").fetch_one(&mut connection).await.unwrap();
    let facts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reviewed_facts").fetch_one(&mut connection).await.unwrap();
    let hyps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customer_hypotheses").fetch_one(&mut connection).await.unwrap();
    let cards: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customer_stage_cards").fetch_one(&mut connection).await.unwrap();
    connection.close().await.unwrap();
    (imports, facts, hyps, cards)
  }

  async fn fact_rows(path: &std::path::Path) -> Vec<(String, String, String, String)> {
    let options = SqliteConnectOptions::new().filename(path).create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    let rows = sqlx::query("SELECT statement, verification_status, applicability, evidence_refs_json FROM reviewed_facts ORDER BY created_at")
      .fetch_all(&mut connection)
      .await
      .unwrap();
    connection.close().await.unwrap();
    rows.iter()
      .map(|row| {
        (
          row.try_get::<String, _>("statement").unwrap_or_default(),
          row.try_get::<String, _>("verification_status").unwrap_or_default(),
          row.try_get::<String, _>("applicability").unwrap_or_default(),
          row.try_get::<String, _>("evidence_refs_json").unwrap_or_default(),
        )
      })
      .collect()
  }

  // ── Fact Authority / Provenance 对抗矩阵（新闭合 DTO：candidate_id 合同）──

  #[tokio::test]
  async fn fact_authority_keep_is_pending_never_verified() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let payload = sample_payload("cust-tx");
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await.unwrap();
    connection.close().await.unwrap();
    assert_eq!(result.facts_written, 3);
    let facts = fact_rows(&path).await;
    let keep = facts.iter().find(|(s, _, _, _)| s.contains("销售覆盖80多个国家和地区")).unwrap();
    assert_eq!(keep.1, "PENDING");
    assert_eq!(keep.2, "GLOBAL");
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_verify_global_with_automatic_primary_evidence_is_verified() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let payload = sample_payload("cust-tx");
    let mut connection = open_connection(&path).await.unwrap();
    run_confirm_import(&mut connection, &payload, None).await.unwrap();
    connection.close().await.unwrap();
    let facts = fact_rows(&path).await;
    let verified = facts.iter().find(|(s, _, _, _)| s.contains("销售额突破7000万元")).unwrap();
    assert_eq!(verified.1, "VERIFIED");
    assert_eq!(verified.2, "GLOBAL");
    assert!(verified.3.contains("IMPORT_SOURCE"), "primary import source evidence must be auto-generated");
    assert!(verified.3.contains("statement_sha256"));
    assert!(verified.3.contains("excerpt_sha256"));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_verify_conditional_with_scope_and_primary_evidence_is_verified() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let payload = sample_payload("cust-tx");
    let mut connection = open_connection(&path).await.unwrap();
    run_confirm_import(&mut connection, &payload, None).await.unwrap();
    connection.close().await.unwrap();
    let facts = fact_rows(&path).await;
    let conditional = facts.iter().find(|(s, _, _, _)| s.contains("配方与成分")).unwrap();
    assert_eq!(conditional.1, "VERIFIED");
    assert_eq!(conditional.2, "CONDITIONAL");
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_conditional_without_scope_rejected_zero_write() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[2].applicable_scope = None;
    payload.fact_decisions[2].product_line = None;
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_forged_candidate_id_rejected() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[0].candidate_id = "f".repeat(64);
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_wrong_kind_candidate_rejected() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    // 用 HYPOTHESIS candidate_id 提交为 FACT decision → kind 不符 → 拒绝
    let draft = battle_card_authoritative::parse_authoritative_material(SAMPLE_RAW, "cust-tx", "MANUAL_PASTE");
    let hyp = draft.candidates.iter().find(|c| c.candidate_kind == "HYPOTHESIS").unwrap();
    payload.fact_decisions[0].candidate_id = hyp.candidate_id.clone();
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_duplicate_candidate_id_rejected() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions.push(payload.fact_decisions[0].clone());
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_statement_tamper_changes_candidate_and_rejects_old_id() {
    // 篡改 raw_content（80 国 → 180 国）→ 权威重解析产出新 candidate_id → 旧决策 ID 不匹配 → 拒绝
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let payload = sample_payload("cust-tx");
    let tampered_raw = SAMPLE_RAW.replace("80多个国家", "180多个国家");
    let tampered_draft = battle_card_authoritative::parse_authoritative_material(&tampered_raw, "cust-tx", "MANUAL_PASTE");
    // 旧 candidate_id 在篡改后的重解析中不存在
    let first_id = &payload.fact_decisions[0].candidate_id;
    assert!(!tampered_draft.candidates.iter().any(|c| &c.candidate_id == first_id), "tampered raw must change candidate ids");
    // 用篡改后的 raw + 旧 ID 提交 → 拒绝
    let mut tampered_payload = payload.clone();
    tampered_payload.import_row.raw_content = tampered_raw;
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &tampered_payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_cross_customer_supplemental_evidence_rejected() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    setup_db(&path, "cust-other").await.unwrap();
    seed_crm_evidence(&path, "cust-other", "FOLLOW_UP_RECORD", "fu-other-1").await;
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[1].supplemental_evidence_refs = vec!["FOLLOW_UP_RECORD:fu-other-1".into()];
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_nonexistent_supplemental_evidence_rejected() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[1].supplemental_evidence_refs = vec!["TASK:task-does-not-exist".into()];
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_same_customer_supplemental_evidence_allowed() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    seed_crm_evidence(&path, "cust-tx", "FOLLOW_UP_RECORD", "fu-tx-1").await;
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[1].supplemental_evidence_refs = vec!["FOLLOW_UP_RECORD:fu-tx-1".into()];
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await.unwrap();
    connection.close().await.unwrap();
    let facts = fact_rows(&path).await;
    let verified = facts.iter().find(|(s, _, _, _)| s.contains("销售额突破7000万元")).unwrap();
    assert_eq!(verified.1, "VERIFIED");
    assert!(verified.3.contains("FOLLOW_UP_RECORD"));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_supplemental_import_ref_rejected() {
    // supplemental 只接受 CRM 记录；import: 引用由 Rust 自动生成（primary），Renderer 不得提交
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[1].supplemental_evidence_refs = vec!["import:主体与公开事实:4".into()];
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_one_invalid_aborts_whole_transaction() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut payload = sample_payload("cust-tx");
    payload.fact_decisions[2].applicable_scope = None;
    payload.fact_decisions[2].product_line = None;
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_mid_failpoint_rolls_back_everything() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let payload = sample_payload("cust-tx");
    let mut connection = open_connection(&path).await.unwrap();
    let result = run_confirm_import(&mut connection, &payload, Some("after-fact-1")).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    assert_eq!(counts(&path).await, (0, 0, 0, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_replay_dedup_zero_second_write() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let payload = sample_payload("cust-tx");
    let mut connection = open_connection(&path).await.unwrap();
    let first = run_confirm_import(&mut connection, &payload, None).await.unwrap();
    assert!(!first.deduped);
    let second = run_confirm_import(&mut connection, &payload, None).await.unwrap();
    assert!(second.deduped);
    assert_eq!(second.facts_written, 0);
    connection.close().await.unwrap();
    assert_eq!(counts(&path).await, (1, 3, 1, 0));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_unknown_field_rejected_by_serde() {
    // serde deny_unknown_fields：verificationStatus / evidenceRefsJson / statement 等未知字段 → 拒绝
    let json = r#"{
      "customerId": "c",
      "importRow": { "sourceSystem": "S", "rawContent": "x", "contentHash": "h", "parserVersion": "v" },
      "factDecisions": [{ "candidateId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "decision": "KEEP", "statement": "s" }],
      "hypothesisCandidateIds": []
    }"#;
    let parsed: Result<BattleCardImportPayloadV1, _> = serde_json::from_str(json);
    assert!(parsed.is_err(), "statement must be rejected as unknown field");
  }

  #[tokio::test]
  async fn fact_authority_evidence_refs_json_field_rejected_by_serde() {
    let json = r#"{
      "customerId": "c",
      "importRow": { "sourceSystem": "S", "rawContent": "x", "contentHash": "h", "parserVersion": "v" },
      "factDecisions": [{ "candidateId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "decision": "KEEP", "evidenceRefsJson": "[]" }],
      "hypothesisCandidateIds": []
    }"#;
    let parsed: Result<BattleCardImportPayloadV1, _> = serde_json::from_str(json);
    assert!(parsed.is_err(), "evidenceRefsJson must be rejected as unknown field");
  }

  #[tokio::test]
  async fn fact_authority_golden_sample_exact_four_hypotheses_no_leak() {
    // P1-A：广州电秀黄金样本精确 4 条 H 编号假设；边界说明行不得成为 Hypothesis
    let draft = battle_card_authoritative::parse_authoritative_material(GOLDEN_SAMPLE, "cust-tx", "MANUAL_PASTE");
    let hyps: Vec<_> = draft.candidates.iter().filter(|c| c.candidate_kind == "HYPOTHESIS").collect();
    let facts: Vec<_> = draft.candidates.iter().filter(|c| c.candidate_kind == "FACT").collect();
    assert_eq!(facts.len(), 3, "golden sample must yield exactly 3 public facts");
    assert_eq!(hyps.len(), 4, "golden sample must yield exactly 4 hypotheses (H1-H4)");
    assert!(!hyps.iter().any(|c| c.statement.contains("以上均不是已发生事实")), "boundary note must not become a hypothesis");
    assert!(hyps.iter().any(|c| c.statement.contains("新品横跨品牌")));
    assert!(hyps.iter().any(|c| c.statement.contains("合规压力")));
    assert!(hyps.iter().any(|c| c.statement.contains("达人寄样")));
    assert!(hyps.iter().any(|c| c.statement.contains("评论、客服与退货")));
    let _ = std::fs::remove_file(std::path::Path::new("unused"));
  }

  #[tokio::test]
  async fn fact_authority_candidate_id_stability_and_sensitivity() {
    // 同输入 → 同 ID；改一个字符 → 不同 ID；kind/span 变化 → 不同 ID
    let draft1 = battle_card_authoritative::parse_authoritative_material(SAMPLE_RAW, "cust-tx", "MANUAL_PASTE");
    let draft2 = battle_card_authoritative::parse_authoritative_material(SAMPLE_RAW, "cust-tx", "MANUAL_PASTE");
    let ids1: Vec<_> = draft1.candidates.iter().map(|c| c.candidate_id.clone()).collect();
    let ids2: Vec<_> = draft2.candidates.iter().map(|c| c.candidate_id.clone()).collect();
    assert_eq!(ids1, ids2, "same raw must yield stable candidate ids");
    let tampered = battle_card_authoritative::parse_authoritative_material(&SAMPLE_RAW.replace("7000万元", "7亿元"), "cust-tx", "MANUAL_PASTE");
    let tampered_ids: Vec<_> = tampered.candidates.iter().map(|c| c.candidate_id.clone()).collect();
    assert_ne!(ids1, tampered_ids, "single character change must change candidate ids");
    // kind 变化 → ID 变化（同一 span 构造不同 kind）
    let f = draft1.candidates.iter().find(|c| c.candidate_kind == "FACT").unwrap();
    let as_hypothesis = battle_card_authoritative::build_candidate_id(
      &draft1.raw_content_sha256,
      battle_card_authoritative::PARSER_CONTRACT_VERSION,
      battle_card_authoritative::SOURCE_SPAN_CONTRACT_VERSION,
      "cust-tx",
      &draft1.import_scope_id,
      "HYPOTHESIS",
      &f.source_section,
      f.start_byte,
      f.end_byte,
      &f.excerpt_sha256,
      &f.statement_sha256,
    );
    assert_ne!(f.candidate_id, as_hypothesis, "candidate kind must be bound into the id");
    let _ = std::fs::remove_file(std::path::Path::new("unused"));
  }

  #[tokio::test]
  async fn fact_authority_expected_version_conflict_zero_write() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut connection = open_connection(&path).await.unwrap();
    sqlx::query(
      "INSERT INTO customer_stage_cards (id, customer_id, stage_code, version, schema_version, card_status, payload_json, evidence_snapshot_hash, generated_by, created_at)
       VALUES ('card-1', 'cust-tx', 'NEW_LEAD', 1, 'battle-card-payload-v1', 'DRAFT', '{}', 'h', 'DETERMINISTIC', '2026-08-03T00:00:00.000Z')",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let payload = BattleCardStageCardPayloadV1 {
      customer_id: "cust-tx".into(),
      card_id: "card-1".into(),
      expected_version: 2,
      confirmed_by: "HUMAN_CONFIRM".into(),
      confirmed_at: "2026-08-03T00:00:00.000Z".into(),
    };
    let result = run_confirm_stage_card(&mut connection, &payload, None).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    let options = SqliteConnectOptions::new().filename(&path).create_if_missing(false);
    let mut check = SqliteConnection::connect_with(&options).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT card_status FROM customer_stage_cards WHERE id = 'card-1'")
      .fetch_one(&mut check).await.unwrap();
    check.close().await.unwrap();
    assert_eq!(status, "DRAFT");
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_stage_card_success_and_pointer() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut connection = open_connection(&path).await.unwrap();
    sqlx::query(
      "INSERT INTO customer_stage_cards (id, customer_id, stage_code, version, schema_version, card_status, payload_json, evidence_snapshot_hash, generated_by, created_at)
       VALUES ('card-1', 'cust-tx', 'NEW_LEAD', 1, 'battle-card-payload-v1', 'DRAFT', '{}', 'h', 'DETERMINISTIC', '2026-08-03T00:00:00.000Z')",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    sqlx::query("UPDATE customers SET battle_card_status = 'DRAFT', updated_at = ? WHERE id = ?")
      .bind("2026-08-03T00:00:00.000Z").bind("cust-tx")
      .execute(&mut connection).await.unwrap();
    let payload = BattleCardStageCardPayloadV1 {
      customer_id: "cust-tx".into(),
      card_id: "card-1".into(),
      expected_version: 1,
      confirmed_by: "HUMAN_CONFIRM".into(),
      confirmed_at: "2026-08-03T00:00:00.000Z".into(),
    };
    let result = run_confirm_stage_card(&mut connection, &payload, None).await.unwrap();
    connection.close().await.unwrap();
    assert_eq!(result.card_status, "CONFIRMED");
    let options = SqliteConnectOptions::new().filename(&path).create_if_missing(false);
    let mut check = SqliteConnection::connect_with(&options).await.unwrap();
    let pointer: Option<String> = sqlx::query_scalar("SELECT current_stage_card_id FROM customers WHERE id = 'cust-tx'")
      .fetch_one(&mut check).await.unwrap();
    check.close().await.unwrap();
    assert_eq!(pointer.as_deref(), Some("card-1"));
    let _ = std::fs::remove_file(&path);
  }

  #[tokio::test]
  async fn fact_authority_stage_card_failpoint_rolls_back() {
    let path = temp_db_path();
    setup_db(&path, "cust-tx").await.unwrap();
    let mut connection = open_connection(&path).await.unwrap();
    sqlx::query(
      "INSERT INTO customer_stage_cards (id, customer_id, stage_code, version, schema_version, card_status, payload_json, evidence_snapshot_hash, generated_by, created_at)
       VALUES ('card-1', 'cust-tx', 'NEW_LEAD', 1, 'battle-card-payload-v1', 'DRAFT', '{}', 'h', 'DETERMINISTIC', '2026-08-03T00:00:00.000Z')",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    sqlx::query("UPDATE customers SET battle_card_status = 'DRAFT', updated_at = ? WHERE id = ?")
      .bind("2026-08-03T00:00:00.000Z").bind("cust-tx")
      .execute(&mut connection).await.unwrap();
    let payload = BattleCardStageCardPayloadV1 {
      customer_id: "cust-tx".into(),
      card_id: "card-1".into(),
      expected_version: 1,
      confirmed_by: "HUMAN_CONFIRM".into(),
      confirmed_at: "2026-08-03T00:00:00.000Z".into(),
    };
    let result = run_confirm_stage_card(&mut connection, &payload, Some("after-pointer-update")).await;
    connection.close().await.unwrap();
    assert!(result.is_err());
    let options = SqliteConnectOptions::new().filename(&path).create_if_missing(false);
    let mut check = SqliteConnection::connect_with(&options).await.unwrap();
    let card_status: String = sqlx::query_scalar("SELECT card_status FROM customer_stage_cards WHERE id = 'card-1'")
      .fetch_one(&mut check).await.unwrap();
    let pointer: Option<String> = sqlx::query_scalar("SELECT current_stage_card_id FROM customers WHERE id = 'cust-tx'")
      .fetch_one(&mut check).await.unwrap();
    check.close().await.unwrap();
    assert_eq!(card_status, "DRAFT");
    assert!(pointer.is_none());
    let _ = std::fs::remove_file(&path);
}
}
