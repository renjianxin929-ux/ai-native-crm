import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, Search, ShieldAlert } from 'lucide-react';
import { getBattleCardUiClient } from '../../lib/battleCardUi/battleCardClient';
import { formatUserFacingErrorMessage } from '../../lib/salesAgentUi/formatUserFacingError';
import { FACT_APPLICABILITY_LABELS } from '../../lib/battleCardUi/battleCardLabels';
import { assertImportRawWithinProposalLimit, formatByteCount, utf8ByteLength } from '../../lib/battleCardUi/utf8';
import { getDb, searchCustomersInDb } from '../../lib/db';
import type { Customer, CustomerStage } from '../../lib/types';
import type { ImportPreviewResult } from '../../lib/battleCard/importService';
import type { DraftFact, DraftHypothesis } from '../../lib/battleCard/parser';
import type { AgentWriteProposal } from '../../lib/salesAgentTools/confirmedWrite';
import type { FactVerificationItem } from '../../lib/salesAgentTools/confirmedWrite';
import { stageLabel } from '../../lib/battleCardUi/battleCardLabels';
import { BATTLE_CARD_STATUS_LABELS } from '../../lib/battleCardUi/battleCardLabels';
import type { FactApplicability } from '../../lib/battleCard/types';

const SECTION_LABELS: Readonly<Record<string, string>> = {
  company: '主体与公开事实',
  profile: '五维战前画像',
  problem_hypotheses: '当前问题假设',
  landing_points: 'FDE/FDA 推荐落地点',
  why_validate: '为什么值得验证',
  feishu_talk: '飞书话术',
  implementation: '具体实现路径',
  peers: '同行校准',
  first_questions: '首轮挖需问题',
  human_gates: '人工确认门禁',
  poc: 'POC 路径',
  adversarial: '对抗式审查',
  recommendation: '建议推进',
  sources: '来源',
};

export type ImportWizardStage = 'customer' | 'paste' | 'preview' | 'review' | 'proposal' | 'done';

export interface ImportWizardProps {
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly onClose: () => void;
  readonly onImported: (importId: string, customerId: string) => Promise<void>;
  readonly onGenerateDraft: (customerId: string) => Promise<void>;
}

interface ReviewState {
  readonly keep: boolean;
  readonly verify: boolean;
  readonly applicable_scope: string;
  readonly product_line: string;
}

function defaultReviewFor(_fact: DraftFact): ReviewState {
  return { keep: true, verify: false, applicable_scope: '', product_line: '' };
}

function importRefsOf(fact: DraftFact): string[] {
  return fact.evidence_refs.map(ref => ref.import_ref).filter((ref): ref is string => Boolean(ref)).map(ref => (ref.startsWith('import:') ? ref : `import:${ref}`));
}

export function ImportWizard({ customerId, customerName, onClose, onImported, onGenerateDraft }: ImportWizardProps) {
  const client = getBattleCardUiClient();
  const [stage, setStage] = useState<ImportWizardStage>(customerId ? 'paste' : 'customer');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<readonly Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searching, setSearching] = useState(false);
  const [rawContent, setRawContent] = useState('');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [factReviews, setFactReviews] = useState<Readonly<Record<string, ReviewState>>>({});
  const [keptHypotheses, setKeptHypotheses] = useState<Readonly<Record<string, boolean>>>({});
  const [proposal, setProposal] = useState<AgentWriteProposal | null>(null);
  const [proposalError, setProposalError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<string>('');
  const [wizardError, setWizardError] = useState('');
  const searched = useRef(false);

  const effectiveCustomer = selectedCustomer ?? (customerId ? { id: customerId, name: customerName ?? '' } as Customer : null);
  const stageCode: CustomerStage = (effectiveCustomer?.stage as CustomerStage) ?? 'NEW_LEAD';

  // ── Step 1: 客户搜索 ──
  useEffect(() => {
    if (!customerId || searched.current) return;
    searched.current = true;
    void (async () => {
      const db = await getDb();
      const rows = await searchCustomersInDb(db, { name_query: customerName ?? undefined, limit: 5 });
      if (rows.length > 0) setSearchResults(rows);
    })();
  }, [customerId, customerName]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const db = await getDb();
      setSearchResults(await searchCustomersInDb(db, { name_query: query.trim(), limit: 8 }));
    } catch (cause) {
      setWizardError(formatUserFacingErrorMessage(cause));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const pickCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setWizardError('');
    setStage('paste');
  };

  // ── Step 2: 粘贴材料 ──
  const rawBytes = utf8ByteLength(rawContent);
  const overLimit = rawBytes > 262_144;

  const runPreview = useCallback(async () => {
    if (!rawContent.trim() || overLimit) return;
    setPreviewLoading(true);
    setPreviewError('');
    setWizardError('');
    try {
      assertImportRawWithinProposalLimit(rawContent);
      const result = await client.previewImport(rawContent, { customer_id: effectiveCustomer?.id });
      setPreview(result);
      const reviews: Record<string, ReviewState> = {};
      for (const fact of result.draft.extracted_facts) reviews[fact.fact_id] = defaultReviewFor(fact);
      setFactReviews(reviews);
      const kept: Record<string, boolean> = {};
      for (const hypothesis of result.draft.extracted_hypotheses) kept[hypothesis.hypothesis_id] = true;
      setKeptHypotheses(kept);
      setStage('preview');
    } catch (cause) {
      setPreviewError(formatUserFacingErrorMessage(cause));
    } finally {
      setPreviewLoading(false);
    }
  }, [rawContent, overLimit, client]);

  // ── Step 3/4: 审核决策 ──
  const setFactDecision = (factId: string, patch: Partial<ReviewState>) => {
    setFactReviews(current => ({ ...current, [factId]: { ...(current[factId] ?? { keep: true, verify: false, applicable_scope: '', product_line: '' }), ...patch } }));
  };

  const groupedFacts = useMemo(() => {
    if (!preview) return { company: [], assessment: [], facts: [] } as {
      company: DraftFact[]; assessment: DraftFact[]; facts: DraftFact[];
    };
    const company: DraftFact[] = [];
    const assessment: DraftFact[] = [];
    const facts: DraftFact[] = [];
    for (const fact of preview.draft.extracted_facts) {
      if (fact.source_section === 'company' || fact.fact_category === 'COMPANY') company.push(fact);
      else if (fact.fact_category === 'ASSESSMENT') assessment.push(fact);
      else facts.push(fact);
    }
    return { company, assessment, facts };
  }, [preview]);

  const buildVerifications = useCallback((): FactVerificationItem[] => {
    if (!preview) return [];
    const items: FactVerificationItem[] = [];
    for (const fact of preview.draft.extracted_facts) {
      const review = factReviews[fact.fact_id];
      if (!review) continue;
      if (!review.keep) continue;
      if (!review.verify) continue;
      const item: FactVerificationItem = {
        fact_id: fact.fact_id,
        decision: 'VERIFY',
        applicability: fact.applicability,
        evidence_refs: importRefsOf(fact),
        reason: '人工核实：导入确认时明确核实',
        ...(review.applicable_scope.trim() ? { applicable_scope: review.applicable_scope.trim() } : {}),
        ...(review.product_line.trim() ? { product_line: review.product_line.trim() } : {}),
      };
      items.push(item);
    }
    return items;
  }, [preview, factReviews]);

  const blockedConditionalVerifies = useMemo(() => {
    if (!preview) return [];
    return preview.draft.extracted_facts.filter(fact => {
      const review = factReviews[fact.fact_id];
      return review?.keep && review.verify && fact.applicability === 'CONDITIONAL'
        && !review.applicable_scope.trim() && !review.product_line.trim();
    });
  }, [preview, factReviews]);

  // ── Step 5: Proposal ──
  const propose = useCallback(async () => {
    if (!preview || !effectiveCustomer) return;
    setProposalError('');
    setWizardError('');
    try {
      const keepFactIds = Object.entries(factReviews).filter(([, review]) => review.keep).map(([factId]) => factId);
      const keepHypothesisIds = Object.entries(keptHypotheses).filter(([, keep]) => keep).map(([hypothesisId]) => hypothesisId);
      const verifications = buildVerifications();
      const next = await client.proposeConfirmImport({
        customer_id: effectiveCustomer.id,
        raw_content: preview.draft.raw_content,
        keep_fact_ids: keepFactIds,
        keep_hypothesis_ids: keepHypothesisIds,
        fact_verifications: verifications,
      });
      setProposal(next);
      setStage('proposal');
    } catch (cause) {
      setProposalError(formatUserFacingErrorMessage(cause));
    }
  }, [preview, effectiveCustomer, factReviews, keptHypotheses, buildVerifications, client]);

  const cancelProposal = useCallback(() => {
    client.cancelProposal(proposal);
    setProposal(null);
    setStage('review');
  }, [client, proposal]);

  const confirmProposal = useCallback(async () => {
    if (!proposal) return;
    setConfirming(true);
    setProposalError('');
    setWizardError('');
    try {
      const outcome = await client.confirmProposal(proposal);
      setConfirmResult(`导入已完成（import_id: ${outcome.entity_id}）。`);
      setProposal(null);
      setStage('done');
      if (effectiveCustomer) await onImported(outcome.entity_id, effectiveCustomer.id);
    } catch (cause) {
      setProposalError(formatUserFacingErrorMessage(cause));
    } finally {
      setConfirming(false);
    }
  }, [proposal, client, effectiveCustomer, onImported]);

  const renderItemTags = (applicability: FactApplicability, isHypothesis: boolean, verify: boolean | undefined) => (
    <span className="bcw-item-tags">
      <span className="bc-pill bc-pill-warning">{isHypothesis ? '待验证假设' : verify ? '已核事实候选' : '事实候选'}</span>
      <span className={`bc-pill ${applicability === 'CONDITIONAL' ? 'bc-pill-warning' : 'bc-pill-neutral'}`}>
        {FACT_APPLICABILITY_LABELS[applicability]}
      </span>
      {verify ? <span className="bc-pill bc-pill-success">明确核实</span> : null}
    </span>
  );

  const renderFactItem = (fact: DraftFact, index: number, prefix: string) => {
    const review = factReviews[fact.fact_id] ?? defaultReviewFor(fact);
    const isConditional = fact.applicability === 'CONDITIONAL';
    const needsGate = review.verify && isConditional && !review.applicable_scope.trim() && !review.product_line.trim();
    return (
      <article className="bcw-item" key={fact.fact_id} data-testid={`${prefix}-${index}`} data-fact-id={fact.fact_id}>
        <div className="bcw-item-head">
          <span className="bcw-item-statement">{fact.statement}</span>
          {renderItemTags(fact.applicability, false, review.verify)}
        </div>
        <div className="bcw-item-meta">
          <span>类别：{fact.fact_category} · 置信度 {Math.round(fact.confidence * 100)}% · 来源章节：{SECTION_LABELS[fact.source_section] ?? fact.source_section}（第 {fact.source_lines.join('、')} 行）</span>
          <span>默认状态：PENDING（暂不核实）；勾选「明确核实」后写入 VERIFIED{isConditional ? '，但需填写适用边界并携带材料来源证据' : ''}</span>
        </div>
        {fact.source_excerpt ? <div className="bcw-item-source">原文：<span className="bcw-item-excerpt">{fact.source_excerpt}</span></div> : null}
        {stage === 'review' ? (
          <div className="bcw-review-controls" data-testid={`${prefix}-review-${index}`}>
            <label><input type="checkbox" checked={review.keep} onChange={event => setFactDecision(fact.fact_id, { keep: event.target.checked })} /> 保留</label>
            <label><input type="checkbox" checked={review.verify} disabled={!review.keep} onChange={event => setFactDecision(fact.fact_id, { verify: event.target.checked })} /> 明确核实（VERIFIED）</label>
            {review.verify && isConditional ? (
              <>
                <label>适用边界 <input type="text" value={review.applicable_scope} placeholder="如：仅中国区/仅新品线" aria-label={`适用边界-${fact.fact_id}`} onChange={event => setFactDecision(fact.fact_id, { applicable_scope: event.target.value })} /></label>
                <label>产品线 <input type="text" value={review.product_line} placeholder="如：美容仪产品线" aria-label={`产品线-${fact.fact_id}`} onChange={event => setFactDecision(fact.fact_id, { product_line: event.target.value })} /></label>
                <span className="bc-pill bc-pill-neutral">{importRefsOf(fact).length} 条材料来源证据将自动携带</span>
              </>
            ) : null}
            {needsGate ? <span className="bc-pill bc-pill-danger"><ShieldAlert size={12} /> 条件适用项必须填写适用边界/产品线才能核实</span> : null}
          </div>
        ) : null}
      </article>
    );
  };

  const renderHypothesisItem = (hypothesis: DraftHypothesis, index: number) => {
    const kept = keptHypotheses[hypothesis.hypothesis_id] ?? true;
    return (
      <article className="bcw-item" key={hypothesis.hypothesis_id} data-testid={`hypothesis-${index}`} data-hypothesis-id={hypothesis.hypothesis_id}>
        <div className="bcw-item-head">
          <span className="bcw-item-statement">{hypothesis.statement}</span>
          {renderItemTags(hypothesis.applicability, true, undefined)}
        </div>
        <div className="bcw-item-meta">
          <span>类别：{hypothesis.category} · 来源章节：{SECTION_LABELS[hypothesis.source_section] ?? hypothesis.source_section}（第 {hypothesis.source_lines.join('、')} 行）</span>
          {hypothesis.rationale ? <span>依据：{hypothesis.rationale}</span> : null}
          {hypothesis.validation_question ? <span>验证问题：{hypothesis.validation_question}</span> : null}
          {hypothesis.disconfirm_condition ? <span>证伪条件：{hypothesis.disconfirm_condition}</span> : null}
          <span>写入后状态固定为 PENDING（待验证），不会自动成为事实。</span>
        </div>
        {hypothesis.source_excerpt ? <div className="bcw-item-source">原文：<span className="bcw-item-excerpt">{hypothesis.source_excerpt}</span></div> : null}
        {stage === 'review' ? (
          <div className="bcw-review-controls">
            <label><input type="checkbox" checked={kept} onChange={event => setKeptHypotheses(current => ({ ...current, [hypothesis.hypothesis_id]: event.target.checked }))} /> 保留为待验证假设</label>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="bcw-panel" data-testid="bc-import-wizard" aria-label="战前材料导入">
      <div className="bcw-steps">
        <span className={`bcw-step${stage === 'customer' ? ' active' : ''}${stage !== 'customer' ? ' done' : ''}`}><Check size={12} />1 选择客户</span>
        <span className={`bcw-step${stage === 'paste' ? ' active' : ''}${['preview', 'review', 'proposal', 'done'].includes(stage) ? ' done' : ''}`}><Check size={12} />2 粘贴材料</span>
        <span className={`bcw-step${stage === 'preview' ? ' active' : ''}${['review', 'proposal', 'done'].includes(stage) ? ' done' : ''}`}><Check size={12} />3 结构化 Preview</span>
        <span className={`bcw-step${stage === 'review' ? ' active' : ''}${['proposal', 'done'].includes(stage) ? ' done' : ''}`}><Check size={12} />4 人工审核</span>
        <span className={`bcw-step${stage === 'proposal' ? ' active' : ''}${stage === 'done' ? ' done' : ''}`}><Check size={12} />5 Proposal / Confirm</span>
      </div>

      {wizardError ? <div role="alert" className="bc-banner danger" style={{ marginBottom: 12 }}><span>{wizardError}</span></div> : null}

      {stage === 'customer' ? (
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>选择客户</h3>
          <div className="bcw-customer-search">
            <input
              className="bcw-search-input"
              value={query}
              placeholder="输入客户名称搜索…"
              aria-label="搜索客户"
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void runSearch(); }}
            />
            <button type="button" className="bc-btn" onClick={() => void runSearch()} disabled={searching || !query.trim()}>
              <Search size={14} aria-hidden="true" />{searching ? '搜索中…' : '搜索'}
            </button>
          </div>
          <div className="bcw-customer-options">
            {searchResults.map(customer => (
              <button key={customer.id} type="button" className={`bcw-customer-option${selectedCustomer?.id === customer.id ? ' selected' : ''}`} onClick={() => pickCustomer(customer)}>
                <strong>{customer.name}</strong>
                <span>{customer.region ?? '地区未标注'} · {stageLabel(customer.stage)} · {customer.customer_grade} 类 · {BATTLE_CARD_STATUS_LABELS[customer.battle_card_status ?? 'NONE']}</span>
              </button>
            ))}
            {searchResults.length === 0 && !searching ? <p className="bc-section-body">输入名称后搜索；不允许导入到未确认的模糊客户。</p> : null}
          </div>
        </div>
      ) : null}

      {stage === 'paste' ? (
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>粘贴战前材料</h3>
          {effectiveCustomer ? (
            <div className="bcw-customer-card" style={{ marginBottom: 12 }}>
              <div>
                <strong>{effectiveCustomer.name}</strong>
                <span style={{ marginLeft: 8, fontSize: 12.5, color: 'var(--bc-text-muted)' }}>{stageLabel(stageCode)} · {effectiveCustomer.customer_grade} 类 · 当前卡：{BATTLE_CARD_STATUS_LABELS[effectiveCustomer.battle_card_status ?? 'NONE']}</span>
              </div>
              {customerId ? null : <button type="button" className="bc-btn bc-btn-sm" onClick={() => setStage('customer')}>更换客户</button>}
            </div>
          ) : null}
          <p className="bc-banner-note" style={{ marginBottom: 8 }}>
            支持大段长文本（飞书战前材料/客户背调）。将按 UTF-8 字节计数，单 Proposal 上限 256 KiB（262,144 字节），超限时禁止进入 Preview，且不会静默截断。Preview 不调用任何模型（本地确定性解析）。
          </p>
          <textarea
            className={`bcw-textarea${overLimit ? ' over-limit' : ''}`}
            value={rawContent}
            aria-label="战前材料原文"
            placeholder="粘贴战前材料原文…"
            onChange={event => setRawContent(event.target.value)}
          />
          <div className={`bcw-byte-meter${overLimit ? ' over-limit' : ''}`} data-testid="bc-import-byte-meter">
            <span>UTF-8 字节数：{rawBytes.toLocaleString()}（{formatByteCount(rawContent)}）</span>
            <span>/ 262,144（256 KiB）</span>
            {overLimit ? <span><AlertTriangle size={13} /> 超过上限，禁止进入 Preview</span> : null}
          </div>
          {previewError ? <p role="alert" style={{ color: 'var(--bc-danger-text)', marginTop: 8 }}>{previewError}</p> : null}
          <div className="bcw-wizard-footer">
            <button type="button" className="bc-btn" onClick={onClose}>取消</button>
            <button
              type="button"
              className="bc-btn bc-btn-primary"
              onClick={() => void runPreview()}
              disabled={!rawContent.trim() || overLimit || previewLoading}
              data-testid="bc-preview-run"
            >
              <FileText size={15} aria-hidden="true" />{previewLoading ? '解析中…' : '生成结构化 Preview'}
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'preview' && preview ? (
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>结构化 Preview（零写入）</h3>
          <p className="bc-banner-note" style={{ marginBottom: 12 }}>
            以下内容尚未写入 CRM。事实默认 PENDING，假设默认待验证。点击「进入人工审核」后可以调整保留项与核实决策。
          </p>

          <div className="bcw-preview-group" data-testid="bc-preview-company">
            <h4 className="bcw-preview-group-title">主体信息</h4>
            {preview.draft.candidate_customer?.name ? (
              <div className="bcw-item"><span className="bcw-item-statement">识别主体：{preview.draft.candidate_customer.name}</span></div>
            ) : <p className="bc-section-body">未能从材料中识别明确公司主体。</p>}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-facts">
            <h4 className="bcw-preview-group-title">Fact Candidates（{preview.draft.extracted_facts.length}）</h4>
            {preview.draft.extracted_facts.length === 0 ? <p className="bc-section-body">未提取到事实候选。</p> : null}
            {groupedFacts.company.map((fact, index) => renderFactItem(fact, index, 'preview-fact'))}
            {groupedFacts.facts.map((fact, index) => renderFactItem(fact, index + groupedFacts.company.length, 'preview-fact'))}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-hypotheses">
            <h4 className="bcw-preview-group-title">Hypotheses（待验证假设，{preview.draft.extracted_hypotheses.length}）</h4>
            {preview.draft.extracted_hypotheses.map((hypothesis, index) => renderHypothesisItem(hypothesis, index))}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-assessments">
            <h4 className="bcw-preview-group-title">Assessments（五维画像评估，{groupedFacts.assessment.length}）</h4>
            {groupedFacts.assessment.map((fact, index) => renderFactItem(fact, index, 'preview-assessment'))}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-scenarios">
            <h4 className="bcw-preview-group-title">Solution Scenarios（{preview.draft.solution_scenarios.length}）</h4>
            {preview.draft.solution_scenarios.map(scenario => (
              <div className="bcw-item" key={scenario.scenario_name}>
                <span className="bcw-item-statement">{scenario.scenario_name}</span>
                <div className="bcw-item-meta">
                  <span>适用性：{FACT_APPLICABILITY_LABELS[scenario.applicability]} · 人工门禁：{scenario.human_gate || '—'} · 验收指标：{scenario.acceptance_metrics.join('、') || '—'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-talk">
            <h4 className="bcw-preview-group-title">Feishu Talk Track（可直接复述的飞书话术）</h4>
            {preview.draft.feishu_talk_track.paragraphs.length === 0 ? <p className="bc-section-body">无话术段落。</p> : (
              preview.draft.feishu_talk_track.paragraphs.map((paragraph, index) => (
                <div className="bcw-item" key={index}><span className="bcw-item-excerpt">{paragraph.slice(0, 180)}{paragraph.length > 180 ? '…' : ''}</span></div>
              ))
            )}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-peers">
            <h4 className="bcw-preview-group-title">Peer References（{preview.draft.peer_references.length}）</h4>
            {preview.draft.peer_references.map(peer => (
              <div className="bcw-item" key={peer.company_name}>
                <span className="bcw-item-statement">{peer.company_name}</span>
                <div className="bcw-item-meta">
                  <span>对照层级：{peer.comparison_level} · 可比性：{peer.why_comparable}</span>
                  <span>不可照搬：{peer.non_transferable_boundary}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-boundaries">
            <h4 className="bcw-preview-group-title">Human Review Boundaries（人工确认门禁）</h4>
            <ul className="bc-list">{preview.draft.human_review_boundaries.map((item, index) => <li key={index}><span className="bc-list-main">{item}</span></li>)}</ul>
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-conditional">
            <h4 className="bcw-preview-group-title">条件适用项（配方/成分/功效等，{preview.draft.conditional_applicability_items.length}）</h4>
            {preview.draft.conditional_applicability_items.length === 0 ? (
              <p className="bc-section-body">无。此类内容不会被写入 GLOBAL VERIFIED 事实。</p>
            ) : (
              <ul className="bc-list">
                {preview.draft.conditional_applicability_items.map((item, index) => (
                  <li key={index}><span className="bc-pill bc-pill-warning">CONDITIONAL</span><span className="bc-list-main" style={{ marginLeft: 8 }}>{item}</span></li>
                ))}
              </ul>
            )}
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-poc">
            <h4 className="bcw-preview-group-title">POC Path</h4>
            <p className="bc-section-body">{preview.draft.poc_hypothesis ?? '—'}</p>
          </div>

          <div className="bcw-preview-group" data-testid="bc-preview-sources">
            <h4 className="bcw-preview-group-title">Sources（来源章节，{preview.draft.source_mapping.length}）</h4>
            {preview.draft.source_mapping.map(mapping => (
              <div key={mapping.section} className="bcw-item-meta" style={{ marginBottom: 4 }}>
                <span>{SECTION_LABELS[mapping.section] ?? mapping.section}：第 {mapping.start_line}–{mapping.end_line} 行 · {mapping.item_count} 项</span>
              </div>
            ))}
          </div>

          {preview.draft.parse_warnings.length > 0 ? (
            <div className="bcw-preview-group" data-testid="bc-preview-warnings">
              <h4 className="bcw-preview-group-title">解析警告（{preview.draft.parse_warnings.length}）</h4>
              <ul className="bc-list">{preview.draft.parse_warnings.map((warning, index) => <li key={index}><span className="bc-list-main">{warning}</span></li>)}</ul>
            </div>
          ) : null}

          {preview.duplicate_of ? (
            <div className="bc-banner warning" style={{ marginBottom: 12 }}>
              <span className="bc-banner-title">检测到相同材料已导入过（{preview.duplicate_of.slice(0, 12)}…）</span>
              <span className="bc-banner-note">Confirm 时按客户+来源+内容哈希幂等去重，不会重复写入。</span>
            </div>
          ) : null}

          <div className="bcw-wizard-footer">
            <button type="button" className="bc-btn" onClick={() => setStage('paste')}><ArrowLeft size={14} />返回粘贴</button>
            <button type="button" className="bc-btn bc-btn-primary" onClick={() => setStage('review')} data-testid="bc-to-review">
              进入人工审核<ArrowRight size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'review' && preview ? (
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>人工审核</h3>
          <p className="bc-banner-note" style={{ marginBottom: 12 }}>
            前端服从后端门禁：CONDITIONAL / 无 Scope / 无 Evidence 的内容不会被写入 VERIFIED；假设写入后保持 PENDING。
          </p>

          <div className="bcw-preview-group" data-testid="bc-review-facts">
            <h4 className="bcw-preview-group-title">Fact Candidates（{preview.draft.extracted_facts.length}）</h4>
            {[...groupedFacts.company, ...groupedFacts.facts].map((fact, index) => renderFactItem(fact, index, 'review-fact'))}
          </div>

          <div className="bcw-preview-group" data-testid="bc-review-hypotheses">
            <h4 className="bcw-preview-group-title">Hypotheses（{preview.draft.extracted_hypotheses.length}）</h4>
            {preview.draft.extracted_hypotheses.map((hypothesis, index) => renderHypothesisItem(hypothesis, index))}
          </div>

          {blockedConditionalVerifies.length > 0 ? (
            <div className="bc-banner warning" style={{ marginBottom: 12 }} data-testid="bc-conditional-gate">
              <span className="bc-banner-title">{blockedConditionalVerifies.length} 条条件适用事实选择了「明确核实」但缺少适用边界/产品线</span>
              <span className="bc-banner-note">后端将拒绝无 Scope 的条件核实。请补全后再确认导入。</span>
            </div>
          ) : null}

          <div className="bcw-wizard-footer">
            <button type="button" className="bc-btn" onClick={() => setStage('preview')}><ArrowLeft size={14} />返回 Preview</button>
            <button type="button" className="bc-btn bc-btn-primary" onClick={() => void propose()} data-testid="bc-propose-import">
              生成导入 Proposal<ArrowRight size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'proposal' && proposal && preview ? (
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>确认导入 Proposal</h3>
          <div className="bcw-proposal-summary" data-testid="bc-proposal-summary">
            <strong>将写入：</strong>
            <ul>
              <li>客户：{effectiveCustomer?.name}</li>
              <li>事实 {Object.values(factReviews).filter(review => review.keep).length} 条（默认 PENDING；明确核实的按后端门禁写入 VERIFIED）</li>
              <li>假设 {Object.values(keptHypotheses).filter(Boolean).length} 条（全部 PENDING 待验证）</li>
              <li>原始材料 1 份（intelligence_imports，永久保留，含内容哈希）</li>
            </ul>
            <strong>不会写入：</strong>
            <ul>
              <li>Solution Scenarios / Peer References / 话术（{preview.draft.solution_scenarios.length} 场景 · {preview.draft.peer_references.length} 同行）——仅在生成作战卡时从材料解析引用</li>
              <li>不生成 Stage Card（本次仅导入，不产生作战卡）</li>
              <li>不修改客户阶段（保持 {stageLabel(stageCode)}）</li>
              <li>不修改客户等级（保持 {effectiveCustomer?.customer_grade} 类）</li>
            </ul>
            <p style={{ marginTop: 8 }}>Confirm 必须走正式 Proposal/Confirm 链路（Canonical Proposal + SHA-256 + 单次消费防重放）。取消为零写入。</p>
          </div>
          {proposalError ? <p role="alert" style={{ color: 'var(--bc-danger-text)', marginBottom: 10 }}>{proposalError}</p> : null}
          <div className="bcw-wizard-footer">
            <button type="button" className="bc-btn" onClick={onClose}>取消</button>
            <button type="button" className="bc-btn" onClick={cancelProposal} data-testid="bc-proposal-back">返回修改</button>
            <button
              type="button"
              className="bc-btn bc-btn-primary"
              onClick={() => void confirmProposal()}
              disabled={confirming}
              data-testid="bc-confirm-import"
            >
              {confirming ? '确认中…' : '确认导入'}
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'done' && effectiveCustomer ? (
        <div data-testid="bc-import-done">
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>✓ 导入已完成</h3>
          <p className="bc-section-body">{confirmResult}</p>
          <p className="bc-section-body" style={{ marginTop: 6 }}>
            已写入客户：{effectiveCustomer.name}。下一步可以基于已确认事实与假设生成当前阶段作战卡草稿（DRAFT，不改变阶段与等级）。
          </p>
          <div className="bcw-wizard-footer">
            <button type="button" className="bc-btn" onClick={onClose}>关闭</button>
            <button
              type="button"
              className="bc-btn bc-btn-primary"
              onClick={() => void onGenerateDraft(effectiveCustomer.id)}
              data-testid="bc-generate-draft-after-import"
            >
              生成当前阶段作战卡（{stageLabel(stageCode)}）
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
