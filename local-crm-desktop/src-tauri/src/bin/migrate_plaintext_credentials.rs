use std::path::PathBuf;

#[tokio::main(flavor = "current_thread")]
async fn main() {
  let mut args = std::env::args_os().skip(1);
  let database_path = args.next().map(PathBuf::from);
  let backup_path = args.next().map(PathBuf::from);
  if database_path.is_none() || backup_path.is_none() || args.next().is_some() {
    eprintln!("usage: migrate_plaintext_credentials <authorized-db-path> <verified-backup-path>");
    std::process::exit(2);
  }
  match app_lib::encrypted_credentials::migrate_plaintext_settings_database(
    database_path.as_deref().unwrap(),
    backup_path.as_deref().unwrap(),
  ).await {
    Ok(evidence) => println!("{}", serde_json::to_string(&evidence).expect("evidence serialization must succeed")),
    Err(_) => {
      eprintln!("secure credential migration failed; no secret details are available");
      std::process::exit(1);
    }
  }
}
