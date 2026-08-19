import type { KeyHypothesisView } from '../../lib/battleCardUi/battleCardViewModels';
import { FACT_APPLICABILITY_SHORT, HYPOTHESIS_STATUS_LABELS } from '../../lib/battleCardUi/battleCardLabels';
import { t } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';

export interface KeyHypothesisBlockProps {
  readonly hypotheses: readonly KeyHypothesisView[];
  /** 假设状态更新入口（真实 Proposal 由父级发起）。 */
  readonly onUpdateStatus?: (hypothesisId: string) => void;
}

export function KeyHypothesisBlock({ hypotheses, onUpdateStatus }: KeyHypothesisBlockProps) {
  useAppLocale();
  return (
    <section className="bc-section" data-testid="bc-key-hypotheses" aria-label={t('battle.hypotheses')}>
      <h3 className="bc-section-title">
        {t('battle.hypotheses')}
        <span className="bc-section-count">{hypotheses.length}</span>
      </h3>
      <div className="bc-hypotheses">
        {hypotheses.map((hypothesis, index) => (
          <article
            key={hypothesis.hypothesis_id}
            className={`bc-hypothesis${hypothesis.is_placeholder ? ' is-placeholder' : ''}`}
            data-testid={`bc-hypothesis-${index}`}
            data-hypothesis-id={hypothesis.hypothesis_id}
          >
            <div className="bc-hypothesis-head">
              <div className="bc-hypothesis-statement">
                {hypothesis.is_placeholder ? (
                  hypothesis.statement
                ) : (
                  <>H{index + 1}：{hypothesis.statement}</>
                )}
              </div>
              <div className="bc-hypothesis-meta">
                <span className="bc-pill bc-pill-warning" data-testid={`bc-hyp-status-${index}`}>
                  {HYPOTHESIS_STATUS_LABELS[hypothesis.status as keyof typeof HYPOTHESIS_STATUS_LABELS] ?? hypothesis.status}
                </span>
                <span className="bc-pill bc-pill-neutral">
                  {FACT_APPLICABILITY_SHORT[hypothesis.applicability as keyof typeof FACT_APPLICABILITY_SHORT] ?? hypothesis.applicability}
                </span>
              </div>
            </div>
            {!hypothesis.is_placeholder ? (
              <>
                <div className="bc-hypothesis-detail">
                  {hypothesis.why_it_matters ? (
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.hyp.why')}</span><span>{hypothesis.why_it_matters}</span></div>
                  ) : null}
                  {hypothesis.validation_question ? (
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.hyp.verify')}</span><span>{hypothesis.validation_question}</span></div>
                  ) : null}
                  {hypothesis.disconfirm_condition ? (
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.hyp.disconfirm')}</span><span>{hypothesis.disconfirm_condition}</span></div>
                  ) : null}
                  <div className="bc-detail-item"><span className="bc-detail-label">Evidence</span><span>{hypothesis.evidence_count} 条</span></div>
                </div>
                {onUpdateStatus ? (
                  <div className="bc-hypothesis-actions">
                    <button
                      type="button"
                      className="bc-btn bc-btn-sm"
                      data-testid={`bc-hyp-update-${index}`}
                      onClick={() => onUpdateStatus(hypothesis.hypothesis_id)}
                    >
                      {t('battle.hyp.update')}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="bc-hypothesis-detail">{t('battle.hyp.placeholder')}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
