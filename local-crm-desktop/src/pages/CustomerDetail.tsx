import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Brain, CalendarClock, CircleDollarSign, Edit3, Layers, MessageSquare, MapPin, Trash2, UserRound } from 'lucide-react';
import { getCustomer, deleteCustomer, createFollowUp, createVisit, updateCustomer } from '../lib/db';
import { applyWechatPassed, applyVisitOutcome, applyPaymentRule, applyFollowUpUpdate } from '../lib/rules';
import { parseRoughTime } from '../lib/timeParser';
import { GRADE_LABELS, STAGE_LABELS, WECHAT_ADD_LABELS, WECHAT_SEARCH_LABELS, INTENT_LABELS, PHONE_FEEDBACK_LABELS, NEXT_ACTION_LABELS, VISIT_OUTCOME_LABELS, CHANNEL_LABELS, CONTACT_RESULT_LABELS } from '../lib/types';
import type { Customer, FollowUpRecord, VisitRecord } from '../lib/types';
import { getDb } from '../lib/db';
import CustomerForm from '../components/CustomerForm';
import FollowUpForm from '../components/FollowUpForm';
import VisitForm from '../components/VisitForm';
import { v4 as uuidv4 } from 'uuid';
import { listFollowUps, listVisits } from '../lib/db';
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository } from '../lib/customerMemory';
import type { CustomerMemoryEntry } from '../lib/customerMemory';
import { CustomerIntelligencePanel } from '../components/salesWorkspace/CustomerIntelligencePanel';
import { buildCustomerScopedSalesAgentEntry, buildCustomerTimeline } from '../lib/salesWorkspace/customerIntelligence';
import { CustomerCaptureContract } from '../components/salesWorkspace/CustomerCaptureContract';
import { createEvidenceRepository } from '../lib/evidence/repository';
import type { EvidenceRow } from '../lib/evidence/types';
import { updateCustomerOpportunityAmount } from '../lib/customerOpportunityAmountUpdate';
import { formatOpportunityAmount } from '../lib/opportunityBoard/boardPresentation';
import { formatUserFacingScheduleDate } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { t, tEnum, tField, tFormat, tGrade, tStage } from '../lib/i18n/appLocale';
import { useAppLocale } from '../lib/i18n/LocaleProvider';
import { EvidenceQuietPanel } from '../components/controlSurface/EvidenceQuietPanel';
import { evidenceEntryLabel } from '../lib/evidence/evidenceEntryLabel';
import {
  projectCustomerDetailFirstLayer,
  projectCustomerProfileFields,
  type CustomerProfileFieldKey,
} from '../lib/customerDetailUi/customerDetailProjection';

interface Props {
  onRefresh: () => void;
}
type CustomerActionAnalysis = {
  leadJudgement: string;
  facts: string[];
  gaps: string[];
  nextActions: string[];
  risks: string[];
};

export function buildCustomerActionAnalysis(
  customer: Customer,
  followUps: FollowUpRecord[],
): CustomerActionAnalysis {
  const hasContact = Boolean(customer.phone_number || customer.wechat_id || customer.contact_person);
  const hasContactMethod = Boolean(customer.phone_number || customer.wechat_id);
  const hasWebsite = Boolean(customer.website);
  const hasIndustry = Boolean(customer.industry);
  const hasSourceEvidence = Boolean(customer.source);
  const isWeakInfo = !hasContactMethod && !customer.contact_person && !hasWebsite && !hasIndustry;
  const isLowPriority = customer.customer_grade === 'C' || customer.customer_grade === 'D';
  const isHighPriority = customer.customer_grade === 'A' || customer.customer_grade === 'B';
  const latestFollowUp = followUps[0] ?? null;
  const inferredIndustry = inferIndustryFromCustomerName(customer.name);

  const facts = [
    `客户等级：${GRADE_LABELS[customer.customer_grade]}`,
    `当前阶段：${STAGE_LABELS[customer.stage]}`,
  ];
  if (customer.region) facts.push(`城市/区域：${customer.region}`);
  facts.push(`联系方式：${formatContactFact(customer)}`);
  if (latestFollowUp) {
    facts.push(`最近跟进：${formatFollowUpFact(latestFollowUp)}`);
  }
  if (customer.notes) {
    facts.push(`备注：${summarizeText(customer.notes, 80)}`);
  }
  if (customer.industry) {
    facts.push(`行业/主营产品：${customer.industry}`);
  } else if (inferredIndustry) {
    facts.push(`行业推测：${inferredIndustry}`);
  }
  if (customer.website) facts.push(`官网：${customer.website}`);
  if (customer.source) facts.push(`来源：${customer.source}`);

  const gaps = [
    !customer.contact_person ? '缺联系人' : null,
    !hasContactMethod ? '缺手机号/微信' : null,
    !customer.website ? '缺官网' : null,
    !customer.industry ? '缺行业/主营产品' : null,
    !hasSourceEvidence ? '缺有效来源证据' : null,
  ].filter(Boolean) as string[];

  const leadJudgement = buildLeadJudgement(customer, { hasContact, hasWebsite, hasIndustry, isWeakInfo });
  const nextActions = buildNextActions({ hasContactMethod, hasWebsite, hasIndustry, isWeakInfo, isLowPriority, isHighPriority });
  const risks = buildRisks(customer, { isWeakInfo, isLowPriority, inferredIndustry });

  return {
    leadJudgement,
    facts,
    gaps: gaps.length > 0 ? gaps : ['关键字段基本完整'],
    nextActions,
    risks,
  };
}

export function formatCustomerAnalysisTextForDraft(analysis: CustomerActionAnalysis): string {
  return [
    '线索判断',
    analysis.leadJudgement,
    '',
    '已知事实',
    ...analysis.facts.map(item => `- ${item}`),
    '',
    '信息缺口',
    ...analysis.gaps.map(item => `- ${item}`),
    '',
    '下一步动作',
    ...analysis.nextActions.map((item, index) => `${index + 1}. ${item}`),
    '',
    '风险提醒',
    ...analysis.risks.map(item => `- ${item}`),
  ].join('\n');
}

function buildLeadJudgement(
  customer: Customer,
  flags: { hasContact: boolean; hasWebsite: boolean; hasIndustry: boolean; isWeakInfo: boolean },
): string {
  if (flags.isWeakInfo || customer.customer_grade === 'C' || customer.customer_grade === 'D') {
    return `${GRADE_LABELS[customer.customer_grade]}冷线索，当前联系人、电话、微信、官网和行业信息不足，不建议直接销售推进。当前首要任务是验证企业真实性并补全联系方式。`;
  }
  if (flags.hasContact && (customer.customer_grade === 'A' || customer.customer_grade === 'B')) {
    return `${GRADE_LABELS[customer.customer_grade]}信息相对完整，可短触达并确认需求，但仍要保持保守，不承诺结果。`;
  }
  return '当前线索可继续跟进，但仍需要补齐关键信息后再决定投入强度。';
}

function buildNextActions(flags: {
    hasContactMethod: boolean;
    hasWebsite: boolean;
    hasIndustry: boolean;
    isWeakInfo: boolean;
    isLowPriority: boolean;
    isHighPriority: boolean;
}): string[] {
  if (flags.isWeakInfo || flags.isLowPriority) {
    return [
      '先做低投入验证：用公司名反查官网、工商信息和公开联系方式。',
      '补充主营产品、官网、联系人和电话后，再判断是否值得继续跟进。',
      '如果 5 分钟内找不到电话或联系人，先标记为“无电话/待二次查询”。',
      '暂不做复杂销售推进，避免在 C 类弱信息线索上投入过多时间。',
    ];
  }

  const actions: string[] = [];
  if (flags.hasContactMethod) {
    actions.push('围绕已有联系方式做一次轻量触达，确认联系人角色、主营产品和当前需求。');
  }
  if (flags.hasWebsite) {
    actions.push('可检查官网的英文站、产品页、询盘入口和内容薄弱点，形成 1 条具体切入点。');
  }
  if (flags.isHighPriority) {
    actions.push('优先跟进，确认需求、预算、时间和决策流程。');
  }
  if (!flags.hasIndustry) {
    actions.push('补充行业/主营产品，避免话术过宽。');
  }
  return actions.slice(0, 4);
}

function buildRisks(
  customer: Customer,
  flags: { isWeakInfo: boolean; isLowPriority: boolean; inferredIndustry: string | null },
): string[] {
  const risks = [
    'CRM 字段不足时，不能确认真实决策人。',
    '不要把行业、采购角色或官网问题推测当成事实。',
  ];
  if (flags.inferredIndustry) {
    risks.push('公司名里的行业词只能作为检索方向，不能直接当成客户主营业务。');
  }
  if (flags.isWeakInfo || flags.isLowPriority) {
    risks.push('不建议直接强销售；如果补不到联系方式，应降低优先级。');
  }
  if (customer.website) {
    risks.push('官网问题需要实际查看后再判断，只能写“可检查”。');
  }
  return risks;
}

function inferIndustryFromCustomerName(name: string): string | null {
  const normalized = name.toLowerCase();
  if (normalized.includes('hydraulic')) return '基于公司名推测：可能与液压相关';
  if (normalized.includes('packing') || normalized.includes('packaging')) return '基于公司名推测：可能与包装相关';
  if (normalized.includes('lighting')) return '基于公司名推测：可能与照明相关';
  return null;
}

function formatContactFact(customer: Customer): string {
  const values = [
    customer.phone_number ? `手机号 ${customer.phone_number}` : null,
    customer.wechat_id ? `微信 ${customer.wechat_id}` : null,
    customer.contact_person ? `联系人 ${customer.contact_person}` : null,
  ].filter(Boolean);
  return values.length > 0 ? values.join('；') : '暂无手机号/微信';
}

function formatFollowUpFact(followUp: FollowUpRecord): string {
  const values = [
    followUp.contact_channel ? CHANNEL_LABELS[followUp.contact_channel] || followUp.contact_channel : null,
    followUp.contact_result ? CONTACT_RESULT_LABELS[followUp.contact_result] || followUp.contact_result : null,
    followUp.intent_assessment ? INTENT_LABELS[followUp.intent_assessment] : null,
  ].filter(Boolean);
  return values.length > 0 ? values.join('，') : followUp.feedback_notes || '已有跟进记录';
}

function summarizeText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function formatTimelineKind(kind: string): string {
  switch (kind) {
    case 'call': return t('customer.detail.timeline.call');
    case 'meeting': return t('customer.detail.timeline.meeting');
    case 'email': return t('customer.detail.timeline.email');
    case 'interaction': return t('customer.detail.timeline.interaction');
    default: return t('customer.detail.timeline.followUp');
  }
}

function battleCardStatusShort(status: string | null | undefined): string {
  if (status === 'DRAFT') return t('battle.statusShort.draft');
  if (status === 'CONFIRMED') return t('battle.statusShort.confirmed');
  if (status === 'REVIEW_DUE') return t('battle.statusShort.reviewDue');
  return t('battle.statusShort.none');
}

function paymentStatusLabel(status: Customer['payment_status']): string {
  if (status === 'PENDING') return t('customer.detail.payment.pending');
  if (status === 'PAID') return t('customer.detail.payment.paid');
  return t('customer.detail.payment.notStarted');
}

function timeParseStatusLabel(status: Customer['time_parse_status']): string {
  if (status === 'PARSED') return t('customer.detail.time.parsed');
  if (status === 'NEEDS_CONFIRMATION') return t('customer.detail.time.needsConfirmation');
  return t('customer.detail.time.notParsed');
}

function profileFieldValue(customer: Customer, key: CustomerProfileFieldKey): string | ReturnType<typeof formatUserFacingScheduleDate> {
  switch (key) {
    case 'name': return customer.name;
    case 'customer_grade': return tGrade(customer.customer_grade);
    case 'stage': return tStage(customer.stage);
    case 'is_key_decision_maker': return customer.is_key_decision_maker ? t('common.yes') : t('common.no');
    case 'wechat_id': return customer.wechat_id ?? '';
    case 'phone_number': return customer.phone_number ?? '';
    case 'contact_person': return customer.contact_person ?? '';
    case 'industry': return customer.industry ?? '';
    case 'region': return customer.region ?? '';
    case 'website': return customer.website ?? '';
    case 'email': return customer.email ?? '';
    case 'address': return customer.address ?? '';
    case 'pitch_angle': return customer.pitch_angle ?? '';
    case 'qualification_reason': return customer.qualification_reason ?? '';
    case 'source': return customer.source ?? '';
    case 'wechat_search_status': return customer.wechat_search_status ? (tEnum(customer.wechat_search_status) ?? WECHAT_SEARCH_LABELS[customer.wechat_search_status]) : '';
    case 'wechat_add_status': return tEnum(customer.wechat_add_status) ?? WECHAT_ADD_LABELS[customer.wechat_add_status];
    case 'intent_level': return tEnum(customer.intent_level) ?? INTENT_LABELS[customer.intent_level];
    case 'phone_feedback': return customer.phone_feedback ? (tEnum(customer.phone_feedback) ?? PHONE_FEEDBACK_LABELS[customer.phone_feedback]) : '';
    case 'next_action': return customer.next_action ? (tEnum(customer.next_action) ?? NEXT_ACTION_LABELS[customer.next_action]) : '';
    case 'next_follow_up_at': return formatUserFacingScheduleDate(customer.next_follow_up_at, { withTime: true });
    case 'rough_visit_time_text': return customer.rough_visit_time_text ?? '';
    case 'parsed_visit_reminder_at': return formatUserFacingScheduleDate(customer.parsed_visit_reminder_at, { withTime: true });
    case 'time_parse_status': return timeParseStatusLabel(customer.time_parse_status);
    case 'time_parse_note': return customer.time_parse_note ?? '';
    case 'no_show_count': return String(customer.no_show_count);
    case 'payment_status': return paymentStatusLabel(customer.payment_status);
    case 'deal_amount': return customer.deal_amount ? `¥${customer.deal_amount.toLocaleString()}` : '';
    case 'notes': return customer.notes ?? '';
    default: return '';
  }
}

function profileFieldLabel(key: CustomerProfileFieldKey): string {
  if (key === 'is_key_decision_maker') return t('customer.detail.keyDecisionMaker');
  if (key === 'payment_status') return t('customer.detail.paymentStatus');
  if (key === 'deal_amount') return t('customer.detail.dealAmount');
  if (key === 'no_show_count') return t('customer.detail.noShowCount');
  if (key === 'time_parse_status') return t('customer.detail.timeParseStatus');
  if (key === 'time_parse_note') return t('customer.detail.timeParseNote');
  if (key === 'parsed_visit_reminder_at') return t('customer.detail.parsedReminder');
  if (key === 'customer_grade') return t('customer.detail.grade');
  if (key === 'stage') return t('customer.detail.stage');
  const field = tField(key);
  if (field !== t('common.otherField')) return field;
  return t('customer.detail.overview');
}

export default function CustomerDetail({ onRefresh }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useAppLocale();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showVisit, setShowVisit] = useState(false);
  const [activeMemory, setActiveMemory] = useState<CustomerMemoryEntry[]>([]);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceRows, setEvidenceRows] = useState<readonly EvidenceRow[]>([]);
  const [amountDraft, setAmountDraft] = useState('');
  const [amountEditing, setAmountEditing] = useState(false);
  const [amountError, setAmountError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const c = await getCustomer(id);
    setCustomer(c);
    if (c) {
      setFollowUps(await listFollowUps(id));
      setVisits(await listVisits(id));
      const memoryDb = await getDb();
      const memory = await new SqliteMemoryRepository(memoryDb, new SqliteCrmEvidenceResolver(memoryDb)).listCustomerMemory(id);
      setActiveMemory(memory.filter(item => item.validation_status === 'ACTIVE'));
      setEvidenceRows(await createEvidenceRepository(memoryDb).listByCustomer(id, { status: 'ACTIVE' }));
    } else {
      setActiveMemory([]);
    }
  }, [id]);

  const loadedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (loadedFor.current !== id) {
      loadedFor.current = id;
      load();
    }
  }, [id, load]);

  const handleDelete = async () => {
    if (!id || !confirm(t('customer.detail.deleteConfirm'))) return;
    await deleteCustomer(id);
    onRefresh();
    navigate('/customers');
  };

  const saveOpportunityAmount = async () => {
    if (!customer) return;
    const trimmed = amountDraft.trim();
    if (!trimmed) {
      setAmountError(t('customer.detail.amountBlankError'));
      return;
    }
    const value = Number(trimmed.replace(/[,¥]/g, ''));
    try {
      await updateCustomerOpportunityAmount(customer.id, value);
      setAmountEditing(false);
      setAmountError('');
      await load();
      onRefresh();
    } catch (cause) {
      setAmountError(cause instanceof Error ? cause.message : t('customer.detail.amountFailed'));
    }
  };

  const handleWechatPassed = async () => {
    if (!customer) return;
    const { customer: updated, tasks } = applyWechatPassed(customer);
    await updateCustomer(customer.id, updated);
    for (const t of tasks) {
      const { createTask } = await import('../lib/db');
      await createTask(t);
    }
    await load();
    onRefresh();
  };

  const handleFollowUpSaved = async (record: Omit<FollowUpRecord, 'id' | 'created_at' | 'updated_at'>) => {
    if (!customer) return;
    const now = new Date().toISOString();
    const rec: FollowUpRecord = { ...record, id: uuidv4(), created_at: now, updated_at: now };

    // 解析模糊时间
    if (customer.rough_visit_time_text) {
      const parsed = parseRoughTime(customer.rough_visit_time_text);
      if (parsed.status === 'PARSED' && parsed.parsed_at) {
        await updateCustomer(customer.id, {
          parsed_visit_reminder_at: parsed.parsed_at,
          time_parse_status: 'PARSED',
          time_parse_note: null,
        });
      }
    }

    // v0.3.1: 应用跟进自动更新规则 (等级/阶段/下次跟进)
    const { customer: updated } = applyFollowUpUpdate(customer, {
      contact_result: record.contact_result,
      intent_assessment: record.intent_assessment,
      suggested_grade: record.suggested_grade,
    });
    await updateCustomer(customer.id, updated);

    await createFollowUp(rec);
    setShowFollowUp(false);
    await load();
    onRefresh();
  };

  const handleVisitSaved = async (record: Omit<VisitRecord, 'id' | 'created_at' | 'updated_at'>) => {
    if (!customer) return;
    const now = new Date().toISOString();
    const rec: VisitRecord = { ...record, id: uuidv4(), created_at: now, updated_at: now };

    // 应用面访规则
    if (record.visit_outcome) {
      const { customer: updated } = applyVisitOutcome(customer, record.visit_outcome);
      await updateCustomer(customer.id, updated);
    }

    await createVisit(rec);
    setShowVisit(false);
    await load();
    onRefresh();
  };

  const handlePaymentAction = async (action: 'SEND_CONTRACT' | 'MARK_PAID' | 'MARK_WON') => {
    if (!customer) return;
    const { customer: updated } = applyPaymentRule(customer, action);
    await updateCustomer(customer.id, updated);
    await load();
    onRefresh();
  };

  if (!customer) {
    return (
      <div className="product-page">
        <div className="page-header">
          <button className="btn" onClick={() => navigate('/customers')} aria-label={t('customer.detail.back')}>
            <ArrowLeft size={16} />
          </button>
        </div>
        <div className="page-body">
          <div className="empty-state">{t('customer.detail.notFound')}</div>
        </div>
      </div>
    );
  }

  const showContractActions = customer.stage === 'VISITED' || customer.stage === 'CONTRACTING' || customer.stage === 'PAYMENT_PENDING';
  const showPaymentActions = customer.stage === 'PAYMENT_PENDING' || customer.stage === 'PAID';
  const unifiedTimeline = buildCustomerTimeline(followUps, visits);
  const customerScopedEntry = buildCustomerScopedSalesAgentEntry(customer, activeMemory, unifiedTimeline);
  const firstLayer = projectCustomerDetailFirstLayer(customer, followUps, visits, unifiedTimeline);
  const profile = projectCustomerProfileFields(customer);
  const nextActionLabel = firstLayer.nextAction
    ? (tEnum(firstLayer.nextAction) ?? NEXT_ACTION_LABELS[firstLayer.nextAction])
    : t('customer.detail.nextActionEmpty');

  return (
    <div className="product-page">
      <div className="page-header customer-detail-header">
        <div className="customer-detail-identity">
          <button className="btn" onClick={() => navigate('/customers')} aria-label={t('customer.detail.back')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2>{firstLayer.name}</h2>
            <div className="customer-detail-tags">
              <span className={`status-pill grade-${firstLayer.grade.toLowerCase()}`}>{tGrade(firstLayer.grade)}</span>
              <span className="status-pill info">{tStage(firstLayer.stage)}</span>
            </div>
          </div>
        </div>
        <div className="customer-detail-header-actions">
          <button
            className="btn btn-primary"
            onClick={() => navigate('/ai-workspace', { state: { customerScopedEntry } })}
          >
            <Brain size={16} /> {t('customer.detail.askAgent')}
          </button>
          <button type="button" className="btn" onClick={() => setShowEdit(true)}>
            <Edit3 size={16} /> {t('customer.detail.edit')}
          </button>
        </div>
      </div>

      <div className="page-body">
        <section className="customer-detail-hero" data-testid="customer-detail-first-layer" aria-label={t('customer.detail.overview')}>
          <div className="customer-detail-metrics">
            <div className="customer-detail-metric">
              <CircleDollarSign size={18} className="customer-detail-metric-icon" aria-hidden="true" />
              <div>
                <small>{t('customer.detail.amount')}</small>
                {amountEditing ? (
                  <div className="amount-edit-row">
                    <input
                      aria-label={t('customer.detail.amount')}
                      value={amountDraft}
                      onChange={event => setAmountDraft(event.target.value)}
                      placeholder={t('customer.detail.amountPlaceholder')}
                    />
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveOpportunityAmount()}>{t('customer.detail.save')}</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setAmountEditing(false); setAmountError(''); }}>{t('customer.detail.cancel')}</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="amount-quiet-btn"
                    data-testid="opportunity-amount"
                    onClick={() => {
                      setAmountDraft(customer.opportunity_amount != null ? String(customer.opportunity_amount) : '');
                      setAmountEditing(true);
                    }}
                  >
                    {formatOpportunityAmount(firstLayer.opportunityAmount)}
                  </button>
                )}
                {amountError ? <p role="alert">{amountError}</p> : null}
              </div>
            </div>
            <div className="customer-detail-metric">
              <UserRound size={18} className="customer-detail-metric-icon" aria-hidden="true" />
              <div>
                <small>{t('customer.detail.grade')}</small>
                <strong>{tGrade(firstLayer.grade)}</strong>
              </div>
            </div>
            <div className="customer-detail-metric">
              <Layers size={18} className="customer-detail-metric-icon" aria-hidden="true" />
              <div>
                <small>{t('customer.detail.stage')}</small>
                <strong>{tStage(firstLayer.stage)}</strong>
              </div>
            </div>
            <div className="customer-detail-metric">
              <CalendarClock size={18} className="customer-detail-metric-icon" aria-hidden="true" />
              <div>
                <small>{t('customer.detail.nextFollowUp')}</small>
                <strong>{formatUserFacingScheduleDate(firstLayer.nextFollowUpAt, { withTime: true })}</strong>
              </div>
            </div>
            <div className="customer-detail-metric">
              <UserRound size={18} className="customer-detail-metric-icon" aria-hidden="true" />
              <div>
                <small>{t('customer.detail.contact')}</small>
                <strong>{firstLayer.contactPerson ?? t('customer.detail.noContact')}</strong>
              </div>
            </div>
          </div>

          <div className="customer-detail-snapshot">
            <section className="customer-detail-snapshot-card" data-testid="customer-detail-recent-activity" aria-label={t('customer.detail.recentActivity')}>
              <h3 className="customer-detail-layer-title">{t('customer.detail.recentActivity')}</h3>
              {firstLayer.recent.lastFollowUp || firstLayer.recent.lastVisit ? (
                <ul className="customer-detail-recent-list">
                  {firstLayer.recent.lastFollowUp ? (
                    <li>
                      <small>{t('customer.detail.lastFollowUp')} · {formatUserFacingScheduleDate(firstLayer.recent.lastFollowUp.occurredAt, { withTime: true })}</small>
                      <strong>{firstLayer.recent.lastFollowUp.title}</strong>
                    </li>
                  ) : null}
                  {firstLayer.recent.lastVisit ? (
                    <li>
                      <small>{t('customer.detail.lastVisit')} · {formatUserFacingScheduleDate(firstLayer.recent.lastVisit.occurredAt, { withTime: true })}</small>
                      <strong>{firstLayer.recent.lastVisit.title}</strong>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="customer-detail-empty-note">{t('customer.detail.recentEmpty')}</p>
              )}
            </section>

            <section className="customer-detail-snapshot-card customer-detail-next" data-testid="customer-detail-next-step" aria-label={t('customer.detail.nextStep')}>
              <h3 className="customer-detail-layer-title">{t('customer.detail.nextStep')}</h3>
              <p className="customer-detail-next-action">{nextActionLabel}</p>
              <div className="customer-detail-next-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowFollowUp(true)}>
                  <MessageSquare size={14} /> {t('customer.detail.recordFollowUp')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setShowVisit(true)}>
                  <MapPin size={14} /> {t('customer.detail.recordVisit')}
                </button>
              </div>
            </section>
          </div>

          <div className="customer-quiet-actions">
            <button type="button" className="agent-link-btn" data-testid="evidence-entry" onClick={() => setEvidenceOpen(true)}>
              {evidenceEntryLabel(evidenceRows.length)}
            </button>
            <button type="button" className="agent-link-btn" onClick={() => navigate(`/customers/${customer.id}/battle-card`)}>
              {t('customer.detail.battleCard')}{customer.battle_card_status && customer.battle_card_status !== 'NONE' ? ` · ${battleCardStatusShort(customer.battle_card_status)}` : ''}
            </button>
          </div>
        </section>

        <details className="customer-detail-fold" data-testid="customer-detail-layer-profile">
          <summary>{t('customer.detail.accordion.profile')}</summary>
          <div className="detail-grid">
            {profile.presentKeys.map(key => (
              <div className="detail-item" key={key}>
                <div className="label">{profileFieldLabel(key)}</div>
                <div className="value">
                  {key === 'website' && customer.website ? (
                    <a href={customer.website} target="_blank" rel="noopener noreferrer">{customer.website}</a>
                  ) : profileFieldValue(customer, key)}
                </div>
              </div>
            ))}
          </div>
          {profile.emptyCount > 0 ? (
            <p className="customer-detail-empty-note" data-testid="customer-detail-empty-count">{tFormat('customer.detail.missingCount', { n: profile.emptyCount })}</p>
          ) : null}
        </details>

        <details className="customer-detail-fold" data-testid="customer-detail-layer-timeline">
          <summary>{t('customer.detail.accordion.timeline')}</summary>
          <p className="customer-timeline-note">{t('customer.detail.timelineNote')}</p>
          {unifiedTimeline.length === 0 ? (
            <div className="empty-state">{t('customer.detail.timelineEmpty')}</div>
          ) : (
            <ul className="timeline">
              {unifiedTimeline.map(item => {
                const isVisit = item.id.startsWith('visit:');
                const sourceFollowUp = !isVisit ? followUps.find(f => f.id === item.evidenceId) : null;
                const sourceVisit = isVisit ? visits.find(v => v.id === item.evidenceId) : null;
                return (
                  <li key={item.id} className="timeline-item">
                    <div className="time">{formatUserFacingScheduleDate(item.occurredAt, { withTime: true })}</div>
                    <div className="customer-timeline-head">
                      <span className="status-pill info">{formatTimelineKind(item.kind)}</span>
                      <div className="title">{item.title}</div>
                    </div>
                    <div className="notes">{item.detail}</div>
                    <div className="customer-timeline-tags">
                      {sourceFollowUp?.contact_channel && (
                        <span className="badge badge-info">{CHANNEL_LABELS[sourceFollowUp.contact_channel] || sourceFollowUp.contact_channel}</span>
                      )}
                      {sourceFollowUp?.contact_result && (
                        <span className="badge badge-warning">{CONTACT_RESULT_LABELS[sourceFollowUp.contact_result] || sourceFollowUp.contact_result}</span>
                      )}
                      {sourceFollowUp?.intent_assessment && (
                        <span className="badge badge-high">{INTENT_LABELS[sourceFollowUp.intent_assessment]}</span>
                      )}
                      {sourceVisit?.visit_outcome && (
                        <span className="badge badge-warning">{VISIT_OUTCOME_LABELS[sourceVisit.visit_outcome]}</span>
                      )}
                      {sourceVisit?.intent_after_visit && (
                        <span className="badge badge-info">{INTENT_LABELS[sourceVisit.intent_after_visit]}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </details>

        <details className="customer-detail-fold" data-testid="customer-detail-layer-intelligence">
          <summary>{t('customer.detail.accordion.intelligence')}</summary>
          <CustomerIntelligencePanel
            customer={customer}
            followUps={followUps}
            visits={visits}
            activeMemory={activeMemory}
            drafts={[]}
          />
        </details>

        <details className="customer-detail-fold" data-testid="customer-detail-layer-management">
          <summary>{t('customer.detail.accordion.management')}</summary>
          <div className="customer-detail-ops">
            {customer.wechat_add_status !== 'PASSED' && (
              <button className="btn btn-sm" onClick={handleWechatPassed}>{t('customer.detail.wechatPassed')}</button>
            )}
            {showContractActions && customer.stage !== 'PAYMENT_PENDING' && customer.stage !== 'PAID' && customer.stage !== 'WON' && (
              <button className="btn btn-sm" onClick={() => handlePaymentAction('SEND_CONTRACT')}>{t('customer.detail.sendContract')}</button>
            )}
            {showPaymentActions && customer.payment_status !== 'PAID' && (
              <button className="btn btn-sm" onClick={() => handlePaymentAction('MARK_PAID')}>{t('customer.detail.markPaid')}</button>
            )}
            {customer.stage === 'PAID' && (
              <button className="btn btn-sm" onClick={() => handlePaymentAction('MARK_WON')}>{t('customer.detail.markWon')}</button>
            )}
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>
              <Trash2 size={14} /> {t('customer.detail.delete')}
            </button>
          </div>
          <CustomerCaptureContract />
        </details>

        <EvidenceQuietPanel open={evidenceOpen} evidence={evidenceRows} onClose={() => setEvidenceOpen(false)} />

      </div>

      {showEdit && customer && (
        <CustomerForm
          customer={customer}
          onClose={() => setShowEdit(false)}
          onSaved={async () => { setShowEdit(false); await load(); onRefresh(); }}
        />
      )}
      {showFollowUp && (
        <FollowUpForm
          customerId={customer.id}
          onClose={() => setShowFollowUp(false)}
          onSaved={handleFollowUpSaved}
        />
      )}
      {showVisit && (
        <VisitForm
          customerId={customer.id}
          onClose={() => setShowVisit(false)}
          onSaved={handleVisitSaved}
        />
      )}
    </div>
  );
}
