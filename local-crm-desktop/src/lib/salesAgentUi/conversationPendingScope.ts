/**
 * Customer-bound pending resume guard.
 * Human navigation to another customer must discard stale continue/submit.
 * Agent internal bind (same expected customer) must resume.
 */

export interface CustomerBoundPending {
  readonly prompt: string;
  readonly expectedCustomerId: string | null;
}

export type PendingResumeDecision =
  | { readonly action: 'resume'; readonly prompt: string }
  | { readonly action: 'discard'; readonly reason: 'missing' | 'scope_mismatch' };

export function bindPendingPrompt(
  prompt: string,
  expectedCustomerId: string | null,
): CustomerBoundPending {
  return { prompt, expectedCustomerId };
}

export function decideCustomerBoundPendingResume(
  pending: CustomerBoundPending | null,
  currentCustomerId: string | null,
): PendingResumeDecision {
  if (!pending) return { action: 'discard', reason: 'missing' };
  if (pending.expectedCustomerId !== currentCustomerId) {
    return { action: 'discard', reason: 'scope_mismatch' };
  }
  return { action: 'resume', prompt: pending.prompt };
}

export function isInternalCustomerBind(
  pending: CustomerBoundPending | null,
  currentCustomerId: string | null,
): boolean {
  return decideCustomerBoundPendingResume(pending, currentCustomerId).action === 'resume';
}
