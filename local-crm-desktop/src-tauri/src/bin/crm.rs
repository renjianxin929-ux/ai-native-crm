#![cfg_attr(target_os = "windows", windows_subsystem = "console")]

//! Native bundled-CLI entry point.
//!
//! Tauri packages this file as the `crm` external binary. It deliberately
//! resolves Node, JavaScript, and the native SQLite addon from its own
//! installation, never from PATH or a source checkout.

#[path = "../bundled_runtime_layout.rs"]
mod bundled_runtime_layout;

use bundled_runtime_layout::resolve_bundled_runtime_dir_from_sidecar;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};

fn sidecar_error(message: impl Into<String>) -> String {
  format!("bundled CRM CLI: {}", message.into())
}

#[cfg(target_os = "windows")]
fn child_process_path(path: &Path) -> PathBuf {
  let text = path.to_string_lossy();
  if let Some(unc_path) = text.strip_prefix(r"\\?\UNC\") {
    return PathBuf::from(format!(r"\\{unc_path}"));
  }
  PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(text.as_ref()))
}

#[cfg(not(target_os = "windows"))]
fn child_process_path(path: &Path) -> PathBuf {
  path.to_path_buf()
}

fn runtime_file(runtime_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
  let candidate = runtime_dir.join(file_name);
  let metadata = fs::symlink_metadata(&candidate)
    .map_err(|error| sidecar_error(format!("required runtime file is unavailable: {error}")))?;
  if metadata.file_type().is_symlink() || !metadata.is_file() {
    return Err(sidecar_error("required runtime file must be a real file"));
  }
  let resolved = fs::canonicalize(candidate)
    .map_err(|error| sidecar_error(format!("required runtime file could not be resolved: {error}")))?;
  if !resolved.starts_with(runtime_dir) {
    return Err(sidecar_error("required runtime file escaped the installation runtime directory"));
  }
  Ok(resolved)
}

fn run() -> Result<i32, String> {
  let sidecar_path = env::current_exe()
    .map_err(|error| sidecar_error(format!("installed executable path is unavailable: {error}")))?;
  let runtime_dir = resolve_bundled_runtime_dir_from_sidecar(&sidecar_path)?;

  #[cfg(target_os = "windows")]
  let node_file_name = "node.exe";
  #[cfg(not(target_os = "windows"))]
  let node_file_name = "node";

  let node_path = child_process_path(&runtime_file(&runtime_dir, node_file_name)?);
  let entry_path = child_process_path(&runtime_file(&runtime_dir, "main.js")?);
  let child_runtime_dir = child_process_path(&runtime_dir);
  let status = Command::new(node_path)
    .stdin(Stdio::inherit())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit())
    .arg(entry_path)
    .args(env::args_os().skip(1))
    .current_dir(&child_runtime_dir)
    .env("CRM_BUNDLED_CLI_RUNTIME_DIR", &child_runtime_dir)
    .env_remove("NODE_OPTIONS")
    .env_remove("NODE_PATH")
    .status()
    .map_err(|error| sidecar_error(format!("bundled Node runtime could not start: {error}")))?;

  Ok(status.code().unwrap_or(1))
}

fn main() {
  match run() {
    Ok(code) => process::exit(code),
    Err(error) => {
      eprintln!("{error}");
      process::exit(1);
    }
  }
}

#[cfg(test)]
mod tests {
  #[cfg(target_os = "windows")]
  use super::child_process_path;
  #[cfg(target_os = "windows")]
  use std::path::{Path, PathBuf};

  #[cfg(target_os = "windows")]
  #[test]
  fn child_process_path_removes_windows_extended_length_prefixes() {
    assert_eq!(
      child_process_path(Path::new(r"\\?\C:\Program Files\local-crm\crm.exe")),
      PathBuf::from(r"C:\Program Files\local-crm\crm.exe"),
    );
    assert_eq!(
      child_process_path(Path::new(r"\\?\UNC\server\share\crm.exe")),
      PathBuf::from(r"\\server\share\crm.exe"),
    );
  }
}
