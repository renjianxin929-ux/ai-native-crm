//! Same-connection SQLite transactions for FULL CRM restore and customer delete.
//! plugin-sql pooled execute() cannot guarantee BEGIN/COMMIT affinity.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Connection, SqliteConnection};
use tauri::{AppHandle, Manager};

const DB_FILE_NAME: &str = "personal-crm.db";

const BACKUP_TABLES: &[&str] = &[
  "customers",
  "follow_up_records",
  "visit_records",
  "tasks",
  "settings",
  "ai_drafts",
  "evidence",
  "ai_memory_entries",
  "ai_memory_evidence_links",
  "intelligence_imports",
  "reviewed_facts",
  "customer_hypotheses",
  "customer_stage_cards",
  "lead_import_batches",
  "lead_import_rows",
  "lead_work_items",
  "lead_capture_events",
  "collected_leads",
  "lead_sync_logs",
];

const RESTORE_INSERT_ORDER: &[&str] = &[
  "settings",
  "customers",
  "customer_stage_cards",
  "ai_memory_entries",
  "ai_memory_evidence_links",
  "evidence",
  "follow_up_records",
  "visit_records",
  "tasks",
  "ai_drafts",
  "intelligence_imports",
  "reviewed_facts",
  "customer_hypotheses",
  "lead_import_batches",
  "lead_import_rows",
  "lead_work_items",
  "lead_capture_events",
  "collected_leads",
  "lead_sync_logs",
];

fn resolve_database_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|_| "crm lifecycle: app data directory unavailable".to_string())?;
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
    .map_err(|error| format!("crm lifecycle: production database unavailable: {error}"))
}

fn is_allowed_table(name: &str) -> bool {
  BACKUP_TABLES.contains(&name)
}

fn is_safe_identifier(name: &str) -> bool {
  !name.is_empty()
    && name.len() <= 64
    && name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

enum BindValue {
  Null,
  Text(String),
  Integer(i64),
  Real(f64),
}

fn json_to_bind(value: &Value) -> BindValue {
  match value {
    Value::Null => BindValue::Null,
    Value::Bool(flag) => BindValue::Integer(i64::from(*flag)),
    Value::Number(number) => {
      if let Some(int) = number.as_i64() {
        BindValue::Integer(int)
      } else if let Some(float) = number.as_f64() {
        BindValue::Real(float)
      } else {
        BindValue::Text(number.to_string())
      }
    }
    Value::String(text) => BindValue::Text(text.clone()),
    other => BindValue::Text(other.to_string()),
  }
}

#[tauri::command]
pub async fn restore_full_backup_atomic(
  app: AppHandle,
  payload: HashMap<String, Vec<Value>>,
) -> Result<HashMap<String, i64>, String> {
  for key in payload.keys() {
    if !is_allowed_table(key) {
      return Err(format!("restore rejected unknown table {key}"));
    }
  }
  let path = resolve_database_path(&app)?;
  let mut conn = open_connection(&path).await?;
  let mut tx = conn.begin().await.map_err(|error| format!("restore begin failed: {error}"))?;
  sqlx::query("PRAGMA defer_foreign_keys = ON")
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("restore defer_foreign_keys failed: {error}"))?;

  for table in RESTORE_INSERT_ORDER.iter().rev() {
    let sql = format!("DELETE FROM {table}");
    sqlx::query(&sql)
      .execute(&mut *tx)
      .await
      .map_err(|error| format!("restore delete {table} failed: {error}"))?;
  }

  for table in RESTORE_INSERT_ORDER {
    let rows = payload.get(*table).cloned().unwrap_or_default();
    for row in rows {
      let object = row
        .as_object()
        .ok_or_else(|| format!("restore row in {table} must be an object"))?;
      if object.is_empty() {
        return Err(format!("restore row in {table} must not be empty"));
      }
      let columns: Vec<String> = object.keys().cloned().collect();
      for column in &columns {
        if !is_safe_identifier(column) {
          return Err(format!("unsafe column {column} in {table}"));
        }
      }
      let binds: Vec<BindValue> = columns.iter().map(|column| json_to_bind(&object[column])).collect();
      let placeholders = vec!["?"; columns.len()].join(", ");
      let sql = format!("INSERT INTO {table} ({}) VALUES ({placeholders})", columns.join(", "));
      let mut query = sqlx::query(&sql);
      for bind in &binds {
        query = match bind {
          BindValue::Null => query.bind(None::<String>),
          BindValue::Text(text) => query.bind(text.as_str()),
          BindValue::Integer(int) => query.bind(*int),
          BindValue::Real(real) => query.bind(*real),
        };
      }
      query
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("restore insert {table} failed: {error}"))?;
    }
  }

  let mut restored = HashMap::new();
  for table in BACKUP_TABLES {
    let expected = payload.get(*table).map(Vec::len).unwrap_or(0) as i64;
    let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
      .fetch_one(&mut *tx)
      .await
      .map_err(|error| format!("restore count {table} failed: {error}"))?;
    if count != expected {
      return Err(format!("restore count mismatch for {table}: expected {expected}, got {count}"));
    }
    restored.insert((*table).to_string(), count);
  }

  tx.commit().await.map_err(|error| format!("restore commit failed: {error}"))?;
  Ok(restored)
}

#[tauri::command]
pub async fn delete_customer_atomic(app: AppHandle, customer_id: String) -> Result<(), String> {
  if customer_id.trim().is_empty() {
    return Err("delete_customer_atomic requires a customer id".into());
  }
  let path = resolve_database_path(&app)?;
  let mut conn = open_connection(&path).await?;
  let mut tx = conn.begin().await.map_err(|error| format!("delete begin failed: {error}"))?;
  sqlx::query("PRAGMA defer_foreign_keys = ON")
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("delete defer_foreign_keys failed: {error}"))?;

  let statements = [
    "UPDATE customers SET current_stage_card_id = NULL WHERE id = ?",
    "DELETE FROM ai_memory_evidence_links WHERE memory_id IN (SELECT id FROM ai_memory_entries WHERE customer_id = ?)",
    "DELETE FROM ai_memory_entries WHERE customer_id = ?",
    "DELETE FROM ai_drafts WHERE customer_id = ?",
    "DELETE FROM evidence WHERE customer_id = ?",
    "DELETE FROM follow_up_records WHERE customer_id = ?",
    "DELETE FROM visit_records WHERE customer_id = ?",
    "DELETE FROM tasks WHERE customer_id = ?",
    "DELETE FROM customer_hypotheses WHERE customer_id = ?",
    "DELETE FROM reviewed_facts WHERE customer_id = ?",
    "DELETE FROM intelligence_imports WHERE customer_id = ?",
    "DELETE FROM customer_stage_cards WHERE customer_id = ?",
    "UPDATE lead_work_items SET customer_id = NULL WHERE customer_id = ?",
    "UPDATE collected_leads SET customer_id = NULL WHERE customer_id = ?",
    "UPDATE lead_sync_logs SET target_customer_id = NULL WHERE target_customer_id = ?",
    "DELETE FROM customers WHERE id = ?",
  ];
  for sql in statements {
    sqlx::query(sql)
      .bind(&customer_id)
      .execute(&mut *tx)
      .await
      .map_err(|error| format!("delete step failed: {error}"))?;
  }
  tx.commit().await.map_err(|error| format!("delete commit failed: {error}"))?;
  Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurredFollowUpAtomicPayload {
  pub id: String,
  pub customer_id: String,
  pub title: String,
  pub feedback_notes: Option<String>,
  pub created_at: String,
  pub last_contacted_at: String,
  pub next_follow_up_at: Option<String>,
  pub is_completed: i64,
}

#[tauri::command]
pub async fn persist_occurred_follow_up_atomic(
  app: AppHandle,
  payload: OccurredFollowUpAtomicPayload,
) -> Result<(), String> {
  if payload.id.trim().is_empty() || payload.customer_id.trim().is_empty() || payload.title.trim().is_empty() {
    return Err("persist_occurred_follow_up_atomic requires id, customer_id, and title".into());
  }
  let path = resolve_database_path(&app)?;
  let mut conn = open_connection(&path).await?;
  let mut tx = conn.begin().await.map_err(|error| format!("follow-up begin failed: {error}"))?;
  sqlx::query(
    "INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result, feedback_notes, intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?)",
  )
  .bind(&payload.id)
  .bind(&payload.customer_id)
  .bind(&payload.title)
  .bind(&payload.feedback_notes)
  .bind(payload.is_completed)
  .bind(&payload.created_at)
  .bind(&payload.created_at)
  .execute(&mut *tx)
  .await
  .map_err(|error| format!("follow-up insert failed: {error}"))?;

  if let Some(next) = payload.next_follow_up_at.as_ref().filter(|value| !value.trim().is_empty()) {
    sqlx::query("UPDATE customers SET last_contacted_at = ?, next_follow_up_at = ?, updated_at = ? WHERE id = ?")
      .bind(&payload.last_contacted_at)
      .bind(next)
      .bind(&payload.created_at)
      .bind(&payload.customer_id)
      .execute(&mut *tx)
      .await
      .map_err(|error| format!("follow-up customer update failed: {error}"))?;
  } else {
    sqlx::query("UPDATE customers SET last_contacted_at = ?, updated_at = ? WHERE id = ?")
      .bind(&payload.last_contacted_at)
      .bind(&payload.created_at)
      .bind(&payload.customer_id)
      .execute(&mut *tx)
      .await
      .map_err(|error| format!("follow-up customer update failed: {error}"))?;
  }
  tx.commit().await.map_err(|error| format!("follow-up commit failed: {error}"))?;
  Ok(())
}
