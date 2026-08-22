export const V0_2_WINDOWS_TEST_REPAIR_FULL_CHANGED_COHORT = [
  'package.json',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/battleCardAtomic.staticGuard.test.ts',
  'src/__tests__/battleCardRawByteScope.repro.test.ts',
  'src/__tests__/crm.releaseGate.e2e.test.ts',
  'src/__tests__/existingWriteCapabilityRegistration.contract.test.ts',
  'src/__tests__/finalUiRebuild.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/no-rag-boundary.focused.test.ts',
  'src/__tests__/stage11To13E2E.test.ts',
  'src/__tests__/transportEquivalenceE2ETruth.focused.test.ts',
  'src/__tests__/unifiedAgentStage.focused.test.ts',
  'src/lib/planner/readResultAdapter.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'vitest.config.ts',
] as const;

export const V0_2_WINDOWS_TEST_REPAIR_SRC_PACKAGE_CHANGED_COHORT =
  V0_2_WINDOWS_TEST_REPAIR_FULL_CHANGED_COHORT.filter(
    file => file.startsWith('src/') || file === 'package.json',
  );

export const V0_2_WINDOWS_TEST_REPAIR_SRC_CHANGED_COHORT =
  V0_2_WINDOWS_TEST_REPAIR_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/'));

/** V0.2 repository-wide lint cleanup and component-boundary repair (2026-08-22). */
export const V0_2_LINT_CLEANUP_FULL_CHANGED_COHORT = [
  ...V0_2_WINDOWS_TEST_REPAIR_FULL_CHANGED_COHORT,
  '.gitattributes',
  '.github/workflows/lint.yml',
  'eslint.config.js',
  'scripts/v02DbFinalGate.ts',
  'src/__tests__/agentReachabilityRouting.focused.test.ts',
  'src/__tests__/aiDraft.test.ts',
  'src/__tests__/battleCard.canonicalSnapshot.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshotRepro.focused.test.ts',
  'src/__tests__/battleCard.cryptoHashRepro.focused.test.ts',
  'src/__tests__/battleCard.envelopeLimit.focused.test.ts',
  'src/__tests__/battleCard.factVerifications.focused.test.ts',
  'src/__tests__/battleCard.goldenSample.guangzhouTinsol.focused.test.ts',
  'src/__tests__/battleCard.productionConstruction.acceptance.test.ts',
  'src/__tests__/battleCard.schema.repository.focused.test.ts',
  'src/__tests__/capabilityExecutionObservationIntegration.contract.test.ts',
  'src/__tests__/capabilityWriteProductionIntegration.contract.test.ts',
  'src/__tests__/chatCapabilityRouting.focused.test.ts',
  'src/__tests__/controlSurface.c1.test.ts',
  'src/__tests__/customerCreateCapability.contract.test.ts',
  'src/__tests__/customerDeleteCapability.contract.test.ts',
  'src/__tests__/customerProfileUpdateCapability.contract.test.ts',
  'src/__tests__/evidenceReadCapabilities.contract.test.ts',
  'src/__tests__/importReadCapabilities.contract.test.ts',
  'src/__tests__/leadWorkbench.e2e.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/noPageLoadCall.focused.test.ts',
  'src/__tests__/productionRefreshCoordinator.integration.test.ts',
  'src/__tests__/promptRuntime.readiness.test.ts',
  'src/__tests__/realDeepSeekChatE2E.test.ts',
  'src/__tests__/salesAgentActionMatrix.focused.test.ts',
  'src/__tests__/salesAgentPortfolioSearch.focused.test.ts',
  'src/__tests__/salesAgentProposalOwnership.focused.test.ts',
  'src/__tests__/salesAgentRealFunctional.focused.test.ts',
  'src/__tests__/salesAgentRealWriteIntent.focused.test.ts',
  'src/__tests__/salesAgentWriteRefresh.integration.test.ts',
  'src/__tests__/semanticRouterProductionWiring.focused.test.ts',
  'src/__tests__/stage9SalesWorkspace.test.ts',
  'src/__tests__/timelineReadCapabilities.contract.test.ts',
  'src/__tests__/uiRouting.focused.test.ts',
  'src/__tests__/v02FinalBindAndI18nProductClosure.focused.test.ts',
  'src/__tests__/v02FinalCandidateCancelClosure.focused.test.ts',
  'src/__tests__/v02FinalConversationLifecycleClosure.focused.test.ts',
  'src/__tests__/v02FinalConversationScopeAndI18nClosure.focused.test.ts',
  'src/__tests__/v02FinalCreateWriteConfirmationTruth.focused.test.ts',
  'src/__tests__/v02FinalCustomerNameAndSelectionAuthority.focused.test.ts',
  'src/__tests__/v02FinalFunctionalTruthClosure.focused.test.ts',
  'src/__tests__/v02FinalGenuinePreviousResultReferenceGate.focused.test.ts',
  'src/__tests__/v02FinalUiCompression.focused.test.tsx',
  'src/__tests__/v02ForegroundBattleCardCoherence.focused.test.ts',
  'src/__tests__/v02ForegroundCustomerCreateConfirm.focused.test.ts',
  'src/__tests__/v02ForegroundCustomerCreateScopeIsolation.focused.test.ts',
  'src/__tests__/visitCreateCapability.contract.test.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/components/aiNative/useSalesAgentRuntime.ts',
  'src/components/battleCard/CopyButton.tsx',
  'src/components/battleCard/ImportWizard.tsx',
  'src/components/controlSurface/EvidenceQuietPanel.tsx',
  'src/components/salesWorkspace/CustomerCaptureContract.tsx',
  'src/components/salesWorkspace/CustomerIntelligencePanel.tsx',
  'src/components/salesWorkspace/SalesCommandCenter.tsx',
  'src/lib/ai.ts',
  'src/lib/backupRestore.ts',
  'src/lib/battleCard/importService.ts',
  'src/lib/battleCard/repository.ts',
  'src/lib/battleCard/stageCardEngine.ts',
  'src/lib/battleCardUi/battleCardViewModels.ts',
  'src/lib/battleCardUi/useCopyFeedback.ts',
  'src/lib/capabilities/execution/engine.ts',
  'src/lib/capabilities/timeline/readAdapter.ts',
  'src/lib/customerDetailUi/customerDetailProjection.ts',
  'src/lib/evidence/evidenceEntryLabel.ts',
  'src/lib/importer.ts',
  'src/lib/leadWorkbench/workflow.ts',
  'src/lib/liveProviderSandboxCall/liveProviderSandboxTransport.ts',
  'src/lib/modelCapabilities/providers.ts',
  'src/lib/planner/runtimeContextMaterializer.ts',
  'src/lib/salesAgentTools/agentSession.ts',
  'src/lib/salesAgentTools/appClock.ts',
  'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
  'src/lib/salesAgentTools/confirmSalesAgentProposal.ts',
  'src/lib/salesAgentTools/confirmedWrite.ts',
  'src/lib/salesAgentTools/operatingLayer.ts',
  'src/lib/salesWorkspace/customerCaptureContract.ts',
  'src/lib/salesWorkspace/customerIntelligence.ts',
  'src/lib/salesWorkspace/salesBrief.ts',
  'src/pages/AISettingsPage.tsx',
  'src/pages/CustomerBattleCardPage.tsx',
  'src/pages/CustomerDetail.tsx',
  'src/pages/DailyBattleReviewPage.tsx',
  'src/pages/LeadImportCenterPage.tsx',
  'src/pages/LeadWorkbenchPage.tsx',
] as const;

export const V0_2_LINT_CLEANUP_APP_CHANGED_COHORT = V0_2_LINT_CLEANUP_FULL_CHANGED_COHORT
  .filter(file => file !== '.gitattributes' && !file.startsWith('.github/')) as readonly string[];

export const V0_2_LINT_CLEANUP_SRC_PACKAGE_CHANGED_COHORT = V0_2_LINT_CLEANUP_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/') || file === 'package.json') as readonly string[];
export const V0_2_LINT_CLEANUP_SRC_CHANGED_COHORT = V0_2_LINT_CLEANUP_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

const V0_2_LINT_CLEANUP_UNTRACKED_SRC_FILES = new Set([
  'src/lib/battleCardUi/useCopyFeedback.ts',
  'src/lib/evidence/evidenceEntryLabel.ts',
  'src/lib/salesAgentTools/confirmSalesAgentProposal.ts',
  'src/lib/salesWorkspace/customerCaptureContract.ts',
  'src/lib/salesWorkspace/customerIntelligence.ts',
  'src/lib/salesWorkspace/salesBrief.ts',
]);
export const V0_2_LINT_CLEANUP_TRACKED_SRC_CHANGED_COHORT = V0_2_LINT_CLEANUP_SRC_CHANGED_COHORT
  .filter(file => !V0_2_LINT_CLEANUP_UNTRACKED_SRC_FILES.has(file)) as readonly string[];
export const V0_2_LINT_CLEANUP_TRACKED_APP_CHANGED_COHORT = V0_2_LINT_CLEANUP_APP_CHANGED_COHORT
  .filter(file => !V0_2_LINT_CLEANUP_UNTRACKED_SRC_FILES.has(file)) as readonly string[];

export const FINAL_USABILITY_CHANGED_FILES = [
  'src-tauri/Cargo.toml',
  'src-tauri/src/bin/migrate_plaintext_credentials.rs',
  'src-tauri/src/credential_migration.rs',
  'src-tauri/src/encrypted_credentials.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/secure_credentials.rs',
  'src-tauri/src/trusted_host.rs',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/ai.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/customer-priority-ranking.focused.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/encrypted-sql-credential.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/intent-envelope-single-source.test.ts',
  'src/__tests__/legacyCredentialMigration.focused.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelRouterRuntime.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/no-rag-boundary.focused.test.ts',
  'src/__tests__/pending-instruction-resume.focused.test.ts',
  'src/__tests__/productionMockLeakage.focused.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/readOnlyAgent.readiness.test.ts',
  'src/__tests__/readOnlyAgentLiveDryRun.readiness.test.ts',
  'src/__tests__/readOnlyAgentSnapshotAdapter.readiness.test.ts',
  'src/__tests__/readOnlySnapshotLoader.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/secretBoundary.focused.test.ts',
  'src/__tests__/semantic-router-adapter.test.ts',
  'src/__tests__/semantic-search-synonyms.focused.test.ts',
  'src/__tests__/semanticRouterProductionWiring.focused.test.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/__tests__/suggestOnlyAgent.readiness.test.ts',
  'src/__tests__/textAIProvider.test.ts',
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/__tests__/trustedHostProvider.focused.test.ts',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/ai.ts',
  'src/lib/db.ts',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src/lib/multimodalProvider.ts',
  'src/lib/productionAi/capabilityRoutingMatrix.ts',
  'src/lib/productionAi/semanticIntentRouter.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/customerPriorityRanking.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'src/lib/salesAgentTools/registry.ts',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/lib/textAIProvider.ts',
  'src/pages/AISettingsPage.tsx',
] as const;

export const FINAL_USABILITY_TRACKED_CHANGED_FILES = [
  'src-tauri/Cargo.toml',
  'src-tauri/src/credential_migration.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/secure_credentials.rs',
  'src-tauri/src/trusted_host.rs',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/ai.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/intent-envelope-single-source.test.ts',
  'src/__tests__/legacyCredentialMigration.focused.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelRouterRuntime.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/productionMockLeakage.focused.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/readOnlyAgent.readiness.test.ts',
  'src/__tests__/readOnlyAgentLiveDryRun.readiness.test.ts',
  'src/__tests__/readOnlyAgentSnapshotAdapter.readiness.test.ts',
  'src/__tests__/readOnlySnapshotLoader.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/secretBoundary.focused.test.ts',
  'src/__tests__/semantic-router-adapter.test.ts',
  'src/__tests__/semanticRouterProductionWiring.focused.test.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/__tests__/suggestOnlyAgent.readiness.test.ts',
  'src/__tests__/textAIProvider.test.ts',
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/__tests__/trustedHostProvider.focused.test.ts',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/ai.ts',
  'src/lib/db.ts',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src/lib/multimodalProvider.ts',
  'src/lib/productionAi/capabilityRoutingMatrix.ts',
  'src/lib/productionAi/semanticIntentRouter.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'src/lib/salesAgentTools/registry.ts',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/lib/textAIProvider.ts',
  'src/pages/AISettingsPage.tsx',
] as const;

export const FINAL_USABILITY_SOURCE_CHANGED_FILES = [
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/ai.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/customer-priority-ranking.focused.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/encrypted-sql-credential.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/intent-envelope-single-source.test.ts',
  'src/__tests__/legacyCredentialMigration.focused.test.ts',
  'src/__tests__/liveProviderSandboxCall.readiness.test.ts',
  'src/__tests__/liveSandboxToSuggestOnlyBridge.readiness.test.ts',
  'src/__tests__/manualLiveProviderSmokeGate.readiness.test.ts',
  'src/__tests__/modelProviderBoundaryContract.readiness.test.ts',
  'src/__tests__/modelProviderReadOnlySandbox.readiness.test.ts',
  'src/__tests__/modelReadOnlyInvocationGate.readiness.test.ts',
  'src/__tests__/modelRouterRuntime.readiness.test.ts',
  'src/__tests__/modelSuggestOnlyOutputGate.readiness.test.ts',
  'src/__tests__/modelSuggestionAdapterBoundary.readiness.test.ts',
  'src/__tests__/modelSuggestionReviewDraftGate.readiness.test.ts',
  'src/__tests__/no-rag-boundary.focused.test.ts',
  'src/__tests__/pending-instruction-resume.focused.test.ts',
  'src/__tests__/productionMockLeakage.focused.test.ts',
  'src/__tests__/readOnlyAISuggestionPanel.readiness.test.ts',
  'src/__tests__/readOnlyAISuggestionService.readiness.test.ts',
  'src/__tests__/readOnlyAgent.readiness.test.ts',
  'src/__tests__/readOnlyAgentLiveDryRun.readiness.test.ts',
  'src/__tests__/readOnlyAgentSnapshotAdapter.readiness.test.ts',
  'src/__tests__/readOnlySnapshotLoader.readiness.test.ts',
  'src/__tests__/reviewDraftQueueBoundary.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
  'src/__tests__/secretBoundary.focused.test.ts',
  'src/__tests__/semantic-router-adapter.test.ts',
  'src/__tests__/semantic-search-synonyms.focused.test.ts',
  'src/__tests__/semanticRouterProductionWiring.focused.test.ts',
  'src/__tests__/stage10SalesAgentOperatingLayer.test.ts',
  'src/__tests__/suggestOnlyAgent.readiness.test.ts',
  'src/__tests__/textAIProvider.test.ts',
  'src/__tests__/trustedHostBoundary.test.ts',
  'src/__tests__/trustedHostProvider.focused.test.ts',
  'src/components/aiNative/SalesAgentInteractionWorkspace.tsx',
  'src/lib/ai.ts',
  'src/lib/db.ts',
  'src/lib/modelCapabilities/trustedHost.ts',
  'src/lib/multimodalProvider.ts',
  'src/lib/productionAi/capabilityRoutingMatrix.ts',
  'src/lib/productionAi/semanticIntentRouter.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/customerPriorityRanking.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'src/lib/salesAgentTools/registry.ts',
  'src/lib/salesAgentTools/trustedHostAdapter.ts',
  'src/lib/textAIProvider.ts',
  'src/pages/AISettingsPage.tsx',
] as const;

export const REGION_PORTFOLIO_QUERY_FIX_CHANGED_FILES = [
  'src/__tests__/semantic-search-synonyms.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
] as const;

/**
 * Battle Card Backend V1（2026-08-01）精确变更集（src/ 下 tracked + untracked）。
 * 守卫收集 git diff + --cached + ls-files --others 并过滤 src/ 前缀，本集合与之精确匹配。
 */
export const BATTLE_CARD_V1_CHANGED_FILES = [
  'src/__tests__/battleCard.adversarial.focused.test.ts',
  'src/__tests__/battleCard.agentWrite.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshot.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshotRepro.focused.test.ts',
  'src/__tests__/battleCard.cryptoHashRepro.focused.test.ts',
  'src/__tests__/battleCard.dailyReview.focused.test.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/battleCard.dataIsolation.focused.test.ts',
  'src/__tests__/battleCard.envelopeLimit.focused.test.ts',
  'src/__tests__/battleCard.factVerifications.focused.test.ts',
  'src/__tests__/battleCard.fixtures.ts',
  'src/__tests__/battleCard.goldenSample.guangzhouTinsol.focused.test.ts',
  'src/__tests__/battleCard.importLifecycle.focused.test.ts',
  'src/__tests__/battleCard.parser.focused.test.ts',
  'src/__tests__/battleCard.productionConstruction.acceptance.test.ts',
  'src/__tests__/battleCard.schema.repository.focused.test.ts',
  'src/__tests__/battleCard.stageCard.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/fixtures/battle-card/guangzhou-dianxiu-appendix-a-raw.txt',
  'src/__tests__/salesAgentProposalOwnership.focused.test.ts',
  'src/lib/battleCard/agentTools.ts',
  'src/lib/battleCard/dailyReview.ts',
  'src/lib/battleCard/importService.ts',
  'src/lib/battleCard/parser.ts',
  'src/lib/battleCard/repository.ts',
  'src/lib/battleCard/schema.ts',
  'src/lib/battleCard/stageCardEngine.ts',
  'src/lib/battleCard/stageRules.ts',
  'src/lib/battleCard/types.ts',
  'src/lib/db.ts',
  'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
  'src/lib/salesAgentTools/confirmedWrite.ts',
  'src/lib/salesAgentTools/sessionWriteStateStore.ts',
  'src/lib/types.ts',
] as const;

/** Battle Card V1 tracked 修改集（git diff / --cached 可见部分，供无 untracked 收集的守卫精确匹配）。 */
export const BATTLE_CARD_V1_TRACKED_CHANGED_FILES = [
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/salesAgentProposalOwnership.focused.test.ts',
  'src/lib/db.ts',
  'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
  'src/lib/salesAgentTools/confirmedWrite.ts',
  'src/lib/salesAgentTools/sessionWriteStateStore.ts',
  'src/lib/types.ts',
] as const;

/**
 * Battle Card V1 完整 changed cohort（FULL_CHANGED_COHORT）：工作树全部真实变更，
 * 含 src / src-tauri / migrations / tests / fixtures / scripts / docs。
 * 运行产物（review JSON、日志、截图）已移出仓库，不进入本集合。
 */
export const BATTLE_CARD_V1_FULL_CHANGED_COHORT = [
  ...BATTLE_CARD_V1_CHANGED_FILES,
  'docs/architecture/customer-battle-card-backend-v1.md',
  'scripts/battle_card_migration_acceptance.py',
  'src-tauri/migrations/005_customer_battle_card.sql',
  'src-tauri/tauri.battleCardReview.conf.json',
] as const;

/**
 * Battle Card UI V1（2026-08-02）完整变更集（tracked + untracked，精确双向匹配）。
 * 后端冻结 cohort 见 BATTLE_CARD_V1_FULL_CHANGED_COHORT（保持原样存档）。
 */
export const BATTLE_CARD_UI_V1_FULL_CHANGED_COHORT = [
  'package-lock.json',
  'package.json',
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/battleCardUi.components.test.tsx',
  'src/__tests__/battleCardUi.integration.test.ts',
  'src/__tests__/battleCardUi.productionConstruction.test.ts',
  'src/__tests__/battleCardUi.viewModel.test.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentBattleCardEntry.tsx',
  'src/components/aiNative/useSalesAgentRuntime.ts',
  'src/components/battleCard/ActionCardView.tsx',
  'src/components/battleCard/AgentSidecar.tsx',
  'src/components/battleCard/BattleCardHeader.tsx',
  'src/components/battleCard/BattleCardStatusBanner.tsx',
  'src/components/battleCard/CopyButton.tsx',
  'src/components/battleCard/DailyReviewQueueRow.tsx',
  'src/components/battleCard/EvidenceDrawer.tsx',
  'src/components/battleCard/FeishuTalkTrackBlock.tsx',
  'src/components/battleCard/ImportWizard.tsx',
  'src/components/battleCard/KeyHypothesisBlock.tsx',
  'src/components/battleCard/NextBestActionBlock.tsx',
  'src/components/battleCard/PeerReferencesBlock.tsx',
  'src/components/battleCard/SolutionReferenceCardView.tsx',
  'src/components/battleCard/VersionHistoryPanel.tsx',
  'src/components/battleCard/battleCard.css',
  'src/lib/battleCardUi/battleCardClient.ts',
  'src/lib/battleCardUi/battleCardLabels.ts',
  'src/lib/battleCardUi/battleCardViewModels.ts',
  'src/lib/battleCardUi/utf8.ts',
  'src/pages/CustomerBattleCardPage.tsx',
  'src/pages/CustomerDetail.tsx',
  'src/pages/DailyBattleReviewPage.tsx',
] as const;

/** UI 轮变更集（readiness 门禁过滤口径：src/ + package.json + lock.yaml，不含 package-lock.json）。 */
export const BATTLE_CARD_UI_V1_CHANGED_FILES = BATTLE_CARD_UI_V1_FULL_CHANGED_COHORT.filter(file => file !== 'package-lock.json') as readonly string[];

/** UI 轮 src-only 变更集（git diff + cached + untracked 后过滤 src/ 前缀的门禁口径）。 */
export const BATTLE_CARD_UI_V1_SRC_CHANGED_FILES = BATTLE_CARD_UI_V1_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/')) as readonly string[];

/** UI 轮 tracked 修改集（git diff / --cached 可见部分，无 untracked）。 */
export const BATTLE_CARD_UI_V1_TRACKED_CHANGED_FILES = [
  'package-lock.json',
  'package.json',
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/pages/CustomerDetail.tsx',
] as const;

/**
 * Battle Card Atomic Transaction Repair R2（2026-08-02 深夜）：完整变更集 = 上轮 UI 35 + 本轮 6。
 * 后端冻结 cohort 见 BATTLE_CARD_V1_FULL_CHANGED_COHORT（保持原样存档）。
 */
export const BATTLE_CARD_UI_V1_R2_FULL_CHANGED_COHORT = [
  ...BATTLE_CARD_UI_V1_FULL_CHANGED_COHORT,
  'src-tauri/src/battle_card_transactions.rs',
  'src-tauri/src/lib.rs',
  'src/__tests__/battleCardAtomic.productionConstruction.test.ts',
  'src/__tests__/battleCardAtomic.staticGuard.test.ts',
  'src/lib/battleCard/importService.ts',
  'src/lib/battleCard/repository.ts',
  'src/lib/battleCardUi/atomicWriteBackend.ts',
] as const;

/** R2 变更集（readiness 门禁过滤口径：src/ + package.json + lock.yaml，不含 package-lock.json）。 */
export const BATTLE_CARD_UI_V1_R2_CHANGED_FILES = BATTLE_CARD_UI_V1_R2_FULL_CHANGED_COHORT.filter(file => file !== 'package-lock.json') as readonly string[];

/** R2 src-only 变更集（git diff + cached + untracked 后过滤 src/ 前缀的门禁口径）。 */
export const BATTLE_CARD_UI_V1_R2_SRC_CHANGED_FILES = BATTLE_CARD_UI_V1_R2_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/')) as readonly string[];

/** R2 src/ + package.json 口径（部分 readiness 门禁把 package.json 单列）。 */
export const BATTLE_CARD_UI_V1_R2_SRC_PACKAGE_CHANGED_FILES = BATTLE_CARD_UI_V1_R2_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/') || file === 'package.json') as readonly string[];

/** R2 tracked 修改集（git diff / --cached 可见部分，无 untracked）。 */
export const BATTLE_CARD_UI_V1_R2_TRACKED_CHANGED_FILES = [
  ...BATTLE_CARD_UI_V1_TRACKED_CHANGED_FILES,
  'src-tauri/src/lib.rs',
  'src/lib/battleCard/importService.ts',
  'src/lib/battleCard/repository.ts',
] as const;
/**
 * Battle Card Authoritative Provenance R3（2026-08-03）：完整变更集 = R2 42 + 本轮 5。
 */
/**
 * Battle Card Raw Byte Scope & Sealed Run R4（2026-08-03 第二轮）：完整变更集 = 64 文件（独立核算）。
 */
export const BATTLE_CARD_UI_V1_R4_FULL_CHANGED_COHORT = [
  'package-lock.json',
  'package.json',
  'src-tauri/src/battle_card_authoritative.rs',
  'src-tauri/src/battle_card_transactions.rs',
  'src-tauri/src/lib.rs',
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/battleCard.adversarial.focused.test.ts',
  'src/__tests__/battleCard.agentWrite.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshot.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshotRepro.focused.test.ts',
  'src/__tests__/battleCard.cryptoHashRepro.focused.test.ts',
  'src/__tests__/battleCard.dailyReview.focused.test.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/battleCard.dataIsolation.focused.test.ts',
  'src/__tests__/battleCard.envelopeLimit.focused.test.ts',
  'src/__tests__/battleCard.factVerifications.focused.test.ts',
  'src/__tests__/battleCard.goldenSample.guangzhouTinsol.focused.test.ts',
  'src/__tests__/battleCard.importLifecycle.focused.test.ts',
  'src/__tests__/battleCard.productionConstruction.acceptance.test.ts',
  'src/__tests__/battleCard.stageCard.focused.test.ts',
  'src/__tests__/battleCardAppplicability.contract.test.ts',
  'src/__tests__/battleCardAtomic.productionConstruction.test.ts',
  'src/__tests__/battleCardAtomic.staticGuard.test.ts',
  'src/__tests__/battleCardRawByteScope.repro.test.ts',
  'src/__tests__/battleCardUi.components.test.tsx',
  'src/__tests__/battleCardUi.integration.test.ts',
  'src/__tests__/battleCardUi.productionConstruction.test.ts',
  'src/__tests__/battleCardUi.viewModel.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/components/aiNative/SalesAgentBattleCardEntry.tsx',
  'src/components/aiNative/useSalesAgentRuntime.ts',
  'src/components/battleCard/ActionCardView.tsx',
  'src/components/battleCard/AgentSidecar.tsx',
  'src/components/battleCard/BattleCardHeader.tsx',
  'src/components/battleCard/BattleCardStatusBanner.tsx',
  'src/components/battleCard/CopyButton.tsx',
  'src/components/battleCard/DailyReviewQueueRow.tsx',
  'src/components/battleCard/EvidenceDrawer.tsx',
  'src/components/battleCard/FeishuTalkTrackBlock.tsx',
  'src/components/battleCard/ImportWizard.tsx',
  'src/components/battleCard/KeyHypothesisBlock.tsx',
  'src/components/battleCard/NextBestActionBlock.tsx',
  'src/components/battleCard/PeerReferencesBlock.tsx',
  'src/components/battleCard/SolutionReferenceCardView.tsx',
  'src/components/battleCard/VersionHistoryPanel.tsx',
  'src/components/battleCard/battleCard.css',
  'src/lib/battleCard/agentTools.ts',
  'src/lib/battleCard/applicability-contract-v1.json',
  'src/lib/battleCard/applicabilityContract.ts',
  'src/lib/battleCard/importService.ts',
  'src/lib/battleCard/parser.ts',
  'src/lib/battleCard/repository.ts',
  'src/lib/battleCard/types.ts',
  'src/lib/battleCardUi/applicabilityDerivation.ts',
  'src/lib/battleCardUi/atomicWriteBackend.ts',
  'src/lib/battleCardUi/battleCardClient.ts',
  'src/lib/battleCardUi/battleCardLabels.ts',
  'src/lib/battleCardUi/battleCardViewModels.ts',
  'src/lib/battleCardUi/utf8.ts',
  'src/pages/CustomerBattleCardPage.tsx',
  'src/pages/CustomerDetail.tsx',
  'src/pages/DailyBattleReviewPage.tsx',
] as const;

/** R4 变更集（readiness 门禁过滤口径：src/ + package.json + lock.yaml，不含 package-lock.json）。 */
export const BATTLE_CARD_UI_V1_R4_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_FULL_CHANGED_COHORT.filter(file => file !== 'package-lock.json') as readonly string[];

/** R4 src-only 变更集。 */
export const BATTLE_CARD_UI_V1_R4_SRC_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/')) as readonly string[];

/** R4 src/ + package.json 口径。 */
export const BATTLE_CARD_UI_V1_R4_SRC_PACKAGE_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/') || file === 'package.json') as readonly string[];

/** R4 tracked 修改集。 */
export const BATTLE_CARD_UI_V1_R4_TRACKED_CHANGED_FILES = [
  'package-lock.json',
  'package.json',
  'src-tauri/src/lib.rs',
  'src/App.css',
  'src/App.tsx',
  'src/__tests__/battleCard.adversarial.focused.test.ts',
  'src/__tests__/battleCard.agentWrite.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshot.focused.test.ts',
  'src/__tests__/battleCard.canonicalSnapshotRepro.focused.test.ts',
  'src/__tests__/battleCard.cryptoHashRepro.focused.test.ts',
  'src/__tests__/battleCard.dailyReview.focused.test.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/battleCard.dataIsolation.focused.test.ts',
  'src/__tests__/battleCard.envelopeLimit.focused.test.ts',
  'src/__tests__/battleCard.factVerifications.focused.test.ts',
  'src/__tests__/battleCard.goldenSample.guangzhouTinsol.focused.test.ts',
  'src/__tests__/battleCard.importLifecycle.focused.test.ts',
  'src/__tests__/battleCard.productionConstruction.acceptance.test.ts',
  'src/__tests__/battleCard.stageCard.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/lib/battleCard/agentTools.ts',
  'src/lib/battleCard/importService.ts',
  'src/lib/battleCard/parser.ts',
  'src/lib/battleCard/repository.ts',
  'src/lib/battleCard/types.ts',
  'src/pages/CustomerDetail.tsx',
] as const;

/**
 * Battle Card Textarea Canonicalization & CRLF Parser R5（2026-08-03）：
 * 只收紧同一 64 文件原始字节合同，不引入 UI、路由、迁移或额外变更路径。
 */
export const BATTLE_CARD_UI_V1_R5_FULL_CHANGED_COHORT = BATTLE_CARD_UI_V1_R4_FULL_CHANGED_COHORT;
export const BATTLE_CARD_UI_V1_R5_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_CHANGED_FILES;
export const BATTLE_CARD_UI_V1_R5_SRC_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_SRC_CHANGED_FILES;
export const BATTLE_CARD_UI_V1_R5_SRC_PACKAGE_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_SRC_PACKAGE_CHANGED_FILES;
export const BATTLE_CARD_UI_V1_R5_TRACKED_CHANGED_FILES = BATTLE_CARD_UI_V1_R4_TRACKED_CHANGED_FILES;

/**
 * Battle Card Generic Subject Exclusion R6（2026-08-04）：
 * 只调整 Parser 的通用主体排除、其聚焦测试与本 Cohort 守卫；UI、Rust 与事务层保持冻结。
 */
export const BATTLE_CARD_UI_V1_R6_FULL_CHANGED_COHORT = [
  ...BATTLE_CARD_UI_V1_R4_FULL_CHANGED_COHORT,
  'src/__tests__/battleCard.parser.focused.test.ts',
] as const;
export const BATTLE_CARD_UI_V1_R6_CHANGED_FILES = BATTLE_CARD_UI_V1_R6_FULL_CHANGED_COHORT.filter(file => file !== 'package-lock.json') as readonly string[];
export const BATTLE_CARD_UI_V1_R6_SRC_CHANGED_FILES = BATTLE_CARD_UI_V1_R6_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/')) as readonly string[];
export const BATTLE_CARD_UI_V1_R6_SRC_PACKAGE_CHANGED_FILES = BATTLE_CARD_UI_V1_R6_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/') || file === 'package.json') as readonly string[];
export const BATTLE_CARD_UI_V1_R6_TRACKED_CHANGED_FILES = [
  ...BATTLE_CARD_UI_V1_R4_TRACKED_CHANGED_FILES,
  'src/__tests__/battleCard.parser.focused.test.ts',
] as const;

/**
 * Fresh Profile Schema Runtime Repair（2026-08-04）：默认构建的 Schema 初始化
 * single-flight、旧库指针补齐与 Customer 投影闭合合同。该集合刻意不包含 UI、
 * Parser、Fact Authority、事务或 Provider 文件。
 */
export const FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_FULL_CHANGED_COHORT = [
  'src-tauri/migrations/001_initial.sql',
  'src-tauri/migrations/005_customer_battle_card.sql',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/freshProfileSchemaRuntime.repair.test.ts',
  'src/lib/db.ts',
] as const;

export const FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_SRC_CHANGED_COHORT = FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

export const FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_TRACKED_CHANGED_COHORT = [
  'src-tauri/migrations/001_initial.sql',
  'src-tauri/migrations/005_customer_battle_card.sql',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/lib/db.ts',
] as const;

/**
 * Mac Real-App Customer Discovery Fix（2026-08-12）：filterNormalization 名称-地区词
 * 冲突修复（完整客户名内嵌地区词被 KNOWN_REGIONS 抢占为 region 过滤，导致真实
 * Mac DB 中 region 为空的客户无法通过名称解析）+ macOS 真实 GUI E2E 基础设施
 * （嵌入式 WebDriver server 注册 + E2E 驱动脚本 macOS 适配）+ 本次变更的守卫登记文件。
 */
export const MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_FULL_CHANGED_COHORT = [
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/salesAgentPortfolioSearch.focused.test.ts',
  'src/__tests__/confirmedActionContract.readiness.test.ts',
  'src/__tests__/modelRouterRuntime.readiness.test.ts',
  'src/__tests__/readOnlyAgent.readiness.test.ts',
  'src/__tests__/readOnlyAgentLiveDryRun.readiness.test.ts',
  'src/__tests__/readOnlyAgentSnapshotAdapter.readiness.test.ts',
  'src/__tests__/readOnlySnapshotLoader.readiness.test.ts',
  'src/__tests__/suggestOnlyAgent.readiness.test.ts',
  'src/__tests__/tauriE2EIsolation.focused.test.ts',
  'scripts/real_tauri_e2e.py',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/build.rs',
  'src-tauri/capabilities/e2e-webdriver.json',
  'src-tauri/src/lib.rs',
  'src-tauri/tauri.e2e.conf.json',
] as const;

export const MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_SRC_CHANGED_COHORT = MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

/**
 * V0.1 Release Candidate（2026-08-12 二审）：在 Mac Real-App Customer Discovery Fix
 * 19 文件基础上，追加 V0.1 版本元数据调整（package.json / tauri.conf.json /
 * Cargo.toml / Cargo.lock / src/lib/version.ts / src/__tests__/version.test.ts 中
 * 不在 MAC cohort 的部分）。纯 release metadata，不涉及业务行为。
 */
export const V0_1_RC_FULL_CHANGED_COHORT = [
  ...MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_FULL_CHANGED_COHORT,
  'package.json',
  'src-tauri/tauri.conf.json',
  'src/lib/version.ts',
  'src/__tests__/version.test.ts',
  'V0_1_RC_ARTIFACT_MANIFEST.md',
] as const;

/** src/ 前缀口径的 V0.1 RC cohort（readiness 守卫只收集 src/ 文件）。 */
export const V0_1_RC_SRC_CHANGED_COHORT = V0_1_RC_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

/**
 * V0.1 Final Real-App Golden Journey Fix（2026-08-13）：真人验收发现的三个
 * release blocker 修复——A 命名客户 scope 解析（filterNormalization 名称动词
 * 前缀剥离 + agentIntentEnvelope 分析分支携带 portfolio_filters + controller
 * scope gate 前实体解析）、B 结构化模型输出契约（trusted_host extract_output
 * 容忍 fenced JSON + envelope 携带 closed schema 字段规格注入 provider prompt +
 * modelOutputSchemas 规格单源）、C 运行时 UI 状态五分类（runtimeMode 不再把
 * schema invalid 误报为“模型不可用”）。守卫登记文件随之更新。
 */
export const V0_1_GOLDEN_JOURNEY_FIX_FULL_CHANGED_COHORT = [
  'src-tauri/src/trusted_host.rs',
  'src/lib/productionAi/modelContextEnvelope.ts',
  'src/lib/productionAi/modelOutputSchemas.ts',
  'src/lib/productionAi/productionReasoningPath.ts',
  'src/lib/productionAi/runtimeMode.ts',
  'src/lib/salesAgentTools/agentIntentEnvelope.ts',
  'src/lib/salesAgentTools/filterNormalization.ts',
  'src/lib/salesAgentTools/interactionController.ts',
  'src/__tests__/goldenJourneyFix.focused.test.ts',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/transportEquivalenceE2ETruth.focused.test.ts',
  'src/__tests__/deepseekLiveContract.focused.test.ts',
  'scripts/real_tauri_e2e.py',
  'V0_1_FINAL_FIX_REPORT.md',
] as const;

/** src/ 前缀口径（readiness 守卫只收集 src/ 文件）。 */
export const V0_1_GOLDEN_JOURNEY_FIX_SRC_CHANGED_COHORT = V0_1_GOLDEN_JOURNEY_FIX_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

/**
 * V0.1 Golden Journey Fix — live DeepSeek provider evidence increment
 * (2026-08-13)：真实 provider contract 验证（探测 + env-guarded live 测试）
 * 及其报告/守卫登记更新。上一提交（1799a48）已含其余 12 个文件。
 */
export const V0_1_GOLDEN_JOURNEY_FIX_LIVE_PROVIDER_EVIDENCE_FULL_CHANGED_COHORT = [
  'V0_1_FINAL_FIX_REPORT.md',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
  'src/__tests__/deepseekLiveContract.focused.test.ts',
] as const;

/** src/ 前缀口径。 */
export const V0_1_GOLDEN_JOURNEY_FIX_LIVE_PROVIDER_EVIDENCE_SRC_CHANGED_COHORT = V0_1_GOLDEN_JOURNEY_FIX_LIVE_PROVIDER_EVIDENCE_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

/**
 * V0.1 Golden Journey Fix — 重新打包 artifact manifest 更新(2026-08-13 11:46)。
 * 仅更新 V0_1_RC_ARTIFACT_MANIFEST.md(新 HEAD 889ec11/SHA256/验证汇总);
 * 打包产物 .app/.dmg 在 src-tauri/target/ 下,被 gitignore 排除,不进提交。
 */
export const V0_1_GOLDEN_JOURNEY_FIX_REPACK_MANIFEST_CHANGED_COHORT = [
  'V0_1_RC_ARTIFACT_MANIFEST.md',
  'src/__tests__/finalUsabilityChangedFileCohort.ts',
  'src/__tests__/battleCard.dataFidelity.focused.test.ts',
] as const;

/** src/ 前缀口径。 */
export const V0_1_GOLDEN_JOURNEY_FIX_REPACK_MANIFEST_SRC_CHANGED_COHORT = V0_1_GOLDEN_JOURNEY_FIX_REPACK_MANIFEST_CHANGED_COHORT
  .filter(file => file.startsWith('src/')) as readonly string[];

/** src/ + package.json（readiness 守卫的 src/+package.json+lock.yaml 口径）。 */
export const V0_1_RC_SRC_PACKAGE_CHANGED_COHORT = V0_1_RC_FULL_CHANGED_COHORT
  .filter(file => file.startsWith('src/') || file === 'package.json') as readonly string[];
export const BATTLE_CARD_UI_V1_R3_FULL_CHANGED_COHORT = [
  ...BATTLE_CARD_UI_V1_R2_FULL_CHANGED_COHORT,
  'src-tauri/src/battle_card_authoritative.rs',
  'src/__tests__/battleCardAppplicability.contract.test.ts',
  'src/__tests__/battleCard.canonicalSnapshot.focused.test.ts',
  'src/__tests__/battleCard.cryptoHashRepro.focused.test.ts',
  'src/__tests__/battleCard.factVerifications.focused.test.ts',
  'src/lib/battleCard/applicability-contract-v1.json',
  'src/lib/battleCard/applicabilityContract.ts',
  'src/lib/battleCard/parser.ts',
  'src/lib/battleCard/types.ts',
  'src/lib/battleCardUi/applicabilityDerivation.ts',
] as const;

/** R3 变更集（readiness 门禁过滤口径：src/ + package.json + lock.yaml，不含 package-lock.json）。 */
export const BATTLE_CARD_UI_V1_R3_CHANGED_FILES = BATTLE_CARD_UI_V1_R3_FULL_CHANGED_COHORT.filter(file => file !== 'package-lock.json') as readonly string[];

/** R3 src-only 变更集。 */
export const BATTLE_CARD_UI_V1_R3_SRC_CHANGED_FILES = BATTLE_CARD_UI_V1_R3_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/')) as readonly string[];

/** R3 src/ + package.json 口径。 */
export const BATTLE_CARD_UI_V1_R3_SRC_PACKAGE_CHANGED_FILES = BATTLE_CARD_UI_V1_R3_FULL_CHANGED_COHORT.filter(file => file.startsWith('src/') || file === 'package.json') as readonly string[];

/** R3 tracked 修改集。 */
export const BATTLE_CARD_UI_V1_R3_TRACKED_CHANGED_FILES = [
  ...BATTLE_CARD_UI_V1_R2_TRACKED_CHANGED_FILES,
  'src/__tests__/battleCard.canonicalSnapshot.focused.test.ts',
  'src/__tests__/battleCard.cryptoHashRepro.focused.test.ts',
  'src/__tests__/battleCard.factVerifications.focused.test.ts',
  'src/lib/battleCard/parser.ts',
  'src/lib/battleCard/types.ts',
] as const;

function hasSameNormalizedFileSet(actualFiles: readonly string[], expectedFiles: readonly string[]): boolean {
  const actual = new Set(actualFiles.map(file => file.replace(/\\/g, '/').replace(/^local-crm-desktop\//, '')));
  const expected = new Set(expectedFiles);
  return actual.size === expected.size
    && [...actual].every(file => expected.has(file))
    && [...expected].every(file => actual.has(file));
}

export function hasExactFinalUsabilityChangedFileSet(actualFiles: readonly string[]): boolean {
  return hasSameNormalizedFileSet(actualFiles, V0_2_WINDOWS_TEST_REPAIR_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_WINDOWS_TEST_REPAIR_SRC_PACKAGE_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_WINDOWS_TEST_REPAIR_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_LINT_CLEANUP_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_LINT_CLEANUP_APP_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_LINT_CLEANUP_SRC_PACKAGE_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_LINT_CLEANUP_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_LINT_CLEANUP_TRACKED_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_2_LINT_CLEANUP_TRACKED_APP_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, FINAL_USABILITY_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, FINAL_USABILITY_SOURCE_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, REGION_PORTFOLIO_QUERY_FIX_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_V1_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_V1_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_SRC_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R2_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R2_SRC_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R2_SRC_PACKAGE_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R2_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R3_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R3_SRC_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R3_SRC_PACKAGE_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R3_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R4_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R4_SRC_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R4_SRC_PACKAGE_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R4_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R5_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R5_SRC_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R5_SRC_PACKAGE_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R5_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R6_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R6_SRC_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R6_SRC_PACKAGE_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R6_TRACKED_CHANGED_FILES)
    || hasSameNormalizedFileSet(actualFiles, FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_TRACKED_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_RC_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_RC_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_RC_SRC_PACKAGE_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_GOLDEN_JOURNEY_FIX_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_GOLDEN_JOURNEY_FIX_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_GOLDEN_JOURNEY_FIX_LIVE_PROVIDER_EVIDENCE_FULL_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_GOLDEN_JOURNEY_FIX_LIVE_PROVIDER_EVIDENCE_SRC_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_GOLDEN_JOURNEY_FIX_REPACK_MANIFEST_CHANGED_COHORT)
    || hasSameNormalizedFileSet(actualFiles, V0_1_GOLDEN_JOURNEY_FIX_REPACK_MANIFEST_SRC_CHANGED_COHORT);
}

export function hasExactFinalUsabilityTrackedChangedFileSet(actualFiles: readonly string[]): boolean {
  return hasSameNormalizedFileSet(actualFiles, FINAL_USABILITY_TRACKED_CHANGED_FILES);
}
