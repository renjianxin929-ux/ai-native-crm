export const STAGE3_STABILIZATION_CHANGED_FILES = [
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
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
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/stage3Evaluation.test.ts',
  'src/__tests__/stage3EvidenceValidation.test.ts',
  'src/__tests__/stage3FinalAlignment.test.ts',
  'src/__tests__/stage3SalesAgentRuntime.test.ts',
  'src/__tests__/stage3StabilizationChangedFileCohort.ts',
  'src/__tests__/stage3TriggerSeam.test.ts',
  'src/__tests__/stage3WorkspaceIntegration.test.ts',
  'src/components/aiNative/SalesAgentResultPanel.tsx',
  'src/lib/salesAgent/architectureState.ts',
  'src/lib/salesAgent/canonicalPath.ts',
  'src/lib/salesAgent/evaluation.ts',
  'src/lib/salesAgent/evaluationFixtures.ts',
  'src/lib/salesAgent/humanReviewCompatibility.ts',
  'src/lib/salesAgent/provider.ts',
  'src/lib/salesAgent/runtime.ts',
  'src/lib/salesAgent/stage2CompatibilityAdapter.ts',
  'src/lib/salesAgent/triggerSeam.ts',
  'src/lib/salesAgent/types.ts',
  'src/lib/salesAgent/validation.ts',
] as const;

export function hasExactStage3StabilizationChangedFileSet(changedFiles: readonly string[]): boolean {
  if (changedFiles.length !== STAGE3_STABILIZATION_CHANGED_FILES.length) return false;
  const allowed = new Set(STAGE3_STABILIZATION_CHANGED_FILES);
  return changedFiles.every(file => allowed.has(file as (typeof STAGE3_STABILIZATION_CHANGED_FILES)[number]));
}

export const STAGE4_COPILOT_CHANGED_FILES = [
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
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/stage3FinalAlignment.test.ts',
  'src/__tests__/stage3StabilizationChangedFileCohort.ts',
  'src/__tests__/stage4SalesCopilotWorkflow.test.ts',
  'src/__tests__/stage4SalesCopilotWorkspace.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesCopilotPanel.tsx',
  'src/lib/salesCopilot/types.ts',
  'src/lib/salesCopilot/workflow.ts',
  'src/lib/salesCopilot/workspacePriority.ts',
] as const;

export function hasExactStage4CopilotChangedFileSet(changedFiles: readonly string[]): boolean {
  if (changedFiles.length !== STAGE4_COPILOT_CHANGED_FILES.length) return false;
  const allowed = new Set(STAGE4_COPILOT_CHANGED_FILES);
  return changedFiles.every(file => allowed.has(file as (typeof STAGE4_COPILOT_CHANGED_FILES)[number]));
}

export const LIVE_REASONING_ACTIVATION_CHANGED_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveReasoningActivation.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/stage3StabilizationChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesCopilotPanel.tsx',
  'src/lib/liveReasoning/config.ts',
  'src/lib/liveReasoning/provider.ts',
  'src/lib/liveReasoning/transport.ts',
  'src/lib/liveReasoning/types.ts',
  'src/lib/salesAgent/provider.ts',
  'src/lib/salesAgent/runtime.ts',
  'src/lib/salesCopilot/types.ts',
  'src/lib/salesCopilot/workflow.ts',
] as const;

export function hasExactLiveReasoningActivationChangedFileSet(changedFiles: readonly string[]): boolean {
  return changedFiles.length === LIVE_REASONING_ACTIVATION_CHANGED_FILES.length
    && changedFiles.every(file => new Set<string>(LIVE_REASONING_ACTIVATION_CHANGED_FILES).has(file));
}
