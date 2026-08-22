import type { AIDraft, Customer } from '../types';
import { INTENT_LABELS, NEXT_ACTION_LABELS } from '../types';

export type SalesBriefItem = {
  readonly customer: Customer;
  readonly risk: string;
  readonly opportunity: string;
  readonly nextAction: string;
  readonly evidenceReferences: readonly string[];
  readonly existingInsightCount: number;
};

export function buildSalesBrief(
  priorityCustomers: readonly Customer[],
  riskCustomers: readonly Customer[],
  existingInsights: readonly AIDraft[],
): readonly SalesBriefItem[] {
  const risks = new Set(riskCustomers.map(customer => customer.id));
  const insightsByCustomer = new Map<string, number>();
  existingInsights
    .filter(item => item.status === 'APPLIED' && item.customer_id)
    .forEach(item => insightsByCustomer.set(item.customer_id!, (insightsByCustomer.get(item.customer_id!) || 0) + 1));
  return [...new Map(priorityCustomers.map(customer => [customer.id, customer])).values()].map(customer => ({
    customer,
    risk: risks.has(customer.id) ? '长期未触达，需要人工确认风险' : '暂无既有风险信号',
    opportunity: customer.industry ? `${customer.industry} · ${INTENT_LABELS[customer.intent_level]}` : '行业/主营产品待补充',
    nextAction: customer.next_action ? NEXT_ACTION_LABELS[customer.next_action] : '暂无已有建议',
    evidenceReferences: [`customer:${customer.id}`, ...(customer.last_contacted_at ? ['last_contacted_at'] : []), ...(customer.next_follow_up_at ? ['next_follow_up_at'] : [])],
    existingInsightCount: insightsByCustomer.get(customer.id) || 0,
  }));
}
