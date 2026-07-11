const MODEL_CAPABILITIES_PHASE_1_3_CHANGED_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelCapabilities.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/readOnlyAgent.readiness.test.ts',
  'src/__tests__/readOnlyAgentLiveDryRun.readiness.test.ts',
  'src/__tests__/readOnlyAgentSnapshotAdapter.readiness.test.ts',
  'src/__tests__/readOnlySnapshotLoader.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/suggestOnlyAgent.readiness.test.ts',
  'src/__tests__/modelRouterRuntime.readiness.test.ts',
  'src/lib/modelCapabilities/index.ts',
  'src/lib/modelCapabilities/providers.ts',
  'src/lib/modelCapabilities/registry.ts',
  'src/lib/modelCapabilities/types.ts',
  'src/lib/modelCapabilities/visionFacts.ts',
] as const;

const MODEL_CAPABILITIES_PHASE_4_TRUSTED_HOST_CHANGED_FILES = [
  ...MODEL_CAPABILITIES_PHASE_1_3_CHANGED_FILES,
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src-tauri/src/lib.rs',
  'src-tauri/src/trusted_host.rs',
] as const;

const MODEL_CAPABILITIES_PHASE_4_FRONTEND_CHANGED_FILES = MODEL_CAPABILITIES_PHASE_4_TRUSTED_HOST_CHANGED_FILES
  .filter(file => !file.startsWith('src-tauri/'));

// Stages 5-7 deliberately supersede the earlier isolated readiness loops. This
// remains an exact cohort so unrelated edits cannot be hidden by the exception.
const STAGE5_TO_7_CHANGED_FILES = [
  ...MODEL_CAPABILITIES_PHASE_4_TRUSTED_HOST_CHANGED_FILES,
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src/__tests__/customerMemory.test.ts',
  'src/__tests__/liveReasoningActivation.test.ts',
  'src/__tests__/proactiveSales.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentResultPanel.tsx',
  'src/lib/customerMemory/index.ts',
  'src/lib/customerMemory/memory.ts',
  'src/lib/customerMemory/types.ts',
  'src/lib/liveReasoning/config.ts',
  'src/lib/liveReasoning/provider.ts',
  'src/lib/liveReasoning/transport.ts',
  'src/lib/liveReasoning/types.ts',
  'src/lib/proactiveSales/index.ts',
  'src/lib/proactiveSales/observation.ts',
  'src/lib/proactiveSales/types.ts',
  'src/lib/salesAgent/runtime.ts',
  'src/lib/salesAgent/types.ts',
  'src/lib/salesCopilot/workflow.ts',
] as const;

const STAGE5_TO_7_FRONTEND_CHANGED_FILES = STAGE5_TO_7_CHANGED_FILES.filter(file => !file.startsWith('src-tauri/'));
const STAGE5_TO_7_UNTRACKED_FILES = new Set<string>([
  'src-tauri/src/trusted_host.rs', 'src/__tests__/customerMemory.test.ts', 'src/__tests__/modelCapabilities.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts', 'src/__tests__/proactiveSales.test.ts', 'src/__tests__/trustedHostBoundary.test.ts',
  'src/lib/customerMemory/index.ts', 'src/lib/customerMemory/memory.ts', 'src/lib/customerMemory/types.ts',
  'src/lib/modelCapabilities/index.ts', 'src/lib/modelCapabilities/providers.ts', 'src/lib/modelCapabilities/registry.ts',
  'src/lib/modelCapabilities/trustedHost.ts', 'src/lib/modelCapabilities/types.ts', 'src/lib/modelCapabilities/visionFacts.ts',
  'src/lib/proactiveSales/index.ts', 'src/lib/proactiveSales/observation.ts', 'src/lib/proactiveSales/types.ts',
]);
const STAGE5_TO_7_TRACKED_CHANGED_FILES = STAGE5_TO_7_CHANGED_FILES.filter(file => !STAGE5_TO_7_UNTRACKED_FILES.has(file));

export function hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles: readonly string[]): boolean {
  return hasExactChangedFileSet(changedFiles, MODEL_CAPABILITIES_PHASE_1_3_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, MODEL_CAPABILITIES_PHASE_4_TRUSTED_HOST_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, MODEL_CAPABILITIES_PHASE_4_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE5_TO_7_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE5_TO_7_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE5_TO_7_TRACKED_CHANGED_FILES);
}

function hasExactChangedFileSet(changedFiles: readonly string[], expectedFiles: readonly string[]): boolean {
  return changedFiles.length === expectedFiles.length
    && changedFiles.every(file => expectedFiles.includes(file as never));
}
