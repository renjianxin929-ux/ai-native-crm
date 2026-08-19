import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Users, Settings, BriefcaseBusiness, Sparkles, LayoutGrid, RotateCcw, ChevronDown, Upload } from 'lucide-react';
import { t, setAppLocale, hydrateAppLocale, configureLocalePersistence, APP_LOCALE_SETTING_KEY, type AppLocale } from './lib/i18n/appLocale';
import { LocaleProvider, useAppLocale } from './lib/i18n/LocaleProvider';
import { getDb } from './lib/db';
import CustomerList from './pages/CustomerList';
import CustomerDetail from './pages/CustomerDetail';
import FollowUpRecords from './pages/FollowUpRecords';
import VisitRecords from './pages/VisitRecords';
import SettingsPage from './pages/SettingsPage';
import DataImportPage from './pages/DataImportPage';
import LeadImportCenterPage from './pages/LeadImportCenterPage';
import LeadWorkbenchPage from './pages/LeadWorkbenchPage';
import AISettingsPage from './pages/AISettingsPage';
import AINativeCRMWorkspace from './components/aiNative/AINativeCRMWorkspace';
import CustomerBattleCardPage from './pages/CustomerBattleCardPage';
import DailyBattleReviewPage from './pages/DailyBattleReviewPage';
import OpportunityBoardPage from './pages/OpportunityBoardPage';
import type { Customer } from './lib/types';
import { listCustomers } from './lib/db';
import './App.css';

function isSalesAgentPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/ai-workspace';
}

export default function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  useAppLocale();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const customerList = await listCustomers();
      setCustomers(customerList);
      setDbError(null);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('数据库初始化失败')) {
        setDbError(errMsg);
      }
      console.error('数据加载失败:', errMsg);
    }
  }, []);

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      refreshAll();
      void (async () => {
        try {
          const db = await getDb();
          configureLocalePersistence({
            read: () => null,
            write: locale => {
              void db.execute(
                'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
                [APP_LOCALE_SETTING_KEY, locale, new Date().toISOString()],
              );
            },
          });
          const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [APP_LOCALE_SETTING_KEY]);
          const stored = rows[0]?.value;
          if (stored === 'zh-CN' || stored === 'en-US') {
            setAppLocale(stored as AppLocale, { persist: false });
          } else {
            hydrateAppLocale();
          }
        } catch {
          hydrateAppLocale();
        }
      })();
    }
  }, [refreshAll]);

  const navItems = [
    { to: '/', icon: Sparkles, label: t('nav.agent'), match: 'agent' as const },
    { to: '/board', icon: LayoutGrid, label: t('nav.board'), match: 'exact' as const },
    { to: '/customers', icon: Users, label: t('nav.customers'), match: 'exact' as const },
    { to: '/battle-review', icon: RotateCcw, label: t('nav.review'), match: 'exact' as const },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar" aria-label={t('nav.primary')}>
        <div className="sidebar-header">
          <h1>{t('nav.sidebarTitle')}</h1>
        </div>
        <nav className="sidebar-nav" aria-label={t('nav.primary')} data-testid="primary-nav">
          {navItems.map(item => {
            const active =
              item.match === 'agent'
                ? isSalesAgentPath(location.pathname)
                : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.match === 'agent' || item.match === 'exact'}
                className={() => `nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-account-wrap">
          <button
            type="button"
            className="sidebar-account"
            aria-label={t('nav.systemEntry')}
            aria-expanded={profileOpen}
            data-testid="system-entry"
            onClick={() => setProfileOpen(open => !open)}
          >
            <span className="sidebar-avatar" aria-hidden="true">本</span>
            <span>
              <strong>{t('nav.workspace')}</strong>
              <small>{t('nav.workspaceHint')}</small>
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {profileOpen ? (
            <div className="sidebar-profile-menu" role="menu" data-testid="system-menu">
              <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); navigate('/settings'); }}>
                <Settings size={14} /> {t('nav.settings')}
              </button>
              <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); navigate('/settings/ai'); }}>
                <Sparkles size={14} /> {t('nav.aiSettings')}
              </button>
              <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); navigate('/lead-workbench'); }}>
                <BriefcaseBusiness size={14} /> {t('nav.leadWorkbench')}
              </button>
              <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); navigate('/import'); }}>
                <Upload size={14} /> {t('nav.import')}
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="main-content">
        {dbError && (
          <div className="app-db-error" role="alert">
            数据库初始化失败，请勿录入真实数据。错误: {dbError}
          </div>
        )}
        <Routes>
          <Route path="/" element={<AINativeCRMWorkspace onProductCatalogRefresh={refreshAll} />} />
          <Route path="/board" element={<OpportunityBoardPage customers={customers} onRefresh={refreshAll} />} />
          <Route path="/customers" element={<CustomerList customers={customers} onRefresh={refreshAll} />} />
          <Route path="/customers/:id" element={<CustomerDetail onRefresh={refreshAll} />} />
          <Route path="/customers/:id/battle-card" element={<CustomerBattleCardPage />} />
          <Route path="/battle-review" element={<DailyBattleReviewPage />} />
          <Route path="/follow-ups" element={<FollowUpRecords />} />
          <Route path="/visits" element={<VisitRecords />} />
          <Route path="/ai-workspace" element={<AINativeCRMWorkspace onProductCatalogRefresh={refreshAll} />} />
          <Route path="/import" element={<DataImportPage customers={customers} onRefresh={refreshAll} />} />
          <Route path="/lead-import-center" element={<LeadImportCenterPage />} />
          <Route path="/lead-workbench" element={<LeadWorkbenchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/ai" element={<AISettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
