import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { getBattleCardUiClient } from '../lib/battleCardUi/battleCardClient';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';
import { toDailyReviewRowViews, type DailyReviewRowView } from '../lib/battleCardUi/battleCardViewModels';
import { DailyReviewQueueRow } from '../components/battleCard/DailyReviewQueueRow';
import { BattleCardStatusBanner } from '../components/battleCard/BattleCardStatusBanner';
import { STAGE_LABELS } from '../lib/types';
import { createCustomerScopedSalesAgentEntry } from '../lib/salesWorkspace/customerScopedSalesAgentEntry';
import { createFollowUp, updateCustomer } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';
import '../components/battleCard/battleCard.css';

type FollowUpDraftTarget = { customerId: string; customerName: string };

export default function DailyBattleReviewPage() {
  const navigate = useNavigate();
  const client = getBattleCardUiClient();
  const [items, setItems] = useState<readonly DailyReviewRowView[]>([]);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [followUpTarget, setFollowUpTarget] = useState<FollowUpDraftTarget | null>(null);
  const [followUpText, setFollowUpText] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [followUpResult, setFollowUpResult] = useState('');
  const [pageNotice, setPageNotice] = useState('');
  const loaded = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await client.buildDailyReviewQueue();
      setItems(toDailyReviewRowViews(result.items, result.generated_at));
      setGeneratedAt(result.generated_at);
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();
  }, [load]);

  const filtered = useMemo(() => items.filter(item => {
    if (stageFilter && item.stage !== stageFilter) return false;
    if (gradeFilter && item.priority !== gradeFilter) return false;
    if (dueFilter === 'overdue' && !item.is_overdue) return false;
    if (dueFilter === 'due' && !item.is_due_today) return false;
    return true;
  }), [items, stageFilter, gradeFilter, dueFilter]);

  const handToAgent = useCallback((item: DailyReviewRowView) => {
    const entry = createCustomerScopedSalesAgentEntry({
      customer_id: item.customer_id,
      context_snapshot_reference: `customer:${item.customer_id}`,
      active_memory_ids: [],
      timeline_evidence_ids: [],
      profile_identity: 'local-sales-agent',
    });
    navigate('/ai-workspace', {
      state: { customerScopedEntry: entry, initialInstruction: `今日复盘：${item.customer_name} 进入队列原因：${item.reasons.join('；')}。请总结最近情况并给出下一步建议。` },
    });
  }, [navigate]);

  const saveFollowUp = useCallback(async () => {
    if (!followUpTarget || !followUpText.trim()) return;
    setSavingFollowUp(true);
    setFollowUpResult('');
    try {
      const now = new Date().toISOString();
      await createFollowUp({
        id: uuidv4(),
        customer_id: followUpTarget.customerId,
        title: '复盘跟进',
        contact_channel: null,
        contact_result: null,
        feedback_notes: followUpText.trim(),
        intent_assessment: null,
        suggested_grade: null,
        next_action: null,
        next_follow_up_at: null,
        is_completed: 0,
        created_at: now,
        updated_at: now,
      });
      await updateCustomer(followUpTarget.customerId, { updated_at: now });
      setFollowUpResult(`已为 ${followUpTarget.customerName} 写入跟进记录。`);
      setPageNotice(`已为 ${followUpTarget.customerName} 写入跟进记录。`);
      setFollowUpTarget(null);
      setFollowUpText('');
      await load();
    } catch (cause) {
      setFollowUpResult(`写入失败：${formatUserFacingErrorMessage(cause)}`);
    } finally {
      setSavingFollowUp(false);
    }
  }, [followUpTarget, followUpText, client, load]);

  return (
    <div className="bc-page" data-testid="bc-daily-review-page">
      <div style={{ padding: '20px 24px 32px', maxWidth: 1280, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>每日客户复盘</h2>
            <p className="bc-banner-note" style={{ marginTop: 4 }}>
              确定性规则队列 · 紧急度与排序来自后端计算（不本地重算）· {generatedAt ? `生成时间 ${new Date(generatedAt).toLocaleString('zh-CN')}` : ''}
            </p>
          </div>
          <button type="button" className="bc-btn bc-btn-sm" onClick={() => void load()} data-testid="bcr-refresh">刷新队列</button>
        </header>

        {error ? <BattleCardStatusBanner testId="bcr-error" tone="danger" title="复盘队列加载失败" note={error} /> : null}
        {pageNotice ? <div role="status" className="bc-banner" style={{ marginBottom: 14 }} data-testid="bcr-page-notice">{pageNotice}</div> : null}

        <div className="bcr-toolbar">
          <select aria-label="按阶段筛选" value={stageFilter} onChange={event => setStageFilter(event.target.value)} data-testid="bcr-stage-filter">
            <option value="">全部阶段</option>
            {Object.entries(STAGE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
          <select aria-label="按等级筛选" value={gradeFilter} onChange={event => setGradeFilter(event.target.value)} data-testid="bcr-grade-filter">
            <option value="">全部等级</option>
            {['A', 'B', 'C', 'D'].map(grade => <option key={grade} value={grade}>{grade} 类</option>)}
          </select>
          <select aria-label="按到期筛选" value={dueFilter} onChange={event => setDueFilter(event.target.value)} data-testid="bcr-due-filter">
            <option value="">全部</option>
            <option value="overdue">已逾期</option>
            <option value="due">今天到期</option>
          </select>
          <span className="bc-banner-note">排序：后端 urgency_score 降序 → A&gt;B&gt;C&gt;D → 名称（前端不做重排序）</span>
        </div>

        {loading ? <p data-testid="bcr-loading">正在构建复盘队列…</p> : null}

        {!loading && filtered.length === 0 ? (
          <BattleCardStatusBanner testId="bcr-empty" tone="neutral" title={items.length === 0 ? '今天没有需要复盘的客户' : '当前筛选条件下没有客户'} note={items.length === 0 ? '所有客户均无逾期、停滞或待验证信号。' : '调整筛选条件后重试。'} />
        ) : null}

        {filtered.map(item => (
          <DailyReviewQueueRow
            key={item.customer_id}
            item={item}
            onOpenCard={customerId => navigate(`/customers/${customerId}/battle-card`)}
            onHandToAgent={handToAgent}
            onRecordFollowUp={(customerId, customerName) => setFollowUpTarget({ customerId, customerName })}
          />
        ))}

        {followUpTarget ? (
          <div className="bc-drawer-backdrop" role="presentation" onClick={() => setFollowUpTarget(null)}>
            <aside className="bc-drawer" role="dialog" aria-modal="true" aria-label="记录跟进" data-testid="bcr-followup-panel" onClick={event => event.stopPropagation()}>
              <header className="bc-drawer-header">
                <h3>记录跟进 · {followUpTarget.customerName}</h3>
                <button type="button" className="bc-sidecar-close" aria-label="关闭" onClick={() => setFollowUpTarget(null)}><X size={16} /></button>
              </header>
              <div className="bc-drawer-body">
                <textarea
                  className="bcw-textarea"
                  style={{ minHeight: 160 }}
                  value={followUpText}
                  aria-label="跟进内容"
                  placeholder="本次跟进内容 / 反馈…"
                  onChange={event => setFollowUpText(event.target.value)}
                />
                {followUpResult ? <p role="status" style={{ marginTop: 8, fontSize: 13 }}>{followUpResult}</p> : null}
                <div className="bcw-wizard-footer" style={{ paddingTop: 0, borderTop: 'none' }}>
                  <button type="button" className="bc-btn" onClick={() => setFollowUpTarget(null)}>取消</button>
                  <button type="button" className="bc-btn bc-btn-primary" disabled={savingFollowUp || !followUpText.trim()} onClick={() => void saveFollowUp()} data-testid="bcr-save-followup">
                    {savingFollowUp ? '保存中…' : '写入跟进记录'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
