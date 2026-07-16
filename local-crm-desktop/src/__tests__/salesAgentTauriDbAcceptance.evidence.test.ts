/**
 * Writes rich controller-path evidence against the seeded Tauri SQLite file.
 * Invoked by vitest — no separate packaging.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { homedir, tmpdir } from 'node:os';
import { createCrmRepository, type DatabaseLike } from '../lib/db';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { executeSearchCustomersTool } from '../lib/salesAgentTools/executeSearchCustomersTool';
import { formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';
import { buildDailyFocusItems } from '../lib/salesAgentUi/dailyFocus';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';

// Test evidence must never dirty the Git worktree. Rich artifacts are written
// to the operating-system temp area and remain outside the release cohort.
const EVIDENCE = join(tmpdir(), 'local-crm-sales-agent-functional-evidence');
const NOW = '2026-07-14T12:00:00.000Z';

function openProductionDb(): { sqlite: Database.Database; db: DatabaseLike; close: () => void } {
  const dbPath = join(homedir(), 'AppData', 'Roaming', 'com.localcrm.desktop', 'personal-crm.db');
  // This acceptance gate may inspect the installed user's database, but it is
  // structurally read-only so a test can never mutate production CRM data.
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  const db: DatabaseLike = {
    async execute(sql, bindings: unknown[] = []) {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: result.changes };
    },
    async select<T>(sql, bindings: unknown[] = []) {
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
  };
  return { sqlite, db, close: () => sqlite.close() };
}

function sessionFor(customerId: string, name: string) {
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: `prod-${customerId}`,
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [{ id: customerId, name, customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: customerId, label: name, synthetic: false, persisted: true } }],
    tasks: [], work_items: [], collected_leads: [], replay_evidence: [], import_rows: [], capture_events: [], prompt_plans: [], model_invocations: [], eval_summaries: [],
  };
  const context = buildContextSnapshot({
    snapshotId: `prod-${customerId}`,
    capturedAt: NOW,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
    customers: [{ customerId, name, grade: 'A', intentLevel: 'HIGH', observedAt: NOW, evidenceIds: [customerId] }],
    accounts: [],
    interactions: [{ interactionId: `ix-${customerId}`, customerId, summary: '最近一次跟进', occurredAt: '2026-07-10T00:00:00.000Z', evidenceIds: [`ix-${customerId}`] }],
  });
  const memory = buildCustomerMemoryContext({
    customer_id: customerId,
    items: [{
      memory_id: `mem-${customerId}`, customer_id: customerId, kind: 'fact', summary: 'ACTIVE 偏好交付周期',
      source_kind: 'human_decision', validation_source: 'human_decision', source_reference: 'review:1',
      evidence_reference: customerId, source_timestamp: '2026-07-09T00:00:00.000Z', recorded_at: '2026-07-09T00:00:00.000Z',
    }],
  });
  return new SalesAgentSession(customerId, null, () => NOW, {
    snapshot, context, memory, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
  });
}

describe('Sales Agent Tauri-DB acceptance evidence', () => {
  it('runs controller scenarios against seeded personal-crm.db and writes HTML screenshots source', async () => {
    mkdirSync(EVIDENCE, { recursive: true });
    const { db, sqlite, close } = openProductionDb();
    try {
      const repo = createCrmRepository(db);
      expect(typeof repo.searchCustomers).toBe('function');

      let active = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
      const controller = new SalesAgentInteractionController({
        db,
        createSession: () => active,
        clock: () => NOW,
      });

      const search = await executeSearchCustomersTool({
        filters: { region: '东莞', customer_grade: 'A', now: NOW },
        db,
      });
      expect(search.candidates.every(c => c.region?.includes('东莞') && c.customer_grade === 'A')).toBe(true);
      expect(search.candidates.some(c => c.region?.includes('广州'))).toBe(false);

      const multi = await controller.submit('找一下华南生物');
      expect(multi.state.candidate_results.length).toBeGreaterThan(1);

      const pick = await controller.selectCandidate(multi.state.candidate_results[0]!.id);
      expect(pick.event.type).toBe('bind_required');
      if (pick.event.type === 'bind_required') {
        active = sessionFor(pick.event.customer_id, pick.event.customer_name);
        const continued = await controller.continueAfterBind(pick.event.continue_prompt, pick.event.customer_id);
        expect(continued.outcome?.kind).toBe('reasoning_result');
      }

      controller.syncExternalScope('dg-a-jm', '东莞 JM 新能源科技有限公司');
      active = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
      const summary = await controller.submit('总结客户现状');
      expect(summary.outcome?.kind).toBe('reasoning_result');
      if (summary.outcome?.kind === 'reasoning_result') {
        expect(summary.outcome.result.structured.customer_understanding).toBeTruthy();
        expect(summary.outcome.result.response).not.toContain('[object Object]');
      }

      const blocked = formatUserFacingErrorMessage({ nested: { x: 1 }, Authorization: 'Bearer sk-secret' });
      expect(blocked).not.toBe('[object Object]');
      expect(blocked).not.toMatch(/sk-secret|Bearer/i);

      const customers = sqlite.prepare('SELECT id,name,region,industry,stage,customer_grade,intent_level,last_contacted_at,next_follow_up_at,updated_at FROM customers').all() as Array<Record<string, string>>;
      const daily = buildDailyFocusItems(customers, NOW);

      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>Tauri DB Controller Evidence</title>
<style>
body{margin:0;font-family:"Segoe UI","PingFang SC",sans-serif;background:linear-gradient(160deg,#101820,#1b2838);color:#eef3f8}
.wrap{max-width:920px;margin:0 auto;padding:28px}
.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px;margin:14px 0}
.ok{color:#7dffa8}.muted{opacity:.75}
.candidate{display:inline-block;background:#243247;border-radius:10px;padding:10px 12px;margin:6px 6px 0 0;min-width:200px}
h1{font-size:26px;margin:0 0 6px} h2{font-size:18px;margin:0 0 8px}
pre{white-space:pre-wrap;background:#0d141c;padding:12px;border-radius:8px}
</style></head><body><div class="wrap">
<h1>Sales Agent — 真实 SQLite 控制器验收</h1>
<p class="muted">personal-crm.db · search_customers · SalesAgentInteractionController · Mock Runtime</p>
<div class="card" id="sA"><h2>A · 东莞 A 类</h2><p class="ok">PASS · ${search.candidates.length} 条</p>
${search.candidates.map(c => `<div class="candidate"><strong>${c.name}</strong><br/>${c.region} · ${c.customer_grade}类 · ${c.stage}</div>`).join('')}</div>
<div class="card" id="sB"><h2>B · 多候选</h2><p class="ok">PASS · ${multi.state.candidate_results.length} 张候选卡</p>
${multi.state.candidate_results.map(c => `<div class="candidate"><strong>${c.name}</strong><br/>${c.region} · ${c.industry}</div>`).join('')}</div>
<div class="card" id="sC"><h2>C/E · 选择后继续 + 结构化结果</h2>
<pre>${summary.state.agent_message ?? ''}</pre>
<p class="ok">无 [object Object] · 工具 ${summary.state.latest_result?.tool_trace.length ?? 0} · 证据 ${summary.state.latest_result?.evidence_refs.length ?? 0}</p></div>
<div class="card" id="sF"><h2>F · 错误格式化</h2><p>${blocked}</p><p class="ok">可读中文，无原始对象串</p></div>
<div class="card" id="sG"><h2>G · 今日值得关注</h2>
${daily.map((item, i) => `<div class="candidate"><strong>${i + 1}. ${item.customer_name}</strong><br/>${item.why}<br/><span class="muted">${item.evidence.map(e => e.label + ':' + e.detail).join('；')}</span></div>`).join('')}
</div>
</div></body></html>`;
      writeFileSync(join(EVIDENCE, 'controller-acceptance.html'), html, 'utf8');
      writeFileSync(join(EVIDENCE, 'controller-acceptance.json'), JSON.stringify({
        search_candidates: search.candidates,
        multi_candidates: multi.state.candidate_results,
        summary_structured: summary.state.latest_result?.structured,
        daily,
        blocked_message: blocked,
      }, null, 2), 'utf8');
    } finally {
      close();
    }
  });
});
