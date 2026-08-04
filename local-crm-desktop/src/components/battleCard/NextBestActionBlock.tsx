import type { NextBestActionView } from '../../lib/battleCardUi/battleCardViewModels';
import { CHANNEL_LABELS } from '../../lib/types';
import { CopyButton } from './CopyButton';

function channelLabel(channel: string): string {
  if (channel in CHANNEL_LABELS) return CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS];
  if (channel.includes(' + ')) {
    return channel.split(' + ').map(part => CHANNEL_LABELS[part as keyof typeof CHANNEL_LABELS] ?? part).join(' + ');
  }
  return channel;
}

export function NextBestActionBlock({ next }: { next: NextBestActionView }) {
  return (
    <section className="bc-section" data-testid="bc-next-best-action" aria-label="下一步最佳行动">
      <h3 className="bc-section-title">下一步最佳行动</h3>
      <div className="bc-nba">
        <div className="bc-nba-grid">
          <div className="bc-nba-item">
            <span className="bc-detail-label">找谁</span>
            <strong data-testid="bc-nba-role">{next.target_role}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">渠道</span>
            <strong>{channelLabel(next.channel)}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">建议时间</span>
            <strong>{next.recommended_time}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">目标</span>
            <strong>{next.objective}</strong>
          </div>
        </div>
        <div className="bc-nba-opening" data-testid="bc-nba-opening">
          <span className="bc-detail-label">开场话术</span>
          <p style={{ margin: '4px 0 0' }}>{next.opening}</p>
          <CopyButton text={next.opening} label="复制开场话术" />
        </div>
        <div className="bc-nba-grid" style={{ marginTop: 12 }}>
          <div className="bc-nba-item">
            <span className="bc-detail-label">建议问题</span>
            <ul className="bc-list" style={{ marginTop: 4 }}>
              {next.questions.map((question, index) => <li key={index}>{question}</li>)}
            </ul>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">成功信号</span>
            <strong style={{ color: 'var(--bc-success-text)' }}>{next.success_signal}</strong>
            <span className="bc-detail-label" style={{ marginTop: 8, display: 'block' }}>失败信号</span>
            <strong style={{ color: 'var(--bc-danger-text)' }}>{next.failure_signal}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">备用动作</span>
            <strong>{next.fallback_action}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
