import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapSalesAgentOrbState } from '../lib/salesAgentUi/orbState';
import { resolveUnifiedAgentStageMode } from '../lib/salesAgentUi/stageMode';
import { projectResultCards } from '../lib/salesAgentUi/resultCards';

const workspace = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');
const interaction = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
const glassOrb = readFileSync('src/components/aiNative/SalesAgentGlassOrb.tsx', 'utf8');
const appCss = readFileSync('src/App.css', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');
const orbState = readFileSync('src/lib/salesAgentUi/orbState.ts', 'utf8');

describe('UNIFIED_AGENT_STAGE morph focused guards', () => {
  it('1-4: single UNIFIED_AGENT_STAGE, no independent result/conversation regions', () => {
    expect(interaction).toContain('data-testid="UNIFIED_AGENT_STAGE"');
    expect(interaction).toContain('unified-agent-stage');
    expect(interaction.match(/data-testid="UNIFIED_AGENT_STAGE"/g)?.length).toBe(1);
    expect(interaction).not.toContain('data-testid="agent-conversation"');
    expect(appCss).toContain('.agent-conversation { display: none !important; }');
    expect(interaction).toContain('agent-result-stage');
    expect(interaction).toContain('stage-${stageMode}');
  });

  it('5-10: input idle shows orb/composer/quick actions; send morphs; thinking from session busy', () => {
    expect(interaction).toContain('SalesAgentGlassOrb');
    expect(interaction).toContain('data-testid="sales-agent-composer"');
    expect(interaction).toContain('data-testid="agent-quick-grid"');
    expect(interaction).toContain('is-morph-out');
    expect(interaction).toContain("setPhase('thinking')");
    expect(interaction).toContain('setSessionBusy(true)');
    expect(interaction).toContain('agent-thinking-panel');
    expect(interaction).toContain('agent-live-status');
    expect(interaction).toContain('processSummary');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: true,
      locatingCustomer: false,
      phase: 'thinking',
      candidateCount: 0,
      hasProposal: false,
      hasResult: false,
      hasWriteSuccess: false,
    })).toBe('thinking');
  });

  it('11-14: result/proposal/candidate/error all inline in same stage', () => {
    expect(interaction).toContain('agent-result-stage');
    expect(interaction).toContain('agent-confirm-inline');
    expect(interaction).toContain('agent-candidate-inline');
    expect(interaction).toContain('agent-error-inline');
    expect(interaction).toContain('orbCompact');
    expect(interaction).toContain('agent-composer-docked');
    expect(interaction).toContain('confirmSalesAgentProposal(session, confirmedProposal, onRefresh)');
    expect(interaction).toContain('controller.selectCandidate');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false, locatingCustomer: false, phase: 'idle', candidateCount: 2,
      hasProposal: false, hasResult: false, hasWriteSuccess: false,
    })).toBe('candidate');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false, locatingCustomer: false, phase: 'idle', candidateCount: 8,
      hasPortfolio: true, hasProposal: false, hasResult: false, hasWriteSuccess: false,
    })).toBe('portfolio');
    expect(interaction).toContain('portfolioMode');
    expect(interaction).toContain('agent-portfolio-grid');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false, locatingCustomer: false, phase: 'idle', candidateCount: 0,
      hasProposal: true, hasResult: true, hasWriteSuccess: false,
    })).toBe('proposal');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false, locatingCustomer: false, phase: 'blocked', candidateCount: 0,
      hasProposal: false, hasResult: false, hasWriteSuccess: false,
    })).toBe('error');
  });

  it('15-21: drawers default closed; no fixed picker; scope chip rules; input usable without scope', () => {
    expect(workspace).toContain('useState(false)');
    expect(workspace).toContain('contextDrawerOpen');
    expect(workspace).toContain('processDrawerOpen');
    expect(interaction).toContain('useState(false)');
    expect(interaction).toContain('captureOpen');
    expect(interaction).toContain('historyOpen');
    expect(interaction).not.toContain('agent-context-picker');
    expect(interaction).not.toContain('<select');
    expect(interaction).toContain('data-testid="agent-scope-chip"');
    expect(interaction).toContain('清除客户 Scope');
    expect(interaction).toContain('disabled={sessionBusy}');
    expect(interaction).toContain('向 Sales Agent 提问或下达指令');
  });

  it('22-24: minimal header, no engineering kickers / permanent chips', () => {
    expect(workspace).toContain('今日重点');
    expect(workspace).toContain('受控模式');
    expect(workspace).toContain('agent-topbar-minimal');
    expect(workspace).not.toContain('<h1>Sales Agent</h1>');
    expect(workspace).not.toContain('今天想推进什么？');
    expect(workspace).not.toContain('YOUR INTELLIGENCE LAYER');
    expect(workspace).not.toMatch(/agent-topbar[\s\S]{0,500}AI 原生 CRM 工作台/);
    expect(workspace).not.toContain('Mock Provider Enabled');
    expect(workspace).not.toContain('>Read-only<');
  });

  it('25-29: orb seven states, reduced-motion, listening≠capture, awaiting-confirmation, daily focus morph', () => {
    expect(orbState).toContain("'awaiting-confirmation'");
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('idle');
    expect(mapSalesAgentOrbState({ phase: 'input-ready', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('input-ready');
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: false, hasProposal: false, voiceListening: true, sessionBusy: false })).toBe('listening');
    expect(mapSalesAgentOrbState({ phase: 'thinking', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: true })).toBe('thinking');
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: true, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('result-ready');
    expect(mapSalesAgentOrbState({ phase: 'idle', hasResult: true, hasProposal: true, voiceListening: false, sessionBusy: false })).toBe('awaiting-confirmation');
    expect(mapSalesAgentOrbState({ phase: 'blocked', hasResult: false, hasProposal: false, voiceListening: false, sessionBusy: false })).toBe('blocked');
    expect(appCss).toContain('prefers-reduced-motion');
    expect(indexCss).toContain('--stage-morph-ms');
    expect(glassOrb).toContain('agent-orb-glass');
    expect(glassOrb).toContain('agent-orb-ring');
    expect(glassOrb).not.toContain('Sparkles');
    const analyzeCaptureFn = interaction.slice(interaction.indexOf('const analyzeCapture'), interaction.indexOf('const analyzeReviewed'));
    expect(analyzeCaptureFn).not.toContain('listening');
    expect(workspace).toContain('setSeedInstruction');
    expect(workspace).toContain('交给 Sales Agent 分析');
    expect(interaction).toContain('seedInstruction');
  });

  it('30: confirm still uses production controller; result cards stay compact', () => {
    expect(interaction).toContain('confirmSalesAgentProposal');
    expect(interaction).not.toContain('createWriteProposal');
    const cards = projectResultCards({
      plan: { intent: 'CUSTOMER_SUMMARY', steps: [], safe_fallback: false, customer_id: 'c1' },
      mode: 'mock',
      provider: 'mock',
      model: 'm',
      tool_trace: [],
      evidence_refs: ['meeting.docx', 'quote.xlsx', 'plan.pdf'],
      confidence: 0.7,
      response: '摘要',
      structured: {
        customer_understanding: '客户正在评估 AI 平台，希望降低运维成本。第二行细节。',
        recent_changes: '最近一次会议后推进评估',
        risks_and_opportunities: '风险：价格压力、资源紧张；机会：效率提升、维护简化、兼容性',
        recommended_next_step: '安排 Demo；核算 ROI；确认流程',
        evidence_refs: ['meeting.docx', 'quote.xlsx', 'plan.pdf'],
      },
      requires_human_review: true,
      executable: false,
      writes_crm: false,
    } as never);
    expect(cards.risks.length).toBeLessThanOrEqual(2);
    expect(cards.opportunities.length).toBeLessThanOrEqual(3);
    expect(cards.nextSteps.length).toBeLessThanOrEqual(3);
    expect(cards.evidence.count).toBe(3);
  });
});
