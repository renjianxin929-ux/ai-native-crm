import type { NextBestActionView } from '../../lib/battleCardUi/battleCardViewModels';
import { CHANNEL_LABELS } from '../../lib/types';
import { CopyButton } from './CopyButton';
import { t } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';

function channelLabel(channel: string): string {
  if (channel in CHANNEL_LABELS) return CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS];
  if (channel.includes(' + ')) {
    return channel.split(' + ').map(part => CHANNEL_LABELS[part as keyof typeof CHANNEL_LABELS] ?? part).join(' + ');
  }
  return channel;
}

export function NextBestActionBlock({ next }: { next: NextBestActionView }) {
  useAppLocale();
  return (
    <section className="bc-section" data-testid="bc-next-best-action" aria-label={t('battle.nextBestAction')}>
      <h3 className="bc-section-title">{t('battle.nextBestAction')}</h3>
      <div className="bc-nba">
        <div className="bc-nba-grid">
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.nba.role')}</span>
            <strong data-testid="bc-nba-role">{next.target_role}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.nba.channel')}</span>
            <strong>{channelLabel(next.channel)}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.nba.time')}</span>
            <strong>{next.recommended_time}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.nba.objective')}</span>
            <strong>{next.objective}</strong>
          </div>
        </div>
        <div className="bc-nba-opening" data-testid="bc-nba-opening">
          <span className="bc-detail-label">{t('battle.nba.opening')}</span>
          <p style={{ margin: '4px 0 0' }}>{next.opening}</p>
          <CopyButton text={next.opening} label={t('battle.nba.copyOpening')} />
        </div>
        <div className="bc-nba-grid" style={{ marginTop: 12 }}>
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.nba.questions')}</span>
            <ul className="bc-list" style={{ marginTop: 4 }}>
              {next.questions.map((question, index) => <li key={index}>{question}</li>)}
            </ul>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.successSignal')}</span>
            <strong style={{ color: 'var(--bc-success-text)' }}>{next.success_signal}</strong>
            <span className="bc-detail-label" style={{ marginTop: 8, display: 'block' }}>{t('battle.failureSignal')}</span>
            <strong style={{ color: 'var(--bc-danger-text)' }}>{next.failure_signal}</strong>
          </div>
          <div className="bc-nba-item">
            <span className="bc-detail-label">{t('battle.nba.fallback')}</span>
            <strong>{next.fallback_action}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
