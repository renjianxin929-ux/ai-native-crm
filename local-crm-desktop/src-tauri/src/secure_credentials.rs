use std::ffi::c_void;
use zeroize::{Zeroize, Zeroizing};

pub const TEXT_REASONING: &str = "TEXT_REASONING";
pub const VISION_ANALYSIS: &str = "VISION_ANALYSIS";
pub const SEMANTIC_INTENT_ROUTING: &str = "SEMANTIC_INTENT_ROUTING";
const TEXT_TARGET: &str = "com.localcrm.production-ai.deepseek";
const VISION_TARGET: &str = "com.localcrm.production-ai.qwen-vision";

pub trait CredentialStore: Send + Sync {
  fn read(&self, capability: &str) -> Result<Option<String>, String>;
  fn write(&self, capability: &str, secret: &str) -> Result<(), String>;
  fn delete(&self, capability: &str) -> Result<(), String>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsCredentialStore;

fn target_for(capability: &str) -> Result<&'static str, String> {
  match capability {
    TEXT_REASONING | SEMANTIC_INTENT_ROUTING => Ok(TEXT_TARGET),
    VISION_ANALYSIS => Ok(VISION_TARGET),
    _ => Err("unsupported credential capability".into()),
  }
}

impl CredentialStore for WindowsCredentialStore {
  fn read(&self, capability: &str) -> Result<Option<String>, String> {
    read_target(target_for(capability)?)
  }

  fn write(&self, capability: &str, secret: &str) -> Result<(), String> {
    write_target(target_for(capability)?, secret)
  }

  fn delete(&self, capability: &str) -> Result<(), String> {
    delete_target(target_for(capability)?)
  }
}

pub fn prompt_and_store(capability: &str) -> Result<(), String> {
  let target = target_for(capability)?;
  let secret = Zeroizing::new(prompt_for_secret(target, capability)?);
  update_credential_with_compensation(&WindowsCredentialStore, capability, &secret)
}

/** Update is compensating: verification failure restores and verifies the prior credential. */
pub(crate) fn update_credential_with_compensation(
  store: &dyn CredentialStore,
  capability: &str,
  secret: &str,
) -> Result<(), String> {
  let previous = store.read(capability)?.map(Zeroizing::new);
  let staged = Zeroizing::new(secret.to_string());
  store.write(capability, &staged).map_err(|_| "secure credential update failed".to_string())?;
  let verified = store.read(capability).ok().flatten().map(Zeroizing::new);
  if verified.as_ref().map(|value| value.as_str()) == Some(staged.as_str()) { return Ok(()); }

  match previous.as_ref() {
    Some(old) => store.write(capability, old).map_err(|_| "credential recovery required".to_string())?,
    None => store.delete(capability).map_err(|_| "credential recovery required".to_string())?,
  }
  let restored = store.read(capability).map_err(|_| "credential recovery required".to_string())?.map(Zeroizing::new);
  if restored.as_ref().map(|value| value.as_str()) != previous.as_ref().map(|value| value.as_str()) {
    return Err("credential recovery required".into());
  }
  Err("credential verification failed; previous credential restored".into())
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
  value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
#[repr(C)]
struct FileTime {
  low: u32,
  high: u32,
}

#[cfg(windows)]
#[repr(C)]
struct CredentialW {
  flags: u32,
  credential_type: u32,
  target_name: *mut u16,
  comment: *mut u16,
  last_written: FileTime,
  credential_blob_size: u32,
  credential_blob: *mut u8,
  persist: u32,
  attribute_count: u32,
  attributes: *mut c_void,
  target_alias: *mut u16,
  user_name: *mut u16,
}

#[cfg(windows)]
#[repr(C)]
struct CredUiInfoW {
  cb_size: u32,
  hwnd_parent: *mut c_void,
  message_text: *const u16,
  caption_text: *const u16,
  banner: *mut c_void,
}

#[cfg(windows)]
#[link(name = "Advapi32")]
extern "system" {
  fn CredReadW(target: *const u16, credential_type: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
  fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
  fn CredDeleteW(target: *const u16, credential_type: u32, flags: u32) -> i32;
  fn CredFree(buffer: *mut c_void);
}

#[cfg(windows)]
#[link(name = "Credui")]
extern "system" {
  fn CredUIPromptForCredentialsW(
    ui_info: *const CredUiInfoW,
    target_name: *const u16,
    reserved: *mut c_void,
    auth_error: u32,
    user_name: *mut u16,
    user_name_max_chars: u32,
    password: *mut u16,
    password_max_chars: u32,
    save: *mut i32,
    flags: u32,
  ) -> u32;
}

#[cfg(windows)]
pub(crate) fn write_target(target: &str, secret: &str) -> Result<(), String> {
  if secret.trim().is_empty() || secret.len() > 2048 { return Err("credential is empty or too large".into()); }
  let mut target_wide = wide(target);
  let mut user_wide = wide("Local CRM Production AI");
  let mut blob = secret.as_bytes().to_vec();
  let credential = CredentialW {
    flags: 0,
    credential_type: 1,
    target_name: target_wide.as_mut_ptr(),
    comment: std::ptr::null_mut(),
    last_written: FileTime { low: 0, high: 0 },
    credential_blob_size: blob.len() as u32,
    credential_blob: blob.as_mut_ptr(),
    persist: 2,
    attribute_count: 0,
    attributes: std::ptr::null_mut(),
    target_alias: std::ptr::null_mut(),
    user_name: user_wide.as_mut_ptr(),
  };
  let ok = unsafe { CredWriteW(&credential, 0) };
  blob.fill(0);
  if ok == 0 { return Err(format!("secure credential write failed: {}", std::io::Error::last_os_error())); }
  Ok(())
}

#[cfg(not(windows))]
pub(crate) fn write_target(_target: &str, _secret: &str) -> Result<(), String> {
  Err("OS secure credential store is unavailable".into())
}

#[cfg(windows)]
pub(crate) fn read_target(target: &str) -> Result<Option<String>, String> {
  let target_wide = wide(target);
  let mut pointer: *mut CredentialW = std::ptr::null_mut();
  let ok = unsafe { CredReadW(target_wide.as_ptr(), 1, 0, &mut pointer) };
  if ok == 0 {
    let code = std::io::Error::last_os_error().raw_os_error().unwrap_or_default();
    if code == 1168 { return Ok(None); }
    return Err(format!("secure credential read failed: {code}"));
  }
  if pointer.is_null() { return Ok(None); }
  let result = unsafe {
    let credential = &*pointer;
    if credential.credential_blob_size == 0 || credential.credential_blob_size > 2048 || credential.credential_blob.is_null() {
      CredFree(pointer.cast());
      return Err("stored credential pointer or length is invalid".to_string());
    }
    let bytes = std::slice::from_raw_parts(credential.credential_blob, credential.credential_blob_size as usize);
    String::from_utf8(bytes.to_vec()).map(Some).map_err(|_| "stored credential is invalid".to_string())
  };
  unsafe { CredFree(pointer.cast()) };
  result
}

#[cfg(not(windows))]
pub(crate) fn read_target(_target: &str) -> Result<Option<String>, String> {
  Err("OS secure credential store is unavailable".into())
}

#[cfg(windows)]
pub(crate) fn delete_target(target: &str) -> Result<(), String> {
  let target_wide = wide(target);
  let ok = unsafe { CredDeleteW(target_wide.as_ptr(), 1, 0) };
  if ok == 0 {
    let code = std::io::Error::last_os_error().raw_os_error().unwrap_or_default();
    if code == 1168 { return Ok(()); }
    return Err(format!("secure credential delete failed: {code}"));
  }
  Ok(())
}

#[cfg(not(windows))]
pub(crate) fn delete_target(_target: &str) -> Result<(), String> {
  Err("OS secure credential store is unavailable".into())
}

#[cfg(windows)]
fn prompt_for_secret(target: &str, capability: &str) -> Result<String, String> {
  const CREDUI_FLAGS_DO_NOT_PERSIST: u32 = 0x0000_0002;
  const CREDUI_FLAGS_ALWAYS_SHOW_UI: u32 = 0x0000_0080;
  const CREDUI_FLAGS_GENERIC_CREDENTIALS: u32 = 0x0004_0000;
  const ERROR_CANCELLED: u32 = 1223;
  let target_wide = wide(target);
  let caption = wide("Local CRM · Trusted Host Credential");
  let message = wide(&format!("输入 {capability} Provider API Key。凭据将保存到 Windows Credential Manager，不会返回 React 或写入 SQLite。"));
  let info = CredUiInfoW {
    cb_size: std::mem::size_of::<CredUiInfoW>() as u32,
    hwnd_parent: std::ptr::null_mut(),
    message_text: message.as_ptr(),
    caption_text: caption.as_ptr(),
    banner: std::ptr::null_mut(),
  };
  let mut username = vec![0u16; 128];
  let mut password = vec![0u16; 2048];
  let mut save = 0;
  let result = unsafe {
    CredUIPromptForCredentialsW(
      &info, target_wide.as_ptr(), std::ptr::null_mut(), 0,
      username.as_mut_ptr(), username.len() as u32,
      password.as_mut_ptr(), password.len() as u32,
      &mut save,
      CREDUI_FLAGS_DO_NOT_PERSIST | CREDUI_FLAGS_ALWAYS_SHOW_UI | CREDUI_FLAGS_GENERIC_CREDENTIALS,
    )
  };
  if result == ERROR_CANCELLED { password.fill(0); return Err("credential_prompt_cancelled".into()); }
  if result != 0 { password.fill(0); return Err(format!("credential prompt failed: {result}")); }
  let end = password.iter().position(|value| *value == 0).unwrap_or(password.len());
  let secret = String::from_utf16(&password[..end]).map_err(|_| "credential prompt returned invalid text".to_string())?;
  password.zeroize();
  if secret.trim().is_empty() { return Err("credential is empty".into()); }
  Ok(secret)
}

#[cfg(not(windows))]
fn prompt_for_secret(_target: &str, _capability: &str) -> Result<String, String> {
  Err("OS-native credential prompt is unavailable".into())
}

#[cfg(all(test, windows))]
mod tests {
  use super::{delete_target, read_target, update_credential_with_compensation, write_target, CredentialStore, TEXT_REASONING};
  use std::sync::Mutex;
  use std::time::{SystemTime, UNIX_EPOCH};

  #[test]
  fn windows_credential_store_persists_updates_and_deletes() {
    let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let target = format!("com.localcrm.test.{suffix}");
    write_target(&target, "dummy-secret-v1").unwrap();
    assert_eq!(read_target(&target).unwrap().as_deref(), Some("dummy-secret-v1"));
    write_target(&target, "dummy-secret-v2").unwrap();
    assert_eq!(read_target(&target).unwrap().as_deref(), Some("dummy-secret-v2"));
    delete_target(&target).unwrap();
    assert_eq!(read_target(&target).unwrap(), None);
  }

  struct CorruptReadbackStore { value: Mutex<Option<String>>, reads: Mutex<usize> }
  impl CredentialStore for CorruptReadbackStore {
    fn read(&self, _capability: &str) -> Result<Option<String>, String> {
      let mut reads = self.reads.lock().unwrap();
      let result = if *reads == 1 { Some("corrupt-new-value".into()) } else { self.value.lock().unwrap().clone() };
      *reads += 1;
      Ok(result)
    }
    fn write(&self, _capability: &str, secret: &str) -> Result<(), String> { *self.value.lock().unwrap() = Some(secret.into()); Ok(()) }
    fn delete(&self, _capability: &str) -> Result<(), String> { *self.value.lock().unwrap() = None; Ok(()) }
  }

  #[test]
  fn credential_update_compensation_restores_old_value_after_verification_failure() {
    let store = CorruptReadbackStore { value: Mutex::new(Some("old-value".into())), reads: Mutex::new(0) };
    let error = update_credential_with_compensation(&store, TEXT_REASONING, "new-value").unwrap_err();
    assert!(error.contains("previous credential restored"));
    assert_eq!(store.value.lock().unwrap().as_deref(), Some("old-value"));
  }
}
