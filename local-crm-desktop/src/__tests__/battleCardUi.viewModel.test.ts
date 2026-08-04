/**
 * Battle Card UI — View Model 纯函数测试（无 DOM、无 DB）。
 */
import { describe, expect, it } from 'vitest';
import {
  splitEvidenceRefs,
  toDailyReviewRowViews,
  toKeyHypothesisViews,
  toNextBestActionView,
  toPeerReferenceViews,
  toTalkTrackView,
  toVersionHistoryRows,
  toHypothesisRowViews,
  toFactRowViews,
} from '../lib/battleCardUi/battleCardViewModels';
import type { ActionCard, CustomerStageCardRow } from '../lib/battleCard/types';
import type { BattleReviewQueueItem } from '../lib/battleCard/dailyReview';

const baseAction: ActionCard = {
  current_situation: '客户 广州电秀科技发展有限公司（广东 / 小家电），等级 A，当前阶段 新线索。',
  stage_goal: '完成首次触达并判断基础意向',
  stage_entry_criteria: ['新线索进入客户池'],
  stage_exit_criteria: ['已完成首次触达'],
  confirmed_facts: [{ fact_id: 'f1', statement: '销售额突破7000万元', applicability: 'GLOBAL', evidence_refs: ['import:company', 'reviewed_fact:f1'] }],
  key_hypotheses: [
    { hypothesis_id: 'h1', statement: '新品状态可能被聊天信息淹没', status: 'PENDING', applicability: 'CONDITIONAL', why_it_matters: '决定切入场景', validation_question: '当前用什么表管理新品状态？', disconfirm_condition: '已有 PLM 全覆盖', evidence_refs: ['import:problem_hypotheses'] },
    { hypothesis_id: 'h2', statement: '合规压力大', status: 'PARTIALLY_CONFIRMED', applicability: 'CONDITIONAL', why_it_matters: null, validation_question: null, disconfirm_condition: null, evidence_refs: [] },
    { hypothesis_id: 'insufficient', statement: '关键假设不足，仍需补充信息', status: 'PENDING', applicability: 'CONDITIONAL', why_it_matters: null, validation_question: null, disconfirm_condition: null, evidence_refs: [] },
  ],
  target_roles: ['决策人'],
  must_ask_questions: ['问题一'],
  next_best_action: {
    target_role: '决策人',
    channel: 'wechat + phone',
    recommended_time: '2026-08-03T09:00:00Z',
    objective: '完成首次触达',
    opening: '您好，想和您聊一下近期的业务场景。',
    questions: ['问题一'],
    success_signal: '客户给出明确正面反馈',
    failure_signal: '客户明确拒绝',
    fallback_action: '低频维护',
  },
  success_signal: '客户给出明确正面反馈',
  failure_signal: '客户明确拒绝',
  risks: ['条件适用项未经确认前不得扩大承诺'],
  do_not_say: ['未经客户确认不得断言'],
  changes_since_previous_card: ['首张作战卡（无上一张可比）'],
  confidence: 'HIGH',
  evidence_refs: ['customer:cust-tinsol', 'stage:NEW_LEAD'],
};

describe('toKeyHypothesisViews', () => {
  it('maps hypothesis rows and flags the insufficient placeholder', () => {
    const views = toKeyHypothesisViews(baseAction);
    expect(views).toHaveLength(3);
    expect(views[0]).toMatchObject({ hypothesis_id: 'h1', status: 'PENDING', applicability: 'CONDITIONAL', evidence_count: 1 });
    expect(views[0].why_it_matters).toBe('决定切入场景');
    expect(views[0].validation_question).toBe('当前用什么表管理新品状态？');
    expect(views[0].disconfirm_condition).toBe('已有 PLM 全覆盖');
    expect(views[2].is_placeholder).toBe(true);
    expect(views[2].evidence_count).toBe(0);
  });

  it('never presents a hypothesis as a fact', () => {
    const views = toKeyHypothesisViews(baseAction);
    for (const view of views) {
      expect(view.status).not.toBe('VERIFIED');
      expect(view.applicability).not.toBe('GLOBAL');
    }
  });
});

describe('toNextBestActionView', () => {
  it('keeps all action fields', () => {
    const view = toNextBestActionView(baseAction);
    expect(view.target_role).toBe('决策人');
    expect(view.channel).toBe('wechat + phone');
    expect(view.opening).toBeTruthy();
    expect(view.questions).toEqual(['问题一']);
    expect(view.success_signal).toBeTruthy();
    expect(view.failure_signal).toBeTruthy();
    expect(view.fallback_action).toBeTruthy();
  });
});

describe('toTalkTrackView', () => {
  it('original is preserved and current falls back to original', () => {
    const view = toTalkTrackView({ original: '原文话术', current: '', short_spoken_version: '短版', full_spoken_version: null, wechat_version: null, version_history: [] });
    expect(view.original).toBe('原文话术');
    expect(view.current).toBe('原文话术');
    expect(view.original_is_current).toBe(true);
    expect(view.short_spoken_version).toBe('短版');
  });

  it('marks original_is_current=false when replaced', () => {
    const view = toTalkTrackView({ original: '原文', current: '人工替换版', short_spoken_version: null, full_spoken_version: null, wechat_version: null, version_history: [{ at: '2026-08-01T00:00:00Z', from: '原文', to: '人工替换版' }] });
    expect(view.current).toBe('人工替换版');
    expect(view.original).toBe('原文');
    expect(view.original_is_current).toBe(false);
    expect(view.version_count).toBe(1);
  });
});

describe('toPeerReferenceViews', () => {
  it('keeps company, comparability and non-transferable boundary', () => {
    const views = toPeerReferenceViews([{ company_name: 'SUPRENT', comparison_level: '同品类出海', why_comparable: '同品类', reusable_pattern: '客户字段设计', non_transferable_boundary: '多平台深度不同', source_refs: ['import:peers'] }]);
    expect(views[0]?.company_name).toBe('SUPRENT');
    expect(views[0]?.why_comparable).toBe('同品类');
    expect(views[0]?.non_transferable_boundary).toBe('多平台深度不同');
  });
});

describe('splitEvidenceRefs', () => {
  it('splits import / crm / derived refs', () => {
    const summary = splitEvidenceRefs(['import:company', 'FOLLOW_UP_RECORD:fu-1', 'customer:cust', 'stage:NEW_LEAD']);
    expect(summary.import_refs).toEqual(['import:company']);
    expect(summary.crm_refs).toEqual(['FOLLOW_UP_RECORD:fu-1']);
    expect(summary.derived_refs).toEqual(['customer:cust', 'stage:NEW_LEAD']);
  });
});

describe('toVersionHistoryRows', () => {
  it('reverses to newest-first and flags current card', () => {
    const cards: CustomerStageCardRow[] = [
      { id: 'card-v1', customer_id: 'c', stage_code: 'NEW_LEAD', version: 1, schema_version: 'battle-card-payload-v1', card_status: 'CONFIRMED', source_import_id: null, supersedes_card_id: null, payload_json: JSON.stringify({ action_card: baseAction, solution_reference_card: { feishu_value_statement: { original: '', current: '', short_spoken_version: null, full_spoken_version: null, wechat_version: null, version_history: [] }, solution_scenarios: [], human_review_boundaries: [], peer_references: [], counterexamples_and_boundaries: [], poc_path: [], acceptance_metrics: [], evidence_refs: [] } }), evidence_snapshot_hash: 'h1', generated_by: 'DETERMINISTIC', confirmed_by: 'HUMAN_CONFIRM', created_at: '2026-08-01T00:00:00Z', confirmed_at: '2026-08-01T00:00:00Z' },
      { id: 'card-v2', customer_id: 'c', stage_code: 'NEW_LEAD', version: 2, schema_version: 'battle-card-payload-v1', card_status: 'DRAFT', source_import_id: null, supersedes_card_id: 'card-v1', payload_json: JSON.stringify({ action_card: baseAction, solution_reference_card: { feishu_value_statement: { original: '', current: '', short_spoken_version: null, full_spoken_version: null, wechat_version: null, version_history: [] }, solution_scenarios: [], human_review_boundaries: [], peer_references: [], counterexamples_and_boundaries: [], poc_path: [], acceptance_metrics: [], evidence_refs: [] } }), evidence_snapshot_hash: 'h2', generated_by: 'DETERMINISTIC', confirmed_by: null, created_at: '2026-08-02T00:00:00Z', confirmed_at: null },
    ];
    const rows = toVersionHistoryRows(cards, 'card-v2');
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.is_current).toBe(true);
    expect(rows[0]?.supersedes_card_id).toBe('card-v1');
    expect(rows[1]?.version).toBe(1);
    expect(rows[1]?.is_current).toBe(false);
  });
});

describe('toHypothesisRowViews / toFactRowViews', () => {
  it('derives counts from JSON columns', () => {
    const hypothesis = toHypothesisRowViews([{
      id: 'hyp-1', customer_id: 'c', source_import_id: 'import-1', category: 'PROBLEM', statement: 'S', rationale: null,
      status: 'PENDING', applicability: 'CONDITIONAL', why_it_matters: null, validation_question: null, disconfirm_condition: null,
      evidence_refs_json: '[{"import_ref":"import:problem_hypotheses"}]', status_audit_json: '[{"at":"x"}]', created_at: 'x', resolved_at: null, updated_at: 'x',
    }]);
    expect(hypothesis[0]?.evidence_count).toBe(1);
    expect(hypothesis[0]?.audit_count).toBe(1);

    const facts = toFactRowViews([{
      id: 'fact-1', customer_id: 'c', source_import_id: 'import-1', fact_category: 'COMPANY', statement: 'S', normalized_value_json: null,
      verification_status: 'VERIFIED', confidence: 0.9, applicability: 'GLOBAL', observed_at: null, valid_until: null,
      evidence_refs_json: '[]', created_at: 'x', updated_at: 'x',
    }]);
    expect(facts[0]?.verification_status).toBe('VERIFIED');
    expect(facts[0]?.confidence).toBe(0.9);
  });
});

describe('toDailyReviewRowViews', () => {
  it('derives overdue/due flags from deterministic reasons and keeps urgency score', () => {
    const items: BattleReviewQueueItem[] = [{
      customer_id: 'c1', customer_name: '广州电秀', stage: 'NEW_LEAD', priority: 'A',
      reasons: ['Next follow-up 已逾期 3 天', '当前阶段停滞 9 天'], current_goal: '首次触达', key_hypotheses: ['H1'], next_best_action: '联系',
      card_age_days: 2, evidence_changes: ['最新互动晚于卡片确认时间'], urgency_score: 40, coach_note: null,
    }];
    const rows = toDailyReviewRowViews(items, '2026-08-02T00:00:00Z');
    expect(rows[0]?.is_overdue).toBe(true);
    expect(rows[0]?.is_due_today).toBe(false);
    expect(rows[0]?.urgency_score).toBe(40);
    expect(rows[0]?.card_age_days).toBe(2);
  });
});
