use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use zeroize::Zeroizing;

pub const TEXT_REASONING: &str = "TEXT_REASONING";
pub const VISION_REASONING: &str = "VISION_REASONING";
pub const ENCRYPTION_SCHEME: &str = "WINDOWS_DPAPI_CURRENT_USER_V1";
const ENTROPY: &[u8] = b"com.localcrm.desktop::ai_provider_credentials::v1";
const MAX_PLAINTEXT_BYTES: usize = 4096;
const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024;

const CREATE_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL UNIQUE CHECK (capability IN ('TEXT_REASONING', 'VISION_REASONING')),
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  encrypted_api_key BLOB NOT NULL,
  encryption_scheme TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  config_status TEXT NOT NULL,
  last_health_check_at TEXT,
  last_health_check_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
"#;

#[derive(Clone)]
pub struct EncryptedCredentialStore { database_path: PathBuf }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialInput {
  pub capability: String,
  pub provider: String,
  pub endpoint: String,
  pub model: String,
  pub api_key: String,
}

impl Drop for ProviderCredentialInput {
  fn drop(&mut self) { zeroize::Zeroize::zeroize(&mut self.api_key); }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialStatus {
  pub capability: String,
  pub provider: String,
  pub provider_kind: String,
  pub endpoint: String,
  pub model_id: String,
  pub configured: bool,
  pub status: String,
  pub checked_at: Option<String>,
  pub detail: String,
}

pub struct RuntimeCredential {
  pub provider: String,
  pub provider_kind: String,
  pub endpoint: String,
  pub model: String,
  pub api_key: Zeroizing<String>,
}

impl EncryptedCredentialStore {
  pub fn new(database_path: PathBuf) -> Self { Self { database_path } }

  pub fn database_path(&self) -> &Path { &self.database_path }

  pub async fn ensure_schema(&self) -> Result<(), String> {
    let mut connection = open_database(&self.database_path).await?;
    sqlx::query(CREATE_TABLE_SQL).execute(&mut connection).await
      .map_err(|_| "credential table unavailable".to_string())?;
    connection.close().await.map_err(|_| "credential database close failed".to_string())
  }

  pub async fn save(&self, mut input: ProviderCredentialInput) -> Result<ProviderCredentialStatus, String> {
    let capability = storage_capability(&input.capability)?.to_string();
    validate_config_text(&input.provider, &input.endpoint, &input.model)?;
    if input.api_key.is_empty() || input.api_key.len() > MAX_PLAINTEXT_BYTES { return Err("credential is empty or too large".into()); }
    let secret = Zeroizing::new(std::mem::take(&mut input.api_key));
    let encrypted = protect(secret.as_bytes())?;
    if encrypted.is_empty() || encrypted.len() > MAX_CIPHERTEXT_BYTES || encrypted.as_slice() == secret.as_bytes() {
      return Err("credential encryption verification failed".into());
    }
    let mut connection = open_database(&self.database_path).await?;
    let mut transaction = connection.begin().await.map_err(|_| "credential save transaction unavailable".to_string())?;
    sqlx::query(CREATE_TABLE_SQL).execute(&mut *transaction).await
      .map_err(|_| "credential table unavailable".to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = format!("ai-provider-credential-{}", capability.to_ascii_lowercase().replace('_', "-"));
    let write = sqlx::query("INSERT INTO ai_provider_credentials (id, capability, provider, endpoint, model, encrypted_api_key, encryption_scheme, key_version, config_status, last_health_check_at, last_health_check_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CONFIGURED', NULL, NULL, ?, ?) ON CONFLICT(capability) DO UPDATE SET provider=excluded.provider, endpoint=excluded.endpoint, model=excluded.model, encrypted_api_key=excluded.encrypted_api_key, encryption_scheme=excluded.encryption_scheme, key_version=1, config_status='CONFIGURED', last_health_check_at=NULL, last_health_check_status=NULL, updated_at=excluded.updated_at")
      .bind(id).bind(&capability).bind(input.provider.trim()).bind(input.endpoint.trim()).bind(input.model.trim())
      .bind(encrypted).bind(ENCRYPTION_SCHEME).bind(&now).bind(&now).execute(&mut *transaction).await;
    if write.is_err() { let _ = transaction.rollback().await; return Err("encrypted credential write failed".into()); }
    let ciphertext: Vec<u8> = sqlx::query_scalar("SELECT encrypted_api_key FROM ai_provider_credentials WHERE capability = ?")
      .bind(&capability).fetch_one(&mut *transaction).await.map_err(|_| "encrypted credential readback failed".to_string())?;
    let decrypted = unprotect(&ciphertext)?;
    if decrypted.as_slice() != secret.as_bytes() { let _ = transaction.rollback().await; return Err("credential decrypt verification failed".into()); }
    transaction.commit().await.map_err(|_| "credential save commit failed".to_string())?;
    self.status(&input.capability).await
  }

  pub async fn delete(&self, capability: &str) -> Result<ProviderCredentialStatus, String> {
    let stored = storage_capability(capability)?;
    let mut connection = open_database(&self.database_path).await?;
    sqlx::query(CREATE_TABLE_SQL).execute(&mut connection).await.map_err(|_| "credential table unavailable".to_string())?;
    sqlx::query("DELETE FROM ai_provider_credentials WHERE capability = ?").bind(stored).execute(&mut connection).await
      .map_err(|_| "credential delete failed".to_string())?;
    connection.close().await.map_err(|_| "credential database close failed".to_string())?;
    self.status(capability).await
  }

  pub async fn status(&self, capability: &str) -> Result<ProviderCredentialStatus, String> {
    let stored = storage_capability(capability)?;
    let mut connection = open_database(&self.database_path).await?;
    sqlx::query(CREATE_TABLE_SQL).execute(&mut connection).await.map_err(|_| "credential table unavailable".to_string())?;
    let row = sqlx::query("SELECT provider, endpoint, model, config_status, last_health_check_at, last_health_check_status FROM ai_provider_credentials WHERE capability = ?")
      .bind(stored).fetch_optional(&mut connection).await.map_err(|_| "credential status unavailable".to_string())?;
    connection.close().await.map_err(|_| "credential database close failed".to_string())?;
    match row {
      Some(row) => {
        let provider: String = row.try_get("provider").map_err(|_| "credential status unavailable".to_string())?;
        let endpoint: String = row.try_get("endpoint").map_err(|_| "credential status unavailable".to_string())?;
        let model_id: String = row.try_get("model").map_err(|_| "credential status unavailable".to_string())?;
        let config_status: String = row.try_get("config_status").map_err(|_| "credential status unavailable".to_string())?;
        let checked_at: Option<String> = row.try_get("last_health_check_at").map_err(|_| "credential status unavailable".to_string())?;
        let last_status: Option<String> = row.try_get("last_health_check_status").map_err(|_| "credential status unavailable".to_string())?;
        Ok(ProviderCredentialStatus {
          capability: runtime_capability(stored).into(), provider_kind: provider_kind(stored).into(), provider,
          endpoint, model_id, configured: true, status: last_status.unwrap_or(config_status), checked_at,
          detail: "encrypted credential configured in local SQLite".into(),
        })
      }
      None => Ok(ProviderCredentialStatus {
        capability: runtime_capability(stored).into(), provider: default_provider(stored).into(), provider_kind: provider_kind(stored).into(),
        endpoint: String::new(), model_id: String::new(), configured: false, status: "UNCONFIGURED".into(), checked_at: None,
        detail: "credential not configured".into(),
      }),
    }
  }

  pub async fn list_status(&self) -> Result<Vec<ProviderCredentialStatus>, String> {
    Ok(vec![self.status(TEXT_REASONING).await?, self.status("VISION_ANALYSIS").await?])
  }

  pub async fn load_runtime(&self, capability: &str) -> Result<RuntimeCredential, String> {
    let stored = storage_capability(capability)?;
    let mut connection = open_database(&self.database_path).await?;
    let row = sqlx::query("SELECT provider, endpoint, model, encrypted_api_key, encryption_scheme, key_version FROM ai_provider_credentials WHERE capability = ?")
      .bind(stored).fetch_optional(&mut connection).await.map_err(|_| "credential read failed".to_string())?
      .ok_or_else(|| "credential not configured".to_string())?;
    connection.close().await.map_err(|_| "credential database close failed".to_string())?;
    let scheme: String = row.try_get("encryption_scheme").map_err(|_| "credential read failed".to_string())?;
    let version: i64 = row.try_get("key_version").map_err(|_| "credential read failed".to_string())?;
    let ciphertext: Vec<u8> = row.try_get("encrypted_api_key").map_err(|_| "credential read failed".to_string())?;
    if scheme != ENCRYPTION_SCHEME || version != 1 || ciphertext.is_empty() || ciphertext.len() > MAX_CIPHERTEXT_BYTES {
      return Err("credential metadata invalid".into());
    }
    let plaintext = unprotect(&ciphertext)?;
    let api_key = Zeroizing::new(String::from_utf8(plaintext.to_vec()).map_err(|_| "credential decryption failed".to_string())?);
    if api_key.is_empty() || api_key.len() > MAX_PLAINTEXT_BYTES { return Err("credential decryption failed".into()); }
    Ok(RuntimeCredential {
      provider: row.try_get("provider").map_err(|_| "credential read failed".to_string())?,
      provider_kind: provider_kind(stored).into(),
      endpoint: completion_endpoint(&row.try_get::<String, _>("endpoint").map_err(|_| "credential read failed".to_string())?),
      model: row.try_get("model").map_err(|_| "credential read failed".to_string())?, api_key,
    })
  }

  pub async fn record_health(&self, capability: &str, status: &str) -> Result<(), String> {
    let stored = storage_capability(capability)?;
    let mut connection = open_database(&self.database_path).await?;
    sqlx::query("UPDATE ai_provider_credentials SET last_health_check_at = ?, last_health_check_status = ?, updated_at = ? WHERE capability = ?")
      .bind(Utc::now().to_rfc3339()).bind(status).bind(Utc::now().to_rfc3339()).bind(stored)
      .execute(&mut connection).await.map_err(|_| "credential health status update failed".to_string())?;
    Ok(())
  }
}

fn storage_capability(capability: &str) -> Result<&'static str, String> {
  match capability {
    TEXT_REASONING | "SEMANTIC_INTENT_ROUTING" => Ok(TEXT_REASONING),
    VISION_REASONING | "VISION_ANALYSIS" => Ok(VISION_REASONING),
    _ => Err("unsupported credential capability".into()),
  }
}

fn runtime_capability(capability: &str) -> &'static str { if capability == VISION_REASONING { "VISION_ANALYSIS" } else { TEXT_REASONING } }
fn provider_kind(capability: &str) -> &'static str { if capability == VISION_REASONING { "QWEN_VISION_COMPATIBLE" } else { "DEEPSEEK_COMPATIBLE" } }
fn default_provider(capability: &str) -> &'static str { if capability == VISION_REASONING { "qwen" } else { "deepseek" } }

fn completion_endpoint(endpoint: &str) -> String {
  let trimmed = endpoint.trim_end_matches('/');
  if trimmed.ends_with("/chat/completions") { trimmed.into() } else { format!("{trimmed}/chat/completions") }
}

fn validate_config_text(provider: &str, endpoint: &str, model: &str) -> Result<(), String> {
  if provider.trim().is_empty() || provider.len() > 128 || model.trim().is_empty() || model.len() > 256 { return Err("provider configuration invalid".into()); }
  let endpoint = endpoint.trim();
  if !endpoint.starts_with("https://") || endpoint.len() > 2048 || endpoint.contains('@') { return Err("provider endpoint invalid".into()); }
  Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlaintextMigrationEvidence {
  pub quick_check: String,
  pub migrated_capabilities: Vec<String>,
  pub ciphertext_rows: usize,
  pub decrypt_readback_verified: bool,
  pub legacy_api_keys_cleared: bool,
  pub exact_plaintext_scan_hits: usize,
  pub rollback_performed: bool,
}

struct LegacyConfig {
  settings_key: &'static str,
  capability: &'static str,
  provider: String,
  endpoint: String,
  model: String,
  secret: Zeroizing<String>,
  sanitized_json: String,
  sanitized_value: Value,
}

pub async fn migrate_plaintext_settings_database(
  database_path: &Path,
  verified_backup_path: &Path,
) -> Result<PlaintextMigrationEvidence, String> {
  validate_exact_production_path(database_path)?;
  validate_backup(verified_backup_path).await?;

  let mut connection = open_database(database_path).await?;
  sqlx::query("PRAGMA busy_timeout = 10000").execute(&mut connection).await
    .map_err(|_| "migration database unavailable".to_string())?;
  sqlx::query("PRAGMA secure_delete = ON").execute(&mut connection).await
    .map_err(|_| "secure deletion policy unavailable".to_string())?;
  ensure_quick_check(&mut connection).await?;

  if let Some(secrets) = completed_migration_secrets(&mut connection).await? {
    connection.close().await.map_err(|_| "credential migration database close failed".to_string())?;
    let exact_hits = exact_plaintext_file_hits_for_secrets(database_path, &secrets)?;
    if exact_hits != 0 { return Err("plaintext residue detected in completed migration".into()); }
    return Ok(PlaintextMigrationEvidence {
      quick_check: "ok".into(), migrated_capabilities: vec![TEXT_REASONING.into(), VISION_REASONING.into()],
      ciphertext_rows: 2, decrypt_readback_verified: true, legacy_api_keys_cleared: true,
      exact_plaintext_scan_hits: 0, rollback_performed: false,
    });
  }

  let mut transaction = connection.begin().await.map_err(|_| "credential migration transaction unavailable".to_string())?;
  let transaction_result = migrate_transaction(&mut transaction).await;
  let configs = match transaction_result {
    Ok(configs) => configs,
    Err(error) => {
      let _ = transaction.rollback().await;
      return Err(error);
    }
  };
  if transaction.commit().await.is_err() {
    return Err("credential migration commit failed".into());
  }

  if sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&mut connection).await.is_err() {
    drop(connection);
    restore_verified_backup(database_path, verified_backup_path)?;
    return Err("credential migration durability verification failed; backup restored".into());
  }
  if ensure_quick_check(&mut connection).await.is_err() {
    drop(connection);
    restore_verified_backup(database_path, verified_backup_path)?;
    return Err("credential migration integrity verification failed; backup restored".into());
  }
  connection.close().await.map_err(|_| "credential migration database close failed".to_string())?;

  let exact_hits = exact_plaintext_file_hits(database_path, &configs)?;
  if exact_hits != 0 {
    restore_verified_backup(database_path, verified_backup_path)?;
    return Err("plaintext residue detected; backup restored".into());
  }

  Ok(PlaintextMigrationEvidence {
    quick_check: "ok".into(),
    migrated_capabilities: vec![TEXT_REASONING.into(), VISION_REASONING.into()],
    ciphertext_rows: 2,
    decrypt_readback_verified: true,
    legacy_api_keys_cleared: true,
    exact_plaintext_scan_hits: 0,
    rollback_performed: false,
  })
}

async fn completed_migration_secrets(connection: &mut SqliteConnection) -> Result<Option<Vec<Zeroizing<String>>>, String> {
  let settings = sqlx::query("SELECT key, value FROM settings WHERE key IN ('text_ai_config','multimodal_config') ORDER BY key")
    .fetch_all(&mut *connection).await.map_err(|_| "completed migration inspection failed".to_string())?;
  if settings.len() != 2 { return Ok(None); }
  for row in settings {
    let raw: String = row.try_get("value").map_err(|_| "completed migration inspection failed".to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| "completed migration inspection failed".to_string())?;
    if value.get("apiKey").is_some() { return Ok(None); }
  }
  let rows = sqlx::query("SELECT capability, encrypted_api_key, encryption_scheme, key_version FROM ai_provider_credentials ORDER BY capability")
    .fetch_all(&mut *connection).await.map_err(|_| "completed migration inspection failed".to_string())?;
  if rows.len() != 2 { return Err("completed migration credential set is incomplete".into()); }
  let mut secrets = Vec::with_capacity(2);
  for (index, row) in rows.into_iter().enumerate() {
    let capability: String = row.try_get("capability").map_err(|_| "completed migration inspection failed".to_string())?;
    let ciphertext: Vec<u8> = row.try_get("encrypted_api_key").map_err(|_| "completed migration inspection failed".to_string())?;
    let scheme: String = row.try_get("encryption_scheme").map_err(|_| "completed migration inspection failed".to_string())?;
    let version: i64 = row.try_get("key_version").map_err(|_| "completed migration inspection failed".to_string())?;
    let expected = if index == 0 { TEXT_REASONING } else { VISION_REASONING };
    if capability != expected || ciphertext.is_empty() || ciphertext.len() > MAX_CIPHERTEXT_BYTES || scheme != ENCRYPTION_SCHEME || version != 1 {
      return Err("completed migration credential set is invalid".into());
    }
    let plaintext = unprotect(&ciphertext)?;
    secrets.push(Zeroizing::new(String::from_utf8(plaintext.to_vec()).map_err(|_| "credential decryption failed".to_string())?));
  }
  Ok(Some(secrets))
}

async fn migrate_transaction(
  transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<LegacyConfig>, String> {
  sqlx::query(CREATE_TABLE_SQL).execute(&mut **transaction).await
    .map_err(|_| "credential table creation failed".to_string())?;

  let mut configs = Vec::with_capacity(2);
  configs.push(load_legacy_config(transaction, "text_ai_config", TEXT_REASONING, "model").await?);
  configs.push(load_legacy_config(transaction, "multimodal_config", VISION_REASONING, "visionModel").await?);

  let now = Utc::now().to_rfc3339();
  for config in &configs {
    let encrypted = protect(config.secret.as_bytes())?;
    if encrypted.is_empty() || encrypted.len() > MAX_CIPHERTEXT_BYTES || encrypted.as_slice() == config.secret.as_bytes() {
      return Err("credential encryption verification failed".into());
    }
    let id = format!("ai-provider-credential-{}", config.capability.to_ascii_lowercase().replace('_', "-"));
    sqlx::query(
      "INSERT INTO ai_provider_credentials (id, capability, provider, endpoint, model, encrypted_api_key, encryption_scheme, key_version, config_status, last_health_check_at, last_health_check_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'CONFIGURED', NULL, NULL, ?, ?) ON CONFLICT(capability) DO UPDATE SET provider=excluded.provider, endpoint=excluded.endpoint, model=excluded.model, encrypted_api_key=excluded.encrypted_api_key, encryption_scheme=excluded.encryption_scheme, key_version=excluded.key_version, config_status='CONFIGURED', last_health_check_at=NULL, last_health_check_status=NULL, updated_at=excluded.updated_at",
    )
      .bind(id)
      .bind(config.capability)
      .bind(&config.provider)
      .bind(&config.endpoint)
      .bind(&config.model)
      .bind(encrypted)
      .bind(ENCRYPTION_SCHEME)
      .bind(&now)
      .bind(&now)
      .execute(&mut **transaction).await
      .map_err(|_| "encrypted credential write failed".to_string())?;
  }

  for config in &configs {
    let row = sqlx::query("SELECT encrypted_api_key, encryption_scheme, key_version FROM ai_provider_credentials WHERE capability = ?")
      .bind(config.capability)
      .fetch_one(&mut **transaction).await
      .map_err(|_| "encrypted credential readback failed".to_string())?;
    let ciphertext: Vec<u8> = row.try_get("encrypted_api_key").map_err(|_| "encrypted credential readback failed".to_string())?;
    let scheme: String = row.try_get("encryption_scheme").map_err(|_| "encrypted credential readback failed".to_string())?;
    let version: i64 = row.try_get("key_version").map_err(|_| "encrypted credential readback failed".to_string())?;
    if ciphertext.is_empty() || ciphertext.len() > MAX_CIPHERTEXT_BYTES || ciphertext.as_slice() == config.secret.as_bytes() || scheme != ENCRYPTION_SCHEME || version != 1 {
      return Err("encrypted credential readback verification failed".into());
    }
    let decrypted = unprotect(&ciphertext)?;
    if decrypted.as_slice() != config.secret.as_bytes() {
      return Err("credential decrypt verification failed".into());
    }
  }

  for config in &configs {
    sqlx::query("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?")
      .bind(&config.sanitized_json)
      .bind(&now)
      .bind(config.settings_key)
      .execute(&mut **transaction).await
      .map_err(|_| "legacy credential cleanup failed".to_string())?;
    let readback: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
      .bind(config.settings_key)
      .fetch_one(&mut **transaction).await
      .map_err(|_| "legacy settings readback failed".to_string())?;
    let readback_value: Value = serde_json::from_str(&readback).map_err(|_| "legacy settings readback failed".to_string())?;
    if readback_value.get("apiKey").is_some() || readback_value != config.sanitized_value {
      return Err("legacy settings cleanup verification failed".into());
    }
  }

  Ok(configs)
}

async fn load_legacy_config(
  transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
  settings_key: &'static str,
  capability: &'static str,
  model_field: &str,
) -> Result<LegacyConfig, String> {
  let raw = Zeroizing::new(
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
      .bind(settings_key)
      .fetch_one(&mut **transaction).await
      .map_err(|_| "authorized legacy setting is missing".to_string())?,
  );
  let mut value: Value = serde_json::from_str(raw.as_str()).map_err(|_| "authorized legacy setting is invalid".to_string())?;
  let object = value.as_object_mut().ok_or_else(|| "authorized legacy setting is invalid".to_string())?;
  let secret = match object.remove("apiKey") {
    Some(Value::String(secret)) if !secret.is_empty() && secret.len() <= MAX_PLAINTEXT_BYTES => Zeroizing::new(secret),
    _ => return Err("authorized legacy API key is missing or invalid".into()),
  };
  let provider = required_string(object.get("provider"), "provider")?;
  let endpoint = required_string(object.get("baseUrl"), "endpoint")?;
  let model = required_string(object.get(model_field), "model")?;
  let sanitized_value = value;
  let sanitized_json = serde_json::to_string(&sanitized_value).map_err(|_| "legacy setting sanitization failed".to_string())?;
  Ok(LegacyConfig { settings_key, capability, provider, endpoint, model, secret, sanitized_json, sanitized_value })
}

fn required_string(value: Option<&Value>, field: &str) -> Result<String, String> {
  value.and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
    .map(str::to_owned).ok_or_else(|| format!("legacy {field} is missing"))
}

async fn open_database(path: &Path) -> Result<SqliteConnection, String> {
  SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path).create_if_missing(false)).await
    .map_err(|_| "production database unavailable".to_string())
}

async fn ensure_quick_check(connection: &mut SqliteConnection) -> Result<(), String> {
  let result: String = sqlx::query_scalar("PRAGMA quick_check").fetch_one(connection).await
    .map_err(|_| "database integrity check failed".to_string())?;
  if result != "ok" { return Err("database integrity check failed".into()); }
  Ok(())
}

async fn validate_backup(path: &Path) -> Result<(), String> {
  if !path.is_file() { return Err("verified migration backup is missing".into()); }
  let mut backup = open_database(path).await?;
  ensure_quick_check(&mut backup).await?;
  backup.close().await.map_err(|_| "backup validation failed".to_string())
}

fn validate_exact_production_path(path: &Path) -> Result<(), String> {
  let expected = PathBuf::from(r"C:\Users\Administrator\AppData\Roaming\com.localcrm.desktop\personal-crm.db");
  let actual = path.canonicalize().map_err(|_| "production database path unavailable".to_string())?;
  let expected = expected.canonicalize().map_err(|_| "production database path unavailable".to_string())?;
  if actual != expected { return Err("migration target is not the authorized production database".into()); }
  Ok(())
}

fn exact_plaintext_file_hits(path: &Path, configs: &[LegacyConfig]) -> Result<usize, String> {
  let mut hits = 0usize;
  for candidate in [path.to_path_buf(), PathBuf::from(format!("{}-wal", path.display())), PathBuf::from(format!("{}-shm", path.display()))] {
    if !candidate.exists() { continue; }
    let bytes = std::fs::read(&candidate).map_err(|_| "plaintext residue scan failed".to_string())?;
    for config in configs {
      hits += count_subslice(&bytes, config.secret.as_bytes());
    }
  }
  Ok(hits)
}

fn exact_plaintext_file_hits_for_secrets(path: &Path, secrets: &[Zeroizing<String>]) -> Result<usize, String> {
  let mut hits = 0usize;
  for candidate in [path.to_path_buf(), PathBuf::from(format!("{}-wal", path.display())), PathBuf::from(format!("{}-shm", path.display()))] {
    if !candidate.exists() { continue; }
    let bytes = std::fs::read(&candidate).map_err(|_| "plaintext residue scan failed".to_string())?;
    for secret in secrets { hits += count_subslice(&bytes, secret.as_bytes()); }
  }
  Ok(hits)
}

fn count_subslice(haystack: &[u8], needle: &[u8]) -> usize {
  if needle.is_empty() || haystack.len() < needle.len() { return 0; }
  haystack.windows(needle.len()).filter(|window| *window == needle).count()
}

fn restore_verified_backup(database_path: &Path, backup_path: &Path) -> Result<(), String> {
  validate_exact_production_path(database_path)?;
  std::fs::copy(backup_path, database_path).map_err(|_| "automatic backup restoration failed".to_string())?;
  for suffix in ["-wal", "-shm"] {
    let sidecar = PathBuf::from(format!("{}{}", database_path.display(), suffix));
    if sidecar.exists() { std::fs::remove_file(sidecar).map_err(|_| "automatic backup restoration failed".to_string())?; }
  }
  Ok(())
}

#[cfg(windows)]
#[repr(C)]
struct DataBlob { cb_data: u32, pb_data: *mut u8 }

#[cfg(windows)]
#[link(name = "Crypt32")]
extern "system" {
  fn CryptProtectData(
    data_in: *mut DataBlob,
    description: *const u16,
    optional_entropy: *mut DataBlob,
    reserved: *mut std::ffi::c_void,
    prompt: *mut std::ffi::c_void,
    flags: u32,
    data_out: *mut DataBlob,
  ) -> i32;
  fn CryptUnprotectData(
    data_in: *mut DataBlob,
    description: *mut *mut u16,
    optional_entropy: *mut DataBlob,
    reserved: *mut std::ffi::c_void,
    prompt: *mut std::ffi::c_void,
    flags: u32,
    data_out: *mut DataBlob,
  ) -> i32;
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" { fn LocalFree(memory: *mut std::ffi::c_void) -> *mut std::ffi::c_void; }

#[cfg(windows)]
fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
  if plaintext.is_empty() || plaintext.len() > MAX_PLAINTEXT_BYTES { return Err("credential is empty or too large".into()); }
  crypt(true, plaintext)
}

#[cfg(windows)]
fn unprotect(ciphertext: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
  if ciphertext.is_empty() || ciphertext.len() > MAX_CIPHERTEXT_BYTES { return Err("credential decryption failed".into()); }
  crypt(false, ciphertext).map(Zeroizing::new)
}

#[cfg(windows)]
fn crypt(protecting: bool, input: &[u8]) -> Result<Vec<u8>, String> {
  crypt_with_entropy(protecting, input, ENTROPY)
}

#[cfg(windows)]
fn crypt_with_entropy(protecting: bool, input: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
  const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
  let mut input_copy = Zeroizing::new(input.to_vec());
  let mut entropy_copy = entropy.to_vec();
  let mut input_blob = DataBlob { cb_data: input_copy.len() as u32, pb_data: input_copy.as_mut_ptr() };
  let mut entropy_blob = DataBlob { cb_data: entropy_copy.len() as u32, pb_data: entropy_copy.as_mut_ptr() };
  let mut output_blob = DataBlob { cb_data: 0, pb_data: std::ptr::null_mut() };
  let ok = unsafe {
    if protecting {
      CryptProtectData(&mut input_blob, std::ptr::null(), &mut entropy_blob, std::ptr::null_mut(), std::ptr::null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut output_blob)
    } else {
      CryptUnprotectData(&mut input_blob, std::ptr::null_mut(), &mut entropy_blob, std::ptr::null_mut(), std::ptr::null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut output_blob)
    }
  };
  entropy_copy.fill(0);
  if ok == 0 || output_blob.pb_data.is_null() || output_blob.cb_data == 0 {
    return Err(if protecting { "credential encryption failed".into() } else { "credential decryption failed".into() });
  }
  let output = unsafe { std::slice::from_raw_parts(output_blob.pb_data, output_blob.cb_data as usize).to_vec() };
  unsafe { LocalFree(output_blob.pb_data.cast()); }
  Ok(output)
}

#[cfg(not(windows))]
fn protect(_plaintext: &[u8]) -> Result<Vec<u8>, String> { Err("Windows DPAPI is unavailable".into()) }

#[cfg(not(windows))]
fn unprotect(_ciphertext: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> { Err("Windows DPAPI is unavailable".into()) }

#[cfg(all(test, windows))]
mod tests {
  use super::{crypt_with_entropy, protect, unprotect, validate_exact_production_path, EncryptedCredentialStore, ProviderCredentialInput, TEXT_REASONING};
  use sqlx::Connection;

  #[test]
  fn dpapi_current_user_round_trip_is_not_plaintext() {
    let secret = b"fixture-api-key-never-persist";
    let encrypted = protect(secret).unwrap();
    assert_ne!(encrypted, secret);
    assert_eq!(unprotect(&encrypted).unwrap().as_slice(), secret);
  }

  #[test]
  fn dpapi_wrong_application_entropy_fails_closed() {
    let encrypted = protect(b"fixture-api-key-never-persist").unwrap();
    assert!(crypt_with_entropy(false, &encrypted, b"wrong-application-entropy").is_err());
  }

  #[tokio::test]
  async fn encrypted_sql_restart_readback_and_delete() {
    let directory = std::env::temp_dir().join(format!("local-crm-encrypted-credential-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("credential.db");
    sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await.unwrap().close().await.unwrap();
    let first = EncryptedCredentialStore::new(path.clone());
    first.save(ProviderCredentialInput { capability: TEXT_REASONING.into(), provider: "deepseek".into(), endpoint: "https://api.deepseek.com/v1".into(), model: "deepseek-chat".into(), api_key: "fixture-restart-secret".into() }).await.unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes.windows(b"fixture-restart-secret".len()).any(|window| window == b"fixture-restart-secret"));
    let restarted = EncryptedCredentialStore::new(path.clone());
    let loaded = restarted.load_runtime(TEXT_REASONING).await.unwrap();
    assert_eq!(loaded.api_key.as_str(), "fixture-restart-secret");
    restarted.delete(TEXT_REASONING).await.unwrap();
    assert!(!restarted.status(TEXT_REASONING).await.unwrap().configured);
    drop(loaded);
    let _ = std::fs::remove_dir_all(directory);
  }

  #[tokio::test]
  async fn encrypted_sql_delete_removes_ciphertext_row() {
    let path = std::env::temp_dir().join(format!("local-crm-migration-{}.db", uuid::Uuid::new_v4()));
    sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await.unwrap().close().await.unwrap();
    let store = EncryptedCredentialStore::new(path.clone());
    store.save(ProviderCredentialInput { capability: TEXT_REASONING.into(), provider: "deepseek".into(), endpoint: "https://example.invalid/v1".into(), model: "fixture-model".into(), api_key: "fixture-delete-secret".into() }).await.unwrap();
    store.delete(TEXT_REASONING).await.unwrap();
    let mut connection = sqlx::SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(false)).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_provider_credentials WHERE capability = ?").bind(TEXT_REASONING).fetch_one(&mut connection).await.unwrap();
    assert_eq!(count, 0);
  }

  #[test]
  fn migration_rejects_nonproduction_database_path_without_writing() {
    let path = std::env::temp_dir().join(format!("local-crm-migration-{}.db", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"not-production").unwrap();
    assert_eq!(validate_exact_production_path(&path).unwrap_err(), "migration target is not the authorized production database");
    assert_eq!(std::fs::read(path).unwrap(), b"not-production");
  }

  #[tokio::test]
  async fn encrypted_credential_errors_do_not_include_secret_material() {
    let path = std::env::temp_dir().join(format!("local-crm-migration-{}.db", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"not-a-database").unwrap();
    let error = EncryptedCredentialStore::new(path).save(ProviderCredentialInput {
      capability: TEXT_REASONING.into(), provider: "deepseek".into(), endpoint: "https://example.invalid/v1".into(),
      model: "fixture-model".into(), api_key: "fixture-sensitive-material".into(),
    }).await.unwrap_err();
    assert!(!error.contains("fixture-sensitive-material"));
  }

}
