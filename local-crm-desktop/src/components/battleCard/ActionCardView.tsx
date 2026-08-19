import type { ActionCard } from '../../lib/battleCard/types';
import { FACT_APPLICABILITY_LABELS } from '../../lib/battleCardUi/battleCardLabels';
import { KeyHypothesisBlock, type KeyHypothesisBlockProps } from './KeyHypothesisBlock';
import { NextBestActionBlock } from './NextBestActionBlock';
import { t, tFormat } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';

export interface ActionCardViewProps {
  readonly action: ActionCard;
  readonly onUpdateHypothesisStatus?: KeyHypothesisBlockProps['onUpdateStatus'];
}

/** First layer: situation / goal / risk / next action / signals. Canonical fields remain in the DOM. */
export function ActionCardView({ action, onUpdateHypothesisStatus }: ActionCardViewProps) {
  useAppLocale();
  return (
    <article className="bc-card" data-testid="bc-action-card" aria-label={t('battle.actionCard')}>
      <header className="bc-card-header">
        <h2>{t('battle.actionCard')}</h2>
        <span className="bc-card-sub" data-testid="bc-confidence">{t('battle.confidence')}：{action.confidence}</span>
      </header>
      <div className="bc-card-body">
        <div data-testid="bc-layer-primary">
          <section className="bc-section">
            <h3 className="bc-section-title">{t('battle.currentSituation')}</h3>
            <div className="bc-section-body"><p data-testid="bc-current-situation">{action.current_situation}</p></div>
          </section>

          <section className="bc-section" data-testid="bc-stage-goal">
            <h3 className="bc-section-title">{t('battle.stageGoal')}</h3>
            <div className="bc-section-body"><p>{action.stage_goal}</p></div>
          </section>

          <section className="bc-section" data-testid="bc-risks">
            <h3 className="bc-section-title">{t('battle.risks')}</h3>
            {action.risks.length === 0 ? <p className="bc-section-body">{t('battle.risksEmpty')}</p> : (
              <ul className="bc-list">{action.risks.map((risk, index) => <li key={index}><span className="bc-list-main">{risk}</span></li>)}</ul>
            )}
          </section>

          <NextBestActionBlock next={{
            target_role: action.next_best_action.target_role,
            channel: action.next_best_action.channel,
            recommended_time: action.next_best_action.recommended_time,
            objective: action.next_best_action.objective,
            opening: action.next_best_action.opening,
            questions: action.next_best_action.questions,
            success_signal: action.next_best_action.success_signal,
            failure_signal: action.next_best_action.failure_signal,
            fallback_action: action.next_best_action.fallback_action,
          }} />

          <section className="bc-section" data-testid="bc-signals">
            <h3 className="bc-section-title">{t('battle.signals')}</h3>
            <div className="bc-section-body">
              <p><span className="bc-detail-label">{t('battle.successSignal')}</span> {action.success_signal}</p>
              <p><span className="bc-detail-label">{t('battle.failureSignal')}</span> {action.failure_signal}</p>
            </div>
          </section>
        </div>

        <details className="bc-fold" data-testid="bc-layer-secondary">
          <summary>{t('battle.detailedIntelligence')}</summary>
          <section className="bc-section" data-testid="bc-stage-conditions">
            <h3 className="bc-section-title">{t('battle.stageConditions')}</h3>
            <h4 className="bc-section-title">{t('battle.stageEntry')}</h4>
            <ul className="bc-list">{action.stage_entry_criteria.map((item, index) => <li key={`entry-${index}`}><span className="bc-list-main">{item}</span></li>)}</ul>
            <h4 className="bc-section-title">{t('battle.stageExit')}</h4>
            <ul className="bc-list">{action.stage_exit_criteria.map((item, index) => <li key={`exit-${index}`}><span className="bc-list-main">{item}</span></li>)}</ul>
          </section>

          <section className="bc-section" data-testid="bc-confirmed-facts">
            <h3 className="bc-section-title">
              {t('battle.confirmedFacts')}
              <span className="bc-section-count">{action.confirmed_facts.length}</span>
            </h3>
            {action.confirmed_facts.length === 0 ? (
              <p className="bc-section-body">{t('battle.confirmedFactsEmpty')}</p>
            ) : (
              <ul className="bc-list">
                {action.confirmed_facts.map((fact, index) => (
                  <li key={fact.fact_id ?? index} data-testid={`bc-fact-${index}`}>
                    <span className="bc-list-main">
                      {fact.statement}
                      <span className="bc-fact-tags">
                        <span className="bc-pill bc-pill-neutral">
                          {FACT_APPLICABILITY_LABELS[fact.applicability as keyof typeof FACT_APPLICABILITY_LABELS] ?? fact.applicability}
                        </span>
                        <span className="bc-pill bc-pill-neutral">{tFormat('battle.evidenceCount', { n: fact.evidence_refs.length })}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <KeyHypothesisBlock hypotheses={action.key_hypotheses.map(hypothesis => ({
            hypothesis_id: hypothesis.hypothesis_id,
            statement: hypothesis.statement,
            status: hypothesis.status,
            applicability: hypothesis.applicability,
            why_it_matters: hypothesis.why_it_matters,
            validation_question: hypothesis.validation_question,
            disconfirm_condition: hypothesis.disconfirm_condition,
            evidence_count: hypothesis.evidence_refs.length,
            is_placeholder: hypothesis.statement === '关键假设不足，仍需补充信息',
          }))} onUpdateStatus={onUpdateHypothesisStatus} />

          <section className="bc-section" data-testid="bc-target-roles">
            <h3 className="bc-section-title">{t('battle.targetRoles')}</h3>
            <ul className="bc-list">{action.target_roles.map((role, index) => <li key={index}><span className="bc-list-main">{role}</span></li>)}</ul>
          </section>

          <section className="bc-section" data-testid="bc-must-ask">
            <h3 className="bc-section-title">{t('battle.mustAsk')}</h3>
            {action.must_ask_questions.length === 0 ? (
              <p className="bc-section-body">{t('battle.mustAskEmpty')}</p>
            ) : (
              <ul className="bc-list">{action.must_ask_questions.map((question, index) => <li key={index}><span className="bc-list-main">{question}</span></li>)}</ul>
            )}
          </section>

          <section className="bc-section" data-testid="bc-do-not-say">
            <h3 className="bc-section-title">{t('battle.doNotSay')}</h3>
            {action.do_not_say.length === 0 ? <p className="bc-section-body">{t('battle.doNotSayEmpty')}</p> : (
              <ul className="bc-list">{action.do_not_say.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
            )}
          </section>

          <section className="bc-section" data-testid="bc-changes">
            <h3 className="bc-section-title">{t('battle.changes')}</h3>
            <ul className="bc-list">{action.changes_since_previous_card.map((change, index) => <li key={index}><span className="bc-list-main">{change}</span></li>)}</ul>
          </section>
        </details>
      </div>
    </article>
  );
}
