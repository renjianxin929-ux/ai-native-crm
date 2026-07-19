import { describe, expect, it } from 'vitest';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { executeCustomerPriorityRanking } from '../lib/salesAgentTools/customerPriorityRanking';
import { SALES_AGENT_TOOL_REGISTRY } from '../lib/salesAgentTools/registry';

const rows = [
  { id: 'hot', name: '热客户', customer_grade: 'A', intent_level: 'HIGH', stage: 'NEGOTIATION', last_contacted_at: '2026-07-18T00:00:00Z', next_follow_up_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z', region: '广州', industry: '机械设备', contact_person: '张三', phone_number: 'redacted', email: null, next_action: '联系', phone_feedback: 'INTERESTED', can_schedule_visit: 1, deal_amount: 100, open_tasks: 2, interaction_count: 3 },
  { id: 'cold', name: '冷客户', customer_grade: 'D', intent_level: 'LOW', stage: 'NEW_LEAD', last_contacted_at: null, next_follow_up_at: null, updated_at: '2025-01-01T00:00:00Z', region: null, industry: null, contact_person: null, phone_number: null, email: null, next_action: null, phone_feedback: null, can_schedule_visit: 0, deal_amount: null, open_tasks: 0, interaction_count: 0 },
];

describe('customer-priority-ranking', () => {
  it.each(['我最近需要的高质量客户有哪些', '这周最值得联系谁', '哪些客户最可能成交', '最近最值得跟的客户'])('%s routes deterministically', phrase => {
    expect(createAgentIntentEnvelope(phrase, '2026-07-19T12:00:00+08:00')).toMatchObject({ intent: 'CUSTOMER_PRIORITY_RANKING', requires_real_model: false });
  });

  it('scores persisted CRM factors with deterministic reasons and evidence', async () => {
    const result = await executeCustomerPriorityRanking({ db: { select: async () => rows } as never, now: '2026-07-19T12:00:00Z' });
    expect(result.items[0]).toMatchObject({ rank: 1, customer_id: 'hot' });
    expect(result.items[0]!.score).toBeGreaterThan(result.items[1]!.score);
    expect(result.items[0]!.deterministic_reasons.length).toBeGreaterThan(5);
    expect(result.items[0]!.evidence_references).toContain('customer:hot');
    expect(result).toMatchObject({ provider_called: false, writes_crm: false, model_status_note: '本地 CRM 规则排序，未调用大模型。' });
    expect(SALES_AGENT_TOOL_REGISTRY.customer_priority_ranking).toBeTruthy();
  });
});
