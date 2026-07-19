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

export const STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES = [
  'src/__tests__/customerMemoryPersistent.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/lib/context/customerMemoryEnrichment.ts',
  'src/lib/context/types.ts',
  'src/lib/customerMemory/index.ts',
  'src/lib/customerMemory/migration.ts',
  'src/lib/customerMemory/repository.ts',
  'src/lib/customerMemory/retrieval.ts',
  'src/lib/customerMemory/types.ts',
  'src/lib/db.ts',
  'src-tauri/migrations/004_ai_customer_memory.sql',
] as const;
const STAGE8_CUSTOMER_MEMORY_FOUNDATION_SRC_CHANGED_FILES = STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES
  .filter(file => file.startsWith('src/'));
const STAGE8_CUSTOMER_MEMORY_FOUNDATION_TRACKED_CHANGED_FILES = [
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/lib/context/types.ts',
  'src/lib/customerMemory/index.ts',
  'src/lib/customerMemory/types.ts',
  'src/lib/db.ts',
] as const;

const STAGE9_PRODUCT_EXPERIENCE_LAYER_CHANGED_FILES = [
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/stage9SalesWorkspace.test.ts',
  'src/components/salesWorkspace/CustomerCaptureContract.tsx',
  'src/components/salesWorkspace/CustomerIntelligencePanel.tsx',
  'src/components/salesWorkspace/SalesCommandCenter.tsx',
  'src/lib/salesWorkspace/customerScopedSalesAgentEntry.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/pages/AIAssistantPage.tsx',
  'src/pages/CustomerDetail.tsx',
  'src/pages/TodayView.tsx',
] as const;
const STAGE9_PRODUCT_EXPERIENCE_LAYER_TRACKED_CHANGED_FILES = [
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/pages/AIAssistantPage.tsx',
  'src/pages/CustomerDetail.tsx',
  'src/pages/TodayView.tsx',
] as const;

export const STAGE10_SALES_AGENT_OPERATING_LAYER_CHANGED_FILES = [
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesAgentTools/registry.ts',
] as const;
export const STAGE10_5_AGENT_INTELLIGENCE_POLISH_CHANGED_FILES = [
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/salesAgentTools/operatingLayer.ts',
] as const;
export const STAGE11_TO_13_CHANGED_FILES = [
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/approvedCrmWriteBoundary.integration.test.ts',
  'src/__tests__/confirmationReplayMismatch.integration.test.ts',
  'src/__tests__/salesAgentConfirmationCard.test.ts',
  'src/__tests__/salesAgentProductionHarness.ts',
  'src/__tests__/salesAgentSessionRuntime.integration.test.ts',
  'src/__tests__/salesAgentSessionWriteRouting.integration.test.ts',
  'src/__tests__/salesAgentWriteRefresh.integration.test.ts',
  'src/__tests__/stage11SemanticPlanning.test.ts',
  'src/__tests__/stage12ConfirmedWrite.test.ts',
  'src/__tests__/stage13CustomerCapture.test.ts',
  'src/__tests__/stage11To13E2E.test.ts',
  'src/__tests__/productionRefreshCoordinator.integration.test.ts',
  'src/lib/customerCapture/review.ts',
  'src/lib/salesAgentTools/confirmedWrite.ts',
  'src/lib/salesAgentTools/semanticPlanning.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/lib/salesAgentTools/memoryRepositoryAdapter.ts',
  'src/lib/salesAgentTools/productionRefreshCoordinator.ts',
  'src/lib/db.ts',
  'src-tauri/src/trusted_host.rs',
] as const;
// `git diff --name-only` intentionally omits the new, untracked Stage 11-13
// files while the readiness guards are running. Keep this exact tracked view
// separate; it is not a wildcard or subset acceptance rule.
export const STAGE11_TO_13_TRACKED_CHANGED_FILES = [
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/db.ts',
  'src-tauri/src/trusted_host.rs',
] as const;
export const STAGE11_TO_13_FRONTEND_CHANGED_FILES = STAGE11_TO_13_CHANGED_FILES
  .filter(file => !file.startsWith('src-tauri/'));

/** Exact UI rebuild + real Sales Agent functional closure cohort — not a wildcard, prefix, or subset match. */
export const FINAL_UI_REBUILD_CHANGED_FILES = [
  'package.json',
  'src-tauri/tauri.e2e.conf.json',
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/SettingsPage.test.ts',
  'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
  'src/__tests__/finalUiRebuild.focused.test.ts',
  'src/__tests__/overnightFullStabilization.focused.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/approvedCrmWriteBoundary.integration.test.ts',
  'src/__tests__/confirmationReplayMismatch.integration.test.ts',
  'src/__tests__/salesAgentActionMatrix.focused.test.ts',
  'src/__tests__/salesAgentConfirmationCard.test.ts',
  'src/__tests__/salesAgentFunctionalFixture.ts',
  'src/__tests__/salesAgentNoProductionHooks.focused.test.ts',
  'src/__tests__/salesAgentPortfolioSearch.focused.test.ts',
  'src/__tests__/salesAgentProductionHarness.ts',
  'src/__tests__/salesAgentProposalOwnership.focused.test.ts',
  'src/__tests__/salesAgentRealFunctional.focused.test.ts',
  'src/__tests__/salesAgentRealWriteIntent.focused.test.ts',
  'src/__tests__/salesAgentSessionWriteRouting.integration.test.ts',
  'src/__tests__/salesAgentTauriDbAcceptance.evidence.test.ts',
  'src/__tests__/salesAgentWriteRefresh.integration.test.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/__tests__/stage11To13E2E.test.ts',
  'src/__tests__/tauriE2EIsolation.focused.test.ts',
  'src/__tests__/unifiedAgentStage.focused.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentGlassOrb.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/index.css',
  'src/lib/customerCapture/review.ts',
  'src/lib/db.ts',
  'src/lib/salesAgent/evidenceIntegrity.ts',
  'src/lib/salesAgent/validation.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/appClock.ts',
  'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
  'src/lib/salesAgentTools/confirmedWrite.ts',
  'src/lib/salesAgentTools/customerResolution.ts',
  'src/lib/salesAgentTools/executeSearchCustomersTool.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesAgentTools/registry.ts',
  'src/lib/salesAgentTools/searchCustomers.ts',
  'src/lib/salesAgentTools/semanticPlanning.ts',
  'src/lib/salesAgentTools/sessionWriteStateStore.ts',
  'src/lib/salesAgentTools/writeIntent.ts',
  'src/lib/salesAgentUi/dailyFocus.ts',
  'src/lib/salesAgentUi/formatUserFacingError.ts',
  'src/lib/salesAgentUi/orbState.ts',
  'src/lib/salesAgentUi/quickActions.ts',
  'src/lib/salesAgentUi/resultCards.ts',
  'src/lib/salesAgentUi/stageMode.ts',
  'src/lib/salesAgentUi/workProcess.ts',
  'src/pages/CustomerDetail.tsx',
  'src/pages/CustomerList.tsx',
  'src/pages/LeadWorkbenchPage.tsx',
  'src/pages/SettingsPage.tsx',
] as const;

// Several legacy readiness guards intentionally observe only src/package paths.
// Keep their exact projection explicit; this is still exact-cardinality and
// exact-membership, never a prefix or subset exception.
export const FINAL_UI_REBUILD_FRONTEND_CHANGED_FILES = FINAL_UI_REBUILD_CHANGED_FILES
  .filter(file => !file.startsWith('src-tauri/'));
export const FINAL_UI_REBUILD_SRC_CHANGED_FILES = FINAL_UI_REBUILD_CHANGED_FILES
  .filter(file => file.startsWith('src/'));

/** Exact UNIFIED_AGENT_STAGE morph cohort — supersedes final rebuild when morph files are included. */
export const UNIFIED_AGENT_STAGE_MORPH_CHANGED_FILES = FINAL_UI_REBUILD_CHANGED_FILES;

export const FINAL_UI_REBUILD_TRACKED_CHANGED_FILES = [
  'package.json',
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/SettingsPage.test.ts',
  'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/approvedCrmWriteBoundary.integration.test.ts',
  'src/__tests__/confirmationReplayMismatch.integration.test.ts',
  'src/__tests__/salesAgentConfirmationCard.test.ts',
  'src/__tests__/salesAgentProductionHarness.ts',
  'src/__tests__/salesAgentSessionWriteRouting.integration.test.ts',
  'src/__tests__/salesAgentWriteRefresh.integration.test.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/__tests__/stage11To13E2E.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/index.css',
  'src/lib/customerCapture/review.ts',
  'src/lib/db.ts',
  'src/lib/salesAgent/validation.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
  'src/lib/salesAgentTools/confirmedWrite.ts',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesAgentTools/registry.ts',
  'src/lib/salesAgentTools/semanticPlanning.ts',
  'src/pages/CustomerDetail.tsx',
  'src/pages/CustomerList.tsx',
  'src/pages/LeadWorkbenchPage.tsx',
  'src/pages/SettingsPage.tsx',
] as const;

export const SALES_AGENT_REAL_FUNCTIONAL_CHANGED_FILES = FINAL_UI_REBUILD_CHANGED_FILES;

export const SALES_AGENT_REAL_FUNCTIONAL_TRACKED_CHANGED_FILES = FINAL_UI_REBUILD_TRACKED_CHANGED_FILES;

/** Exact Production LLM Wiring cohort — supersedes earlier loops while worktree matches this set. */
export const PRODUCTION_LLM_WIRING_CHANGED_FILES = [
  'src-tauri/src/lib.rs',
  'src-tauri/src/trusted_host.rs',
  'src/App.css',
  'src/__tests__/capabilityRouting.focused.test.ts',
  'src/__tests__/deterministicPath.focused.test.ts',
  'src/__tests__/evidenceGrounding.focused.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/modelContextEnvelope.focused.test.ts',
  'src/__tests__/modelSchemaValidation.focused.test.ts',
  'src/__tests__/noFrontendSecret.focused.test.ts',
  'src/__tests__/noPageLoadCall.focused.test.ts',
  'src/__tests__/productionAdapterFakeTransport.focused.test.ts',
  'src/__tests__/providerErrorMapping.focused.test.ts',
  'src/__tests__/salesAgentRealFunctional.focused.test.ts',
  'src/__tests__/salesAgentSessionRuntime.integration.test.ts',
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/__tests__/trustedHostProvider.focused.test.ts',
  'src/__tests__/uiRouting.focused.test.ts',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src/lib/productionAi/capabilityRoutingMatrix.ts',
  'src/lib/productionAi/evidenceGrounding.ts',
  'src/lib/productionAi/fakeTransport.ts',
  'src/lib/productionAi/index.ts',
  'src/lib/productionAi/localDeterministicProjection.ts',
  'src/lib/productionAi/modelContextEnvelope.ts',
  'src/lib/productionAi/modelOutputSchemas.ts',
  'src/lib/productionAi/productionReasoningPath.ts',
  'src/lib/productionAi/providerErrorMapping.ts',
  'src/lib/productionAi/runtimeMode.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/pages/AISettingsPage.tsx',
] as const;

export const PRODUCTION_LLM_WIRING_SRC_CHANGED_FILES = PRODUCTION_LLM_WIRING_CHANGED_FILES
  .filter(file => file.startsWith('src/'));

export const PRODUCTION_LLM_WIRING_FRONTEND_CHANGED_FILES = PRODUCTION_LLM_WIRING_CHANGED_FILES
  .filter(file => !file.startsWith('src-tauri/'));

/** Tracked-only view: git diff omits brand-new untracked files until added. */
export const PRODUCTION_LLM_WIRING_TRACKED_CHANGED_FILES = [
  'src-tauri/src/lib.rs',
  'src-tauri/src/trusted_host.rs',
  'src/App.css',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/salesAgentRealFunctional.focused.test.ts',
  'src/__tests__/salesAgentSessionRuntime.integration.test.ts',
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/pages/AISettingsPage.tsx',
] as const;

export const PRODUCTION_LLM_WIRING_TRACKED_SRC_CHANGED_FILES = PRODUCTION_LLM_WIRING_TRACKED_CHANGED_FILES
  .filter(file => file.startsWith('src/'));

/** reviewDraftQueueBoundary-style projection: src/* plus optional package/lock (none here). */
export const PRODUCTION_LLM_WIRING_SRC_PACKAGE_CHANGED_FILES = PRODUCTION_LLM_WIRING_SRC_CHANGED_FILES;

/** Exact production architecture convergence cohort after the independent P0 review. */
export const PRODUCTION_AI_CONVERGENCE_CHANGED_FILES = [
  'package.json',
  'scripts/cursor_200_gate.ts',
  'scripts/finalize_transport_equivalence_evidence.py',
  'scripts/real_tauri_e2e.py',
  'src-tauri/tauri.e2e.conf.json',
  'src/__tests__/adversarial-100-routing.test.ts',
  'src/__tests__/ai.test.ts',
  'src/__tests__/AIAssistantPage.test.ts',
  'src/__tests__/aiDraft.test.ts',
  'src/__tests__/aiDraft.verticalProfiles.test.ts',
  'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
  'src/__tests__/blind-200-holdout.test.ts',
  'src/__tests__/capabilityRouting.focused.test.ts',
  'src/__tests__/captureCancellationRace.focused.test.ts',
  'src/__tests__/closedSchema.focused.test.ts',
  'src/__tests__/compare-fail-closed.test.ts',
  'src/__tests__/credentialCompensation.focused.test.ts',
  'src/__tests__/crm.releaseGate.e2e.test.ts',
  'src/__tests__/CustomerDetail.aiAnalysis.test.ts',
  'src/__tests__/deterministicPath.focused.test.ts',
  'src/__tests__/evidenceGrounding.focused.test.ts',
  'src/__tests__/evidenceTruthfulness.focused.test.ts',
  'src/__tests__/finalUiRebuild.focused.test.ts',
  'src/__tests__/finalActionMatrix.focused.test.ts',
  'src/__tests__/hostCancellation.focused.test.ts',
  'src/__tests__/independent-holdout-routing.test.ts',
  'src/__tests__/intent-envelope-single-source.test.ts',
  'src/__tests__/legacyCredentialMigration.focused.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/modelCapabilitiesChangedFileCohort.ts',
  'src/__tests__/modelContextEnvelope.focused.test.ts',
  'src/__tests__/modelContextPrivacy.focused.test.ts',
  'src/__tests__/modelSchemaValidation.focused.test.ts',
  'src/__tests__/multimodalProvider.test.ts',
  'src/__tests__/naturalLanguageParaphrase.focused.test.ts',
  'src/__tests__/nested-evidence-grounding.test.ts',
  'src/__tests__/noFrontendSecret.focused.test.ts',
  'src/__tests__/noPageLoadCall.focused.test.ts',
  'src/__tests__/overnightFullStabilization.focused.test.ts',
  'src/__tests__/productionAdapterFakeTransport.focused.test.ts',
  'src/__tests__/productionDependencyGraph.focused.test.ts',
  'src/__tests__/productionDependencyGraphHarness.ts',
  'src/__tests__/productionMockLeakage.focused.test.ts',
  'src/__tests__/providerErrorMapping.focused.test.ts',
  'src/__tests__/realVisionProtocol.focused.test.ts',
  'src/__tests__/reviewer-unseen-language-regression.test.ts',
  'src/__tests__/runtimeTransparency.focused.test.ts',
  'src/__tests__/runtimeMetadataSurfaces.focused.test.ts',
  'src/__tests__/salesAgentActionMatrix.focused.test.ts',
  'src/__tests__/salesAgentConfirmationCard.test.ts',
  'src/__tests__/salesAgentPortfolioSearch.focused.test.ts',
  'src/__tests__/salesAgentProductionHarness.ts',
  'src/__tests__/salesAgentProposalOwnership.focused.test.ts',
  'src/__tests__/salesAgentRealFunctional.focused.test.ts',
  'src/__tests__/salesAgentRealWriteIntent.focused.test.ts',
  'src/__tests__/salesAgentSessionRuntime.integration.test.ts',
  'src/__tests__/salesAgentSessionWriteRouting.integration.test.ts',
  'src/__tests__/salesAgentTauriDbAcceptance.evidence.test.ts',
  'src/__tests__/secretBoundary.focused.test.ts',
  'src/__tests__/semantic-router-adapter.test.ts',
  'src/__tests__/semanticRouterProductionWiring.focused.test.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/__tests__/stage11To13E2E.test.ts',
  'src/__tests__/stage3FinalAlignment.test.ts',
  'src/__tests__/textAIProvider.test.ts',
  'src/__tests__/tauriDbAcceptanceIsolation.focused.test.ts',
  'src/__tests__/tauriE2EIsolation.focused.test.ts',
  'src/__tests__/transportEquivalenceE2ETruth.focused.test.ts',
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/__tests__/trustedHostProvider.focused.test.ts',
  'src/__tests__/uiRouting.focused.test.ts',
  'src/__tests__/visionFormatMatrix.focused.test.ts',
  'src/__tests__/unifiedAgentStage.focused.test.ts',
  'src/App.css',
  'src/App.tsx',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/ai.ts',
  'src/lib/aiDraft.ts',
  'src/lib/backupRestore.ts',
  'src/lib/customerCapture/review.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src/lib/modelCapabilities/types.ts',
  'src/lib/multimodalProvider.ts',
  'src/lib/productionAi/capabilityRoutingMatrix.ts',
  'src/lib/productionAi/evidenceGrounding.ts',
  'src/lib/productionAi/fakeTransport.ts',
  'src/lib/productionAi/index.ts',
  'src/lib/productionAi/localDeterministicProjection.ts',
  'src/lib/productionAi/modelContextEnvelope.ts',
  'src/lib/productionAi/modelOutputSchemas.ts',
  'src/lib/productionAi/productionReasoningPath.ts',
  'src/lib/productionAi/providerErrorMapping.ts',
  'src/lib/productionAi/runtimeMode.ts',
  'src/lib/productionAi/semanticIntentRouter.ts',
  'src/lib/productionAi/visionInput.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/finalActionMatrix.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesAgentTools/semanticPlanning.ts',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/lib/salesAgentTools/writeIntent.ts',
  'src/lib/salesAgentUi/dailyFocus.ts',
  'src/lib/salesAgentUi/formatUserFacingError.ts',
  'src/lib/textAIProvider.ts',
  'src/pages/AIAssistantPage.tsx',
  'src/pages/AISettingsPage.tsx',
  'src/pages/CustomerDetail.tsx',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/src/credential_migration.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/secure_credentials.rs',
  'src-tauri/src/trusted_host.rs',
] as const;
export const PRODUCTION_AI_CONVERGENCE_SRC_CHANGED_FILES = PRODUCTION_AI_CONVERGENCE_CHANGED_FILES.filter(file => file.startsWith('src/'));
export const PRODUCTION_AI_CONVERGENCE_FRONTEND_CHANGED_FILES = PRODUCTION_AI_CONVERGENCE_CHANGED_FILES.filter(file => !file.startsWith('src-tauri/'));
export const PRODUCTION_AI_CONVERGENCE_SRC_PACKAGE_CHANGED_FILES = PRODUCTION_AI_CONVERGENCE_CHANGED_FILES
  .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));
const PRODUCTION_AI_CONVERGENCE_UNTRACKED_FILES = new Set([
  'scripts/cursor_200_gate.ts',
  'scripts/finalize_transport_equivalence_evidence.py',
  'scripts/real_tauri_e2e.py',
  'src/__tests__/adversarial-100-routing.test.ts',
  'src/__tests__/capabilityRouting.focused.test.ts',
  'src/__tests__/blind-200-holdout.test.ts',
  'src/__tests__/captureCancellationRace.focused.test.ts',
  'src/__tests__/closedSchema.focused.test.ts',
  'src/__tests__/compare-fail-closed.test.ts',
  'src/__tests__/credentialCompensation.focused.test.ts',
  'src/__tests__/deterministicPath.focused.test.ts',
  'src/__tests__/evidenceGrounding.focused.test.ts',
  'src/__tests__/evidenceTruthfulness.focused.test.ts',
  'src/__tests__/finalActionMatrix.focused.test.ts',
  'src/__tests__/hostCancellation.focused.test.ts',
  'src/__tests__/independent-holdout-routing.test.ts',
  'src/__tests__/intent-envelope-single-source.test.ts',
  'src/__tests__/legacyCredentialMigration.focused.test.ts',
  'src/__tests__/modelContextEnvelope.focused.test.ts',
  'src/__tests__/modelContextPrivacy.focused.test.ts',
  'src/__tests__/modelSchemaValidation.focused.test.ts',
  'src/__tests__/naturalLanguageParaphrase.focused.test.ts',
  'src/__tests__/nested-evidence-grounding.test.ts',
  'src/__tests__/noFrontendSecret.focused.test.ts',
  'src/__tests__/noPageLoadCall.focused.test.ts',
  'src/__tests__/productionAdapterFakeTransport.focused.test.ts',
  'src/__tests__/productionDependencyGraph.focused.test.ts',
  'src/__tests__/productionDependencyGraphHarness.ts',
  'src/__tests__/productionMockLeakage.focused.test.ts',
  'src/__tests__/providerErrorMapping.focused.test.ts',
  'src/__tests__/realVisionProtocol.focused.test.ts',
  'src/__tests__/reviewer-unseen-language-regression.test.ts',
  'src/__tests__/runtimeTransparency.focused.test.ts',
  'src/__tests__/runtimeMetadataSurfaces.focused.test.ts',
  'src/__tests__/secretBoundary.focused.test.ts',
  'src/__tests__/semantic-router-adapter.test.ts',
  'src/__tests__/semanticRouterProductionWiring.focused.test.ts',
  'src/__tests__/tauriDbAcceptanceIsolation.focused.test.ts',
  'src/__tests__/transportEquivalenceE2ETruth.focused.test.ts',
  'src/__tests__/trustedHostProvider.focused.test.ts',
  'src/__tests__/uiRouting.focused.test.ts',
  'src/__tests__/visionFormatMatrix.focused.test.ts',
  'src/lib/productionAi/capabilityRoutingMatrix.ts',
  'src/lib/productionAi/evidenceGrounding.ts',
  'src/lib/productionAi/fakeTransport.ts',
  'src/lib/productionAi/index.ts',
  'src/lib/productionAi/localDeterministicProjection.ts',
  'src/lib/productionAi/modelContextEnvelope.ts',
  'src/lib/productionAi/modelOutputSchemas.ts',
  'src/lib/productionAi/productionReasoningPath.ts',
  'src/lib/productionAi/providerErrorMapping.ts',
  'src/lib/productionAi/runtimeMode.ts',
  'src/lib/productionAi/semanticIntentRouter.ts',
  'src/lib/productionAi/visionInput.ts',
  'src/lib/salesAgentTools/finalActionMatrix.ts',
  'src-tauri/src/credential_migration.rs',
  'src-tauri/src/secure_credentials.rs',
]);
export const PRODUCTION_AI_CONVERGENCE_TRACKED_CHANGED_FILES = PRODUCTION_AI_CONVERGENCE_CHANGED_FILES.filter(file => !PRODUCTION_AI_CONVERGENCE_UNTRACKED_FILES.has(file));
export const PRODUCTION_AI_CONVERGENCE_TRACKED_SRC_CHANGED_FILES = PRODUCTION_AI_CONVERGENCE_TRACKED_CHANGED_FILES.filter(file => file.startsWith('src/'));

export function hasExactModelCapabilitiesPhase13ChangedFileSet(changedFiles: readonly string[]): boolean {
  return hasExactChangedFileSet(changedFiles, MODEL_CAPABILITIES_PHASE_1_3_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, MODEL_CAPABILITIES_PHASE_4_TRUSTED_HOST_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, MODEL_CAPABILITIES_PHASE_4_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE5_TO_7_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE5_TO_7_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE5_TO_7_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE8_CUSTOMER_MEMORY_FOUNDATION_SRC_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE8_CUSTOMER_MEMORY_FOUNDATION_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE9_PRODUCT_EXPERIENCE_LAYER_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE9_PRODUCT_EXPERIENCE_LAYER_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE10_SALES_AGENT_OPERATING_LAYER_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE10_5_AGENT_INTELLIGENCE_POLISH_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE11_TO_13_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE11_TO_13_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, STAGE11_TO_13_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, FINAL_UI_REBUILD_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, FINAL_UI_REBUILD_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, FINAL_UI_REBUILD_SRC_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, FINAL_UI_REBUILD_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, UNIFIED_AGENT_STAGE_MORPH_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, SALES_AGENT_REAL_FUNCTIONAL_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, SALES_AGENT_REAL_FUNCTIONAL_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_LLM_WIRING_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_LLM_WIRING_SRC_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_LLM_WIRING_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_LLM_WIRING_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_LLM_WIRING_TRACKED_SRC_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_LLM_WIRING_SRC_PACKAGE_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_AI_CONVERGENCE_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_AI_CONVERGENCE_SRC_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_AI_CONVERGENCE_FRONTEND_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_AI_CONVERGENCE_SRC_PACKAGE_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_AI_CONVERGENCE_TRACKED_CHANGED_FILES)
    || hasExactChangedFileSet(changedFiles, PRODUCTION_AI_CONVERGENCE_TRACKED_SRC_CHANGED_FILES);
}

export function hasExactStage8CustomerMemoryFoundationChangedFileSet(changedFiles: readonly string[]): boolean {
  return hasExactChangedFileSet(changedFiles, STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES);
}

function hasExactChangedFileSet(changedFiles: readonly string[], expectedFiles: readonly string[]): boolean {
  return changedFiles.length === expectedFiles.length
    && changedFiles.every(file => expectedFiles.includes(file as never));
}
