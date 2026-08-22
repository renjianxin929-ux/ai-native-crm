import type { SalesAgentSession, SafeWriteBoundary } from './agentSession';
import { approvedCrmWriteBoundary } from './approvedCrmWriteBoundary';
import type { AgentWriteProposal } from './confirmedWrite';
import { SALES_AGENT_APP_CLOCK } from './appClock';

/** Confirm by stable proposal identity, then refresh the caller's read projection. */
export async function confirmSalesAgentProposal(
  session: SalesAgentSession,
  proposal: AgentWriteProposal,
  onRefresh: () => Promise<void>,
  boundary: SafeWriteBoundary = approvedCrmWriteBoundary,
) {
  const result = await session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce ?? '',
    confirmed_at: SALES_AGENT_APP_CLOCK.now(),
  }, boundary);
  await onRefresh();
  return result;
}
