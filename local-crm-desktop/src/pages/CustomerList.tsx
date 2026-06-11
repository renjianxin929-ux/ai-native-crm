import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { GRADE_LABELS } from '../lib/types';
import type { Customer, CustomerGrade } from '../lib/types';
import CustomerForm from '../components/CustomerForm';

interface Props {
  customers: Customer[];
  onRefresh: () => void;
}

export default function CustomerList({ customers, onRefresh }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('');
  const [hasPhone, setHasPhone] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [todayFollowUp, setTodayFollowUp] = useState(false);
  const [wechatPassed, setWechatPassed] = useState(false);
  const [highIntent, setHighIntent] = useState(false);
  const [canScheduleVisit, setCanScheduleVisit] = useState(false);
  const [sevenDayFollowUp, setSevenDayFollowUp] = useState(false);
  const [longUntouched, setLongUntouched] = useState(false);
  const [sortBy, setSortBy] = useState<string>('default');
  const [showNewModal, setShowNewModal] = useState(false);

  const now = new Date();
  const todayStr = now.toLocaleDateString('zh-CN');
  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const filtered = customers.filter(c => {
    if (search) {
      const q = search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) &&
          !c.wechat_id?.toLowerCase().includes(q) &&
          !c.phone_number?.toLowerCase().includes(q) &&
          !c.contact_person?.toLowerCase().includes(q) &&
          !c.industry?.toLowerCase().includes(q) &&
          !c.website?.toLowerCase().includes(q) &&
          !c.region?.toLowerCase().includes(q) &&
          !c.notes?.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (gradeFilter && c.customer_grade !== gradeFilter) return false;
    if (hasPhone && !c.phone_number) return false;
    if (hasWebsite && !c.website) return false;
    if (todayFollowUp) {
      if (!c.next_follow_up_at) return false;
      if (new Date(c.next_follow_up_at).toLocaleDateString('zh-CN') !== todayStr) return false;
    }
    if (wechatPassed && c.wechat_add_status !== 'PASSED') return false;
    if (highIntent && c.intent_level !== 'HIGH') return false;
    if (canScheduleVisit && c.stage !== 'VISIT_READY') return false;
    if (sevenDayFollowUp) {
      if (!c.next_follow_up_at) return false;
      const d = new Date(c.next_follow_up_at);
      if (d < now || d > sevenDaysLater) return false;
    }
    if (longUntouched) {
      if (c.last_contacted_at) {
        if (new Date(c.last_contacted_at) > thirtyDaysAgo) return false;
      }
      // No last_contacted_at at all → also considered untouched
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'grade': {
        const order: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
        return (order[a.customer_grade] || 4) - (order[b.customer_grade] || 4);
      }
      case 'follow_up': {
        if (!a.next_follow_up_at && !b.next_follow_up_at) return 0;
        if (!a.next_follow_up_at) return 1;
        if (!b.next_follow_up_at) return -1;
        return new Date(a.next_follow_up_at).getTime() - new Date(b.next_follow_up_at).getTime();
      }
      case 'updated': {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
      default:
        return 0;
    }
  });

  return (
    <div>
      <div className="page-header">
        <h2>客户列表</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
            <Plus size={16} /> 新增客户
          </button>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#9ca3af' }} />
            <input
              placeholder="搜索名称/手机/微信号/联系人/行业/地区/官网/备注..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%', padding: '8px 12px 8px 32px', border: '1px solid var(--border)', borderRadius: 6 }}
            />
          </div>
          <select
            value={gradeFilter}
            onChange={e => setGradeFilter(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6 }}
          >
            <option value="">全部等级</option>
            {(['A', 'B', 'C', 'D'] as CustomerGrade[]).map(g => (
              <option key={g} value={g}>{GRADE_LABELS[g]}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#9ca3af', marginRight: 4 }}>筛选:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} />
            有手机
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={hasWebsite} onChange={e => setHasWebsite(e.target.checked)} />
            有官网
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={todayFollowUp} onChange={e => setTodayFollowUp(e.target.checked)} />
            今天跟进
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={wechatPassed} onChange={e => setWechatPassed(e.target.checked)} />
            微信已过
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={highIntent} onChange={e => setHighIntent(e.target.checked)} />
            高意向
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={canScheduleVisit} onChange={e => setCanScheduleVisit(e.target.checked)} />
            可约访
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={sevenDayFollowUp} onChange={e => setSevenDayFollowUp(e.target.checked)} />
            7天内跟进
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={longUntouched} onChange={e => setLongUntouched(e.target.checked)} />
            长期未触达
          </label>
          <span style={{ flex: 1 }} />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
          >
            <option value="default">默认排序</option>
            <option value="grade">等级 A→D</option>
            <option value="follow_up">跟进时间最近</option>
            <option value="updated">最近更新</option>
          </select>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>等级</th>
                <th>客户名称</th>
                <th>手机</th>
                <th>联系人</th>
                <th>行业</th>
                <th>城市</th>
                <th>官网</th>
                <th>下次跟进</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                  <td><span className={`badge badge-${c.customer_grade.toLowerCase()}`}>{GRADE_LABELS[c.customer_grade]}</span></td>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone_number || '-'}</td>
                  <td>{c.contact_person || '-'}</td>
                  <td>{c.industry || '-'}</td>
                  <td>{c.region || '-'}</td>
                  <td>{c.website ? <a href={c.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12 }}>{c.website.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 24)}{c.website.length > 24 ? '...' : ''}</a> : '-'}</td>
                  <td>{c.next_follow_up_at ? new Date(c.next_follow_up_at).toLocaleDateString('zh-CN') : '-'}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>
                    {customers.length === 0 ? '暂无客户，点击"新增客户"开始' : '无匹配结果'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNewModal && (
        <CustomerForm
          onClose={() => setShowNewModal(false)}
          onSaved={() => { setShowNewModal(false); onRefresh(); }}
        />
      )}
    </div>
  );
}
