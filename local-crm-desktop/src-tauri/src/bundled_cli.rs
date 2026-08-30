//! Read-only resolution of the installed bundled CRM CLI sidecar.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BundledCliPlatform {
  Windows,
  Macos,
}

fn bundled_cli_error(message: impl Into<String>) -> String {
  format!("bundled CRM CLI: {}", message.into())
}

fn platform_for_current_build() -> Result<BundledCliPlatform, String> {
  #[cfg(target_os = "windows")]
  {
    return Ok(BundledCliPlatform::Windows);
  }
  #[cfg(target_os = "macos")]
  {
    return Ok(BundledCliPlatform::Macos);
  }
  #[allow(unreachable_code)]
  Err(bundled_cli_error("this desktop bundle platform has no CRM sidecar layout"))
}

fn cli_file_name(platform: BundledCliPlatform) -> &'static str {
  match platform {
    BundledCliPlatform::Windows => "crm.exe",
    BundledCliPlatform::Macos => "crm",
  }
}

fn resolve_installed_cli_path_for_platform(
  app_executable_path: &Path,
  platform: BundledCliPlatform,
) -> Result<PathBuf, String> {
  if !app_executable_path.is_absolute() {
    return Err(bundled_cli_error("desktop executable path must be absolute"));
  }
  let app_executable_path = fs::canonicalize(app_executable_path)
    .map_err(|error| bundled_cli_error(format!("desktop executable path could not be resolved: {error}")))?;
  let install_bin_dir = app_executable_path
    .parent()
    .ok_or_else(|| bundled_cli_error("desktop executable directory is unavailable"))?;
  let candidate = install_bin_dir.join(cli_file_name(platform));
  let metadata = fs::symlink_metadata(&candidate)
    .map_err(|error| bundled_cli_error(format!("installed sidecar is unavailable: {error}")))?;
  if metadata.file_type().is_symlink() || !metadata.is_file() {
    return Err(bundled_cli_error("installed sidecar must be a real file"));
  }
  let resolved = fs::canonicalize(candidate)
    .map_err(|error| bundled_cli_error(format!("installed sidecar could not be resolved: {error}")))?;
  if !resolved.starts_with(install_bin_dir) {
    return Err(bundled_cli_error("installed sidecar escaped the application installation directory"));
  }
  Ok(resolved)
}

/// The Tauri app and the external binary share the installation's executable
/// directory: `crm.exe` on Windows and `crm` inside `Contents/MacOS` on macOS.
pub fn resolve_installed_cli_path() -> Result<PathBuf, String> {
  let app_executable_path = env::current_exe()
    .map_err(|error| bundled_cli_error(format!("desktop executable path is unavailable: {error}")))?;
  resolve_installed_cli_path_for_platform(&app_executable_path, platform_for_current_build()?)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs::File;
  use std::time::{SystemTime, UNIX_EPOCH};

  struct TestDirectory(PathBuf);

  impl TestDirectory {
    fn new(label: &str) -> Self {
      let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
      let path = env::temp_dir().join(format!("localcrm-bundled-cli-{label}-{}-{nonce}", std::process::id()));
      fs::create_dir_all(&path).expect("create temporary install directory");
      Self(path)
    }
  }

  impl Drop for TestDirectory {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn touch(path: &Path) {
    let parent = path.parent().expect("temporary file parent");
    fs::create_dir_all(parent).expect("create temporary file parent");
    File::create(path).expect("create temporary executable");
  }

  #[test]
  fn resolves_a_windows_sidecar_from_a_mock_install_directory() {
    let install = TestDirectory::new("windows");
    let app = install.0.join("local-crm.exe");
    let cli = install.0.join("crm.exe");
    touch(&app);
    touch(&cli);

    assert_eq!(
      resolve_installed_cli_path_for_platform(&app, BundledCliPlatform::Windows).expect("resolve Windows sidecar"),
      fs::canonicalize(cli).expect("canonical Windows sidecar"),
    );
  }

  #[test]
  fn resolves_a_macos_sidecar_from_a_mock_app_bundle() {
    let install = TestDirectory::new("macos");
    let contents = install.0.join("Local CRM.app").join("Contents");
    let app = contents.join("MacOS").join("local-crm");
    let cli = contents.join("MacOS").join("crm");
    touch(&app);
    touch(&cli);

    assert_eq!(
      resolve_installed_cli_path_for_platform(&app, BundledCliPlatform::Macos).expect("resolve macOS sidecar"),
      fs::canonicalize(cli).expect("canonical macOS sidecar"),
    );
  }

  #[test]
  fn refuses_missing_or_non_absolute_sidecar_locations() {
    let install = TestDirectory::new("missing");
    let app = install.0.join("local-crm.exe");
    touch(&app);

    assert!(resolve_installed_cli_path_for_platform(&app, BundledCliPlatform::Windows).is_err());
    assert!(resolve_installed_cli_path_for_platform(Path::new("local-crm.exe"), BundledCliPlatform::Windows).is_err());
  }
}
