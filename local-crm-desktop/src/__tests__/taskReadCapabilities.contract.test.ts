/**
 * V0.2A / A6R — Task Read Capabilities 聚焦测试（产品能力关闭后版本）。
 *
 * 覆盖任务规格 T1–T14（不适用的分类项以断言+文档说明处理）及关闭契约：
 *   T1  MANIFEST CONTRACT    每个生产能力符合冻结 A1 CapabilityDefinition
 *   T2  DOMAIN COMPOSITION   经 A1 扩展缝独立组合，不编辑中央 A1 文件
 *   T3  INVENTORY TRUTH      仅已证实产品/agent 能力进入生产 manifest
 *   T4  TASK READ            客户级读输出来自现有 Task 数据/读路径
 *   T5  CUSTOMER ISOLATION   客户 A 收到零客户 B 任务
 *   T6  GLOBAL VS CUSTOMER   客户读精确匹配，不含全局任务
 *   T7  STATUS TRUTH         status 原样（OPEN/DONE/CANCELLED），无映射
 *   T8  TIME TRUTH           due_at 原样（含 null/过去），无 today/overdue 分类
 *   T9  DAILY FOCUS 分类     断言不注册 today/daily_focus 类能力（投影非原语）
 *   T10 SINGLE TASK          断言不注册单任务读（无现有行为）
 *   T11 ZERO WRITES          execute 调用 0 次，行数不变
 *   T12 ZERO MODEL/NETWORK   静态 import/源码边界断言
 *   T13 EXISTING PATH PARITY 与 list_customer_tasks 语义一致 + 复用 Task 数据读路径
 *   T14 INVALID ID/SCOPE     未知客户空结果；空 customer_id 抛错
 *
 * 关闭契约（TARGETED PRODUCT-CAPABILITY CLOSURE）：
 *   T-PRODUCT-01  无生产能力仅因 repository helper（db.listTasks）存在而注册
 *   T-PRODUCT-02  task.read 有意缺席生产 manifest（listTasks 无生产调用方）
 *   T-CUSTOMER-01 task.read_by_customer 与现有 Task 域行为语义等价
 *   T-CAPABILITY-COUNT 生产 manifest 仅含独立证实的能力（恰 1 个）
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCapabilityRegistry, type CapabilityDefinition } from '../lib/capabilities';
import {
  TASK_READ_CAPABILITY_IDS,
  TASK_READ_MANIFEST,
  readTasksByCustomer,
  TaskReadScopeError,
} from '../lib/capabilities/task';
import { __setDbInstanceForTests, type DatabaseLike } from '../lib/db';
import type { Task, TaskStatus } from '../lib/types';

// ── 测试基建：最小 Task 内存库（DatabaseLike 兼容），记录 execute/select 调用 ──

interface TaskStore {
  readonly tasks: Task[];
  readonly executeCalls: string[];
  readonly selectCalls: string[];
}

function makeTask(id: string, customerId: string | null, title: string, status: TaskStatus, dueAt: string | null): Task {
  return {
    id,
    customer_id: customerId,
    title,
    due_at: dueAt,
    status,
    priority: 'MEDIUM',
    source: 'MANUAL',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function createTaskStoreDb(initial: Task[] = []): { db: DatabaseLike; store: TaskStore } {
  const tasks: Task[] = [...initial];
  const executeCalls: string[] = [];
  const selectCalls: string[] = [];

  const db: DatabaseLike = {
    async execute(sql: string, bindings: unknown[] = []) {
      executeCalls.push(sql.trim().toLowerCase());
      const trimmed = sql.trim().toLowerCase();
      if (trimmed.startsWith('insert') && trimmed.includes('into tasks')) {
        const cols = sql.match(/INSERT\s+INTO\s+\w+\s*\(([\s\S]*?)\)\s*VALUES/i)?.[1]
          ?.split(',').map((column) => column.trim()).filter(Boolean) ?? [];
        const row: Record<string, unknown> = {};
        cols.forEach((col, i) => { row[col] = bindings[i]; });
        tasks.push(row as unknown as Task);
      } else if (trimmed.startsWith('delete') && trimmed.includes('from tasks')) {
        const idx = tasks.findIndex((task) => task.id === bindings[0]);
        if (idx >= 0) tasks.splice(idx, 1);
      }
      return { rowsAffected: 1 };
    },
    async select<T>(sql: string): Promise<T[]> {
      selectCalls.push(sql.trim().toLowerCase());
      const trimmed = sql.trim().toLowerCase();
      if (trimmed.includes('from tasks')) {
        return [...tasks] as T[];
      }
      return [] as T[];
    },
  };

  return { db, store: { tasks, executeCalls, selectCalls } };
}

// ── A1 风格合成 fixture manifest（证明跨域组合；非真实 CRM 能力） ──

const FIXTURE_MANIFEST: readonly CapabilityDefinition[] = [
  {
    id: 'fixture.customer.read',
    version: '1.0.0',
    domain: 'fixture-domain-a',
    description: 'Fixture A: read customer facts.',
    input_schema: 'fixture.customer.query.v1',
    output_schema: 'fixture.customer.result.v1',
    effect: 'READ',
    data_target: 'CRM_FACT',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'CUSTOMER',
    idempotency: 'SAFE',
    executor_ref: 'fixture.executor.read.v1',
    audit_contract: { audit_required: true, record_input: true, record_output: true, record_effect: true },
    error_contract: 'DISTINGUISHABLE',
  },
];

function installTaskStore(initial: Task[] = []): TaskStore {
  const { db, store } = createTaskStoreDb(initial);
  __setDbInstanceForTests(db);
  return store;
}

afterEach(() => {
  __setDbInstanceForTests(null);
});

describe('A6R task read capabilities contract suite', () => {
  // ── T1 MANIFEST CONTRACT ──
  it('T1: every production Task read capability conforms to frozen A1 CapabilityDefinition', () => {
    const registry = createCapabilityRegistry(TASK_READ_MANIFEST);

    expect(registry.size()).toBe(1);
    for (const definition of registry.list()) {
      // A1 契约形状（validateCapabilityDefinition 已隐式校验；此处显式断言读语义）
      expect(definition.effect).toBe('READ');
      expect(definition.requires_confirmation).toBe(false);
      expect(definition.data_target).toBe('CRM_STATE');
      expect(definition.risk_level).toBe('LOW');
      expect(definition.authority_policy).toBe('AUTO');
      expect(definition.idempotency).toBe('SAFE');
      expect(definition.error_contract).toBe('DISTINGUISHABLE');
      expect(definition.scope_requirement).toBe('CUSTOMER');
      expect(typeof definition.executor_ref).toBe('string');
      expect(definition.executor_ref.length).toBeGreaterThan(0);
      expect(Object.keys(definition.audit_contract).sort()).toEqual(
        ['audit_required', 'record_effect', 'record_input', 'record_output'],
      );
      for (const flag of Object.values(definition.audit_contract)) {
        expect(typeof flag).toBe('boolean');
      }
      // 注册副本深度冻结：caller 无法改写 registry 状态
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.audit_contract)).toBe(true);
    }
  });

  it('T1b: read-only semantics, executor ref points at the real existing agent tool', () => {
    const [definition] = TASK_READ_MANIFEST;
    expect(definition.id).toBe('task.read_by_customer');
    expect(definition.effect).toBe('READ');
    expect(definition.data_target).toBe('CRM_STATE');
    expect(definition.scope_requirement).toBe('CUSTOMER');
    // executor_ref 指向真实可达的现有 agent 读工具（registry.ts:53）
    expect(definition.executor_ref).toBe('salesAgentTool:list_customer_tasks');
  });

  // ── T2 DOMAIN COMPOSITION ──
  it('T2: Task manifest composes via the A1 extension seam without touching central A1 files', () => {
    const registry = createCapabilityRegistry(TASK_READ_MANIFEST, FIXTURE_MANIFEST);

    expect(registry.size()).toBe(2);
    expect(registry.listByDomain('task').map((definition) => definition.id)).toEqual(
      ['task.read_by_customer'],
    );
    expect(registry.get('task.read_by_customer', '1.0.0').domain).toBe('task');
    expect(registry.get('fixture.customer.read', '1.0.0').domain).toBe('fixture-domain-a');

    // 组合不依赖中央 hub：A1 registry 源码保持零业务域路由（registry.ts 无 switch）
    const registrySource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/registry.ts'), 'utf8');
    expect(registrySource).not.toMatch(/\bswitch\s*\(/);
    expect(registrySource).not.toMatch(/\btask\.read\b/);
  });

  // ── T3 INVENTORY TRUTH ──
  it('T3: only proven current product/agent capabilities enter the production manifest', () => {
    expect(TASK_READ_CAPABILITY_IDS).toEqual(['task.read_by_customer']);

    // 禁止虚构/未证实能力（§10/§11/§15/§16）：不得出现
    const forbiddenIds = [
      'task.read', 'task.read_today', 'task.read_overdue', 'task.read_pending', 'task.read_completed',
      'task.read_one', 'task.get', 'task.summary', 'task.recommendation', 'task.next_action',
      'daily_focus', 'daily_review', 'task_review', 'daily_task_review', 'customer_task_analysis',
    ];
    for (const id of forbiddenIds) {
      expect(TASK_READ_CAPABILITY_IDS).not.toContain(id);
    }
    // 无重复身份
    expect(new Set(TASK_READ_CAPABILITY_IDS).size).toBe(TASK_READ_CAPABILITY_IDS.length);
  });

  // ── T-PRODUCT-01 / T-PRODUCT-02 / T-CAPABILITY-COUNT（关闭契约） ──
  it('T-PRODUCT-01: no capability is registered solely because a repository helper exists', () => {
    // db.listTasks 是 repository helper（db.ts:734），全库无生产调用方 →
    // 不得出现以它为 executor_ref 的生产能力，也不得出现 GLOBAL 作用域的 Task 读能力
    for (const definition of TASK_READ_MANIFEST) {
      expect(definition.executor_ref).not.toBe('crmDb:listTasks');
      expect(definition.scope_requirement).not.toBe('GLOBAL');
    }
    // 关闭前曾注册 task.read（executor=crmDb:listTasks, scope=GLOBAL）——已被移除
    expect(TASK_READ_MANIFEST.some((definition) => definition.id === 'task.read')).toBe(false);
  });

  it('T-PRODUCT-02: task.read is intentionally absent from the production manifest', () => {
    // 意图文档（manifest.ts 头部注释）：listTasks 无生产调用方、无任务页面/面板、
    // agent snapshot 无过滤模式是上下文投影（LIMIT 50/TODO-DONE 映射/字段子集）→
    // 全局任务读不构成当前产品能力（NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY）
    const manifestSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/task/manifest.ts'), 'utf8');
    expect(manifestSource).toMatch(/NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY/);
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('task.read');
  });

  it('T-CAPABILITY-COUNT: production manifest contains only independently proven Task capabilities', () => {
    expect(TASK_READ_MANIFEST).toHaveLength(1);
    expect(TASK_READ_CAPABILITY_IDS).toEqual(['task.read_by_customer']);
  });

  // ── T4 TASK READ（客户级，数据路径证明） ──
  it('T4: readTasksByCustomer output comes from the existing Task data/read path', async () => {
    const store = installTaskStore([
      makeTask('t1', 'cust-a', '报价发送', 'OPEN', '2026-08-13T10:00:00.000Z'),
      makeTask('t2', 'cust-b', '电话回访', 'DONE', null),
    ]);

    const forA = await readTasksByCustomer('cust-a');

    expect(forA).toHaveLength(1);
    // 数据经现有 Task 数据读路径（listTasks 的 SELECT * FROM tasks ORDER BY due_at ASC）
    expect(store.selectCalls).toContain('select * from tasks order by due_at asc');
    const t1 = forA[0];
    expect(t1?.customer_id).toBe('cust-a');
    expect(t1?.title).toBe('报价发送');
    expect(t1?.due_at).toBe('2026-08-13T10:00:00.000Z');
    expect(t1?.status).toBe('OPEN');
  });

  // ── T5 CUSTOMER TASK ISOLATION ──
  it('T5: customer A receives zero customer B tasks', async () => {
    installTaskStore([
      makeTask('a1', 'cust-a', 'A 任务 1', 'OPEN', '2026-08-13T10:00:00.000Z'),
      makeTask('a2', 'cust-a', 'A 任务 2', 'DONE', null),
      makeTask('b1', 'cust-b', 'B 任务 1', 'OPEN', '2026-08-14T10:00:00.000Z'),
      makeTask('b2', 'cust-b', 'B 任务 2', 'CANCELLED', '2026-08-15T10:00:00.000Z'),
      makeTask('g1', null, '全局任务', 'OPEN', null),
    ]);

    const forA = await readTasksByCustomer('cust-a');

    expect(forA.map((task) => task.id)).toEqual(['a1', 'a2']);
    for (const task of forA) {
      expect(task.customer_id).toBe('cust-a');
    }
    expect(forA.some((task) => task.customer_id === 'cust-b')).toBe(false);
    expect(forA.some((task) => task.id === 'g1')).toBe(false);
  });

  // ── T6 CUSTOMER SCOPE TRUTH ──
  it('T6: customer-scoped read is exact-match and never exposes global tasks', async () => {
    installTaskStore([
      makeTask('a1', 'cust-a', 'A 任务', 'OPEN', '2026-08-13T10:00:00.000Z'),
      makeTask('g1', null, '全局任务', 'OPEN', null),
    ]);

    const forA = await readTasksByCustomer('cust-a');
    expect(forA.map((task) => task.id)).toEqual(['a1']);
    // 客户读不泄露全局任务（全局任务不假装为客户任务）
    expect(forA.some((task) => task.customer_id === null)).toBe(false);
  });

  // ── T7 STATUS TRUTH ──
  it('T7: returned status matches persisted Task semantics — no invented lifecycle translation', async () => {
    installTaskStore([
      makeTask('t1', 'cust-a', 'OPEN 任务', 'OPEN', null),
      makeTask('t2', 'cust-a', 'DONE 任务', 'DONE', null),
      makeTask('t3', 'cust-a', 'CANCELLED 任务', 'CANCELLED', null),
    ]);

    const all = await readTasksByCustomer('cust-a');
    const statuses = new Map(all.map((task) => [task.id, task.status]));
    expect(statuses.get('t1')).toBe('OPEN');
    expect(statuses.get('t2')).toBe('DONE');
    expect(statuses.get('t3')).toBe('CANCELLED');

    // 不做 snapshot 的 TODO/DONE 投影映射（readOnlySnapshotLoaderReadiness.ts:366-368 是 agent 上下文投影，非 A6R 语义）
    expect(all.every((task) => ['OPEN', 'DONE', 'CANCELLED'].includes(task.status))).toBe(true);
  });

  // ── T8 TIME TRUTH ──
  it('T8: due_at is preserved verbatim — no invented today/overdue/upcoming classification', async () => {
    installTaskStore([
      makeTask('t1', 'cust-a', '无到期', 'OPEN', null),
      makeTask('t2', 'cust-a', '过去到期', 'OPEN', '2025-01-01T00:00:00.000Z'),
      makeTask('t3', 'cust-a', '未来到期', 'OPEN', '2099-12-31T23:59:59.999Z'),
    ]);

    const all = await readTasksByCustomer('cust-a');
    const byId = new Map(all.map((task) => [task.id, task]));
    expect(byId.get('t1')?.due_at).toBeNull();
    expect(byId.get('t2')?.due_at).toBe('2025-01-01T00:00:00.000Z');
    expect(byId.get('t3')?.due_at).toBe('2099-12-31T23:59:59.999Z');
    // 无派生态字段
    for (const task of all) {
      expect(Object.keys(task).sort()).toEqual(
        ['created_at', 'customer_id', 'due_at', 'id', 'priority', 'source', 'status', 'title', 'updated_at'],
      );
    }
  });

  // ── T9 DAILY FOCUS CLASSIFICATION ──
  it('T9: Daily-Focus/Today derivation stays out of the Task production manifest', () => {
    // 分类结论（文档断言）：
    // rules.ts:326-330 buildTodaySummary.tasks_due_today（due_at && OPEN && due<=今日 23:59:59）
    // 属于 Daily Summary 投影；dailyFocus.ts（97-166）根本不读 tasks 表（基于 next_follow_up_at）。
    // 两者均为更高层投影/UI 行为，不是 Task 域读原语 → 不注册。
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('task.read_today');
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('task.read_due_today');
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('daily_focus');
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('daily_review');
  });

  // ── T10 SINGLE TASK ──
  it('T10: no single-task read capability (no distinct existing behavior)', () => {
    // 分类结论：当前产品无单任务读行为（无 getTasks/getTaskById，全 src 无匹配）→ NOT_EXISTING
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('task.read_one');
    expect(TASK_READ_CAPABILITY_IDS).not.toContain('task.get');
    expect(TASK_READ_CAPABILITY_IDS).toHaveLength(1);
  });

  // ── T11 ZERO WRITES ──
  it('T11: task reads execute zero CRM mutations', async () => {
    const store = installTaskStore([
      makeTask('t1', 'cust-a', '任务', 'OPEN', null),
      makeTask('t2', 'cust-b', '任务', 'DONE', null),
    ]);
    const rowsBefore = store.tasks.length;

    await readTasksByCustomer('cust-a');
    await readTasksByCustomer('cust-b');

    // 无任何 INSERT/UPDATE/DELETE 到达数据库层（execute 调用 0 次）
    expect(store.executeCalls).toEqual([]);
    expect(store.tasks.length).toBe(rowsBefore);
    // 全部为 SELECT（现有 Task 数据读路径）
    expect(store.selectCalls.length).toBeGreaterThan(0);
    for (const sql of store.selectCalls) {
      expect(sql.startsWith('select')).toBe(true);
    }
  });

  // ── T12 ZERO MODEL / NETWORK ──
  it('T12: task read domain module performs zero model/network calls (static boundary)', () => {
    // 1) 域模块无运行时 import 逃逸：manifest/index 无 import；adapter 唯一运行时 import 是 '../../db'（现有数据读路径）
    for (const file of ['src/lib/capabilities/task/manifest.ts', 'src/lib/capabilities/task/adapter.ts', 'src/lib/capabilities/task/index.ts']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      const runtimeImports = [...source.matchAll(/^import\b([\s\S]*?)from '([^']+)';/gm)]
        .filter((match) => !match[1].trim().startsWith('type'))
        .map((match) => match[2]);
      for (const imported of runtimeImports) {
        expect(['../../db']).toContain(imported);
      }
    }
    // 2) 无网络 / 模型 / Tauri 入口 token
    const forbidden = /(fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|deepseek|openai|@tauri)/i;
    for (const file of ['src/lib/capabilities/task/manifest.ts', 'src/lib/capabilities/task/adapter.ts', 'src/lib/capabilities/task/index.ts']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(forbidden);
    }
    // 3) manifest 纯声明：唯一 import 为 type-only '../types'
    const manifestSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/task/manifest.ts'), 'utf8');
    const manifestImports = [...manifestSource.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map((match) => match[1]);
    expect(manifestImports).toEqual(['../types']);
  });

  // ── T13 EXISTING PATH PARITY（= T-CUSTOMER-01） ──
  it('T13: customer-scoped read matches existing agent tool semantics (list_customer_tasks)', async () => {
    installTaskStore([
      makeTask('a1', 'cust-a', 'A 任务', 'OPEN', null),
      makeTask('b1', 'cust-b', 'B 任务', 'OPEN', null),
    ]);

    // 1) 精确 customer_id 匹配（registry.ts:101：snapshot.tasks.filter(item => item.customer_id === customer_id)）
    const forA = await readTasksByCustomer('cust-a');
    expect(forA.map((task) => task.id)).toEqual(['a1']);

    // 2) 未知客户 → 空结果（registry.ts:100-101 的 filter 语义：不抛错、不泄露）
    const unknown = await readTasksByCustomer('no-such-customer');
    expect(unknown).toEqual([]);

    // 3) 空/空白 customer_id → 抛错（registry.ts:94：!input.customer_id.trim() 抛错）
    await expect(readTasksByCustomer('')).rejects.toBeInstanceOf(TaskReadScopeError);
    await expect(readTasksByCustomer('   ')).rejects.toBeInstanceOf(TaskReadScopeError);
  });

  it('T-CUSTOMER-01: task.read_by_customer is semantically equivalent to the real Task-domain agent behavior', async () => {
    // 现有 agent 工具 list_customer_tasks（registry.ts:53）：
    //   - 注册于 SALES_AGENT_TOOL_REGISTRY（registry.ts:53），capability='timeline_read'
    //   - 执行于 executeSalesAgentReadTool（registry.ts:93-113）：id === 'list_customer_tasks' → tasks
    //     （registry.ts:106），其中 tasks = snapshot.tasks.filter(item => item.customer_id === customer_id)
    //     （registry.ts:101）——只返回 Task 域记录（snapshot.tasks 来自 selectTasks 的 tasks 表读取）
    //   - 消费于 agentSession.ts:104（NEXT_ACTION_PREPARATION）、operatingLayer.ts:45、
    //     capabilityRoutingMatrix.ts:93（deterministic_tools）、modelContextEnvelope.ts:232
    const registrySource = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/registry.ts'), 'utf8');
    expect(registrySource).toMatch(/list_customer_tasks/);
    // A6R adapter 的过滤语义与 registry.ts:101 精确一致（T13 已行为级证明）；
    // 差异仅在 snapshot 上下文投影（TODO/DONE 映射、LIMIT 50）——A6R 保留 db 真相，符合 §14/§17
    expect(TASK_READ_MANIFEST[0].executor_ref).toBe('salesAgentTool:list_customer_tasks');
  });

  // ── T14 INVALID ID / SCOPE ──
  it('T14: unknown scope fails closed per existing semantics; no silent query broadening', async () => {
    installTaskStore([
      makeTask('a1', 'cust-a', 'A 任务', 'OPEN', null),
      makeTask('g1', null, '全局任务', 'OPEN', null),
    ]);

    // 未知客户：空结果（fail closed，不返回全局/他人数据）
    const unknown = await readTasksByCustomer('ghost-customer');
    expect(unknown).toEqual([]);

    // 空 customer_id：稳定可区分错误（DISTINGUISHABLE 契约）
    let error: unknown;
    try {
      await readTasksByCustomer('');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TaskReadScopeError);
    expect((error as TaskReadScopeError).code).toBe('EMPTY_CUSTOMER_ID');
    // 错误消息不含敏感数据（仅固定文案）
    expect((error as Error).message).toContain('non-empty customer_id');
  });
});
