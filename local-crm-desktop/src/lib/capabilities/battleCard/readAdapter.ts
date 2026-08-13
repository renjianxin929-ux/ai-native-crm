/**
 * V0.2A / A7R — Battle Card READ adapter（只读绑定，真实产品路径）。
 *
 * 绑定原则（Targeted Product-Parity Closure）：
 * - 直接复用当前产品真实读取函数，零复制、零发明：
 *   - battle_card.current.read  → createBattleCardAgentTools({ db }).getCurrentStageCard(customerId)
 *   - battle_card.history.read  → createBattleCardAgentTools({ db }).listStageCardHistory(customerId)
 *   - battle_card.context.read  → createBattleCardAgentTools({ db }).getCustomerBattleContext(customerId)
 * - 与产品 UI（CustomerBattleCardPage / SalesAgentBattleCardEntry）经由
 *   battleCardClient 走完全相同的执行路径（同一 agentTools / stageCardEngine / repositories）。
 * - 不存在 legacy 快照投影 mismatch：Battle Card 只读工具与产品读取共享同一实现（§11）。
 *
 * 客户范围安全（§16）：
 * - 显式非空 customer_id 断言，缺失/空白直接拒绝（fail closed），无全局回退。
 * - 当前卡经 customers.current_stage_card_id 客户指针读取；历史经
 *   WHERE customer_id = ? 过滤；聚合上下文全部 customer_id 范围 SELECT。
 * - 未知客户：当前卡路径抛 Error（产品语义，fail closed）；历史返回空数组（产品语义，不泄露）。
 *
 * 零写保证（§18）：本模块只调用产品只读读取函数（getCurrentStageCard /
 * listStageCardHistory / getCustomerBattleContext 均为 SELECT-only 路径），
 * 不 import 任何 DB 写入函数、确认写入/Proposal 流程或 Proposal 创建逻辑。
 * 零模型/网络（§19）：本模块不 import 模型提供方 / LLM / fetch；读取已持久化的
 * AI 生成内容 ≠ 调用模型。
 */

import type { DatabaseLike } from '../../db';
import { createBattleCardAgentTools } from '../../battleCard/agentTools';

/** Battle Card 读取的统一依赖边界：调用方注入数据库实例（与产品 getDb() 同一 DatabaseLike）。 */
export interface BattleCardReadDeps {
  readonly db: DatabaseLike;
  readonly clock?: () => string;
}

/** Battle Card 读取的统一输出边界：客户范围 + 产品路径数据 + 只读语义。 */
export interface BattleCardReadResult<T> {
  readonly customer_id: string;
  /** 产品读取路径原样返回的数据（不重算、不填充、不改写）。 */
  readonly data: T;
  readonly read_only: true;
  readonly writes_crm: false;
}

/**
 * battle_card.current.read 绑定：真实产品当前作战卡读取。
 * 输出与产品 UI（CustomerBattleCardPage.getCurrentStageCard）完全一致：
 * 客户指针 → customer_stage_cards 行；无卡时 null；未知客户 fail closed。
 */
export async function readCurrentBattleCard(
  deps: BattleCardReadDeps,
  customerId: string,
): Promise<BattleCardReadResult<Awaited<ReturnType<ReturnType<typeof createBattleCardAgentTools>['getCurrentStageCard']>>>> {
  assertCustomerScoped(customerId);
  const tools = createBattleCardAgentTools({ db: deps.db, clock: deps.clock });
  const card = await tools.getCurrentStageCard(customerId);
  return { customer_id: customerId, data: card, read_only: true, writes_crm: false };
}

/**
 * battle_card.history.read 绑定：真实产品版本历史读取。
 * 输出与产品 UI（CustomerBattleCardPage.listStageCardHistory → VersionHistoryPanel）
 * 完全一致：append-only 版本行（created_at ASC, version ASC, id ASC）。
 */
export async function readBattleCardHistory(
  deps: BattleCardReadDeps,
  customerId: string,
): Promise<BattleCardReadResult<Awaited<ReturnType<ReturnType<typeof createBattleCardAgentTools>['listStageCardHistory']>>>> {
  assertCustomerScoped(customerId);
  const tools = createBattleCardAgentTools({ db: deps.db, clock: deps.clock });
  const cards = await tools.listStageCardHistory(customerId);
  return { customer_id: customerId, data: cards, read_only: true, writes_crm: false };
}

/**
 * battle_card.context.read 绑定：真实产品客户作战上下文聚合读取。
 * 输出与产品 UI（SalesAgentBattleCardEntry.getCustomerBattleContext）完全一致。
 */
export async function readCustomerBattleContext(
  deps: BattleCardReadDeps,
  customerId: string,
): Promise<BattleCardReadResult<Awaited<ReturnType<ReturnType<typeof createBattleCardAgentTools>['getCustomerBattleContext']>>>> {
  assertCustomerScoped(customerId);
  const tools = createBattleCardAgentTools({ db: deps.db, clock: deps.clock });
  const context = await tools.getCustomerBattleContext(customerId);
  return { customer_id: customerId, data: context, read_only: true, writes_crm: false };
}

/** Fail closed：缺失/空白客户范围直接拒绝，不做任何全局回退。 */
function assertCustomerScoped(customerId: string): void {
  if (!customerId || !customerId.trim()) {
    throw new Error('Battle Card read requires an explicit non-empty customer scope.');
  }
}
