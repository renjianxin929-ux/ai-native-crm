import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Image, FileText, Mic, Upload, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Save, User } from 'lucide-react';
import { getDb, getCustomer } from '../lib/db';
import { getDefaultDeepSeekConfig } from '../lib/textAIProvider';
import { getDefaultQwenMultimodalConfig } from '../lib/multimodalProvider';
import {
  analyzeWechatScreenshot,
  analyzeCallTranscript,
  createDraftFromCallAnalysis,
  createDraftFromScreenshotAnalysis,
  imageFileToBase64,
} from '../lib/aiDraft';
import { createAIDraft } from '../lib/db';
import type { TextAIConfig, MultimodalConfig, ScreenshotAnalysis, CallAnalysis, Customer, AIDraftInput } from '../lib/types';

async function loadTextConfig(): Promise<TextAIConfig> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['text_ai_config']);
    if (rows.length > 0) return { ...getDefaultDeepSeekConfig(), ...JSON.parse(rows[0].value) };
  } catch { /* 返回默认 */ }
  return getDefaultDeepSeekConfig();
}

async function loadMultiConfig(): Promise<MultimodalConfig> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['multimodal_config']);
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      return { ...getDefaultQwenMultimodalConfig(), ...parsed, capabilities: { ...getDefaultQwenMultimodalConfig().capabilities, ...(parsed.capabilities || {}) } };
    }
  } catch { /* 返回默认 */ }
  return getDefaultQwenMultimodalConfig();
}

type TabType = 'screenshot' | 'call' | 'audio';

const TABS: { key: TabType; label: string; icon: typeof Image; disabled?: boolean }[] = [
  { key: 'screenshot', label: '截图识别', icon: Image },
  { key: 'call', label: '通话文本分析', icon: FileText },
  { key: 'audio', label: '音频识别', icon: Mic, disabled: true },
];

function requireLinkedCustomerId(customer: Customer | null): string {
  if (!customer?.id) {
    throw new Error('请先从客户详情页进入 AI 助手，确保草稿关联当前客户。');
  }
  return customer.id;
}

export function buildScreenshotDraftInputForLinkedCustomer(
  result: ScreenshotAnalysis,
  customer: Customer | null,
): AIDraftInput {
  return createDraftFromScreenshotAnalysis(result, requireLinkedCustomerId(customer));
}

export function buildCallDraftInputForLinkedCustomer(
  result: CallAnalysis,
  customer: Customer | null,
): AIDraftInput {
  return createDraftFromCallAnalysis(result, requireLinkedCustomerId(customer));
}

export default function AIAssistantPage() {
  const [searchParams] = useSearchParams();
  const customerId = searchParams.get('customer_id');

  const [activeTab, setActiveTab] = useState<TabType>('screenshot');
  const [textConfig, setTextConfig] = useState<TextAIConfig | null>(null);
  const [multiConfig, setMultiConfig] = useState<MultimodalConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null);
  const [customerLoadError, setCustomerLoadError] = useState('');

  // 截图状态
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotResult, setScreenshotResult] = useState<ScreenshotAnalysis | null>(null);
  const [screenshotError, setScreenshotError] = useState('');
  const [screenshotSaved, setScreenshotSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 通话文本状态
  const [callText, setCallText] = useState('');
  const [callAnalyzing, setCallAnalyzing] = useState(false);
  const [callResult, setCallResult] = useState<CallAnalysis | null>(null);
  const [callError, setCallError] = useState('');
  const [callSaved, setCallSaved] = useState(false);

  useEffect(() => {
    Promise.all([loadMultiConfig(), loadTextConfig()]).then(([mc, tc]) => {
      setMultiConfig(mc);
      setTextConfig(tc);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (customerId) {
      getCustomer(customerId).then(c => {
        if (c) {
          setLinkedCustomer(c);
        } else {
          setCustomerLoadError('关联客户不存在或已删除');
        }
      }).catch(() => {
        setCustomerLoadError('加载关联客户失败');
      });
    }
  }, [customerId]);

  const handleFileSelect = async (file: File) => {
    setImageFile(file);
    setScreenshotResult(null);
    setScreenshotError('');
    setScreenshotSaved(false);

    // 预览
    const url = URL.createObjectURL(file);
    setImagePreview(url);

    // 转 base64
    try {
      const b64 = await imageFileToBase64(file);
      setImageBase64(b64);
    } catch {
      setScreenshotError('图片读取失败');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file);
    }
  };

  const handleAnalyzeScreenshot = async () => {
    if (!multiConfig || !imageBase64 || !imageFile) return;
    setScreenshotAnalyzing(true);
    setScreenshotError('');
    setScreenshotResult(null);

    const { analysis, error } = await analyzeWechatScreenshot(
      multiConfig,
      imageBase64,
      imageFile.type,
    );

    if (error) {
      setScreenshotError(error);
    } else {
      setScreenshotResult(analysis);
    }
    setScreenshotAnalyzing(false);
  };

  const handleSaveScreenshotDraft = async () => {
    if (!screenshotResult) return;
    try {
      await createAIDraft({
        source_type: 'SCREENSHOT',
        customer_id: requireLinkedCustomerId(linkedCustomer),
        raw_input_summary: `截图识别: ${screenshotResult.customer_name || '未识别客户名'}`,
        ai_result_json: JSON.stringify(screenshotResult),
        confidence: screenshotResult.confidence,
      });
      setScreenshotSaved(true);
    } catch (e) {
      setScreenshotError(`保存草稿失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleAnalyzeCall = async () => {
    if (!textConfig || !callText.trim()) return;
    setCallAnalyzing(true);
    setCallError('');
    setCallResult(null);

    const { analysis, error } = await analyzeCallTranscript(textConfig, callText);

    if (error) {
      setCallError(error);
    } else {
      setCallResult(analysis);
    }
    setCallAnalyzing(false);
  };

  const handleSaveCallDraft = async () => {
    if (!callResult) return;
    try {
      await createAIDraft({
        source_type: 'CALL_TEXT',
        customer_id: requireLinkedCustomerId(linkedCustomer),
        raw_input_summary: `通话文本分析: ${callResult.summary.slice(0, 100)}`,
        ai_result_json: JSON.stringify(callResult),
        confidence: callResult.confidence,
      });
      setCallSaved(true);
    } catch (e) {
      setCallError(`保存草稿失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confidenceColor = (c: number) => (c >= 0.65 ? '#059669' : '#d97706');
  const confidenceBg = (c: number) => (c >= 0.65 ? '#ecfdf5' : '#fffbeb');

  if (!loaded) return null;

  return (
    <div>
      <div className="page-header">
        <h2>Legacy AI Capture Tools</h2>
      </div>

      <div className="page-body">
        <div className="card" style={{ marginTop: 20 }}>
          <h3 className="section-title">Legacy capture analysis</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>这是旧版截图和通话文本工具。Sales Agent 从客户详情页的主入口发起；此页面不代表自主 Agent。</p>
        </div>
        {/* 关联客户提示 */}
        {linkedCustomer && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 8,
            background: '#eff6ff', color: '#2563eb', fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <User size={16} />
            <span>当前关联客户：<strong>{linkedCustomer.name}</strong></span>
          </div>
        )}
        {customerLoadError && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 8,
            background: '#fef2f2', color: '#dc2626', fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={16} />
            <span>{customerLoadError}</span>
          </div>
        )}

        {/* 配置缺失提示 */}
        {(!multiConfig?.apiKey || !textConfig?.apiKey) && (
          <div style={{
            padding: '12px 16px', marginBottom: 20, borderRadius: 8,
            background: '#fffbeb', color: '#d97706', fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={16} />
            <span>
              请先在
              <a href="#/settings/ai" style={{ color: '#d97706', fontWeight: 600, marginLeft: 4 }}>AI 设置</a>
              &nbsp;中配置 API Key（DeepSeek + Qwen）
            </span>
          </div>
        )}

        {/* Tab 导航 */}
        <div className="ai-tabs" style={{ marginBottom: 20 }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`ai-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => !tab.disabled && setActiveTab(tab.key)}
              disabled={tab.disabled}
              title={tab.disabled ? '音频识别功能即将上线' : undefined}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
              {tab.disabled && <span style={{ fontSize: 11, opacity: 0.6 }}>(待接入)</span>}
            </button>
          ))}
        </div>

        {/* ===== 截图识别 Tab ===== */}
        {activeTab === 'screenshot' && (
          <div className="card">
            <h3 className="section-title">微信截图识别</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              上传微信聊天截图，AI 自动提取客户信息、意向度、等级建议等结构化数据
            </p>

            {/* 上传区 */}
            {!imagePreview ? (
              <div
                className="dropzone"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} style={{ color: '#9ca3af', marginBottom: 12 }} />
                <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 4 }}>点击或拖拽上传微信截图</p>
                <p style={{ color: '#9ca3af', fontSize: 12 }}>支持 PNG / JPG / WebP</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                />
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0 }}>
                    <img
                      src={imagePreview}
                      alt="预览"
                      style={{ maxWidth: 300, maxHeight: 400, borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {imageFile?.name} ({(imageFile?.size ?? 0) > 0 ? `${(imageFile!.size / 1024).toFixed(0)} KB` : ''})
                    </div>
                    <div className="btn-group" style={{ marginBottom: 12 }}>
                      <button
                        className="btn btn-primary"
                        onClick={handleAnalyzeScreenshot}
                        disabled={screenshotAnalyzing || !multiConfig?.apiKey}
                      >
                        {screenshotAnalyzing ? <RefreshCw size={14} /> : <Image size={14} />}
                        {screenshotAnalyzing ? '分析中...' : '分析截图'}
                      </button>
                      <button className="btn" onClick={() => {
                        setImageFile(null); setImagePreview(null); setImageBase64(null);
                        setScreenshotResult(null); setScreenshotError(''); setScreenshotSaved(false);
                      }}>
                        重新上传
                      </button>
                    </div>

                    {screenshotError && (
                      <div style={{ color: '#dc2626', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <XCircle size={16} /> {screenshotError}
                      </div>
                    )}

                    {screenshotResult && (
                      <div style={{
                        background: confidenceBg(screenshotResult.confidence),
                        border: `1px solid ${confidenceColor(screenshotResult.confidence)}`,
                        borderRadius: 8, padding: 16,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>
                            分析结果
                          </span>
                          <span style={{
                            fontSize: 13, fontWeight: 600,
                            color: confidenceColor(screenshotResult.confidence),
                          }}>
                            置信度: {(screenshotResult.confidence * 100).toFixed(0)}%
                            {screenshotResult.confidence < 0.65 && ' (低)'}
                          </span>
                        </div>

                        <div className="detail-grid" style={{ marginBottom: 12 }}>
                          <div className="detail-item">
                            <div className="label">客户名称</div>
                            <div className="value">{screenshotResult.customer_name || '-'}</div>
                          </div>
                          <div className="detail-item">
                            <div className="label">微信号</div>
                            <div className="value">{screenshotResult.wechat_id || '-'}</div>
                          </div>
                          <div className="detail-item">
                            <div className="label">手机号</div>
                            <div className="value">{screenshotResult.phone_number || '-'}</div>
                          </div>
                          <div className="detail-item">
                            <div className="label">回复状态</div>
                            <div className="value">{screenshotResult.reply_status}</div>
                          </div>
                          <div className="detail-item">
                            <div className="label">意向度</div>
                            <div className="value">
                              <span className={`badge badge-${screenshotResult.intent_level.toLowerCase()}`}>
                                {screenshotResult.intent_level}
                              </span>
                            </div>
                          </div>
                          <div className="detail-item">
                            <div className="label">等级建议</div>
                            <div className="value">
                              <span className={`badge badge-${screenshotResult.grade_suggestion.toLowerCase()}`}>
                                {screenshotResult.grade_suggestion}
                              </span>
                              {screenshotResult.grade_suggestion === 'A' && (
                                <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 4 }}>
                                  ⚠ 需人工确认
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="detail-item">
                            <div className="label">跟进结果</div>
                            <div className="value">{screenshotResult.follow_up_result}</div>
                          </div>
                          <div className="detail-item">
                            <div className="label">下一步动作</div>
                            <div className="value">{screenshotResult.next_action || '-'}</div>
                          </div>
                          <div className="detail-item">
                            <div className="label">建议跟进时间</div>
                            <div className="value">{screenshotResult.next_follow_up_text || '-'}</div>
                          </div>
                        </div>

                        {screenshotResult.summary && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>摘要</div>
                            <div style={{ fontSize: 14 }}>{screenshotResult.summary}</div>
                          </div>
                        )}
                        {screenshotResult.evidence && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>证据</div>
                            <div style={{ fontSize: 13, color: '#6b7280' }}>{screenshotResult.evidence}</div>
                          </div>
                        )}

                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleSaveScreenshotDraft}
                          disabled={screenshotSaved}
                        >
                          {screenshotSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
                          {screenshotSaved ? '已保存草稿' : '保存为草稿'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== 通话文本分析 Tab ===== */}
        {activeTab === 'call' && (
          <div className="card">
            <h3 className="section-title">通话文本分析</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              粘贴通话转文字内容，AI 自动分析客户意向、电话反馈类型、等级建议等
            </p>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>通话内容</label>
              <textarea
                value={callText}
                onChange={e => { setCallText(e.target.value); setCallSaved(false); }}
                placeholder="请粘贴通话录音转文字内容..."
                rows={8}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            <div className="btn-group" style={{ marginBottom: 16 }}>
              <button
                className="btn btn-primary"
                onClick={handleAnalyzeCall}
                disabled={callAnalyzing || !callText.trim() || !textConfig?.apiKey}
              >
                {callAnalyzing ? <RefreshCw size={14} /> : <FileText size={14} />}
                {callAnalyzing ? '分析中...' : '分析通话'}
              </button>
            </div>

            {callError && (
              <div style={{ color: '#dc2626', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <XCircle size={16} /> {callError}
              </div>
            )}

            {callResult && (
              <div style={{
                background: confidenceBg(callResult.confidence),
                border: `1px solid ${confidenceColor(callResult.confidence)}`,
                borderRadius: 8, padding: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>分析结果</span>
                  <span style={{
                    fontSize: 13, fontWeight: 600,
                    color: confidenceColor(callResult.confidence),
                  }}>
                    置信度: {(callResult.confidence * 100).toFixed(0)}%
                    {callResult.confidence < 0.65 && ' (低)'}
                  </span>
                </div>

                <div className="detail-grid" style={{ marginBottom: 12 }}>
                  <div className="detail-item">
                    <div className="label">电话反馈</div>
                    <div className="value">
                      <span className="badge badge-info">{callResult.phone_feedback}</span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <div className="label">意向度</div>
                    <div className="value">
                      <span className={`badge badge-${callResult.intent_level.toLowerCase()}`}>
                        {callResult.intent_level}
                      </span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <div className="label">等级建议</div>
                    <div className="value">
                      <span className={`badge badge-${callResult.grade_suggestion.toLowerCase()}`}>
                        {callResult.grade_suggestion}
                      </span>
                      {callResult.grade_suggestion === 'A' && (
                        <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 4 }}>⚠ 需人工确认</span>
                      )}
                    </div>
                  </div>
                  <div className="detail-item">
                    <div className="label">下一步动作</div>
                    <div className="value">{callResult.next_action || '-'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="label">建议跟进时间</div>
                    <div className="value">{callResult.next_follow_up_text || '-'}</div>
                  </div>
                  {callResult.risk && (
                    <div className="detail-item">
                      <div className="label">风险提示</div>
                      <div className="value" style={{ color: '#dc2626' }}>{callResult.risk}</div>
                    </div>
                  )}
                </div>

                {callResult.summary && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>摘要</div>
                    <div style={{ fontSize: 14 }}>{callResult.summary}</div>
                  </div>
                )}

                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveCallDraft}
                  disabled={callSaved}
                >
                  {callSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
                  {callSaved ? '已保存草稿' : '保存为草稿'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== 音频识别 Tab ===== */}
        {activeTab === 'audio' && (
          <div className="card">
            <h3 className="section-title">音频识别</h3>
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
              <Mic size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
              <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>音频识别功能即将上线</p>
              <p style={{ fontSize: 14 }}>该功能正在开发中，敬请期待。届时将支持通话录音直接分析，无需手动转文字。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
