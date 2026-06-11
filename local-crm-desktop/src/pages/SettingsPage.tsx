import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, FolderOpen, Brain, ArrowRight, Upload, AlertTriangle } from 'lucide-react';
import { getDbPath } from '../lib/db';
import { APP_VERSION } from '../lib/version';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');
  const [dbPath, setDbPath] = useState<string>('');
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getDbPath().then(setDbPath).catch(() => setMsg('无法获取数据库路径'));
  }, []);

  const handleBackup = async () => {
    try {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const customers = await db.select('SELECT * FROM customers');
      const followUps = await db.select('SELECT * FROM follow_up_records');
      const visits = await db.select('SELECT * FROM visit_records');
      const tasks = await db.select('SELECT * FROM tasks');

      const now = new Date().toISOString();
      const backup = JSON.stringify({
        version: APP_VERSION,
        exported_at: now,
        counts: {
          customers: customers.length,
          follow_up_records: followUps.length,
          visit_records: visits.length,
          tasks: tasks.length,
        },
        customers,
        followUps,
        visits,
        tasks,
      }, null, 2);

      const blob = new Blob([backup], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = now.replace(/[:.]/g, '-');
      a.href = url;
      a.download = `crm-backup-v${APP_VERSION}-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`备份成功！已导出 ${customers.length} 个客户、${followUps.length} 条跟进记录、${visits.length} 条面访记录、${tasks.length} 个任务`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMsg(`备份失败: ${errMsg}`);
    }
  };

  const handleRestoreSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFile(file);
    setRestoreWarning(true);
    e.target.value = '';
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile) return;
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);

      if (!backup.version || !backup.customers) {
        setMsg('恢复失败: 无效的备份文件格式');
        setRestoreWarning(false);
        return;
      }

      const confirmed = confirm(
        `⚠️ 即将恢复备份数据:\n` +
        `- 备份版本: ${backup.version}\n` +
        `- 导出时间: ${backup.exported_at || '未知'}\n` +
        `- 客户: ${backup.counts?.customers || backup.customers.length} 条\n` +
        `- 跟进记录: ${backup.counts?.follow_up_records || (backup.followUps?.length || 0)} 条\n\n` +
        `恢复操作将覆盖当前数据库中的同名数据，是否继续？`
      );

      if (!confirmed) {
        setRestoreWarning(false);
        return;
      }

      const { getDb } = await import('../lib/db');
      const db = await getDb();

      for (const c of backup.customers) {
        await db.execute(
          `INSERT OR REPLACE INTO customers (id, name, customer_grade, stage, contact_method, wechat_id,
           phone_number, wechat_search_status, is_key_decision_maker, wechat_add_status, has_replied,
           intent_level, phone_feedback, can_schedule_visit, visit_scheduled_at,
           rough_visit_time_text, parsed_visit_reminder_at, time_parse_status,
           time_parse_note, next_follow_up_at, last_contacted_at, last_feedback_type,
           next_action, no_show_count, lost_reason, payment_status, deal_amount,
           paid_at, closed_at, website, region, industry,
           contact_person, email, address, pitch_angle, qualification_reason, source,
           notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.id, c.name, c.customer_grade, c.stage, c.contact_method, c.wechat_id,
           c.phone_number, c.wechat_search_status, c.is_key_decision_maker, c.wechat_add_status, c.has_replied,
           c.intent_level, c.phone_feedback, c.can_schedule_visit, c.visit_scheduled_at,
           c.rough_visit_time_text, c.parsed_visit_reminder_at, c.time_parse_status,
           c.time_parse_note, c.next_follow_up_at, c.last_contacted_at, c.last_feedback_type,
           c.next_action, c.no_show_count, c.lost_reason, c.payment_status, c.deal_amount,
           c.paid_at, c.closed_at, c.website, c.region, c.industry,
           c.contact_person, c.email, c.address, c.pitch_angle, c.qualification_reason, c.source,
           c.notes, c.created_at, c.updated_at],
        );
      }

      if (backup.followUps) {
        for (const f of backup.followUps) {
          await db.execute(
            `INSERT OR REPLACE INTO follow_up_records (id, customer_id, title, contact_channel,
             contact_result, feedback_notes, intent_assessment, suggested_grade, next_action,
             next_follow_up_at, is_completed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [f.id, f.customer_id, f.title, f.contact_channel,
             f.contact_result, f.feedback_notes, f.intent_assessment, f.suggested_grade, f.next_action,
             f.next_follow_up_at, f.is_completed, f.created_at, f.updated_at],
          );
        }
      }

      if (backup.visits) {
        for (const v of backup.visits) {
          await db.execute(
            `INSERT OR REPLACE INTO visit_records (id, customer_id, title, visited_at, visit_notes,
             customer_concerns, intent_after_visit, visit_outcome, next_action,
             expected_contract_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.id, v.customer_id, v.title, v.visited_at, v.visit_notes,
             v.customer_concerns, v.intent_after_visit, v.visit_outcome, v.next_action,
             v.expected_contract_at, v.created_at, v.updated_at],
          );
        }
      }

      setMsg(`恢复成功! 已恢复 ${backup.customers.length} 个客户及相关记录。请刷新页面查看。`);
    } catch (e) {
      setMsg(`恢复失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRestoreWarning(false);
    setRestoreFile(null);
  };

  return (
    <div>
      <div className="page-header">
        <h2>设置</h2>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">数据库</h3>
          <div style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
            <p style={{ marginBottom: 8 }}>数据存储在本地 SQLite 数据库中</p>
            {dbPath ? (
              <p style={{
                fontSize: 13, fontFamily: 'monospace', background: 'var(--bg-secondary)',
                padding: '6px 10px', borderRadius: 4, wordBreak: 'break-all',
              }}>
                <FolderOpen size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {dbPath}
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>正在获取数据库路径...</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleBackup}>
              <Database size={16} /> 导出备份
            </button>
            <button className="btn" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} /> 恢复备份
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleRestoreSelect}
            />
          </div>
          {msg && (
            <p style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 4, fontSize: 14,
              background: msg.includes('失败') ? '#fef2f2' : '#f0fdf4',
              color: msg.includes('失败') ? '#dc2626' : '#16a34a',
            }}>
              {msg}
            </p>
          )}
        </div>

        {restoreWarning && restoreFile && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}>
            <div className="card" style={{ maxWidth: 480, width: '90%' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', marginBottom: 16 }}>
                <AlertTriangle size={20} /> 确认恢复备份
              </h3>
              <p style={{ marginBottom: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
                即将从备份文件 <strong>{restoreFile.name}</strong> 恢复数据。
                恢复操作将覆盖当前数据库中的同名数据。
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => { setRestoreWarning(false); setRestoreFile(null); }}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={handleRestoreConfirm}>
                  确认恢复
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">关于</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            销售CRM 个人版 v{APP_VERSION}<br />
            本地桌面CRM，数据完全存储在本机
          </p>
        </div>

        <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/settings/ai')}>
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><Brain size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} /> AI 设置</span>
            <ArrowRight size={16} style={{ color: '#9ca3af' }} />
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            配置 AI 服务商和 API Key，启用智能分析、总结和建议功能。
          </p>
        </div>
      </div>
    </div>
  );
}
