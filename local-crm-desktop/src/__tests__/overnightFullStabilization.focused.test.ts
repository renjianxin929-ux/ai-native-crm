import { beforeEach, describe, expect, it } from 'vitest';
import { createCrmRepository } from '../lib/db';
import { validateEvidenceRelations } from '../lib/salesAgent/evidenceIntegrity';
import { setFactReview } from '../lib/customerCapture/review';
import { buildAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { FixedAppClock, parseRelativeDateTimeInZone } from '../lib/salesAgentTools/appClock';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { CANONICAL_AGENT_SESSION_PHASES, projectCanonicalSessionPhase } from '../lib/salesAgentTools/interactionController';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sessionForWrite, sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-15T09:30:00+08:00';

describe('AI Native CRM overnight full stabilization contracts', () => {
  beforeEach(() => __resetSessionWriteStateStoreForTests());

  it('normalizes at least 100 search paraphrases to one Guangzhou portfolio contract', () => {
    const actions = ['帮我找', '给我查', '查询', '搜索', '筛选', '列出', '找出', '看看', '有哪些', '显示'];
    const regions = ['广州', '广州市', '广州地区', '广州区域', '位于广州', '在广州', '广州当地', '广州这边', '广州范围内', '广州的'];
    const phrases = actions.flatMap(action => regions.map(region => `${action}${region}的客户`));
    expect(phrases).toHaveLength(100);
    for (const phrase of phrases) {
      const result = buildAgentIntentEnvelope(phrase, NOW);
      expect(result).toMatchObject({ intent: 'SEARCH_CUSTOMERS', mode: 'portfolio_search', customer_reference: null, parser_source: 'production_deterministic_v2', clarification_required: false });
      expect(result.portfolio_filters.region).toBe('广州');
    }
  });

  it('keeps the exact 30-day no-follow-up phrase as a portfolio filter, never a name query', () => {
    const result = buildAgentIntentEnvelope('找出最近30天没有跟进的客户', NOW);
    expect(result).toMatchObject({
      intent: 'SEARCH_CUSTOMERS',
      mode: 'portfolio_search',
      customer_reference: null,
      portfolio_filters: { inactive_days: 30 },
    });
  });

  it('preserves a quoted company name that contains industry vocabulary', () => {
    const result = buildAgentIntentEnvelope('找一下「华南生物科技」', NOW);
    expect(result).toMatchObject({
      intent: 'SEARCH_CUSTOMERS',
      mode: 'entity_resolution',
      customer_reference: '华南生物科技',
    });
  });

  it('classifies 50 customer-analysis paraphrases into closed analysis intents', () => {
    const verbs = ['总结客户现状', '概括这个客户', '分析风险与机会', '整理最近互动', '给出下一步建议'];
    const suffixes = ['请简洁说明', '按证据说明', '只看 CRM', '现在处理', '给销售参考', '不要写库', '查看当前状态', '结合互动', '列出重点', '说明依据'];
    const phrases = verbs.flatMap(verb => suffixes.map(suffix => `${verb}，${suffix}`));
    expect(phrases).toHaveLength(50);
    for (const phrase of phrases) {
      const envelope = buildAgentIntentEnvelope(phrase, NOW);
      expect(envelope.mode, phrase).toBe('customer_analysis');
      expect(['CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'CUSTOMER_TIMELINE_REVIEW', 'INTERACTION_SUMMARY', 'NEXT_ACTION_PREPARATION']).toContain(envelope.intent);
      expect(envelope.write_intent).toBeNull();
    }
  });

  it('classifies 50 write paraphrases without confusing follow-up, task, and next follow-up', () => {
    const followUps = Array.from({ length: 20 }, (_, index) => `帮我写一条跟进：已沟通报价方案 ${index + 1}`);
    const tasks = Array.from({ length: 15 }, (_, index) => `提醒我明天下午3点发送报价 ${index + 1}`);
    const updates = Array.from({ length: 15 }, (_, index) => `更新下次跟进到下周一上午10点 ${index + 1}`);
    expect([...followUps, ...tasks, ...updates]).toHaveLength(50);
    followUps.forEach(phrase => expect(buildAgentIntentEnvelope(phrase, NOW)).toMatchObject({ mode: 'write_action', intent: 'CREATE_FOLLOW_UP_REQUEST' }));
    tasks.forEach(phrase => expect(buildAgentIntentEnvelope(phrase, NOW)).toMatchObject({ mode: 'write_action', intent: 'CREATE_TASK_REQUEST' }));
    updates.forEach(phrase => expect(buildAgentIntentEnvelope(phrase, NOW)).toMatchObject({ mode: 'write_action', intent: 'UPDATE_CUSTOMER_REQUEST' }));
  });

  it('proves a 50-case next-week time matrix in Asia/Shanghai', () => {
    const phrases = Array.from({ length: 50 }, (_, index) => {
      const hour = 8 + (index % 10);
      const minute = index % 2 ? 30 : 0;
      return { phrase: `下周一 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, hour, minute };
    });
    for (const item of phrases) {
      const parsed = parseRelativeDateTimeInZone(item.phrase, NOW, 'Asia/Shanghai');
      expect(parsed?.iso).toBe(`2026-07-20T${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}:00+08:00`);
    }
  });

  it('covers date boundaries, missing time, leap year, and UTC conversion', () => {
    expect(parseRelativeDateTimeInZone('下周一上午 10 点', NOW, 'Asia/Shanghai')?.iso).toBe('2026-07-20T10:00:00+08:00');
    expect(parseRelativeDateTimeInZone('下周一', NOW, 'Asia/Shanghai')).toMatchObject({ iso: '2026-07-20', date_only: true });
    expect(parseRelativeDateTimeInZone('本周一上午10点', NOW, 'Asia/Shanghai')?.iso).toBe('2026-07-13T10:00:00+08:00');
    expect(parseRelativeDateTimeInZone('月底下午3点', NOW, 'Asia/Shanghai')?.iso).toBe('2026-07-31T15:00:00+08:00');
    expect(parseRelativeDateTimeInZone('年底下午3点', NOW, 'Asia/Shanghai')?.iso).toBe('2026-12-31T15:00:00+08:00');
    expect(parseRelativeDateTimeInZone('2028年2月29日上午10点', NOW, 'Asia/Shanghai')?.iso).toBe('2028-02-29T10:00:00+08:00');
    expect(parseRelativeDateTimeInZone('2027年2月29日上午10点', NOW, 'Asia/Shanghai')).toBeNull();
    expect(parseRelativeDateTimeInZone('下周一上午10点', NOW, 'UTC')?.iso).toBe('2026-07-20T10:00:00+00:00');
  });

  it('creates and confirms a disclosed grouped follow-up + next-follow-up proposal', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const repository = createCrmRepository(fixture.db, () => clock.now());
    const boundary = createApprovedCrmWriteBoundary(repository, clock);
    const session = sessionForWrite('2026-07-16T15:00:00+08:00', NOW);

    const outcome = await session.submit(buildAgentIntentEnvelope('帮我写一条跟进，下周一上午 10 点联系', NOW));
    expect(outcome.kind).toBe('write_proposal');
    if (outcome.kind !== 'write_proposal') throw new Error('expected grouped proposal');
    expect(outcome.proposal.grouped_operations).toEqual([
      expect.objectContaining({ operation_id: 'record-follow-up-now', tool_id: 'create_follow_up_record', selected: true }),
      expect.objectContaining({ operation_id: 'update-next-follow-up', tool_id: 'update_next_follow_up_time', selected: true, proposed_values: { next_follow_up_at: '2026-07-20T10:00:00+08:00' } }),
    ]);
    expect(JSON.stringify(outcome.proposal.grouped_operations)).not.toContain('create_task');

    await session.confirmWriteByRef({ proposal_id: outcome.proposal.proposal_id, nonce: outcome.proposal.nonce!, confirmed_at: '2026-07-15T09:31:00+08:00' }, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 1 });
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get()).toEqual({ c: 0 });
    expect(fixture.sqlite.prepare('SELECT feedback_notes,next_follow_up_at,created_at FROM follow_up_records').get()).toEqual({
      feedback_notes: '下周一上午 10 点联系', next_follow_up_at: null, created_at: NOW,
    });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1')).toEqual({ next_follow_up_at: '2026-07-20T10:00:00+08:00' });
    await expect(session.confirmWriteByRef({ proposal_id: outcome.proposal.proposal_id, nonce: outcome.proposal.nonce!, confirmed_at: '2026-07-15T09:32:00+08:00' }, boundary)).rejects.toThrow(/replay/i);
    fixture.close();
  });

  it('lets the user cancel one grouped child without hidden second write', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => clock.now()), clock);
    const session = sessionForWrite('2026-07-16T15:00:00+08:00', NOW);
    const outcome = await session.submit(buildAgentIntentEnvelope('帮我写一条跟进，下周一上午 10 点联系', NOW));
    if (outcome.kind !== 'write_proposal') throw new Error('expected grouped proposal');
    const updated = session.setGroupedOperationSelected(outcome.proposal.proposal_id, 'update-next-follow-up', false);
    await session.confirmWriteByRef({ proposal_id: updated.proposal_id, nonce: updated.nonce!, confirmed_at: '2026-07-15T09:31:00+08:00' }, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 1 });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1')).toEqual({ next_follow_up_at: '2026-07-13T09:00:00Z' });
    fixture.close();
  });

  it('accepts explicit many-to-many evidence relations and rejects orphan references', () => {
    const valid = validateEvidenceRelations({
      fact_ids: ['fact-1', 'fact-2'],
      evidence_ids: ['evidence-1'],
      relations: [
        { evidence_id: 'evidence-1', fact_type: 'follow_up', fact_id: 'fact-1' },
        { evidence_id: 'evidence-1', fact_type: 'follow_up', fact_id: 'fact-2' },
        { evidence_id: 'evidence-1', fact_type: 'follow_up', fact_id: 'fact-2' },
      ],
    });
    expect(valid).toMatchObject({ valid: true });
    expect(valid.relations).toHaveLength(2);
    expect(validateEvidenceRelations({ fact_ids: ['fact-1'], evidence_ids: ['evidence-1'], relations: [{ evidence_id: 'missing', fact_type: 'task', fact_id: 'fact-1' }] }).valid).toBe(false);
  });

  it('exposes every canonical session lifecycle phase and stable projections', () => {
    expect(CANONICAL_AGENT_SESSION_PHASES).toEqual([
      'idle', 'parsing', 'portfolio_results', 'resolving_customer', 'awaiting_candidate', 'loading_context', 'reasoning',
      'clarification_required', 'awaiting_confirmation', 'executing_write', 'completed', 'blocked', 'error',
    ]);
    expect(projectCanonicalSessionPhase('portfolio_browse')).toBe('portfolio_results');
    expect(projectCanonicalSessionPhase('proposal')).toBe('awaiting_confirmation');
    expect(projectCanonicalSessionPhase('clarification')).toBe('clarification_required');
  });

  it('supports deterministic text capture and honest offline image manual review', async () => {
    const session = sessionForWrite(undefined, NOW, false);
    const text = await session.capture('text', '客户希望下周收到正式报价。客户认为当前价格太贵。');
    expect(text.provider_kind).toBe('DETERMINISTIC_LOCAL');
    expect(text.facts).toHaveLength(2);
    expect(text.facts.map(fact => fact.fact_type)).toEqual(['visible_requirement', 'visible_objection']);
    await expect(session.capture('image', 'data:image/png;base64,AAAA')).rejects.toThrow(/多模态模型未配置/);
  });

  it('falls back deterministically when the trusted host has no configured capture provider', async () => {
    const session = sessionForWrite(undefined, NOW, false);
    session.updateRuntime({
      host: {
        reason: async () => ({}),
        capture: async () => { throw 'missing_host_provider'; },
      },
    });
    await expect(session.capture('text', '客户希望下周收到报价。')).rejects.toBe('missing_host_provider');
    await expect(session.capture('image', 'data:image/png;base64,AAAA')).rejects.toBe('missing_host_provider');
  });

  it('projects reviewed facts into reasoning and turns an explicit Create Proposal click into an unexecuted follow-up proposal', async () => {
    const session = sessionForWrite(undefined, NOW, false);
    const pending = await session.capture('text', '客户确认需要电话跟进。');
    const reviewed = setFactReview(pending, pending.facts[0]!.fact_id, 'accepted');
    const reasoning = await session.analyzeReviewedFacts(reviewed);
    expect(reasoning.structured.customer_understanding).toContain('客户确认需要电话跟进');
    const proposal = await session.createProposalFromReviewedFacts(reviewed);
    expect(proposal).toMatchObject({ tool_id: 'create_follow_up_record', customer_id: 'customer-1' });
    expect(proposal.proposed_values).toMatchObject({ feedback_notes: '客户确认需要电话跟进' });
  });
});
