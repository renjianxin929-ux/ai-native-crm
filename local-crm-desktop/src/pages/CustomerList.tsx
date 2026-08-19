import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Filter, Plus, Search, Star } from 'lucide-react';
import type { Customer, CustomerGrade } from '../lib/types';
import CustomerForm from '../components/CustomerForm';
import { formatOpportunityAmount } from '../lib/opportunityBoard/boardPresentation';
import { formatUserFacingScheduleDate } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { t, tFormat, tStage } from '../lib/i18n/appLocale';
import { useAppLocale } from '../lib/i18n/LocaleProvider';

interface Props {
  customers: Customer[];
  onRefresh: () => void;
}

function customerMetaLine(customer: Customer): string {
  return [customer.industry, customer.region]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

function stagePillClass(stage: string): string {
  if (stage === 'NEW_LEAD') return 'status-pill info';
  if (stage === 'LOST') return 'status-pill warn';
  if (stage === 'WON' || stage === 'PAID' || stage === 'CONTACTED' || stage === 'REPLIED' || stage === 'WECHAT_PASSED') {
    return 'status-pill ok';
  }
  if (stage === 'CONTRACTING' || stage === 'VISIT_READY' || stage === 'VISITED') return 'status-pill accent';
  return 'status-pill';
}

function followUpDayDiff(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(ms);
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((startDue - startToday) / 86_400_000);
}

function followUpRelative(iso: string | null | undefined): { text: string; tone: 'today' | 'overdue' | 'soon' | 'none' } {
  const diff = followUpDayDiff(iso);
  if (diff == null) return { text: '', tone: 'none' };
  if (diff === 0) return { text: t('customer.list.followToday'), tone: 'today' };
  if (diff < 0) return { text: t('customer.list.followOverdue'), tone: 'overdue' };
  return { text: tFormat('customer.list.followInDays', { n: diff }), tone: 'soon' };
}

export default function CustomerList({ customers, onRefresh }: Props) {
  const navigate = useNavigate();
  useAppLocale();
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
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    <div className="product-page customer-list-page">
      <div className="page-header">
        <div>
          <h2>{t('customer.list.title')}</h2>
          <p className="page-subtitle">{t('customer.list.subtitle')}</p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn btn-primary" onClick={() => setShowNewModal(true)}>
            <Plus size={16} /> {t('customer.list.new')}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="customer-find-bar">
          <div className="customer-list-toolbar">
            <div className="customer-list-search">
              <Search size={16} className="customer-list-search-icon" aria-hidden="true" />
              <input
                placeholder={t('customer.list.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label={t('customer.list.search')}
              />
            </div>
            <select
              className="customer-list-select"
              value={gradeFilter}
              onChange={e => setGradeFilter(e.target.value)}
              aria-label="筛选等级"
            >
              <option value="">全部等级</option>
              {(['A', 'B', 'C', 'D'] as CustomerGrade[]).map(g => (
                <option key={g} value={g}>{t(`grade.${g}`)}</option>
              ))}
            </select>
            <select
              className="customer-list-select"
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              aria-label="筛选阶段"
            >
              <option value="">全部阶段</option>
              {Object.entries({
                NEW_LEAD: tStage('NEW_LEAD'),
                CONTACTED: tStage('CONTACTED'),
                WECHAT_PASSED: tStage('WECHAT_PASSED'),
                REPLIED: tStage('REPLIED'),
                VISIT_READY: tStage('VISIT_READY'),
                VISITED: tStage('VISITED'),
                CONTRACTING: tStage('CONTRACTING'),
                PAYMENT_PENDING: tStage('PAYMENT_PENDING'),
                PAID: tStage('PAID'),
                WON: tStage('WON'),
                LOST: tStage('LOST'),
              }).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              className="customer-list-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              aria-label="排序"
            >
              <option value="default">默认排序</option>
              <option value="grade">等级 A→D</option>
              <option value="follow_up">跟进时间最近</option>
              <option value="updated">最近更新</option>
            </select>
            <button type="button" className="customer-list-more-btn" onClick={() => setFiltersOpen(open => !open)}>
              <Filter size={14} aria-hidden="true" />
              {filtersOpen ? '收起筛选' : '更多筛选'}
            </button>
          </div>
          {filtersOpen ? (
            <div className="customer-list-advanced">
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
                <label key={String(label)} className="customer-list-advanced-item">
                  <input type="checkbox" checked={Boolean(checked)} onChange={e => (setter as (v: boolean) => void)(e.target.checked)} />
                  {label as string}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {customers.length === 0 ? (
          <div className="empty-panel">{t('customer.list.empty')}</div>
        ) : sorted.length === 0 ? (
          <div className="empty-panel">{t('customer.list.noMatch')}</div>
        ) : (
          <div className="customer-list-surface">
            <div className="customer-list-grid" aria-label="客户列表">
              <div className="customer-list-head">
                <span>{t('customer.list.colCustomer')}</span>
                <span>{t('customer.list.colContact')}</span>
                <span>{t('customer.list.colStage')}</span>
                <span>{t('customer.list.colAmount')}</span>
                <span>{t('customer.list.colNext')}</span>
                <span />
              </div>
              {sorted.map(c => {
                const meta = customerMetaLine(c);
                const relative = followUpRelative(c.next_follow_up_at);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="customer-row-card"
                    onClick={() => navigate(`/customers/${c.id}`)}
                  >
                    <span className="customer-row-customer">
                      <span className="customer-row-name">
                        <strong>{c.name}</strong>
                        {c.customer_grade === 'A' ? <Star size={13} className="customer-row-star" aria-hidden="true" /> : null}
                      </span>
                      {meta ? <small className="customer-row-sub">{meta}</small> : null}
                    </span>
                    <span className="customer-row-contact">
                      <strong>{c.contact_person || t('customer.list.missingContact')}</strong>
                      {c.phone_number ? <small className="customer-row-sub">{c.phone_number}</small> : null}
                    </span>
                    <span className={stagePillClass(c.stage)}>{tStage(c.stage)}</span>
                    <span className="customer-row-amount">{formatOpportunityAmount(c.opportunity_amount ?? null)}</span>
                    <span className={`customer-row-due is-${relative.tone}`}>
                      <strong>{formatUserFacingScheduleDate(c.next_follow_up_at)}</strong>
                      {relative.text ? <small className="customer-row-sub">{relative.text}</small> : null}
                    </span>
                    <ArrowRight size={16} className="customer-row-chevron" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <div className="customer-list-footer">{tFormat('customer.list.count', { n: sorted.length })}</div>
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
