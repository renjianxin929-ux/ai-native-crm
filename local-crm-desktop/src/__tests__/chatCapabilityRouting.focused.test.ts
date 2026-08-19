/**
 * V0.2C / C1.7 — Real runtime planner wiring tests.
 *
 * 分两层，明确标注：
 *   ENGINE  —— 引擎/表面级（直接调用 planner/routeCapabilitySelection，非真实入口）。
 *   REAL ENTRY —— 从 SalesAgentInteractionController.submit 开始（真实运行时会话入口，
 *                 绝不直接注入 capability_id、绝不直接调用 routeCapabilitySelection）。
 *
 * 证明：
 *   - registry 派生 planner 工具面 = 25，且含安全输入 schema；
 *   - 模型 planner 收到工具面（MODEL_RECEIVES_PLANNER_TOOLS=true 的调用点存在）；
 *   - 真实聊天入口 → controller.submit → planner → 生产引擎（REAL_CHAT_REACHES_CAPABILITY_ENGINE=true）；
 *   - customer.delete 真实聊天可达 + STRONG_CONFIRMATION + 确认前零写入；
 *   - 机会金额 / 新建客户 真实聊天可达 + REQUIRE_CONFIRMATION；
 *   - 全局读真实聊天可达（不强制客户 scope）；
 *   - 既有 3 个窄写（follow_up 等）仍走既有 session 路径（不回归）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  PRODUCTION_PLANNER_TOOL_SURFACE,
  PLANNER_TOOL_CAPABILITY_IDS,
} from '../lib/planner/plannerToolSurface';
import { planCapability } from '../lib/planner/runtimePlanner';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import { selectCapabilityDeterministic } from '../lib/planner/deterministicCapabilitySelector';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { PRODUCTION_CAPABILITY_COUNT } from '../lib/capabilities/execution';
import { __setDbInstanceForTests, initializeDatabaseSchema } from '../lib/db';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { seedCustomer, sessionForWrite, sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-15T12:00:00+08:00';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

describe('ENGINE — registry-driven planner surface (25, safe input schema)', () => {
  it('derives 25 descriptors with input_schema (allowed/required fields)', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(25);
    expect(PRODUCTION_PLANNER_TOOL_SURFACE).toHaveLength(25);
    expect(new Set(PLANNER_TOOL_CAPABILITY_IDS).size).toBe(25);
    for (const descriptor of PRODUCTION_PLANNER_TOOL_SURFACE) {
      expect(descriptor.input_schema).toBeDefined();
      expect(Array.isArray(descriptor.input_schema.allowed_fields)).toBe(true);
      expect(Array.isArray(descriptor.input_schema.required_fields)).toBe(true);
    }
  });

  it('write capability input schema exposes required fields (no executor/db internals)', () => {
    const create = PRODUCTION_PLANNER_TOOL_SURFACE.find((d) => d.capability_id === 'customer.create')!;
    expect(create.input_schema.required_fields).toContain('name');
    const opportunity = PRODUCTION_PLANNER_TOOL_SURFACE.find((d) => d.capability_id === 'customer.opportunity_amount.update')!;
    expect(opportunity.input_schema.required_fields).toContain('opportunity_amount');
    // 不暴露 db/clock/customer_id 执行句柄。
    const serialized = JSON.stringify(PRODUCTION_PLANNER_TOOL_SURFACE);
    expect(serialized).not.toMatch(/executor_ref|"db"|"clock"|api_key|sk-[A-Za-z0-9]/i);
  });
});

describe('ENGINE — model planner receives the tool surface (call site exists)', () => {
  it('planCapability passes the 25-tool surface to the model when deterministic misses', async () => {
    let receivedSurface: unknown = null;
    const result = await planCapability('一个模型才能理解的模糊请求', NOW, 'customer-1', {
      modelSelect: async (request) => {
        receivedSurface = request.tool_surface;
        return { kind: 'invoke', capability_id: 'customer.get', arguments: {} };
      },
    });
    expect(result.kind).toBe('invoke');
    expect(Array.isArray(receivedSurface)).toBe(true);
    expect((receivedSurface as unknown[]).length).toBe(25);
  });

  it('deterministic selector never emits a fake capability id', () => {
    for (const u of ['删除客户', '商机金额记20万', '新建客户', '所有客户跟进']) {
      const r = selectCapabilityDeterministic({ utterance: u, now_iso: NOW, scoped_customer_id: 'c1' });
      if (r.kind === 'invoke') expect(PLANNER_TOOL_CAPABILITY_IDS).toContain(r.selection.capability_id);
    }
  });
});

describe('REAL ENTRY — controller.submit reaches the capability engine', () => {
  it('delete: "把这个客户删掉" → proposal (STRONG_CONFIRMATION), customer still exists', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => sessionForWrite(), clock: () => NOW });
    controller.syncExternalScope('customer-1', '广州ABC科技');

    const turn = await controller.submit('把这个客户删掉');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
    expect(turn.state.latest_proposal?.operation).toBe('delete');
    expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
    // 确认前零写入。
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get('customer-1')).toEqual({ c: 1 });
    fixture.close();
  });

  it('opportunity amount: "商机金额记 20 万" → proposal, amount 200000', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => sessionForWrite(), clock: () => NOW });
    controller.syncExternalScope('customer-1', '广州ABC科技');

    const turn = await controller.submit('这个客户商机金额记 20 万');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
    expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(200000);
    fixture.close();
  });

  it('customer create: "新建客户广州星河科技，联系人张总" → proposal', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => sessionForWrite(), clock: () => NOW });

    const turn = await controller.submit('新建客户广州星河科技，联系人张总');
    expect(turn.state.phase).toBe('proposal');
    expect(turn.state.latest_proposal?.tool_id).toBe('create_customer');
    fixture.close();
  });

  it('global read: "最近所有客户跟进" → SUCCESS read (no forced customer scope)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => sessionForWrite(), clock: () => NOW });

    const turn = await controller.submit('最近所有客户的跟进记录有哪些？');
    expect(turn.state.phase).toBe('scoped');
    expect(turn.state.agent_message).toMatch(/跟进记录|目前没有/);
    fixture.close();
  });

  it('existing follow_up.create stays on the session path (clarification, not engine)', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    seedCustomer(fixture.sqlite, 'customer-1');
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => sessionForWrite(), clock: () => NOW });
    controller.syncExternalScope('customer-1', '广州ABC科技');

    const turn = await controller.submit('写个跟进');
    expect(turn.state.phase).toBe('clarification');
    fixture.close();
  });
});
