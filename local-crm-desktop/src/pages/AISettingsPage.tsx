import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Shield, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import {
  configureTrustedHostCredential,
  deleteLegacyProviderCredentials,
  deleteTrustedHostCredential,
  inspectLegacyProviderCredentials,
  listTrustedHostProviderStatus,
  migrateLegacyProviderCredentials,
  testTrustedHostProviderConnection,
  type LegacyCredentialMigrationStatus,
  type TrustedHostProviderHealth,
} from '../lib/modelCapabilities/trustedHost';
import type { ModelCapability } from '../lib/modelCapabilities/types';

type ProviderDefinition = {
  capability: ModelCapability;
  title: string;
  description: string;
  defaults: { provider: string; endpoint: string; model: string };
};

type ProviderDraft = { provider: string; endpoint: string; model: string; apiKey: string };

const PROVIDERS: readonly ProviderDefinition[] = [
  { capability: 'TEXT_REASONING', title: '文本模型', description: '客户总结、风险、下一步与文案', defaults: { provider: 'deepseek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } },
  { capability: 'VISION_ANALYSIS', title: '多模态模型', description: '用户显式点击 Analyze 后进行图片事实提取', defaults: { provider: 'qwen', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' } },
];

function initialDrafts(): Record<ModelCapability, ProviderDraft> {
  return Object.fromEntries(PROVIDERS.map(item => [item.capability, { ...item.defaults, apiKey: '' }])) as Record<ModelCapability, ProviderDraft>;
}

function statusLabel(status?: TrustedHostProviderHealth): string {
  if (!status?.configured) return '未配置';
  const map: Record<string, string> = { CONFIGURED: '已配置', configured: '已配置', healthy: '健康', unauthorized: '无效凭据', rate_limited: '频率限制', timeout: '超时', unavailable: '服务不可用' };
  return map[status.status] ?? '已配置';
}

export default function AISettingsPage() {
  const [statuses, setStatuses] = useState<readonly TrustedHostProviderHealth[]>([]);
  const [drafts, setDrafts] = useState<Record<ModelCapability, ProviderDraft>>(initialDrafts);
  const [legacy, setLegacy] = useState<LegacyCredentialMigrationStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [providerStatuses, migration] = await Promise.all([listTrustedHostProviderStatus(), inspectLegacyProviderCredentials()]);
      setStatuses(providerStatuses);
      setLegacy(migration);
      setDrafts(current => {
        const next = { ...current };
        for (const status of providerStatuses) {
          const capability = status.capability as ModelCapability;
          if (!next[capability]) continue;
          next[capability] = {
            provider: status.provider || next[capability].provider,
            endpoint: status.endpoint || next[capability].endpoint,
            model: status.modelId || next[capability].model,
            apiKey: '',
          };
        }
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取 Trusted Host 状态');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateDraft = (capability: ModelCapability, field: keyof ProviderDraft, value: string) => {
    setDrafts(current => ({ ...current, [capability]: { ...current[capability], [field]: value } }));
  };

  const saveAndTest = async (provider: ProviderDefinition) => {
    const key = `save-${provider.capability}`;
    const draft = drafts[provider.capability];
    if (!draft.apiKey) { setMessage('请输入新的模型 API Key。'); return; }
    setBusy(key); setMessage('');
    try {
      await configureTrustedHostCredential({ capability: provider.capability, provider: draft.provider, endpoint: draft.endpoint, model: draft.model, apiKey: draft.apiKey });
      setDrafts(current => ({ ...current, [provider.capability]: { ...current[provider.capability], apiKey: '' } }));
      await testTrustedHostProviderConnection(provider.capability);
      setMessage('配置已由 Rust 使用 DPAPI 加密保存，显式连接检查完成。');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存或连接检查失败');
    } finally {
      setDrafts(current => ({ ...current, [provider.capability]: { ...current[provider.capability], apiKey: '' } }));
      setBusy('');
    }
  };

  const remove = async (capability: ModelCapability) => {
    setBusy(`delete-${capability}`); setMessage('');
    try { await deleteTrustedHostCredential(capability); setMessage('本地加密配置已删除。'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除失败'); }
    finally { setBusy(''); }
  };

  return (
    <div className="product-page">
      <div className="page-header"><h2>AI 设置</h2></div>
      <div className="page-body">
        <section className="card" data-testid="trusted-host-settings">
          <h3 className="section-title"><Shield size={16} /> 本地加密模型配置</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>API Key 由 Rust 使用 Windows DPAPI Current User Scope 加密后写入本地 SQLite。页面不回显旧 Key，也不会把 Key 保存到浏览器存储。</p>
          <div style={{ display: 'grid', gap: 14 }}>
            {PROVIDERS.map(provider => {
              const status = statuses.find(item => item.capability === provider.capability);
              const draft = drafts[provider.capability];
              return (
                <article className="glass-card" key={provider.capability} data-testid={`provider-${provider.capability.toLowerCase()}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div><strong>{provider.title}</strong><p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>{provider.description}</p></div>
                    <span className={`status-pill ${status?.status === 'healthy' ? 'ok' : status?.configured ? 'info' : 'warn'}`}>{statusLabel(status)}</span>
                  </div>
                  <label>Provider<input value={draft.provider} onChange={event => updateDraft(provider.capability, 'provider', event.target.value)} autoComplete="off" /></label>
                  <label>Endpoint<input value={draft.endpoint} onChange={event => updateDraft(provider.capability, 'endpoint', event.target.value)} autoComplete="off" /></label>
                  <label>Model<input value={draft.model} onChange={event => updateDraft(provider.capability, 'model', event.target.value)} autoComplete="off" /></label>
                  <label>API Key<input type="password" name={`model-api-key-${provider.capability.toLowerCase()}`} value={draft.apiKey} placeholder={status?.configured ? '已配置；修改时重新输入' : '输入模型 API Key'} onChange={event => updateDraft(provider.capability, 'apiKey', event.target.value)} autoComplete="new-password" spellCheck={false} /></label>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>这是模型 API Key，不是 CRM 登录账号。</p>
                  <p style={{ fontSize: 13 }}>最近检查：{status?.checkedAt ?? '—'} · {status?.detail ?? '尚未检查'}</p>
                  <div className="btn-group">
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => void saveAndTest(provider)}>{busy === `save-${provider.capability}` ? <RefreshCw size={14} /> : null}保存并测试</button>
                    <button className="btn btn-danger" disabled={!!busy || !status?.configured} onClick={() => void remove(provider.capability)}><Trash2 size={14} />删除配置</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {legacy?.detected && (
          <section className="card" role="alert" style={{ marginTop: 20 }} data-testid="legacy-credential-warning">
            <h3 className="section-title"><TriangleAlert size={16} /> 检测到旧 Windows 凭据</h3>
            <p>迁移会由 Rust 读取旧凭据并写入 DPAPI 加密 SQLite；不会自动删除 Credential Manager 中的旧凭据。</p>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void (async () => { setBusy('migrate'); try { await migrateLegacyProviderCredentials(); setMessage('旧凭据已迁移；旧 Credential Manager 凭据仍保留。'); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : '迁移失败'); } finally { setBusy(''); } })()}>迁移到本地加密配置</button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => void (async () => { if (!window.confirm('确认删除旧 Windows Credential Manager 凭据？本地 DPAPI 加密配置不会被删除。')) return; setBusy('delete-legacy'); try { await deleteLegacyProviderCredentials(); setMessage('旧 Windows 凭据已按用户确认删除。'); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : '删除旧凭据失败'); } finally { setBusy(''); } })()}>单独确认删除旧凭据</button>
          </section>
        )}

        {message && <div role="status" style={{ marginTop: 16, display: 'flex', gap: 8 }}>{/失败|错误|无法/.test(message) ? <XCircle size={16} color="#dc2626" /> : <CheckCircle2 size={16} color="#059669" />}{message}</div>}
      </div>
    </div>
  );
}
