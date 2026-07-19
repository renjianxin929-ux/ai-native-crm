import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, RefreshCw, Shield, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import {
  configureTrustedHostCredential,
  deleteTrustedHostCredential,
  inspectLegacyProviderCredentials,
  listTrustedHostProviderStatus,
  migrateLegacyProviderCredentials,
  probeTrustedHostProviderHealth,
  testTrustedHostProviderConnection,
  type LegacyCredentialMigrationStatus,
  type TrustedHostProviderHealth,
} from '../lib/modelCapabilities/trustedHost';
import type { ModelCapability, ModelProviderKind } from '../lib/modelCapabilities/types';

type ProviderDefinition = {
  capability: ModelCapability;
  providerKind: ModelProviderKind;
  title: string;
  description: string;
};

const PROVIDERS: readonly ProviderDefinition[] = [
  { capability: 'TEXT_REASONING', providerKind: 'DEEPSEEK_COMPATIBLE', title: '文本 Provider', description: '客户总结、风险、下一步与跟进文案' },
  { capability: 'VISION_ANALYSIS', providerKind: 'QWEN_VISION_COMPATIBLE', title: '多模态 Provider', description: '图片事实提取与人工 Fact Review' },
];

function statusLabel(status?: TrustedHostProviderHealth): string {
  if (!status?.configured) return '未配置';
  const map: Record<string, string> = {
    configured: '已配置', healthy: '健康', unauthorized: '无效凭据', rate_limited: '频率限制',
    timeout: '超时', unavailable: '服务不可用', unhealthy: '服务不可用',
  };
  return map[status.status] ?? '已配置';
}

export default function AISettingsPage() {
  const [statuses, setStatuses] = useState<readonly TrustedHostProviderHealth[]>([]);
  const [legacy, setLegacy] = useState<LegacyCredentialMigrationStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [providerStatuses, migration] = await Promise.all([
        listTrustedHostProviderStatus(),
        inspectLegacyProviderCredentials(),
      ]);
      setStatuses(providerStatuses);
      setLegacy(migration);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取 Trusted Host 状态');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setMessage('');
    try { await action(); setMessage(success); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(''); }
  };

  return (
    <div className="product-page">
      <div className="page-header"><h2>AI 设置</h2></div>
      <div className="page-body">
        <section className="card" data-testid="trusted-host-settings">
          <h3 className="section-title"><Shield size={16} /> Trusted Host 安全配置</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            凭据保存在 Windows Credential Manager。输入、读取、更新和删除均由 Rust Host 完成；React 与 SQLite 不接收完整凭据。
          </p>
          <div style={{ display: 'grid', gap: 14 }}>
            {PROVIDERS.map(provider => {
              const status = statuses.find(item => item.capability === provider.capability);
              const key = provider.capability;
              return (
                <article className="glass-card" key={key} data-testid={`provider-${key.toLowerCase()}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
                    <div><strong>{provider.title}</strong><p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>{provider.description}</p></div>
                    <span className={`status-pill ${status?.status === 'healthy' ? 'ok' : status?.configured ? 'info' : 'warn'}`}>{statusLabel(status)}</span>
                  </div>
                  <p style={{ fontSize: 13 }}>Provider：{status?.providerKind ?? provider.providerKind} · Model：{status?.modelId ?? '—'}</p>
                  <p style={{ fontSize: 13 }}>最近检查：{status?.checkedAt ?? '—'} · {status?.detail ?? '尚未检查'}</p>
                  <div className="btn-group">
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => void run(`configure-${key}`, () => configureTrustedHostCredential(provider.capability), '凭据已安全保存')}>
                      {busy === `configure-${key}` ? <RefreshCw size={14} /> : <KeyRound size={14} />}配置或更新凭据
                    </button>
                    <button className="btn" disabled={!!busy} onClick={() => void run(`check-${key}`, () => probeTrustedHostProviderHealth({ capability: provider.capability, providerKind: provider.providerKind }), '配置检查完成')}>
                      配置检查
                    </button>
                    <button className="btn" disabled={!!busy || !status?.configured} onClick={() => void run(`test-${key}`, () => testTrustedHostProviderConnection(provider.capability), '连接测试完成')}>
                      测试连接
                    </button>
                    <button className="btn btn-danger" disabled={!!busy || !status?.configured} onClick={() => void run(`delete-${key}`, () => deleteTrustedHostCredential(provider.capability), '凭据已删除')}>
                      <Trash2 size={14} />删除凭据
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {legacy?.detected && legacy.state !== 'migrated' && (
          <section className="card" role="alert" style={{ marginTop: 20 }} data-testid="legacy-credential-warning">
            <h3 className="section-title"><TriangleAlert size={16} /> 检测到旧版不安全凭据</h3>
            <p>仅显示检测状态，不会将旧凭据返回页面。迁移会先写入安全存储并验证，再事务性清除 SQLite 明文；失败时回滚。</p>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void run('migrate', migrateLegacyProviderCredentials, '旧版凭据已安全迁移')}>
              安全迁移
            </button>
          </section>
        )}

        {message && (
          <div role="status" style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            {/失败|错误|无法/.test(message) ? <XCircle size={16} color="#dc2626" /> : <CheckCircle2 size={16} color="#059669" />}{message}
          </div>
        )}

        <section className="card" style={{ marginTop: 20 }}>
          <h3 className="section-title">运行边界</h3>
          <ul style={{ lineHeight: 1.8 }}>
            <li>配置检查只读取安全存储状态，不发网络请求。</li>
            <li>连接测试仅在用户明确点击后发送最小请求，不含 CRM 数据、不写 CRM。</li>
            <li>所有正式模型调用：React → Tauri Invoke → Rust Trusted Host → Provider。</li>
            <li>模型结果必须通过封闭 Schema 与 Evidence ownership 校验；写入仍需 Proposal 和人工确认。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
