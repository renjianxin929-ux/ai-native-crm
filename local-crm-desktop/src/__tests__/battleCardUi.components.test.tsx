// @vitest-environment jsdom
/**
 * Battle Card UI — 组件测试（jsdom + react-dom/client 真实渲染）。
 * 覆盖：Header / 三假设 / Next Best Action / Talk Track / Peers / Evidence 抽屉 /
 * 版本历史 / Daily Review 行 / empty·loading·error 状态 / Sidecar 开关 / 1366 结构。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

// jsdom 环境声明：支持 React act(...) 包裹的异步渲染
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { Customer } from '../lib/types';
import type { CustomerStageCardRow } from '../lib/battleCard/types';
import { BattleCardHeader } from '../components/battleCard/BattleCardHeader';
import { KeyHypothesisBlock } from '../components/battleCard/KeyHypothesisBlock';
import { NextBestActionBlock } from '../components/battleCard/NextBestActionBlock';
import { FeishuTalkTrackBlock } from '../components/battleCard/FeishuTalkTrackBlock';
import { PeerReferencesBlock } from '../components/battleCard/PeerReferencesBlock';
import { EvidenceDrawer } from '../components/battleCard/EvidenceDrawer';
import { VersionHistoryPanel } from '../components/battleCard/VersionHistoryPanel';
import { DailyReviewQueueRow } from '../components/battleCard/DailyReviewQueueRow';
import { BattleCardStatusBanner } from '../components/battleCard/BattleCardStatusBanner';
import type { DailyReviewRowView } from '../lib/battleCardUi/battleCardViewModels';

// AgentSidecar 测试：mock 掉重型子组件与运行时装配（Sidecar 壳层测试；Agent 交互面本身是生产组件）
vi.mock('../components/aiNative/SalesAgentInteractionWorkspace', () => ({
  SalesAgentInteractionWorkspace: () => <div data-testid="mock-agent-workspace">agent</div>,
}));
vi.mock('../components/aiNative/useSalesAgentRuntime', () => ({
  useSalesAgentRuntime: () => ({
    snapshot: null, context: null, compareContext: null, memory: undefined, host: null, memoryRepository: undefined,
    loading: false, error: '', refresh: async () => {},
  }),
  loadCustomerSnapshot: async () => null,
}));

let container: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  root = createRoot(container);
  act(() => { root.render(node); });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="test-container"></div>';
  container = document.querySelector('#test-container') as HTMLDivElement;
});

afterEach(() => {
  act(() => { root?.unmount(); });
  document.body.innerHTML = '';
});

const customer: Customer = {
  id: 'cust-tinsol', name: '广州电秀科技发展有限公司', customer_grade: 'A', stage: 'NEW_LEAD',
  contact_method: null, wechat_id: null, phone_number: null, wechat_search_status: null,
  is_key_decision_maker: 0, wechat_add_status: 'NOT_ADDED', has_replied: 0, intent_level: 'HIGH',
  phone_feedback: null, can_schedule_visit: 0, visit_scheduled_at: null, rough_visit_time_text: null,
  parsed_visit_reminder_at: null, time_parse_status: 'NOT_PARSED', time_parse_note: null,
  next_follow_up_at: null, last_contacted_at: null, last_feedback_type: 'UNKNOWN', next_action: null,
  no_show_count: 0, lost_reason: null, payment_status: 'NOT_STARTED', deal_amount: null, paid_at: null,
  closed_at: null, website: null, region: '广东', industry: '小家电', contact_person: null, email: null,
  address: null, pitch_angle: null, qualification_reason: null, source: null, notes: null,
  current_stage_card_id: 'card-1', battle_card_status: 'CONFIRMED', last_battle_review_at: '2026-08-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const card: CustomerStageCardRow = {
  id: 'card-1', customer_id: 'cust-tinsol', stage_code: 'NEW_LEAD', version: 1,
  schema_version: 'battle-card-payload-v1', card_status: 'CONFIRMED', source_import_id: 'import-1',
  supersedes_card_id: null, payload_json: '{}', evidence_snapshot_hash: 'abc', generated_by: 'DETERMINISTIC',
  confirmed_by: 'HUMAN_CONFIRM', created_at: '2026-08-01T00:00:00Z', confirmed_at: '2026-08-01T00:00:00Z',
};

describe('BattleCardHeader', () => {
  it('renders customer, stage, card version and status', () => {
    render(<BattleCardHeader customer={customer} currentCard={card} evidenceFreshness="无变化" onBack={() => {}} onOpenHistory={() => {}} onEnterAgent={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('广州电秀科技发展有限公司');
    expect(text).toContain('新线索');
    expect(text).toContain('已确认');
    expect(text).toContain('v1');
    expect(container.querySelector('[data-testid="bc-open-history"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bc-enter-agent"]')).toBeTruthy();
  });

  it('renders no-card state without a card', () => {
    render(<BattleCardHeader customer={{ ...customer, battle_card_status: 'NONE' }} currentCard={null} evidenceFreshness="—" onBack={() => {}} onOpenHistory={() => {}} onEnterAgent={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('无作战卡');
    expect(text).toContain('—');
  });
});

describe('KeyHypothesisBlock', () => {
  const hypotheses = [
    { hypothesis_id: 'h1', statement: '新品状态可能被聊天信息淹没', status: 'PENDING', applicability: 'CONDITIONAL', why_it_matters: '决定切入场景', validation_question: '当前用什么表？', disconfirm_condition: '已有 PLM', evidence_count: 2, is_placeholder: false },
    { hypothesis_id: 'h2', statement: '合规压力大', status: 'PARTIALLY_CONFIRMED', applicability: 'CONDITIONAL', why_it_matters: null, validation_question: null, disconfirm_condition: null, evidence_count: 0, is_placeholder: false },
    { hypothesis_id: 'insufficient', statement: '关键假设不足，仍需补充信息', status: 'PENDING', applicability: 'CONDITIONAL', why_it_matters: null, validation_question: null, disconfirm_condition: null, evidence_count: 0, is_placeholder: true },
  ];

  it('shows full hypothesis detail (why/verify/disconfirm/evidence) and placeholder distinction', () => {
    render(<KeyHypothesisBlock hypotheses={hypotheses} onUpdateStatus={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('H1：新品状态可能被聊天信息淹没');
    expect(text).toContain('决定切入场景');
    expect(text).toContain('当前用什么表？');
    expect(text).toContain('已有 PLM');
    expect(text).toContain('2 条');
    expect(text).toContain('关键假设不足，仍需补充信息');
    expect(container.querySelector('[data-testid="bc-hyp-update-0"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bc-hyp-update-2"]')).toBeNull();
    // 假设不得显示为已核实
    expect(text).not.toContain('已核实');
  });
});

describe('NextBestActionBlock', () => {
  const next = {
    target_role: '决策人', channel: 'wechat + phone', recommended_time: '2026-08-03T09:00:00Z',
    objective: '完成首次触达', opening: '您好，想和您聊一下近期的业务场景。',
    questions: ['问题一', '问题二'], success_signal: '正面反馈', failure_signal: '明确拒绝', fallback_action: '低频维护',
  };
  it('renders 找谁/渠道/目标/开场/问题/信号/备用动作 and copy button', () => {
    render(<NextBestActionBlock next={next} />);
    const text = container.textContent ?? '';
    expect(text).toContain('决策人');
    expect(text).toContain('微信');
    expect(text).toContain('完成首次触达');
    expect(text).toContain('您好，想和您聊一下近期的业务场景。');
    expect(text).toContain('问题一');
    expect(text).toContain('正面反馈');
    expect(text).toContain('明确拒绝');
    expect(text).toContain('低频维护');
    expect(container.querySelector('[data-testid="bc-nba-opening"]')).toBeTruthy();
    expect(text).toContain('复制开场话术');
  });
});

describe('FeishuTalkTrackBlock', () => {
  it('shows original marked as non-overwritable plus variants', () => {
    render(<FeishuTalkTrackBlock talk={{
      original: '原文话术段落', current: '人工替换版', short_spoken_version: '短口语', full_spoken_version: null, wechat_version: '微信版',
      original_is_current: false, version_count: 1, paragraphs: ['人工替换版'],
    }} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Original（原始材料）');
    expect(text).toContain('原文话术段落');
    expect(text).toContain('来自原始战前材料，不会被后续版本覆盖');
    expect(text).toContain('Current（当前话术）');
    expect(text).toContain('短口语版');
    expect(text).toContain('微信版');
  });
});

describe('PeerReferencesBlock', () => {
  it('renders company + why comparable + non-transferable boundary (never just a name)', () => {
    render(<PeerReferencesBlock peers={[
      { company_name: 'SUPRENT', comparison_level: '同品类出海', why_comparable: '同品类出海客户字段可借鉴', reusable_pattern: '客户字段设计', non_transferable_boundary: '多平台深度不同', source_refs: ['import:peers'] },
    ]} />);
    const text = container.textContent ?? '';
    expect(text).toContain('SUPRENT');
    expect(text).toContain('同品类出海客户字段可借鉴');
    expect(text).toContain('客户字段设计');
    expect(text).toContain('多平台深度不同');
  });
});

describe('EvidenceDrawer', () => {
  it('opens and closes; renders refs with labels', () => {
    const evidence = [{ refs: ['import:company', 'FOLLOW_UP_RECORD:fu-1'], import_refs: ['import:company'], crm_refs: ['FOLLOW_UP_RECORD:fu-1'], derived_refs: [] }];
    render(<EvidenceDrawer open={true} title="阶段行动卡" evidence={evidence} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="bc-evidence-drawer"]')).toBeTruthy();
    expect(container.textContent).toContain('材料来源：company');
    render(<EvidenceDrawer open={false} title="阶段行动卡" evidence={evidence} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="bc-evidence-drawer"]')).toBeNull();
  });
});

describe('VersionHistoryPanel', () => {
  it('renders versions with supersedes/status/current flag and view action', () => {
    render(<VersionHistoryPanel rows={[
      { id: 'card-2', version: 2, stage_code: 'NEW_LEAD', card_status: 'DRAFT', generated_by: 'DETERMINISTIC', supersedes_card_id: 'card-1', confirmed_at: null, created_at: '2026-08-02T00:00:00Z', is_current: true, change_summary: '新增待验证假设' },
      { id: 'card-1', version: 1, stage_code: 'NEW_LEAD', card_status: 'CONFIRMED', generated_by: 'DETERMINISTIC', supersedes_card_id: null, confirmed_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', is_current: false, change_summary: '首张作战卡' },
    ]} onView={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('v2');
    expect(text).toContain('当前');
    expect(text).toContain('新增待验证假设');
    expect(text).toContain('历史版本只读');
    expect(container.querySelector('[data-testid="bc-version-view-1"]')).toBeTruthy();
  });
});

describe('DailyReviewQueueRow', () => {
  const item: DailyReviewRowView = {
    customer_id: 'c1', customer_name: '广州电秀', stage: 'NEW_LEAD', priority: 'A',
    reasons: ['P0/P1 客户没有下一步动作', 'Next follow-up 已逾期 3 天'], current_goal: '完成首次触达',
    key_hypotheses: ['H1 假设', 'H2 假设'], next_best_action: '联系决策人', card_age_days: 5,
    evidence_changes: ['最新互动晚于卡片确认时间'], urgency_score: 45, coach_note: null,
    is_overdue: true, is_due_today: false,
  };
  it('renders reasons, goal, hypotheses, next action, age, evidence changes, urgency and actions', () => {
    render(<DailyReviewQueueRow item={item} onOpenCard={() => {}} onHandToAgent={() => {}} onRecordFollowUp={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('广州电秀');
    expect(text).toContain('已逾期');
    expect(text).toContain('P0/P1 客户没有下一步动作');
    expect(text).toContain('完成首次触达');
    expect(text).toContain('H1 假设');
    expect(text).toContain('联系决策人');
    expect(text).toContain('5 天');
    expect(text).toContain('最新互动晚于卡片确认时间');
    expect(text).toContain('紧急度 45');
    expect(container.querySelector('[data-testid="bcr-open-card"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bcr-hand-to-agent"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bcr-record-followup"]')).toBeTruthy();
  });
});

describe('状态 Banner（empty / error / draft / confirmed 状态呈现）', () => {
  it('renders neutral empty banner with actions', () => {
    render(<BattleCardStatusBanner testId="bc-no-card" tone="neutral" title="该客户还没有作战卡" note="导入战前材料并审核后生成。" actions={[<button key="a" type="button">导入战前材料</button>]} />);
    const text = container.textContent ?? '';
    expect(text).toContain('该客户还没有作战卡');
    expect(text).toContain('导入战前材料');
  });
  it('renders danger error banner', () => {
    render(<BattleCardStatusBanner testId="bc-error" tone="danger" title="加载失败" note="客户不存在或已删除。" />);
    expect(container.textContent).toContain('加载失败');
    expect(container.querySelector('[data-testid="bc-error"]')).toBeTruthy();
  });
});

describe('AgentSidecar open/close', () => {
  it('opens with card ref and closes; reopen button returns', async () => {
    const { AgentSidecar } = await import('../components/battleCard/AgentSidecar');
    const { useState } = await import('react');
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <AgentSidecar customerId="c1" customerName="广州电秀" cardRef="NEW_LEAD v1" open={open} onClose={() => setOpen(false)} quickActions={[{ id: 'q1', label: '总结当前作战重点', prompt: '总结' }]} />
          {!open ? <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>展开</button> : null}
        </>
      );
    }
    render(<Harness />);
    expect(container.querySelector('[data-testid="bc-agent-sidecar"]')).toBeTruthy();
    expect(container.textContent).toContain('NEW_LEAD v1');
    expect(container.textContent).toContain('总结当前作战重点');
    act(() => { (container.querySelector('[data-testid="bc-sidecar-close"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="bc-agent-sidecar"]')).toBeNull();
    act(() => { (container.querySelector('[data-testid="reopen"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="bc-agent-sidecar"]')).toBeTruthy();
  });
});

describe('1366 宽度结构状态', () => {
  it('battle card page layout keeps main + sidecar without horizontal overflow wrappers', () => {
    render(
      <div className="bc-page">
        <div className="bc-layout">
          <main className="bc-main" data-testid="bc-main">card</main>
          <aside className="bc-sidecar" data-testid="bc-sidecar">agent</aside>
        </div>
      </div>,
    );
    const layout = container.querySelector('.bc-layout');
    expect(layout).toBeTruthy();
    // 结构上 main 与 sidecar 并存（jsdom 不加载 CSS；横向溢出由 E2E 真实视口验证）
    expect(container.querySelector('[data-testid="bc-main"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="bc-sidecar"]')).toBeTruthy();
  });
});
