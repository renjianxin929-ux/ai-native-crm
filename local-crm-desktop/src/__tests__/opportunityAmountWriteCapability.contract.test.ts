/**
 * V0.2C / C0 — Opportunity Amount Write Capability + Data Foundation 契约测试。
 *
 * 证明 C0 数据基础的硬性不变量（DB schema / 写路径 / 确认前零写入 / 跨客户隔离 /
 * deal_amount 语义不被重解释 / B1 Evidence 不变）：
 *   - 新增窄义可空列 customers.opportunity_amount（REAL, nullable）；
 *   - deal_amount（成交金额）语义保持独立，绝不重解释；
 *   - Agent 只能 PROPOSE 商机金额，人工确认前零写入（PRE_CONFIRM_WRITES=0）；
 *   - 确认后经现有 confirmed-write 流写入，仅写 opportunity_amount 列；
 *   - 值闭合：有限正数 或 null（unknown/清除），负/零/NaN/字符串拒绝；
 *   - 客户 A 的金额绝不能改变客户 B；
 *   - 原 24 能力保留（现 25），B1 Evidence 架构不变。
 *
 * 原则：只用隔离测试 DB（better-sqlite3 :memory:），绝不触碰真实用户 CRM 数据。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PRODUCTION_CAPABILITY_BINDING_REGISTRY,
  PRODUCTION_CAPABILITY_COUNT,
  PRODUCTION_CAPABILITY_EXECUTION,
  PRODUCTION_CAPABILITY_IDS,
  PRODUCTION_CAPABILITY_REGISTRY,
} from '../lib/capabilities/execution';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';
import {
  OPPORTUNITY_AMOUNT_UPDATE_CAPABILITY_IDS,
  OPPORTUNITY_AMOUNT_UPDATE_MANIFEST,
} from '../lib/capabilities/customer/opportunityAmountUpdateManifest';

import {
  __setDbInstanceForTests,
  createCustomer,
  getCustomer,
  type DatabaseLike,
} from '../lib/db';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  __resetSessionWriteStateStoreForTests,
  getCanonicalProposal,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { validateAgentWriteProposal, type AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { updateCustomerOpportunityAmount } from '../lib/customerOpportunityAmountUpdate';
import { sqliteFixture } from './salesAgentProductionHarness';

function openFixture() {
  const fixture = sqliteFixture();
  return fixture;
}

/** 初始化隔离 fixture 并把它设为全局 db 实例（供 createCustomer/getCustomer/updateCustomer）。 */
async function openSeededFixture(): Promise<ReturnType<typeof openFixture>> {
  const fixture = openFixture();
  await fixture.initialize();
  __setDbInstanceForTests(fixture.db);
  return fixture;
}

/** 种子客户（走全局 createCustomer = fixture db）。 */
async function seedCustomer(id: string, name = '客户'): Promise<void> {
  await createCustomer(
    id, name, 'WECHAT', null, null, null, 0, 'C', 'NOT_ADDED', 'UNKNOWN', null,
    null, null, 'NOT_PARSED', null, null, null,
    null, null, null, null, null, null, null, null, null,
  );
}

async function confirmViaExistingFlow(proposal: AgentWriteProposal): Promise<{ entity_id: string; fields: readonly string[] }> {
  const session = new SalesAgentSession(proposal.customer_id, null, () => SALES_AGENT_APP_CLOCK.now(), undefined);
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce ?? '',
    confirmed_at: SALES_AGENT_APP_CLOCK.now(),
  }, approvedCrmWriteBoundary) as Promise<{ entity_id: string; fields: readonly string[] }>;
}

/** 能力路径：invoke customer.opportunity_amount.update → 确认交接 → 人工确认后执行。 */
async function capabilityOpportunityAmountPath(
  db: DatabaseLike,
  scopeCustomerId: string,
  opportunity_amount: number | null,
): Promise<{ customer_id: string; fields: readonly string[] }> {
  const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
    capability_id: 'customer.opportunity_amount.update',
    capability_version: '1.0.0',
    input: { db, opportunity_amount },
    scope: { customer_id: scopeCustomerId },
  });
  expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  if (outcome.status !== 'CONFIRMATION_REQUIRED') throw new Error('unreachable');
  const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
  expect(proposal).not.toBeNull();
  expect(proposal!.tool_id).toBe('update_opportunity_amount');
  const result = await confirmViaExistingFlow(proposal!);
  expect(result.entity_id).toBe(scopeCustomerId);
  return { customer_id: scopeCustomerId, fields: result.fields };
}

beforeEach(() => {
  __resetSessionWriteStateStoreForTests();
});

afterEach(() => {
  __setDbInstanceForTests(null);
});

/* ================================================================== */
/* T1 — DB SCHEMA: 窄义可空商机金额列                                    */
/* ================================================================== */

describe('C0 T1 — schema: customers.opportunity_amount is a narrow nullable REAL column', () => {
  it('adds opportunity_amount REAL nullable; deal_amount remains separate', async () => {
    const fixture = await openSeededFixture();
    try {
      const cols = await fixture.db.select<{ name: string; type: string; notnull: number }>(
        'PRAGMA table_info(customers)',
      );
      const amount = cols.find((c) => c.name === 'opportunity_amount');
      expect(amount).toBeDefined();
      expect(amount!.type.toUpperCase()).toBe('REAL');
      expect(amount!.notnull).toBe(0);
      // deal_amount 仍是独立列（成交金额），未被重解释/删除。
      expect(cols.some((c) => c.name === 'deal_amount')).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it('a freshly created customer has opportunity_amount = null (unknown), never a fake default', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      const customer = await getCustomer('cust-a');
      expect(customer).not.toBeNull();
      expect(customer!.opportunity_amount).toBeNull();
      expect(customer!.deal_amount).toBeNull();
    } finally {
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T2 — 写路径：Agent 只能提案，确认前零写入                              */
/* ================================================================== */

describe('C0 T2 — write path: proposal requires confirmation; pre-confirm writes = 0', () => {
  it('invoking the capability yields CONFIRMATION_REQUIRED and does not write before confirmation', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      const before = await getCustomer('cust-a');
      expect(before!.opportunity_amount).toBeNull();

      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.opportunity_amount.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, opportunity_amount: 50000 },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      expect(outcome.confirmation_handoff).toBeDefined();

      // 确认前零写入：DB 中 opportunity_amount 仍为 null。
      const afterHandoff = await getCustomer('cust-a');
      expect(afterHandoff!.opportunity_amount).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('the registered proposal is canonical, validated, and carries current vs proposed values', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.opportunity_amount.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, opportunity_amount: 50000 },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
      expect(proposal).not.toBeNull();
      expect(proposal!.tool_id).toBe('update_opportunity_amount');
      expect(proposal!.customer_id).toBe('cust-a');
      expect(proposal!.current_values).toEqual({ opportunity_amount: null });
      expect(proposal!.proposed_values).toEqual({ opportunity_amount: 50000 });
      // allowedFields Layer 2 闭合：提案通过权威校验。
      expect(() => validateAgentWriteProposal(proposal!)).not.toThrow();
    } finally {
      fixture.close();
    }
  });

  it('value is closed: rejects negative / zero / NaN / Infinity / string; accepts positive number and null', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      const invoke = (amount: unknown) => PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.opportunity_amount.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, opportunity_amount: amount },
        scope: { customer_id: 'cust-a' },
      });
      for (const bad of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, '50000', {}]) {
        const outcome = await invoke(bad);
        expect(outcome.status).toBe('EXECUTION_ERROR');
      }
      // 合法：正数 与 null（清除为 unknown）。
      const pos = await invoke(50000);
      expect(pos.status).toBe('CONFIRMATION_REQUIRED');
      __resetSessionWriteStateStoreForTests();
      const clear = await invoke(null);
      expect(clear.status).toBe('CONFIRMATION_REQUIRED');
    } finally {
      fixture.close();
    }
  });

  it('customer scope is authoritative; input cannot smuggle another customer id', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      await seedCustomer('cust-b', '客户B');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.opportunity_amount.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, opportunity_amount: 50000, customer_id: 'cust-b' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
    } finally {
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T3 — 确认后执行：只写 opportunity_amount，不碰 deal_amount/状态        */
/* ================================================================== */

describe('C0 T3 — post-confirm execution writes only opportunity_amount', () => {
  it('writes the confirmed amount; deal_amount and stage stay untouched', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      const result = await capabilityOpportunityAmountPath(fixture.db, 'cust-a', 50000);
      expect(result.fields).toEqual(['opportunity_amount']);

      const after = await getCustomer('cust-a');
      expect(after!.opportunity_amount).toBe(50000);
      expect(after!.deal_amount).toBeNull();
      expect(after!.stage).toBe('NEW_LEAD');
      expect(after!.payment_status).toBe('NOT_STARTED');
    } finally {
      fixture.close();
    }
  });

  it('explicit null clears the amount back to unknown (UNKNOWN_AMOUNT_IS_NULL)', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      await capabilityOpportunityAmountPath(fixture.db, 'cust-a', 50000);
      expect((await getCustomer('cust-a'))!.opportunity_amount).toBe(50000);

      await capabilityOpportunityAmountPath(fixture.db, 'cust-a', null);
      expect((await getCustomer('cust-a'))!.opportunity_amount).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('customer A amount cannot mutate customer B (cross-customer isolation)', async () => {
    const fixture = await openSeededFixture();
    try {
      await seedCustomer('cust-a');
      await seedCustomer('cust-b', '客户B');

      await capabilityOpportunityAmountPath(fixture.db, 'cust-a', 50000);

      const a = await getCustomer('cust-a');
      const b = await getCustomer('cust-b');
      expect(a!.opportunity_amount).toBe(50000);
      expect(b!.opportunity_amount).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('the Layer-3 shared service rejects unknown customer with truthful failure (zero write)', async () => {
    const fixture = await openSeededFixture();
    try {
      await expect(updateCustomerOpportunityAmount('does-not-exist', 100)).rejects.toThrow(/does not exist/);
    } finally {
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T4 — 能力/绑定/库存真相                                              */
/* ================================================================== */

describe('C0 T4 — capability/binding/inventory truth', () => {
  it('registers the one narrow identity with frozen metadata', () => {
    const definitions = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'customer.opportunity_amount.update');
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.version).toBe('1.0.0');
    expect(definition.domain).toBe('customer');
    expect(definition.effect).toBe('WRITE');
    expect(definition.data_target).toBe('CRM_FACT');
    expect(definition.risk_level).toBe('MEDIUM');
    expect(definition.requires_confirmation).toBe(true);
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_opportunity_amount');
    expect(Object.isFrozen(definition)).toBe(true);
    // 描述必须明确：不是通用 customer.update，不重解释 deal_amount。
    expect(definition.description).toMatch(/NOT a generic customer\.update/i);
    expect(definition.description).toMatch(/must not reinterpret or mutate deal_amount/i);

    expect(OPPORTUNITY_AMOUNT_UPDATE_MANIFEST.map((d) => d.id)).toEqual(['customer.opportunity_amount.update']);
    expect(OPPORTUNITY_AMOUNT_UPDATE_CAPABILITY_IDS.update).toBe('customer.opportunity_amount.update');
  });

  it('A10 evaluates to REQUIRE_CONFIRMATION (human confirmation before persistence)', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.opportunity_amount.update', '1.0.0');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
  });

  it('executor_ref is truthfully bound (no unbound capability)', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.opportunity_amount.update', '1.0.0');
    const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref);
    expect(binding).toBeDefined();
    expect(binding!.executor_ref).toBe('salesAgentWriteTool:update_opportunity_amount');
  });

  it('production capability count = 25; original 24 identities are preserved', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(25);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(25);
    // 原 24 能力身份全部保留（追加，而非替换）。
    const original24 = [
      'customer.search', 'customer.get', 'customer.context',
      'timeline.customer.read', 'timeline.visit.read',
      'follow_up.customer.read', 'follow_up.global.read',
      'task.read_by_customer',
      'battle_card.current.read', 'battle_card.history.read', 'battle_card.context.read',
      'import.file.preview', 'import.mapping.validate',
      'customer.next_follow_up_time.update', 'follow_up.create', 'task.create',
      'battle_card.draft.create', 'battle_card.confirm', 'battle_card.hypothesis.status.update',
      'battle_card.intelligence_import.confirm',
      'customer.create', 'customer.profile.update', 'customer.delete', 'visit.create',
    ];
    for (const id of original24) {
      expect(PRODUCTION_CAPABILITY_IDS).toContain(id);
    }
    expect(PRODUCTION_CAPABILITY_IDS).toContain('customer.opportunity_amount.update');
    expect(new Set(PRODUCTION_CAPABILITY_IDS).size).toBe(25);
  });

  it('B1 Evidence architecture is unchanged (empty manifest, no evidence write identity)', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    expect(PRODUCTION_CAPABILITY_IDS.some((id) => id.startsWith('evidence'))).toBe(false);
  });
});
