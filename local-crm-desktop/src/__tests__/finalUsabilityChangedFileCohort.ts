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
  return hasSameNormalizedFileSet(actualFiles, FINAL_USABILITY_CHANGED_FILES)
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
    || hasSameNormalizedFileSet(actualFiles, BATTLE_CARD_UI_V1_R6_TRACKED_CHANGED_FILES);
}

export function hasExactFinalUsabilityTrackedChangedFileSet(actualFiles: readonly string[]): boolean {
  return hasSameNormalizedFileSet(actualFiles, FINAL_USABILITY_TRACKED_CHANGED_FILES);
}
