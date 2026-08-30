fn main() {
  // The native `crm` sidecar is compiled by the declared before-build script
  // before its target-suffixed externalBin file exists. It has no dependency
  // on generated Tauri context, so skip Tauri codegen only for that launcher
  // compilation. The subsequent Tauri application build reruns this script
  // without the flag and then embeds the freshly generated sidecar.
  println!("cargo:rerun-if-env-changed=CRM_BUNDLED_CLI_LAUNCHER_BUILD");
  let building_bundled_cli_launcher = std::env::var_os("CRM_BUNDLED_CLI_LAUNCHER_BUILD").as_deref()
    == Some(std::ffi::OsStr::new("1"));
  if building_bundled_cli_launcher {
    return;
  }
  let mut attrs = tauri_build::Attributes::new();
  // Capability ACL isolation: production builds must never reference the
  // e2e-only wdio-webdriver permission (the plugin crate is optional and only
  // compiled with `--features e2e`). The default `./capabilities/**/*` pattern
  // would pull e2e-webdriver.json into production and fail ACL validation.
  #[cfg(feature = "e2e")]
  {
    attrs = attrs.capabilities_path_pattern("capabilities/*.json");
  }
  #[cfg(not(feature = "e2e"))]
  {
    attrs = attrs.capabilities_path_pattern("capabilities/default.json");
  }
  tauri_build::try_build(attrs).expect("tauri-build failed");
}
