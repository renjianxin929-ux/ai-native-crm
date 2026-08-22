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
import { t, tFormat, tStage } from '../lib/i18n/appLocale';
import { useAppLocale } from '../lib/i18n/LocaleProvider';
import '../components/battleCard/battleCard.css';

type FollowUpDraftTarget = { customerId: string; customerName: string };

export default function DailyBattleReviewPage() {
  const navigate = useNavigate();
  useAppLocale();
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
  const [expanded, setExpanded] = useState(false);
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
  }, [followUpTarget, followUpText, load]);

  const overdue = items.filter(item => item.is_overdue).slice(0, 2);
  const dueToday = items.filter(item => item.is_due_today).slice(0, 3);
  const todayItems = items.slice(0, 3);
  const conclusion = items.length === 0
    ? t('review.emptyConclusion')
    : tFormat('review.todayCount', { n: items.length });

  const tomorrowItems = dueToday.length > 0 ? dueToday : todayItems.slice(0, 3);

  return (
    <div className="bc-page review-page" data-testid="bc-daily-review-page">
      <div className="review-short">
        <header className="review-short-header">
          <h2>{t('review.title')}</h2>
          <p className="page-subtitle">{t('review.subtitle')}</p>
        </header>

        {error ? <BattleCardStatusBanner testId="bcr-error" tone="danger" title={t('review.loadFailed')} note={error} /> : null}
        {pageNotice ? <div role="status" className="bc-banner review-notice" data-testid="bcr-page-notice">{pageNotice}</div> : null}

        <section className="review-memo" data-testid="review-short-memo">
          <p className="review-conclusion">{loading ? t('review.loading') : conclusion}</p>
          <div className="review-block">
            <h3>{t('review.today')}</h3>
            {!loading && todayItems.length > 0 ? (
              <ul>
                {todayItems.map(item => (
                  <li key={`today-${item.customer_id}`}>{item.customer_name} · {item.reasons[0] || tStage(item.stage) || item.stage}</li>
                ))}
              </ul>
            ) : (
              <p className="review-empty-line">{loading ? '…' : t('review.todayEmpty')}</p>
            )}
          </div>
          <div className="review-block">
            <h3>{t('review.watch')}</h3>
            {!loading && overdue.length > 0 ? (
              <ul>
                {overdue.map(item => (
                  <li key={`note-${item.customer_id}`}>{item.customer_name} {t('review.overdue')}</li>
                ))}
              </ul>
            ) : (
              <p className="review-empty-line">{loading ? '…' : t('review.watchEmpty')}</p>
            )}
          </div>
          <div className="review-block">
            <h3>{t('review.tomorrow')}</h3>
            {!loading && tomorrowItems.length > 0 ? (
              <ul>
                {tomorrowItems.map(item => (
                  <li key={`next-${item.customer_id}`}>{item.customer_name}</li>
                ))}
              </ul>
            ) : (
              <p className="review-empty-line">{loading ? '…' : t('review.tomorrowEmpty')}</p>
            )}
          </div>
          <div className="review-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/ai-workspace', { state: { initialInstruction: '请根据今天的客户队列生成一份短复盘：今天发生了什么、值得注意、明天先做什么。' } })}
            >
              {t('review.askAgent')}
            </button>
            <button type="button" className="agent-link-btn" data-testid="review-expand" onClick={() => setExpanded(open => !open)}>
              {expanded ? t('review.collapse') : t('review.expand')}
            </button>
          </div>
        </section>

        {expanded ? (
          <div className="review-full">
        <header className="review-full-header">
          <div>
            <h2>完整队列</h2>
            {generatedAt ? <p className="page-subtitle">生成于 {new Date(generatedAt).toLocaleString('zh-CN')}</p> : null}
          </div>
          <button type="button" className="bc-btn bc-btn-sm" onClick={() => void load()} data-testid="bcr-refresh">刷新队列</button>
        </header>

        {error ? <BattleCardStatusBanner testId="bcr-error" tone="danger" title={t('review.loadFailed')} note={error} /> : null}
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
        ) : null}
      </div>
    </div>
  );
}
