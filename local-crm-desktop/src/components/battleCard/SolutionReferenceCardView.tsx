import type { SolutionReferenceCard } from '../../lib/battleCard/types';
import { FACT_APPLICABILITY_LABELS } from '../../lib/battleCardUi/battleCardLabels';
import { FeishuTalkTrackBlock } from './FeishuTalkTrackBlock';
import { PeerReferencesBlock } from './PeerReferencesBlock';
import { toTalkTrackView } from '../../lib/battleCardUi/battleCardViewModels';
import { t } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';

export function SolutionReferenceCardView({ solution }: { solution: SolutionReferenceCard }) {
  useAppLocale();
  const talk = toTalkTrackView(solution.feishu_value_statement);

  return (
    <article className="bc-card" data-testid="bc-solution-card" aria-label={t('battle.solutionCard')}>
      <header className="bc-card-header">
        <h2>{t('battle.solutionCard')}</h2>
        <span className="bc-card-sub">{solution.solution_scenarios.length} 个场景 · {solution.peer_references.length} 家同行</span>
      </header>
      <div className="bc-card-body">
        <FeishuTalkTrackBlock talk={talk} />

        <section className="bc-section" data-testid="bc-scenarios">
          <h3 className="bc-section-title">
            {t('battle.scenarios')}
            <span className="bc-section-count">{solution.solution_scenarios.length}</span>
          </h3>
          {solution.solution_scenarios.length === 0 ? (
            <p className="bc-section-body">{t('battle.scenariosEmpty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {solution.solution_scenarios.map((scenario, index) => (
                <article className="bc-peer" key={scenario.scenario_name} data-testid={`bc-scenario-${index}`}>
                  <div className="bc-peer-head">
                    <span className="bc-peer-name">{scenario.scenario_name}</span>
                    <span className="bc-pill bc-pill-neutral">
                      {FACT_APPLICABILITY_LABELS[scenario.applicability as keyof typeof FACT_APPLICABILITY_LABELS] ?? scenario.applicability}
                    </span>
                  </div>
                  <div className="bc-peer-body">
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.scenario.problem')}</span><span>{scenario.problem_hypothesis}</span></div>
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.scenario.feishuRole')}</span><span>{scenario.feishu_role}</span></div>
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.scenario.aiRole')}</span><span>{scenario.ai_role}</span></div>
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.scenario.humanGate')}</span><span>{scenario.human_gate}</span></div>
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.scenario.notReplaced')}</span><span>{scenario.systems_not_replaced.join('、') || '—'}</span></div>
                    <div className="bc-detail-item"><span className="bc-detail-label">{t('battle.scenario.metrics')}</span><span>{scenario.acceptance_metrics.join('、') || '—'}</span></div>
                  </div>
                  {scenario.business_objects.length > 0 ? (
                    <div className="bc-peer-sources">
                      <span>业务对象：</span>
                      {scenario.business_objects.map(item => <span key={item} className="bc-pill bc-pill-neutral">{item}</span>)}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="bc-section" data-testid="bc-human-boundaries">
          <h3 className="bc-section-title">{t('battle.humanBoundaries')}</h3>
          {solution.human_review_boundaries.length === 0 ? (
            <p className="bc-section-body">{t('battle.humanBoundariesEmpty')}</p>
          ) : (
            <ul className="bc-list">{solution.human_review_boundaries.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
          )}
        </section>

        <PeerReferencesBlock peers={solution.peer_references} />

        <section className="bc-section" data-testid="bc-counterexamples">
          <h3 className="bc-section-title">{t('battle.counterexamples')}</h3>
          {solution.counterexamples_and_boundaries.length === 0 ? (
            <p className="bc-section-body">{t('battle.counterexamplesEmpty')}</p>
          ) : (
            <ul className="bc-list">{solution.counterexamples_and_boundaries.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
          )}
        </section>

        <section className="bc-section" data-testid="bc-poc">
          <h3 className="bc-section-title">{t('battle.poc')}</h3>
          {solution.poc_path.length === 0 ? (
            <p className="bc-section-body">{t('battle.pocEmpty')}</p>
          ) : (
            <ul className="bc-list">{solution.poc_path.map((step, index) => <li key={index}><span className="bc-list-main">{step}</span></li>)}</ul>
          )}
        </section>

        <section className="bc-section" data-testid="bc-acceptance-metrics">
          <h3 className="bc-section-title">{t('battle.acceptanceMetrics')}</h3>
          <ul className="bc-list">{solution.acceptance_metrics.map((metric, index) => <li key={index}><span className="bc-list-main">{metric}</span></li>)}</ul>
        </section>
      </div>
    </article>
  );
}
