import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Users, Settings, BriefcaseBusiness, Sparkles, ListChecks } from 'lucide-react';
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
import type { Customer } from './lib/types';
import { listCustomers } from './lib/db';
import './App.css';

function isSalesAgentPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/ai-workspace';
}

export default function App() {
  const location = useLocation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);

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
    }
  }, [refreshAll]);

  const navItems = [
    { to: '/ai-workspace', icon: Sparkles, label: 'Sales Agent', match: 'agent' as const },
    { to: '/battle-review', icon: ListChecks, label: '今日复盘', match: 'exact' as const },
    { to: '/customers', icon: Users, label: '客户', match: 'exact' as const },
    { to: '/lead-workbench', icon: BriefcaseBusiness, label: '获客作业台', match: 'exact' as const },
    { to: '/settings', icon: Settings, label: '设置', match: 'settings' as const },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-header">
          <h1>销售 CRM</h1>
          <span>AI 原生销售工作台</span>
        </div>
        <nav className="sidebar-nav" aria-label="一级导航">
          {navItems.map(item => {
            const active =
              item.match === 'agent'
                ? isSalesAgentPath(location.pathname)
                : item.match === 'settings'
                  ? location.pathname.startsWith('/settings')
                  : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.match === 'exact'}
                className={`nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-account" aria-label="本地工作区">
          <span className="sidebar-avatar" aria-hidden="true">本</span>
          <span>
            <strong>本地工作区</strong>
            <small>安全 · 仅本机</small>
          </span>
        </div>
      </aside>

      <main className="main-content">
        {dbError && (
          <div className="app-db-error" role="alert">
            数据库初始化失败，请勿录入真实数据。错误: {dbError}
          </div>
        )}
        <Routes>
          <Route path="/" element={<AINativeCRMWorkspace />} />
          <Route path="/customers" element={<CustomerList customers={customers} onRefresh={refreshAll} />} />
          <Route path="/customers/:id" element={<CustomerDetail onRefresh={refreshAll} />} />
          <Route path="/customers/:id/battle-card" element={<CustomerBattleCardPage />} />
          <Route path="/battle-review" element={<DailyBattleReviewPage />} />
          <Route path="/follow-ups" element={<FollowUpRecords />} />
          <Route path="/visits" element={<VisitRecords />} />
          <Route path="/ai-workspace" element={<AINativeCRMWorkspace />} />
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
