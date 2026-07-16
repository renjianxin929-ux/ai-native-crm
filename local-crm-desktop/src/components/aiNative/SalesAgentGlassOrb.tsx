import type { SalesAgentOrbState } from '../../lib/salesAgentUi/orbState';

/** Transparent glass Orb — SVG + CSS fluids/halos, no heavy deps, no solid disc / giant star. */
export function SalesAgentGlassOrb({
  state,
  compact = false,
}: {
  readonly state: SalesAgentOrbState;
  readonly compact?: boolean;
}) {
  return (
    <div
      className={`agent-orb agent-orb-${state}${compact ? ' agent-orb-compact' : ''}`}
      data-orb-state={state}
      data-orb-compact={compact ? 'true' : 'false'}
      aria-label={`Sales Agent ${state}`}
      role="img"
    >
      <div className="agent-orb-halo" />
      <div className="agent-orb-ring agent-orb-ring-a" aria-hidden="true" />
      <div className="agent-orb-ring agent-orb-ring-b" aria-hidden="true" />
      <div className="agent-orb-sound agent-orb-sound-left" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <div className="agent-orb-sound agent-orb-sound-right" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <div className="agent-orb-glass">
        <svg className="agent-orb-svg" viewBox="0 0 220 220" aria-hidden="true">
          <defs>
            <radialGradient id="orbGlassFill" cx="36%" cy="28%" r="72%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
              <stop offset="38%" stopColor="rgba(186,230,253,0.32)" />
              <stop offset="72%" stopColor="rgba(216,180,254,0.18)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
            </radialGradient>
            <linearGradient id="orbFlowA" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#22d3ee" stopOpacity="0.72" />
              <stop offset="78%" stopColor="#a78bfa" stopOpacity="0.68" />
              <stop offset="100%" stopColor="#f9a8d4" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="orbFlowB" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
              <stop offset="55%" stopColor="#818cf8" stopOpacity="0.58" />
              <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.42" />
            </linearGradient>
            <linearGradient id="orbFlowC" x1="20%" y1="100%" x2="90%" y2="0%">
              <stop offset="0%" stopColor="#fbcfe8" stopOpacity="0.55" />
              <stop offset="50%" stopColor="#a5b4fc" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#67e8f9" stopOpacity="0.4" />
            </linearGradient>
            <filter id="orbSoftBlur" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <clipPath id="orbClip">
              <circle cx="110" cy="110" r="92" />
            </clipPath>
          </defs>
          <circle cx="110" cy="110" r="98" fill="url(#orbGlassFill)" opacity="0.42" />
          <g clipPath="url(#orbClip)">
            <ellipse className="agent-orb-blob agent-orb-blob-a" cx="86" cy="112" rx="60" ry="44" fill="url(#orbFlowA)" filter="url(#orbSoftBlur)" />
            <ellipse className="agent-orb-blob agent-orb-blob-b" cx="136" cy="120" rx="54" ry="40" fill="url(#orbFlowB)" filter="url(#orbSoftBlur)" />
            <ellipse className="agent-orb-blob agent-orb-blob-c" cx="112" cy="90" rx="38" ry="30" fill="url(#orbFlowC)" filter="url(#orbSoftBlur)" />
            <ellipse className="agent-orb-blob agent-orb-blob-d" cx="108" cy="128" rx="28" ry="20" fill="rgba(255,255,255,0.42)" filter="url(#orbSoftBlur)" />
            <path className="agent-orb-wave-path" d="M28 118 C58 102, 78 134, 110 118 S162 98, 192 116" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="1.5" />
            <path className="agent-orb-wave-path agent-orb-wave-path-2" d="M34 128 C64 112, 86 140, 112 126 S158 110, 186 124" fill="none" stroke="rgba(165,243,252,0.65)" strokeWidth="1.15" />
            <circle className="agent-orb-spark" cx="118" cy="104" r="3.2" fill="rgba(255,255,255,0.85)" />
          </g>
          <circle cx="110" cy="110" r="92" fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth="1.15" />
          <circle cx="74" cy="70" r="20" fill="rgba(255,255,255,0.32)" />
        </svg>
      </div>
      <div className="agent-orb-confirm-ring" aria-hidden="true" />
    </div>
  );
}
