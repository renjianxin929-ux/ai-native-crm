/** Visual Orb states for Sales Agent — pure mapping, no side effects. */
export type SalesAgentOrbState =
  | 'idle'
  | 'input-ready'
  | 'listening'
  | 'thinking'
  | 'result-ready'
  | 'awaiting-confirmation'
  | 'blocked';

export type SalesAgentUiPhase =
  | 'idle'
  | 'input-ready'
  | 'listening'
  | 'thinking'
  | 'blocked'
  | 'error';

export interface MapSalesAgentOrbStateInput {
  readonly phase: SalesAgentUiPhase;
  readonly hasResult: boolean;
  readonly hasProposal: boolean;
  readonly voiceListening: boolean;
  readonly sessionBusy: boolean;
}

/**
 * Maps real UI/session signals to Orb presentation.
 * `listening` only when voiceListening is true — never when capture is active.
 * `thinking` when a SalesAgentSession request is in flight.
 * `awaiting-confirmation` when a proposal awaits human confirm (not success).
 */
export function mapSalesAgentOrbState(input: MapSalesAgentOrbStateInput): SalesAgentOrbState {
  if (input.phase === 'blocked' || input.phase === 'error') return 'blocked';
  if (input.voiceListening) return 'listening';
  if (input.sessionBusy || input.phase === 'thinking') return 'thinking';
  if (input.hasProposal) return 'awaiting-confirmation';
  if (input.hasResult) return 'result-ready';
  if (input.phase === 'input-ready') return 'input-ready';
  return 'idle';
}

export function salesAgentOrbStateClass(state: SalesAgentOrbState): string {
  return `agent-orb agent-orb-${state}`;
}
