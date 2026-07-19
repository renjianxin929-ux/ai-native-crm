import type { DatabaseLike } from '../db';

export const CUSTOMER_PRIORITY_RANKING_TOOL_ID = 'customer_priority_ranking' as const;

interface PriorityRow {
  id: string; name: string; customer_grade: string | null; intent_level: string | null; stage: string | null;
  last_contacted_at: string | null; next_follow_up_at: string | null; updated_at: string | null;
  region: string | null; industry: string | null; contact_person: string | null; phone_number: string | null;
  email: string | null; next_action: string | null; phone_feedback: string | null; can_schedule_visit: number | null;
  deal_amount: number | null; open_tasks: number | string; interaction_count: number | string;
}

export interface CustomerPriorityRankedItem {
  readonly rank: number;
  readonly customer_id: string;
  readonly customer_name: string;
  readonly score: number;
  readonly deterministic_reasons: readonly string[];
  readonly evidence_references: readonly string[];
}

export interface CustomerPriorityRankingResult {
  readonly tool_id: typeof CUSTOMER_PRIORITY_RANKING_TOOL_ID;
  readonly items: readonly CustomerPriorityRankedItem[];
  readonly execution_mode: 'DETERMINISTIC_LOCAL_CRM_RULES';
  readonly provider_called: false;
  readonly model_status_note: '本地 CRM 规则排序，未调用大模型。';
  readonly read_only: true;
  readonly writes_crm: false;
}

export async function executeCustomerPriorityRanking(input: {
  readonly db: Pick<DatabaseLike, 'select'>;
  readonly now: string;
  readonly limit?: number;
}): Promise<CustomerPriorityRankingResult> {
  const rows = await input.db.select<PriorityRow>(`SELECT
    c.id,c.name,c.customer_grade,c.intent_level,c.stage,c.last_contacted_at,c.next_follow_up_at,c.updated_at,
    c.region,c.industry,c.contact_person,c.phone_number,c.email,c.next_action,c.phone_feedback,c.can_schedule_visit,c.deal_amount,
    (SELECT COUNT(*) FROM tasks t WHERE t.customer_id=c.id AND UPPER(COALESCE(t.status,'OPEN')) NOT IN ('DONE','COMPLETED','CANCELLED')) AS open_tasks,
    ((SELECT COUNT(*) FROM follow_up_records f WHERE f.customer_id=c.id) + (SELECT COUNT(*) FROM visit_records v WHERE v.customer_id=c.id)) AS interaction_count
    FROM customers c`);
  const nowMs = Date.parse(input.now);
  const scored = rows.map(row => scoreRow(row, Number.isFinite(nowMs) ? nowMs : Date.now()))
    .sort((a, b) => b.score - a.score || a.customer_name.localeCompare(b.customer_name) || a.customer_id.localeCompare(b.customer_id))
    .slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)))
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return { tool_id: CUSTOMER_PRIORITY_RANKING_TOOL_ID, items: scored, execution_mode: 'DETERMINISTIC_LOCAL_CRM_RULES', provider_called: false, model_status_note: '本地 CRM 规则排序，未调用大模型。', read_only: true, writes_crm: false };
}

function scoreRow(row: PriorityRow, nowMs: number): Omit<CustomerPriorityRankedItem, 'rank'> {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => { score += points; reasons.push(`${reason} (+${points})`); };
  const grade = (row.customer_grade ?? '').toUpperCase();
  const intent = (row.intent_level ?? '').toUpperCase();
  const stage = (row.stage ?? '').toUpperCase();
  const gradePoints: Record<string, number> = { A: 24, B: 16, C: 8, D: 2 };
  if (gradePoints[grade]) add(gradePoints[grade], `客户等级 ${grade}`);
  const intentPoints: Record<string, number> = { HIGH: 24, MEDIUM: 12, LOW: 3 };
  if (intentPoints[intent]) add(intentPoints[intent], `意向 ${intent}`);
  const stagePoints: Record<string, number> = { NEGOTIATION: 22, PROPOSAL: 18, OPPORTUNITY: 16, QUALIFIED: 12, CONTACTED: 7, NEW_LEAD: 3 };
  if (stagePoints[stage]) add(stagePoints[stage], `销售阶段 ${stage}`);

  const lastMs = Date.parse(row.last_contacted_at ?? '');
  if (Number.isFinite(lastMs)) {
    const days = Math.max(0, Math.floor((nowMs - lastMs) / 86_400_000));
    if (days <= 7) add(10, `最近 ${days} 天有互动`);
    else if (days <= 30) add(5, `最近 ${days} 天有互动`);
  }
  const followMs = Date.parse(row.next_follow_up_at ?? '');
  if (Number.isFinite(followMs)) {
    const deltaDays = Math.ceil((followMs - nowMs) / 86_400_000);
    if (deltaDays < 0) add(14, `下次跟进已逾期 ${Math.abs(deltaDays)} 天`);
    else if (deltaDays <= 7) add(9, '下次跟进在本周内');
  }
  const openTasks = Number(row.open_tasks ?? 0);
  if (openTasks > 0) add(Math.min(openTasks * 3, 9), `${openTasks} 个开放任务`);
  const opportunitySignals = [row.phone_feedback && /INTEREST|MEET|POSITIVE/i.test(row.phone_feedback), row.can_schedule_visit === 1, Number(row.deal_amount ?? 0) > 0, Boolean(row.next_action)].filter(Boolean).length;
  if (opportunitySignals) add(opportunitySignals * 4, `${opportunitySignals} 个真实机会信号`);
  const freshMs = Date.parse(row.updated_at ?? '');
  if (Number.isFinite(freshMs) && nowMs - freshMs <= 30 * 86_400_000) add(6, '证据在最近 30 天内更新');
  const complete = [row.region,row.industry,row.contact_person,row.phone_number || row.email,row.next_action].filter(Boolean).length;
  if (complete >= 4) add(6, `数据完整度 ${complete}/5`); else if (complete >= 2) add(3, `数据完整度 ${complete}/5`);
  if (Number(row.interaction_count ?? 0) > 0) reasons.push(`可追溯互动记录 ${Number(row.interaction_count)} 条`);
  return { customer_id: row.id, customer_name: row.name, score, deterministic_reasons: reasons, evidence_references: [`customer:${row.id}`, `tasks:customer:${row.id}`, `timeline:customer:${row.id}`] };
}
