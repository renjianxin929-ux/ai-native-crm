import type { ContextSnapshot } from '../../lib/context/types';
import type { VerticalProfile } from '../../lib/verticalAIProfiles/types';

export interface Stage2ArchitectureStatusProps {
  context: ContextSnapshot;
  profile: VerticalProfile;
}

export function Stage2ArchitectureStatus({ context, profile }: Stage2ArchitectureStatusProps) {
  return (
    <section className="card" aria-label="Stage2 AI-native architecture status">
      <h3 className="section-title">Stage2 Context + Vertical Profile</h3>
      <dl>
        <div><dt>Vertical profile</dt><dd>{profile.identity.name} ({profile.identity.id})</dd></div>
        <div><dt>Context window</dt><dd>{context.timeWindow.from} — {context.timeWindow.to}</dd></div>
        <div><dt>CRM facts</dt><dd>{context.customers.length} customers / {context.accounts.length} accounts</dd></div>
        <div><dt>Recent interactions</dt><dd>{context.recentInteractions.length} / {context.maxInteractions} maximum</dd></div>
        <div><dt>Evidence identifiers</dt><dd>{context.evidenceIdentifiers.length}</dd></div>
        <div><dt>Reasoning boundary</dt><dd>Sandbox abstraction only; no provider or network</dd></div>
        <div><dt>Review boundary</dt><dd>Human review required; not executable</dd></div>
        <div><dt>Persistence</dt><dd>No CRM Write / no reasoning-result persistence</dd></div>
      </dl>
    </section>
  );
}
