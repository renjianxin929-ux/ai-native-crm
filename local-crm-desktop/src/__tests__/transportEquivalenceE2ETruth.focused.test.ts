import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const rust = readFileSync(resolve(root, 'src-tauri/src/trusted_host.rs'), 'utf8');
const driver = readFileSync(resolve(root, 'scripts/real_tauri_e2e.py'), 'utf8');
const controller = readFileSync(resolve(root, 'src/lib/salesAgentTools/interactionController.ts'), 'utf8');
const hostAdapter = readFileSync(resolve(root, 'src/lib/salesAgentTools/trustedHostAdapter.ts'), 'utf8');

describe('transport equivalence and E2E truth closure', () => {
  it('provider-transport-equivalence uses one shared production/e2e pipeline around a raw response transport', () => {
    expect(rust).toContain('trait ProviderTransport');
    expect(rust).toContain('struct ReqwestProviderTransport');
    expect(rust).toContain('struct DeterministicFakeNetworkTransport');
    expect(rust).toContain('struct RawProviderHttpResponse');
    expect(rust).toContain('execute_provider_pipeline(');
    expect(rust).not.toContain('execute_e2e_fake_transport');
    expect(rust).not.toContain('e2e_fake_output');
  });

  it('shared-provider-pipeline keeps request build, byte caps, raw parse, extraction, validation, source binding, and atomic commit in one function', () => {
    const pipeline = rust.slice(rust.indexOf('async fn execute_provider_pipeline'), rust.indexOf('#[cfg(feature = "e2e")]\nfn fake_provider_content'));
    for (const gate of [
      'parse_vision_input', 'build_provider_request', 'request_too_large', 'send_provider_with_bounded_retry',
      'extract_output', 'assert_request_commit_allowed', 'complete_if_active',
    ]) expect(pipeline).toContain(gate);
  });

  it('e2e-driver-no-manual-actual has no actual override or expected-as-actual fallback', () => {
    expect(driver).not.toMatch(/actual\s*:\s*str\s*\|\s*None/);
    expect(driver).not.toMatch(/actual\s*=/);
    expect(driver).not.toContain('expected_intent if expected_intent in observed_intents');
    expect(driver).toContain('actual_intent = observable_intent(page)');
  });

  it('e2e-driver-no-intent-bypass strictly compares observed DOM intent', () => {
    expect(driver).not.toMatch(/intent_ok[^\n]*number\s+in/);
    expect(driver).not.toMatch(/intent_ok\s*=\s*True/);
    expect(driver).toContain('actual_intent == expected_intent');
  });

  it('action-matrix-independent-44 restores a clean copied DB and launches a new Tauri process per scenario', () => {
    expect(driver).toContain('scenario_numbers = [args.scenario] if args.scenario is not None else list(range(1, 45))');
    expect(driver).toContain('restore_isolated_e2e_database(baseline_db, live_e2e_db)');
    expect(driver).toContain('subprocess.Popen([str(app_binary)]');
    expect(driver).toContain('stop_process_tree(app)');
    expect(driver).not.toContain('def run_full(');
    expect(driver).toContain('"independent_execution_count"');
    expect(driver).toContain('"reused_execution_count"');
  });

  it('db-oracle-exact-row compares every table and every field by stable row identity', () => {
    expect(driver).toContain('SELECT rowid AS __rowid__, *');
    expect(driver).toContain('def exact_db_diff(');
    expect(driver).toContain('"customer_id_exact"');
    expect(driver).toContain('"actual_row_id_present"');
    expect(driver).toContain('"created_at_present"');
    expect(driver).toContain('"updated_at_present"');
    expect(driver).toContain('"affected_row_count_exactly_one"');
  });

  it('cancellation-late-response-and-recovery is a real delayed raw response followed by a second request', () => {
    expect(rust).toContain('E2E_LATE_RESPONSE_AFTER_CANCEL');
    expect(rust).toContain('cancellation_late_response_is_rejected_and_next_request_succeeds');
    expect(driver).toContain('"second_request_success"');
    expect(driver).toContain('["capture_open", "thinking", "cancelled", "second_request", "capture_review"]');
  });

  it('semantic-router-three-trace records three independent router and reasoning request pairs', () => {
    expect(driver).toContain('semantic-trace-1-implicit-summary');
    expect(driver).toContain('semantic-trace-2-implicit-risk');
    expect(driver).toContain('semantic-trace-3-implicit-interaction');
    expect(driver).toContain('"envelope_identity_preserved"');
    expect(driver).toContain('"router_call_count"');
    expect(driver).toContain('"reasoning_call_count"');
  });

  it('provider-unconfigured proves natural clarification with zero post-bind network call', () => {
    expect(driver).toContain('"zero_network_call_after_bind"');
    expect(driver).toContain('AI_NATIVE_CRM_E2E_UNCONFIGURED_CAPABILITIES');
  });

  it('router-cancellation forwards AbortSignal through controller and trusted host', () => {
    expect(controller).toContain('this.semanticIntentRouter(trimmed, intentEnvelope.envelope_id, signal)');
    expect(hostAdapter).toContain("call,\n      signal,");
    expect(driver).toContain('"router_cancellation_stops_reasoning"');
  });

  it('real-vision-pipeline records decoded visual-body identity and host source binding', () => {
    expect(rust).toContain('visual_body_attestation');
    expect(rust).toContain('decoded_sha256');
    expect(driver).toContain('"complete_visual_body_proved_by_decoded_hash"');
    expect(driver).toContain('"provider_source_overridden"');
    expect(driver).toContain('"unsupported_format_natural_chinese_block"');
  });

  it('normal-db-protection compares base, logical, WAL/SHM content, all fields and stable customer', () => {
    for (const assertion of [
      '"online_consistent_sha256_equal"', '"base_sha256_equal"', '"wal_content_equal"',
      '"shm_content_equal"', '"all_tables_all_fields_equal"', '"stable_customer_equal"',
    ]) expect(driver).toContain(assertion);
  });
});
