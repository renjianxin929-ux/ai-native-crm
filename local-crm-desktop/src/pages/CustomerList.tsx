import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ArrowRight } from 'lucide-react';
import { GRADE_LABELS, STAGE_LABELS, INTENT_LABELS } from '../lib/types';
import type { Customer, CustomerGrade } from '../lib/types';
import CustomerForm from '../components/CustomerForm';

interface Props {
  customers: Customer[];
  onRefresh: () => void;
}

function riskLabel(customer: Customer): { text: string; tone: string } {
  if (customer.no_show_count >= 2) return { text: '高爽约风险', tone: 'warn' };
  if (customer.intent_level === 'LOW') return { text: '意向偏低', tone: 'warn' };
  if (customer.intent_level === 'HIGH') return { text: '机会较大', tone: 'ok' };
  return { text: '平稳', tone: 'info' };
}

export default function CustomerList({ customers, onRefresh }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<string>('');
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
    if (stageFilter && c.stage !== stageFilter) return false;
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
    }
    return true;
  });

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
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
  }), [filtered, sortBy]);

  return (
    <div className="product-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">CUSTOMER PIPELINE</p>
          <h2>客户</h2>
          <p className="page-subtitle">按阶段、优先级、风险与下一步推进客户，进入详情或直接交给 Sales Agent。</p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn btn-primary" onClick={() => setShowNewModal(true)}>
            <Plus size={16} /> 新增客户
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="glass-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
              <input
                placeholder="搜索名称 / 手机 / 微信 / 联系人 / 行业 / 地区…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="搜索客户"
                style={{ paddingLeft: 36, width: '100%', minHeight: 40, border: '1px solid var(--border)', borderRadius: 12, background: 'rgba(255,255,255,0.9)' }}
              />
            </div>
            <select
              value={gradeFilter}
              onChange={e => setGradeFilter(e.target.value)}
              aria-label="筛选等级"
              style={{ minHeight: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 12 }}
            >
              <option value="">全部等级</option>
              {(['A', 'B', 'C', 'D'] as CustomerGrade[]).map(g => (
                <option key={g} value={g}>{GRADE_LABELS[g]}</option>
              ))}
            </select>
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              aria-label="筛选阶段"
              style={{ minHeight: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 12 }}
            >
              <option value="">全部阶段</option>
              {Object.entries(STAGE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              aria-label="排序"
              style={{ minHeight: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 12 }}
            >
              <option value="default">默认排序</option>
              <option value="grade">等级 A→D</option>
              <option value="follow_up">跟进时间最近</option>
              <option value="updated">最近更新</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>筛选</span>
            {[
              [hasPhone, setHasPhone, '有手机'],
              [hasWebsite, setHasWebsite, '有官网'],
              [todayFollowUp, setTodayFollowUp, '今天跟进'],
              [wechatPassed, setWechatPassed, '微信已过'],
              [highIntent, setHighIntent, '高意向'],
              [canScheduleVisit, setCanScheduleVisit, '可约访'],
              [sevenDayFollowUp, setSevenDayFollowUp, '7天内跟进'],
              [longUntouched, setLongUntouched, '长期未触达'],
            ].map(([checked, setter, label]) => (
              <label key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={Boolean(checked)} onChange={e => (setter as (v: boolean) => void)(e.target.checked)} />
                {label as string}
              </label>
            ))}
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="empty-panel">暂无客户，点击「新增客户」开始</div>
        ) : sorted.length === 0 ? (
          <div className="empty-panel">无匹配结果，请调整筛选条件</div>
        ) : (
          <div className="customer-list-grid" aria-label="客户列表">
            <div className="customer-row-card" style={{ cursor: 'default', background: 'transparent', boxShadow: 'none', borderColor: 'transparent', paddingBottom: 0 }}>
              <small>优先级</small>
              <small>客户 / 阶段</small>
              <small>风险</small>
              <small>最近互动</small>
              <small>下一步</small>
              <small>下次跟进</small>
              <small />
            </div>
            {sorted.map(c => {
              const risk = riskLabel(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="customer-row-card"
                  onClick={() => navigate(`/customers/${c.id}`)}
                >
                  <span className={`badge badge-${c.customer_grade.toLowerCase()}`}>{GRADE_LABELS[c.customer_grade]}</span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{STAGE_LABELS[c.stage]} · {INTENT_LABELS[c.intent_level]} · {c.contact_person || '未填联系人'}</small>
                  </span>
                  <span className={`status-pill ${risk.tone}`}>{risk.text}</span>
                  <span>
                    <strong style={{ fontSize: 13 }}>{c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('zh-CN') : '暂无互动'}</strong>
                    <small>{c.region || c.industry || '—'}</small>
                  </span>
                  <span>
                    <strong style={{ fontSize: 13 }}>{c.next_action || '待明确'}</strong>
                    <small>{c.phone_number || c.wechat_id || '无联系方式'}</small>
                  </span>
                  <span>
                    <strong style={{ fontSize: 13 }}>{c.next_follow_up_at ? new Date(c.next_follow_up_at).toLocaleDateString('zh-CN') : '—'}</strong>
                    <small>进入详情</small>
                  </span>
                  <ArrowRight size={16} color="var(--primary)" />
                </button>
              );
            })}
          </div>
        )}
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
