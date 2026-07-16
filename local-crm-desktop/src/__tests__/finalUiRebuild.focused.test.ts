import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapSalesAgentOrbState } from '../lib/salesAgentUi/orbState';
import { buildAgentWorkProcess, summarizeWorkProcess } from '../lib/salesAgentUi/workProcess';
import { SALES_AGENT_QUICK_ACTIONS } from '../lib/salesAgentUi/quickActions';
import { searchCustomers, SEARCH_CUSTOMERS_MAX_RESULTS } from '../lib/salesAgentTools/searchCustomers';
import { resolveCustomerForAgentMessage } from '../lib/salesAgentTools/customerResolution';
import {
  buildDailyFocusItems,
  dismissDailyFocusForToday,
  shouldAutoOpenDailyFocus,
  DAILY_FOCUS_PREF_KEY,
} from '../lib/salesAgentUi/dailyFocus';

const app = readFileSync('src/App.tsx', 'utf8');
const appCss = readFileSync('src/App.css', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');
const workspace = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');
const interaction = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
const glassOrb = readFileSync('src/components/aiNative/SalesAgentGlassOrb.tsx', 'utf8');
const customerDetail = readFileSync('src/pages/CustomerDetail.tsx', 'utf8');

const corpus = [
  { id: 'c1', name: '上海 Universal', region: '上海', industry: '贸易', stage: 'CONTACTED', customer_grade: 'A', intent_level: 'HIGH', last_contacted_at: '2026-05-01T00:00:00.000Z', next_follow_up_at: '2026-07-01T00:00:00.000Z' },
  { id: 'c2', name: '华南生物', region: '华南', industry: '生物', stage: 'VISIT_READY', customer_grade: 'A', intent_level: 'HIGH', last_contacted_at: '2026-06-20T00:00:00.000Z', next_follow_up_at: '2026-07-10T00:00:00.000Z' },
  { id: 'c3', name: '广州机械一号', region: '广州', industry: '机械设备', stage: 'CONTACTED', customer_grade: 'B', intent_level: 'MEDIUM', last_contacted_at: '2026-04-01T00:00:00.000Z', next_follow_up_at: null },
  { id: 'c4', name: '广州机械二号', region: '广州', industry: '机械设备', stage: 'NEW_LEAD', customer_grade: 'C', intent_level: 'LOW', last_contacted_at: '2026-03-01T00:00:00.000Z', next_follow_up_at: null },
  { id: 'c5', name: '其它客户', region: '北京', industry: '软件', stage: 'NEW_LEAD', customer_grade: 'D', intent_level: 'NONE', last_contacted_at: '2026-07-12T00:00:00.000Z', next_follow_up_at: '2026-08-01T00:00:00.000Z' },
  { id: 'c6', name: '近似万有', region: '上海', industry: '贸易', stage: 'CONTACTED', customer_grade: 'B', intent_level: 'MEDIUM', last_contacted_at: '2026-01-01T00:00:00.000Z', next_follow_up_at: null },
] as const;

describe('Sales Agent final interaction focused guards', () => {
  it('1-5: no fixed customer picker, input usable without customer, no gate copy, auto-scope from detail', () => {
    expect(interaction).not.toContain('agent-context-picker');
    expect(interaction).not.toContain('<select');
    expect(interaction).not.toContain('请先选择客户');
    expect(interaction).not.toContain('读取只读快照');
    expect(interaction).toContain('data-testid="sales-agent-composer"');
    expect(interaction).toContain('disabled={sessionBusy}');
    expect(workspace).not.toContain('读取只读快照');
    expect(workspace).toContain('autoLoadedCustomer');
    expect(workspace).toContain('customerScopedEntry');
    expect(workspace).toContain('setSelectedCustomerId(customerScopedEntry.customer_id)');
    expect(workspace).toContain('runCopilot: false');
    expect(customerDetail).toContain('Ask Sales Agent');
    expect(customerDetail).toContain("navigate('/ai-workspace'");
  });

  it('6-9: NL customer search unique / multi / none and search_customers caps read-only', () => {
    const unique = resolveCustomerForAgentMessage({ message: '帮我找一下上海 Universal 这个客户', corpus });
    expect(unique.kind).toBe('scoped_continue');
    if (unique.kind === 'scoped_continue') expect(unique.customer_id).toBe('c1');

    const multi = resolveCustomerForAgentMessage({ message: '查一下广州做机械设备的客户', corpus });
    expect(multi.kind).toBe('candidates');
    if (multi.kind === 'candidates') {
      expect(multi.candidates.length).toBeGreaterThan(1);
      expect(multi.candidates.length).toBeLessThanOrEqual(SEARCH_CUSTOMERS_MAX_RESULTS);
      expect(multi.empty_exact).toBe(false);
    }

    const none = resolveCustomerForAgentMessage({ message: '帮我找一下不存在的宇宙集团客户', corpus });
    expect(none.kind).toBe('candidates');
    if (none.kind === 'candidates') expect(none.empty_exact).toBe(true);

    const search = searchCustomers(corpus, { query: '广州', industry: '机械设备' });
    expect(search.read_only).toBe(true);
    expect(search.writes_crm).toBe(false);
    expect(search.calls_provider).toBe(false);
    expect(search.candidates.length).toBeLessThanOrEqual(SEARCH_CUSTOMERS_MAX_RESULTS);
    expect(search.capped_at).toBe(5);
    expect(interaction).toContain('SalesAgentInteractionController');
    expect(interaction).toContain('agent-candidate-grid');
    expect(interaction).toContain('getDb');
  });

  it('10-13: daily focus once per day, no provider/CRM write, reopen supported', () => {
    const store = new Map<string, string>();
    const pref = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    const now = new Date('2026-07-14T10:00:00.000Z');
    expect(shouldAutoOpenDailyFocus(now, pref)).toBe(true);
    dismissDailyFocusForToday(now, pref);
    expect(shouldAutoOpenDailyFocus(now, pref)).toBe(false);
    expect(store.get(DAILY_FOCUS_PREF_KEY)).toBe('2026-07-14');
    expect(shouldAutoOpenDailyFocus(new Date('2026-07-15T10:00:00.000Z'), pref)).toBe(true);

    const items = buildDailyFocusItems(corpus, '2026-07-14T12:00:00.000Z');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(workspace).toContain('buildDailyFocusItems');
    expect(workspace).toContain('dismissDailyFocusForToday');
    expect(workspace).toContain('shouldAutoOpenDailyFocus');
    expect(workspace).toContain('今日值得关注');
    expect(workspace).toContain('交给 Sales Agent 分析');
    expect(workspace).toContain('daily-focus-reopen');
    expect(workspace).not.toMatch(/buildDailyFocusItems[\s\S]{0,200}createMockReasoningProvider/);
    expect(workspace).not.toMatch(/dismissDailyFocusForToday[\s\S]{0,80}db\.execute/);
  });

  it('14-15: Orb seven states and listening never maps Capture', () => {
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('idle');
    expect(mapSalesAgentOrbState({ phase: 'input-ready', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('input-ready');
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: false, hasProposal: false, voiceListening: true, sessionBusy: false })).toBe('listening');
    expect(mapSalesAgentOrbState({ phase: 'thinking', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: true })).toBe('thinking');
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: true, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('result-ready');
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: true, hasProposal: true, voiceListening: false, sessionBusy: false })).toBe('awaiting-confirmation');
    expect(mapSalesAgentOrbState({ phase: 'blocked', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('blocked');
    expect(glassOrb).toContain('agent-orb-glass');
    expect(glassOrb).not.toContain('Sparkles');
    expect(interaction).toContain('SalesAgentGlassOrb');
    expect(interaction).toContain('createSpeechRecognition');
    expect(interaction).toContain('setVoiceListening(true)');
    const analyzeCaptureFn = interaction.slice(interaction.indexOf('const analyzeCapture'), interaction.indexOf('const analyzeReviewed'));
    expect(analyzeCaptureFn).not.toContain('listening');
    expect(analyzeCaptureFn).toContain("setPhase('thinking')");
    expect(appCss).toContain('prefers-reduced-motion');
    expect(indexCss).toContain('--orb-size');
  });

  it('16-19: drawers default closed, capture hidden until attachment', () => {
    expect(workspace).toContain('contextDrawerOpen');
    expect(workspace).toContain('useState(false)');
    expect(workspace).toContain('processDrawerOpen');
    expect(interaction).toContain('captureOpen');
    expect(interaction).toContain('useState(false)');
    expect(interaction).toContain("setCaptureOpen(true)");
    expect(interaction).toContain('aria-label="附件入口"');
    expect(interaction).toContain('data-testid="agent-capture-modal"');
    expect(interaction).not.toContain('id="agent-capture-panel"');
    expect(interaction).not.toContain('CUSTOMER CONTEXT');
    expect(interaction).not.toContain('ACTIVE MEMORY');
    expect(interaction).not.toContain('TIMELINE EVIDENCE');
  });

  it('20-22: minimal header, no English kickers, no permanent engineering chips', () => {
    expect(workspace).toContain('agent-topbar-minimal');
    expect(workspace).toContain('今日重点');
    expect(workspace).not.toContain('<h1>Sales Agent</h1>');
    expect(workspace).not.toContain('今天想推进什么？');
    expect(workspace).not.toMatch(/page-kicker">AI 原生 CRM 工作台/);
    expect(workspace).not.toContain('YOUR INTELLIGENCE LAYER');
    expect(workspace).not.toContain('agent-status-row');
    expect(workspace).not.toContain('>Read-only<');
    expect(workspace).not.toContain('Mock Provider Enabled');
    expect(workspace).toContain('受控模式');
    expect(workspace).toContain('controlled-mode-panel');
    expect(app).toContain("label: 'Sales Agent'");
  });

  it('23-25: quick actions enter session / proposal / open capture, no fake confidence', () => {
    expect(SALES_AGENT_QUICK_ACTIONS.filter(item => item.kind === 'read_session').length).toBeGreaterThanOrEqual(3);
    expect(SALES_AGENT_QUICK_ACTIONS.some(item => item.kind === 'write_proposal' && item.label.includes('跟进'))).toBe(true);
    expect(SALES_AGENT_QUICK_ACTIONS.some(item => item.kind === 'open_capture')).toBe(true);
    expect(interaction).toContain("action.kind === 'open_capture'");
    expect(interaction).toContain('void submit(action.prompt)');
    expect(interaction).toContain('controller.submit');
    expect(interaction).not.toContain('confidenceHint');
    expect(interaction).not.toMatch(/78%|82%|86%|91%/);
    expect(SALES_AGENT_QUICK_ACTIONS.every(item => !('confidenceHint' in item))).toBe(true);
  });

  it('26-28: no live reasoning on normal page surface, confirm uses production controller, no auto model/write', () => {
    expect(workspace).toMatch(/<details className="agent-advanced">[\s\S]*Live model reasoning/);
    expect(workspace).toMatch(/<details className="agent-advanced">[\s\S]*Stage2ArchitectureStatus/);
    expect(workspace).toMatch(/<details className="agent-advanced">[\s\S]*CRM ContextSnapshot/);
    expect(workspace).not.toMatch(/agent-topbar[\s\S]{0,800}Live model reasoning/);
    expect(interaction).toContain('confirmSalesAgentProposal(session, confirmedProposal, onRefresh)');
    expect(interaction).not.toContain('createWriteProposal');
    expect(workspace).toContain('runCopilot: false');
    expect(workspace).not.toContain('loadSelectedContext({ runCopilot: true })');

    const steps = buildAgentWorkProcess({
      customerSelected: true,
      contextLoaded: true,
      memoryCount: 2,
      timelineCount: 5,
      sessionBusy: false,
      result: {
        plan: { intent: 'CUSTOMER_SUMMARY', steps: [{ tool_id: 'get_customer', customer_id: 'c1', access: 'read' }], safe_fallback: false, customer_id: 'c1' },
        mode: 'mock',
        provider: 'mock',
        model: 'm',
        tool_trace: [{ tool_id: 'get_customer', records: [{ id: '1' }], evidence_refs: ['e1'], read_only: true, writes_crm: false }],
        evidence_refs: ['e1', 'e2', 'e3'],
        confidence: 0.7,
        response: 'summary',
        structured: {
          customer_understanding: 'summary',
          recent_changes: '0',
          risks_and_opportunities: 'none',
          recommended_next_step: 'review',
          evidence_refs: ['e1', 'e2', 'e3'],
        },
        requires_human_review: true,
        executable: false,
        writes_crm: false,
      } as never,
      proposal: null,
      confirmationPending: false,
    });
    expect(steps.some(step => step.label.includes('2 条有效记忆'))).toBe(true);
    expect(steps.some(step => step.label.includes('3 条证据'))).toBe(true);
    expect(summarizeWorkProcess(steps)).toContain('证据');
  });
});
