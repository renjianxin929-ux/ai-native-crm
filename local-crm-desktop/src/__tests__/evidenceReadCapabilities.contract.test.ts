/**
 * V0.2A / A8R — Evidence Read Capabilities 聚焦测试。
 *
 * 覆盖规格 T1–T16。核心结论（产品真相）：
 *   当前 CRM 无独立 Evidence 读取面（EVIDENCE_FIRST_CLASS_ENTITY=false），
 *   五项候选能力经审计全部为 NOT_DISTINCT / NOT_EXISTING，
 *   生产 manifest 为空冻结数组 —— 诚实反映产品现状，零虚构能力。
 *
 * 原则（与 A2/A4R/A5R/A6R 测试一致）：
 * - 不修改任何现有文件；只新增本测试与 capabilities/evidence/** 模块。
 * - 不弱化/替换任何既有测试。
 * - 静态架构证据扫描 capabilities/evidence/** 源码，保证零写、零模型、零网络。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../lib/capabilities';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../lib/capabilities/customer';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline';
import { FOLLOW_UP_READ_MANIFEST } from '../lib/capabilities/followUp';
import { TASK_READ_MANIFEST } from '../lib/capabilities/task';
import {
  EVIDENCE_READ_CAPABILITY_MANIFEST,
  EVIDENCE_READ_CAPABILITY_IDS,
  EVIDENCE_READ_INVENTORY,
  VERIFIED_EVIDENCE_READ_CANDIDATES,
  EVIDENCE_FIRST_CLASS_ENTITY,
  CURRENT_EVIDENCE_FIELDS,
  V0_2B_EVIDENCE_SCHEMA_GAPS,
} from '../lib/capabilities/evidence';

const EVIDENCE_DIR = resolve(__dirname, '../lib/capabilities/evidence');

/** 剥离注释 + 字符串字面量——静态扫描只针对实际代码（标识符/调用），不针对文档与审计文本。 */
function stripCodeNoise(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  out = out.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

/** 读取 evidence 域源码（仅代码，无注释/字符串）——静态架构证据扫描用。 */
function evidenceSourceFiles(): string[] {
  return ['index.ts', 'inventory.ts', 'manifest.ts'].map((file) =>
    stripCodeNoise(readFileSync(resolve(EVIDENCE_DIR, file), 'utf8')),
  );
}

/** 提取全部 import 语句（依赖边界白名单断言用；基于未剥离字符串的源码）。 */
function codeImports(): string[] {
  return ['index.ts', 'inventory.ts', 'manifest.ts']
    .map((file) => readFileSync(resolve(EVIDENCE_DIR, file), 'utf8'))
    .flatMap((code) =>
      code.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('import ')),
    );
}

/** Wave 1 已注册的 8 个能力身份（当前基线，T16 碰撞安全断言用）。 */
const WAVE_1_CAPABILITY_IDS: readonly string[] = [
  'customer.search',
  'customer.get',
  'customer.context',
  'timeline.customer.read',
  'timeline.visit.read',
  'follow_up.customer.read',
  'follow_up.global.read',
  'task.read_by_customer',
];

describe('T1 — MANIFEST CONTRACT: Evidence manifest conforms to A1 (truthfully empty)', () => {
  it('the manifest is a frozen A1-composable readonly array (empty = product truth)', () => {
    expect(Object.isFrozen(EVIDENCE_READ_CAPABILITY_MANIFEST)).toBe(true);
    // 空数组仍必须能通过 A1 扩展缝组合（createCapabilityRegistry 接受任意数量 manifest）。
    expect(() => createCapabilityRegistry(EVIDENCE_READ_CAPABILITY_MANIFEST)).not.toThrow();
    // 无任何注册：effect/data_target 等语义字段无虚构声明。
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    expect(EVIDENCE_READ_CAPABILITY_IDS).toEqual([]);
  });

  it('inventory records all five candidates with explicit NOT_DISTINCT / NOT_EXISTING status', () => {
    expect(EVIDENCE_READ_INVENTORY).toHaveLength(5);
    const statuses = new Set(EVIDENCE_READ_INVENTORY.map((entry) => entry.final_status));
    expect([...statuses].every((s) => s === 'NOT_DISTINCT' || s === 'NOT_EXISTING')).toBe(true);
    for (const entry of EVIDENCE_READ_INVENTORY) {
      // 每个 NOT_DISTINCT / NOT_EXISTING 必须有精确理由（§29 可追溯性）。
      expect(entry.not_distinct_reason.length).toBeGreaterThan(20);
      expect(entry.existing_source_path.length).toBeGreaterThan(0);
    }
  });
});

describe('T2 — DOMAIN COMPOSITION: Evidence manifest composes with A1 + Wave 1 without collisions', () => {
  it('composes into the A1 registry with all four Wave 1 manifests (no central-file edit)', () => {
    const registry = createCapabilityRegistry(
      CUSTOMER_CAPABILITY_MANIFEST,
      TIMELINE_READ_CAPABILITY_MANIFEST,
      FOLLOW_UP_READ_MANIFEST,
      TASK_READ_MANIFEST,
      EVIDENCE_READ_CAPABILITY_MANIFEST,
    );
    // Wave 1 的 8 个能力 + Evidence（0 个）→ 无身份碰撞，注册表 size 不变。
    expect(registry.size()).toBe(8);
    expect(registry.list().map((d) => d.id).sort()).toEqual([...WAVE_1_CAPABILITY_IDS].sort());
    expect(registry.listByDomain('evidence')).toHaveLength(0);
  });

  it('evidence domain source has only the type-only A1 contract import (no central/business modules)', () => {
    // 依赖边界白名单：唯一允许的 import 是 type-only 的 '../types'（与 Wave 1 一致）。
    expect(codeImports()).toEqual([`import type { CapabilityDefinition } from '../types';`]);
  });
});

describe('T3 — PRODUCT INVENTORY TRUTH: only real product Evidence capabilities enter the manifest', () => {
  it('the empty manifest exactly matches the empty VERIFIED candidate set', () => {
    expect(VERIFIED_EVIDENCE_READ_CANDIDATES).toEqual([]);
    expect(EVIDENCE_READ_CAPABILITY_IDS).toEqual(VERIFIED_EVIDENCE_READ_CANDIDATES);
    // 无 repository-helper-only 能力、无未来 V0.2B 能力注册（清单为空即证明）。
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST.every((d) => false)).toBe(true);
  });

  it('EVIDENCE_FIRST_CLASS_ENTITY is truthfully false in the current product', () => {
    expect(EVIDENCE_FIRST_CLASS_ENTITY).toBe(false);
    // 字段清单只含当前产品现实字段（types.ts FactEvidenceRef / schema.ts 列 / import 行）。
    expect(CURRENT_EVIDENCE_FIELDS.length).toBeGreaterThan(0);
    const fields = CURRENT_EVIDENCE_FIELDS.map((f) => f.field);
    for (const realField of ['evidence_type', 'evidence_id', 'import_ref', 'evidence_refs_json']) {
      expect(fields.some((f) => f.includes(realField))).toBe(true);
    }
  });
});

describe('T4 — CUSTOMER EVIDENCE READ: NOT_DISTINCT, intentional absence proven', () => {
  it('no customer-evidence read capability is registered; the inventory records the real product path', () => {
    const entry = EVIDENCE_READ_INVENTORY.find((e) => e.candidate === 'read_customer_evidence')!;
    expect(entry.product_capability_exists).toBe(false);
    expect(entry.final_status).toBe('NOT_DISTINCT');
    expect(EVIDENCE_READ_CAPABILITY_IDS).not.toContain('evidence.customer.read');
    // 产品路径证据：唯一 evidence 展示入口是 Battle Card 详情投影（A7R 域），
    // 数据源为 stage card payload 的字符串引用（CustomerBattleCardPage.tsx:106-112）。
    expect(entry.existing_source_path.join('\n')).toContain('CustomerBattleCardPage.tsx:106-112');
  });
});

describe('T5 — EVIDENCE DETAIL: NOT_EXISTING, intentional absence proven', () => {
  it('no evidence-by-ID product behavior exists anywhere in src', () => {
    const entry = EVIDENCE_READ_INVENTORY.find((e) => e.candidate === 'read_evidence_detail')!;
    expect(entry.final_status).toBe('NOT_EXISTING');
    expect(EVIDENCE_READ_CAPABILITY_IDS).not.toContain('evidence.get');
    expect(EVIDENCE_READ_CAPABILITY_IDS).not.toContain('evidence.detail');
    // inventory 明确记录：imports.get(id) 无产品 UI 消费方且 SQL 无 customer 过滤，
    // 按 Product Capability Rule 不注册（且避免 IDOR 放大，§17）。
    expect(entry.not_distinct_reason).toMatch(/imports\.get/);
    expect(entry.not_distinct_reason).toMatch(/IDOR/);
  });
});

describe('T6 — PRODUCT / EXECUTOR PARITY: no registered capability diverges from a real product path', () => {
  it('with zero registrations there is no executor-parity mismatch to hide', () => {
    // 无注册能力 → 无 "Legacy Agent Tool parity alone" 问题（§12）。
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    // 没有任何 executor_ref 指向 salesAgentTools 或虚构路径。
    const source = evidenceSourceFiles().join('\n');
    expect(source).not.toMatch(/executor_ref/);
  });
});

describe('T7 — CROSS-CUSTOMER ISOLATION: A8R exposes no customer data at all', () => {
  it('the empty manifest has no surface that could leak customer B evidence to customer A', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    // 无 readAdapter / repository 绑定 → 无任何数据读取路径（代码级扫描）。
    const source = evidenceSourceFiles().join('\n');
    expect(source).not.toMatch(/select|SELECT|FROM /);
    expect(source).not.toMatch(/createCrmRepository|createBattleCardRepositories|getDb/);
  });
});

describe('T8 — IDOR / CROSS-CUSTOMER DETAIL: no by-ID surface is exposed by A8R', () => {
  it('A8R introduces no evidence-by-ID access; inherited product limitation is reported, not widened', () => {
    expect(EVIDENCE_READ_CAPABILITY_IDS).toEqual([]);
    const entry = EVIDENCE_READ_INVENTORY.find((e) => e.candidate === 'read_evidence_detail')!;
    // 产品既有弱点（imports.get 无 customer 过滤）被如实记录为不注册理由
    // （BACKLOG / inherited，A8R 不修复也不放大，§25）。
    expect(entry.not_distinct_reason).toMatch(/widen access/);
  });
});

describe('T9 — EVIDENCE != FACT: reading never mutates fact/verification state', () => {
  it('the manifest registers no write/verification/promotion semantics at all', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    // 无能力暗示 evidence.verify / evidence.accept / evidence.promote_to_fact /
    // fact.verify / hypothesis.confirm（§10 禁止清单）。
    const source = evidenceSourceFiles().join('\n');
    expect(source).not.toMatch(/verify|promote|confirm|accept/);
    // EVIDENCE 与 CRM_FACT 边界在 inventory 中明确记录（§10/§15）。
    expect(V0_2B_EVIDENCE_SCHEMA_GAPS.some((g) => g.field === 'confidence (evidence-level)')).toBe(true);
  });
});

describe('T10 — PROVENANCE PRESERVATION: A8R transforms no persisted data', () => {
  it('with zero read adapters there is no transformation that could drop or alter provenance', () => {
    const source = evidenceSourceFiles().join('\n');
    // 无任何产品数据读取/解析/投影函数引用（provenance 留在原处，未被 A8R 搬运/改写）。
    for (const token of ['parseJsonArray', 'parseFactEvidenceRefs', 'toStageCardBundle', 'splitEvidenceRefs', 'listByCustomer', 'imports.get']) {
      expect(source).not.toContain(token);
    }
    // inventory 字段清单逐项引用产品源码位置（provenance 定义留在原处）。
    expect(CURRENT_EVIDENCE_FIELDS.every((f) => f.location.length > 0)).toBe(true);
  });
});

describe('T11 — MISSING PROVENANCE TRUTH: no fabricated roadmap fields', () => {
  it('V0.2B schema gaps are recorded and must remain absent from the model inventory', () => {
    const gapFields = V0_2B_EVIDENCE_SCHEMA_GAPS.map((g) => g.field);
    for (const roadmapField of ['source_type', 'url', 'published_at', 'retrieved_at', 'claim', 'citation']) {
      expect(gapFields).toContain(roadmapField);
      // 同一字段不得出现在 CURRENT_EVIDENCE_FIELDS（不得假装已存在）。
      expect(CURRENT_EVIDENCE_FIELDS.some((f) => f.field === roadmapField)).toBe(false);
    }
    // 清单不为空：V0.2B 缺口被诚实记录（§21）。
    expect(V0_2B_EVIDENCE_SCHEMA_GAPS.length).toBeGreaterThanOrEqual(6);
  });
});

describe('T12 — BATTLE CARD OWNERSHIP: Evidence manifest registers no Battle Card primitives', () => {
  it('no battle-card / stage-card / evidence-drawer capability id is registered', () => {
    expect(EVIDENCE_READ_CAPABILITY_IDS).toEqual([]);
    expect(EVIDENCE_READ_CAPABILITY_IDS.some((id) => id.startsWith('battle_card') || id.startsWith('battleCard') || id.startsWith('stage_card'))).toBe(false);
    // inventory 明确声明 Battle Card Evidence 读取归属 A7R（§9）。
    const entry = EVIDENCE_READ_INVENTORY.find((e) => e.candidate === 'read_battle_card_evidence')!;
    expect(entry.final_status).toBe('NOT_DISTINCT');
    expect(entry.not_distinct_reason).toMatch(/A7R/);
  });
});

describe('T13 — FACT VERIFICATION OWNERSHIP: no verification/write primitives registered', () => {
  it('the manifest contains no fact-verification or write capability', () => {
    expect(EVIDENCE_READ_CAPABILITY_IDS).toEqual([]);
    const source = evidenceSourceFiles().join('\n');
    expect(source).not.toMatch(/fact_verification|verification_status|editFact|rejectFact/);
  });
});

describe('T14 — ZERO WRITES: no Evidence/Fact/Battle Card mutation paths', () => {
  it('evidence domain source contains zero write-capable references', () => {
    const source = evidenceSourceFiles().join('\n');
    for (const writeToken of [
      'db.execute', 'INSERT INTO', 'UPDATE ', 'DELETE FROM',
      'createEvidence', 'addEvidence', 'updateEvidence', 'deleteEvidence',
      'attachEvidence', 'detachEvidence', 'propose', 'confirmWrite',
      'registerCanonicalProposal', 'SalesAgentSession',
    ]) {
      expect(source).not.toMatch(new RegExp(writeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

describe('T15 — ZERO MODEL / NETWORK: no provider/network/model dependencies', () => {
  it('evidence domain source contains no model/network/provider references', () => {
    const source = evidenceSourceFiles().join('\n');
    for (const token of ['provider', 'model', 'fetch(', 'http', 'network', 'firecrawl', 'deepseek', 'LLM', 'vision']) {
      expect(source.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });
});

describe('T16 — REGISTRY COLLISION SAFETY: no id collision with the 8 Wave 1 capabilities', () => {
  it('combined registry keeps exactly the 8 Wave 1 ids (evidence adds none, collides with none)', () => {
    const registry = createCapabilityRegistry(
      CUSTOMER_CAPABILITY_MANIFEST,
      TIMELINE_READ_CAPABILITY_MANIFEST,
      FOLLOW_UP_READ_MANIFEST,
      TASK_READ_MANIFEST,
      EVIDENCE_READ_CAPABILITY_MANIFEST,
    );
    expect(registry.size()).toBe(8);
    const ids = registry.list().map((d) => d.id);
    for (const wave1 of WAVE_1_CAPABILITY_IDS) expect(ids).toContain(wave1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
