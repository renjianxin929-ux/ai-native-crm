fn main() {
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
