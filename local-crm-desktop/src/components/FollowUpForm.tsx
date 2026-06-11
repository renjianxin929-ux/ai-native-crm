import { useState } from 'react';
import { INTENT_LABELS } from '../lib/types';
import type { FollowUpRecord, IntentLevel } from '../lib/types';

interface Props {
  customerId: string;
  onClose: () => void;
  onSaved: (record: Omit<FollowUpRecord, 'id' | 'created_at' | 'updated_at'>) => void;
}

export default function FollowUpForm({ customerId, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [contactChannel, setContactChannel] = useState('wechat');
  const [contactResult, setContactResult] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [intentAssessment, setIntentAssessment] = useState<string>('');
  const [suggestedGrade, setSuggestedGrade] = useState<string>('');
  const [nextAction, setNextAction] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSaved({
      customer_id: customerId,
      title: title.trim(),
      contact_channel: contactChannel as FollowUpRecord['contact_channel'],
      contact_result: contactResult || null,
      feedback_notes: feedbackNotes || null,
      intent_assessment: (intentAssessment || null) as IntentLevel | null,
      suggested_grade: (suggestedGrade || null) as FollowUpRecord['suggested_grade'],
      next_action: (nextAction || null) as FollowUpRecord['next_action'],
      next_follow_up_at: null,
      is_completed: 1,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>新增跟进记录</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>标题 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus placeholder="例如: 首次微信沟通" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>触达方式</label>
              <select value={contactChannel} onChange={e => setContactChannel(e.target.value)}>
                <option value="wechat">微信</option>
                <option value="phone">电话</option>
                <option value="visit">面访</option>
                <option value="SMS">短信</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="form-group">
              <label>触达结果</label>
              <select value={contactResult} onChange={e => setContactResult(e.target.value)}>
                <option value="">未记录</option>
                <option value="positive">正反馈</option>
                <option value="negative">负反馈</option>
                <option value="no_response">无响应</option>
                <option value="replied">已回复</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>意向判断</label>
              <select value={intentAssessment} onChange={e => setIntentAssessment(e.target.value)}>
                <option value="">未判断</option>
                {Object.entries(INTENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>建议等级</label>
              <select value={suggestedGrade} onChange={e => setSuggestedGrade(e.target.value)}>
                <option value="">不修改</option>
                <option value="A">A类</option>
                <option value="B">B类</option>
                <option value="C">C类</option>
                <option value="D">D类</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>下一步动作</label>
            <select value={nextAction} onChange={e => setNextAction(e.target.value)}>
              <option value="">未设置</option>
              <option value="CONTACT_AGAIN">再触达</option>
              <option value="SCHEDULE_VISIT">约访</option>
              <option value="VISIT">面访</option>
              <option value="SEND_CONTRACT">发合同</option>
              <option value="WAIT_CUSTOMER">等客户</option>
              <option value="LOW_FREQUENCY">低频维护</option>
              <option value="CLOSE">关闭</option>
            </select>
          </div>

          <div className="form-group">
            <label>反馈内容</label>
            <textarea
              value={feedbackNotes}
              onChange={e => setFeedbackNotes(e.target.value)}
              rows={3}
              placeholder="记录沟通内容、客户反馈等"
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary">保存跟进记录</button>
          </div>
        </form>
      </div>
    </div>
  );
}
