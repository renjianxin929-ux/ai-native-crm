import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __failOccurredFollowUpAfterInsertForTests,
  __setDbInstanceForTests,
  createCrmRepository,
  deleteCustomer,
} from '../lib/db';
import { buildFullBackupPayload, restoreBackupPayloadWithDb } from '../lib/backupRestore';
import { interpretCustomerQuery } from '../lib/planner/customerQueryInterpretation';
import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';
import { adaptReadSuccess } from '../lib/planner/readResultAdapter';
import { __setTauriAtomicInvokeForTests } from '../lib/runtime/tauriRuntime';
import { buildAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import { FixedAppClock } from '../lib/salesAgentTools/appClock';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { normalizeCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sessionForWrite, sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-15T09:30:00+08:00';

afterEach(() => {
  __failOccurredFollowUpAfterInsertForTests(false);
  __setTauriAtomicInvokeForTests(null);
  vi.unstubAllGlobals();
  __setDbInstanceForTests(null);
  __resetSessionWriteStateStoreForTests();
});

async function confirmProposal(session: ReturnType<typeof sessionForWrite>, proposal: { proposal_id: string; nonce?: string | null }, boundary: ReturnType<typeof createApprovedCrmWriteBoundary>) {
  await session.confirmWriteByRef(
    { proposal_id: proposal.proposal_id, nonce: proposal.nonce!, confirmed_at: '2026-07-15T09:31:00+08:00' },
    boundary,
  );
}

describe('Finding 1 — mixed follow-up confirmation is truthful and atomic', () => {
  it('CASE A 记录跟进：今天打电话没接 persists one completed historical follow-up', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => clock.now()), clock);
    const session = sessionForWrite('2026-07-13T09:00:00Z', NOW);

    const first = await session.submit(buildAgentIntentEnvelope('记录跟进：今天打电话没接', NOW));
    expect(first.kind).toBe('write_proposal');
    if (first.kind !== 'write_proposal') throw new Error('expected proposal');
    expect(first.proposal.tool_id).toBe('create_follow_up_record');
    expect(first.proposal.grouped_operations).toBeUndefined();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });

    await confirmProposal(session, first.proposal, boundary);
    const row = fixture.sqlite.prepare('SELECT title, feedback_notes, is_completed, next_follow_up_at FROM follow_up_records').get() as {
      title: string; feedback_notes: string; is_completed: number; next_follow_up_at: string | null;
    };
    expect(row.is_completed).toBe(1);
    expect(row.feedback_notes).toContain('没接');
    expect(row.next_follow_up_at).toBeNull();
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1')).toEqual({
      next_follow_up_at: '2026-07-13T09:00:00Z',
    });
    fixture.close();
  });

  it('CASE B 周三联系 is future-only scheduling and does not fabricate a completed follow-up', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => clock.now()), clock);
    const session = sessionForWrite('2026-07-13T09:00:00Z', NOW);

    const first = await session.submit(buildAgentIntentEnvelope('周三联系', NOW));
    expect(first.kind === 'clarification_required' || first.kind === 'write_proposal').toBe(true);
    let proposal;
    if (first.kind === 'write_proposal') {
      proposal = first.proposal;
    } else {
      expect(first.kind).toBe('clarification_required');
      if (first.kind !== 'clarification_required') throw new Error('expected clarification');
      expect(first.clarification.tool_id).toBe('update_next_follow_up_time');
      const answered = await session.submit(buildAgentIntentEnvelope('上午10:00', NOW));
      expect(answered.kind).toBe('write_proposal');
      if (answered.kind !== 'write_proposal') throw new Error('expected proposal');
      proposal = answered.proposal;
    }
    expect(proposal.tool_id).toBe('update_next_follow_up_time');
    expect(proposal.grouped_operations).toBeUndefined();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });

    await confirmProposal(session, proposal, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });
    const customer = fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1') as { next_follow_up_at: string };
    expect(customer.next_follow_up_at).toContain('T10:00');
    fixture.close();
  });

  it('CASE C mixed occurred + 周三再联系 shows both effects and persists both after confirm', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => clock.now()), clock);
    const session = sessionForWrite('2026-07-13T09:00:00Z', NOW);

    const first = await session.submit(buildAgentIntentEnvelope('记录跟进：今天打电话没接，周三再联系', NOW));
    let proposal;
    if (first.kind === 'write_proposal') {
      proposal = first.proposal;
    } else {
      expect(first.kind).toBe('clarification_required');
      const answered = await session.submit(buildAgentIntentEnvelope('上午10:00', NOW));
      expect(answered.kind).toBe('write_proposal');
      if (answered.kind !== 'write_proposal') throw new Error('expected proposal');
      proposal = answered.proposal;
    }
    expect(proposal.tool_id).toBe('create_follow_up_record');
    expect(proposal.grouped_operations).toEqual([
      expect.objectContaining({ operation_id: 'record-follow-up-now', tool_id: 'create_follow_up_record', selected: true }),
      expect.objectContaining({ operation_id: 'update-next-follow-up', tool_id: 'update_next_follow_up_time', selected: true }),
    ]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1')).toEqual({
      next_follow_up_at: '2026-07-13T09:00:00Z',
    });

    await confirmProposal(session, proposal, boundary);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 1 });
    const followUp = fixture.sqlite.prepare('SELECT feedback_notes, is_completed, next_follow_up_at FROM follow_up_records').get() as {
      feedback_notes: string; is_completed: number; next_follow_up_at: string | null;
    };
    expect(followUp.is_completed).toBe(1);
    expect(followUp.feedback_notes).toContain('没接');
    expect(followUp.next_follow_up_at).toBeNull();
    const customer = fixture.sqlite.prepare('SELECT next_follow_up_at, last_contacted_at FROM customers WHERE id=?').get('customer-1') as {
      next_follow_up_at: string; last_contacted_at: string;
    };
    expect(customer.next_follow_up_at).toContain('T10:00');
    expect(customer.last_contacted_at).toBeTruthy();
    fixture.close();
  });

  it('injected second-effect failure rolls back both mixed effects', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const clock = new FixedAppClock(NOW, 'Asia/Shanghai');
    const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => clock.now()), clock);
    const session = sessionForWrite('2026-07-13T09:00:00Z', NOW);
    const first = await session.submit(buildAgentIntentEnvelope('记录跟进：今天打电话没接，下周一上午 10 点再联系', NOW));
    expect(first.kind).toBe('write_proposal');
    if (first.kind !== 'write_proposal') throw new Error('expected proposal');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });

    __failOccurredFollowUpAfterInsertForTests(true);
    await expect(confirmProposal(session, first.proposal, boundary)).rejects.toThrow(/injected second-effect failure/);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 0 });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1')).toEqual({
      next_follow_up_at: '2026-07-13T09:00:00Z',
    });
    fixture.close();
  });
});

describe('Finding 2 — atomic restore/delete fail closed in Tauri production', () => {
  it('atomic restore injected failure does not apply the backup and leaves original state', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const payload = await buildFullBackupPayload(fixture.db, { version: '0.4.0' });
    payload.tables.customers = payload.tables.customers.map(row => ({ ...row, name: 'RESTORED-SHOULD-NOT-APPEAR' }));

    const executed: string[] = [];
    const originalExecute = fixture.db.execute.bind(fixture.db);
    fixture.db.execute = async (sql, bindings) => {
      executed.push(sql);
      return originalExecute(sql, bindings);
    };

    const invoked: string[] = [];
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    __setTauriAtomicInvokeForTests(async (command) => {
      invoked.push(command);
      throw new Error('injected atomic restore failure');
    });

    await expect(restoreBackupPayloadWithDb(fixture.db, payload)).rejects.toThrow(/Restore failed/);
    expect(invoked).toEqual(['restore_full_backup_atomic']);
    expect(executed.some(sql => /^DELETE FROM /i.test(sql))).toBe(false);
    expect(fixture.sqlite.prepare('SELECT name FROM customers WHERE id=?').get('customer-1')).toEqual({ name: 'Ada' });
    fixture.close();
  });

  it('non-Tauri restore still uses the same-connection adapter and succeeds', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    const payload = await buildFullBackupPayload(fixture.db, { version: '0.4.0' });
    seedCustomer(fixture.sqlite, 'customer-2');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 2 });
    await restoreBackupPayloadWithDb(fixture.db, payload);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get()).toEqual({ c: 1 });
    expect(fixture.sqlite.prepare('SELECT name FROM customers WHERE id=?').get('customer-1')).toEqual({ name: 'Ada' });
    fixture.close();
  });

  it('atomic delete injected failure does not fall back and leaves customer plus related rows', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    fixture.sqlite.prepare(
      'INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result, feedback_notes, intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run('fu-1', 'customer-1', '跟进记录', null, null, '历史', null, null, null, null, 1, NOW, NOW);

    const executed: string[] = [];
    const originalExecute = fixture.db.execute.bind(fixture.db);
    fixture.db.execute = async (sql, bindings) => {
      executed.push(sql);
      return originalExecute(sql, bindings);
    };
    __setDbInstanceForTests(fixture.db);

    const invoked: string[] = [];
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    __setTauriAtomicInvokeForTests(async (command) => {
      invoked.push(command);
      throw new Error('injected atomic delete failure');
    });

    await expect(deleteCustomer('customer-1')).rejects.toThrow(/injected atomic delete failure/);
    expect(invoked).toEqual(['delete_customer_atomic']);
    expect(executed).toEqual([]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1')).toEqual({ c: 1 });
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get('customer-1')).toEqual({ c: 1 });
    fixture.close();
  });

  it('non-Tauri delete still uses the same-connection adapter and succeeds', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    __setDbInstanceForTests(fixture.db);
    await deleteCustomer('customer-1');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1')).toEqual({ c: 0 });
    fixture.close();
  });

  it('production source does not catch atomic invoke failure and apply the backup', () => {
    const restoreSrc = readFileSync('src/lib/backupRestore.ts', 'utf8');
    const dbSrc = readFileSync('src/lib/db.ts', 'utf8');
    expect(restoreSrc).toMatch(/if \(isTauriRuntime\(\)\) \{\s*throw new Error\(`Restore failed:/);
    expect(dbSrc).toMatch(/if \(isTauriRuntime\(\)\) \{\s*await invokeTauriAtomicCommand\('delete_customer_atomic'/);
    expect(dbSrc).not.toMatch(/catch[\s\S]{0,120}deleteCustomerInSameConnectionTransaction/);
  });
});

describe('Finding 3 — central read answer shapes', () => {
  it('DIRECT_FACT: 上次联系广州ABC是什么时候', () => {
    const answer = adaptReadSuccess({
      capability_id: 'timeline.customer.read',
      utterance: '上次联系广州ABC是什么时候',
      customer_name: '广州ABC',
      payload: {
        records: [
          { kind: 'follow_up', title: '电话沟通', feedback_notes: '已确认方案', occurredAt: '2026-07-10T10:00:00+08:00', is_completed: 1 },
          { kind: 'follow_up', title: '未完成计划', occurredAt: '2026-07-12T10:00:00+08:00', is_completed: 0 },
        ],
      },
      next_follow_up_at: '2026-07-20T10:00:00+08:00',
    });
    expect(answer.shape).toBe('DIRECT_FACT');
    expect(answer.message).toMatch(/上次联系/);
    expect(answer.message).toMatch(/已确认方案/);
    expect(answer.message).toMatch(/下次跟进/);
    expect(answer.message).not.toMatch(/已读取客户资料/);
  });

  it('TIMELINE: 查看这个客户的拜访记录 is a visit list, not latest-contact only', () => {
    const answer = adaptReadSuccess({
      capability_id: 'timeline.visit.read',
      utterance: '查看这个客户的拜访记录',
      customer_name: 'Ada',
      payload: {
        records: [
          { title: '工厂参观', visited_at: '2026-07-01T09:00:00+08:00', visit_notes: '看了产线' },
          { title: '第二次拜访', visited_at: '2026-07-08T14:00:00+08:00', visit_notes: '讨论报价' },
        ],
      },
    });
    expect(answer.shape).toBe('TIMELINE');
    expect(answer.message).toMatch(/工厂参观/);
    expect(answer.message).toMatch(/第二次拜访/);
    expect(answer.message).not.toMatch(/^上次联系/);
  });

  it('LIST: 查看这个客户的跟进记录 lists completed historical follow-ups', () => {
    const answer = adaptReadSuccess({
      capability_id: 'follow_up.customer.read',
      utterance: '查看这个客户的跟进记录',
      customer_name: 'Ada',
      payload: [
        { title: '电话没接', feedback_notes: '今天打电话没接', created_at: '2026-07-10T10:00:00+08:00', is_completed: 1 },
        { title: '未来计划', feedback_notes: '周三再联系', created_at: '2026-07-16T10:00:00+08:00', is_completed: 0 },
      ],
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toMatch(/电话没接|今天打电话没接/);
    expect(answer.message).not.toMatch(/周三再联系/);
    expect(answer.message).not.toMatch(/^上次联系/);
  });

  it('LIST: global follow-up includes customer/time/content, not count-only', () => {
    const answer = adaptReadSuccess({
      capability_id: 'follow_up.global.read',
      utterance: '最近所有客户的跟进记录有哪些？',
      payload: [
        { customer_id: 'c1', title: '报价跟进', feedback_notes: '客户要方案', created_at: '2026-07-10T10:00:00+08:00', is_completed: 1 },
        { customer_id: 'c2', title: '回访', feedback_notes: '未接通', created_at: '2026-07-09T10:00:00+08:00', is_completed: 1 },
      ],
      customer_names: { c1: '广州ABC', c2: '深圳星河' },
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toMatch(/广州ABC/);
    expect(answer.message).toMatch(/深圳星河/);
    expect(answer.message).toMatch(/报价跟进|客户要方案/);
    expect(answer.message).not.toMatch(/^共读取 \d+ 条$/);
  });

  it('CUSTOMER_SUMMARY: 查一下这个客户资料 returns key customer fields', () => {
    const answer = adaptReadSuccess({
      capability_id: 'customer.context',
      utterance: '查一下这个客户资料',
      customer_name: '广州ABC',
      payload: {},
      customer_facts: {
        name: '广州ABC',
        customer_grade: 'A',
        region: '华南',
        industry: '贸易',
        contact_person: '李四',
        opportunity_amount: 200000,
        last_contacted_at: '2026-07-10T10:00:00+08:00',
      },
    });
    expect(answer.shape).toBe('CUSTOMER_SUMMARY');
    expect(answer.message).toMatch(/客户：广州ABC/);
    expect(answer.message).toMatch(/等级：A/);
    expect(answer.message).toMatch(/行业：贸易/);
    expect(answer.message).not.toBe('已读取客户资料');
  });

  it('LIST: 这个客户还有什么任务 lists title/due/status', () => {
    const answer = adaptReadSuccess({
      capability_id: 'task.read_by_customer',
      utterance: '这个客户还有什么任务？',
      payload: [
        { title: '发送报价', due_at: '2026-07-20T10:00:00+08:00', status: 'OPEN', priority: 'HIGH' },
        { title: '确认合同', due_at: '2026-07-22T15:00:00+08:00', status: 'DONE', priority: 'MEDIUM' },
      ],
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toMatch(/发送报价/);
    expect(answer.message).toMatch(/确认合同/);
    expect(answer.message).toMatch(/未完成|已完成/);
    expect(answer.message).not.toMatch(/已读取任务/);
    expect(answer.message).not.toContain('已根据 CRM 记录完成读取');
  });

  it('LIST: empty tasks say there are none', () => {
    const answer = adaptReadSuccess({
      capability_id: 'task.read_by_customer',
      utterance: '查看这个客户的任务',
      payload: [],
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toBe('这个客户目前没有任务。');
  });

  it('CUSTOMER_SUMMARY: current battle card projects existing card fields', () => {
    const answer = adaptReadSuccess({
      capability_id: 'battle_card.current.read',
      utterance: '看看当前作战卡',
      payload: {
        customer_id: 'customer-1',
        read_only: true,
        writes_crm: false,
        data: {
          stage_code: 'VISIT_READY',
          version: 2,
          card_status: 'CONFIRMED',
          payload_json: JSON.stringify({
            action_card: {
              current_situation: '已约访下周',
              stage_goal: '完成首次面访',
              next_best_action: { objective: '确认到访时间' },
            },
          }),
        },
      },
    });
    expect(answer.shape).toBe('CUSTOMER_SUMMARY');
    expect(answer.message).toMatch(/可约访/);
    expect(answer.message).toMatch(/已确认/);
    expect(answer.message).toMatch(/已约访下周/);
    expect(answer.message).toMatch(/确认到访时间/);
    expect(answer.message).not.toContain('已根据 CRM 记录完成读取');
  });

  it('CUSTOMER_SUMMARY: missing current battle card is truthful', () => {
    const answer = adaptReadSuccess({
      capability_id: 'battle_card.current.read',
      utterance: '这个客户现在的作战卡是什么？',
      payload: { customer_id: 'customer-1', read_only: true, writes_crm: false, data: null },
    });
    expect(answer.shape).toBe('CUSTOMER_SUMMARY');
    expect(answer.message).toBe('这个客户目前没有作战卡。');
  });

  it('LIST: battle card history lists version/status/time without dominating ids', () => {
    const answer = adaptReadSuccess({
      capability_id: 'battle_card.history.read',
      utterance: '看看这个客户以前的作战卡',
      payload: {
        customer_id: 'customer-1',
        read_only: true,
        writes_crm: false,
        data: [
          { id: 'card-uuid-1', stage_code: 'NEW_LEAD', version: 1, card_status: 'CONFIRMED', created_at: '2026-07-01T09:00:00+08:00', confirmed_at: '2026-07-01T10:00:00+08:00' },
          { id: 'card-uuid-2', stage_code: 'CONTACTED', version: 2, card_status: 'DRAFT', created_at: '2026-07-08T09:00:00+08:00', confirmed_at: null },
        ],
      },
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toMatch(/新线索/);
    expect(answer.message).toMatch(/v1/);
    expect(answer.message).toMatch(/草稿/);
    expect(answer.message).not.toContain('card-uuid-1');
  });

  it('LIST: empty battle card history is truthful', () => {
    const answer = adaptReadSuccess({
      capability_id: 'battle_card.history.read',
      utterance: '作战卡历史有哪些？',
      payload: { customer_id: 'customer-1', read_only: true, writes_crm: false, data: [] },
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toBe('这个客户目前没有作战卡历史。');
  });

  it('CUSTOMER_SUMMARY: battle card context keeps facts and hypotheses distinct', () => {
    const answer = adaptReadSuccess({
      capability_id: 'battle_card.context.read',
      utterance: '当前有哪些事实和假设？',
      payload: {
        customer_id: 'customer-1',
        read_only: true,
        writes_crm: false,
        data: {
          current_stage_card: { stage_code: 'VISITED', version: 3, card_status: 'CONFIRMED' },
          verified_facts: [{ id: 'fact-1', statement: '客户已完成面访', applicability: 'THIS_CUSTOMER' }],
          hypotheses: [{ id: 'hyp-1', statement: '可能本月签约', status: 'OPEN' }],
        },
      },
    });
    expect(answer.shape).toBe('CUSTOMER_SUMMARY');
    expect(answer.message).toMatch(/事实：/);
    expect(answer.message).toMatch(/客户已完成面访/);
    expect(answer.message).toMatch(/假设：/);
    expect(answer.message).toMatch(/可能本月签约/);
    expect(answer.message).not.toMatch(/把假设当成事实|已核实假设/);
    expect(answer.message).not.toContain('fact-1');
  });

  it('CUSTOMER_SUMMARY: missing battle context sections are not fabricated', () => {
    const answer = adaptReadSuccess({
      capability_id: 'battle_card.context.read',
      utterance: '看看这个客户作战卡的上下文',
      payload: {
        customer_id: 'customer-1',
        read_only: true,
        writes_crm: false,
        data: { schema_version: 'battle-card-payload-v1' },
      },
    });
    expect(answer.shape).toBe('CUSTOMER_SUMMARY');
    expect(answer.message).not.toMatch(/事实：/);
    expect(answer.message).not.toMatch(/假设：/);
    expect(answer.message).not.toContain('已根据 CRM 记录完成读取');
  });

  it('LIST: import preview renders sheet/headers/rows from actual payload', () => {
    const answer = adaptReadSuccess({
      capability_id: 'import.file.preview',
      utterance: '预览这份导入文件',
      payload: {
        sheetName: '客户表',
        headers: ['公司名称', '行业', '地区'],
        rows: [['广州ABC', '贸易', '华南'], ['深圳星河', '软件', '华南']],
        autoMapping: [{ sourceColumn: '公司名称', crmField: 'name' }],
      },
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toMatch(/客户表/);
    expect(answer.message).toMatch(/公司名称/);
    expect(answer.message).toMatch(/广州ABC/);
    expect(answer.message).not.toContain('已完成读取');
  });

  it('LIST: missing import file context is truthful', () => {
    const answer = adaptReadSuccess({
      capability_id: 'import.file.preview',
      utterance: '预览导入文件',
      payload: {},
    });
    expect(answer.shape).toBe('LIST');
    expect(answer.message).toMatch(/没有可预览的导入文件/);
    expect(answer.message).not.toContain('已完成读取');
  });

  it('DIRECT_FACT: valid import mapping says it is valid', () => {
    const answer = adaptReadSuccess({
      capability_id: 'import.mapping.validate',
      utterance: '这个导入映射可以吗？',
      payload: { valid: true, errors: [] },
    });
    expect(answer.shape).toBe('DIRECT_FACT');
    expect(answer.message).toBe('导入字段映射有效。');
  });

  it('DIRECT_FACT: invalid import mapping lists actual errors', () => {
    const answer = adaptReadSuccess({
      capability_id: 'import.mapping.validate',
      utterance: '校验一下导入字段映射',
      payload: { valid: false, errors: ['请至少配置“客户名称”字段映射才能导入', '字段“行业”被多列重复映射'] },
    });
    expect(answer.shape).toBe('DIRECT_FACT');
    expect(answer.message).toMatch(/导入字段映射无效/);
    expect(answer.message).toMatch(/客户名称/);
    expect(answer.message).not.toBe('校验完成');
  });

  it('controller visit list is not collapsed to last-contact copy', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedCustomer(fixture.sqlite);
    fixture.sqlite.prepare(
      'INSERT INTO visit_records (id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit, visit_outcome, next_action, expected_contract_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run('visit-1', 'customer-1', '工厂参观', '2026-07-01T09:00:00+08:00', '看了产线', null, null, null, null, null, NOW, NOW);
    __setDbInstanceForTests(fixture.db);
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => sessionForWrite(),
      clock: () => NOW,
      model_planner: async () => ({ kind: 'invoke', capability_id: 'timeline.visit.read', arguments: {} }),
    });
    controller.syncExternalScope('customer-1', 'Ada');
    const turn = await controller.submit('查看这个客户的拜访记录');
    expect(turn.state.latest_direct_answer?.shape).toBe('TIMELINE');
    expect(turn.state.agent_message).toMatch(/工厂参观/);
    expect(turn.state.agent_message).not.toMatch(/^上次联系/);
    fixture.close();
  });

  it('covers every chat-exposed READ/ANALYZE capability without generic fallthrough', () => {
    const emptyPayload: Record<string, unknown> = {
      'customer.search': { candidates: [] },
      'customer.get': {},
      'customer.context': {},
      'timeline.customer.read': { records: [] },
      'timeline.visit.read': { records: [] },
      'follow_up.customer.read': [],
      'follow_up.global.read': [],
      'task.read_by_customer': [],
      'battle_card.current.read': { read_only: true, data: null },
      'battle_card.history.read': { read_only: true, data: [] },
      'battle_card.context.read': { read_only: true, data: {} },
      'import.file.preview': {},
      'import.mapping.validate': { valid: true, errors: [] },
    };
    const reads = PRODUCTION_PLANNER_TOOL_SURFACE.filter(item => item.effect === 'READ' || item.effect === 'ANALYZE');
    expect(reads.map(item => item.capability_id).sort()).toEqual(Object.keys(emptyPayload).sort());
    for (const tool of reads) {
      const answer = adaptReadSuccess({
        capability_id: tool.capability_id,
        utterance: '查看',
        payload: emptyPayload[tool.capability_id],
      });
      expect(answer.message, tool.capability_id).not.toBe('已根据 CRM 记录完成读取。');
      expect(answer.headline, tool.capability_id).not.toBe('已完成读取');
    }
  });
});

describe('Finding 4 — Guangzhou name search vs explicit region', () => {
  it.each([
    ['广州客户有哪些', { name_query: '广州' }],
    ['找一下广州客户', { name_query: '广州' }],
    ['列出广州客户', { name_query: '广州' }],
    ['广州 C 级客户', { name_query: '广州', customer_grade: 'C' }],
    ['广州机械设备客户', { name_query: '广州', industry: '机械设备' }],
    ['广州做机械设备的公司', { name_query: '广州', industry: '机械设备' }],
  ] as const)('%s keeps name contains 广州 and does not set region', (utterance, expected) => {
    const query = interpretCustomerQuery(utterance);
    expect(query).toMatchObject({ ...expected, explicit_region: false });
    expect(query.region).toBeUndefined();
    const normalized = normalizeCustomerSearchFilters(utterance, NOW);
    expect(normalized.filters).toMatchObject(expected);
    expect(normalized.filters.region).toBeUndefined();
  });

  it('广州地区的机械设备客户 uses explicit geo as region', () => {
    const query = interpretCustomerQuery('广州地区的机械设备客户');
    expect(query).toMatchObject({ region: '广州', industry: '机械设备', explicit_region: true });
    expect(query.name_query).toBeUndefined();
    expect(normalizeCustomerSearchFilters('广州地区的机械设备客户', NOW).filters).toMatchObject({
      region: '广州',
      industry: '机械设备',
    });
  });

  it('位于广州的 C 级客户 uses explicit geo + grade', () => {
    expect(interpretCustomerQuery('位于广州的 C 级客户')).toMatchObject({
      region: '广州',
      customer_grade: 'C',
      explicit_region: true,
    });
    expect(normalizeCustomerSearchFilters('位于广州的 C 级客户', NOW).filters).toMatchObject({
      region: '广州',
      customer_grade: 'C',
    });
  });

  it('上次联系广州ABC是什么时候 is a named entity, not region=广州', () => {
    const query = interpretCustomerQuery('上次联系广州ABC是什么时候');
    expect(query.direct_fact).toBe('last_contact');
    expect(query.name_query).toMatch(/广州ABC/);
    expect(query.explicit_region).toBe(false);
    expect(query.region).toBeUndefined();
    expect(normalizeCustomerSearchFilters('上次联系广州ABC是什么时候', NOW).filters.region).toBeUndefined();
  });
});
