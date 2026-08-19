/**
 * V0.2A / A2 — Customer Read Capabilities 聚焦测试。
 *
 * 覆盖规格 T1–T12,并提供第 20 节要求的真实数据路径集成证据
 * (capability adapter 到达产品同一条 Customer 读取数据路径)。
 *
 * 原则:
 * - 不修改任何现有文件;只新增本测试与 capabilities/customer/** 模块。
 * - 不弱化/替换任何既有测试。
 * - 静态架构证据扫描 capabilities/customer/** 源码,保证零写、零模型、零网络。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCapabilityRegistry,
  DuplicateCapabilityError,
  type CapabilityDefinition,
} from '../lib/capabilities';
import {
  CUSTOMER_CAPABILITY_MANIFEST,
  CUSTOMER_READ_CAPABILITY_DEFINITIONS,
  CUSTOMER_READ_INVENTORY,
  VERIFIED_CUSTOMER_READ_CANDIDATES,
  getCustomerRead,
  readCustomerContextRead,
  searchCustomersRead,
} from '../lib/capabilities/customer';
import { buildWorkspaceContextSnapshot } from '../lib/context/workspaceContextAdapter';
import type { ContextSnapshot } from '../lib/context/types';
import type { DatabaseLike } from '../lib/db';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import {
  buildReadOnlySnapshotLoaderPlan,
  loadReadOnlySnapshotFromDb,
} from '../lib/readOnlySnapshotLoaderReadiness';
import { executeSalesAgentReadTool } from '../lib/salesAgentTools/registry';
import { executeSearchCustomersTool } from '../lib/salesAgentTools/executeSearchCustomersTool';
import { normalizeCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';
import type { NormalizedCustomerSearchFilters } from '../lib/salesAgentTools/filterNormalization';
import { openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';

const NOW = '2026-07-14T12:00:00.000Z';

/** 与产品路径一致的 snapshot fixture(两个客户,含任务)。 */
function snapshotFixture(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'a2-contract-fixture',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [
      {
        id: 'customer-1',
        name: 'Ada',
        customer_grade: 'A',
        intent_level: 'HIGH',
        evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true },
      },
      {
        id: 'customer-2',
        name: 'Ben',
        customer_grade: 'B',
        intent_level: 'MEDIUM',
        evidence_ref: { type: 'customer', id: 'customer-2', label: 'Ben', synthetic: false, persisted: true },
      },
    ],
    tasks: [
      {
        id: 'task-1',
        customer_id: 'customer-1',
        title: '跟进报价',
        due_at: '2026-07-15T00:00:00.000Z',
        status: 'TODO',
        priority: 2,
        evidence_ref: { type: 'task', id: 'task-1', label: '跟进报价', synthetic: false, persisted: true },
      },
    ],
    work_items: [],
    collected_leads: [],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
}

/** 与产品投影一致的 ContextSnapshot fixture。 */
function contextFixture(snapshot: LoadedReadOnlyAgentSnapshot): ContextSnapshot {
  return buildWorkspaceContextSnapshot(snapshot);
}

const AUDIT_READ = {
  audit_required: false,
  record_input: false,
  record_output: false,
  record_effect: false,
} as const;

describe('T1 — MANIFEST CONTRACT: all real Customer read capabilities conform to A1 CapabilityDefinition', () => {
  it('every manifest definition passes A1 validation with explicit read-only semantics', () => {
    expect(CUSTOMER_CAPABILITY_MANIFEST.length).toBeGreaterThan(0);
    for (const definition of CUSTOMER_CAPABILITY_MANIFEST) {
      expect(() => createCapabilityRegistry([definition])).not.toThrow();
      expect(definition.effect).toBe('READ');
      expect(definition.data_target).toBe('CRM_FACT');
      expect(definition.risk_level).toBe('LOW');
      expect(definition.authority_policy).toBe('AUTO');
      expect(definition.requires_confirmation).toBe(false);
      expect(definition.idempotency).toBe('SAFE');
      expect(definition.error_contract).toBe('DISTINGUISHABLE');
      expect(definition.audit_contract).toEqual(AUDIT_READ);
      expect(definition.executor_ref).toMatch(/^salesAgentTool:/);
    }
  });

  it('scope semantics are truthful: search is portfolio/global, get/context require explicit customer scope', () => {
    const byId = new Map(CUSTOMER_CAPABILITY_MANIFEST.map((d) => [d.id, d]));
    expect(byId.get('customer.search')?.scope_requirement).toBe('GLOBAL');
    expect(byId.get('customer.get')?.scope_requirement).toBe('CUSTOMER');
    expect(byId.get('customer.context')?.scope_requirement).toBe('CUSTOMER');
  });
});

describe('T2 — REGISTRY COMPOSITION: customer manifest composes via the frozen A1 extension seam', () => {
  it('composes into the A1 registry without any central switch modification', () => {
    const registry = createCapabilityRegistry(CUSTOMER_CAPABILITY_MANIFEST);
    expect(registry.size()).toBe(3);
    expect(registry.listByDomain('customer').map((d) => d.id)).toEqual([
      'customer.search',
      'customer.get',
      'customer.context',
    ]);
    expect(registry.get('customer.search', '1.0.0').executor_ref).toBe('salesAgentTool:search_customers');
    expect(registry.get('customer.get', '1.0.0').executor_ref).toBe('salesAgentTool:get_customer');
    expect(registry.get('customer.context', '1.0.0').executor_ref).toBe('salesAgentTool:get_customer_context');
  });

  it('co-exists with other independent domain manifests (A4R/A5R/A6R parallel-safety), duplicates rejected', () => {
    const foreignManifest: readonly CapabilityDefinition[] = [
      {
        id: 'timeline.read',
        version: '1.0.0',
        domain: 'timeline',
        description: 'parallel fixture domain manifest',
        input_schema: 'fixture.v1',
        output_schema: 'fixture.v1',
        effect: 'READ',
        data_target: 'CRM_FACT',
        risk_level: 'LOW',
        authority_policy: 'AUTO',
        requires_confirmation: false,
        scope_requirement: 'CUSTOMER',
        idempotency: 'SAFE',
        executor_ref: 'fixture:timeline.read',
        audit_contract: { ...AUDIT_READ },
        error_contract: 'DISTINGUISHABLE',
      },
    ];
    const registry = createCapabilityRegistry(CUSTOMER_CAPABILITY_MANIFEST, foreignManifest);
    expect(registry.size()).toBe(4);
    expect(registry.listByDomain('timeline').length).toBe(1);
    // 重复身份(id + version)经 A1 registry 拒绝,不静默覆盖。
    expect(() => createCapabilityRegistry(CUSTOMER_CAPABILITY_MANIFEST, foreignManifest, [CUSTOMER_CAPABILITY_MANIFEST[0]])).toThrow(
      DuplicateCapabilityError,
    );
  });

  it('A2 did not modify the frozen A1 core files (static evidence: no customer ids inside central files)', () => {
    for (const file of ['registry.ts', 'types.ts', 'index.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'src/lib/capabilities', file), 'utf8');
      expect(source, `central file ${file} must not embed A2 customer capability ids`).not.toMatch(/customer\.(search|get|context)/);
    }
  });
});

describe('T3 — REAL CAPABILITY INVENTORY: manifest matches only capabilities proven to exist', () => {
  it('every manifest entry maps 1:1 to a VERIFIED inventory candidate', () => {
    expect(VERIFIED_CUSTOMER_READ_CANDIDATES).toEqual([
      'search_customer',
      'get_customer',
      'read_customer_context',
    ]);
    expect(CUSTOMER_CAPABILITY_MANIFEST.map((d) => d.id)).toEqual([
      'customer.search',
      'customer.get',
      'customer.context',
    ]);
    const inventoryByCandidate = new Map(CUSTOMER_READ_INVENTORY.map((e) => [e.candidate, e]));
    for (const entry of CUSTOMER_READ_INVENTORY) {
      expect(entry.product_capability_exists).toBe(entry.final_status === 'VERIFIED');
      expect(entry.a2_action).toBe(entry.final_status === 'VERIFIED' ? 'REGISTER_EXISTING' : 'NOT_APPLICABLE');
      expect(entry.existing_source_path.length).toBeGreaterThan(0);
      expect(entry.existing_execution_path.length).toBeGreaterThan(0);
    }
    // 每个 VERIFIED 候选都在 manifest 中有且仅有一个定义。
    const manifestIds = new Set(CUSTOMER_CAPABILITY_MANIFEST.map((d) => d.id));
    expect(manifestIds.size).toBe(3);
    for (const candidate of VERIFIED_CUSTOMER_READ_CANDIDATES) {
      const sourcePath = inventoryByCandidate.get(candidate)!.existing_source_path[0];
      expect(sourcePath, `candidate ${candidate} must have real source evidence`).toMatch(/^src\/lib\//);
    }
  });
});

describe('T4 — SEARCH CUSTOMER: adapter preserves existing search semantics (single / multiple / none)', () => {
  it('multiple matches: region filter returns all 东莞 customers with bounded page semantics', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const result = await searchCustomersRead({
        filters: { region: '东莞' },
        list_kind: 'portfolio',
        db: fixture.db,
      });
      expect(result.read_only).toBe(true);
      expect(result.writes_crm).toBe(false);
      expect(result.calls_provider).toBe(false);
      expect(result.total_matches).toBe(2);
      expect(result.candidates.map((c) => c.id).sort()).toEqual(['dg-a-jm', 'dg-c-other']);
    } finally {
      fixture.close();
    }
  });

  it('single match: region + grade narrows to exactly one customer', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const result = await searchCustomersRead({
        filters: { region: '东莞', customer_grade: 'A' },
        list_kind: 'portfolio',
        db: fixture.db,
      });
      expect(result.candidates.map((c) => c.id)).toEqual(['dg-a-jm']);
      expect(result.total_matches).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('no match: empty candidates, no synthetic success data', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const result = await searchCustomersRead({
        filters: { region: '不存在的地区' },
        list_kind: 'portfolio',
        db: fixture.db,
      });
      expect(result.candidates).toEqual([]);
      expect(result.total_matches).toBe(0);
    } finally {
      fixture.close();
    }
  });

  it('NL normalization → registered search tool keeps existing resolution semantics', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const normalization = normalizeCustomerSearchFilters('帮我找一下东莞的 A 类客户', NOW);
      expect(normalization.filters.name_query).toBe('东莞');
      expect(normalization.filters.region).toBeUndefined();
      const result = await searchCustomersRead({
        filters: normalization.filters as NormalizedCustomerSearchFilters,
        unsupported_filters: normalization.unsupported,
        notes: normalization.notes,
        list_kind: 'resolution',
        db: fixture.db,
      });
      expect(result.list_kind).toBe('resolution');
      expect(result.candidates.map((c) => c.id)).toEqual(['dg-a-jm']);
      expect(result.total_matches).toBe(1);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — GET CUSTOMER: correct data returned for explicit customer identity', () => {
  it('returns the requested customer record from the real snapshot representation', () => {
    const snapshot = snapshotFixture();
    const result = getCustomerRead({ customer_id: 'customer-1', snapshot, context: contextFixture(snapshot) });
    expect(result.tool_id).toBe('get_customer');
    expect(result.read_only).toBe(true);
    expect(result.writes_crm).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH' });
    expect(result.evidence_refs).toContain('customer-1');
  });

  it('absent customer id yields empty records (fail-closed, no arbitrary pick)', () => {
    const snapshot = snapshotFixture();
    const result = getCustomerRead({ customer_id: 'no-such-customer', snapshot, context: contextFixture(snapshot) });
    expect(result.records).toEqual([]);
    expect(result.evidence_refs).toEqual([]);
  });
});

describe('T6 — CUSTOMER CONTEXT: reads the existing real context representation', () => {
  it('returns the exact existing ContextSnapshot, not a parallel fake context', () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const result = readCustomerContextRead({ customer_id: 'customer-1', snapshot, context });
    expect(result.tool_id).toBe('get_customer_context');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toBe(context);
    expect((result.records[0] as ContextSnapshot).kind).toBe('CRM_CONTEXT_SNAPSHOT');
    expect((result.records[0] as ContextSnapshot).readOnly).toBe(true);
    expect((result.records[0] as ContextSnapshot).customers[0]).toMatchObject({
      customerId: 'customer-1',
      name: 'Ada',
      grade: 'A',
      intentLevel: 'HIGH',
    });
  });
});

describe('T7 — CUSTOMER STATE: intentionally absent as NOT_DISTINCT current product capability', () => {
  it('no customer.state definition exists in the production manifest', () => {
    expect(CUSTOMER_CAPABILITY_MANIFEST.some((d) => d.id === 'customer.state')).toBe(false);
    expect(CUSTOMER_READ_CAPABILITY_DEFINITIONS.some((d) => d.id === 'customer.state')).toBe(false);
  });

  it('inventory reports the exact NOT_DISTINCT reason with source evidence', () => {
    const stateEntry = CUSTOMER_READ_INVENTORY.find((e) => e.candidate === 'read_customer_state')!;
    expect(stateEntry.product_capability_exists).toBe(false);
    expect(stateEntry.final_status).toBe('NOT_DISTINCT');
    expect(stateEntry.a2_action).toBe('NOT_APPLICABLE');
    expect(stateEntry.not_distinct_reason).toMatch(/No independent customer state/);
    expect(stateEntry.not_distinct_reason).toMatch(/src\/lib\/types\.ts:45-89/);
    expect(stateEntry.existing_source_path).toEqual(['src/lib/types.ts', 'src/lib/context/types.ts']);
  });

  it('no state model was invented anywhere in the A2 customer domain', () => {
    for (const file of ['inventory.ts', 'definitions.ts', 'manifest.ts', 'readAdapter.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/customer', file), 'utf8');
      expect(source).not.toMatch(/customer\.state|CustomerState|state_snapshot/);
    }
  });
});

describe('T8 — ZERO WRITES: all A2 executions are read-only', () => {
  it('static: customer domain sources contain no write tokens', () => {
    const dir = 'src/lib/capabilities/customer';
    for (const file of ['inventory.ts', 'definitions.ts', 'manifest.ts', 'readAdapter.ts', 'index.ts']) {
      const source = readFileSync(resolve(process.cwd(), dir, file), 'utf8');
      expect(source, `${file} must not contain write operations`).not.toMatch(
        /(INSERT INTO|UPDATE |DELETE FROM|\bcreateCustomer\b|\bupdateCustomer\b|\bdeleteCustomer\b|\bcreateTask\b|\bcreateFollowUp\b|\bcreateVisit\b|\bcreateAIDraft\b|\bapplyAIDraftToCustomer\b|\bcreateLeadWorkItem\b)/,
      );
    }
  });

  it('behavioral: real SQLite search path issues zero write statements', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const statements: string[] = [];
      const spyDb: DatabaseLike = {
        async execute(sql, bindings: unknown[] = []) {
          statements.push(sql);
          return fixture.db.execute(sql, bindings);
        },
        async select<T>(sql: string, bindings: unknown[] = []) {
          statements.push(sql);
          return fixture.db.select<T>(sql, bindings);
        },
      };
      await searchCustomersRead({ filters: { region: '东莞' }, list_kind: 'portfolio', db: spyDb });
      expect(statements.length).toBeGreaterThan(0);
      for (const sql of statements) {
        expect(sql.trim().toUpperCase(), `unexpected write statement: ${sql}`).toMatch(/^(SELECT|WITH|PRAGMA)/);
      }
    } finally {
      fixture.close();
    }
  });

  it('behavioral: get/context adapters are pure in-memory reads with no db handle at all', () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const get = getCustomerRead({ customer_id: 'customer-1', snapshot, context });
    const ctx = readCustomerContextRead({ customer_id: 'customer-1', snapshot, context });
    expect(get.writes_crm).toBe(false);
    expect(ctx.writes_crm).toBe(false);
  });
});

describe('T9 — ZERO MODEL / NETWORK: customer read execution is deterministic, no provider', () => {
  it('static: customer domain sources import only existing read-only executors, never provider/network', () => {
    const dir = 'src/lib/capabilities/customer';
    for (const file of ['inventory.ts', 'definitions.ts', 'manifest.ts', 'readAdapter.ts', 'index.ts']) {
      const source = readFileSync(resolve(process.cwd(), dir, file), 'utf8');
      // 仅扫描代码(剥离注释):文档中可以描述"不调用 provider",代码不得引用。
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const forbidden = /(provider|deepseek|vision|firecrawl|fetch\(|XMLHttpRequest|WebSocket|axios|https?:\/\/|@tauri-apps\/api)/i;
      expect(codeOnly, `${file} must not reference provider/network capabilities`).not.toMatch(forbidden);
    }
  });

  it('static: adapter imports are limited to the existing registered read-only executor modules', () => {
    const adapterSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/customer/readAdapter.ts'), 'utf8');
    const imports = [...adapterSource.matchAll(/from '([^']+)';/g)].map((m) => m[1]);
    expect(imports.every((p) => p.startsWith('../../'))).toBe(true);
    expect(imports.join('\n')).not.toMatch(/provider|productionAi|battleCard/);
  });

  it('behavioral: registered search tool result declares calls_provider=false', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const result = await searchCustomersRead({ filters: { region: '东莞' }, list_kind: 'portfolio', db: fixture.db });
      expect(result.calls_provider).toBe(false);
    } finally {
      fixture.close();
    }
  });
});

describe('T10 — SCOPE SAFETY: customer-scoped reads never silently cross customers', () => {
  it('get_customer returns exactly the requested customer, never another', () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const one = getCustomerRead({ customer_id: 'customer-1', snapshot, context });
    const two = getCustomerRead({ customer_id: 'customer-2', snapshot, context });
    expect(one.records.map((r) => (r as { id: string }).id)).toEqual(['customer-1']);
    expect(two.records.map((r) => (r as { id: string }).id)).toEqual(['customer-2']);
    expect(one.records.map((r) => (r as { id: string }).id)).not.toContain('customer-2');
    expect(two.records.map((r) => (r as { id: string }).id)).not.toContain('customer-1');
  });

  it('unknown scope fails closed: empty result instead of arbitrary selection', () => {
    const snapshot = snapshotFixture();
    const result = getCustomerRead({ customer_id: 'unknown', snapshot, context: contextFixture(snapshot) });
    expect(result.records).toEqual([]);
  });

  it('empty customer_id is rejected by the existing registered executor (fail-closed)', () => {
    const snapshot = snapshotFixture();
    expect(() =>
      getCustomerRead({ customer_id: '   ', snapshot, context: contextFixture(snapshot) }),
    ).toThrow(/not registered or customer scoped/);
  });
});

describe('T11 — CALLER SAFETY: definitions stay protected by A1 registry immutability', () => {
  it('registered definitions are deep-frozen', () => {
    const registry = createCapabilityRegistry(CUSTOMER_CAPABILITY_MANIFEST);
    for (const id of ['customer.search', 'customer.get', 'customer.context']) {
      const stored = registry.get(id, '1.0.0');
      expect(Object.isFrozen(stored)).toBe(true);
      expect(Object.isFrozen(stored.audit_contract)).toBe(true);
    }
  });

  it('mutation attempts are rejected (no mutable contract state introduced by A2)', () => {
    const registry = createCapabilityRegistry(CUSTOMER_CAPABILITY_MANIFEST);
    const stored = registry.get('customer.search', '1.0.0');
    expect(() => {
      (stored as unknown as { effect: string }).effect = 'WRITE';
    }).toThrow(TypeError);
  });

  it('A2 manifest itself introduces no shared mutable state (deep-frozen elements)', () => {
    expect(Object.isFrozen(CUSTOMER_CAPABILITY_MANIFEST)).toBe(true);
    expect(Object.isFrozen(CUSTOMER_READ_CAPABILITY_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(CUSTOMER_READ_INVENTORY)).toBe(true);
    // 元素对象与嵌套 audit_contract 也必须冻结(不引入可变契约状态)。
    for (const definition of CUSTOMER_READ_CAPABILITY_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.audit_contract)).toBe(true);
    }
    for (const entry of CUSTOMER_READ_INVENTORY) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
    // 直接消费导出对象也无法篡改语义字段(与经 registry 的深冻结一致)。
    expect(() => {
      (CUSTOMER_READ_CAPABILITY_DEFINITIONS[0] as unknown as { effect: string }).effect = 'WRITE';
    }).toThrow(TypeError);
  });
});

describe('T12 — EXISTING BEHAVIOR PARITY: adapter output is semantically equivalent to the existing path', () => {
  it('getCustomerRead delegates to the existing registered get_customer executor with identical output', () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const input = { customer_id: 'customer-1', snapshot, context };
    expect(getCustomerRead(input)).toEqual(executeSalesAgentReadTool('get_customer', input));
  });

  it('readCustomerContextRead delegates to the existing registered get_customer_context executor with identical output', () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const input = { customer_id: 'customer-1', snapshot, context };
    expect(readCustomerContextRead(input)).toEqual(executeSalesAgentReadTool('get_customer_context', input));
  });

  it('searchCustomersRead is the existing registered search_customers executor (same reference)', () => {
    expect(searchCustomersRead).toBe(executeSearchCustomersTool);
  });

  it('representative fixtures: snapshot get/context parity across both customers', () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    for (const customerId of ['customer-1', 'customer-2']) {
      const input = { customer_id: customerId, snapshot, context };
      expect(getCustomerRead(input)).toEqual(executeSalesAgentReadTool('get_customer', input));
      expect(readCustomerContextRead(input)).toEqual(executeSalesAgentReadTool('get_customer_context', input));
    }
  });
});

describe('INTEGRATION — real Customer read data path (spec §20)', () => {
  it('search adapter reaches the same SQLite repository path as the product', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const filters = { region: '东莞', customer_grade: 'A' } as const;
      const viaAdapter = await searchCustomersRead({ filters, list_kind: 'portfolio', db: fixture.db });
      const viaDirectExecutor = await executeSearchCustomersTool({ filters, list_kind: 'portfolio', db: fixture.db });
      expect(viaAdapter).toEqual(viaDirectExecutor);
      expect(viaAdapter.candidates[0].name).toBe('东莞 JM 新能源科技有限公司');
    } finally {
      fixture.close();
    }
  });

  it('get/context adapters run on the real product loader: loadReadOnlySnapshotFromDb → buildWorkspaceContextSnapshot', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const plan = buildReadOnlySnapshotLoaderPlan({
        kind: 'READ_ONLY_SNAPSHOT_LOADER_REQUEST',
        active_profile_id: 'foreign_trade_geo',
        now: NOW,
        includes: { customers: true },
      });
      const loaded = await loadReadOnlySnapshotFromDb(fixture.db, plan);
      const snapshot = loaded.snapshot;
      const context = buildWorkspaceContextSnapshot(snapshot);

      // get_customer 读到真实 DB 行(dg-a-jm 由 fixture 种入 SQLite)。
      const getResult = getCustomerRead({ customer_id: 'dg-a-jm', snapshot, context });
      expect(getResult.records).toHaveLength(1);
      expect(getResult.records[0]).toMatchObject({
        id: 'dg-a-jm',
        name: '东莞 JM 新能源科技有限公司',
        customer_grade: 'A',
        intent_level: 'HIGH',
      });
      expect(getResult.evidence_refs).toContain('dg-a-jm');

      // context 能力返回真实产品上下文投影,含同一条客户事实。
      const ctxResult = readCustomerContextRead({ customer_id: 'dg-a-jm', snapshot, context });
      const ctx = ctxResult.records[0] as ContextSnapshot;
      expect(ctx.kind).toBe('CRM_CONTEXT_SNAPSHOT');
      expect(ctx.customers.some((c) => c.customerId === 'dg-a-jm' && c.grade === 'A' && c.intentLevel === 'HIGH')).toBe(true);

      // 未加载进 snapshot 的客户 → 空(与产品快照语义一致,fail-closed)。
      const absent = getCustomerRead({ customer_id: 'not-in-snapshot', snapshot, context });
      expect(absent.records).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});
