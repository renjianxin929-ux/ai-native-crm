//! Filesystem layout shared by the desktop sidecar and its installation mock.

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BundledRuntimePlatform {
  Windows,
  Macos,
  Other,
}

fn bundled_runtime_error(message: impl Into<String>) -> String {
  format!("bundled CRM CLI: {}", message.into())
}

fn runtime_platform_for_current_build() -> BundledRuntimePlatform {
  #[cfg(target_os = "windows")]
  {
    return BundledRuntimePlatform::Windows;
  }
  #[cfg(target_os = "macos")]
  {
    return BundledRuntimePlatform::Macos;
  }
  #[allow(unreachable_code)]
  BundledRuntimePlatform::Other
}

pub(crate) fn resolve_bundled_runtime_dir_from_sidecar_for_platform(
  sidecar_path: &Path,
  platform: BundledRuntimePlatform,
) -> Result<PathBuf, String> {
  if !sidecar_path.is_absolute() {
    return Err(bundled_runtime_error("installed executable path must be absolute"));
  }
  let sidecar_path = fs::canonicalize(sidecar_path)
    .map_err(|error| bundled_runtime_error(format!("installed executable path could not be resolved: {error}")))?;
  let install_bin_dir = sidecar_path
    .parent()
    .ok_or_else(|| bundled_runtime_error("installed executable directory is unavailable"))?;
  let runtime_dir = match platform {
    // Tauri 2 resolves Windows resources from the executable directory, and
    // the configured map target is exactly `crm-runtime/`.
    BundledRuntimePlatform::Windows => install_bin_dir.join("crm-runtime"),
    BundledRuntimePlatform::Macos => install_bin_dir
      .parent()
      .ok_or_else(|| bundled_runtime_error("macOS app Contents directory is unavailable"))?
      .join("Resources")
      .join("crm-runtime"),
    // Linux is not a desktop bundle target for this release surface. Retain
    // the existing local verifier layout there so its host-native probe keeps
    // working without inventing a Windows installation convention.
    BundledRuntimePlatform::Other => install_bin_dir.join("resources").join("crm-runtime"),
  };

  let metadata = fs::symlink_metadata(&runtime_dir)
    .map_err(|error| bundled_runtime_error(format!("runtime directory is unavailable: {error}")))?;
  if metadata.file_type().is_symlink() || !metadata.is_dir() {
    return Err(bundled_runtime_error("runtime directory must be a real directory"));
  }
  fs::canonicalize(runtime_dir)
    .map_err(|error| bundled_runtime_error(format!("runtime directory could not be resolved: {error}")))
}

/// Resolves the bundled CLI runtime from the sidecar's installed path.
///
/// Tauri 2 places mapped Windows resources beside the installed executable,
/// while macOS places them in `Contents/Resources`.
pub(crate) fn resolve_bundled_runtime_dir_from_sidecar(sidecar_path: &Path) -> Result<PathBuf, String> {
  resolve_bundled_runtime_dir_from_sidecar_for_platform(sidecar_path, runtime_platform_for_current_build())
}
