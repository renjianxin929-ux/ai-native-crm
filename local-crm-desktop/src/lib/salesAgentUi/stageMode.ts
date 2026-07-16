/** Pure UI stage mode for UNIFIED_AGENT_STAGE morph — no side effects. */

export type UnifiedAgentStageMode =
  | 'input'
  | 'thinking'
  | 'result'
  | 'candidate'
  | 'portfolio'
  | 'proposal'
  | 'clarification'
  | 'error';

export interface ResolveUnifiedAgentStageModeInput {
  readonly sessionBusy: boolean;
  readonly locatingCustomer: boolean;
  readonly phase: 'idle' | 'input-ready' | 'listening' | 'thinking' | 'blocked' | 'error';
  readonly candidateCount: number;
  readonly hasPortfolio?: boolean;
  readonly hasProposal: boolean;
  readonly hasResult: boolean;
  readonly hasWriteSuccess: boolean;
  readonly hasClarification?: boolean;
}

export function resolveUnifiedAgentStageMode(input: ResolveUnifiedAgentStageModeInput): UnifiedAgentStageMode {
  // Priority: blocked/error → clarification → portfolio → candidate → proposal → thinking → result → input
  if (input.phase === 'blocked' || input.phase === 'error') return 'error';
  if (input.hasClarification) return 'clarification';
  if (input.hasPortfolio && input.candidateCount > 0) return 'portfolio';
  if (input.candidateCount > 0) return 'candidate';
  if (input.hasProposal) return 'proposal';
  if (input.sessionBusy || input.locatingCustomer || input.phase === 'thinking') return 'thinking';
  if (input.hasResult || input.hasWriteSuccess) return 'result';
  return 'input';
}
