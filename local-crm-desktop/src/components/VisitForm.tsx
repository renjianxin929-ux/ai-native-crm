import { useState } from 'react';
import { VISIT_OUTCOME_LABELS, INTENT_LABELS } from '../lib/types';
import type { VisitRecord, VisitOutcome, IntentLevel } from '../lib/types';

interface Props {
  customerId: string;
  onClose: () => void;
  onSaved: (record: Omit<VisitRecord, 'id' | 'created_at' | 'updated_at'>) => void;
}

export default function VisitForm({ customerId, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [customerConcerns, setCustomerConcerns] = useState('');
  const [visitOutcome, setVisitOutcome] = useState<string>('');
  const [intentAfterVisit, setIntentAfterVisit] = useState<string>('');
  const [nextAction, setNextAction] = useState('');
  const [expectedContractAt, setExpectedContractAt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSaved({
      customer_id: customerId,
      title: title.trim(),
      visited_at: new Date().toISOString(),
      visit_notes: visitNotes || null,
      customer_concerns: customerConcerns || null,
      intent_after_visit: (intentAfterVisit || null) as IntentLevel | null,
      visit_outcome: (visitOutcome || null) as VisitOutcome | null,
      next_action: (nextAction || null) as VisitRecord['next_action'],
      expected_contract_at: expectedContractAt || null,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>新增面访记录</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>面访标题 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus placeholder="例如: 初次见面洽谈" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>面访结论 *</label>
              <select value={visitOutcome} onChange={e => setVisitOutcome(e.target.value)}>
                <option value="">请选择</option>
                {Object.entries(VISIT_OUTCOME_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>面访后意向判断</label>
              <select value={intentAfterVisit} onChange={e => setIntentAfterVisit(e.target.value)}>
                <option value="">未判断</option>
                {Object.entries(INTENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>下一步动作</label>
              <select value={nextAction} onChange={e => setNextAction(e.target.value)}>
                <option value="">未设置</option>
                <option value="CONTACT_AGAIN">再触达</option>
                <option value="SCHEDULE_VISIT">约访</option>
                <option value="SEND_CONTRACT">发合同</option>
                <option value="WAIT_CUSTOMER">等客户</option>
                <option value="LOW_FREQUENCY">低频维护</option>
                <option value="CLOSE">关闭</option>
              </select>
            </div>
            <div className="form-group">
              <label>预计签约时间</label>
              <input
                type="date"
                value={expectedContractAt}
                onChange={e => setExpectedContractAt(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>客户关注点</label>
            <input
              value={customerConcerns}
              onChange={e => setCustomerConcerns(e.target.value)}
              placeholder="客户关心的问题、痛点等"
            />
          </div>

          <div className="form-group">
            <label>面谈情况</label>
            <textarea
              value={visitNotes}
              onChange={e => setVisitNotes(e.target.value)}
              rows={4}
              placeholder="详细记录面谈内容..."
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary">保存面访记录</button>
          </div>
        </form>
      </div>
    </div>
  );
}
