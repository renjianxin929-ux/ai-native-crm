/**
 * V0.2C / C1.5 — Agent Capability Reachability & Routing focused tests.
 *
 * 证明核心路由契约（不重跑完整回归）：
 *   1. 口语化"写个跟进"正确识别为 CREATE_FOLLOW_UP_REQUEST（写），而不是
 *      FOLLOW_UP_DRAFT（读/草稿）——修复"WRITE→unrelated READ downgrade"；
 *   2. "写个跟进"内容缺失 → 澄清（不是返回无关客户摘要）；
 *   3. 模型不可用时，写意图仍走确定性澄清/提案路径，绝不退化为读摘要，零写入；
 *   4. 明确写文案请求（写跟进话术 / 写个跟进话术）仍为 FOLLOW_UP_DRAFT（写）；
 *   5. 指定跟进命令 → 澄清/提案 → 确认前零写入 → 确认后精确一次写库；
 *   6. 破坏性/歧义命令 fail-closed（删除客户 → 阻断；改成20万 → 澄清）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyClosedWriteIntent,
  draftWriteFields,
} from '../lib/salesAgentTools/writeIntent';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { mapProviderError } from '../lib/productionAi/providerErrorMapping';
import { confirmSalesAgentProposal } from '../lib/salesAgentTools/confirmSalesAgentProposal';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  seedCustomer,
  sessionForWrite,
  sqliteFixture,
  sqliteRepository,
} from './salesAgentProductionHarness';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';

const NOW = '2026-07-15T12:00:00+08:00';
const intent = (message: string) => createAgentIntentEnvelope(message, NOW);

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
});

describe('C1.5 — reachability: 写个跟进 must route to follow_up.create (write), not draft/read', () => {
  it('写个跟进 → CREATE_FOLLOW_UP_REQUEST (write_action), never FOLLOW_UP_DRAFT / summary', () => {
    expect(classifyClosedWriteIntent('写个跟进')?.intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    expect(classifyClosedWriteIntent('写个跟进')?.tool_id).toBe('create_follow_up_record');

    const envelope = intent('写个跟进');
    expect(envelope.intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    expect(envelope.mode).toBe('write_action');
    expect(envelope.intent).not.toBe('FOLLOW_UP_DRAFT');
    expect(envelope.intent).not.toBe('CUSTOMER_SUMMARY');
    expect(envelope.intent).not.toBe('SAFE_FALLBACK');
  });

  it('colloquial measure words 个 / 一个 / 一条 all route to write', () => {
    for (const phrase of ['写个跟进', '写一个跟进', '写一条跟进', '帮我写个跟进']) {
      expect(classifyClosedWriteIntent(phrase)?.intent, phrase).toBe('CREATE_FOLLOW_UP_REQUEST');
    }
  });

  it('写个跟进 with missing content → clarification (not a read summary, no model needed)', async () => {
    const draft = draftWriteFields('写个跟进', NOW)!;
    expect(draft.tool_id).toBe('create_follow_up_record');
    expect(draft.missing_fields).toContain('feedback_notes');
    expect(draft.question).toMatch(/内容/);

    const session = sessionForWrite();
    const outcome = await session.submit(intent('写个跟进'));
    expect(outcome.kind).toBe('clarification_required');
    if (outcome.kind === 'clarification_required') {
      expect(outcome.clarification.pending_write_intent).toBe('CREATE_FOLLOW_UP_REQUEST');
      expect(outcome.clarification.tool_id).toBe('create_follow_up_record');
    }
  });

  it('write intent never downgrades to a read summary when the model is unavailable', async () => {
    // 写意图走确定性路径，不调用模型；结果必须是 clarification/proposal，不是 reasoning_result。
    const session = sessionForWrite();
    const outcome = await session.submit(intent('写个跟进'));
    expect(outcome.kind).not.toBe('reasoning_result');
    expect(outcome.kind === 'clarification_required' || outcome.kind === 'write_proposal').toBe(true);
  });

  it('draft prose (写跟进话术 / 写个跟进话术) stays FOLLOW_UP_DRAFT, never a write', () => {
    for (const phrase of ['写跟进话术', '写个跟进话术', '写个客户消息草稿供我审核', '写个能直接复制的消息']) {
      expect(classifyClosedWriteIntent(phrase), phrase).toBeNull();
      const envelope = intent(phrase);
      expect(envelope.intent, phrase).toBe('FOLLOW_UP_DRAFT');
      expect(envelope.mode, phrase).not.toBe('write_action');
    }
  });
});

describe('C1.5 — reachability: specified follow-up E2E (proposal → confirm → exactly one write)', () => {
  it('记录跟进：客户今天没回复，周三再联系。→ clarification(time) → proposal → confirm → 1 write', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite, 'customer-1');
    const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));

    const session = sessionForWrite();
    const first = await session.submit(intent('记录跟进：客户今天没回复，周三再联系。'));
    expect(first.kind === 'clarification_required' || first.kind === 'write_proposal').toBe(true);

    let proposal;
    if (first.kind === 'write_proposal') {
      proposal = first.proposal;
    } else {
      expect(first.clarification.pending_write_intent).toBe('CREATE_FOLLOW_UP_REQUEST');
      const answered = await session.submit(intent('上午10:00'));
      expect(answered.kind).toBe('write_proposal');
      proposal = (answered as { kind: 'write_proposal'; proposal: typeof answered }).proposal;
    }

    expect(proposal.tool_id).toBe('create_follow_up_record');
    expect(proposal.requires_confirmation).toBe(true);
    expect(proposal.executable).toBe(false);
    // 确认前零写入。
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 0 });

    await confirmSalesAgentProposal(session, proposal, async () => undefined, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 1 });
    const row = fixture.sqlite.prepare('SELECT customer_id, title, feedback_notes FROM follow_up_records WHERE customer_id=?').get('customer-1') as {
      customer_id: string; title: string; feedback_notes: string;
    };
    expect(row.customer_id).toBe('customer-1');
    expect(row.title).toBe('跟进记录');
    expect(row.feedback_notes).toContain('没回复');
    fixture.close();
  });
});

describe('C1.5 — reachability: destructive / ambiguous commands fail closed', () => {
  it('删除这个客户 is blocked (never routes to customer.delete execution)', () => {
    const envelope = intent('删除这个客户');
    expect(envelope.intent).toBe('SAFE_FALLBACK');
    expect(envelope.unsupported_criteria).toContain('autonomous_external_action');
    expect(envelope.mode).toBe('control');
  });

  it('改成20万 (ambiguous amount) is SAFE_FALLBACK clarification, never a silent write', () => {
    expect(classifyClosedWriteIntent('改成20万')).toBeNull();
    const envelope = intent('改成20万');
    expect(envelope.intent).toBe('SAFE_FALLBACK');
    expect(envelope.mode).not.toBe('write_action');
  });

  it('删掉 (ambiguous destructive) never executes', () => {
    expect(classifyClosedWriteIntent('删掉')).toBeNull();
    const envelope = intent('删掉');
    expect(envelope.mode).not.toBe('write_action');
    expect(envelope.intent).toBe('SAFE_FALLBACK');
  });
});

describe('C1.5 — model health: unauthorized credential is honestly classified', () => {
  it('401/403 unauthorized maps to the honest user-facing message (no secret output)', () => {
    const mapped = mapProviderError({ message: 'HTTP 401 Unauthorized from provider' });
    expect(mapped.category).toBe('unauthorized');
    expect(mapped.user_message).toBe('大模型凭据无效或未授权，本次未生成 AI 分析。');
    expect(JSON.stringify(mapped)).not.toMatch(/api.?key|sk-[A-Za-z0-9]/i);
  });

  it('write capability (follow_up.create) is deterministic — never requires the model', () => {
    const envelope = intent('写个跟进');
    expect(envelope.requires_real_model).toBe(false);
    expect(envelope.model_capability).toBe('none');
  });
});

// Type-level sanity: the follow-up session is a real SalesAgentSession.
void (sessionForWrite as () => SalesAgentSession);
