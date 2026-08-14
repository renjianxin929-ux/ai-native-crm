import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { updateCustomer, createTask } from '../lib/db';
import { applyWechatPassed, applyIntentRule } from '../lib/rules';
import { parseRoughTime } from '../lib/timeParser';
import { createCustomerWithProductRules } from '../lib/customerCreate';
import { WECHAT_SEARCH_LABELS, WECHAT_ADD_LABELS, INTENT_LABELS, PHONE_FEEDBACK_LABELS } from '../lib/types';
import type { Customer, WechatSearchStatus, WechatAddStatus, IntentLevel, PhoneFeedback, ContactMethod } from '../lib/types';

interface Props {
  customer?: Customer;
  onClose: () => void;
  onSaved: () => void;
}

export default function CustomerForm({ customer, onClose, onSaved }: Props) {
  const isEdit = !!customer;
  const [name, setName] = useState(customer?.name || '');
  const [wechatId, setWechatId] = useState(customer?.wechat_id || '');
  const [phoneNumber, setPhoneNumber] = useState(customer?.phone_number || '');
  const [wechatSearchStatus, setWechatSearchStatus] = useState<string>(customer?.wechat_search_status || '');
  const [isKeyDm, setIsKeyDm] = useState(customer?.is_key_decision_maker || 0);
  const [wechatAddStatus, setWechatAddStatus] = useState<string>(customer?.wechat_add_status || 'NOT_ADDED');
  const [intentLevel, setIntentLevel] = useState<string>(customer?.intent_level || 'UNKNOWN');
  const [phoneFeedback, setPhoneFeedback] = useState<string>(customer?.phone_feedback || '');
  const [roughVisitTime, setRoughVisitTime] = useState(customer?.rough_visit_time_text || '');
  const [notes, setNotes] = useState(customer?.notes || '');
  const [contactMethod, setContactMethod] = useState(customer?.contact_method || '');
  const [website, setWebsite] = useState(customer?.website || '');
  const [region, setRegion] = useState(customer?.region || '');
  const [industry, setIndustry] = useState(customer?.industry || '');
  const [contactPerson, setContactPerson] = useState(customer?.contact_person || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [address, setAddress] = useState(customer?.address || '');
  const [pitchAngle, setPitchAngle] = useState(customer?.pitch_angle || '');
  const [qualificationReason, setQualificationReason] = useState(customer?.qualification_reason || '');
  const [source, setSource] = useState(customer?.source || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    // 解析模糊时间（编辑模式仍需；新增模式的完整产品语义在共享服务中执行）
    let parsedReminder: string | null = null;
    let parseStatus = 'NOT_PARSED';
    let parseNote: string | null = null;
    if (roughVisitTime.trim()) {
      const result = parseRoughTime(roughVisitTime.trim());
      parsedReminder = result.parsed_at;
      parseStatus = result.status;
      parseNote = result.note;
    }

    if (isEdit && customer) {
      // ── 编辑模式 ──
      // 应用业务规则
      const prevWechatAddStatus = customer.wechat_add_status;
      const prevIntentLevel = customer.intent_level;
      const prevPhoneFeedback = customer.phone_feedback;

      // 检测字段变更并触发规则
      let updated = { ...customer };
      const tasks: Array<{ title: string; customer_id: string | null; due_at: string | null; priority: 'HIGH' | 'MEDIUM' | 'LOW'; source: 'MANUAL' | 'RULE' | 'AI' }> = [];

      // Rule 2: 微信通过
      if (wechatAddStatus === 'PASSED' && prevWechatAddStatus !== 'PASSED') {
        const result = applyWechatPassed({ ...updated, wechat_add_status: prevWechatAddStatus });
        updated = { ...updated, ...result.customer };
        tasks.push(...result.tasks.map(t => ({
          title: t.title, customer_id: t.customer_id, due_at: t.due_at,
          priority: t.priority, source: t.source,
        })));
      }

      // Rule 3: 意向/电话反馈变更
      const intentChanged = intentLevel !== prevIntentLevel;
      const phoneChanged = phoneFeedback !== (prevPhoneFeedback || '');
      if (intentChanged || phoneChanged) {
        const result = applyIntentRule(updated, {
          intent_level: intentLevel !== 'UNKNOWN' ? intentLevel : null,
          phone_feedback: phoneFeedback || null,
        });
        updated = { ...updated, ...result.customer };
        tasks.push(...result.tasks.map(t => ({
          title: t.title, customer_id: t.customer_id, due_at: t.due_at,
          priority: t.priority, source: t.source,
        })));
      }

      // 合并用户直接编辑的字段（优先级高于规则）
      updated = {
        ...updated,
        name,
        wechat_id: wechatId || null,
        phone_number: phoneNumber || null,
        wechat_search_status: (wechatSearchStatus || null) as WechatSearchStatus | null,
        is_key_decision_maker: isKeyDm,
        wechat_add_status: wechatAddStatus as WechatAddStatus,
        intent_level: intentLevel as IntentLevel,
        phone_feedback: (phoneFeedback || null) as PhoneFeedback | null,
        contact_method: (contactMethod || null) as Customer['contact_method'],
        rough_visit_time_text: roughVisitTime || null,
        parsed_visit_reminder_at: parsedReminder,
        time_parse_status: parseStatus as Customer['time_parse_status'],
        time_parse_note: parseNote,
        notes: notes || null,
        website: website || null,
        region: region || null,
        industry: industry || null,
        contact_person: contactPerson || null,
        email: email || null,
        address: address || null,
        pitch_angle: pitchAngle || null,
        qualification_reason: qualificationReason || null,
        source: source || null,
      };

      await updateCustomer(customer.id, updated);
      for (const t of tasks) {
        await createTask({
          id: uuidv4(),
          customer_id: t.customer_id,
          title: t.title,
          due_at: t.due_at,
          status: 'OPEN',
          priority: t.priority,
          source: t.source,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } else {
      // ── 新增模式 ──
      // 完整产品语义复用共享服务（createCustomerWithProductRules = 时间解析 →
      // 初始等级 → 跟进时间 → db.createCustomer → 后置产品规则），
      // 与 W4-1 Agent 确认后执行路径为同一实现（单一真源）。
      const id = uuidv4();
      await createCustomerWithProductRules({
        id,
        name,
        wechat_id: wechatId || null,
        phone_number: phoneNumber || null,
        contact_method: (contactMethod || null) as ContactMethod | null,
        wechat_search_status: (wechatSearchStatus || null) as WechatSearchStatus | null,
        is_key_decision_maker: isKeyDm as 0 | 1,
        wechat_add_status: wechatAddStatus as WechatAddStatus,
        intent_level: intentLevel as IntentLevel,
        phone_feedback: (phoneFeedback || null) as PhoneFeedback | null,
        rough_visit_time_text: roughVisitTime || null,
        notes: notes || null,
        website: website || null,
        region: region || null,
        industry: industry || null,
        contact_person: contactPerson || null,
        email: email || null,
        address: address || null,
        pitch_angle: pitchAngle || null,
        qualification_reason: qualificationReason || null,
        source: source || null,
      });
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{isEdit ? '编辑客户' : '新增客户'}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>客户名称 *</label>
              <input value={name} onChange={e => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-group">
              <label>微信号</label>
              <input value={wechatId} onChange={e => setWechatId(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>手机号/电话</label>
              <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
            </div>
            <div className="form-group">
              <label>联系方式</label>
              <select value={contactMethod} onChange={e => setContactMethod(e.target.value)}>
                <option value="">未设置</option>
                <option value="WECHAT">微信</option>
                <option value="PHONE">电话</option>
                <option value="WECHAT_AND_PHONE">微信+电话</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>微信搜索状态</label>
              <select value={wechatSearchStatus} onChange={e => setWechatSearchStatus(e.target.value)}>
                <option value="">未设置</option>
                {Object.entries(WECHAT_SEARCH_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>是否关键KP</label>
              <select value={isKeyDm} onChange={e => setIsKeyDm(Number(e.target.value))}>
                <option value={0}>否</option>
                <option value={1}>是</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>微信添加状态</label>
              <select value={wechatAddStatus} onChange={e => setWechatAddStatus(e.target.value)}>
                {Object.entries(WECHAT_ADD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>意向度</label>
              <select value={intentLevel} onChange={e => setIntentLevel(e.target.value)}>
                {Object.entries(INTENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>电话反馈</label>
              <select value={phoneFeedback} onChange={e => setPhoneFeedback(e.target.value)}>
                <option value="">未设置</option>
                {Object.entries(PHONE_FEEDBACK_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>官网</label>
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <div className="form-group">
              <label>城市/区域</label>
              <input value={region} onChange={e => setRegion(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>行业</label>
              <input value={industry} onChange={e => setIndustry(e.target.value)} />
            </div>
            <div className="form-group">
              <label>联系人</label>
              <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>邮箱</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" />
            </div>
            <div className="form-group">
              <label>地址</label>
              <input value={address} onChange={e => setAddress(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>推荐切入点</label>
              <input value={pitchAngle} onChange={e => setPitchAngle(e.target.value)} />
            </div>
            <div className="form-group">
              <label>判断原因</label>
              <input value={qualificationReason} onChange={e => setQualificationReason(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>来源</label>
              <input value={source} onChange={e => setSource(e.target.value)} />
            </div>
            <div className="form-group" />
          </div>

          <div className="form-group">
            <label>模糊约访时间（如: 下周二下午）</label>
            <input
              value={roughVisitTime}
              onChange={e => setRoughVisitTime(e.target.value)}
              placeholder="例如: 明天、下周二下午、后天"
            />
          </div>

          <div className="form-group">
            <label>备注</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="其他备注信息"
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中...' : (isEdit ? '保存修改' : '创建客户')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
