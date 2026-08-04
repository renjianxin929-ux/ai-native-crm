import type { PeerReferenceView } from '../../lib/battleCardUi/battleCardViewModels';
import { evidenceRefLabel } from '../../lib/battleCardUi/battleCardLabels';

export function PeerReferencesBlock({ peers }: { peers: readonly PeerReferenceView[] }) {
  return (
    <section className="bc-section" data-testid="bc-peer-references" aria-label="同行参照">
      <h3 className="bc-section-title">
        同行参照
        <span className="bc-section-count">{peers.length}</span>
      </h3>
      {peers.length === 0 ? (
        <p className="bc-section-body">暂无同行参照数据。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {peers.map((peer, index) => (
            <article className="bc-peer" key={peer.company_name} data-testid={`bc-peer-${index}`} data-company={peer.company_name}>
              <div className="bc-peer-head">
                <span className="bc-peer-name">{peer.company_name}</span>
                <span className="bc-peer-level">{peer.comparison_level}</span>
              </div>
              <div className="bc-peer-body">
                <div className="bc-detail-item"><span className="bc-detail-label">为什么可比</span><span>{peer.why_comparable}</span></div>
                <div className="bc-detail-item"><span className="bc-detail-label">可以借鉴什么</span><span>{peer.reusable_pattern}</span></div>
                <div className="bc-detail-item"><span className="bc-detail-label">不可直接照搬什么</span><span>{peer.non_transferable_boundary}</span></div>
              </div>
              {peer.source_refs.length > 0 ? (
                <div className="bc-peer-sources">
                  <span>来源：</span>
                  {peer.source_refs.map(ref => <span key={ref} className="bc-pill bc-pill-neutral">{evidenceRefLabel(ref)}</span>)}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
