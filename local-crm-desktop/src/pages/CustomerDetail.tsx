import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Brain, Edit3, MessageSquare, MapPin, Trash2 } from 'lucide-react';
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
import { buildCustomerScopedSalesAgentEntry, buildCustomerTimeline, CustomerIntelligencePanel } from '../components/salesWorkspace/CustomerIntelligencePanel';
import { CustomerCaptureContract } from '../components/salesWorkspace/CustomerCaptureContract';

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

function customerRiskLabel(customer: Customer): { text: string; tone: string } {
  if (customer.no_show_count >= 2) return { text: '高爽约风险', tone: 'warn' };
  if (customer.intent_level === 'LOW') return { text: '意向偏低', tone: 'warn' };
  if (customer.intent_level === 'HIGH') return { text: '机会较大', tone: 'ok' };
  return { text: '平稳', tone: 'info' };
}

function formatTimelineKind(kind: string): string {
  switch (kind) {
    case 'call': return '电话跟进';
    case 'meeting': return '面访';
    case 'email': return '邮件';
    case 'interaction': return '互动';
    default: return '跟进';
  }
}

function formatLastInteraction(customer: Customer, timeline: ReturnType<typeof buildCustomerTimeline>): string {
  if (customer.last_contacted_at) {
    return new Date(customer.last_contacted_at).toLocaleString('zh-CN');
  }
  if (timeline[0]) {
    return new Date(timeline[0].occurredAt).toLocaleString('zh-CN');
  }
  return '暂无互动';
}

export default function CustomerDetail({ onRefresh }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showVisit, setShowVisit] = useState(false);
  const [activeMemory, setActiveMemory] = useState<CustomerMemoryEntry[]>([]);

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
    if (!id || !confirm('确定删除该客户及其所有记录？')) return;
    await deleteCustomer(id);
    onRefresh();
    navigate('/customers');
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
          <button className="btn" onClick={() => navigate('/customers')}>
            <ArrowLeft size={16} /> 返回
          </button>
        </div>
        <div className="page-body">
          <div className="empty-state">客户不存在或已删除</div>
        </div>
      </div>
    );
  }

  const showContractActions = customer.stage === 'VISITED' || customer.stage === 'CONTRACTING' || customer.stage === 'PAYMENT_PENDING';
  const showPaymentActions = customer.stage === 'PAYMENT_PENDING' || customer.stage === 'PAID';
  const customerScopedEntry = buildCustomerScopedSalesAgentEntry(customer, activeMemory, buildCustomerTimeline(followUps, visits));
  const unifiedTimeline = buildCustomerTimeline(followUps, visits);
  const heroAnalysis = buildCustomerActionAnalysis(customer, followUps);
  const risk = customerRiskLabel(customer);
  const contactSummary = formatContactFact(customer);
  const opportunitySummary = customer.industry
    ? `行业/主营：${customer.industry}`
    : customer.intent_level === 'HIGH'
      ? '高意向线索，可优先推进'
      : '待补充行业与需求信息';
  const riskSummary = heroAnalysis.risks[0] ?? risk.text;

  return (
    <div className="product-page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button className="btn" onClick={() => navigate('/customers')} aria-label="返回客户列表">
            <ArrowLeft size={16} />
          </button>
          <div>
            <p className="page-kicker">CUSTOMER DETAIL</p>
            <h2>{customer.name}</h2>
            <p className="page-subtitle">查看客户上下文、统一时间线与下一步动作；主入口交给 Sales Agent 做客户范围推理。</p>
          </div>
        </div>
        <div className="btn-group">
          <button className="btn btn-sm" onClick={() => setShowFollowUp(true)}>
            <MessageSquare size={14} /> 记录跟进
          </button>
          <button className="btn btn-sm" onClick={() => setShowVisit(true)}>
            <MapPin size={14} /> 记录面访
          </button>
          <button className="btn btn-sm" onClick={() => setShowEdit(true)}>
            <Edit3 size={14} /> 编辑
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            <Trash2 size={14} /> 删除
          </button>
        </div>
      </div>

      <div className="page-body">
        <section className="glass-card customer-detail-hero" aria-label="客户概览">
          <div className="customer-detail-hero-top">
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span className={`badge badge-${customer.customer_grade.toLowerCase()}`}>{GRADE_LABELS[customer.customer_grade]}</span>
                <span className="status-pill info">{STAGE_LABELS[customer.stage]}</span>
                <span className={`status-pill ${risk.tone}`}>{risk.text}</span>
                <span className="status-pill">{WECHAT_ADD_LABELS[customer.wechat_add_status]}</span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                联系人 / 负责人：{customer.contact_person || '未填写'} · {contactSummary}
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/ai-workspace', { state: { customerScopedEntry } })}
            >
              <Brain size={16} /> Ask Sales Agent
            </button>
          </div>

          <p className="status-pill info" style={{ margin: 0, width: 'fit-content' }}>
            客户范围入口会保留当前客户上下文、ACTIVE memory 与时间线证据，进入 Sales Agent 后继续围绕 {customer.name} 工作。
          </p>

          <div className="customer-detail-metrics">
            <div className="glass-card" style={{ padding: 12 }}>
              <small style={{ color: 'var(--text-muted)' }}>机会摘要</small>
              <strong style={{ display: 'block', marginTop: 4 }}>{opportunitySummary}</strong>
            </div>
            <div className="glass-card" style={{ padding: 12 }}>
              <small style={{ color: 'var(--text-muted)' }}>风险提醒</small>
              <strong style={{ display: 'block', marginTop: 4 }}>{riskSummary}</strong>
            </div>
            <div className="glass-card" style={{ padding: 12 }}>
              <small style={{ color: 'var(--text-muted)' }}>最近互动</small>
              <strong style={{ display: 'block', marginTop: 4 }}>{formatLastInteraction(customer, unifiedTimeline)}</strong>
            </div>
            <div className="glass-card" style={{ padding: 12 }}>
              <small style={{ color: 'var(--text-muted)' }}>下次跟进</small>
              <strong style={{ display: 'block', marginTop: 4 }}>
                {customer.next_follow_up_at ? new Date(customer.next_follow_up_at).toLocaleString('zh-CN') : '未设置'}
              </strong>
            </div>
          </div>

          <div className="btn-group">
            {customer.wechat_add_status !== 'PASSED' && (
              <button className="btn btn-sm" onClick={handleWechatPassed}>标记微信已通过</button>
            )}
            {showContractActions && customer.stage !== 'PAYMENT_PENDING' && customer.stage !== 'PAID' && customer.stage !== 'WON' && (
              <button className="btn btn-sm" onClick={() => handlePaymentAction('SEND_CONTRACT')}>发合同</button>
            )}
            {showPaymentActions && customer.payment_status !== 'PAID' && (
              <button className="btn btn-sm" onClick={() => handlePaymentAction('MARK_PAID')}>标记已打款</button>
            )}
            {customer.stage === 'PAID' && (
              <button className="btn btn-sm" onClick={() => handlePaymentAction('MARK_WON')}>标记成交</button>
            )}
          </div>
        </section>

        <div className="customer-detail-layout">
          <div>
            <CustomerIntelligencePanel
              customer={customer}
              followUps={followUps}
              visits={visits}
              activeMemory={activeMemory}
              drafts={[]}
            />

            <section className="glass-card" style={{ marginTop: 16 }} aria-label="统一时间线">
              <h3 className="section-title">统一时间线</h3>
              <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 13 }}>
                合并跟进与面访记录，按时间倒序展示；数据来源仍为 followUps 与 visits。
              </p>
              {unifiedTimeline.length === 0 ? (
                <div className="empty-state">暂无跟进或面访记录</div>
              ) : (
                <ul className="timeline">
                  {unifiedTimeline.map(item => {
                    const isVisit = item.id.startsWith('visit:');
                    const sourceFollowUp = !isVisit ? followUps.find(f => f.id === item.evidenceId) : null;
                    const sourceVisit = isVisit ? visits.find(v => v.id === item.evidenceId) : null;
                    return (
                      <li key={item.id} className="timeline-item">
                        <div className="time">{new Date(item.occurredAt).toLocaleString('zh-CN')}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="status-pill info">{formatTimelineKind(item.kind)}</span>
                          <div className="title">{item.title}</div>
                        </div>
                        <div className="notes">{item.detail}</div>
                        <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            </section>
          </div>

          <div>
            <CustomerCaptureContract />

            <section className="glass-card" style={{ marginTop: 16 }} aria-label="基础信息">
              <h3 className="section-title">基础信息</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="label">客户名称</div>
                  <div className="value">{customer.name}</div>
                </div>
                <div className="detail-item">
                  <div className="label">客户等级</div>
                  <div className="value">{GRADE_LABELS[customer.customer_grade]}</div>
                </div>
                <div className="detail-item">
                  <div className="label">当前阶段</div>
                  <div className="value">{STAGE_LABELS[customer.stage]}</div>
                </div>
                <div className="detail-item">
                  <div className="label">是否关键KP</div>
                  <div className="value">{customer.is_key_decision_maker ? '是' : '否'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">微信号</div>
                  <div className="value">{customer.wechat_id || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">手机号</div>
                  <div className="value">{customer.phone_number || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">联系人</div>
                  <div className="value">{customer.contact_person || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">行业</div>
                  <div className="value">{customer.industry || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">城市/区域</div>
                  <div className="value">{customer.region || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">官网</div>
                  <div className="value">{customer.website ? <a href={customer.website} target="_blank" rel="noopener noreferrer">{customer.website}</a> : '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">邮箱</div>
                  <div className="value">{customer.email || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">地址</div>
                  <div className="value">{customer.address || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">推荐切入点</div>
                  <div className="value">{customer.pitch_angle || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">判断原因</div>
                  <div className="value">{customer.qualification_reason || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">来源</div>
                  <div className="value">{customer.source || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">微信搜索状态</div>
                  <div className="value">{customer.wechat_search_status ? WECHAT_SEARCH_LABELS[customer.wechat_search_status] : '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">微信添加状态</div>
                  <div className="value">{WECHAT_ADD_LABELS[customer.wechat_add_status]}</div>
                </div>
                <div className="detail-item">
                  <div className="label">意向度</div>
                  <div className="value">{INTENT_LABELS[customer.intent_level]}</div>
                </div>
                <div className="detail-item">
                  <div className="label">电话反馈</div>
                  <div className="value">{customer.phone_feedback ? PHONE_FEEDBACK_LABELS[customer.phone_feedback] : '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">下一步动作</div>
                  <div className="value">{customer.next_action ? NEXT_ACTION_LABELS[customer.next_action] : '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">下次跟进时间</div>
                  <div className="value">{customer.next_follow_up_at ? new Date(customer.next_follow_up_at).toLocaleString('zh-CN') : '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">模糊约访时间</div>
                  <div className="value">{customer.rough_visit_time_text || '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">解析后提醒时间</div>
                  <div className="value">{customer.parsed_visit_reminder_at ? new Date(customer.parsed_visit_reminder_at).toLocaleString('zh-CN') : '-'}</div>
                </div>
                <div className="detail-item">
                  <div className="label">时间解析状态</div>
                  <div className="value">{customer.time_parse_status === 'PARSED' ? '已解析' : customer.time_parse_status === 'NEEDS_CONFIRMATION' ? '需确认' : '未解析'}</div>
                </div>
                {customer.time_parse_note && (
                  <div className="detail-item">
                    <div className="label">时间解析备注</div>
                    <div className="value" style={{ color: '#f59e0b' }}>{customer.time_parse_note}</div>
                  </div>
                )}
                <div className="detail-item">
                  <div className="label">爽约次数</div>
                  <div className="value">{customer.no_show_count}</div>
                </div>
                <div className="detail-item">
                  <div className="label">打款状态</div>
                  <div className="value">
                    {customer.payment_status === 'NOT_STARTED' ? '未开始' :
                     customer.payment_status === 'PENDING' ? <span className="badge badge-warning">待打款</span> :
                     <span className="badge badge-success">已打款</span>}
                  </div>
                </div>
                <div className="detail-item">
                  <div className="label">成交金额</div>
                  <div className="value">{customer.deal_amount ? `¥${customer.deal_amount.toLocaleString()}` : '-'}</div>
                </div>
                {customer.notes && (
                  <div className="detail-item">
                    <div className="label">备注</div>
                    <div className="value">{customer.notes}</div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

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
