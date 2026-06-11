import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertCircle, Calendar, Clock, CheckSquare } from 'lucide-react';
import { buildTodaySummary, getRecommendedAction } from '../lib/rules';
import { GRADE_LABELS, INTENT_LABELS } from '../lib/types';
import type { Customer, Task } from '../lib/types';
import CustomerForm from '../components/CustomerForm';

interface Props {
  customers: Customer[];
  tasks: Task[];
  onRefresh: () => void;
}

export default function TodayView({ customers, tasks, onRefresh }: Props) {
  const navigate = useNavigate();
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const summary = useMemo(() => buildTodaySummary(customers, tasks), [customers, tasks]);

  const stats = [
    { label: '逾期跟进', count: summary.overdue_customers.length, color: '#ef4444', icon: AlertCircle },
    { label: '今日跟进', count: summary.due_today_customers.length, color: '#3b82f6', icon: Clock },
    { label: '7天内约访', count: summary.upcoming_visits.length, color: '#8b5cf6', icon: Calendar },
    { label: '长期未触达', count: summary.long_time_no_contact.length, color: '#f59e0b', icon: AlertCircle },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>今日跟进</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => setShowNewCustomer(true)}>
            <Plus size={16} /> 新增客户
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="summary-cards">
          {stats.map(s => (
            <div className="summary-card" key={s.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="count" style={{ color: s.color }}>{s.count}</div>
                <s.icon size={24} color={s.color} opacity={0.5} />
              </div>
              <div className="label">{s.label}</div>
            </div>
          ))}
          {summary.tasks_due_today.length > 0 && (
            <div className="summary-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="count" style={{ color: '#10b981' }}>{summary.tasks_due_today.length}</div>
                <CheckSquare size={24} color="#10b981" opacity={0.5} />
              </div>
              <div className="label">今日任务</div>
            </div>
          )}
        </div>

        {summary.overdue_customers.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title" style={{ color: '#ef4444' }}>逾期跟进 ({summary.overdue_customers.length})</h3>
            <div className="table-container" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>客户名称</th>
                    <th>等级</th>
                    <th>手机/微信</th>
                    <th>行业/地区</th>
                    <th>上次跟进</th>
                    <th>推荐动作</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.overdue_customers.map(c => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                      <td><strong>{c.name}</strong></td>
                      <td><span className={`badge badge-${c.customer_grade.toLowerCase()}`}>{GRADE_LABELS[c.customer_grade]}</span></td>
                      <td style={{ fontSize: 13 }}>{c.phone_number || c.wechat_id || '-'}</td>
                      <td style={{ fontSize: 13 }}>{[c.industry, c.region].filter(Boolean).join(' / ') || '-'}</td>
                      <td style={{ fontSize: 13 }}>{c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('zh-CN') : '从未'}</td>
                      <td style={{ fontSize: 12, color: '#ef4444', maxWidth: 200 }}>{getRecommendedAction(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {summary.due_today_customers.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title" style={{ color: '#3b82f6' }}>今日待跟进 ({summary.due_today_customers.length})</h3>
            <div className="table-container" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>客户名称</th>
                    <th>等级</th>
                    <th>手机/微信</th>
                    <th>行业/地区</th>
                    <th>意向度</th>
                    <th>推荐动作</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.due_today_customers.map(c => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                      <td><strong>{c.name}</strong></td>
                      <td><span className={`badge badge-${c.customer_grade.toLowerCase()}`}>{GRADE_LABELS[c.customer_grade]}</span></td>
                      <td style={{ fontSize: 13 }}>{c.phone_number || c.wechat_id || '-'}</td>
                      <td style={{ fontSize: 13 }}>{[c.industry, c.region].filter(Boolean).join(' / ') || '-'}</td>
                      <td style={{ fontSize: 13 }}>{INTENT_LABELS[c.intent_level]}</td>
                      <td style={{ fontSize: 12, color: '#3b82f6', maxWidth: 200 }}>{getRecommendedAction(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {summary.tasks_due_today.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title" style={{ color: '#10b981' }}>今日任务</h3>
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>截止时间</th>
                  <th>优先级</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {summary.tasks_due_today.map(t => (
                  <tr key={t.id} className="clickable" onClick={() => t.customer_id && navigate(`/customers/${t.customer_id}`)}>
                    <td><strong>{t.title}</strong></td>
                    <td>{t.due_at ? new Date(t.due_at).toLocaleString('zh-CN') : '-'}</td>
                    <td>
                      <span className={`badge ${t.priority === 'HIGH' ? 'badge-high' : t.priority === 'MEDIUM' ? 'badge-medium' : 'badge-low'}`}>
                        {t.priority === 'HIGH' ? '高' : t.priority === 'MEDIUM' ? '中' : '低'}
                      </span>
                    </td>
                    <td>{t.source === 'RULE' ? '规则' : t.source === 'AI' ? 'AI' : '手动'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.upcoming_visits.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title" style={{ color: '#8b5cf6' }}>未来7天跟进 ({summary.upcoming_visits.length})</h3>
            <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>客户名称</th>
                    <th>等级</th>
                    <th>手机/微信</th>
                    <th>行业/地区</th>
                    <th>跟进时间</th>
                    <th>推荐动作</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.upcoming_visits.map(c => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                      <td><strong>{c.name}</strong></td>
                      <td><span className={`badge badge-${c.customer_grade.toLowerCase()}`}>{GRADE_LABELS[c.customer_grade]}</span></td>
                      <td style={{ fontSize: 13 }}>{c.phone_number || c.wechat_id || '-'}</td>
                      <td style={{ fontSize: 13 }}>{[c.industry, c.region].filter(Boolean).join(' / ') || '-'}</td>
                      <td style={{ fontSize: 13 }}>{c.next_follow_up_at ? new Date(c.next_follow_up_at).toLocaleDateString('zh-CN') : '-'}</td>
                      <td style={{ fontSize: 12, color: '#8b5cf6', maxWidth: 200 }}>{getRecommendedAction(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {summary.long_time_no_contact.length > 0 && (
          <div className="card">
            <h3 className="section-title" style={{ color: '#f59e0b' }}>长期未触达 ({summary.long_time_no_contact.length})</h3>
            <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>客户名称</th>
                    <th>等级</th>
                    <th>手机/微信</th>
                    <th>行业/地区</th>
                    <th>最近触达</th>
                    <th>推荐动作</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.long_time_no_contact.map(c => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                      <td><strong>{c.name}</strong></td>
                      <td><span className={`badge badge-${c.customer_grade.toLowerCase()}`}>{GRADE_LABELS[c.customer_grade]}</span></td>
                      <td style={{ fontSize: 13 }}>{c.phone_number || c.wechat_id || '-'}</td>
                      <td style={{ fontSize: 13 }}>{[c.industry, c.region].filter(Boolean).join(' / ') || '-'}</td>
                      <td style={{ fontSize: 13 }}>{c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('zh-CN') : '从未触达'}</td>
                      <td style={{ fontSize: 12, color: '#f59e0b', maxWidth: 200 }}>{getRecommendedAction(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {customers.length === 0 && (
          <div className="empty-state">
            <p>还没有客户数据。点击"新增客户"开始。</p>
          </div>
        )}
      </div>

      {showNewCustomer && (
        <CustomerForm
          onClose={() => setShowNewCustomer(false)}
          onSaved={() => { setShowNewCustomer(false); onRefresh(); }}
        />
      )}
    </div>
  );
}
