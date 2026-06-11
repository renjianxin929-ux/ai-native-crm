import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, MessageSquare, MapPin,
  Settings, Upload, Brain
} from 'lucide-react';
import TodayView from './pages/TodayView';
import CustomerList from './pages/CustomerList';
import CustomerDetail from './pages/CustomerDetail';
import FollowUpRecords from './pages/FollowUpRecords';
import VisitRecords from './pages/VisitRecords';
import SettingsPage from './pages/SettingsPage';
import DataImportPage from './pages/DataImportPage';
import AISettingsPage from './pages/AISettingsPage';
import AIAssistantPage from './pages/AIAssistantPage';
import type { Customer, Task } from './lib/types';
import { listCustomers, listTasks } from './lib/db';
import './App.css';

export default function App() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [customerList, taskList] = await Promise.all([
        listCustomers(),
        listTasks(),
      ]);
      setCustomers(customerList);
      setTasks(taskList);
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
    { to: '/', icon: LayoutDashboard, label: '今日跟进' },
    { to: '/customers', icon: Users, label: '客户' },
    { to: '/follow-ups', icon: MessageSquare, label: '跟进记录' },
    { to: '/visits', icon: MapPin, label: '面访记录' },
    { to: '/assistant', icon: Brain, label: 'AI助手' },
    { to: '/import', icon: Upload, label: '数据导入' },
    { to: '/settings', icon: Settings, label: '设置' },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>销售CRM</h1>
          <span>个人版</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        {dbError && (
          <div style={{
            background: '#fef2f2', color: '#dc2626', padding: '12px 24px',
            borderBottom: '1px solid #fecaca', fontSize: 14, fontWeight: 500,
          }}>
            数据库初始化失败，请勿录入真实数据。错误: {dbError}
          </div>
        )}
        <Routes>
          <Route path="/" element={<TodayView customers={customers} tasks={tasks} onRefresh={refreshAll} />} />
          <Route path="/customers" element={<CustomerList customers={customers} onRefresh={refreshAll} />} />
          <Route path="/customers/:id" element={<CustomerDetail onRefresh={refreshAll} />} />
          <Route path="/follow-ups" element={<FollowUpRecords />} />
          <Route path="/visits" element={<VisitRecords />} />
          <Route path="/assistant" element={<AIAssistantPage />} />
          <Route path="/import" element={<DataImportPage customers={customers} onRefresh={refreshAll} />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/ai" element={<AISettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
