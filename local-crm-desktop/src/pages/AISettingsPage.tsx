import { useState, useEffect } from 'react';
import { Brain, CheckCircle2, XCircle, RefreshCw, Cpu, Image } from 'lucide-react';
import { getDefaultDeepSeekConfig, testTextAIConnection } from '../lib/textAIProvider';
import { getDefaultQwenMultimodalConfig, testMultimodalConnection } from '../lib/multimodalProvider';
import type { TextAIConfig, MultimodalConfig } from '../lib/types';

// 持久化逻辑（复用 settings 表 key-value 模式）
import { getDb } from '../lib/db';

async function loadTextConfig(): Promise<TextAIConfig> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['text_ai_config']);
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      return { ...getDefaultDeepSeekConfig(), ...parsed };
    }
  } catch { /* 返回默认值 */ }
  return getDefaultDeepSeekConfig();
}

async function saveTextConfig(config: TextAIConfig): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    ['text_ai_config', JSON.stringify(config), new Date().toISOString()],
  );
}

async function loadMultimodalConfig(): Promise<MultimodalConfig> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['multimodal_config']);
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      return { ...getDefaultQwenMultimodalConfig(), ...parsed, capabilities: { ...getDefaultQwenMultimodalConfig().capabilities, ...(parsed.capabilities || {}) } };
    }
  } catch { /* 返回默认值 */ }
  return getDefaultQwenMultimodalConfig();
}

async function saveMultimodalConfig(config: MultimodalConfig): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    ['multimodal_config', JSON.stringify(config), new Date().toISOString()],
  );
}

export default function AISettingsPage() {
  const [textConfig, setTextConfig] = useState<TextAIConfig>(getDefaultDeepSeekConfig());
  const [multiConfig, setMultiConfig] = useState<MultimodalConfig>(getDefaultQwenMultimodalConfig());
  const [loaded, setLoaded] = useState(false);

  const [saving, setSaving] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  const [testing, setTesting] = useState('');
  const [testTextResult, setTestTextResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testMultiResult, setTestMultiResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    Promise.all([loadTextConfig(), loadMultimodalConfig()]).then(([tc, mc]) => {
      setTextConfig(tc);
      setMultiConfig(mc);
      setLoaded(true);
    });
  }, []);

  const handleSaveText = async () => {
    setSaving('text');
    setSaveMsg('');
    try {
      await saveTextConfig(textConfig);
      setSaveMsg('DeepSeek 配置已保存');
    } catch (e) {
      setSaveMsg(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving('');
  };

  const handleSaveMulti = async () => {
    setSaving('multi');
    setSaveMsg('');
    try {
      await saveMultimodalConfig(multiConfig);
      setSaveMsg('Qwen 配置已保存');
    } catch (e) {
      setSaveMsg(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving('');
  };

  const handleTestText = async () => {
    setTesting('text');
    setTestTextResult(null);
    const result = await testTextAIConnection(textConfig);
    setTestTextResult(result);
    setTesting('');
  };

  const handleTestMulti = async () => {
    setTesting('multi');
    setTestMultiResult(null);
    const result = await testMultimodalConnection(multiConfig);
    setTestMultiResult(result);
    setTesting('');
  };

  if (!loaded) return null;

  return (
    <div>
      <div className="page-header">
        <h2>AI 设置</h2>
      </div>

      <div className="page-body">
        {/* DeepSeek 文本配置 */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">
            <Cpu size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            DeepSeek · 文本分析
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            负责通话文本分析、微信文本分析、跟进建议、每日总结等所有纯文本能力
          </p>

          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label>Base URL</label>
              <input
                value={textConfig.baseUrl}
                onChange={e => setTextConfig({ ...textConfig, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
            </div>
            <div className="form-group">
              <label>Model</label>
              <input
                value={textConfig.model}
                onChange={e => setTextConfig({ ...textConfig, model: e.target.value })}
                placeholder="deepseek-chat"
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>API Key</label>
            <input
              type="password"
              value={textConfig.apiKey}
              onChange={e => setTextConfig({ ...textConfig, apiKey: e.target.value })}
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>

          <div className="btn-group">
            <button className="btn btn-secondary" onClick={handleTestText} disabled={testing === 'text' || !textConfig.apiKey}>
              {testing === 'text' ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}
              测试连接
            </button>
            <button className="btn btn-primary" onClick={handleSaveText} disabled={saving === 'text'}>
              {saving === 'text' ? '保存中...' : '保存 DeepSeek 配置'}
            </button>
          </div>

          {testTextResult && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: testTextResult.ok ? '#059669' : '#dc2626', paddingTop: 12,
            }}>
              {testTextResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span style={{ fontSize: 14, fontWeight: 500 }}>{testTextResult.message}</span>
            </div>
          )}
        </div>

        {/* Qwen 多模态配置 */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">
            <Image size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Qwen · 多模态识别
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            负责截图识别、微信截图结构化提取等图片/多模态能力（阿里云 DashScope）
          </p>

          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label>Base URL</label>
              <input
                value={multiConfig.baseUrl}
                onChange={e => setMultiConfig({ ...multiConfig, baseUrl: e.target.value })}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              />
            </div>
            <div className="form-group">
              <label>Vision Model</label>
              <input
                value={multiConfig.visionModel}
                onChange={e => setMultiConfig({ ...multiConfig, visionModel: e.target.value })}
                placeholder="qwen-vl-max"
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>API Key</label>
            <input
              type="password"
              value={multiConfig.apiKey}
              onChange={e => setMultiConfig({ ...multiConfig, apiKey: e.target.value })}
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>能力开关</label>
            <div style={{ display: 'flex', gap: 16, paddingTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text)' }}>
                <input type="checkbox" checked disabled /> 文本
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={multiConfig.capabilities.image}
                  onChange={e => setMultiConfig({
                    ...multiConfig,
                    capabilities: { ...multiConfig.capabilities, image: e.target.checked },
                  })}
                /> 图片
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={multiConfig.capabilities.audio}
                  onChange={e => setMultiConfig({
                    ...multiConfig,
                    capabilities: { ...multiConfig.capabilities, audio: e.target.checked },
                  })}
                /> 音频（待接入）
              </label>
            </div>
          </div>

          <div className="btn-group">
            <button className="btn btn-secondary" onClick={handleTestMulti} disabled={testing === 'multi' || !multiConfig.apiKey}>
              {testing === 'multi' ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}
              测试连接
            </button>
            <button className="btn btn-primary" onClick={handleSaveMulti} disabled={saving === 'multi'}>
              {saving === 'multi' ? '保存中...' : '保存 Qwen 配置'}
            </button>
          </div>

          {testMultiResult && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: testMultiResult.ok ? '#059669' : '#dc2626', paddingTop: 12,
            }}>
              {testMultiResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span style={{ fontSize: 14, fontWeight: 500 }}>{testMultiResult.message}</span>
            </div>
          )}
        </div>

        {/* 保存消息 */}
        {saveMsg && (
          <div style={{
            padding: '12px 16px', borderRadius: 8, fontSize: 14,
            background: saveMsg.includes('失败') ? '#fef2f2' : '#f0fdf4',
            color: saveMsg.includes('失败') ? '#dc2626' : '#16a34a',
          }}>
            {saveMsg}
          </div>
        )}

        {/* AI 说明 */}
        <div className="card" style={{ marginTop: 20 }}>
          <h3 className="section-title">
            <Brain size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            v0.4.0 AI 功能
          </h3>
          <ul style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8, paddingLeft: 20 }}>
            <li><strong>DeepSeek</strong>：负责所有纯文本分析——通话文本、微信文本、跟进建议、每日总结</li>
            <li><strong>Qwen</strong>：负责多模态识别——截图识别、微信截图结构化提取（图片能力可关闭）</li>
            <li>所有 AI 结果首先生成草稿，用户确认后才写入客户/跟进记录</li>
            <li>API Key 仅存储在本地 SQLite 数据库，不上传任何服务器</li>
            <li>AI 只能建议客户等级，不能自动修改为 A（需要人工确认）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
