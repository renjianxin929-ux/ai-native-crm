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
use std::process::{self, Command};

fn sidecar_error(message: impl Into<String>) -> String {
  format!("bundled CRM CLI: {}", message.into())
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

  let node_path = runtime_file(&runtime_dir, node_file_name)?;
  let entry_path = runtime_file(&runtime_dir, "main.js")?;
  let status = Command::new(node_path)
    .arg(entry_path)
    .args(env::args_os().skip(1))
    .current_dir(&runtime_dir)
    .env("CRM_BUNDLED_CLI_RUNTIME_DIR", &runtime_dir)
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
