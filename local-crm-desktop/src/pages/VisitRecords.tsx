import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAllVisits } from '../lib/db';
import { listCustomers } from '../lib/db';
import { VISIT_OUTCOME_LABELS, INTENT_LABELS, NEXT_ACTION_LABELS } from '../lib/types';
import type { VisitRecord, Customer } from '../lib/types';

export default function VisitRecords() {
  const [records, setRecords] = useState<VisitRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    listAllVisits().then(setRecords);
    listCustomers().then(setCustomers);
  }, []);

  const getCustomerName = (id: string) => {
    const c = customers.find(c => c.id === id);
    return c?.name || '未知客户';
  };

  return (
    <div>
      <div className="page-header">
        <h2>面访记录</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>共 {records.length} 条</span>
      </div>
      <div className="page-body">
        {records.length === 0 ? (
          <div className="empty-state">暂无面访记录</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>客户</th>
                  <th>标题</th>
                  <th>面访结论</th>
                  <th>面谈情况</th>
                  <th>意向判断</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/customers/${r.customer_id}`)}>
                    <td>{r.visited_at ? new Date(r.visited_at).toLocaleString('zh-CN') : new Date(r.created_at).toLocaleString('zh-CN')}</td>
                    <td><strong>{getCustomerName(r.customer_id)}</strong></td>
                    <td>{r.title}</td>
                    <td>{r.visit_outcome ? VISIT_OUTCOME_LABELS[r.visit_outcome] : '-'}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.visit_notes || '-'}
                    </td>
                    <td>{r.intent_after_visit ? INTENT_LABELS[r.intent_after_visit] : '-'}</td>
                    <td>{r.next_action ? NEXT_ACTION_LABELS[r.next_action] : '-'}</td>
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
