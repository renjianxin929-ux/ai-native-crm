import type { ActionCard } from '../../lib/battleCard/types';
import { FACT_APPLICABILITY_LABELS } from '../../lib/battleCardUi/battleCardLabels';
import { KeyHypothesisBlock, type KeyHypothesisBlockProps } from './KeyHypothesisBlock';
import { NextBestActionBlock } from './NextBestActionBlock';

export interface ActionCardViewProps {
  readonly action: ActionCard;
  readonly onUpdateHypothesisStatus?: KeyHypothesisBlockProps['onUpdateStatus'];
}

/** 主卡一｜阶段行动卡：完整展示 15 项内容，不为一屏删除任何字段。 */
export function ActionCardView({ action, onUpdateHypothesisStatus }: ActionCardViewProps) {
  return (
    <article className="bc-card" data-testid="bc-action-card" aria-label="阶段行动卡">
      <header className="bc-card-header">
        <h2>阶段行动卡</h2>
        <span className="bc-card-sub" data-testid="bc-confidence">置信度：{action.confidence}</span>
      </header>
      <div className="bc-card-body">
        <section className="bc-section">
          <h3 className="bc-section-title">当前情况</h3>
          <div className="bc-section-body"><p data-testid="bc-current-situation">{action.current_situation}</p></div>
        </section>

        <section className="bc-section" data-testid="bc-stage-goal">
          <h3 className="bc-section-title">当前阶段目标</h3>
          <div className="bc-section-body"><p>{action.stage_goal}</p></div>
        </section>

        <section className="bc-section">
          <h3 className="bc-section-title">阶段进入条件</h3>
          <ul className="bc-list">{action.stage_entry_criteria.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
        </section>

        <section className="bc-section">
          <h3 className="bc-section-title">阶段退出条件</h3>
          <ul className="bc-list">{action.stage_exit_criteria.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
        </section>

        <section className="bc-section" data-testid="bc-confirmed-facts">
          <h3 className="bc-section-title">
            已确认事实
            <span className="bc-section-count">{action.confirmed_facts.length}</span>
          </h3>
          {action.confirmed_facts.length === 0 ? (
            <p className="bc-section-body">暂无已确认事实。导入并核实战前材料后生成作战卡。</p>
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
                      <span className="bc-pill bc-pill-neutral">{fact.evidence_refs.length} 条证据</span>
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

        <section className="bc-section">
          <h3 className="bc-section-title">目标角色</h3>
          <ul className="bc-list">{action.target_roles.map((role, index) => <li key={index}><span className="bc-list-main">{role}</span></li>)}</ul>
        </section>

        <section className="bc-section" data-testid="bc-must-ask">
          <h3 className="bc-section-title">必问问题</h3>
          {action.must_ask_questions.length === 0 ? (
            <p className="bc-section-body">暂无可展示的必问问题。</p>
          ) : (
            <ul className="bc-list">{action.must_ask_questions.map((question, index) => <li key={index}><span className="bc-list-main">{question}</span></li>)}</ul>
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

        <section className="bc-section">
          <h3 className="bc-section-title">成功信号</h3>
          <div className="bc-section-body"><p>{action.success_signal}</p></div>
        </section>

        <section className="bc-section">
          <h3 className="bc-section-title">失败信号</h3>
          <div className="bc-section-body"><p>{action.failure_signal}</p></div>
        </section>

        <section className="bc-section" data-testid="bc-risks">
          <h3 className="bc-section-title">风险</h3>
          {action.risks.length === 0 ? <p className="bc-section-body">暂无风险项。</p> : (
            <ul className="bc-list">{action.risks.map((risk, index) => <li key={index}><span className="bc-list-main">{risk}</span></li>)}</ul>
          )}
        </section>

        <section className="bc-section" data-testid="bc-do-not-say">
          <h3 className="bc-section-title">禁止说的话</h3>
          {action.do_not_say.length === 0 ? <p className="bc-section-body">暂无禁止话术。</p> : (
            <ul className="bc-list">{action.do_not_say.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
          )}
        </section>

        <section className="bc-section" data-testid="bc-changes">
          <h3 className="bc-section-title">相比上一版本的变化</h3>
          <ul className="bc-list">{action.changes_since_previous_card.map((change, index) => <li key={index}><span className="bc-list-main">{change}</span></li>)}</ul>
        </section>
      </div>
    </article>
  );
}
