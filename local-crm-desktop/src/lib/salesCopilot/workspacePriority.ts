import type { ContextSnapshot } from '../context/types';
import type { ReasoningProvider } from '../salesAgent/provider';
import type { SalesPriorityResult } from './types';
import { runSalesCopilotWorkflow } from './workflow';

export const MAX_WORKSPACE_PRIORITY_CANDIDATES = 5;

export async function buildBoundedWorkspaceSalesPriority(input: {
  request_id: string;
  customer_ids: readonly string[];
  profile_id: string;
  provider: ReasoningProvider;
  load_read_only_context: (customerId: string) => Promise<ContextSnapshot>;
  clock?: () => string;
}): Promise<SalesPriorityResult> {
  const customerIds = [...new Set(input.customer_ids.filter(id => id.trim()))]
    .slice(0, MAX_WORKSPACE_PRIORITY_CANDIDATES);
  if (customerIds.length < 2) throw new Error('Workspace Sales Priority requires at least two available customers.');

  const contexts: ContextSnapshot[] = [];
  for (const customerId of customerIds) {
    const context = await input.load_read_only_context(customerId);
    if (context.readOnly !== true || !context.customers.some(customer => customer.customerId === customerId)) {
      throw new Error(`Priority candidate ${customerId} did not resolve to a matching read-only context.`);
    }
    contexts.push(context);
  }

  const result = await runSalesCopilotWorkflow({
    kind: 'sales_priority', request_id: input.request_id, contexts,
    profile_id: input.profile_id, provider: input.provider, clock: input.clock,
  });
  if (result.kind !== 'sales_priority') throw new Error('Unexpected Copilot workflow result.');
  return result;
}
