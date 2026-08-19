/**
 * The sole post-confirmation refresh coordinator.  It deliberately forwards
 * `runCopilot: false`: a successful CRM write must reread projections, never
 * start another Agent/session/provider pass or a secondary write.
 * After selected-customer context, it also refreshes app-level catalog projections
 * (Customer List / Opportunity Board) when a catalog refresher is provided.
 */
export function createProductionRefreshCoordinator(
  loadSelectedContext: (options: { readonly runCopilot?: boolean }) => Promise<void>,
  refreshProductCatalog?: () => Promise<void>,
) {
  return async function refreshAfterApprovedCrmWrite(): Promise<void> {
    await loadSelectedContext({ runCopilot: false });
    if (refreshProductCatalog) await refreshProductCatalog();
  };
}
