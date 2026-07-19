use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::encrypted_credentials::{EncryptedCredentialStore, ProviderCredentialInput, TEXT_REASONING};
use crate::secure_credentials::{CredentialStore, WindowsCredentialStore, VISION_ANALYSIS};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCredentialMigrationStatus {
  pub detected: bool,
  pub migration_version: Option<String>,
  pub state: String,
  pub checked_at: String,
}

#[tauri::command]
pub async fn inspect_legacy_provider_credentials(_app: AppHandle) -> Result<LegacyCredentialMigrationStatus, String> {
  let store = WindowsCredentialStore;
  let detected = store.read(TEXT_REASONING).map_err(|_| "legacy credential inspection failed".to_string())?.is_some()
    || store.read(VISION_ANALYSIS).map_err(|_| "legacy credential inspection failed".to_string())?.is_some();
  Ok(status(detected, None, if detected { "detected" } else { "not_detected" }))
}

#[tauri::command]
pub async fn migrate_legacy_provider_credentials(app: AppHandle) -> Result<LegacyCredentialMigrationStatus, String> {
  let windows = WindowsCredentialStore;
  let text = windows.read(TEXT_REASONING).map_err(|_| "legacy credential migration read failed".to_string())?.map(Zeroizing::new);
  let vision = windows.read(VISION_ANALYSIS).map_err(|_| "legacy credential migration read failed".to_string())?.map(Zeroizing::new);
  if text.is_none() && vision.is_none() { return Ok(status(false, None, "not_detected")); }

  let database_path = app.path().app_data_dir().map_err(|_| "app data directory unavailable".to_string())?.join("personal-crm.db");
  let encrypted = EncryptedCredentialStore::new(database_path);
  migrate_values_to_encrypted_store(&encrypted, text, vision).await?;
  Ok(status(true, Some("v2".into()), "migrated_legacy_retained"))
}

async fn migrate_values_to_encrypted_store(
  encrypted: &EncryptedCredentialStore,
  text: Option<Zeroizing<String>>,
  vision: Option<Zeroizing<String>>,
) -> Result<(), String> {
  let mut newly_written = Vec::<String>::new();

  let result = async {
    if let Some(secret) = text {
      if !encrypted.status(TEXT_REASONING).await?.configured {
        encrypted.save(ProviderCredentialInput {
          capability: TEXT_REASONING.into(), provider: "deepseek".into(), endpoint: "https://api.deepseek.com/v1".into(),
          model: "deepseek-chat".into(), api_key: secret.to_string(),
        }).await?;
        newly_written.push(TEXT_REASONING.into());
      }
    }
    if let Some(secret) = vision {
      if !encrypted.status(VISION_ANALYSIS).await?.configured {
        encrypted.save(ProviderCredentialInput {
          capability: VISION_ANALYSIS.into(), provider: "qwen".into(), endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
          model: "qwen-vl-max".into(), api_key: secret.to_string(),
        }).await?;
        newly_written.push(VISION_ANALYSIS.into());
      }
    }
    Ok::<(), String>(())
  }.await;

  if result.is_err() {
    let mut recovered = true;
    for capability in newly_written.iter().rev() {
      let verified_removed = match encrypted.delete(capability).await {
        Ok(_) => matches!(encrypted.status(capability).await, Ok(status) if !status.configured),
        Err(_) => false,
      };
      if !verified_removed { recovered = false; }
    }
    return Err(if recovered {
      "legacy credential migration failed; original Windows credentials retained"
    } else {
      "legacy credential migration recovery required; original Windows credentials retained"
    }.into());
  }
  Ok(())
}

#[tauri::command]
pub fn delete_legacy_provider_credentials() -> Result<LegacyCredentialMigrationStatus, String> {
  let store = WindowsCredentialStore;
  store.delete(TEXT_REASONING).map_err(|_| "legacy credential deletion failed".to_string())?;
  store.delete(VISION_ANALYSIS).map_err(|_| "legacy credential deletion failed".to_string())?;
  Ok(status(false, Some("v2".into()), "legacy_deleted_by_user"))
}

fn status(detected: bool, migration_version: Option<String>, state: &str) -> LegacyCredentialMigrationStatus {
  LegacyCredentialMigrationStatus { detected, migration_version, state: state.into(), checked_at: Utc::now().to_rfc3339() }
}

#[cfg(all(test, windows))]
mod tests {
  use super::migrate_values_to_encrypted_store;
  use crate::encrypted_credentials::{EncryptedCredentialStore, ProviderCredentialInput, TEXT_REASONING};
  use crate::secure_credentials::VISION_ANALYSIS;
  use sqlx::sqlite::SqliteConnectOptions;
  use sqlx::{Connection, SqliteConnection};
  use zeroize::Zeroizing;

  async fn store() -> (EncryptedCredentialStore, SqliteConnection) {
    let path = std::env::temp_dir().join(format!("local-crm-migration-{}.db", uuid::Uuid::new_v4()));
    let connection = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await.unwrap();
    (EncryptedCredentialStore::new(path), connection)
  }

  fn values() -> (Option<Zeroizing<String>>, Option<Zeroizing<String>>) {
    (Some(Zeroizing::new("fixture-legacy-text".into())), Some(Zeroizing::new("fixture-legacy-vision".into())))
  }

  #[tokio::test]
  async fn legacy_migration_compensation_removes_partial_encrypted_writes() {
    let (store, mut connection) = store().await;
    store.ensure_schema().await.unwrap();
    sqlx::query("CREATE TRIGGER fail_vision BEFORE INSERT ON ai_provider_credentials WHEN NEW.capability = 'VISION_REASONING' BEGIN SELECT RAISE(ABORT, 'injected'); END")
      .execute(&mut connection).await.unwrap();
    let (text, vision) = values();
    let error = migrate_values_to_encrypted_store(&store, text, vision).await.unwrap_err();
    assert_eq!(error, "legacy credential migration failed; original Windows credentials retained");
    assert!(!store.status(TEXT_REASONING).await.unwrap().configured);
    assert!(!store.status(VISION_ANALYSIS).await.unwrap().configured);
  }

  #[tokio::test]
  async fn legacy_migration_is_idempotent_and_does_not_overwrite_existing_rows() {
    let (store, _connection) = store().await;
    store.save(ProviderCredentialInput { capability: TEXT_REASONING.into(), provider: "deepseek".into(), endpoint: "https://example.invalid/v1".into(), model: "existing-text".into(), api_key: "fixture-existing-text".into() }).await.unwrap();
    store.save(ProviderCredentialInput { capability: VISION_ANALYSIS.into(), provider: "qwen".into(), endpoint: "https://example.invalid/v1".into(), model: "existing-vision".into(), api_key: "fixture-existing-vision".into() }).await.unwrap();
    let (text, vision) = values();
    migrate_values_to_encrypted_store(&store, text, vision).await.unwrap();
    assert_eq!(store.load_runtime(TEXT_REASONING).await.unwrap().model, "existing-text");
    assert_eq!(store.load_runtime(VISION_ANALYSIS).await.unwrap().model, "existing-vision");
  }

  #[tokio::test]
  async fn legacy_migration_success_writes_both_capabilities_without_deleting_source() {
    let (store, _connection) = store().await;
    let (text, vision) = values();
    migrate_values_to_encrypted_store(&store, text, vision).await.unwrap();
    assert!(store.status(TEXT_REASONING).await.unwrap().configured);
    assert!(store.status(VISION_ANALYSIS).await.unwrap().configured);
  }

  #[tokio::test]
  async fn legacy_migration_failure_is_secret_redacted_and_retains_source_contract() {
    let (store, mut connection) = store().await;
    store.ensure_schema().await.unwrap();
    sqlx::query("CREATE TRIGGER fail_all BEFORE INSERT ON ai_provider_credentials BEGIN SELECT RAISE(ABORT, 'injected'); END")
      .execute(&mut connection).await.unwrap();
    let (text, vision) = values();
    let error = migrate_values_to_encrypted_store(&store, text, vision).await.unwrap_err();
    assert!(!error.contains("fixture-legacy"));
    assert!(error.contains("original Windows credentials retained"));
  }
}
