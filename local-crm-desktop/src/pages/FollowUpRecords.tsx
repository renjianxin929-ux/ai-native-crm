import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAllFollowUps } from '../lib/db';
import { listCustomers } from '../lib/db';
import { INTENT_LABELS, CHANNEL_LABELS, CONTACT_RESULT_LABELS } from '../lib/types';
import type { FollowUpRecord, Customer } from '../lib/types';

export default function FollowUpRecords() {
  const [records, setRecords] = useState<FollowUpRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    listAllFollowUps().then(setRecords);
    listCustomers().then(setCustomers);
  }, []);

  const getCustomerName = (id: string) => {
    const c = customers.find(c => c.id === id);
    return c?.name || '未知客户';
  };

  return (
    <div>
      <div className="page-header">
        <h2>跟进记录</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>共 {records.length} 条</span>
      </div>
      <div className="page-body">
        {records.length === 0 ? (
          <div className="empty-state">暂无跟进记录</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>客户</th>
                  <th>标题</th>
                  <th>触达方式</th>
                  <th>结果</th>
                  <th>意向判断</th>
                  <th>反馈内容</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/customers/${r.customer_id}`)}>
                    <td>{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                    <td><strong>{getCustomerName(r.customer_id)}</strong></td>
                    <td>{r.title}</td>
                    <td>{r.contact_channel ? CHANNEL_LABELS[r.contact_channel] || r.contact_channel : '-'}</td>
                    <td>{r.contact_result ? CONTACT_RESULT_LABELS[r.contact_result] || r.contact_result : '-'}</td>
                    <td>{r.intent_assessment ? INTENT_LABELS[r.intent_assessment] : '-'}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.feedback_notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
