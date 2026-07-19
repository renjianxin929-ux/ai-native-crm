use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};
use std::time::{Duration, Instant};

use base64::Engine;
use chrono::Utc;
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use tauri::State;
use tokio::sync::Notify;
use tokio::task::AbortHandle;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::encrypted_credentials::{EncryptedCredentialStore, ProviderCredentialInput, ProviderCredentialStatus, TEXT_REASONING};
use crate::secure_credentials::{SEMANTIC_INTENT_ROUTING, VISION_ANALYSIS};

#[cfg(feature = "e2e")]
const DEEPSEEK: &str = "DEEPSEEK_COMPATIBLE";
#[cfg(feature = "e2e")]
const QWEN_VISION: &str = "QWEN_VISION_COMPATIBLE";
#[cfg(feature = "e2e")]
const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
#[cfg(feature = "e2e")]
const QWEN_VISION_ENDPOINT: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const REQUEST_TIMEOUT_SECS: u64 = 75;
const MAX_REQUEST_BYTES: usize = 48_000;
const MAX_RESPONSE_BYTES: usize = 96_000;
const MAX_RETRIES: u32 = 1;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 8192;
const MAX_IMAGE_PIXELS: u64 = 25_000_000;
const VISION_EXIF_ORIENTATION_POLICY: &str = "preserve_original_encoded_orientation";
const REQUEST_TOMBSTONE_TTL: Duration = Duration::from_secs(15 * 60);
const REQUEST_TOMBSTONE_MAX: usize = 512;
const REQUEST_REGISTRY_MAX: usize = 128;
const AUTHORIZED_TTL: Duration = Duration::from_secs(2 * 60);
const STARTING_TIMEOUT: Duration = Duration::from_secs(30);
const ACTIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostCapabilityRequest {
  pub capability: String,
  pub provider_kind: String,
  pub model_id: String,
  pub customer_id: String,
  pub context_snapshot_id: String,
  pub workflow_kind: String,
  pub profile_id: String,
  pub requested_by_user: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostExecutionRequest {
  pub authorization_id: String,
  pub binding: TrustedHostCapabilityRequest,
  pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct TrustedHostBlockedResult { pub state: &'static str, pub reason: &'static str }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostAuthorizationResult {
  pub state: &'static str,
  pub authorization_id: String,
  pub capability: String,
  pub provider_kind: String,
  pub model_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostTokenUsage {
  pub prompt_tokens: Option<u64>,
  pub completion_tokens: Option<u64>,
  pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostCompletionResult {
  pub state: &'static str,
  pub provider_kind: String,
  pub model_id: String,
  pub output: Value,
  pub request_id: String,
  pub latency_ms: u64,
  pub token_usage: Option<TrustedHostTokenUsage>,
}

pub type TrustedHostProviderHealth = ProviderCredentialStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestState { Authorized, Starting, Active, Cancelling, Cancelled, Completed, Failed }

#[derive(Debug)]
struct RequestEntry {
  state: RequestState,
  binding: Option<TrustedHostCapabilityRequest>,
  abort_handle: Option<AbortHandle>,
  cancellation_token: Option<ProviderCancellationToken>,
  state_changed_at: Instant,
  terminal_at: Option<Instant>,
}

#[derive(Debug, Default)]
struct RequestRegistry { entries: HashMap<String, RequestEntry> }

impl RequestRegistry {
  fn cleanup(&mut self, now: Instant) {
    for entry in self.entries.values_mut() {
      let expired = match entry.state {
        RequestState::Authorized => now.duration_since(entry.state_changed_at) > AUTHORIZED_TTL,
        RequestState::Starting => now.duration_since(entry.state_changed_at) > STARTING_TIMEOUT,
        RequestState::Active => now.duration_since(entry.state_changed_at) > ACTIVE_REQUEST_TIMEOUT,
        _ => false,
      };
      if expired {
        if let Some(token) = entry.cancellation_token.take() { token.cancel(); }
        if let Some(handle) = entry.abort_handle.take() { handle.abort(); }
        entry.state = RequestState::Failed;
        entry.binding = None;
        entry.state_changed_at = now;
        entry.terminal_at = Some(now);
      }
    }
    self.entries.retain(|_, entry| entry.terminal_at.is_none_or(|at| now.duration_since(at) <= REQUEST_TOMBSTONE_TTL));
    let mut terminals: Vec<(String, Instant)> = self.entries.iter()
      .filter_map(|(id, entry)| entry.terminal_at.map(|at| (id.clone(), at))).collect();
    if terminals.len() > REQUEST_TOMBSTONE_MAX {
      terminals.sort_by_key(|(_, at)| *at);
      let excess = terminals.len() - REQUEST_TOMBSTONE_MAX;
      for (id, _) in terminals.into_iter().take(excess) {
        self.entries.remove(&id);
      }
    }
  }

  fn reserve_authorized(&mut self, id: String, binding: TrustedHostCapabilityRequest, now: Instant) -> Result<(), TrustedHostBlockedResult> {
    self.cleanup(now);
    if self.entries.contains_key(&id) { return Err(blocked("duplicate_request_id")); }
    if self.entries.len() >= REQUEST_REGISTRY_MAX {
      let mut terminals: Vec<(String, Instant)> = self.entries.iter()
        .filter_map(|(entry_id, entry)| entry.terminal_at.map(|at| (entry_id.clone(), at))).collect();
      terminals.sort_by_key(|(_, at)| *at);
      for (terminal_id, _) in terminals {
        if self.entries.len() < REQUEST_REGISTRY_MAX { break; }
        self.entries.remove(&terminal_id);
      }
    }
    if self.entries.len() >= REQUEST_REGISTRY_MAX { return Err(blocked("request_registry_capacity_reached")); }
    self.entries.insert(id, RequestEntry {
      state: RequestState::Authorized, binding: Some(binding), abort_handle: None, cancellation_token: None,
      state_changed_at: now, terminal_at: None,
    });
    Ok(())
  }

  fn terminal(&mut self, id: &str, state: RequestState) {
    if let Some(entry) = self.entries.get_mut(id) {
      entry.state = state;
      entry.binding = None;
      entry.abort_handle = None;
      entry.cancellation_token = None;
      entry.state_changed_at = Instant::now();
      entry.terminal_at = Some(Instant::now());
    }
    self.cleanup(Instant::now());
  }

  fn assert_commit_allowed(&mut self, id: &str, now: Instant) -> Result<(), TrustedHostBlockedResult> {
    self.cleanup(now);
    match self.entries.get(id).map(|entry| entry.state) {
      Some(RequestState::Active) => Ok(()),
      Some(RequestState::Cancelling | RequestState::Cancelled) => Err(blocked("cancelled")),
      _ => Err(blocked("request_commit_not_allowed")),
    }
  }

  fn complete_if_active(&mut self, id: &str, now: Instant) -> Result<(), TrustedHostBlockedResult> {
    self.assert_commit_allowed(id, now)?;
    self.terminal(id, RequestState::Completed);
    Ok(())
  }

  fn abort_all_active(&mut self, now: Instant) {
    for entry in self.entries.values_mut() {
      if matches!(entry.state, RequestState::Authorized | RequestState::Starting | RequestState::Active | RequestState::Cancelling) {
        if let Some(token) = entry.cancellation_token.take() { token.cancel(); }
        if let Some(handle) = entry.abort_handle.take() { handle.abort(); }
        entry.state = RequestState::Cancelled;
        entry.binding = None;
        entry.state_changed_at = now;
        entry.terminal_at = Some(now);
      }
    }
    self.cleanup(now);
  }
}

pub struct TrustedHostState {
  registry: std::sync::Mutex<RequestRegistry>,
  client: reqwest::Client,
  credentials: EncryptedCredentialStore,
}

impl TrustedHostState {
  pub fn new(credentials: EncryptedCredentialStore) -> Self {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
      .build().expect("trusted host HTTP client must build");
    Self { registry: Default::default(), client, credentials }
  }

  pub fn abort_all_for_shutdown(&self) {
    if let Ok(mut registry) = self.registry.lock() { registry.abort_all_active(Instant::now()); }
  }
}

impl Drop for TrustedHostState {
  fn drop(&mut self) {
    if let Ok(registry) = self.registry.get_mut() { registry.abort_all_active(Instant::now()); }
  }
}

struct RequestExecutionGuard<'a> {
  registry: &'a std::sync::Mutex<RequestRegistry>,
  request_id: String,
  armed: bool,
}

impl<'a> RequestExecutionGuard<'a> {
  fn new(state: &'a TrustedHostState, request_id: &str) -> Self {
    Self { registry: &state.registry, request_id: request_id.into(), armed: true }
  }
  fn disarm(&mut self) { self.armed = false; }
}

impl Drop for RequestExecutionGuard<'_> {
  fn drop(&mut self) {
    if !self.armed { return; }
    if let Ok(mut registry) = self.registry.lock() {
      if registry.entries.get(&self.request_id).is_some_and(|entry| matches!(entry.state, RequestState::Authorized | RequestState::Starting | RequestState::Active | RequestState::Cancelling)) {
        if let Some(entry) = registry.entries.get_mut(&self.request_id) {
          if let Some(token) = entry.cancellation_token.take() { token.cancel(); }
          if let Some(handle) = entry.abort_handle.take() { handle.abort(); }
        }
        registry.terminal(&self.request_id, RequestState::Failed);
      }
    }
  }
}

impl Default for TrustedHostState {
  fn default() -> Self {
    Self::new(EncryptedCredentialStore::new(std::env::temp_dir().join(format!("local-crm-trusted-host-test-{}.db", Uuid::new_v4()))))
  }
}

struct HostProviderCredential { endpoint: String, api_key: Zeroizing<String>, model_id: String }

#[derive(Debug, Clone, Default)]
struct ProviderCancellationToken {
  cancelled: Arc<AtomicBool>,
  notify: Arc<Notify>,
}

impl ProviderCancellationToken {
  fn cancel(&self) {
    self.cancelled.store(true, Ordering::Release);
    self.notify.notify_waiters();
  }

  fn is_cancelled(&self) -> bool { self.cancelled.load(Ordering::Acquire) }

  async fn cancelled(&self) {
    if self.is_cancelled() { return; }
    let notified = self.notify.notified();
    if self.is_cancelled() { return; }
    notified.await;
  }
}

#[derive(Debug)]
#[cfg_attr(not(feature = "e2e"), allow(dead_code))]
struct ProviderRequest {
  capability: String,
  customer_id: String,
  method: &'static str,
  endpoint: String,
  url_category: &'static str,
  authorization: Option<Zeroizing<String>>,
  body: Value,
}

impl Drop for ProviderRequest {
  fn drop(&mut self) {
    self.authorization.take();
  }
}

#[derive(Debug)]
struct RawProviderHttpResponse {
  status: u16,
  headers_metadata: Vec<(String, String)>,
  body: Vec<u8>,
}

type ProviderTransportFuture<'a> = Pin<Box<dyn Future<Output = Result<RawProviderHttpResponse, TrustedHostBlockedResult>> + Send + 'a>>;

trait ProviderTransport: Send + Sync + 'static {
  fn send<'a>(
    &'a self,
    request_id: &'a str,
    provider_request: &'a ProviderRequest,
    cancellation_token: &'a ProviderCancellationToken,
  ) -> ProviderTransportFuture<'a>;
}

#[cfg(not(feature = "e2e"))]
struct ReqwestProviderTransport { client: reqwest::Client }

#[cfg(not(feature = "e2e"))]
impl ProviderTransport for ReqwestProviderTransport {
  fn send<'a>(
    &'a self,
    _request_id: &'a str,
    provider_request: &'a ProviderRequest,
    cancellation_token: &'a ProviderCancellationToken,
  ) -> ProviderTransportFuture<'a> {
    Box::pin(async move {
      if cancellation_token.is_cancelled() { return Err(blocked("cancelled")); }
      let mut builder = self.client.post(&provider_request.endpoint).json(&provider_request.body);
      if let Some(secret) = provider_request.authorization.as_ref() { builder = builder.bearer_auth(secret.as_str()); }
      let response = tokio::select! {
        _ = cancellation_token.cancelled() => return Err(blocked("cancelled")),
        result = builder.send() => result.map_err(|error| {
          if error.is_timeout() { blocked("timeout") } else { blocked("host_provider_request_failed") }
        })?,
      };
      read_raw_provider_response(response).await
    })
  }
}

#[cfg(feature = "e2e")]
struct DeterministicFakeNetworkTransport;

#[cfg(feature = "e2e")]
impl ProviderTransport for DeterministicFakeNetworkTransport {
  fn send<'a>(
    &'a self,
    request_id: &'a str,
    provider_request: &'a ProviderRequest,
    cancellation_token: &'a ProviderCancellationToken,
  ) -> ProviderTransportFuture<'a> {
    Box::pin(async move { send_deterministic_fake_http(request_id, provider_request, cancellation_token).await })
  }
}

#[tauri::command]
pub async fn authorize_model_capability(
  request: TrustedHostCapabilityRequest,
  state: State<'_, TrustedHostState>,
) -> Result<TrustedHostAuthorizationResult, TrustedHostBlockedResult> {
  validate_binding(&request)?;
  #[cfg(not(feature = "e2e"))]
  let model_id = resolve_credential(&state.credentials, &request).await?.model_id;
  #[cfg(feature = "e2e")]
  let model_id = {
    if e2e_capability_is_unconfigured(&request.capability) { return Err(blocked("missing_host_provider")); }
    request.model_id.clone()
  };
  let authorization_id = next_authorization_id();
  let mut registry = state.registry.lock().map_err(|_| blocked("authorization_store_unavailable"))?;
  registry.reserve_authorized(authorization_id.clone(), request.clone(), Instant::now())?;
  Ok(TrustedHostAuthorizationResult {
    state: "authorized", authorization_id, capability: request.capability,
    provider_kind: request.provider_kind, model_id,
  })
}

#[tauri::command]
pub async fn execute_model_capability(
  request: TrustedHostExecutionRequest,
  state: State<'_, TrustedHostState>,
) -> Result<TrustedHostCompletionResult, TrustedHostBlockedResult> {
  validate_binding(&request.binding)?;
  {
    let mut registry = state.registry.lock().map_err(|_| blocked("authorization_store_unavailable"))?;
    registry.cleanup(Instant::now());
    let entry = registry.entries.get_mut(&request.authorization_id).ok_or_else(|| blocked("missing_or_reused_authorization"))?;
    if entry.state == RequestState::Cancelled { return Err(blocked("cancelled")); }
    if entry.state != RequestState::Authorized { return Err(blocked("missing_or_reused_authorization")); }
    if entry.binding.as_ref() != Some(&request.binding) { return Err(blocked("authorization_binding_mismatch")); }
    entry.state = RequestState::Starting;
    entry.state_changed_at = Instant::now();
  }
  #[cfg(not(feature = "e2e"))]
  {
    let credential = resolve_credential(&state.credentials, &request.binding).await?;
    let transport = ReqwestProviderTransport { client: state.client.clone() };
    return execute_provider_pipeline(
      request,
      &state,
      transport,
      credential.endpoint,
      credential.model_id,
      Some(credential.api_key),
    ).await;
  }
  #[cfg(feature = "e2e")]
  {
    let endpoint = provider_endpoint(&request.binding.capability)?;
    let model_id = provider_and_model(&request.binding.capability).ok_or_else(|| blocked("unsupported_capability_provider"))?.1;
    return execute_provider_pipeline(
      request,
      &state,
      DeterministicFakeNetworkTransport,
      endpoint.into(),
      model_id.into(),
      None,
    ).await;
  }
}

async fn execute_provider_pipeline<T: ProviderTransport>(
  request: TrustedHostExecutionRequest,
  state: &TrustedHostState,
  transport: T,
  endpoint: String,
  model_id: String,
  authorization: Option<Zeroizing<String>>,
) -> Result<TrustedHostCompletionResult, TrustedHostBlockedResult> {
  let request_id = request.authorization_id.clone();
  let mut request_guard = RequestExecutionGuard::new(state, &request_id);
  let prepared = (|| {
    let host_vision_source = if request.binding.capability == VISION_ANALYSIS {
      Some(parse_vision_input(&request.input)?.source_reference)
    } else { None };
    let body = build_provider_request(&request.binding, &model_id, &request.input, &request_id)?;
    let request_limit = if request.binding.capability == VISION_ANALYSIS { MAX_REQUEST_BYTES + MAX_IMAGE_BYTES * 2 } else { MAX_REQUEST_BYTES };
    if serde_json::to_vec(&body).map_err(|_| blocked("invalid_request"))?.len() > request_limit { return Err(blocked("request_too_large")); }
    let url_category = if request.binding.capability == VISION_ANALYSIS { "vision_chat_completions" } else { "text_chat_completions" };
    Ok((host_vision_source, ProviderRequest {
      capability: request.binding.capability.clone(), customer_id: request.binding.customer_id.clone(),
      method: "POST", endpoint, url_category, authorization, body,
    }))
  })();
  let (host_vision_source, provider_request) = match prepared {
    Ok(value) => value,
    Err(error) => {
      state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?.terminal(&request_id, RequestState::Failed);
      return Err(error);
    }
  };
  let allow_late_response = transport_allows_late_response(&provider_request);
  let cancellation_token = ProviderCancellationToken::default();
  let task_request_id = request_id.clone();
  let task_token = cancellation_token.clone();
  let started = Instant::now();
  let task = tokio::spawn(async move {
    send_provider_with_bounded_retry(&transport, &task_request_id, &provider_request, &task_token).await
  });
  {
    let mut registry = state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?;
    let entry = registry.entries.get_mut(&request_id).ok_or_else(|| blocked("missing_or_reused_authorization"))?;
    if entry.state == RequestState::Cancelled { task.abort(); return Err(blocked("cancelled")); }
    if entry.state != RequestState::Starting { task.abort(); return Err(blocked("invalid_request_state")); }
    entry.state = RequestState::Active;
    entry.state_changed_at = Instant::now();
    entry.cancellation_token = Some(cancellation_token);
    if !allow_late_response { entry.abort_handle = Some(task.abort_handle()); }
  }
  #[cfg(feature = "e2e")]
  write_e2e_cancellation_event(&request_id, "active");
  let joined = task.await;
  if joined.as_ref().is_err_and(|error| error.is_cancelled()) {
    state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?.terminal(&request_id, RequestState::Cancelled);
    return Err(blocked("cancelled"));
  }
  let payload = match joined {
    Ok(Ok(value)) => value,
    Ok(Err(error)) => {
      if error.reason != "cancelled" {
        state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?.terminal(&request_id, RequestState::Failed);
      }
      return Err(error);
    }
    Err(_) => {
      state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?.terminal(&request_id, RequestState::Failed);
      return Err(blocked("host_provider_task_failed"));
    }
  };
  assert_request_commit_allowed(state, &request_id)?;
  let token_usage = extract_token_usage(&payload);
  assert_request_commit_allowed(state, &request_id)?;
  let output = match extract_output(&request.binding, payload, host_vision_source.as_deref()) {
    Ok(value) => value,
    Err(error) => {
      state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?.terminal(&request_id, RequestState::Failed);
      return Err(error);
    }
  };
  assert_request_commit_allowed(state, &request_id)?;
  state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?.complete_if_active(&request_id, Instant::now())?;
  #[cfg(feature = "e2e")]
  write_e2e_cancellation_event(&request_id, "completed");
  request_guard.disarm();
  Ok(TrustedHostCompletionResult {
    state: "completed", provider_kind: request.binding.provider_kind, model_id: request.binding.model_id,
    output, request_id, latency_ms: started.elapsed().as_millis() as u64, token_usage,
  })
}

#[cfg(feature = "e2e")]
fn fake_provider_content(provider_request: &ProviderRequest) -> Result<Value, TrustedHostBlockedResult> {
  let input = fake_provider_input(&provider_request.body);
  if provider_request.capability == SEMANTIC_INTENT_ROUTING {
    let instruction = input.get("instruction").and_then(Value::as_str).unwrap_or_default();
    let intent = if instruction.contains("风险") || instruction.contains("隐患") || instruction.contains("有点悬") { "CUSTOMER_RISK_ANALYSIS" }
      else if instruction.contains("下一") || instruction.contains("推进") { "NEXT_ACTION_RECOMMENDATION" }
      else if instruction.contains("沟通") || instruction.contains("交流") || instruction.contains("来回说") { "INTERACTION_SUMMARY" }
      else { "CUSTOMER_SUMMARY" };
    return Ok(json!({
      "intent": intent,
      "filters": {},
      "entities": [],
      "scope": Value::Null,
      "missing_fields": [],
      "confidence": 0.96,
      "clarification_question": Value::Null
    }));
  }
  if provider_request.capability == VISION_ANALYSIS {
    let source_reference = "provider-forged-source-reference";
    return Ok(json!({
      "extracted_facts": [{
        "fact_id": "e2e-vision-fact-1", "fact_type": "visible_requirement",
        "content": "E2E 图片中的客户需求已提取，等待人工复核。",
        "source_reference": source_reference, "confidence": 0.98
      }],
      "source_reference": source_reference,
      "confidence": 0.98,
      "evidence_regions": ["full-image"],
      "unsupported_assumptions": [],
      "requires_fact_review": true
    }));
  }
  if input.get("source_type").and_then(Value::as_str) == Some("text") {
    let source = input.get("source").and_then(Value::as_str).unwrap_or_default();
    return Ok(json!({
      "extracted_facts": [{
        "fact_id": "e2e-text-fact-1", "fact_type": "visible_requirement",
        "content": if source.is_empty() { "E2E 文本事实等待人工复核。" } else { source },
        "source_reference": "user-pasted-text", "confidence": 1.0
      }]
    }));
  }
  let envelope = input.get("model_context_envelope").unwrap_or(&input);
  let schema = input.get("required_schema").and_then(Value::as_str)
    .or_else(|| envelope.get("requested_output_schema").and_then(Value::as_str))
    .unwrap_or("customer_summary_v1");
  let instruction = envelope.get("user_instruction").and_then(Value::as_str).unwrap_or_default();
  let valid_evidence = envelope.pointer("/evidence_map/0/evidence_id").and_then(Value::as_str)
    .or_else(|| envelope.get("customer_id").and_then(Value::as_str))
    .unwrap_or("e2e-customer-1");
  let evidence = if instruction.contains("E2E_INVALID_EVIDENCE") { "missing-evidence-ref" } else { valid_evidence };
  let unsupported_inference = instruction.contains("E2E_UNSUPPORTED_INFERENCE");
  match schema {
    "risk_analysis_v1" => Ok(json!({
      "risk_items": [{
        "id":"e2e-risk-1","summary":"需要人工复核的 E2E 风险。","severity":"medium",
        "inference_type": if unsupported_inference { "model_inference" } else { "crm_fact" },
        "evidence_refs": if unsupported_inference { json!([]) } else { json!([evidence]) }
      }],
      "severity":"medium","reasoning_summary":"基于隔离 E2E CRM 事实。","evidence_refs":[evidence],
      "mitigation":["人工确认后推进"],"uncertainty":[],"requires_human_review":true
    })),
    "next_action_v1" => Ok(json!({
      "recommended_next_steps":["确认关键联系人后安排下一次沟通"],"reasoning_summary":"E2E 下一步建议。",
      "evidence_refs":[evidence],"uncertainty":[],"requires_human_review":true
    })),
    "follow_up_draft_v1" => Ok(json!({
      "draft_text":"您好，想跟进确认一下当前安排，如方便请告知下一步时间。","tone":"professional",
      "objective":"确认下一步安排","evidence_refs":[evidence],"unsupported_assumptions":[],"requires_human_review":true
    })),
    "interaction_summary_v1" => Ok(json!({
      "interaction_summary":"近期沟通围绕需求与下一步时间展开。","key_points":["需求待确认"],
      "evidence_refs":[evidence],"uncertainty":[],"requires_human_review":true
    })),
    "complex_customer_compare_v1" => {
      let mut ids: Vec<String> = envelope.get("customer_allowlist").and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).take(5).map(str::to_string).collect()).unwrap_or_default();
      if ids.len() < 2 { ids = vec![provider_request.customer_id.clone(), "e2e-customer-2".into()]; }
      let evidence_for = |customer_id: &str| -> String {
        envelope.get("evidence_map").and_then(Value::as_array)
          .and_then(|items| items.iter().find(|item| item.get("customer_id").and_then(Value::as_str) == Some(customer_id)))
          .and_then(|item| item.get("evidence_id")).and_then(Value::as_str)
          .unwrap_or(evidence).to_string()
      };
      let ranked: Vec<Value> = ids.iter().enumerate().map(|(index, id)| json!({
        "customer_id": id, "rank": index + 1, "rationale": "E2E evidence-backed comparison",
        "evidence_refs": [evidence_for(id)]
      })).collect();
      let evidence_refs: Vec<String> = ids.iter().map(|id| evidence_for(id)).collect();
      Ok(json!({"comparison_summary":"E2E 客户对比完成。","ranked_customers":ranked,"evidence_refs":evidence_refs,"uncertainty":[],"requires_human_review":true}))
    },
    _ => Ok(json!({
      "customer_understanding":"E2E 隔离客户摘要。","recent_changes":"最近状态由隔离库提供。",
      "risks":["需要人工复核"],"opportunities":["可继续跟进"],"recommended_next_steps":["安排后续沟通"],
      "evidence_refs":[evidence],"uncertainty":[],"speculative_claims":[],"requires_human_review":true
    })),
  }
}

#[cfg(feature = "e2e")]
fn fake_provider_input(body: &Value) -> Value {
  body.get("messages").and_then(Value::as_array).and_then(|messages| messages.last())
    .and_then(|message| message.get("content")).and_then(Value::as_str)
    .and_then(|content| serde_json::from_str(content).ok())
    .unwrap_or_else(|| json!({}))
}

#[cfg(feature = "e2e")]
fn provider_endpoint(capability: &str) -> Result<&'static str, TrustedHostBlockedResult> {
  match capability {
    VISION_ANALYSIS => Ok(QWEN_VISION_ENDPOINT),
    TEXT_REASONING | SEMANTIC_INTENT_ROUTING => Ok(DEEPSEEK_ENDPOINT),
    _ => Err(blocked("unsupported_capability_provider")),
  }
}

#[cfg(feature = "e2e")]
fn e2e_capability_is_unconfigured(capability: &str) -> bool {
  std::env::var("AI_NATIVE_CRM_E2E_UNCONFIGURED_CAPABILITIES").ok().is_some_and(|configured| {
    configured.split(',').map(str::trim).any(|item| item == capability)
  })
}

#[cfg(feature = "e2e")]
fn e2e_capability_is_delayed(capability: &str) -> bool {
  std::env::var("AI_NATIVE_CRM_E2E_DELAY_CAPABILITIES").ok().is_some_and(|configured| {
    configured.split(',').map(str::trim).any(|item| item == capability)
  })
}

#[cfg(feature = "e2e")]
fn transport_allows_late_response(request: &ProviderRequest) -> bool {
  request.body.to_string().contains("E2E_LATE_RESPONSE_AFTER_CANCEL")
}

#[cfg(not(feature = "e2e"))]
fn transport_allows_late_response(_request: &ProviderRequest) -> bool { false }

#[cfg(not(feature = "e2e"))]
async fn read_raw_provider_response(mut response: reqwest::Response) -> Result<RawProviderHttpResponse, TrustedHostBlockedResult> {
  let status = response.status().as_u16();
  let headers_metadata = response.headers().iter().filter_map(|(name, value)| {
    if ["content-type", "content-length", "retry-after"].contains(&name.as_str()) {
      Some((name.to_string(), value.to_str().unwrap_or("non-utf8").to_string()))
    } else { None }
  }).collect();
  if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err(blocked("response_too_large")); }
  let mut body = Vec::new();
  while let Some(chunk) = response.chunk().await.map_err(|_| blocked("host_provider_invalid_response"))? {
    if body.len() + chunk.len() > MAX_RESPONSE_BYTES { return Err(blocked("response_too_large")); }
    body.extend_from_slice(&chunk);
  }
  Ok(RawProviderHttpResponse { status, headers_metadata, body })
}

async fn send_provider_with_bounded_retry<T: ProviderTransport>(
  transport: &T,
  request_id: &str,
  provider_request: &ProviderRequest,
  cancellation_token: &ProviderCancellationToken,
) -> Result<Value, TrustedHostBlockedResult> {
  let mut attempt = 0;
  loop {
    if cancellation_token.is_cancelled() && !transport_allows_late_response(provider_request) { return Err(blocked("cancelled")); }
    let result = match transport.send(request_id, provider_request, cancellation_token).await {
      Ok(raw) => validate_raw_provider_response(raw),
      Err(error) => Err(error),
    };
    match result {
      Ok(payload) => return Ok(payload),
      Err(error) => {
        let retryable = ["host_provider_request_failed", "timeout", "host_provider_5xx"].contains(&error.reason);
        if !retryable || attempt >= MAX_RETRIES || cancellation_token.is_cancelled() { return Err(error); }
        attempt += 1;
      }
    }
  }
}

fn validate_raw_provider_response(response: RawProviderHttpResponse) -> Result<Value, TrustedHostBlockedResult> {
  let _headers_metadata = response.headers_metadata;
  match response.status {
    401 | 403 => return Err(blocked("unauthorized")),
    429 => return Err(blocked("rate_limited")),
    500..=599 => return Err(blocked("host_provider_5xx")),
    200..=299 => {}
    _ => return Err(blocked("host_provider_response_rejected")),
  }
  if response.body.len() > MAX_RESPONSE_BYTES { return Err(blocked("response_too_large")); }
  serde_json::from_slice(&response.body).map_err(|_| blocked("host_provider_invalid_response"))
}

#[cfg(feature = "e2e")]
async fn send_deterministic_fake_http(
  request_id: &str,
  provider_request: &ProviderRequest,
  cancellation_token: &ProviderCancellationToken,
) -> Result<RawProviderHttpResponse, TrustedHostBlockedResult> {
  write_fake_transport_capture(request_id, "request", json!({
    "request_id": request_id,
    "capability": provider_request.capability,
    "customer_id": provider_request.customer_id,
    "method": provider_request.method,
    "url_category": provider_request.url_category,
    "endpoint": provider_request.endpoint,
    "headers_metadata": {"content_type":"application/json","authorization_present":provider_request.authorization.is_some()},
    "visual_body_attestation": visual_body_attestation(&provider_request.body),
    "body": sanitize_provider_body(provider_request.body.clone()),
  }))?;
  write_e2e_cancellation_event(request_id, "transport_started");
  let serialized = provider_request.body.to_string();
  if serialized.contains("E2E_PROVIDER_UNAVAILABLE") { return Err(blocked("missing_host_provider")); }
  let delay_ms = if e2e_capability_is_delayed(&provider_request.capability) || serialized.contains("E2E_DELAYED_RESULT") || serialized.contains("E2E_LATE_RESPONSE_AFTER_CANCEL") || serialized.contains("E2E_SEMANTIC_DELAYED_CANCEL") { 1_500 } else { 45 };
  if serialized.contains("E2E_TIMEOUT") {
    tokio::time::sleep(Duration::from_millis(80)).await;
    return Err(blocked("timeout"));
  }
  if serialized.contains("E2E_LATE_RESPONSE_AFTER_CANCEL") {
    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
  } else {
    tokio::select! {
      _ = cancellation_token.cancelled() => return Err(blocked("cancelled")),
      _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
    }
  }
  let status = if serialized.contains("E2E_HTTP_401") { 401 }
    else if serialized.contains("E2E_HTTP_403") { 403 }
    else if serialized.contains("E2E_HTTP_429") { 429 }
    else if serialized.contains("E2E_HTTP_5XX") { 503 }
    else { 200 };
  let body = if serialized.contains("E2E_MALFORMED_JSON") {
    b"{malformed-provider-json".to_vec()
  } else if serialized.contains("E2E_OVERSIZED_RESPONSE") {
    vec![b'x'; MAX_RESPONSE_BYTES + 1]
  } else {
    let content = if serialized.contains("E2E_INVALID_SCHEMA") { json!({"invalid":true}) } else { fake_provider_content(provider_request)? };
    serde_json::to_vec(&json!({
      "id": format!("fake-provider-{request_id}"),
      "choices": [{"index":0,"message":{"role":"assistant","content":content.to_string()},"finish_reason":"stop"}],
      "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
    })).map_err(|_| blocked("host_provider_invalid_response"))?
  };
  let response = RawProviderHttpResponse {
    status,
    headers_metadata: vec![("content-type".into(), "application/json".into()), ("x-e2e-transport".into(), "deterministic-network".into())],
    body,
  };
  write_fake_transport_capture(request_id, "response", json!({
    "request_id": request_id,
    "status": response.status,
    "headers_metadata": response.headers_metadata.clone(),
    "raw_body_size": response.body.len(),
    "raw_body_sha256": format!("{:x}", Sha256::digest(&response.body)),
    "raw_body": if response.body.len() <= MAX_RESPONSE_BYTES { String::from_utf8_lossy(&response.body).to_string() } else { "[oversized-response-redacted]".into() },
  }))?;
  write_e2e_cancellation_event(request_id, "raw_response_arrived");
  Ok(response)
}

#[cfg(feature = "e2e")]
fn visual_body_attestation(value: &Value) -> Value {
  fn collect(value: &Value, output: &mut Vec<Value>) {
    match value {
      Value::String(text) if text.starts_with("data:image/") => {
        if let Some((prefix, encoded)) = text.split_once(",") {
          if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) {
            output.push(json!({
              "content_part_type": "image_url",
              "mime_type": prefix.strip_prefix("data:").and_then(|item| item.strip_suffix(";base64")).unwrap_or("unknown"),
              "data_url_present": true,
              "data_url_length": text.len(),
              "decoded_byte_length": bytes.len(),
              "decoded_sha256": format!("{:x}", Sha256::digest(&bytes)),
            }));
          }
        }
      }
      Value::Array(items) => items.iter().for_each(|item| collect(item, output)),
      Value::Object(object) => object.values().for_each(|item| collect(item, output)),
      _ => {}
    }
  }
  let mut visual_parts = Vec::new();
  collect(value, &mut visual_parts);
  Value::Array(visual_parts)
}

#[cfg(feature = "e2e")]
fn sanitize_provider_body(mut value: Value) -> Value {
  fn visit(value: &mut Value) {
    match value {
      Value::String(text) if text.starts_with("data:image/") => {
        let size = text.len();
        let sha = format!("{:x}", Sha256::digest(text.as_bytes()));
        *text = format!("[visual-data-url-redacted bytes={size} sha256={sha}]");
      }
      Value::Array(items) => items.iter_mut().for_each(visit),
      Value::Object(object) => object.values_mut().for_each(visit),
      _ => {}
    }
  }
  visit(&mut value);
  value
}

#[cfg(feature = "e2e")]
fn write_fake_transport_capture(request_id: &str, phase: &str, value: Value) -> Result<(), TrustedHostBlockedResult> {
  let Ok(root) = std::env::var("AI_NATIVE_CRM_E2E_EVIDENCE_ROOT") else { return Ok(()); };
  let directory = std::path::Path::new(&root).join("provider-transport-captures");
  std::fs::create_dir_all(&directory).map_err(|_| blocked("e2e_capture_write_failed"))?;
  let safe_id: String = request_id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-').collect();
  let path = directory.join(format!("{safe_id}-{phase}.json"));
  let bytes = serde_json::to_vec_pretty(&value).map_err(|_| blocked("e2e_capture_write_failed"))?;
  std::fs::write(path, bytes).map_err(|_| blocked("e2e_capture_write_failed"))
}

#[cfg(feature = "e2e")]
fn write_e2e_cancellation_event(request_id: &str, event: &str) {
  use std::io::Write as _;
  let Ok(root) = std::env::var("AI_NATIVE_CRM_E2E_EVIDENCE_ROOT") else { return; };
  let directory = std::path::Path::new(&root).join("cancellation-traces");
  if std::fs::create_dir_all(&directory).is_err() { return; }
  let safe_id: String = request_id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-').collect();
  let path = directory.join(format!("{safe_id}-events.jsonl"));
  let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) else { return; };
  let line = json!({"at": iso_now(), "request_id": request_id, "event": event}).to_string();
  let _ = writeln!(file, "{line}");
}

fn assert_request_commit_allowed(state: &TrustedHostState, request_id: &str) -> Result<(), TrustedHostBlockedResult> {
  let result = state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?
    .assert_commit_allowed(request_id, Instant::now());
  #[cfg(feature = "e2e")]
  if result.is_err() { write_e2e_cancellation_event(request_id, "commit_rejected"); }
  result
}

#[tauri::command]
pub fn cancel_trusted_host_request(request_id: String, state: State<'_, TrustedHostState>) -> Result<bool, TrustedHostBlockedResult> {
  cancel_request(&state, &request_id)
}

fn cancel_request(state: &TrustedHostState, request_id: &str) -> Result<bool, TrustedHostBlockedResult> {
  let mut registry = state.registry.lock().map_err(|_| blocked("cancellation_store_unavailable"))?;
  registry.cleanup(Instant::now());
  let Some(entry) = registry.entries.get_mut(request_id) else { return Ok(false); };
  match entry.state {
    RequestState::Authorized | RequestState::Starting => {
      if let Some(token) = entry.cancellation_token.take() { token.cancel(); }
      entry.state = RequestState::Cancelled;
      entry.binding = None;
      entry.terminal_at = Some(Instant::now());
      entry.state_changed_at = Instant::now();
      Ok(true)
    }
    RequestState::Active => {
      entry.state = RequestState::Cancelling;
      #[cfg(feature = "e2e")]
      write_e2e_cancellation_event(request_id, "cancelling");
      if let Some(token) = entry.cancellation_token.take() { token.cancel(); }
      if let Some(handle) = entry.abort_handle.take() { handle.abort(); }
      entry.state = RequestState::Cancelled;
      #[cfg(feature = "e2e")]
      write_e2e_cancellation_event(request_id, "cancelled");
      entry.binding = None;
      entry.terminal_at = Some(Instant::now());
      entry.state_changed_at = Instant::now();
      Ok(true)
    }
    RequestState::Cancelling | RequestState::Cancelled => Ok(true),
    RequestState::Completed | RequestState::Failed => Ok(false),
  }
}

#[tauri::command]
pub async fn configure_trusted_host_credential(
  input: ProviderCredentialInput,
  state: State<'_, TrustedHostState>,
) -> Result<TrustedHostProviderHealth, TrustedHostBlockedResult> {
  state.credentials.save(input).await.map_err(|_| blocked("secure_credential_configuration_failed"))
}

#[tauri::command]
pub async fn delete_trusted_host_credential(
  capability: String,
  state: State<'_, TrustedHostState>,
) -> Result<TrustedHostProviderHealth, TrustedHostBlockedResult> {
  state.credentials.delete(&capability).await.map_err(|_| blocked("secure_credential_delete_failed"))
}

#[tauri::command]
pub async fn probe_trusted_host_provider_health(
  capability: String,
  _provider_kind: String,
  state: State<'_, TrustedHostState>,
) -> Result<TrustedHostProviderHealth, TrustedHostBlockedResult> {
  state.credentials.status(&capability).await.map_err(|_| blocked("secure_credential_status_failed"))
}

#[tauri::command]
pub async fn list_trusted_host_provider_status(
  state: State<'_, TrustedHostState>,
) -> Result<Vec<TrustedHostProviderHealth>, TrustedHostBlockedResult> {
  state.credentials.list_status().await.map_err(|_| blocked("secure_credential_status_failed"))
}

#[tauri::command]
pub async fn test_trusted_host_provider_connection(
  capability: String,
  state: State<'_, TrustedHostState>,
) -> Result<TrustedHostProviderHealth, TrustedHostBlockedResult> {
  let mut health = state.credentials.status(&capability).await.map_err(|_| blocked("secure_credential_status_failed"))?;
  let credential = state.credentials.load_runtime(&capability).await.map_err(|_| blocked("missing_host_provider"))?;
  let request = health_binding(&capability, &credential);
  let input = if capability == VISION_ANALYSIS {
    json!({ "vision_request": {
      "mime_type": "image/png",
      "image_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "source_reference": "connection-test"
    }})
  } else {
    json!({ "connection_test": true, "required_schema": "health_check_v1" })
  };
  let body = match build_provider_request(&request, &credential.model, &input, "connection-test") {
    Ok(value) => value,
    Err(error) => return Err(error),
  };
  let host_credential = HostProviderCredential { endpoint: credential.endpoint, api_key: credential.api_key, model_id: credential.model };
  match send_with_bounded_retry(state.client.clone(), host_credential, body).await {
    Ok(_) => { health.status = "healthy".into(); health.detail = "explicit minimal connection test succeeded".into(); }
    Err(error) => {
      health.status = match error.reason {
        "unauthorized" => "unauthorized", "rate_limited" => "rate_limited", "timeout" => "timeout", _ => "unavailable",
      }.into();
      health.detail = error.reason.into();
    }
  }
  health.checked_at = Some(iso_now());
  let _ = state.credentials.record_health(&capability, &health.status).await;
  Ok(health)
}

async fn resolve_credential(store: &EncryptedCredentialStore, request: &TrustedHostCapabilityRequest) -> Result<HostProviderCredential, TrustedHostBlockedResult> {
  let credential = store.load_runtime(&request.capability).await.map_err(|_| blocked("missing_host_provider"))?;
  if request.provider_kind != credential.provider_kind || request.model_id != credential.model { return Err(blocked("unsupported_capability_provider")); }
  Ok(HostProviderCredential { endpoint: credential.endpoint, api_key: credential.api_key, model_id: credential.model })
}

#[cfg(feature = "e2e")]
fn provider_and_model(capability: &str) -> Option<(&'static str, &'static str)> {
  match capability {
    TEXT_REASONING => Some((DEEPSEEK, "deepseek-chat")),
    SEMANTIC_INTENT_ROUTING => Some((DEEPSEEK, "deepseek-chat")),
    VISION_ANALYSIS => Some((QWEN_VISION, "qwen-vl-plus")),
    _ => None,
  }
}

fn health_binding(capability: &str, credential: &crate::encrypted_credentials::RuntimeCredential) -> TrustedHostCapabilityRequest {
  TrustedHostCapabilityRequest {
    capability: capability.into(), provider_kind: credential.provider_kind.clone(), model_id: credential.model.clone(), customer_id: "connection-test".into(),
    context_snapshot_id: "connection-test".into(), workflow_kind: "provider_health".into(), profile_id: "connection-test".into(), requested_by_user: true,
  }
}

fn validate_binding(request: &TrustedHostCapabilityRequest) -> Result<(), TrustedHostBlockedResult> {
  if !request.requested_by_user { return Err(blocked("explicit_user_action_required")); }
  if request.customer_id.trim().is_empty() || request.context_snapshot_id.trim().is_empty() || request.workflow_kind.trim().is_empty() || request.profile_id.trim().is_empty() || request.model_id.trim().is_empty() {
    return Err(blocked("incomplete_authorization_binding"));
  }
  if ![TEXT_REASONING, SEMANTIC_INTENT_ROUTING, VISION_ANALYSIS].contains(&request.capability.as_str()) { return Err(blocked("unsupported_capability_provider")); }
  #[cfg(feature = "e2e")]
  {
    let (provider, model) = provider_and_model(&request.capability).ok_or_else(|| blocked("unsupported_capability_provider"))?;
    if request.provider_kind != provider || request.model_id != model { return Err(blocked("unsupported_capability_provider")); }
  }
  Ok(())
}

fn build_provider_request(binding: &TrustedHostCapabilityRequest, model: &str, input: &Value, request_id: &str) -> Result<Value, TrustedHostBlockedResult> {
  if binding.capability == SEMANTIC_INTENT_ROUTING {
    let instruction = input.get("instruction").and_then(Value::as_str).filter(|value| !value.trim().is_empty())
      .ok_or_else(|| blocked("invalid_semantic_intent_input"))?;
    let schema = input.get("schema").and_then(Value::as_str);
    let envelope_id = input.get("envelope_id").and_then(Value::as_str).filter(|value| !value.trim().is_empty());
    if schema != Some("semantic_intent_v1") || envelope_id.is_none() || input.as_object().is_none_or(|object| {
      object.len() != 4 || object.keys().any(|key| !["capability", "schema", "instruction", "envelope_id"].contains(&key.as_str()))
    }) { return Err(blocked("invalid_semantic_intent_input")); }
    return Ok(json!({
      "model": model, "stream": false, "temperature": 0, "user": request_id,
      "messages": [
        {"role":"system","content":"Classify only into semantic_intent_v1. Return exactly intent, filters, entities, scope, missing_fields, confidence, clarification_question. Allowed intents: CUSTOMER_SUMMARY, CUSTOMER_RISK_ANALYSIS, NEXT_ACTION_RECOMMENDATION, FOLLOW_UP_DRAFT, INTERACTION_SUMMARY, COMPLEX_CUSTOMER_COMPARE, IMAGE_CAPTURE_ANALYSIS, CUSTOMER_PRIORITY_RANKING, CLARIFICATION_REQUIRED, UNSUPPORTED. filters must be string-only; entities contain only type and value. Never return SQL, guessed customer IDs, tool IDs, proposals, write payloads, confirmations, CRM mutations, or executable actions."},
        {"role":"user","content":json!({"envelope_id":envelope_id,"instruction":instruction}).to_string()}
      ]
    }));
  }
  if binding.capability == TEXT_REASONING {
    let attempt = input.get("attempt").and_then(Value::as_str).unwrap_or("initial");
    let repair = if attempt == "repair" { " This is the single allowed repair attempt; correct only the listed validation errors without changing intent or evidence IDs." } else { "" };
    return Ok(json!({
      "model": model, "stream": false, "temperature": 0, "user": request_id,
      "messages": [
        {"role":"system","content":format!("Return only JSON matching the requested closed schema. Cite only provided evidence_ids. Never execute actions, write CRM data, generate SQL, or invent evidence.{repair}")},
        {"role":"user","content":input.to_string()}
      ]
    }));
  }
  if binding.capability != VISION_ANALYSIS { return Err(blocked("unsupported_capability_provider")); }
  let vision = parse_vision_input(input)?;
  let data_url = format!("data:{};base64,{}", vision.mime_type, vision.base64);
  Ok(json!({
    "model": model, "stream": false, "temperature": 0, "user": request_id,
    "messages": [
      {"role":"system","content":"Return only image_capture_analysis_v1 JSON: extracted_facts, source_reference, confidence, evidence_regions, unsupported_assumptions, requires_fact_review=true. fact_type must be one of extracted_text, visible_product_attribute, company_contact_information, visible_requirement, visible_objection, document_field, date_quantity_specification, manual_review_required. Do not recommend actions."},
      {"role":"user","content":[
        {"type":"text","text":"Extract only visible customer facts. Every fact needs a visual source_reference and evidence region."},
        {"type":"image_url","image_url":{"url":data_url}}
      ]}
    ]
  }))
}

#[derive(Debug)]
struct ValidatedVisionInput { mime_type: String, base64: String, source_reference: String }

fn parse_vision_input(input: &Value) -> Result<ValidatedVisionInput, TrustedHostBlockedResult> {
  let object = input.get("vision_request").and_then(Value::as_object).ok_or_else(|| blocked("invalid_vision_input"))?;
  if object.keys().any(|key| !["mime_type", "image_base64", "source_reference"].contains(&key.as_str())) { return Err(blocked("invalid_vision_input")); }
  let mime = object.get("mime_type").and_then(Value::as_str).ok_or_else(|| blocked("invalid_image_mime"))?;
  if !["image/jpeg", "image/png", "image/webp"].contains(&mime) { return Err(blocked("invalid_image_mime")); }
  let encoded = object.get("image_base64").and_then(Value::as_str).ok_or_else(|| blocked("invalid_image_payload"))?;
  if encoded.len() > MAX_IMAGE_BYTES * 2 { return Err(blocked("image_too_large")); }
  let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| blocked("corrupt_image"))?;
  if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return Err(blocked("image_too_large")); }
  let format = image::guess_format(&bytes).map_err(|_| blocked("corrupt_image"))?;
  let detected_mime = match format { ImageFormat::Jpeg => "image/jpeg", ImageFormat::Png => "image/png", ImageFormat::WebP => "image/webp", _ => return Err(blocked("invalid_image_mime")) };
  if detected_mime != mime { return Err(blocked("spoofed_image_mime")); }
  classify_vision_format(&bytes, format)?;
  if format == ImageFormat::WebP && bytes.len() >= 21 && &bytes[12..16] == b"VP8X" && bytes[20] & 0x02 != 0 { return Err(blocked("animated_image_not_supported")); }
  if format == ImageFormat::Png && bytes.windows(4).any(|chunk| chunk == b"acTL") { return Err(blocked("animated_image_not_supported")); }
  let (width, height) = ImageReader::with_format(Cursor::new(&bytes), format).into_dimensions().map_err(|_| blocked("corrupt_image"))?;
  if width == 0 || height == 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS { return Err(blocked("image_dimensions_exceeded")); }
  ImageReader::with_format(Cursor::new(&bytes), format).decode().map_err(|_| blocked("corrupt_image"))?;
  let source_reference = format!("image:sha256:{:x}", Sha256::digest(&bytes));
  let _orientation_policy = VISION_EXIF_ORIENTATION_POLICY; // Original bytes are passed through unchanged.
  Ok(ValidatedVisionInput { mime_type: mime.into(), base64: encoded.into(), source_reference })
}

fn classify_vision_format(bytes: &[u8], format: ImageFormat) -> Result<&'static str, TrustedHostBlockedResult> {
  match format {
    ImageFormat::Jpeg if bytes.windows(2).any(|marker| marker == [0xff, 0xc2]) => Ok("JPEG_PROGRESSIVE"),
    ImageFormat::Jpeg if bytes.windows(2).any(|marker| marker == [0xff, 0xc0]) => Ok("JPEG_BASELINE"),
    ImageFormat::Jpeg => Err(blocked("unsupported_jpeg_encoding")),
    ImageFormat::Png => Ok("PNG"),
    ImageFormat::WebP if bytes.get(12..16) == Some(b"VP8 ") => Ok("WEBP_LOSSY"),
    ImageFormat::WebP if bytes.get(12..16) == Some(b"VP8L") => Ok("WEBP_LOSSLESS"),
    ImageFormat::WebP if bytes.get(12..16) == Some(b"VP8X") => Ok("WEBP_EXTENDED"),
    ImageFormat::WebP => Err(blocked("unsupported_webp_encoding")),
    _ => Err(blocked("invalid_image_mime")),
  }
}

async fn send_with_bounded_retry(client: reqwest::Client, credential: HostProviderCredential, body: Value) -> Result<Value, TrustedHostBlockedResult> {
  let mut attempt = 0;
  loop {
    match send_once(&client, &credential, &body).await {
      Ok(payload) => return Ok(payload),
      Err(error) => {
        let retryable = ["host_provider_request_failed", "timeout", "host_provider_5xx"].contains(&error.reason);
        if !retryable || attempt >= MAX_RETRIES { return Err(error); }
        attempt += 1;
      }
    }
  }
}

async fn send_once(client: &reqwest::Client, credential: &HostProviderCredential, body: &Value) -> Result<Value, TrustedHostBlockedResult> {
  let mut response = client.post(&credential.endpoint).bearer_auth(credential.api_key.as_str()).json(body).send().await.map_err(|error| {
    if error.is_timeout() { blocked("timeout") } else { blocked("host_provider_request_failed") }
  })?;
  let status = response.status().as_u16();
  if status == 401 || status == 403 { return Err(blocked("unauthorized")); }
  if status == 429 { return Err(blocked("rate_limited")); }
  if status >= 500 { return Err(blocked("host_provider_5xx")); }
  if !response.status().is_success() { return Err(blocked("host_provider_response_rejected")); }
  if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err(blocked("response_too_large")); }
  let mut bytes = Vec::new();
  while let Some(chunk) = response.chunk().await.map_err(|_| blocked("host_provider_invalid_response"))? {
    if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES { return Err(blocked("response_too_large")); }
    bytes.extend_from_slice(&chunk);
  }
  serde_json::from_slice(&bytes).map_err(|_| blocked("host_provider_invalid_response"))
}

fn extract_output(binding: &TrustedHostCapabilityRequest, payload: Value, host_vision_source: Option<&str>) -> Result<Value, TrustedHostBlockedResult> {
  let content = payload.get("choices").and_then(Value::as_array).and_then(|choices| choices.first())
    .and_then(|choice| choice.get("message")).and_then(|message| message.get("content")).and_then(Value::as_str)
    .ok_or_else(|| blocked("host_provider_invalid_response"))?;
  if content.as_bytes().len() > MAX_RESPONSE_BYTES { return Err(blocked("response_too_large")); }
  let mut parsed: Value = serde_json::from_str(content).map_err(|_| blocked("host_provider_invalid_json"))?;
  if binding.capability == SEMANTIC_INTENT_ROUTING {
    validate_semantic_intent_output(&parsed)?;
  }
  if binding.capability == VISION_ANALYSIS {
    validate_vision_output(&parsed)?;
    let bound = host_vision_source.ok_or_else(|| blocked("vision_source_binding_missing"))?;
    parsed["source_reference"] = Value::String(bound.into());
    if let Some(facts) = parsed.get_mut("extracted_facts").and_then(Value::as_array_mut) {
      for fact in facts { fact["source_reference"] = Value::String(bound.into()); }
    }
  }
  Ok(parsed)
}

fn validate_semantic_intent_output(value: &Value) -> Result<(), TrustedHostBlockedResult> {
  let object = value.as_object().ok_or_else(|| blocked("host_provider_invalid_semantic_intent"))?;
  let allowed = ["intent", "filters", "entities", "scope", "missing_fields", "confidence", "clarification_question"];
  if object.len() != allowed.len() || object.keys().any(|key| !allowed.contains(&key.as_str())) {
    return Err(blocked("host_provider_invalid_semantic_intent"));
  }
  let intents = ["CUSTOMER_SUMMARY", "CUSTOMER_RISK_ANALYSIS", "NEXT_ACTION_RECOMMENDATION", "FOLLOW_UP_DRAFT", "INTERACTION_SUMMARY", "COMPLEX_CUSTOMER_COMPARE", "IMAGE_CAPTURE_ANALYSIS", "CUSTOMER_PRIORITY_RANKING", "CLARIFICATION_REQUIRED", "UNSUPPORTED"];
  if !object.get("intent").and_then(Value::as_str).is_some_and(|intent| intents.contains(&intent))
    || !valid_confidence(object.get("confidence"))
    || !object.get("filters").and_then(Value::as_object).is_some_and(|filters| filters.iter().all(|(key, item)| !key.is_empty() && item.is_string()))
    || !object.get("entities").and_then(Value::as_array).is_some_and(|entities| entities.iter().all(|entity| entity.as_object().is_some_and(|entry| entry.len() == 2 && entry.get("type").is_some_and(Value::is_string) && entry.get("value").is_some_and(Value::is_string))))
    || !object.get("scope").is_some_and(|item| item.is_null() || item.is_string())
    || !object.get("missing_fields").and_then(Value::as_array).is_some_and(|fields| fields.iter().all(Value::is_string))
    || !object.get("clarification_question").is_some_and(|item| item.is_null() || item.is_string())
  {
    return Err(blocked("host_provider_invalid_semantic_intent"));
  }
  Ok(())
}

fn validate_vision_output(value: &Value) -> Result<(), TrustedHostBlockedResult> {
  let object = value.as_object().ok_or_else(|| blocked("host_provider_invalid_vision_output"))?;
  let allowed = ["extracted_facts", "source_reference", "confidence", "evidence_regions", "unsupported_assumptions", "requires_fact_review"];
  if object.len() != allowed.len() || object.keys().any(|key| !allowed.contains(&key.as_str())) { return Err(blocked("host_provider_invalid_vision_output")); }
  if object.get("requires_fact_review") != Some(&Value::Bool(true)) || !valid_text(object.get("source_reference"), 500) { return Err(blocked("host_provider_invalid_vision_output")); }
  if !valid_confidence(object.get("confidence")) || !valid_string_array(object.get("evidence_regions"), 1, 20) || !valid_string_array(object.get("unsupported_assumptions"), 0, 12) { return Err(blocked("host_provider_invalid_vision_output")); }
  let facts = object.get("extracted_facts").and_then(Value::as_array).filter(|items| !items.is_empty() && items.len() <= 20).ok_or_else(|| blocked("host_provider_invalid_vision_output"))?;
  let allowed_fact_types = ["extracted_text", "visible_product_attribute", "company_contact_information", "visible_requirement", "visible_objection", "document_field", "date_quantity_specification", "manual_review_required"];
  for fact in facts {
    let record = fact.as_object().ok_or_else(|| blocked("host_provider_invalid_vision_output"))?;
    let keys = ["fact_id", "fact_type", "content", "source_reference", "confidence"];
    if record.len() != keys.len() || record.keys().any(|key| !keys.contains(&key.as_str()))
      || !valid_text(record.get("fact_id"), 240)
      || !record.get("fact_type").and_then(Value::as_str).is_some_and(|value| allowed_fact_types.contains(&value))
      || !valid_text(record.get("content"), 4000) || !valid_text(record.get("source_reference"), 500)
      || !valid_confidence(record.get("confidence")) { return Err(blocked("host_provider_invalid_vision_output")); }
  }
  Ok(())
}

fn valid_text(value: Option<&Value>, max: usize) -> bool { value.and_then(Value::as_str).is_some_and(|text| !text.trim().is_empty() && text.len() <= max) }
fn valid_confidence(value: Option<&Value>) -> bool { value.and_then(Value::as_f64).is_some_and(|number| number.is_finite() && (0.0..=1.0).contains(&number)) }
fn valid_string_array(value: Option<&Value>, min: usize, max: usize) -> bool {
  value.and_then(Value::as_array).is_some_and(|items| items.len() >= min && items.len() <= max && items.iter().all(|item| valid_text(Some(item), 500)))
}

fn extract_token_usage(payload: &Value) -> Option<TrustedHostTokenUsage> {
  let usage = payload.get("usage")?;
  Some(TrustedHostTokenUsage {
    prompt_tokens: usage.get("prompt_tokens").and_then(Value::as_u64),
    completion_tokens: usage.get("completion_tokens").and_then(Value::as_u64),
    total_tokens: usage.get("total_tokens").and_then(Value::as_u64),
  })
}

fn blocked(reason: &'static str) -> TrustedHostBlockedResult { TrustedHostBlockedResult { state: "blocked", reason } }
fn next_authorization_id() -> String { Uuid::new_v4().to_string() }
fn iso_now() -> String { Utc::now().to_rfc3339() }

#[cfg(test)]
mod tests {
  use super::*;
  use image::{ExtendedColorType, ImageEncoder};

  fn binding(capability: &str) -> TrustedHostCapabilityRequest {
    let (provider, model) = if capability == VISION_ANALYSIS { ("QWEN_VISION_COMPATIBLE", "qwen-vl-plus") } else { ("DEEPSEEK_COMPATIBLE", "deepseek-chat") };
    TrustedHostCapabilityRequest { capability: capability.into(), provider_kind: provider.into(), model_id: model.into(), customer_id: "connection-test".into(), context_snapshot_id: "connection-test".into(), workflow_kind: "provider_health".into(), profile_id: "connection-test".into(), requested_by_user: true }
  }

  #[test]
  fn visual_request_contains_real_image_content_part() {
    let input = json!({"vision_request":{"mime_type":"image/png","image_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","source_reference":"selected-image"}});
    let body = build_provider_request(&binding(VISION_ANALYSIS), "qwen-vl-plus", &input, "request-1").unwrap();
    let content = &body["messages"][1]["content"];
    assert!(content.is_array());
    assert_eq!(content[1]["type"], "image_url");
    assert!(content[1]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,"));
    assert!(!content[0]["text"].as_str().unwrap().contains("data:image"));
  }

  #[test]
  fn image_mime_corruption_and_size_are_rejected() {
    let spoofed = json!({"vision_request":{"mime_type":"image/jpeg","image_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","source_reference":"x"}});
    assert_eq!(parse_vision_input(&spoofed).unwrap_err(), blocked("spoofed_image_mime"));
    let corrupt = json!({"vision_request":{"mime_type":"image/png","image_base64":"bm90LWltYWdl","source_reference":"x"}});
    assert_eq!(parse_vision_input(&corrupt).unwrap_err(), blocked("corrupt_image"));
  }

  #[test]
  fn full_image_decode_supports_jpeg_png_webp_and_rejects_truncation() {
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg).encode(&[255, 0, 0], 1, 1, ExtendedColorType::Rgb8).unwrap();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png).write_image(&[0, 255, 0, 255], 1, 1, ExtendedColorType::Rgba8).unwrap();
    let mut webp_lossless = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp_lossless).encode(&[0, 0, 255, 255], 1, 1, ExtendedColorType::Rgba8).unwrap();
    for (mime, bytes) in [("image/jpeg", jpeg), ("image/png", png), ("image/webp", webp_lossless)] {
      let input = json!({"vision_request":{"mime_type":mime,"image_base64":base64::engine::general_purpose::STANDARD.encode(&bytes),"source_reference":"untrusted-client-label"}});
      let parsed = parse_vision_input(&input).unwrap();
      assert!(parsed.source_reference.starts_with("image:sha256:"));
      let truncated = &bytes[..bytes.len() / 2];
      let bad = json!({"vision_request":{"mime_type":mime,"image_base64":base64::engine::general_purpose::STANDARD.encode(truncated),"source_reference":"x"}});
      assert!(parse_vision_input(&bad).is_err());
    }
  }

  #[test]
  fn vision_format_matrix_decodes_progressive_jpeg_lossy_webp_and_extended_webp() {
    let progressive = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABigy4/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";
    let lossy = "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=";
    let extended = "UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggMAAAANABAJ0BKgIAAgABQCYloAJ0ugH4AAOwAP7y63/82BXNc+/3/9Lg/S4P0uD/0pAAAA==";
    for (mime, encoded, expected) in [
      ("image/jpeg", progressive, "JPEG_PROGRESSIVE"),
      ("image/webp", lossy, "WEBP_LOSSY"),
      ("image/webp", extended, "WEBP_EXTENDED"),
    ] {
      let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
      let format = image::guess_format(&bytes).unwrap();
      assert_eq!(classify_vision_format(&bytes, format), Ok(expected));
      let input = json!({"vision_request":{"mime_type":mime,"image_base64":encoded,"source_reference":"client-label"}});
      let parsed = parse_vision_input(&input).unwrap();
      let body = build_provider_request(&binding(VISION_ANALYSIS), "qwen-vl-plus", &input, "format-matrix").unwrap();
      assert!(body.to_string().contains(encoded));
      assert_eq!(VISION_EXIF_ORIENTATION_POLICY, "preserve_original_encoded_orientation");
      assert!(parsed.source_reference.starts_with("image:sha256:"));
    }
  }

  #[test]
  fn vision_source_reference_is_host_bound_not_provider_owned() {
    let model = json!({"extracted_facts":[{"fact_id":"f1","fact_type":"extracted_text","content":"hello","source_reference":"forged-image-b","confidence":0.9}],"source_reference":"forged-image-b","confidence":0.9,"evidence_regions":["region:1"],"unsupported_assumptions":[],"requires_fact_review":true});
    let payload = json!({"choices":[{"message":{"content":model.to_string()}}]});
    let bound = extract_output(&binding(VISION_ANALYSIS), payload, Some("image:sha256:trusted-a")).unwrap();
    assert_eq!(bound["source_reference"], "image:sha256:trusted-a");
    assert_eq!(bound["extracted_facts"][0]["source_reference"], "image:sha256:trusted-a");
  }

  #[test]
  fn vision_output_is_closed() {
    let valid = json!({"extracted_facts":[{"fact_id":"f1","fact_type":"extracted_text","content":"hello","source_reference":"region:1","confidence":0.9}],"source_reference":"selected-image","confidence":0.9,"evidence_regions":["region:1"],"unsupported_assumptions":[],"requires_fact_review":true});
    assert_eq!(validate_vision_output(&valid), Ok(()));
    let mut extra = valid.as_object().unwrap().clone(); extra.insert("recommendation".into(), json!("call"));
    assert_eq!(validate_vision_output(&Value::Object(extra)), Err(blocked("host_provider_invalid_vision_output")));
  }

  #[tokio::test]
  async fn cancellation_aborts_task_cleans_registry_and_allows_next_request() {
    let state = TrustedHostState::default();
    let task = tokio::spawn(async { std::future::pending::<()>().await });
    state.registry.lock().unwrap().entries.insert("request-1".into(), RequestEntry {
      state: RequestState::Active,
      binding: Some(binding(TEXT_REASONING)),
      abort_handle: Some(task.abort_handle()),
      cancellation_token: Some(ProviderCancellationToken::default()),
      state_changed_at: Instant::now(),
      terminal_at: None,
    });
    assert_eq!(cancel_request(&state, "request-1"), Ok(true));
    assert!(task.await.unwrap_err().is_cancelled());
    assert_eq!(state.registry.lock().unwrap().entries["request-1"].state, RequestState::Cancelled);
    assert_eq!(cancel_request(&state, "completed-request"), Ok(false));
    let second = tokio::spawn(async { 7 });
    assert_eq!(second.await.unwrap(), 7);
  }

  #[test]
  fn request_registry_race_covers_authorized_starting_terminal_and_duplicate_states() {
    let state = TrustedHostState::default();
    for (id, request_state) in [("authorized", RequestState::Authorized), ("starting", RequestState::Starting)] {
      state.registry.lock().unwrap().entries.insert(id.into(), RequestEntry {
        state: request_state, binding: Some(binding(TEXT_REASONING)), abort_handle: None, cancellation_token: None, state_changed_at: Instant::now(), terminal_at: None,
      });
      assert_eq!(cancel_request(&state, id), Ok(true));
      assert_eq!(state.registry.lock().unwrap().entries[id].state, RequestState::Cancelled);
      assert_eq!(cancel_request(&state, id), Ok(true));
    }
    state.registry.lock().unwrap().entries.insert("done".into(), RequestEntry {
      state: RequestState::Completed, binding: None, abort_handle: None, cancellation_token: None, state_changed_at: Instant::now(), terminal_at: Some(Instant::now()),
    });
    assert_eq!(cancel_request(&state, "done"), Ok(false));
  }

  #[test]
  fn request_registry_bounds_tombstones_and_expires_them() {
    let mut registry = RequestRegistry::default();
    let now = Instant::now();
    for index in 0..(REQUEST_TOMBSTONE_MAX + 40) {
      registry.entries.insert(format!("done-{index}"), RequestEntry {
        state: RequestState::Completed, binding: None, abort_handle: None, cancellation_token: None, state_changed_at: now, terminal_at: Some(now),
      });
    }
    registry.cleanup(now);
    assert!(registry.entries.len() <= REQUEST_TOMBSTONE_MAX);
    registry.entries.insert("expired".into(), RequestEntry {
      state: RequestState::Cancelled, binding: None, abort_handle: None, cancellation_token: None,
      state_changed_at: now,
      terminal_at: Some(now - REQUEST_TOMBSTONE_TTL - Duration::from_secs(1)),
    });
    registry.cleanup(now);
    assert!(!registry.entries.contains_key("expired"));
  }

  #[test]
  fn request_registry_enforces_global_capacity_duplicate_ids_and_all_state_ttls() {
    let now = Instant::now();
    let mut registry = RequestRegistry::default();
    registry.reserve_authorized("duplicate".into(), binding(TEXT_REASONING), now).unwrap();
    assert_eq!(registry.reserve_authorized("duplicate".into(), binding(TEXT_REASONING), now), Err(blocked("duplicate_request_id")));

    for index in 1..REQUEST_REGISTRY_MAX {
      registry.entries.insert(format!("active-{index}"), RequestEntry {
        state: RequestState::Active, binding: Some(binding(TEXT_REASONING)), abort_handle: None, cancellation_token: None,
        state_changed_at: now, terminal_at: None,
      });
    }
    assert_eq!(registry.reserve_authorized("overflow".into(), binding(TEXT_REASONING), now), Err(blocked("request_registry_capacity_reached")));
    assert_eq!(registry.entries.values().filter(|entry| entry.state == RequestState::Active).count(), REQUEST_REGISTRY_MAX - 1);

    let mut lifecycle = RequestRegistry::default();
    for (id, state, age) in [
      ("authorized-expired", RequestState::Authorized, AUTHORIZED_TTL),
      ("starting-expired", RequestState::Starting, STARTING_TIMEOUT),
      ("active-expired", RequestState::Active, ACTIVE_REQUEST_TIMEOUT),
    ] {
      lifecycle.entries.insert(id.into(), RequestEntry {
        state, binding: Some(binding(TEXT_REASONING)), abort_handle: None, cancellation_token: None,
        state_changed_at: now - age - Duration::from_secs(1), terminal_at: None,
      });
    }
    lifecycle.cleanup(now);
    assert!(lifecycle.entries.values().all(|entry| entry.state == RequestState::Failed && entry.terminal_at.is_some()));
  }

  #[tokio::test]
  async fn real_concurrent_cancel_blocks_response_parse_schema_evidence_retry_timeout_and_capture_commits() {
    use std::sync::Arc;
    use tokio::sync::{Barrier, Notify};

    for phase in ["response", "parse", "schema", "evidence", "retry", "timeout", "capture"] {
      let state = Arc::new(TrustedHostState::default());
      let request_id = format!("race-{phase}");
      state.registry.lock().unwrap().entries.insert(request_id.clone(), RequestEntry {
        state: RequestState::Active, binding: Some(binding(TEXT_REASONING)), abort_handle: None, cancellation_token: None,
        state_changed_at: Instant::now(), terminal_at: None,
      });
      let barrier = Arc::new(Barrier::new(2));
      let cancelled = Arc::new(Notify::new());
      let cancel_state = Arc::clone(&state);
      let cancel_id = request_id.clone();
      let cancel_barrier = Arc::clone(&barrier);
      let cancel_notify = Arc::clone(&cancelled);
      let cancel_task = tokio::spawn(async move {
        cancel_barrier.wait().await;
        assert_eq!(cancel_request(&cancel_state, &cancel_id), Ok(true));
        cancel_notify.notify_one();
      });
      let commit_state = Arc::clone(&state);
      let commit_id = request_id.clone();
      let commit_barrier = Arc::clone(&barrier);
      let commit_notify = Arc::clone(&cancelled);
      let commit_task = tokio::spawn(async move {
        commit_barrier.wait().await;
        commit_notify.notified().await;
        assert_eq!(assert_request_commit_allowed(&commit_state, &commit_id), Err(blocked("cancelled")));
      });
      cancel_task.await.unwrap();
      commit_task.await.unwrap();
      assert_eq!(state.registry.lock().unwrap().entries[&request_id].state, RequestState::Cancelled);
    }
  }

  #[cfg(feature = "e2e")]
  fn semantic_execution_request(request_id: &str, instruction: &str) -> TrustedHostExecutionRequest {
    TrustedHostExecutionRequest {
      authorization_id: request_id.into(),
      binding: binding(SEMANTIC_INTENT_ROUTING),
      input: json!({
        "capability": SEMANTIC_INTENT_ROUTING,
        "schema": "semantic_intent_v1",
        "instruction": instruction,
        "envelope_id": format!("envelope-{request_id}"),
      }),
    }
  }

  #[cfg(feature = "e2e")]
  fn reserve_starting(state: &TrustedHostState, request: &TrustedHostExecutionRequest) {
    let mut registry = state.registry.lock().unwrap();
    registry.reserve_authorized(request.authorization_id.clone(), request.binding.clone(), Instant::now()).unwrap();
    let entry = registry.entries.get_mut(&request.authorization_id).unwrap();
    entry.state = RequestState::Starting;
    entry.state_changed_at = Instant::now();
  }

  #[cfg(feature = "e2e")]
  #[tokio::test]
  async fn provider_transport_equivalence_uses_shared_request_raw_response_extract_and_semantic_validation() {
    let state = TrustedHostState::default();
    let request = semantic_execution_request("transport-equivalence", "请概括这个客户");
    reserve_starting(&state, &request);
    let result = execute_provider_pipeline(
      request,
      &state,
      DeterministicFakeNetworkTransport,
      DEEPSEEK_ENDPOINT.to_string(),
      "deepseek-chat".to_string(),
      None,
    ).await.unwrap();
    assert_eq!(result.output["intent"], "CUSTOMER_SUMMARY");
    assert_eq!(result.output["filters"], json!({}));
    assert_eq!(result.output["entities"], json!([]));
    assert_eq!(state.registry.lock().unwrap().entries["transport-equivalence"].state, RequestState::Completed);
  }

  #[cfg(feature = "e2e")]
  #[tokio::test]
  async fn real_vision_pipeline_decodes_builds_visual_body_extracts_and_host_binds_source() {
    let state = TrustedHostState::default();
    let request = TrustedHostExecutionRequest {
      authorization_id: "vision-equivalence".into(),
      binding: binding(VISION_ANALYSIS),
      input: json!({"vision_request":{
        "mime_type":"image/png",
        "image_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "source_reference":"untrusted-front-end-reference"
      }}),
    };
    reserve_starting(&state, &request);
    let expected_source = parse_vision_input(&request.input).unwrap().source_reference;
    let result = execute_provider_pipeline(
      request,
      &state,
      DeterministicFakeNetworkTransport,
      QWEN_VISION_ENDPOINT.to_string(),
      "qwen-vl-plus".to_string(),
      None,
    ).await.unwrap();
    assert_eq!(result.output["source_reference"], expected_source);
    assert_eq!(result.output["extracted_facts"][0]["source_reference"], expected_source);
    assert_ne!(result.output["source_reference"], "provider-forged-source-reference");
  }

  #[cfg(feature = "e2e")]
  #[tokio::test]
  async fn invalid_schema_and_malformed_json_are_blocked_after_raw_fake_response() {
    for (request_id, marker, expected) in [
      ("invalid-schema", "E2E_INVALID_SCHEMA", blocked("host_provider_invalid_semantic_intent")),
      ("malformed-json", "E2E_MALFORMED_JSON", blocked("host_provider_invalid_response")),
    ] {
      let state = TrustedHostState::default();
      let request = semantic_execution_request(request_id, marker);
      reserve_starting(&state, &request);
      let error = execute_provider_pipeline(
        request,
        &state,
        DeterministicFakeNetworkTransport,
        DEEPSEEK_ENDPOINT.to_string(),
        "deepseek-chat".to_string(),
        None,
      ).await.unwrap_err();
      assert_eq!(error, expected);
    }
  }

  #[cfg(feature = "e2e")]
  #[tokio::test]
  async fn cancellation_late_response_is_rejected_and_next_request_succeeds() {
    let state = Arc::new(TrustedHostState::default());
    let late_request = semantic_execution_request("late-cancel", "E2E_LATE_RESPONSE_AFTER_CANCEL 请概括客户");
    reserve_starting(&state, &late_request);
    let task_state = Arc::clone(&state);
    let task = tokio::spawn(async move {
      execute_provider_pipeline(
        late_request,
        &task_state,
        DeterministicFakeNetworkTransport,
        DEEPSEEK_ENDPOINT.to_string(),
        "deepseek-chat".to_string(),
        None,
      ).await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(cancel_request(&state, "late-cancel"), Ok(true));
    assert_eq!(task.await.unwrap(), Err(blocked("cancelled")));
    assert_eq!(state.registry.lock().unwrap().entries["late-cancel"].state, RequestState::Cancelled);

    let next_request = semantic_execution_request("after-cancel", "请概括这个客户");
    reserve_starting(&state, &next_request);
    let next = execute_provider_pipeline(
      next_request,
      &state,
      DeterministicFakeNetworkTransport,
      DEEPSEEK_ENDPOINT.to_string(),
      "deepseek-chat".to_string(),
      None,
    ).await.unwrap();
    assert_eq!(next.output["intent"], "CUSTOMER_SUMMARY");
    assert_eq!(state.registry.lock().unwrap().entries["after-cancel"].state, RequestState::Completed);
  }

  #[test]
  fn timeout_retry_and_size_contracts_are_bounded() {
    assert!((60..=90).contains(&REQUEST_TIMEOUT_SECS));
    assert_eq!(MAX_RETRIES, 1);
    assert!(MAX_RESPONSE_BYTES <= 96_000);
    assert!(MAX_IMAGE_BYTES <= 8 * 1024 * 1024);
  }
}
