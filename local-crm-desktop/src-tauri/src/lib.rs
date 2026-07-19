mod credential_migration;
mod secure_credentials;
mod trusted_host;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .manage(trusted_host::TrustedHostState::default())
    .invoke_handler(tauri::generate_handler![
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
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
        app_handle.state::<trusted_host::TrustedHostState>().abort_all_for_shutdown();
      }
    });
}
