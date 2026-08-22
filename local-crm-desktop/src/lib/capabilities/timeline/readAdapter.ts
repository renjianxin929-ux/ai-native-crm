/**
 * V0.2A / A4R — Timeline READ adapter（只读绑定，真实产品路径）。
 *
 * 绑定原则（Targeted Product-Parity Closure）：
 * - 直接复用当前产品真实读取函数，零复制、零发明：
 *   - timeline.visit.read     → db.ts listVisits(customerId)
 *   - timeline.customer.read  → db.ts listFollowUps + listVisits
 *                               → buildCustomerTimeline（产品 UI 使用的同一投影）
 * - 不绑定 legacy agent 工具（get_customer_timeline / list_customer_followups /
 *   list_customer_visits 的快照投影），其语义 mismatch 记录为
 *   LEGACY_AGENT_TOOL_SEMANTIC_MISMATCH，属于后续专门 closure。
 *
 * 零写保证：本模块不 import 任何 DB 写入函数；仅调用现有只读产品函数
 * （listFollowUps / listVisits 均为 SELECT-only）。
 */

import { listFollowUps, listVisits } from '../../db';
import { buildCustomerTimeline, type CustomerTimelineItem } from '../../salesWorkspace/customerIntelligence';
import type { VisitRecord } from '../../types';

/** Timeline 读取的统一输入边界：显式客户范围。 */
export interface TimelineProductReadInput {
  readonly customer_id: string;
}

/** Timeline 读取的统一输出边界：记录 + 来源引用 + 只读语义（与现有读取结果形状一致）。 */
export interface TimelineProductReadResult<T> {
  readonly customer_id: string;
  readonly records: readonly T[];
  readonly evidence_refs: readonly string[];
  readonly read_only: true;
  readonly writes_crm: false;
}

/**
 * timeline.customer.read 绑定：真实产品 Timeline 读取。
 * 输出与产品 UI（CustomerDetail：listFollowUps + listVisits → buildCustomerTimeline）
 * 完全一致：occurredAt 降序投影，evidenceId 保留。
 */
export async function readCustomerTimeline(input: TimelineProductReadInput): Promise<TimelineProductReadResult<CustomerTimelineItem>> {
  assertCustomerScoped(input);
  const [followUps, visits] = await Promise.all([
    listFollowUps(input.customer_id),
    listVisits(input.customer_id),
  ]);
  const timeline = buildCustomerTimeline(followUps, visits);
  return {
    customer_id: input.customer_id,
    records: timeline,
    evidence_refs: timeline.map(item => item.evidenceId),
    read_only: true,
    writes_crm: false,
  };
}

/**
 * timeline.visit.read 绑定：真实产品 Visit 读取（db.ts listVisits）。
 * 输出即 visit_records 客户范围记录（WHERE customer_id = ? ORDER BY created_at DESC）。
 */
export async function readCustomerVisits(input: TimelineProductReadInput): Promise<TimelineProductReadResult<VisitRecord>> {
  assertCustomerScoped(input);
  const visits = await listVisits(input.customer_id);
  return {
    customer_id: input.customer_id,
    records: visits,
    evidence_refs: visits.map(visit => visit.id),
    read_only: true,
    writes_crm: false,
  };
}

/** Fail closed：缺失/空白客户范围直接拒绝，不做任何全局回退。 */
function assertCustomerScoped(input: TimelineProductReadInput): void {
  if (!input.customer_id.trim()) {
    throw new Error('Timeline read requires an explicit non-empty customer scope.');
  }
}
