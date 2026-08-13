/**
 * V0.2A / A7R — Battle Card READ Capability Manifest (domain: battle-card).
 *
 * 本模块是 Battle Card 域的独立可组合 manifest（A1 扩展缝：createCapabilityRegistry(...manifests)）。
 * - 纯声明式：只描述能力，不包含任何执行 / DB / 网络 / 模型语义。
 * - 只注册经审计证明在当前产品中真实存在的 READ 能力（见 inventory.ts）：
 *   1. battle_card.current.read — 客户当前作战卡（客户指针 → customer_stage_cards）
 *   2. battle_card.history.read — 客户作战卡版本历史（append-only 版本表）
 *   3. battle_card.context.read — 客户作战上下文聚合（facts/hypotheses/cards/imports + 当前卡）
 * - 不修改 A1 中心文件（types.ts / registry.ts / index.ts）。
 * - 不注册：stage/applicability（内部投影，§8）、daily review（更高层工作流，§10）、
 *   evidence 原语（概念上属于 Evidence 域，但 A8R 审计证明当前独立 Evidence
 *   能力集为空——无独立 Evidence 产品表面，§9）、compare（无生产消费者，§11）。
 *
 * 执行器绑定原则（§11 AGENT TOOL PARITY）：Battle Card 的只读 agent 工具
 * （get_current_stage_card / list_stage_card_history / get_customer_battle_context）
 * 与真实产品读取路径共享同一实现（battleCardClient → createBattleCardAgentTools →
 * stageCardEngine / repositories），不存在 Timeline 式的 legacy 快照投影 mismatch。
 * executor_ref 指向该真实产品执行路径；adapter 绑定见 readAdapter.ts。
 *
 * data_target 论证：作战卡是带生命周期状态（DRAFT/CONFIRMED）、版本与客户指针的
 * 可变状态实体（customer_stage_cards + customers.current_stage_card_id），
 * 与 task / follow-up 同属 CRM_STATE 词汇（A1 types.ts 定义）。
 * error_contract 说明：现有产品读取路径（engine.getCurrentStageCard 对未知客户抛
 * Error message；list 返回空数组）无稳定错误码体系，故如实声明 UNSPECIFIED。
 */

import type { CapabilityDefinition } from '../types';

/** A7R 领域名（A1 registry.ts 组合注释中预留的 battle-card 域）。 */
export const BATTLE_CARD_DOMAIN = 'battle-card' as const;

/** A7R 生产能力版本。 */
export const BATTLE_CARD_READ_VERSION = '1.0.0' as const;

/** A7R 生产能力身份（稳定身份 = id + version）。 */
export const BATTLE_CARD_CAPABILITY_IDS = {
  currentRead: 'battle_card.current.read',
  historyRead: 'battle_card.history.read',
  contextRead: 'battle_card.context.read',
} as const;

/** 审计契约：读能力与 A1 READ fixture 惯例一致（全显式声明；读记录输入输出，不产生效果）。 */
const BATTLE_CARD_READ_AUDIT = {
  audit_required: true,
  record_input: true,
  record_output: true,
  record_effect: false,
} as const;

/** Battle Card 读能力通用语义：纯读取、零写、无需确认、客户范围、幂等安全。 */
const BATTLE_CARD_READ_SEMANTICS = {
  effect: 'READ',
  data_target: 'CRM_STATE',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'CUSTOMER',
  idempotency: 'SAFE',
  error_contract: 'UNSPECIFIED',
} as const;

/**
 * Battle Card 域生产 manifest：仅包含经审计确认真实存在的确定性 READ 能力，
 * 执行器绑定真实当前产品读取路径。冻结数组；A1 registry 会再次 clone + deepFreeze。
 */
export const BATTLE_CARD_READ_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: BATTLE_CARD_CAPABILITY_IDS.currentRead,
    version: BATTLE_CARD_READ_VERSION,
    domain: BATTLE_CARD_DOMAIN,
    description:
      'Read the current stage battle card for an explicit customer scope through the real product read path (engine.getCurrentStageCard: customers.current_stage_card_id pointer → customer_stage_cards row; unknown customer fails closed; no global/latest fallback).',
    input_schema: 'battle_card.current.read.query.v1',
    output_schema: 'battle_card.current.read.result.v1',
    ...BATTLE_CARD_READ_SEMANTICS,
    executor_ref: 'battleCard:getCurrentStageCard',
    audit_contract: { ...BATTLE_CARD_READ_AUDIT },
  },
  {
    id: BATTLE_CARD_CAPABILITY_IDS.historyRead,
    version: BATTLE_CARD_READ_VERSION,
    domain: BATTLE_CARD_DOMAIN,
    description:
      'Read the append-only stage battle card version history for an explicit customer scope through the real product read path (engine.listStageCardHistory → repos.cards.listByCustomer: customer_stage_cards WHERE customer_id = ? ORDER BY created_at ASC, version ASC, id ASC).',
    input_schema: 'battle_card.history.read.query.v1',
    output_schema: 'battle_card.history.read.result.v1',
    ...BATTLE_CARD_READ_SEMANTICS,
    executor_ref: 'battleCard:listStageCardHistory',
    audit_contract: { ...BATTLE_CARD_READ_AUDIT },
  },
  {
    id: BATTLE_CARD_CAPABILITY_IDS.contextRead,
    version: BATTLE_CARD_READ_VERSION,
    domain: BATTLE_CARD_DOMAIN,
    description:
      'Read the aggregated customer battle context for an explicit customer scope through the real product read path (getCustomerBattleContext: facts/hypotheses/cards/imports listByCustomer + current stage card, all customer_id-scoped SELECTs; embedded evidence refs preserved verbatim; no Evidence domain primitive).',
    input_schema: 'battle_card.context.read.query.v1',
    output_schema: 'battle_card.context.read.result.v1',
    ...BATTLE_CARD_READ_SEMANTICS,
    executor_ref: 'battleCard:getCustomerBattleContext',
    audit_contract: { ...BATTLE_CARD_READ_AUDIT },
  },
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与身份碰撞）。 */
export const BATTLE_CARD_READ_CAPABILITY_IDS: readonly string[] = Object.freeze(
  BATTLE_CARD_READ_MANIFEST.map((definition) => definition.id),
);
