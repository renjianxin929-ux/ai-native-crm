import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit3, MessageSquare, MapPin, Trash2, Brain } from 'lucide-react';
import { getCustomer, deleteCustomer, createFollowUp, createVisit, updateCustomer, createAIDraft, listAIDrafts, applyAIDraftToCustomer, discardAIDraft } from '../lib/db';
import { applyWechatPassed, applyVisitOutcome, applyPaymentRule, applyFollowUpUpdate } from '../lib/rules';
import { parseRoughTime } from '../lib/timeParser';
import { GRADE_LABELS, STAGE_LABELS, WECHAT_ADD_LABELS, WECHAT_SEARCH_LABELS, INTENT_LABELS, PHONE_FEEDBACK_LABELS, NEXT_ACTION_LABELS, VISIT_OUTCOME_LABELS, CHANNEL_LABELS, CONTACT_RESULT_LABELS } from '../lib/types';
import type { Customer, FollowUpRecord, VisitRecord } from '../lib/types';
import { getDb } from '../lib/db';
import { getDefaultDeepSeekConfig } from '../lib/textAIProvider';
import { suggestNextActionWithDeepSeek } from '../lib/aiDraft';
import type { AIDraft } from '../lib/types';
import CustomerForm from '../components/CustomerForm';
import FollowUpForm from '../components/FollowUpForm';
import VisitForm from '../components/VisitForm';
import { v4 as uuidv4 } from 'uuid';
import { listFollowUps, listVisits } from '../lib/db';

interface Props {
  onRefresh: () => void;
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
  const [aiResult, setAiResult] = useState<{ suggestion: string | null; rawResponse: string; error?: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<AIDraft[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const c = await getCustomer(id);
    setCustomer(c);
    if (c) {
      setFollowUps(await listFollowUps(id));
      setVisits(await listVisits(id));
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

  const handleAIAnalyze = async () => {
    if (!customer) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      const db = await getDb();
      const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['text_ai_config']);
      let config = getDefaultDeepSeekConfig();
      if (rows.length > 0) {
        config = { ...config, ...JSON.parse(rows[0].value) };
      }
      if (!config.apiKey) {
        setAiError('请先在 AI 设置中配置 DeepSeek API Key');
        setAiLoading(false);
        return;
      }

      const recentNotes = followUps.map(f => f.feedback_notes).filter(Boolean) as string[];
      const result = await suggestNextActionWithDeepSeek(config, customer, recentNotes);
      if (result.error) {
        setAiError(result.error);
      } else {
        setAiResult(result);
        // Bug 3: 同时创建 ai_drafts 草稿，不直接改客户字段
        await createAIDraft({
          source_type: 'MANUAL',
          customer_id: customer.id,
          raw_input_summary: `跟进建议: ${customer.name}`,
          ai_result_json: JSON.stringify({
            suggestion: result.suggestion,
            rawResponse: result.rawResponse,
            source: 'deepseek_next_action',
            created_from: 'customer_detail',
          }),
          confidence: 0.7,
        });
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    }
    setAiLoading(false);
  };

  const handleLoadDrafts = async () => {
    if (!id) return;
    const list = await listAIDrafts(id);
    setDrafts(list);
    setShowDrafts(true);
  };

  const handleApplyDraft = async (draftId: string) => {
    try {
      await applyAIDraftToCustomer(draftId);
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'APPLIED' as const } : d));
      await load();
      onRefresh();
    } catch (e) {
      alert(`应用草稿失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDiscardDraft = async (draftId: string) => {
    try {
      await discardAIDraft(draftId);
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'DISCARDED' as const } : d));
    } catch (e) {
      alert(`丢弃草稿失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!customer) {
    return (
      <div>
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

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn" onClick={() => navigate('/customers')}>
            <ArrowLeft size={16} />
          </button>
          <h2>{customer.name}</h2>
          <span className={`badge badge-${customer.customer_grade.toLowerCase()}`}>{GRADE_LABELS[customer.customer_grade]}</span>
          <span className="badge badge-info">{STAGE_LABELS[customer.stage]}</span>
        </div>
        <div className="btn-group">
          {customer.wechat_add_status !== 'PASSED' && (
            <button className="btn btn-primary btn-sm" onClick={handleWechatPassed}>标记微信已通过</button>
          )}
          {showContractActions && customer.stage !== 'PAYMENT_PENDING' && customer.stage !== 'PAID' && customer.stage !== 'WON' && (
            <button className="btn btn-primary btn-sm" onClick={() => handlePaymentAction('SEND_CONTRACT')}>发合同</button>
          )}
          {showPaymentActions && customer.payment_status !== 'PAID' && (
            <button className="btn btn-primary btn-sm" onClick={() => handlePaymentAction('MARK_PAID')}>标记已打款</button>
          )}
          {customer.stage === 'PAID' && (
            <button className="btn btn-primary btn-sm" onClick={() => handlePaymentAction('MARK_WON')}>标记成交</button>
          )}
          <button className="btn btn-sm" onClick={() => setShowFollowUp(true)}>
            <MessageSquare size={14} /> 记录跟进
          </button>
          <button className="btn btn-sm" onClick={() => setShowVisit(true)}>
            <MapPin size={14} /> 记录面访
          </button>
          <button className="btn btn-sm" onClick={() => navigate(`/assistant?customer_id=${customer.id}`)}>
            <Brain size={14} /> AI 助手分析
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
        {/* 基础信息 */}
        <div className="card" style={{ marginBottom: 20 }}>
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
        </div>

        {/* 跟进记录 */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">跟进记录</h3>
          {followUps.length === 0 ? (
            <div className="empty-state">暂无跟进记录</div>
          ) : (
            <ul className="timeline">
              {followUps.map(f => (
                <li key={f.id} className="timeline-item">
                  <div className="time">{new Date(f.created_at).toLocaleString('zh-CN')}</div>
                  <div className="title">{f.title}</div>
                  <div className="notes">{f.feedback_notes || '-'}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                    {f.contact_channel && <span className="badge badge-info">{CHANNEL_LABELS[f.contact_channel] || f.contact_channel}</span>}
                    {f.contact_result && <span className="badge badge-warning">{CONTACT_RESULT_LABELS[f.contact_result] || f.contact_result}</span>}
                    {f.intent_assessment && <span className="badge badge-high">{INTENT_LABELS[f.intent_assessment]}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 面访记录 */}
        <div className="card">
          <h3 className="section-title">面访记录</h3>
          {visits.length === 0 ? (
            <div className="empty-state">暂未面访记录</div>
          ) : (
            <ul className="timeline">
              {visits.map(v => (
                <li key={v.id} className="timeline-item">
                  <div className="time">{v.visited_at ? new Date(v.visited_at).toLocaleString('zh-CN') : new Date(v.created_at).toLocaleString('zh-CN')}</div>
                  <div className="title">{v.title}</div>
                  {v.visit_notes && <div className="notes">{v.visit_notes}</div>}
                  <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                    {v.visit_outcome && <span className="badge badge-warning">{VISIT_OUTCOME_LABELS[v.visit_outcome]}</span>}
                    {v.intent_after_visit && <span className="badge badge-info">{INTENT_LABELS[v.intent_after_visit]}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* AI 分析 */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">AI 分析</h3>
          {aiResult ? (
            <div style={{ padding: '8px 0' }}>
              {aiResult.suggestion ? (
                <div style={{ color: 'var(--text)', fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 12 }}>
                  {aiResult.suggestion}
                </div>
              ) : (
                <div style={{ color: '#dc2626', fontSize: 14 }}>分析失败: {aiResult.error}</div>
              )}
              <button className="btn btn-sm" onClick={() => setAiResult(null)}>重新分析</button>
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 16, color: '#9ca3af' }}>AI 分析中...</div>
          ) : aiError ? (
            <div style={{ padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 14 }}>
              {aiError}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 12 }}>让 AI 分析客户状态并建议下一步动作</p>
              <div className="btn-group" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={handleAIAnalyze}>
                  <Brain size={14} /> AI 分析
                </button>
                <button className="btn" onClick={handleLoadDrafts}>
                  查看 AI 草稿
                </button>
              </div>
            </div>
          )}

          {/* AI 草稿列表 */}
          {showDrafts && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>AI 草稿</span>
                <button className="btn btn-sm" onClick={() => setShowDrafts(false)}>收起</button>
              </div>
              {drafts.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>暂无草稿</div>
              ) : (
                <ul className="timeline">
                  {drafts.map(d => {
                    let parsed: Record<string, unknown> = {};
                    try { parsed = JSON.parse(d.ai_result_json); } catch { /* ignore */ }
                    return (
                      <li key={d.id} className="timeline-item">
                        <div className="time">
                          {new Date(d.created_at).toLocaleString('zh-CN')}
                          <span style={{ marginLeft: 8 }}>
                            {d.source_type === 'SCREENSHOT' ? '📷 截图' :
                             d.source_type === 'CALL_TEXT' ? '📞 通话' :
                             d.source_type === 'AUDIO' ? '🎤 音频' : '📝 手动'}
                          </span>
                          <span className={`badge ${d.status === 'DRAFT' ? 'badge-warning' : d.status === 'APPLIED' ? 'badge-success' : 'badge-danger'}`} style={{ marginLeft: 8 }}>
                            {d.status === 'DRAFT' ? '草稿' : d.status === 'APPLIED' ? '已应用' : '已丢弃'}
                          </span>
                        </div>
                        <div className="title">{d.raw_input_summary}</div>
                        {parsed.summary ? <div className="notes">{String(parsed.summary).slice(0, 200)}</div> : null}
                        {parsed.suggestion ? <div className="notes">{String(parsed.suggestion).slice(0, 200)}</div> : null}
                        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                          置信度: {d.confidence ? `${(d.confidence * 100).toFixed(0)}%` : '-'}
                          {d.confidence < 0.65 && <span style={{ color: '#d97706', marginLeft: 4 }}>(低)</span>}
                        </div>
                        {d.status === 'DRAFT' && (
                          <div className="btn-group" style={{ marginTop: 8 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleApplyDraft(d.id)}>
                              应用草稿
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDiscardDraft(d.id)}>
                              丢弃草稿
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
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
