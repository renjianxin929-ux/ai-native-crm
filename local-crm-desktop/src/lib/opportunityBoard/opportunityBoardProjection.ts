/**
 * V0.2C / C0 — Personal Opportunity Board Data Projection（语义闭合版）。
 *
 * 这是未来个人销售看板（personal sales board）的唯一可复用数据投影层。
 * 本模块是纯函数投影：只读取现有 CRM 客户行，把看板需要的"客户身份 /
 * 真实推进状态 / 商机金额或 unknown / 下次跟进 / won-lost 资格"派生出来。
 *
 * 本版解决上一版的语义混同（AMBIGUOUS_ACTIVE_SEMANTIC_REMOVED=true）：
 *   - 明确"看板列态（board column state）"与"聚合资格（aggregate eligibility）"
 *     是两个独立概念，不再用同一个含糊的 ACTIVE 标签同时表达两者；
 *   - 每个 CustomerStage 都恰好映射到一个看板列态，无未分类阶段；
 *   - PAID 得到显式分类（见 deriveBoardStage）。
 *
 * 硬性不变量（C0 冻结）：
 *   - BOARD_STATUS_DERIVED_FROM_REAL_CRM_STATE=true：board_stage 是 customers.stage
 *     的纯函数，绝不另建一套看板状态；
 *   - BOARD_HAS_INDEPENDENT_STATUS_STATE=false：本模块不持久化、不引入任何
 *     独立的看板状态实体；
 *   - UNKNOWN_AMOUNT_IS_NULL=true：opportunity_amount 缺失/未记录即 null（unknown）；
 *   - NULL_AGGREGATED_AS_ZERO=false：null 金额绝不进入任何求和，也不被当成 0；
 *   - AI_INFERRED_AMOUNT_PERSISTED=false / STAGE_DEFAULT_AMOUNT=false：本模块
 *     绝不派生/推断任何默认金额，只透传显式记录的 opportunity_amount；
 *   - 金额只在其底层客户/商机状态使其"合格"时才计数；
 *   - 客户阶段变化不抹除已记录金额（金额保留在客户行上，只在聚合层决定是否计入）。
 *
 * 本模块不含任何 presentation styling / 图表 / 假聚合 / 团队指标 / 预测。
 */

import type { Customer, CustomerStage } from '../types';

/**
 * 看板列态（board column state）：纯从 customers.stage 派生，绝不新增独立状态。
 *
 *   NEW     —— 新线索/触达（未到面访阶段）：首次触达、建立联系、挖掘需求
 *   ACTIVE  —— 推进中（面访阶段）：约访/面访、确认需求与方案契合
 *   PENDING —— 待确认/待决策（成交阶段）：合同条款确认、待打款
 *   WON     —— 已完成（成交侧）：已打款(PAID) 与 已成交(WON)
 *   LOST    —— 丢单
 *
 * 终端态集合（PAID / WON / LOST）与产品 Battle Card 的 `isActiveStage` 定义一致
 * （src/lib/battleCard/dailyReview.ts：`isActiveStage = !['WON','LOST','PAID']`），
 * 即产品自身把 PAID 与 WON / LOST 一并视为"非活跃/已终结"。
 */
export type BoardStage = 'NEW' | 'ACTIVE' | 'PENDING' | 'WON' | 'LOST';

/**
 * 纯函数：从真实客户阶段派生看板列态（穷尽映射，无未分类阶段）。
 * 每个 CustomerStage 恰好映射到一个列态；未知阶段 fail closed（绝不静默归并）。
 */
export function deriveBoardStage(stage: CustomerStage | string): BoardStage {
  switch (stage) {
    // 新线索 / 触达（未到面访）
    case 'NEW_LEAD':
    case 'CONTACTED':
    case 'WECHAT_PASSED':
    case 'REPLIED':
      return 'NEW';
    // 推进中（面访阶段）
    case 'VISIT_READY':
    case 'VISITED':
      return 'ACTIVE';
    // 待确认 / 待决策（合同与打款）
    case 'CONTRACTING':
    case 'PAYMENT_PENDING':
      return 'PENDING';
    // 已完成（成交侧：已打款 + 已成交）
    case 'PAID':
    case 'WON':
      return 'WON';
    // 丢单
    case 'LOST':
      return 'LOST';
    default:
      throw new Error(`Unknown customer stage cannot be projected to a board column: ${stage}`);
  }
}

/**
 * 未结案（open pipeline）资格：非终端商机 = 不是 PAID / WON / LOST。
 * 与产品 Battle Card `isActiveStage`（dailyReview.ts:113）同一真值来源：
 * 活跃 = 非 {WON, LOST, PAID}。
 */
export function isOpenPipelineStage(stage: CustomerStage | string): boolean {
  return !['WON', 'LOST', 'PAID'].includes(stage);
}

/** 单客户看板投影行。 */
export interface OpportunityBoardRow {
  /** 客户身份（唯一权威身份 = customers.id）。 */
  readonly customer_id: string;
  readonly name: string;
  /** 真实推进状态（单一真源，绝不改写）。 */
  readonly stage: CustomerStage;
  /** 派生看板列态（stage 的纯函数）。 */
  readonly board_stage: BoardStage;
  /** 是否计入未结案（open pipeline）。 */
  readonly open_pipeline: boolean;
  /** 商机金额或 unknown（null = unknown；绝不渲染/聚合为 0）。 */
  readonly opportunity_amount: number | null;
  /** 下次相关跟进时间（若产品已支持；否则 null）。 */
  readonly next_follow_up_at: string | null;
}

/** 看板最小摘要（列态与聚合资格分离；无假聚合；只按合格状态计数真实金额）。 */
export interface OpportunityBoardSummary {
  /** 未结案机会金额 = NEW + ACTIVE + PENDING（不含 PAID/WON/LOST）。 */
  readonly open_pipeline_amount: number;
  /** NEW 列 subtotal。 */
  readonly new_column_amount: number;
  /** ACTIVE 列 subtotal（推进中）。 */
  readonly active_column_amount: number;
  /** PENDING 列 subtotal（待确认/待决策）。 */
  readonly pending_column_amount: number;
  /** WON 列 subtotal = PAID + WON（已完成/成交侧）。 */
  readonly won_amount: number;
  /** LOST 列 subtotal（历史保留；不计入 open/won）。 */
  readonly lost_amount: number;
  /** 未结案中金额为 null 的客户数（unknown 金额个数）。 */
  readonly unknown_amount_count: number;
  /** 各列计数。 */
  readonly new_count: number;
  readonly active_count: number;
  readonly pending_count: number;
  readonly won_count: number;
  readonly lost_count: number;
  readonly open_pipeline_count: number;
}

export interface OpportunityBoardProjection {
  readonly rows: readonly OpportunityBoardRow[];
  readonly summary: OpportunityBoardSummary;
}

/** 只把"非 null 且有限"的金额计入求和；null 永不当作 0。 */
function eligibleAmount(amount: number | null | undefined): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  return amount;
}

/**
 * 投影：给定真实客户行，派生看板行与最小摘要。
 *
 * 聚合规则（C0 语义闭合冻结）：
 *   OPEN_PIPELINE_AMOUNT = Σ opportunity_amount | stage ∉ {PAID, WON, LOST} && amount != null
 *                         = NEW + ACTIVE + PENDING 三列 subtotal 之和
 *   ACTIVE_COLUMN_AMOUNT = Σ opportunity_amount | stage ∈ {VISIT_READY, VISITED} && amount != null
 *   PENDING_COLUMN_AMOUNT= Σ opportunity_amount | stage ∈ {CONTRACTING, PAYMENT_PENDING} && amount != null
 *   NEW_COLUMN_AMOUNT    = Σ opportunity_amount | stage ∈ {NEW_LEAD, CONTACTED, WECHAT_PASSED, REPLIED} && amount != null
 *   WON_AMOUNT           = Σ opportunity_amount | stage ∈ {PAID, WON} && amount != null
 *   LOST_AMOUNT          = Σ opportunity_amount | stage == LOST && amount != null（历史保留）
 *   UNKNOWN_AMOUNT       = count(rows) | stage ∉ {PAID, WON, LOST} && amount == null
 *
 *   OPEN_PIPELINE_AMOUNT 明确表示"全部未结案机会金额"，绝不暗示它只是"推进中"列。
 */
export function projectOpportunityBoard(customers: readonly Customer[]): OpportunityBoardProjection {
  const rows: OpportunityBoardRow[] = [];
  let open_pipeline_amount = 0;
  let new_column_amount = 0;
  let active_column_amount = 0;
  let pending_column_amount = 0;
  let won_amount = 0;
  let lost_amount = 0;
  let unknown_amount_count = 0;
  let new_count = 0;
  let active_count = 0;
  let pending_count = 0;
  let won_count = 0;
  let lost_count = 0;

  for (const customer of customers) {
    const stage = customer.stage;
    const board_stage = deriveBoardStage(stage);
    const open_pipeline = isOpenPipelineStage(stage);
    const rawAmount = customer.opportunity_amount;
    // unknown 语义：null / undefined / 非有限数一律视为 unknown（null）。
    const amount = eligibleAmount(rawAmount);

    rows.push({
      customer_id: customer.id,
      name: customer.name,
      stage,
      board_stage,
      open_pipeline,
      opportunity_amount: amount,
      next_follow_up_at: customer.next_follow_up_at ?? null,
    });

    switch (board_stage) {
      case 'NEW': {
        new_count += 1;
        if (amount !== null) {
          new_column_amount += amount;
          open_pipeline_amount += amount;
        } else {
          unknown_amount_count += 1;
        }
        break;
      }
      case 'ACTIVE': {
        active_count += 1;
        if (amount !== null) {
          active_column_amount += amount;
          open_pipeline_amount += amount;
        } else {
          unknown_amount_count += 1;
        }
        break;
      }
      case 'PENDING': {
        pending_count += 1;
        if (amount !== null) {
          pending_column_amount += amount;
          open_pipeline_amount += amount;
        } else {
          unknown_amount_count += 1;
        }
        break;
      }
      case 'WON': {
        won_count += 1;
        if (amount !== null) won_amount += amount;
        break;
      }
      case 'LOST': {
        lost_count += 1;
        if (amount !== null) lost_amount += amount;
        break;
      }
    }
  }

  const open_pipeline_count = new_count + active_count + pending_count;

  return Object.freeze({
    rows: Object.freeze(rows),
    summary: Object.freeze({
      open_pipeline_amount,
      new_column_amount,
      active_column_amount,
      pending_column_amount,
      won_amount,
      lost_amount,
      unknown_amount_count,
      new_count,
      active_count,
      pending_count,
      won_count,
      lost_count,
      open_pipeline_count,
    }),
  });
}
