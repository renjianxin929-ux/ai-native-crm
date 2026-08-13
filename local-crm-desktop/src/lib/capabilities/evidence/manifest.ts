/**
 * V0.2A / A8R — Evidence Read Capability Manifest.
 *
 * 领域 manifest：只读 CapabilityDefinition 数组，通过 A1 的领域扩展缝
 * (createCapabilityRegistry(...manifests)) 组合进注册表，无需修改任何中央文件。
 *
 * ── 库存真相（Inventory Truth）──
 * 经完整产品审计（inventory.ts），五项候选 Evidence 读取能力在
 * 当前产品中均不构成独立 Evidence 域读取能力：
 *   - read_customer_evidence     → NOT_DISTINCT（无独立客户级 Evidence 视图）
 *   - read_evidence_detail       → NOT_EXISTING（无 evidence-by-ID 产品行为）
 *   - read_battle_card_evidence  → NOT_DISTINCT（Battle Card 投影，A7R 域）
 *   - read_supporting_evidence   → NOT_DISTINCT（CRM_FACT 行嵌套列，非独立读取）
 *   - search_filter_evidence     → NOT_EXISTING（无产品搜索/过滤行为）
 *
 * 因此生产 manifest 为空冻结数组：这是对"当前产品没有独立 Evidence 读取面"
 * 的真实反映。REAL_CAPABILITIES_ONLY=true、NO_FICTIONAL_CAPABILITY=true
 * （任务 §4 / §29）。A8R 不注册：
 *   - repository helper（imports.get、listVerifiedFacts 等无产品消费方者）
 *   - Battle Card primitives（A7R 域，§9）
 *   - Fact/Hypothesis 读取（battleCard 域 CRM_FACT，§10/§15）
 *   - V0.2B 未来能力（§21）
 *
 * 空 manifest 仍通过 A1 扩展缝独立可组合：createCapabilityRegistry 接受
 * 任意数量 manifest（含空数组），注册表 size 不受影响、无身份碰撞。
 *
 * 组合用法（由调用方/测试执行）：
 *   import { createCapabilityRegistry } from '../registry';
 *   import { EVIDENCE_READ_CAPABILITY_MANIFEST } from './manifest';
 *   const registry = createCapabilityRegistry(
 *     CUSTOMER_CAPABILITY_MANIFEST, TIMELINE_READ_CAPABILITY_MANIFEST,
 *     FOLLOW_UP_READ_MANIFEST, TASK_READ_MANIFEST,
 *     EVIDENCE_READ_CAPABILITY_MANIFEST,
 *   );
 */

import type { CapabilityDefinition } from '../types';

/**
 * Evidence 域生产 manifest：空（经审计确认当前产品无独立 Evidence 读取能力）。
 * 冻结数组；A1 registry 会再次 clone + deepFreeze（对空数组为 no-op）。
 */
export const EVIDENCE_READ_CAPABILITY_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([]);

/** 生产 manifest 中的能力 id 集合（本次为空 — 产品现状，供测试断言库存真相）。 */
export const EVIDENCE_READ_CAPABILITY_IDS: readonly string[] = Object.freeze(
  EVIDENCE_READ_CAPABILITY_MANIFEST.map((definition) => definition.id),
);
