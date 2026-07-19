use std::ffi::c_void;

pub const TEXT_REASONING: &str = "TEXT_REASONING";
pub const VISION_ANALYSIS: &str = "VISION_ANALYSIS";
pub const SEMANTIC_INTENT_ROUTING: &str = "SEMANTIC_INTENT_ROUTING";
const TEXT_TARGET: &str = "com.localcrm.production-ai.deepseek";
const VISION_TARGET: &str = "com.localcrm.production-ai.qwen-vision";

/** Read/delete-only legacy seam. New credentials are never written to Credential Manager. */
pub trait CredentialStore: Send + Sync {
  fn read(&self, capability: &str) -> Result<Option<String>, String>;
  fn delete(&self, capability: &str) -> Result<(), String>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsCredentialStore;

fn target_for(capability: &str) -> Result<&'static str, String> {
  match capability {
    TEXT_REASONING | SEMANTIC_INTENT_ROUTING => Ok(TEXT_TARGET),
    VISION_ANALYSIS => Ok(VISION_TARGET),
    _ => Err("unsupported legacy credential capability".into()),
  }
}

impl CredentialStore for WindowsCredentialStore {
  fn read(&self, capability: &str) -> Result<Option<String>, String> { read_target(target_for(capability)?) }
  fn delete(&self, capability: &str) -> Result<(), String> { delete_target(target_for(capability)?) }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(std::iter::once(0)).collect() }

#[cfg(windows)]
#[repr(C)]
struct FileTime { low: u32, high: u32 }

#[cfg(windows)]
#[repr(C)]
struct CredentialW {
  flags: u32, credential_type: u32, target_name: *mut u16, comment: *mut u16, last_written: FileTime,
  credential_blob_size: u32, credential_blob: *mut u8, persist: u32, attribute_count: u32,
  attributes: *mut c_void, target_alias: *mut u16, user_name: *mut u16,
}

#[cfg(windows)]
#[link(name = "Advapi32")]
extern "system" {
  fn CredReadW(target: *const u16, credential_type: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
  fn CredDeleteW(target: *const u16, credential_type: u32, flags: u32) -> i32;
  fn CredFree(buffer: *mut c_void);
}

#[cfg(windows)]
fn read_target(target: &str) -> Result<Option<String>, String> {
  let target_wide = wide(target);
  let mut pointer: *mut CredentialW = std::ptr::null_mut();
  let ok = unsafe { CredReadW(target_wide.as_ptr(), 1, 0, &mut pointer) };
  if ok == 0 {
    let code = std::io::Error::last_os_error().raw_os_error().unwrap_or_default();
    if code == 1168 { return Ok(None); }
    return Err("legacy credential read failed".into());
  }
  if pointer.is_null() { return Ok(None); }
  let result = unsafe {
    let credential = &*pointer;
    if credential.credential_blob_size == 0 || credential.credential_blob_size > 4096 || credential.credential_blob.is_null() {
      CredFree(pointer.cast()); return Err("legacy credential is invalid".into());
    }
    let bytes = std::slice::from_raw_parts(credential.credential_blob, credential.credential_blob_size as usize);
    String::from_utf8(bytes.to_vec()).map(Some).map_err(|_| "legacy credential is invalid".to_string())
  };
  unsafe { CredFree(pointer.cast()) };
  result
}

#[cfg(not(windows))]
fn read_target(_target: &str) -> Result<Option<String>, String> { Err("legacy Windows credential store is unavailable".into()) }

#[cfg(windows)]
fn delete_target(target: &str) -> Result<(), String> {
  let target_wide = wide(target);
  let ok = unsafe { CredDeleteW(target_wide.as_ptr(), 1, 0) };
  if ok == 0 {
    let code = std::io::Error::last_os_error().raw_os_error().unwrap_or_default();
    if code == 1168 { return Ok(()); }
    return Err("legacy credential delete failed".into());
  }
  Ok(())
}

#[cfg(not(windows))]
fn delete_target(_target: &str) -> Result<(), String> { Err("legacy Windows credential store is unavailable".into()) }
