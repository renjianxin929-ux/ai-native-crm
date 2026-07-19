use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::secure_credentials::{update_credential_with_compensation, CredentialStore, WindowsCredentialStore, TEXT_REASONING, VISION_ANALYSIS};

const MIGRATION_KEY: &str = "production_ai_credential_migration_v1";
const LEGACY_KEYS: [&str; 3] = ["ai_config", "text_ai_config", "multimodal_config"];
const NOT_STARTED: &str = "NOT_STARTED";
const CREDENTIAL_STAGED: &str = "CREDENTIAL_STAGED";
const CREDENTIAL_VERIFIED: &str = "CREDENTIAL_VERIFIED";
const SQLITE_SECRET_CLEARED: &str = "SQLITE_SECRET_CLEARED";
const COMPLETED: &str = "COMPLETED";
const RECOVERY_REQUIRED: &str = "RECOVERY_REQUIRED";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCredentialMigrationStatus {
  pub detected: bool,
  pub migration_version: Option<String>,
  pub state: &'static str,
  pub checked_at: String,
}

#[tauri::command]
pub async fn inspect_legacy_provider_credentials(app: AppHandle) -> Result<LegacyCredentialMigrationStatus, String> {
  let mut connection = open_app_database(&app).await?;
  inspect_connection(&mut connection).await
}

#[tauri::command]
pub async fn migrate_legacy_provider_credentials(app: AppHandle) -> Result<LegacyCredentialMigrationStatus, String> {
  let mut connection = open_app_database(&app).await?;
  migrate_connection(&mut connection, &WindowsCredentialStore).await
}

async fn open_app_database(app: &AppHandle) -> Result<SqliteConnection, String> {
  let path = resolve_personal_crm_db_path(app)?;
  let options = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(false);
  SqliteConnection::connect_with(&options).await.map_err(|_| "CRM database unavailable".to_string())
}

pub(crate) fn resolve_personal_crm_db_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_data_dir().map_err(|_| "app data directory unavailable".to_string())?.join("personal-crm.db"))
}

async fn inspect_connection(connection: &mut SqliteConnection) -> Result<LegacyCredentialMigrationStatus, String> {
  let migrated = sqlx::query("SELECT value FROM settings WHERE key = ?")
    .bind(MIGRATION_KEY)
    .fetch_optional(&mut *connection).await.map_err(|_| "legacy credential inspection failed".to_string())?;
  if let Some(row) = migrated {
    let value: String = row.get(0);
    let state = migration_state(&value).unwrap_or(RECOVERY_REQUIRED);
    return Ok(status(false, Some("v1".into()), state));
  }
  let records = read_legacy_records(connection).await?;
  let detected = records.iter().any(|(key, value)| extract_secret(key, value).is_some());
  Ok(status(detected, None, if detected { "detected" } else { "not_detected" }))
}

async fn read_legacy_records(connection: &mut SqliteConnection) -> Result<Vec<(String, String)>, String> {
  let rows = sqlx::query("SELECT key, value FROM settings WHERE key IN (?, ?, ?)")
    .bind(LEGACY_KEYS[0]).bind(LEGACY_KEYS[1]).bind(LEGACY_KEYS[2])
    .fetch_all(&mut *connection).await.map_err(|_| "legacy credential inspection failed".to_string())?;
  Ok(rows.into_iter().map(|row| (row.get::<String, _>(0), row.get::<String, _>(1))).collect())
}

pub(crate) async fn migrate_connection(
  connection: &mut SqliteConnection,
  store: &dyn CredentialStore,
) -> Result<LegacyCredentialMigrationStatus, String> {
  let existing_state: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?").bind(MIGRATION_KEY)
    .fetch_optional(&mut *connection).await.map_err(|_| "legacy credential inspection failed".to_string())?;
  if existing_state.as_deref().and_then(migration_state) == Some(COMPLETED) {
    return Ok(status(false, Some("v1".into()), COMPLETED));
  }
  if existing_state.as_deref().and_then(migration_state) == Some(SQLITE_SECRET_CLEARED) {
    write_migration_state(connection, COMPLETED).await?;
    return Ok(status(false, Some("v1".into()), COMPLETED));
  }
  let records = read_legacy_records(connection).await?;
  let mut secrets = BTreeMap::<&'static str, Zeroizing<String>>::new();
  for (key, value) in &records {
    if let Some(secret) = extract_secret(key, value) {
      let capability = if key.contains("multi") { VISION_ANALYSIS } else { TEXT_REASONING };
      if secrets.get(capability).is_some_and(|existing| existing.as_str() != secret) {
        return Err(format!("conflicting legacy credentials require user selection for {capability}"));
      }
      secrets.insert(capability, Zeroizing::new(secret));
    }
  }
  if secrets.is_empty() {
    if existing_state.is_some() {
      write_migration_state(connection, COMPLETED).await?;
      return Ok(status(false, Some("v1".into()), COMPLETED));
    }
    return Ok(status(false, None, "not_detected"));
  }

  write_migration_state(connection, NOT_STARTED).await?;

  let previous: BTreeMap<&str, Option<Zeroizing<String>>> = secrets.keys()
    .map(|capability| store.read(capability).map(|value| (*capability, value.map(Zeroizing::new))))
    .collect::<Result<_, _>>().map_err(|_| "secure credential migration read failed".to_string())?;
  let mut written: Vec<&str> = Vec::new();
  for (capability, secret) in &secrets {
    if let Err(error) = update_credential_with_compensation(store, capability, secret) {
      restore_previous(store, &previous, &written)?;
      return Err(format!("secure credential migration failed: {error}"));
    }
    written.push(capability);
  }
  if write_migration_state(connection, CREDENTIAL_STAGED).await.is_err() {
    restore_previous(store, &previous, &written)?;
    return Err("credential staged marker failed; previous credentials restored".into());
  }
  for (capability, secret) in &secrets {
    if store.read(capability).map_err(|_| "secure credential migration verification failed".to_string())?.as_deref() != Some(secret.as_str()) {
      restore_previous(store, &previous, &written)?;
      write_migration_state(connection, RECOVERY_REQUIRED).await?;
      return Err("secure credential migration verification failed".into());
    }
  }
  if write_migration_state(connection, CREDENTIAL_VERIFIED).await.is_err() {
    restore_previous(store, &previous, &written)?;
    return Err("credential verified marker failed; previous credentials restored".into());
  }

  let mut transaction = connection.begin().await.map_err(|_| "credential cleanup transaction unavailable".to_string())?;
  let cleanup = async {
    for (key, raw) in &records {
      let sanitized = sanitize_legacy_json(raw);
      sqlx::query("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?")
        .bind(sanitized).bind(Utc::now().to_rfc3339()).bind(key)
        .execute(&mut *transaction).await.map_err(|_| "legacy credential cleanup failed".to_string())?;
    }
    sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(MIGRATION_KEY)
      .bind(json!({ "version": "v1", "state": SQLITE_SECRET_CLEARED }).to_string())
      .bind(Utc::now().to_rfc3339())
      .execute(&mut *transaction).await.map_err(|_| "legacy credential migration marker failed".to_string())?;
    Ok::<(), String>(())
  }.await;
  if let Err(error) = cleanup {
    let _ = transaction.rollback().await;
    restore_previous(store, &previous, &written)?;
    return Err(error);
  }
  if transaction.commit().await.is_err() {
    restore_previous(store, &previous, &written)?;
    return Err("legacy credential cleanup commit failed".into());
  }
  write_migration_state(connection, COMPLETED).await?;
  Ok(status(false, Some("v1".into()), COMPLETED))
}

async fn write_migration_state(connection: &mut SqliteConnection, state: &str) -> Result<(), String> {
  sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(MIGRATION_KEY).bind(json!({ "version": "v1", "state": state }).to_string()).bind(Utc::now().to_rfc3339())
    .execute(connection).await.map_err(|_| "legacy credential migration marker failed".to_string())?;
  Ok(())
}

fn migration_state(raw: &str) -> Option<&'static str> {
  match serde_json::from_str::<Value>(raw).ok()?.get("state")?.as_str()? {
    NOT_STARTED => Some(NOT_STARTED),
    CREDENTIAL_STAGED => Some(CREDENTIAL_STAGED),
    CREDENTIAL_VERIFIED => Some(CREDENTIAL_VERIFIED),
    SQLITE_SECRET_CLEARED => Some(SQLITE_SECRET_CLEARED),
    COMPLETED => Some(COMPLETED),
    RECOVERY_REQUIRED => Some(RECOVERY_REQUIRED),
    _ => None,
  }
}

fn restore_previous(
  store: &dyn CredentialStore,
  previous: &BTreeMap<&str, Option<Zeroizing<String>>>,
  written: &[&str],
) -> Result<(), String> {
  for capability in written.iter().rev() {
    match previous.get(capability).and_then(|value| value.as_deref()) {
      Some(old) => store.write(capability, old).map_err(|_| "credential recovery required".to_string())?,
      None => store.delete(capability).map_err(|_| "credential recovery required".to_string())?,
    }
    if store.read(capability).map_err(|_| "credential recovery required".to_string())?.as_deref()
      != previous.get(capability).and_then(|value| value.as_deref()).map(|value| value.as_str()) {
      return Err("credential recovery required".into());
    }
  }
  Ok(())
}

fn extract_secret(key: &str, raw: &str) -> Option<String> {
  let value: Value = serde_json::from_str(raw).ok()?;
  let mut found = None;
  find_secret(&value, &mut found);
  if key == "ai_config" || key == "text_ai_config" || key == "multimodal_config" { found } else { None }
}

fn find_secret(value: &Value, found: &mut Option<String>) {
  match value {
    Value::Object(map) => for (key, nested) in map {
      let normalized = key.to_lowercase().replace(['_', '-'], "");
      if ["apikey", "textapikey", "multimodalapikey", "providerkey", "authorization", "token", "secret"].contains(&normalized.as_str()) {
        if let Some(secret) = nested.as_str().filter(|text| !text.trim().is_empty()) { *found = Some(secret.to_string()); }
      } else { find_secret(nested, found); }
    },
    Value::Array(items) => items.iter().for_each(|item| find_secret(item, found)),
    _ => {}
  }
}

fn sanitize_legacy_json(raw: &str) -> String {
  let mut value: Value = serde_json::from_str(raw).unwrap_or_else(|_| json!({ "legacy_value_removed": true }));
  remove_secrets(&mut value);
  value.to_string()
}

fn remove_secrets(value: &mut Value) {
  match value {
    Value::Object(map) => {
      let safe: Map<String, Value> = std::mem::take(map).into_iter().filter_map(|(key, mut nested)| {
        let normalized = key.to_lowercase().replace(['_', '-'], "");
        if ["apikey", "textapikey", "multimodalapikey", "providerkey", "authorization", "token", "secret"].contains(&normalized.as_str()) { return None; }
        remove_secrets(&mut nested);
        Some((key, nested))
      }).collect();
      *map = safe;
    }
    Value::Array(items) => items.iter_mut().for_each(remove_secrets),
    _ => {}
  }
}

fn status(detected: bool, migration_version: Option<String>, state: &'static str) -> LegacyCredentialMigrationStatus {
  LegacyCredentialMigrationStatus { detected, migration_version, state, checked_at: Utc::now().to_rfc3339() }
}

#[cfg(test)]
mod tests {
  use super::{inspect_connection, migrate_connection};
  use crate::secure_credentials::CredentialStore;
  use sqlx::sqlite::SqliteConnectOptions;
  use sqlx::{Connection, SqliteConnection};
  use std::collections::HashMap;
  use std::sync::Mutex;

  #[derive(Default)]
  struct FakeStore { values: Mutex<HashMap<String, String>>, fail_write: bool }
  impl CredentialStore for FakeStore {
    fn read(&self, capability: &str) -> Result<Option<String>, String> { Ok(self.values.lock().unwrap().get(capability).cloned()) }
    fn write(&self, capability: &str, secret: &str) -> Result<(), String> {
      if self.fail_write { return Err("injected failure".into()); }
      self.values.lock().unwrap().insert(capability.into(), secret.into()); Ok(())
    }
    fn delete(&self, capability: &str) -> Result<(), String> { self.values.lock().unwrap().remove(capability); Ok(()) }
  }

  async fn database() -> SqliteConnection {
    let root = std::env::temp_dir().join(format!("local-crm-migration-{}", uuid::Uuid::new_v4()));
    let app_data_dir = root.join("com.localcrm.desktop.e2e");
    std::fs::create_dir_all(&app_data_dir).unwrap();
    let path = app_data_dir.join("personal-crm.db");
    assert!(path.to_string_lossy().ends_with("com.localcrm.desktop.e2e\\personal-crm.db") || path.to_string_lossy().ends_with("com.localcrm.desktop.e2e/personal-crm.db"));
    let options = SqliteConnectOptions::new().filename(path).create_if_missing(true);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").execute(&mut connection).await.unwrap();
    connection
  }

  #[tokio::test]
  async fn real_personal_crm_migration_detects_migrates_cleans_and_is_idempotent() {
    let mut db = database().await;
    sqlx::query("INSERT INTO settings VALUES ('text_ai_config', '{\"apiKey\":\"dummy\",\"model\":\"deepseek-chat\"}', 'now')").execute(&mut db).await.unwrap();
    assert!(inspect_connection(&mut db).await.unwrap().detected);
    let store = FakeStore::default();
    assert_eq!(migrate_connection(&mut db, &store).await.unwrap().state, "COMPLETED");
    let value: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'text_ai_config'").fetch_one(&mut db).await.unwrap();
    assert!(!value.to_lowercase().contains("apikey"));
    assert_eq!(migrate_connection(&mut db, &store).await.unwrap().state, "COMPLETED");
  }

  #[tokio::test]
  async fn conflicting_text_credentials_fail_closed_without_silent_overwrite() {
    let mut db = database().await;
    sqlx::query("INSERT INTO settings VALUES ('ai_config', '{\"apiKey\":\"one\"}', 'now'), ('text_ai_config', '{\"apiKey\":\"two\"}', 'now')")
      .execute(&mut db).await.unwrap();
    let store = FakeStore::default();
    assert!(migrate_connection(&mut db, &store).await.unwrap_err().contains("conflicting legacy credentials"));
    assert!(store.values.lock().unwrap().is_empty());
  }

  #[tokio::test]
  async fn migration_recovery_completes_sqlite_secret_cleared_state_on_restart() {
    let mut db = database().await;
    sqlx::query("INSERT INTO settings VALUES (?, '{\"version\":\"v1\",\"state\":\"SQLITE_SECRET_CLEARED\"}', 'now')")
      .bind(super::MIGRATION_KEY).execute(&mut db).await.unwrap();
    let store = FakeStore::default();
    assert_eq!(migrate_connection(&mut db, &store).await.unwrap().state, "COMPLETED");
  }

  #[tokio::test]
  async fn secure_store_failure_leaves_sqlite_unchanged() {
    let mut db = database().await;
    let original = "{\"api_key\":\"dummy\"}";
    sqlx::query("INSERT INTO settings VALUES ('ai_config', ?, 'now')").bind(original).execute(&mut db).await.unwrap();
    let store = FakeStore { fail_write: true, ..Default::default() };
    assert!(migrate_connection(&mut db, &store).await.is_err());
    let value: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'ai_config'").fetch_one(&mut db).await.unwrap();
    assert_eq!(value, original);
  }

  struct PartialStore {
    values: Mutex<HashMap<String, String>>,
    fail_write_for: Option<&'static str>,
    fail_recovery_for: Option<&'static str>,
  }
  impl CredentialStore for PartialStore {
    fn read(&self, capability: &str) -> Result<Option<String>, String> { Ok(self.values.lock().unwrap().get(capability).cloned()) }
    fn write(&self, capability: &str, secret: &str) -> Result<(), String> {
      if self.fail_write_for == Some(capability) { return Err("injected staged write failure".into()); }
      if self.fail_recovery_for == Some(capability) && secret.starts_with("old-") { return Err("injected recovery failure".into()); }
      self.values.lock().unwrap().insert(capability.into(), secret.into()); Ok(())
    }
    fn delete(&self, capability: &str) -> Result<(), String> { self.values.lock().unwrap().remove(capability); Ok(()) }
  }

  #[tokio::test]
  async fn marker_failure_stops_before_any_credential_is_staged() {
    let mut db = database().await;
    sqlx::query("INSERT INTO settings VALUES ('text_ai_config', '{\"apiKey\":\"dummy\"}', 'now')").execute(&mut db).await.unwrap();
    sqlx::query(&format!("CREATE TRIGGER fail_marker BEFORE INSERT ON settings WHEN NEW.key = '{}' BEGIN SELECT RAISE(ABORT, 'marker'); END", super::MIGRATION_KEY)).execute(&mut db).await.unwrap();
    let store = FakeStore::default();
    assert!(migrate_connection(&mut db, &store).await.unwrap_err().contains("marker"));
    assert!(store.values.lock().unwrap().is_empty());
  }

  #[tokio::test]
  async fn credential_staged_restart_and_sqlite_clear_restart_complete_recoverable_saga() {
    for state in [super::CREDENTIAL_STAGED, super::SQLITE_SECRET_CLEARED] {
      let mut db = database().await;
      sqlx::query("INSERT INTO settings VALUES ('text_ai_config', '{\"apiKey\":\"dummy\"}', 'now'), (?, ?, 'now')")
        .bind(super::MIGRATION_KEY).bind(serde_json::json!({"version":"v1","state":state}).to_string()).execute(&mut db).await.unwrap();
      let store = FakeStore::default();
      assert_eq!(migrate_connection(&mut db, &store).await.unwrap().state, "COMPLETED");
    }
  }

  #[tokio::test]
  async fn two_provider_partial_failure_restores_old_credential_and_reports_recovery_failure() {
    let mut db = database().await;
    sqlx::query("INSERT INTO settings VALUES ('text_ai_config', '{\"apiKey\":\"new-text\"}', 'now'), ('multimodal_config', '{\"apiKey\":\"new-vision\"}', 'now')").execute(&mut db).await.unwrap();
    let partial = PartialStore {
      values: Mutex::new(HashMap::from([(crate::secure_credentials::TEXT_REASONING.into(), "old-text".into())])),
      fail_write_for: Some(crate::secure_credentials::VISION_ANALYSIS), fail_recovery_for: None,
    };
    assert!(migrate_connection(&mut db, &partial).await.is_err());
    assert_eq!(partial.values.lock().unwrap().get(crate::secure_credentials::TEXT_REASONING).map(String::as_str), Some("old-text"));

    let mut db = database().await;
    sqlx::query("INSERT INTO settings VALUES ('text_ai_config', '{\"apiKey\":\"new-text\"}', 'now'), ('multimodal_config', '{\"apiKey\":\"new-vision\"}', 'now')").execute(&mut db).await.unwrap();
    let recovery_failure = PartialStore {
      values: Mutex::new(HashMap::from([(crate::secure_credentials::TEXT_REASONING.into(), "old-text".into())])),
      fail_write_for: Some(crate::secure_credentials::VISION_ANALYSIS), fail_recovery_for: Some(crate::secure_credentials::TEXT_REASONING),
    };
    assert!(migrate_connection(&mut db, &recovery_failure).await.unwrap_err().contains("recovery required"));
  }

  #[tokio::test]
  async fn wrong_database_path_is_rejected_without_creating_a_file() {
    let path = std::env::temp_dir().join(format!("missing-local-crm-{}/com.localcrm.desktop.e2e/personal-crm.db", uuid::Uuid::new_v4()));
    let options = SqliteConnectOptions::new().filename(&path).create_if_missing(false);
    assert!(SqliteConnection::connect_with(&options).await.is_err());
    assert!(!path.exists());
  }
}
