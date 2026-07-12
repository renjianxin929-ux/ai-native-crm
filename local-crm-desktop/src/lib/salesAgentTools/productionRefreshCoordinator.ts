/**
 * The sole post-confirmation refresh coordinator.  It deliberately forwards
 * `runCopilot: false`: a successful CRM write must reread projections, never
 * start another Agent/session/provider pass or a secondary write.
 */
export function createProductionRefreshCoordinator(loadSelectedContext: (options: { readonly runCopilot?: boolean }) => Promise<void>) {
  return async function refreshAfterApprovedCrmWrite(): Promise<void> {
    await loadSelectedContext({ runCopilot: false });
  };
}
