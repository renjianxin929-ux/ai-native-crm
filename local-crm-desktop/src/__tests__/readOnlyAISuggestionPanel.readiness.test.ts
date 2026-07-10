import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReadOnlyAISuggestionPanel } from '../components/aiSuggestions/ReadOnlyAISuggestionPanel';
import { buildReadOnlyAISuggestionViewModel } from '../components/aiSuggestions/readOnlyAISuggestionViewModel';
import {
  runReadOnlyAISuggestionService,
  runReadOnlySnapshotAISuggestionService,
  type ReadOnlyAISuggestionServiceResponse,
} from '../lib/readOnlyAISuggestionServiceReadiness';
import { buildReadOnlyAISuggestionServiceRequestFixtureV1 } from '../lib/readOnlyAISuggestionService/readOnlyAISuggestionServiceFixturesV1';
import { buildLiveDryRunLoadedSnapshotFixtureV1 } from '../lib/readOnlyAgentLiveDryRun/readOnlyAgentLiveDryRunFixturesV1';

const PANEL_FILE = 'src/components/aiSuggestions/ReadOnlyAISuggestionPanel.tsx';
const VIEW_MODEL_FILE = 'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts';
const TEST_FILE = 'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts';
const LOOP_53_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  PANEL_FILE,
  VIEW_MODEL_FILE,
  TEST_FILE,
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
];
const LOOP_53A_FILES = [TEST_FILE];
const LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES = [
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
];
const LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES = [
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
];
const LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES = [
  'src/App.tsx',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiSuggestions/readOnlyAISuggestionViewModel.ts',
  'src/lib/aiNativeCRMWorkspaceReadiness.ts',
  'src/lib/readOnlyAISuggestionServiceReadiness.ts',
] as const;
const LOOP_53_ALLOWED_CHANGED_FILES = new Set(LOOP_53_FILES);
for (const file of LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES) {
  LOOP_53_ALLOWED_CHANGED_FILES.add(file);
}

const SAFETY_LABELS = [
  'Read-only',
  'Requires human review',
  'Not executable',
  'Untrusted',
  'Informational only',
];

const FORBIDDEN_VISIBLE_COPY = [
  /\bExecute\b/,
  /\bRun\b/,
  /\bApprove\b/,
  /\bConfirm\b/,
  /\bApply\b/,
  /Save to CRM/,
  /Create task/,
  /Create follow-up/,
  /Send to queue/,
  /Mark as done/,
  /Auto-run/,
  /Write to DB/,
  /\bSync\b/,
  /\bSynced\b/,
  /\bApproved\b/,
  /\bConfirmed\b/,
  /\bCompleted\b/,
  /\bSuccess\b/,
];

const FORBIDDEN_PAYLOAD_FIELDS = [
  'output_text',
  'output_text_redacted',
  'raw_output',
  'provider_output',
  'model_output',
  'action_payload',
  'write_payload',
  'review_payload',
  'confirmed_action_payload',
  'db_payload',
  'task_payload',
  'followup_payload',
  'customer_status_payload',
];

const FORBIDDEN_IMPORT_TERMS = [
  'runReadOnlyAISuggestionService',
  'runLiveSandboxToSuggestOnlyBridge',
  'runModelSuggestOnlyOutputGate',
  'liveSandboxToSuggestOnlyBridgeReadiness',
  'modelSuggestOnlyOutputGateReadiness',
  'manualLiveProviderSmoke',
  'liveProviderSandboxCall',
  'transport',
  'aiDraft',
  'textAIProvider',
  'multimodalProvider',
  'getDb',
  'SQL',
  'reviewQueue',
  'ReviewQueue',
  'reviewDraft',
  'ConfirmedAction',
  'confirmedAction',
  'HumanConfirmation',
  'humanConfirmation',
  'ActionRunner',
  'WriteRunner',
  'DB Write Plan',
  'Safe Write Runner',
  'App.tsx',
  'AIAssistantPage.tsx',
  'LeadWorkbenchPage.tsx',
  '@tauri-apps',
  'fetch',
  'process.env',
  'import.meta.env',
  'API_KEY',
  'api_key',
  'Authorization',
  'Bearer',
];

const FORBIDDEN_CALLBACK_PROPS = [
  'onConfirm',
  'onExecute',
  'onApprove',
  'onApply',
  'onSave',
  'onQueue',
  'onCreateTask',
  'onCreateFollowup',
];

describe('Read-only AI suggestion panel readiness', () => {
  it('renders rule-based cards from a real loaded CRM snapshot without provider provenance', () => {
    const loadedSnapshot = buildLiveDryRunLoadedSnapshotFixtureV1();
    const response = runReadOnlySnapshotAISuggestionService({
      kind: 'READ_ONLY_SNAPSHOT_AI_SUGGESTION_SERVICE_REQUEST',
      version: 'v1',
      request_id: 'SNAPSHOT_PANEL_TEST_REQUEST_A',
      loaded_snapshot: loadedSnapshot,
      intent: 'evidence_for_customer',
      context: loadedSnapshot.context,
      target_customer_id: 'LIVE_DRY_RUN_TEST_CUSTOMER_A',
      service_read_only: true,
      caller_provided_only: true,
      source_reference_only: true,
      allow_network: false,
      allow_model_call: false,
      allow_env_read: false,
      allow_db: false,
      allow_runner: false,
      allow_execution: false,
      allow_review_queue_entry: false,
      allow_confirmed_action: false,
      allow_human_confirmation: false,
      allow_write_plan_entry: false,
      allow_database_write: false,
      allow_task_create: false,
      allow_followup_create: false,
      allow_customer_status_change: false,
      allow_ui: false,
    });
    const markup = renderPanel(response);

    expect(markup).toContain('read_only_crm_snapshot');
    expect(markup).toContain('none_rule_based');
    expect(markup).toContain('Requires human review');
    expect(markup).toContain('Not executable');
    expect(markup).not.toContain('live_provider_sandbox_call');
  });

  it('renders fixture service response cards', () => {
    const response = buildResponseFixture();
    const markup = renderPanel(response);

    expect(markup).toContain('Read-only AI Suggestions');
    expect(markup).toContain(response.answer.suggestion_cards[0].title);
    expect(markup).toContain(response.answer.suggestion_cards[0].summary);
    expect(markup).toContain(response.answer.suggestion_cards[0].suggestion_status);
  });

  it('renders required safety labels', () => {
    const markup = renderPanel(buildResponseFixture());

    for (const label of SAFETY_LABELS) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('Preview');
  });

  it('renders provenance with informational and not trusted labeling', () => {
    const response = buildResponseFixture();
    const markup = renderPanel(response);

    expect(markup).toContain('Provenance - informational only, not trusted for action');
    expect(markup).toContain('source_kind');
    expect(markup).toContain(response.answer.source_kind);
    expect(markup).toContain('source_provider_kind');
    expect(markup).toContain(response.answer.source_provider_kind);
    expect(markup).toContain('source_model_name');
    expect(markup).toContain(response.answer.source_model_name);
    expect(markup).toContain('source_request_id');
    expect(markup).toContain(response.answer.source_request_id);
  });

  it('uses only Loop 52 card title and summary metadata for cards', () => {
    const response = buildResponseFixture();
    const viewModel = buildReadOnlyAISuggestionViewModel(response);
    const sourceCard = response.answer.suggestion_cards[0];

    expect(viewModel.cards).toEqual([
      expect.objectContaining({
        title: sourceCard.title,
        summary: sourceCard.summary,
      }),
    ]);
    expect(viewModel.cards[0].summary).not.toBe(response.answer.source_model_name);
  });

  it('does not render raw output fields', () => {
    const markup = renderPanel(buildResponseFixture());

    expect(markup).not.toContain('output_text');
    expect(markup).not.toContain('output_text_redacted');
    expect(markup).not.toContain('raw_output');
  });

  it('does not render forbidden payload field names', () => {
    const markup = renderPanel(buildResponseFixture(), { showTrace: true });

    for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
      expect(markup).not.toContain(field);
    }
  });

  it('renders blocked service state with no cards', () => {
    const response = {
      ...buildResponseFixture(),
      answer: {
        ...buildResponseFixture().answer,
        service_blocked: true,
        blocked_reason: 'source_bridge_blocked',
        suggestion_cards: [],
        cards_count: 0,
      },
    } as ReadOnlyAISuggestionServiceResponse;
    const markup = renderPanel(response);

    expect(markup).toContain('Blocked preview');
    expect(markup).toContain('source_bridge_blocked');
    expect(markup).toContain('No read-only suggestion cards to preview.');
    expect(markup).not.toContain(buildResponseFixture().answer.suggestion_cards[0].title);
  });

  it('renders empty cards state', () => {
    const response = {
      ...buildResponseFixture(),
      answer: {
        ...buildResponseFixture().answer,
        suggestion_cards: [],
        cards_count: 0,
      },
    } as ReadOnlyAISuggestionServiceResponse;
    const markup = renderPanel(response);

    expect(markup).toContain('No read-only suggestion cards to preview.');
  });

  it('renders invalid response kind as blocked-safe state', () => {
    const response = {
      ...buildResponseFixture(),
      kind: 'WRONG_KIND',
    } as unknown as ReadOnlyAISuggestionServiceResponse;
    const viewModel = buildReadOnlyAISuggestionViewModel(response);
    const markup = renderPanel(response);

    expect(viewModel.valid).toBe(false);
    expect(markup).toContain('Blocked preview');
    expect(markup).toContain('Invalid response kind');
    expect(markup).toContain('No read-only suggestion cards to preview.');
  });

  it('hides provenance when showProvenance is false', () => {
    const markup = renderPanel(buildResponseFixture(), { showProvenance: false });

    expect(markup).not.toContain('Provenance - informational only, not trusted for action');
    expect(markup).not.toContain('source_model_name');
  });

  it('hides trace by default and when showTrace is false', () => {
    expect(renderPanel(buildResponseFixture())).not.toContain('Trace summary');
    expect(renderPanel(buildResponseFixture(), { showTrace: false })).not.toContain('Trace summary');
  });

  it('renders only safe trace summary when showTrace is true', () => {
    const response = buildResponseFixture();
    const markup = renderPanel(response, { showTrace: true });

    expect(markup).toContain('Trace summary');
    expect(markup).toContain('trace_summary.kind');
    expect(markup).toContain(response.answer.trace_summary.kind);
    expect(markup).toContain('trace_summary.validation_checked');
    expect(markup).toContain('trace_summary.projection_only');
    expect(markup).not.toContain('raw_trace');
    expect(markup).not.toContain('span_events');
    expect(markup).not.toContain('provider_output');
  });

  it('renders no buttons, forms, or input elements', () => {
    const markup = renderPanel(buildResponseFixture());

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('<select');
  });

  it('passes forbidden visible copy scan', () => {
    const markup = renderPanel(buildResponseFixture(), { showTrace: true });

    assertNoForbiddenVisibleCopy(markup);
  });

  it('keeps production source free of forbidden imports and runtime access', () => {
    for (const file of [PANEL_FILE, VIEW_MODEL_FILE]) {
      const source = readFileSync(file, 'utf8');

      for (const term of FORBIDDEN_IMPORT_TERMS) {
        expect(source).not.toContain(term);
      }
    }
  });

  it('keeps production source free of service, bridge, and gate runner calls', () => {
    const source = readProductionSources();

    expect(source).not.toMatch(/\brunReadOnlyAISuggestionService\(/);
    expect(source).not.toMatch(/\brunLiveSandboxToSuggestOnlyBridge\(/);
    expect(source).not.toMatch(/\brunModelSuggestOnlyOutputGate\(/);
  });

  it('keeps production source uncoupled from app and execution-heavy pages', () => {
    const source = readProductionSources();

    expect(source).not.toContain('App.tsx');
    expect(source).not.toContain('AIAssistantPage.tsx');
    expect(source).not.toContain('LeadWorkbenchPage.tsx');
    expect(source).not.toContain('../pages');
    expect(source).not.toContain('../../pages');
  });

  it('keeps file scope limited to exact Loop 53 paths', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    if (hasExactStage3StabilizationChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(41);
      return;
    }
    if (hasExactStage2ChangedFileSet(changedFiles)) {
      expect(changedFiles).toHaveLength(46);
      return;
    }

    expect(changedFiles.filter(file => !LOOP_53_ALLOWED_CHANGED_FILES.has(file))).toEqual([]);
    if (changedFiles.length === 0) {
      expect(isProvenCleanGitBaseline()).toBe(true);
    } else {
      expect(
        hasCompleteChangedFileSet(changedFiles, LOOP_53_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_OLDER_READINESS_GUARD_COMPATIBILITY_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_53A_SELF_TEST_EXPECTATION_ALIGNMENT_PATCH_FILES)
        || hasCompleteChangedFileSet(changedFiles, LOOP_54_AI_NATIVE_CONTEXT_INTEGRATION_FILES),
      ).toBe(true);
    }
    expect(LOOP_53_ALLOWED_CHANGED_FILES.has('src/components/**')).toBe(false);
    expect(LOOP_53_ALLOWED_CHANGED_FILES.has('src/__tests__/**')).toBe(false);
    expect(changedFiles).not.toContain('package.json');
    expect(changedFiles.filter(file => file.endsWith('lock.yaml'))).toEqual([]);
  });

  it('recognizes only independently proven clean git baselines', () => {
    expect(isProvenCleanGitBaselineFromParts([], [], [])).toBe(true);
    expect(isProvenCleanGitBaselineFromParts([' M x'], [], [])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], ['x'], [])).toBe(false);
    expect(isProvenCleanGitBaselineFromParts([], [], ['x'])).toBe(false);
  });

  it('requires exact cardinality for changed file cohorts', () => {
    expect(hasCompleteChangedFileSet(['a'], ['a'])).toBe(true);
    expect(hasCompleteChangedFileSet(['a'], ['a', 'b'])).toBe(false);
    expect(hasCompleteChangedFileSet(['a', 'b'], ['a'])).toBe(false);
    expect(hasCompleteChangedFileSet(['a', 'extra'], ['a', 'b'])).toBe(false);
  });

  it('mutation test fails forbidden button text', () => {
    for (const copy of ['Execute', 'Approve', 'Confirm', 'Apply', 'Save to CRM']) {
      expect(() => assertNoForbiddenVisibleCopy(copy)).toThrow();
    }
  });

  it('mutation test fails forbidden payload fields', () => {
    for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
      expect(field).toMatch(/payload|output|text/);
    }
    const source = readProductionSources();
    for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
      expect(source).not.toContain(field);
    }
  });

  it('mutation test fails action callback prop names', () => {
    const source = readProductionSources();

    for (const prop of FORBIDDEN_CALLBACK_PROPS) {
      expect(source).not.toContain(prop);
      expect(prop).toMatch(/^on/);
    }
  });

  it('mutation test fails forbidden imports', () => {
    const source = readProductionSources();

    for (const term of FORBIDDEN_IMPORT_TERMS) {
      expect(source).not.toContain(term);
    }
    expect(FORBIDDEN_IMPORT_TERMS).toContain('runLiveSandboxToSuggestOnlyBridge');
    expect(FORBIDDEN_IMPORT_TERMS).toContain('runModelSuggestOnlyOutputGate');
  });
});

function buildResponseFixture(): ReadOnlyAISuggestionServiceResponse {
  return runReadOnlyAISuggestionService(buildReadOnlyAISuggestionServiceRequestFixtureV1());
}

function renderPanel(
  response: ReadOnlyAISuggestionServiceResponse,
  props: Partial<{
    compact: boolean;
    showProvenance: boolean;
    showTrace: boolean;
  }> = {},
): string {
  return renderToStaticMarkup(createElement(ReadOnlyAISuggestionPanel, { response, ...props }));
}

function readProductionSources(): string {
  return [PANEL_FILE, VIEW_MODEL_FILE].map(file => readFileSync(file, 'utf8')).join('\n');
}

function assertNoForbiddenVisibleCopy(text: string): void {
  for (const pattern of FORBIDDEN_VISIBLE_COPY) {
    expect(text).not.toMatch(pattern);
  }
}

function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
}

function hasCompleteChangedFileSet(changedFiles: readonly string[], expectedFiles: readonly string[]): boolean {
  return changedFiles.length === expectedFiles.length
    && expectedFiles.every(file => changedFiles.includes(file));
}

function isProvenCleanGitBaselineFromParts(
  statusLines: readonly string[],
  cachedLines: readonly string[],
  untrackedLines: readonly string[],
): boolean {
  return statusLines.length === 0
    && cachedLines.length === 0
    && untrackedLines.length === 0;
}

function isProvenCleanGitBaseline(): boolean {
  return isProvenCleanGitBaselineFromParts(
    gitLines(['status', '--short']),
    gitLines(['diff', '--cached', '--name-only']),
    gitLines(['ls-files', '--others', '--exclude-standard']),
  );
}
import { hasExactStage2ChangedFileSet } from './stage2ChangedFileCohort';
import { hasExactStage3StabilizationChangedFileSet } from './stage3StabilizationChangedFileCohort';
