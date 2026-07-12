use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

const TEXT_REASONING: &str = "TEXT_REASONING";
const VISION_ANALYSIS: &str = "VISION_ANALYSIS";
const DEEPSEEK: &str = "DEEPSEEK_COMPATIBLE";
const QWEN_VISION: &str = "QWEN_VISION_COMPATIBLE";

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
pub struct TrustedHostBlockedResult {
  pub state: &'static str,
  pub reason: &'static str,
}

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
pub struct TrustedHostCompletionResult {
  pub state: &'static str,
  pub provider_kind: String,
  pub model_id: String,
  pub output: Value,
}

#[derive(Default)]
pub struct HostAuthorizationStore {
  pending: Mutex<HashMap<String, TrustedHostCapabilityRequest>>,
}

struct HostProviderCredential {
  endpoint: String,
  api_key: String,
  model_id: String,
}

trait HostSecretResolver {
  fn resolve(&self, request: &TrustedHostCapabilityRequest) -> Result<HostProviderCredential, TrustedHostBlockedResult>;
}

struct EnvironmentSecretResolver;

impl HostSecretResolver for EnvironmentSecretResolver {
  fn resolve(&self, request: &TrustedHostCapabilityRequest) -> Result<HostProviderCredential, TrustedHostBlockedResult> {
    let (key_name, endpoint_name, model_name, default_endpoint, default_model) = match (request.capability.as_str(), request.provider_kind.as_str()) {
      (TEXT_REASONING, DEEPSEEK) => ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "https://api.deepseek.com/chat/completions", "deepseek-chat"),
      (VISION_ANALYSIS, QWEN_VISION) => ("QWEN_VISION_API_KEY", "QWEN_VISION_BASE_URL", "QWEN_VISION_MODEL", "", "qwen-vl-plus"),
      _ => return Err(blocked("unsupported_capability_provider")),
    };
    let api_key = std::env::var(key_name).unwrap_or_default();
    let endpoint = std::env::var(endpoint_name).unwrap_or_else(|_| default_endpoint.to_string());
    let model_id = std::env::var(model_name).unwrap_or_else(|_| default_model.to_string());
  if api_key.trim().is_empty() || endpoint.trim().is_empty() || model_id.trim().is_empty() || request.model_id != model_id {
      return Err(blocked("missing_host_provider"));
    }
    if !endpoint.starts_with("https://") {
      return Err(blocked("invalid_host_endpoint"));
    }
    Ok(HostProviderCredential { endpoint, api_key, model_id })
  }
}

#[tauri::command]
pub fn authorize_model_capability(
  request: TrustedHostCapabilityRequest,
  store: State<'_, HostAuthorizationStore>,
) -> Result<TrustedHostAuthorizationResult, TrustedHostBlockedResult> {
  validate_binding(&request)?;
  let credential = EnvironmentSecretResolver.resolve(&request)?;
  let authorization_id = next_authorization_id();
  store.pending.lock().map_err(|_| blocked("authorization_store_unavailable"))?
    .insert(authorization_id.clone(), request.clone());
  Ok(TrustedHostAuthorizationResult {
    state: "authorized",
    authorization_id,
    capability: request.capability,
    provider_kind: request.provider_kind,
    model_id: credential.model_id,
  })
}

#[tauri::command]
pub async fn execute_model_capability(
  request: TrustedHostExecutionRequest,
  store: State<'_, HostAuthorizationStore>,
) -> Result<TrustedHostCompletionResult, TrustedHostBlockedResult> {
  validate_binding(&request.binding)?;
  let stored = store.pending.lock().map_err(|_| blocked("authorization_store_unavailable"))?
    .remove(&request.authorization_id)
    .ok_or_else(|| blocked("missing_or_reused_authorization"))?;
  if stored != request.binding {
    return Err(blocked("authorization_binding_mismatch"));
  }
  let credential = EnvironmentSecretResolver.resolve(&request.binding)?;
  let body = build_provider_request(&request.binding, &credential.model_id, request.input)?;
  let response = reqwest::Client::new()
    .post(&credential.endpoint)
    .bearer_auth(&credential.api_key)
    .json(&body)
    .timeout(std::time::Duration::from_secs(20))
    .send().await.map_err(|_| blocked("host_provider_request_failed"))?;
  if !response.status().is_success() {
    return Err(blocked("host_provider_response_rejected"));
  }
  let payload: Value = response.json().await.map_err(|_| blocked("host_provider_invalid_response"))?;
  let output = extract_output(&request.binding, payload)?;
  Ok(TrustedHostCompletionResult {
    state: "completed",
    provider_kind: request.binding.provider_kind,
    model_id: credential.model_id,
    output,
  })
}

fn validate_binding(request: &TrustedHostCapabilityRequest) -> Result<(), TrustedHostBlockedResult> {
  if !request.requested_by_user { return Err(blocked("explicit_user_action_required")); }
  if request.customer_id.trim().is_empty() || request.context_snapshot_id.trim().is_empty() || request.workflow_kind.trim().is_empty() || request.profile_id.trim().is_empty() || request.model_id.trim().is_empty() {
    return Err(blocked("incomplete_authorization_binding"));
  }
  match (request.capability.as_str(), request.provider_kind.as_str()) {
    (TEXT_REASONING, DEEPSEEK) | (VISION_ANALYSIS, QWEN_VISION) => Ok(()),
    _ => Err(blocked("unsupported_capability_provider")),
  }
}

fn build_provider_request(binding: &TrustedHostCapabilityRequest, model: &str, input: Value) -> Result<Value, TrustedHostBlockedResult> {
  match binding.capability.as_str() {
    TEXT_REASONING => Ok(json!({
      "model": model,
      "stream": false,
      "temperature": 0,
      "messages": [
        {"role": "system", "content": "Return only JSON matching AIReasoningResult v1. Never execute actions, write CRM data, send messages, or create tasks."},
        {"role": "user", "content": input.to_string()}
      ]
    })),
    VISION_ANALYSIS => Ok(json!({
      "model": model,
      "messages": [
        {"role": "system", "content": "Return only JSON with visual_facts. Do not return recommendations or actions."},
        {"role": "user", "content": input.to_string()}
      ]
    })),
    _ => Err(blocked("unsupported_capability_provider")),
  }
}

fn extract_output(binding: &TrustedHostCapabilityRequest, payload: Value) -> Result<Value, TrustedHostBlockedResult> {
  let content = payload.get("choices").and_then(Value::as_array).and_then(|choices| choices.first())
    .and_then(|choice| choice.get("message")).and_then(|message| message.get("content")).and_then(Value::as_str)
    .ok_or_else(|| blocked("host_provider_invalid_response"))?;
  let parsed: Value = serde_json::from_str(content).map_err(|_| blocked("host_provider_invalid_json"))?;
  if binding.capability == VISION_ANALYSIS { validate_vision_facts(&parsed)?; }
  Ok(parsed)
}

fn validate_vision_facts(value: &Value) -> Result<(), TrustedHostBlockedResult> {
  let object = value.as_object().ok_or_else(|| blocked("host_provider_invalid_vision_output"))?;
  if object.len() != 1 || !object.contains_key("visual_facts") { return Err(blocked("host_provider_invalid_vision_output")); }
  let facts = object.get("visual_facts").and_then(Value::as_array).ok_or_else(|| blocked("host_provider_invalid_vision_output"))?;
  for fact in facts {
    let record = fact.as_object().ok_or_else(|| blocked("host_provider_invalid_vision_output"))?;
    let allowed = ["fact_id", "fact_type", "content", "source_reference", "confidence", "location"];
    let allowed_type = matches!(record.get("fact_type").and_then(Value::as_str), Some("extracted_text" | "visible_product_attribute" | "company_contact_information" | "visible_requirement" | "visible_objection" | "document_field" | "date_quantity_specification"));
    let has_text = |key: &str| record.get(key).and_then(Value::as_str).filter(|text| !text.trim().is_empty()).is_some();
    let confidence_valid = record.get("confidence").and_then(Value::as_f64).map(|value| (0.0..=1.0).contains(&value)).unwrap_or(false);
    if record.keys().any(|key| !allowed.contains(&key.as_str())) || !has_text("fact_id") || !allowed_type || !has_text("content") || !has_text("source_reference") || !confidence_valid || (record.contains_key("location") && !has_text("location")) {
      return Err(blocked("host_provider_invalid_vision_output"));
    }
  }
  Ok(())
}

fn blocked(reason: &'static str) -> TrustedHostBlockedResult {
  TrustedHostBlockedResult { state: "blocked", reason }
}

fn next_authorization_id() -> String {
  let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
  format!("host-auth-{nanos}")
}

#[cfg(test)]
mod tests {
  use super::{blocked, validate_binding, validate_vision_facts, TrustedHostCapabilityRequest};
  use serde_json::json;

  fn valid() -> TrustedHostCapabilityRequest {
    TrustedHostCapabilityRequest { capability: "TEXT_REASONING".into(), provider_kind: "DEEPSEEK_COMPATIBLE".into(), model_id: "deepseek-chat".into(), customer_id: "customer-1".into(), context_snapshot_id: "snapshot-1".into(), workflow_kind: "customer_intelligence".into(), profile_id: "profile-1".into(), requested_by_user: true }
  }

  #[test]
  fn explicit_action_and_every_binding_are_required() {
    assert_eq!(validate_binding(&valid()), Ok(()));
    let mut missing = valid(); missing.customer_id = "".into();
    assert_eq!(validate_binding(&missing), Err(blocked("incomplete_authorization_binding")));
    let mut automatic = valid(); automatic.requested_by_user = false;
    assert_eq!(validate_binding(&automatic), Err(blocked("explicit_user_action_required")));
  }

  #[test]
  fn vision_output_is_facts_only() {
    assert_eq!(validate_vision_facts(&json!({"visual_facts":[{"fact_id":"fact-1","fact_type":"extracted_text","content":"Invoice","source_reference":"image:1","confidence":0.9}]})), Ok(()));
    assert_eq!(validate_vision_facts(&json!({"visual_facts":[], "recommendation":"call"})), Err(blocked("host_provider_invalid_vision_output")));
    assert_eq!(validate_vision_facts(&json!({"visual_facts":[{"fact_type":"x","content":"y","risk":"z"}]})), Err(blocked("host_provider_invalid_vision_output")));
  }
}
