//! Desktop profile data-source boundary.
//!
//! The renderer may name a profile, but it never receives or submits a SQLite
//! path. This module owns the fixed `~/.localcrm/profiles/<name>/crm.sqlite`
//! resolution, selection metadata, and profile-scoped SQL bridge.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use sqlx::sqlite::{SqliteArguments, SqliteConnectOptions, SqliteJournalMode, SqliteRow};
use sqlx::{Column, Connection, Row, Sqlite, SqliteConnection, TypeInfo, ValueRef};
use tauri::{AppHandle, Manager};

use crate::bundled_cli;

const PROFILE_NAME_MAX_LEN: usize = 64;
const PROFILE_DATABASE_FILE_NAME: &str = "crm.sqlite";
const LEGACY_DATABASE_FILE_NAME: &str = "personal-crm.db";
const SELECTION_FILE_NAME: &str = "desktop-data-source.json";

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProfilePaths {
  root_dir: PathBuf,
  profile_dir: PathBuf,
  db_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DesktopDataSourceMode {
  Legacy,
  Profile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDataSourceStatus {
  pub mode: DesktopDataSourceMode,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub profile_name: Option<String>,
}

/// Read-only settings projection. The renderer receives a fixed, Rust-resolved
/// active profile path only for display; it never supplies a database or
/// executable path back to the backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentCliStatus {
  pub mode: DesktopDataSourceMode,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub profile_name: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub profile_database_path: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub installed_cli_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredDataSource {
  mode: String,
  #[serde(default)]
  profile_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSqlExecuteResult {
  pub rows_affected: u64,
}

fn profile_error(message: impl Into<String>) -> String {
  format!("desktop profile data source: {}", message.into())
}

fn is_valid_profile_name(profile_name: &str) -> bool {
  !profile_name.is_empty()
    && profile_name.len() <= PROFILE_NAME_MAX_LEN
    && profile_name
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn validate_profile_name(profile_name: &str) -> Result<&str, String> {
  if !is_valid_profile_name(profile_name) {
    return Err(profile_error(
      "profile names must match ^[A-Za-z0-9_-]{1,64}$.",
    ));
  }
  Ok(profile_name)
}

fn is_strictly_inside(root: &Path, candidate: &Path) -> bool {
  candidate != root && candidate.starts_with(root)
}

fn assert_inside(root: &Path, candidate: &Path, label: &str) -> Result<(), String> {
  if !is_strictly_inside(root, candidate) {
    return Err(profile_error(format!("{label} must remain inside the fixed profile root.")));
  }
  Ok(())
}

fn is_not_found(error: &std::io::Error) -> bool {
  error.kind() == std::io::ErrorKind::NotFound
}

fn ensure_real_directory(path: &Path, label: &str, create_missing: bool) -> Result<(), String> {
  match fs::symlink_metadata(path) {
    Ok(metadata) => {
      if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(profile_error(format!("{label} must be a real directory, not a link or file.")));
      }
    }
    Err(error) if is_not_found(&error) && create_missing => {
      fs::create_dir(path)
        .map_err(|error| profile_error(format!("unable to create {label}: {error}")))?;
      return ensure_real_directory(path, label, false);
    }
    Err(error) if is_not_found(&error) => {
      return Err(profile_error(format!("{label} does not exist.")));
    }
    Err(error) => {
      return Err(profile_error(format!("unable to inspect {label}: {error}")));
    }
  }
  Ok(())
}

fn assert_not_legacy_database_path(path: &Path) -> Result<(), String> {
  let text = path.to_string_lossy();
  let is_legacy_uri = text.eq_ignore_ascii_case("sqlite:personal-crm.db");
  let is_legacy_file = path
    .file_name()
    .map(|file_name| file_name.to_string_lossy().eq_ignore_ascii_case(LEGACY_DATABASE_FILE_NAME))
    .unwrap_or(false);
  if is_legacy_uri || is_legacy_file {
    return Err(profile_error(
      "the production personal-crm.db database is not a valid profile database.",
    ));
  }
  Ok(())
}

fn configured_home_dir() -> Result<PathBuf, String> {
  #[cfg(target_os = "windows")]
  let configured = env::var_os("USERPROFILE");
  #[cfg(not(target_os = "windows"))]
  let configured = env::var_os("HOME");

  let Some(home) = configured else {
    return Err(profile_error("a fixed user profile directory is required."));
  };
  let home = PathBuf::from(home);
  if !home.is_absolute() {
    return Err(profile_error("a fixed absolute user profile directory is required."));
  }
  Ok(home)
}

fn profile_paths_from_home(
  home_dir: &Path,
  profile_name: &str,
  create_missing: bool,
) -> Result<ProfilePaths, String> {
  let profile_name = validate_profile_name(profile_name)?;
  if !home_dir.is_absolute() {
    return Err(profile_error("a fixed absolute user profile directory is required."));
  }
  ensure_real_directory(home_dir, "the configured user profile directory", false)?;
  let home_dir = fs::canonicalize(home_dir)
    .map_err(|error| profile_error(format!("unable to resolve user profile directory: {error}")))?;

  let local_crm_dir = home_dir.join(".localcrm");
  ensure_real_directory(&local_crm_dir, "the LocalCRM profile parent", create_missing)?;
  let root_dir = local_crm_dir.join("profiles");
  ensure_real_directory(&root_dir, "the LocalCRM profile root", create_missing)?;
  let profile_dir = root_dir.join(profile_name);
  ensure_real_directory(&profile_dir, "the requested profile directory", create_missing)?;

  let root_dir = fs::canonicalize(&root_dir)
    .map_err(|error| profile_error(format!("unable to resolve profile root: {error}")))?;
  let profile_dir = fs::canonicalize(&profile_dir)
    .map_err(|error| profile_error(format!("unable to resolve profile directory: {error}")))?;
  assert_inside(&root_dir, &profile_dir, "profile directory")?;

  let db_path = profile_dir.join(PROFILE_DATABASE_FILE_NAME);
  assert_inside(&root_dir, &db_path, "profile database")?;
  assert_inside(&profile_dir, &db_path, "profile database")?;
  assert_not_legacy_database_path(&db_path)?;

  Ok(ProfilePaths {
    root_dir,
    profile_dir,
    db_path,
  })
}

fn verify_profile_database(paths: &ProfilePaths) -> Result<PathBuf, String> {
  let metadata = fs::symlink_metadata(&paths.db_path)
    .map_err(|error| profile_error(format!("profile database unavailable: {error}")))?;
  if metadata.file_type().is_symlink() || !metadata.is_file() {
    return Err(profile_error(
      "the profile database must be a real file, not a link or directory.",
    ));
  }
  let db_path = fs::canonicalize(&paths.db_path)
    .map_err(|error| profile_error(format!("unable to resolve profile database: {error}")))?;
  assert_inside(&paths.root_dir, &db_path, "profile database")?;
  assert_inside(&paths.profile_dir, &db_path, "profile database")?;
  assert_not_legacy_database_path(&db_path)?;
  Ok(db_path)
}

fn selection_config_path(app: &AppHandle) -> Result<PathBuf, String> {
  let config_dir = app
    .path()
    .app_config_dir()
    .map_err(|_| profile_error("application configuration directory unavailable"))?;
  Ok(config_dir.join(SELECTION_FILE_NAME))
}

fn status_from_stored(stored: StoredDataSource) -> Result<DesktopDataSourceStatus, String> {
  match stored.mode.as_str() {
    "LEGACY" if stored.profile_name.is_none() => Ok(DesktopDataSourceStatus {
      mode: DesktopDataSourceMode::Legacy,
      profile_name: None,
    }),
    "PROFILE" => {
      let profile_name = stored
        .profile_name
        .ok_or_else(|| profile_error("PROFILE selection is missing profileName."))?;
      validate_profile_name(&profile_name)?;
      Ok(DesktopDataSourceStatus {
        mode: DesktopDataSourceMode::Profile,
        profile_name: Some(profile_name),
      })
    }
    _ => Err(profile_error("selection metadata is invalid.")),
  }
}

fn read_data_source_status(app: &AppHandle) -> Result<DesktopDataSourceStatus, String> {
  let path = selection_config_path(app)?;
  match fs::symlink_metadata(&path) {
    Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
      return Err(profile_error("selection metadata must be a real file."));
    }
    Ok(_) => {}
    Err(error) if is_not_found(&error) => {
      return Ok(DesktopDataSourceStatus {
        mode: DesktopDataSourceMode::Legacy,
        profile_name: None,
      });
    }
    Err(error) => {
      return Err(profile_error(format!("unable to inspect selection metadata: {error}")));
    }
  }

  let raw = fs::read_to_string(&path)
    .map_err(|error| profile_error(format!("unable to read selection metadata: {error}")))?;
  let stored: StoredDataSource = serde_json::from_str(&raw)
    .map_err(|error| profile_error(format!("selection metadata is invalid: {error}")))?;
  status_from_stored(stored)
}

fn persist_profile_selection(app: &AppHandle, profile_name: &str) -> Result<DesktopDataSourceStatus, String> {
  let profile_name = validate_profile_name(profile_name)?.to_string();
  let path = selection_config_path(app)?;
  let parent = path
    .parent()
    .ok_or_else(|| profile_error("selection metadata parent unavailable."))?;
  fs::create_dir_all(parent)
    .map_err(|error| profile_error(format!("unable to create selection metadata directory: {error}")))?;
  match fs::symlink_metadata(&path) {
    Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
      return Err(profile_error("selection metadata must be a real file."));
    }
    Ok(_) => {}
    Err(error) if is_not_found(&error) => {}
    Err(error) => {
      return Err(profile_error(format!("unable to inspect selection metadata: {error}")));
    }
  }

  let stored = StoredDataSource {
    mode: "PROFILE".to_string(),
    profile_name: Some(profile_name.clone()),
  };
  let serialized = serde_json::to_vec_pretty(&stored)
    .map_err(|error| profile_error(format!("unable to serialize selection metadata: {error}")))?;
  fs::write(&path, serialized)
    .map_err(|error| profile_error(format!("unable to persist selection metadata: {error}")))?;

  Ok(DesktopDataSourceStatus {
    mode: DesktopDataSourceMode::Profile,
    profile_name: Some(profile_name),
  })
}

async fn open_connection(path: &Path, create_if_missing: bool) -> Result<SqliteConnection, String> {
  let options = SqliteConnectOptions::new()
    .filename(path)
    .create_if_missing(create_if_missing)
    .foreign_keys(true)
    .busy_timeout(Duration::from_secs(5))
    .journal_mode(SqliteJournalMode::Wal);
  SqliteConnection::connect_with(&options)
    .await
    .map_err(|error| profile_error(format!("profile database unavailable: {error}")))
}

async fn create_profile_database(profile_name: &str) -> Result<(), String> {
  let home_dir = configured_home_dir()?;
  let paths = profile_paths_from_home(&home_dir, profile_name, true)?;
  let connection = open_connection(&paths.db_path, true).await?;
  drop(connection);
  verify_profile_database(&paths)?;
  Ok(())
}

fn selected_profile_database_path(app: &AppHandle) -> Result<PathBuf, String> {
  let status = read_data_source_status(app)?;
  let profile_name = match status {
    DesktopDataSourceStatus {
      mode: DesktopDataSourceMode::Profile,
      profile_name: Some(profile_name),
    } => profile_name,
    _ => return Err(profile_error("PROFILE data source is not selected.")),
  };
  let home_dir = configured_home_dir()?;
  let paths = profile_paths_from_home(&home_dir, &profile_name, false)?;
  verify_profile_database(&paths)
}

pub fn resolve_active_database_path(app: &AppHandle) -> Result<PathBuf, String> {
  match read_data_source_status(app)? {
    DesktopDataSourceStatus {
      mode: DesktopDataSourceMode::Legacy,
      ..
    } => {
      let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| profile_error("application data directory unavailable"))?;
      Ok(dir.join(LEGACY_DATABASE_FILE_NAME))
    }
    DesktopDataSourceStatus {
      mode: DesktopDataSourceMode::Profile,
      ..
    } => selected_profile_database_path(app),
  }
}

/// Re-resolve after SQLite has opened the file so a path substitution cannot
/// turn an already-selected profile connection into a different data source.
pub fn verify_active_database_path(app: &AppHandle, expected_path: &Path) -> Result<(), String> {
  let resolved_path = resolve_active_database_path(app)?;
  if resolved_path != expected_path {
    return Err(profile_error(
      "the selected database changed while it was being opened.",
    ));
  }
  Ok(())
}

fn bind_json_values<'q>(
  mut query: sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>,
  bindings: &'q [Value],
) -> Result<sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>, String> {
  for binding in bindings {
    query = match binding {
      Value::Null => query.bind(Option::<String>::None),
      Value::Bool(value) => query.bind(i64::from(*value)),
      Value::Number(value) => {
        if let Some(integer) = value.as_i64() {
          query.bind(integer)
        } else if let Some(integer) = value.as_u64().and_then(|integer| i64::try_from(integer).ok()) {
          query.bind(integer)
        } else if let Some(real) = value.as_f64() {
          query.bind(real)
        } else {
          return Err(profile_error("unsupported numeric database binding."));
        }
      }
      Value::String(value) => query.bind(value),
      Value::Array(values) => {
        let mut bytes = Vec::with_capacity(values.len());
        for value in values {
          let Some(byte) = value.as_u64().and_then(|value| u8::try_from(value).ok()) else {
            return Err(profile_error("binary database bindings must contain byte values."));
          };
          bytes.push(byte);
        }
        query.bind(bytes)
      }
      Value::Object(_) => return Err(profile_error("object database bindings are not supported.")),
    };
  }
  Ok(query)
}

fn sqlite_row_to_json(row: SqliteRow) -> Result<Value, String> {
  let mut object = Map::new();
  for (index, column) in row.columns().iter().enumerate() {
    let raw = row
      .try_get_raw(index)
      .map_err(|error| profile_error(format!("unable to read profile query result: {error}")))?;
    let is_null = raw.is_null();
    let type_name = raw.type_info().name().to_ascii_uppercase();
    drop(raw);

    let value = if is_null {
      Value::Null
    } else {
      match type_name.as_str() {
        "INTEGER" => Value::Number(Number::from(
          row.try_get::<i64, _>(index)
            .map_err(|error| profile_error(format!("unable to decode integer result: {error}")))?,
        )),
        "REAL" => {
          let real = row
            .try_get::<f64, _>(index)
            .map_err(|error| profile_error(format!("unable to decode real result: {error}")))?;
          Number::from_f64(real).map(Value::Number).unwrap_or(Value::Null)
        }
        "BLOB" => {
          let bytes = row
            .try_get::<Vec<u8>, _>(index)
            .map_err(|error| profile_error(format!("unable to decode binary result: {error}")))?;
          Value::Array(bytes.into_iter().map(|byte| Value::Number(Number::from(byte))).collect())
        }
        _ => Value::String(
          row.try_get::<String, _>(index)
            .map_err(|error| profile_error(format!("unable to decode text result: {error}")))?,
        ),
      }
    };
    object.insert(column.name().to_string(), value);
  }
  Ok(Value::Object(object))
}

#[tauri::command]
pub fn desktop_data_source_status(app: AppHandle) -> Result<DesktopDataSourceStatus, String> {
  read_data_source_status(&app)
}

/// Resolve all settings-only CLI fields from the installed app. No renderer
/// argument can influence either path, and LEGACY mode never exposes the
/// production personal-crm.db location through this command.
#[tauri::command]
pub fn desktop_agent_cli_status(app: AppHandle) -> Result<DesktopAgentCliStatus, String> {
  let source = read_data_source_status(&app)?;
  let profile_database_path = match &source.mode {
    DesktopDataSourceMode::Profile => Some(
      selected_profile_database_path(&app)?.to_string_lossy().to_string(),
    ),
    DesktopDataSourceMode::Legacy => None,
  };
  // Development runs do not have a packaged sidecar beside the app executable.
  // A real installer must have one; the bundled install script verifies that.
  let installed_cli_path = bundled_cli::resolve_installed_cli_path()
    .ok()
    .map(|path| path.to_string_lossy().to_string());

  Ok(DesktopAgentCliStatus {
    mode: source.mode,
    profile_name: source.profile_name,
    profile_database_path,
    installed_cli_path,
  })
}

#[tauri::command]
pub fn desktop_list_profiles() -> Result<Vec<String>, String> {
  let home_dir = configured_home_dir()?;
  ensure_real_directory(&home_dir, "the configured user profile directory", false)?;
  let home_dir = fs::canonicalize(&home_dir)
    .map_err(|error| profile_error(format!("unable to resolve user profile directory: {error}")))?;
  let local_crm_dir = home_dir.join(".localcrm");
  if let Err(error) = fs::symlink_metadata(&local_crm_dir) {
    if is_not_found(&error) {
      return Ok(Vec::new());
    }
    return Err(profile_error(format!("unable to inspect the LocalCRM profile parent: {error}")));
  }
  ensure_real_directory(&local_crm_dir, "the LocalCRM profile parent", false)?;
  let root_dir = local_crm_dir.join("profiles");
  if let Err(error) = fs::symlink_metadata(&root_dir) {
    if is_not_found(&error) {
      return Ok(Vec::new());
    }
    return Err(profile_error(format!("unable to inspect the LocalCRM profile root: {error}")));
  };
  ensure_real_directory(&root_dir, "the LocalCRM profile root", false)?;
  let entries = fs::read_dir(&root_dir)
    .map_err(|error| profile_error(format!("unable to list profile root: {error}")))?;

  let root_dir = fs::canonicalize(&root_dir)
    .map_err(|error| profile_error(format!("unable to resolve profile root: {error}")))?;
  let mut profiles = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|error| profile_error(format!("unable to inspect profile entry: {error}")))?;
    let file_name = entry.file_name();
    let Some(profile_name) = file_name.to_str() else {
      continue;
    };
    if !is_valid_profile_name(profile_name) {
      continue;
    }
    let path = entry.path();
    let metadata = fs::symlink_metadata(&path)
      .map_err(|error| profile_error(format!("unable to inspect profile entry: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
      continue;
    }
    let profile_dir = fs::canonicalize(&path)
      .map_err(|error| profile_error(format!("unable to resolve profile entry: {error}")))?;
    if !is_strictly_inside(&root_dir, &profile_dir) {
      continue;
    }
    let paths = ProfilePaths {
      root_dir: root_dir.clone(),
      profile_dir,
      db_path: path.join(PROFILE_DATABASE_FILE_NAME),
    };
    if verify_profile_database(&paths).is_ok() {
      profiles.push(profile_name.to_string());
    }
  }
  profiles.sort();
  Ok(profiles)
}

#[tauri::command]
pub async fn desktop_create_profile(
  app: AppHandle,
  profile_name: String,
) -> Result<DesktopDataSourceStatus, String> {
  create_profile_database(&profile_name).await?;
  persist_profile_selection(&app, &profile_name)
}

#[tauri::command]
pub fn desktop_select_profile(
  app: AppHandle,
  profile_name: String,
) -> Result<DesktopDataSourceStatus, String> {
  let profile_name = validate_profile_name(&profile_name)?;
  let home_dir = configured_home_dir()?;
  let paths = profile_paths_from_home(&home_dir, profile_name, false)?;
  verify_profile_database(&paths)?;
  persist_profile_selection(&app, profile_name)
}

#[tauri::command]
pub async fn desktop_profile_database_execute(
  app: AppHandle,
  sql: String,
  bindings: Vec<Value>,
) -> Result<ProfileSqlExecuteResult, String> {
  let path = selected_profile_database_path(&app)?;
  let mut connection = open_connection(&path, false).await?;
  verify_active_database_path(&app, &path)?;
  let result = bind_json_values(sqlx::query(&sql), &bindings)?
    .execute(&mut connection)
    .await
    .map_err(|error| profile_error(format!("profile database execute failed: {error}")))?;
  Ok(ProfileSqlExecuteResult {
    rows_affected: result.rows_affected(),
  })
}

#[tauri::command]
pub async fn desktop_profile_database_select(
  app: AppHandle,
  sql: String,
  bindings: Vec<Value>,
) -> Result<Vec<Value>, String> {
  let path = selected_profile_database_path(&app)?;
  let mut connection = open_connection(&path, false).await?;
  verify_active_database_path(&app, &path)?;
  let rows = bind_json_values(sqlx::query(&sql), &bindings)?
    .fetch_all(&mut connection)
    .await
    .map_err(|error| profile_error(format!("profile database select failed: {error}")))?;
  rows.into_iter().map(sqlite_row_to_json).collect()
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{SystemTime, UNIX_EPOCH};

  struct TestDirectory(PathBuf);

  impl TestDirectory {
    fn new(label: &str) -> Self {
      let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
      let path = env::temp_dir().join(format!("localcrm-desktop-profile-{label}-{}-{nonce}", std::process::id()));
      fs::create_dir_all(&path).expect("create temporary profile home");
      Self(path)
    }
  }

  impl Drop for TestDirectory {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn rejects_invalid_profile_names_before_any_path_is_opened() {
    let oversized = "a".repeat(65);
    for name in ["", " ", ".", "..", "../demo", "demo/other", "demo\\other", "sqlite:personal-crm.db", oversized.as_str()] {
      assert!(validate_profile_name(name).is_err(), "expected {name:?} to be rejected");
    }
    for name in ["demo", "team_1", "release-2026"] {
      assert_eq!(validate_profile_name(name), Ok(name));
    }
  }

  #[test]
  fn fixed_profile_path_stays_inside_the_profile_root() {
    let home = TestDirectory::new("fixed-root");
    let paths = profile_paths_from_home(&home.0, "demo", true).expect("prepare profile paths");
    assert!(paths.profile_dir.starts_with(&paths.root_dir));
    assert!(paths.db_path.starts_with(&paths.profile_dir));
    assert_eq!(paths.db_path.file_name().and_then(|name| name.to_str()), Some(PROFILE_DATABASE_FILE_NAME));
  }

  #[test]
  fn rejects_a_profile_directory_symlink() {
    let home = TestDirectory::new("symlink");
    let root = home.0.join(".localcrm").join("profiles");
    let outside = home.0.join("outside");
    fs::create_dir_all(&root).expect("create profile root");
    fs::create_dir_all(&outside).expect("create outside directory");
    let linked_profile = root.join("demo");

    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &linked_profile).expect("create symlink");
    #[cfg(windows)]
    if let Err(error) = std::os::windows::fs::symlink_dir(&outside, &linked_profile) {
      if error.kind() == std::io::ErrorKind::PermissionDenied {
        // Some locked-down Windows runners deny link creation. The production
        // check remains covered on platforms where links are constructible.
        return;
      }
      panic!("create symlink: {error}");
    }

    let error = profile_paths_from_home(&home.0, "demo", false).expect_err("symlink must fail closed");
    assert!(error.contains("real directory"));
  }

  #[test]
  fn rejects_legacy_production_database_paths() {
    assert!(assert_not_legacy_database_path(Path::new("sqlite:personal-crm.db")).is_err());
    assert!(assert_not_legacy_database_path(Path::new("/app-data/com.localcrm.desktop/personal-crm.db")).is_err());
    assert!(assert_not_legacy_database_path(Path::new("/profiles/demo/crm.sqlite")).is_ok());
  }
}
