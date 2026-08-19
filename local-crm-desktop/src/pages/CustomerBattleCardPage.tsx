import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { History, X } from 'lucide-react';
import { getBattleCardUiClient } from '../lib/battleCardUi/battleCardClient';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';
import { toStageCardBundle, toVersionHistoryRows, evaluateBattleCardCoherence, type StageCardViewBundle } from '../lib/battleCardUi/battleCardViewModels';
import { formatDateTime, stageLabel } from '../lib/battleCardUi/battleCardLabels';
import type { Customer, CustomerStage } from '../lib/types';
import type { CustomerHypothesisRow, CustomerStageCardRow } from '../lib/battleCard/types';
import { createCustomerScopedSalesAgentEntry } from '../lib/salesWorkspace/customerScopedSalesAgentEntry';
import { getStageRule } from '../lib/battleCard/stageRules';
import { listVisits } from '../lib/db';
import { BattleCardHeader } from '../components/battleCard/BattleCardHeader';
import { ActionCardView } from '../components/battleCard/ActionCardView';
import { SolutionReferenceCardView } from '../components/battleCard/SolutionReferenceCardView';
import { EvidenceDrawer } from '../components/battleCard/EvidenceDrawer';
import { VersionHistoryPanel } from '../components/battleCard/VersionHistoryPanel';
import { BattleCardStatusBanner } from '../components/battleCard/BattleCardStatusBanner';
import { ImportWizard } from '../components/battleCard/ImportWizard';
import { AgentSidecar } from '../components/battleCard/AgentSidecar';
import { HYPOTHESIS_STATUS_LABELS } from '../lib/battleCardUi/battleCardLabels';
import { t, tFormat } from '../lib/i18n/appLocale';
import { useAppLocale } from '../lib/i18n/LocaleProvider';
import '../components/battleCard/battleCard.css';

const SIDECAR_QUICK_ACTIONS = [
  { id: 'summarize', label: '总结当前作战重点', prompt: '请基于当前客户上下文，总结这次作战的重点与当前阶段目标。' },
  { id: 'first-contact', label: '帮我准备首次联系', prompt: '帮我准备首次联系：开场、关键问题与成功信号。' },
  { id: 'verify-questions', label: '给出三个验证问题', prompt: '给出三个用于验证当前待验证假设的具体问题。' },
  { id: 'followup-draft', label: '根据当前卡写跟进草稿', prompt: '根据当前作战卡写一条跟进记录草稿。' },
  { id: 'next-followup', label: '安排下一次跟进', prompt: '安排下一次跟进并更新下次跟进时间。' },
] as const;

export default function CustomerBattleCardPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  useAppLocale();
  const client = getBattleCardUiClient();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [currentCard, setCurrentCard] = useState<CustomerStageCardRow | null>(null);
  const [history, setHistory] = useState<readonly CustomerStageCardRow[]>([]);
  const [viewingCard, setViewingCard] = useState<CustomerStageCardRow | null>(null);
  const [hypotheses, setHypotheses] = useState<readonly CustomerHypothesisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sidecarOpen, setSidecarOpen] = useState(true);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftAction, setDraftAction] = useState('');
  const [hasVisit, setHasVisit] = useState(false);
  const [statusUpdateTarget, setStatusUpdateTarget] = useState<CustomerHypothesisRow | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const loadedFor = useRef('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [customerRow, current, cardHistory, visits] = await Promise.all([
        client.getCustomer(id),
        client.getCurrentStageCard(id),
        client.listStageCardHistory(id),
        listVisits(id),
      ]);
      if (!customerRow) throw new Error(t('battle.notFound'));
      setCustomer(customerRow);
      setCurrentCard(current);
      setHistory(cardHistory);
      setHasVisit(visits.length > 0);
      const hypothesesRows = await client.listHypotheses(id);
      setHypotheses(hypothesesRows);
      // 当前卡只读展示；历史卡不覆盖当前卡
      setViewingCard(current);
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [id, client]);

  useEffect(() => {
    if (loadedFor.current === id) return;
    loadedFor.current = id;
    void load();
  }, [id, load]);

  const bundle = useMemo<StageCardViewBundle | null>(() => {
    if (!viewingCard) return null;
    try {
      return toStageCardBundle(viewingCard);
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
      return null;
    }
  }, [viewingCard]);

  /** 最新草稿卡（current_stage_card_id 指针只在确认后设置，草稿须从历史查找）。 */
  const latestDraftCard = useMemo(
    () => [...history].reverse().find(card => card.card_status === 'DRAFT') ?? null,
    [history],
  );

  const versionRows = useMemo(
    () => toVersionHistoryRows(history, currentCard?.id ?? null),
    [history, currentCard],
  );

  const evidenceSummaries = useMemo(() => {
    if (!bundle) return [];
    return [
      { refs: bundle.action.evidence_refs, import_refs: bundle.action.evidence_refs.filter(ref => ref.startsWith('import:')), crm_refs: bundle.action.evidence_refs.filter(ref => /^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):/.test(ref)), derived_refs: bundle.action.evidence_refs.filter(ref => !ref.startsWith('import:') && !/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):/.test(ref)) },
      { refs: bundle.solution.evidence_refs, import_refs: bundle.solution.evidence_refs.filter(ref => ref.startsWith('import:')), crm_refs: bundle.solution.evidence_refs.filter(ref => /^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):/.test(ref)), derived_refs: bundle.solution.evidence_refs.filter(ref => !ref.startsWith('import:') && !/^(CUSTOMER|FOLLOW_UP_RECORD|VISIT_RECORD|TASK):/.test(ref)) },
    ];
  }, [bundle]);

  const evidenceFreshness = useMemo(() => {
    if (!customer || customer.battle_card_status !== 'CONFIRMED') return '—';
    return customer.last_battle_review_at ? tFormat('battle.freshnessReviewed', { time: formatDateTime(customer.last_battle_review_at) }) : t('battle.freshnessConfirmed');
  }, [customer]);

  const handleGenerateDraft = useCallback(async (targetId = id) => {
    if (!customer) return;
    setGeneratingDraft(true);
    setError('');
    try {
      const stageCode = customer.stage as CustomerStage;
      const draft = await client.generateStageCardDraft(targetId, stageCode);
      setDraftAction(tFormat('battle.draftGenerated', { stage: stageLabel(stageCode), version: draft.version }));
      await load();
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setGeneratingDraft(false);
    }
  }, [customer, id, client, load]);

  // 支持从 Sales Agent 入口带意图进入：openImport / openGenerateDraft
  const locationState = location.state as { openImport?: boolean; openGenerateDraft?: boolean } | null;
  const handledIntent = useRef(false);
  useEffect(() => {
    if (handledIntent.current || !customer) return;
    if (locationState?.openImport) {
      handledIntent.current = true;
      setImportOpen(true);
    } else if (locationState?.openGenerateDraft) {
      handledIntent.current = true;
      void handleGenerateDraft();
    }
  }, [locationState, customer, handleGenerateDraft]);

  const handleConfirmDraft = useCallback(async () => {
    const draftCard = latestDraftCard;
    if (!draftCard || !customer) return;
    setDraftAction('');
    setError('');
    try {
      const proposal = await client.proposeConfirmStageCard(customer.id, draftCard.id, draftCard.version);
      await client.confirmProposal(proposal);
      setDraftAction(t('battle.draftConfirmed'));
      await load();
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    }
  }, [latestDraftCard, customer, client, load]);

  const handleDiscardDraft = useCallback(async () => {
    // 草稿不删除（append-only）；仅刷新状态提示
    setDraftAction('');
    setError('');
    try {
      await load();
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    }
  }, [load]);

  const handleUpdateHypothesis = useCallback(async (newStatus: CustomerHypothesisRow['status']) => {
    if (!statusUpdateTarget || !customer) return;
    setStatusUpdating(true);
    setError('');
    try {
      const proposal = await client.proposeUpdateHypothesisStatus({
        customer_id: customer.id,
        hypothesis_id: statusUpdateTarget.id,
        new_status: newStatus,
        reason: `作战卡页面人工更新：${HYPOTHESIS_STATUS_LABELS[newStatus]}`,
        expected_version: statusUpdateTarget.updated_at,
      });
      await client.confirmProposal(proposal);
      setStatusUpdateTarget(null);
      await load();
    } catch (cause) {
      setError(formatUserFacingErrorMessage(cause));
    } finally {
      setStatusUpdating(false);
    }
  }, [statusUpdateTarget, customer, client, load]);

  const handleImported = useCallback(async () => {
    await load();
  }, [load]);

  const handleEnterAgent = useCallback(() => {
    if (!customer) return;
    const entry = createCustomerScopedSalesAgentEntry({
      customer_id: customer.id,
      context_snapshot_reference: `customer:${customer.id}`,
      active_memory_ids: [],
      timeline_evidence_ids: [],
      profile_identity: 'local-sales-agent',
    });
    navigate('/ai-workspace', { state: { customerScopedEntry: entry } });
  }, [customer, navigate]);

  const handleViewVersion = useCallback((cardId: string) => {
    const card = history.find(item => item.id === cardId);
    if (card) {
      setViewingCard(card);
      setHistoryOpen(false);
    }
  }, [history]);

  const statusText = customer?.battle_card_status ?? 'NONE';
  const stageCode = (customer?.stage as CustomerStage) ?? 'NEW_LEAD';
  const stageRule = getStageRule(stageCode);
  const coherence = evaluateBattleCardCoherence({
    customerStage: customer?.stage ?? 'NEW_LEAD',
    cardStageCode: currentCard?.stage_code ?? null,
    hasVisit,
  });

  if (loading && !customer) {
    return <div className="bc-page" data-testid="bc-page-loading"><div className="bc-layout"><div className="bc-main"><p>{t('battle.loading')}</p></div></div></div>;
  }

  if (!customer) {
    return (
      <div className="bc-page">
        <div className="bc-layout"><div className="bc-main">
          <BattleCardStatusBanner testId="bc-error-no-customer" tone="danger" title={t('battle.notFound')} note={error || undefined} actions={[<button key="back" type="button" className="bc-btn" onClick={() => navigate('/customers')}>{t('battle.backToList')}</button>]} />
        </div></div>
      </div>
    );
  }

  return (
    <div className="bc-page" data-testid="bc-page" data-customer-id={customer.id} data-card-coherence={coherence.kind}>
      <div className="bc-layout">
        <div className="bc-main">
          <BattleCardHeader
            customer={customer}
            currentCard={currentCard}
            evidenceFreshness={evidenceFreshness}
            onBack={() => navigate(`/customers/${customer.id}`)}
            onOpenHistory={() => setHistoryOpen(true)}
            onEnterAgent={handleEnterAgent}
          />

          {error ? <div role="alert" className="bc-banner danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          {statusText === 'NONE' ? (
            <BattleCardStatusBanner
              testId="bc-no-card"
              tone="neutral"
              title={t('battle.noneTitle')}
              note={t('battle.noneNote')}
              actions={[
                <button key="import" type="button" className="bc-btn bc-btn-primary" onClick={() => setImportOpen(true)} data-testid="bc-open-import">{t('battle.importMaterial')}</button>,
                <button key="draft" type="button" className="bc-btn" disabled={generatingDraft} onClick={() => void handleGenerateDraft()} data-testid="bc-generate-from-crm">{t('battle.generateFromCrm')}</button>,
              ]}
            />
          ) : null}

          {statusText === 'DRAFT' ? (
            <BattleCardStatusBanner
              testId="bc-draft-banner"
              tone="warning"
              title={t('battle.draftTitle')}
              note={latestDraftCard ? `阶段 ${stageLabel(latestDraftCard.stage_code)} · v${latestDraftCard.version} · 生成于 ${formatDateTime(latestDraftCard.created_at)}（${latestDraftCard.generated_by === 'DETERMINISTIC' ? '本地规则，未调用模型' : '模型增强'}）。草稿确认后才会生效，不会自动推进阶段或调整等级。` : undefined}
              actions={[
                <button key="confirm" type="button" className="bc-btn bc-btn-primary" onClick={() => void handleConfirmDraft()} data-testid="bc-confirm-draft">{t('battle.confirmCard')}</button>,
                <button key="regenerate" type="button" className="bc-btn" disabled={generatingDraft} onClick={() => void handleGenerateDraft()}>{t('battle.regenerateDraft')}</button>,
                <button key="discard" type="button" className="bc-btn bc-btn-ghost" onClick={() => void handleDiscardDraft()}>{t('battle.deferDraft')}</button>,
              ]}
            />
          ) : null}

          {statusText === 'CONFIRMED' && currentCard && coherence.kind === 'stale' ? (
            <BattleCardStatusBanner
              testId="bc-stale-banner"
              tone="warning"
              title={t('battle.staleTitle')}
              note={coherence.user_message}
              actions={[
                <button key="regenerate" type="button" className="bc-btn bc-btn-primary" disabled={generatingDraft} onClick={() => void handleGenerateDraft()} data-testid="bc-regenerate-stale-card">{t('battle.regenerateStale')}</button>,
                <button key="evidence" type="button" className="bc-btn" onClick={() => setEvidenceOpen(true)}>{t('battle.viewEvidence')}</button>,
              ]}
            />
          ) : null}

          {statusText === 'CONFIRMED' && currentCard && coherence.kind !== 'stale' ? (
            <BattleCardStatusBanner
              testId="bc-confirmed-banner"
              tone="neutral"
              title={tFormat('battle.confirmedTitle', { stage: stageLabel(currentCard.stage_code), version: currentCard.version })}
              note={`确认于 ${formatDateTime(currentCard.confirmed_at)}。新情报可重新生成新版本草稿；旧版本保留可查。`}
              actions={[
                <button key="regenerate" type="button" className="bc-btn" disabled={generatingDraft} onClick={() => void handleGenerateDraft()} data-testid="bc-regenerate-card">{t('battle.regenerateLatest')}</button>,
                <button key="evidence" type="button" className="bc-btn" onClick={() => setEvidenceOpen(true)} data-testid="bc-open-evidence">{t('battle.viewEvidence')}</button>,
              ]}
            />
          ) : null}

          {draftAction ? <div role="status" className="bc-banner" style={{ marginBottom: 14 }} data-testid="bc-draft-action"><span>{draftAction}</span></div> : null}

          {importOpen ? (
            <div className="bc-card" style={{ marginBottom: 16 }}>
              <div className="bc-card-body">
                <ImportWizard
                  customerId={customer.id}
                  customerName={customer.name}
                  onClose={() => setImportOpen(false)}
                  onImported={handleImported}
                  onGenerateDraft={handleGenerateDraft}
                />
              </div>
            </div>
          ) : null}

          {bundle ? (
            <>
              {viewingCard && viewingCard.id !== currentCard?.id ? (
                <BattleCardStatusBanner
                  testId="bc-history-view"
                  tone="warning"
                  title={tFormat('battle.historyViewTitle', { version: viewingCard.version, stage: stageLabel(viewingCard.stage_code) })}
                  note={t('battle.historyViewNote')}
                  actions={[<button key="current" type="button" className="bc-btn" onClick={() => setViewingCard(currentCard)}>{t('battle.returnCurrent')}</button>]}
                />
              ) : null}
              <ActionCardView
                action={bundle.action}
                onUpdateHypothesisStatus={hypothesisId => {
                  const target = hypotheses.find(hypothesis => hypothesis.id === hypothesisId);
                  if (target) setStatusUpdateTarget(target);
                }}
              />
              <details className="bc-fold" data-testid="bc-supporting-material">
                <summary>{t('battle.supportingMaterial')}</summary>
                <SolutionReferenceCardView solution={bundle.solution} />
              </details>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 8 }}>
                <button type="button" className="bc-btn bc-btn-sm" onClick={() => setEvidenceOpen(true)} data-testid="bc-evidence-footer">{t('battle.viewEvidence')}</button>
              </div>
            </>
          ) : null}
        </div>

        <AgentSidecar
          customerId={customer.id}
          customerName={customer.name}
          cardRef={currentCard
            ? `${coherence.kind === 'stale' ? '已过时 · ' : ''}${stageLabel(currentCard.stage_code)} v${currentCard.version}${currentCard.card_status === 'DRAFT' ? '（草稿）' : ''}`
            : latestDraftCard ? `${stageLabel(latestDraftCard.stage_code)} v${latestDraftCard.version}（草稿）` : '尚未生成'}
          open={sidecarOpen}
          onClose={() => setSidecarOpen(false)}
          quickActions={SIDECAR_QUICK_ACTIONS}
        />
        {!sidecarOpen ? (
          <button type="button" className="bc-btn bc-btn-primary bc-sidecar-toggle" style={{ display: 'inline-flex', position: 'fixed', right: 16, bottom: 16, zIndex: 45 }} onClick={() => setSidecarOpen(true)} data-testid="bc-sidecar-reopen">
            <History size={14} aria-hidden="true" />{t('battle.expandAgent')}
          </button>
        ) : null}
      </div>

      {statusUpdateTarget ? (
        <div className="bc-drawer-backdrop" role="presentation" onClick={() => setStatusUpdateTarget(null)}>
          <aside className="bc-drawer" role="dialog" aria-modal="true" aria-label={t('battle.hyp.updateTitle')} data-testid="bc-hyp-status-panel" onClick={event => event.stopPropagation()}>
            <header className="bc-drawer-header">
              <h3>{t('battle.hyp.updateTitle')}</h3>
              <button type="button" className="bc-sidecar-close" aria-label={t('battle.close')} onClick={() => setStatusUpdateTarget(null)}><X size={16} /></button>
            </header>
            <div className="bc-drawer-body">
              <p className="bc-section-body" style={{ marginBottom: 8 }}>{statusUpdateTarget.statement}</p>
              <p className="bc-banner-note" style={{ marginBottom: 12 }}>当前状态：{HYPOTHESIS_STATUS_LABELS[statusUpdateTarget.status]} · 最近更新：{formatDateTime(statusUpdateTarget.updated_at)}。状态变更写入审计日志，需人工确认 Proposal。</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(['PENDING', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED', 'EXPIRED'] as const).map(status => (
                  <button key={status} type="button" className="bc-btn" disabled={statusUpdating || status === statusUpdateTarget.status} onClick={() => void handleUpdateHypothesis(status)} data-testid={`bc-hyp-set-${status}`}>
                    {HYPOTHESIS_STATUS_LABELS[status]}{status === statusUpdateTarget.status ? '（当前）' : ''}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="bc-drawer-backdrop" role="presentation" onClick={() => setHistoryOpen(false)}>
          <aside className="bc-drawer" role="dialog" aria-modal="true" aria-label={t('battle.history')} data-testid="bc-history-panel" onClick={event => event.stopPropagation()}>
            <header className="bc-drawer-header">
              <h3>{t('battle.history')}</h3>
              <button type="button" className="bc-sidecar-close" aria-label={t('battle.close')} onClick={() => setHistoryOpen(false)}><X size={16} /></button>
            </header>
            <div className="bc-drawer-body">
              <VersionHistoryPanel rows={versionRows} onView={handleViewVersion} />
            </div>
          </aside>
        </div>
      ) : null}

      <EvidenceDrawer
        open={evidenceOpen}
        title={bundle ? `阶段行动卡 + 方案参照卡` : '作战卡'}
        evidence={evidenceSummaries}
        onClose={() => setEvidenceOpen(false)}
      />

      {/* 阶段信息辅助（进入条件/退出条件由主卡展示，这里补充阶段规则来源说明） */}
      <div style={{ display: 'none' }} data-testid="bc-stage-rule">{stageRule.stage_goal}</div>
    </div>
  );
}
