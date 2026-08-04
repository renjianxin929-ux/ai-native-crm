import type { VersionHistoryRow } from '../../lib/battleCardUi/battleCardViewModels';
import { STAGE_CARD_GENERATED_BY_LABELS, STAGE_CARD_STATUS_LABELS, formatDateTime, stageLabel } from '../../lib/battleCardUi/battleCardLabels';

export interface VersionHistoryPanelProps {
  readonly rows: readonly VersionHistoryRow[];
  readonly onView: (cardId: string) => void;
}

/** 版本历史：append-only 展示；允许查看旧版本，不允许覆盖。 */
export function VersionHistoryPanel({ rows, onView }: VersionHistoryPanelProps) {
  return (
    <div data-testid="bc-version-history" aria-label="版本历史">
      {rows.length === 0 ? (
        <p className="bc-section-body">暂无历史版本。</p>
      ) : (
        rows.map(row => (
          <div key={row.id} className={`bc-version-row${row.is_current ? ' is-current' : ''}`} data-testid={`bc-version-${row.version}`}>
            <span className="bc-version-no">v{row.version}</span>
            <div className="bc-version-meta">
              <span>{stageLabel(row.stage_code)} · {STAGE_CARD_STATUS_LABELS[row.card_status as keyof typeof STAGE_CARD_STATUS_LABELS] ?? row.card_status} · {STAGE_CARD_GENERATED_BY_LABELS[row.generated_by as keyof typeof STAGE_CARD_GENERATED_BY_LABELS] ?? row.generated_by}</span>
              <span style={{ marginLeft: 8 }}>{row.confirmed_at ? `确认于 ${formatDateTime(row.confirmed_at)}` : `创建于 ${formatDateTime(row.created_at)}`}</span>
              {row.is_current ? <span className="bc-pill bc-pill-accent" style={{ marginLeft: 6 }}>当前</span> : null}
              {row.change_summary ? <span className="bc-version-change">{row.change_summary}</span> : null}
            </div>
            <div className="bc-version-actions">
              <button type="button" className="bc-btn bc-btn-sm" onClick={() => onView(row.id)} data-testid={`bc-version-view-${row.version}`}>
                查看
              </button>
            </div>
          </div>
        ))
      )}
      <p className="bc-talk-note">历史版本只读。生成新版本时通过 supersedes 指向旧版本，旧卡永不被覆盖。</p>
    </div>
  );
}
