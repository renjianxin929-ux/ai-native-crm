import type { ReactNode } from 'react';

export interface BattleCardStatusBannerProps {
  readonly tone: 'neutral' | 'warning' | 'danger';
  readonly title: string;
  readonly note?: string;
  readonly actions?: readonly ReactNode[];
  readonly testId: string;
}

/** 卡片状态 Banner：no card / draft / stale / error / blocked 等状态说明。 */
export function BattleCardStatusBanner({ tone, title, note, actions, testId }: BattleCardStatusBannerProps) {
  return (
    <div className={`bc-banner ${tone}`} data-testid={testId} role="status">
      <div className="bc-banner-info">
        <span className="bc-banner-title">{title}</span>
        {note ? <span className="bc-banner-note">{note}</span> : null}
      </div>
      {actions && actions.length > 0 ? <div className="bc-banner-actions">{actions}</div> : null}
    </div>
  );
}
