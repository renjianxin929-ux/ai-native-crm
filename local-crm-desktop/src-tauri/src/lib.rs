mod credential_migration;
mod desktop_profile;
pub mod encrypted_credentials;
mod battle_card_authoritative;
mod battle_card_transactions;
mod crm_lifecycle;
mod secure_credentials;
mod trusted_host;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      battle_card_transactions::confirm_battle_card_import_atomic_v1,
      battle_card_transactions::confirm_battle_card_stage_card_atomic_v1,
      desktop_profile::desktop_data_source_status,
      desktop_profile::desktop_list_profiles,
      desktop_profile::desktop_create_profile,
      desktop_profile::desktop_select_profile,
      desktop_profile::desktop_profile_database_execute,
      desktop_profile::desktop_profile_database_select,
      crm_lifecycle::restore_full_backup_atomic,
      crm_lifecycle::delete_customer_atomic,
      crm_lifecycle::persist_occurred_follow_up_atomic,
      trusted_host::authorize_model_capability,
      trusted_host::execute_model_capability,
      trusted_host::probe_trusted_host_provider_health,
      trusted_host::list_trusted_host_provider_status,
      trusted_host::configure_trusted_host_credential,
      trusted_host::delete_trusted_host_credential,
      trusted_host::test_trusted_host_provider_connection,
      trusted_host::cancel_trusted_host_request,
      credential_migration::inspect_legacy_provider_credentials,
      credential_migration::migrate_legacy_provider_credentials,
      credential_migration::delete_legacy_provider_credentials,
    ])
    .setup(|app| {
      let database_path = app.path().app_data_dir()?.join("personal-crm.db");
      app.manage(trusted_host::TrustedHostState::new(
        encrypted_credentials::EncryptedCredentialStore::new(database_path),
      ));
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    });
  // Embedded W3C WebDriver server — e2e builds only, never in production.
  // Enables real-GUI E2E automation on macOS (WKWebView has no external driver).
  #[cfg(feature = "e2e")]
  let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
  builder
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
        app_handle.state::<trusted_host::TrustedHostState>().abort_all_for_shutdown();
      }
    });
}
