import type { TalkTrackView } from '../../lib/battleCardUi/battleCardViewModels';
import { CopyButton } from './CopyButton';

export interface FeishuTalkTrackBlockProps {
  readonly talk: TalkTrackView;
}

/** 价值复述：Original 永不覆盖；Current/短口语/完整口语/微信版可复制。 */
export function FeishuTalkTrackBlock({ talk }: FeishuTalkTrackBlockProps) {
  const variants: readonly { key: string; name: string; text: string | null; note?: string; original?: boolean }[] = [
    { key: 'original', name: 'Original（原始材料）', text: talk.original, original: true },
    { key: 'current', name: 'Current（当前话术）', text: talk.current },
    { key: 'short', name: '短口语版', text: talk.short_spoken_version },
    { key: 'full', name: '完整口语版', text: talk.full_spoken_version },
    { key: 'wechat', name: '微信版', text: talk.wechat_version },
  ];

  return (
    <section className="bc-section" data-testid="bc-talk-track" aria-label="价值复述">
      <h3 className="bc-section-title">
        价值复述
        <span className="bc-section-count">{variants.filter(variant => variant.text?.trim()).length} 个版本</span>
      </h3>
      <div className="bc-talk">
        {variants.map(variant => {
          if (!variant.text?.trim()) return null;
          return (
            <div
              key={variant.key}
              className={`bc-talk-variant${variant.original ? ' bc-talk-original' : ''}`}
              data-testid={`bc-talk-${variant.key}`}
            >
              <div className="bc-talk-variant-head">
                <span className="bc-talk-variant-name">
                  {variant.name}
                  {variant.original ? <span className="bc-pill bc-pill-accent">来自原始战前材料，不会被后续版本覆盖</span> : null}
                </span>
                <CopyButton text={variant.text} />
              </div>
              <pre className="bc-talk-text">{variant.text}</pre>
              {variant.original && !talk.original_is_current ? (
                <p className="bc-talk-note">当前已启用人工替换版本；原始内容始终保留于此。</p>
              ) : null}
            </div>
          );
        })}
        {variants.every(variant => !variant.text?.trim()) ? (
          <p className="bc-section-body">该客户暂无价值表达材料。</p>
        ) : null}
      </div>
    </section>
  );
}
