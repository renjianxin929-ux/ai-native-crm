/**
 * Agent C — 广州电秀科技 / TINSOL 黄金样本硬门。
 * 黄金样本 = Reviewer 证据目录附录 A 真实原文（字节原样，c75e31d0…）。
 * 旧重建样本已降级为 RECONSTRUCTED_TINSOL_LEGACY（SYNTHETIC），不作为真实验收依据。
 */
import { describe, expect, it } from 'vitest';

import { parseIntelligenceMaterial } from '../lib/battleCard/parser';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { confirmIntelligenceImport, previewIntelligenceImport } from '../lib/battleCard/importService';
import { createStageCardEngine, parsePayload } from '../lib/battleCard/stageCardEngine';
import { CLOCK, createSchema, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

async function setupConfirmed() {
  const db = createSqliteDb();
  await createSchema(db);
  await seedCustomer(db);
  const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
  const result = await confirmIntelligenceImport(preview, {
    customer_id: 'cust-tinsol',
    keep_fact_ids: preview.draft.extracted_facts.map(fact => fact.fact_id),
    keep_hypothesis_ids: preview.draft.extracted_hypotheses.map(hypothesis => hypothesis.hypothesis_id),
  }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol',  });
  return { db, preview, result };
}

describe('黄金样本：真实附录 A（复合业务属性可同时成立，不判定冲突）', () => {
  it('0) 黑盒：公司名从第一行提取，且不是章节标题', async () => {
    const { preview } = await setupConfirmed();
    expect(preview.draft.candidate_customer?.name).toBe('广州电秀科技发展有限公司');
    expect(preview.draft.candidate_customer?.name).not.toContain('主体与公开事实');
    expect(preview.draft.candidate_customer?.name).not.toContain('战前卡');
  });

  it('1) 功效/内容/版本/电压插头/认证/包装/售后/VOC 复合属性在原文中共存，不判冲突', async () => {
    const { preview } = await setupConfirmed();
    // 全文复合检测：功效、内容、认证、国家版本、VOC 等同时出现
    expect(preview.draft.parse_warnings.some(warning => warning.includes('不判定为行业冲突'))).toBe(true);
    // 不出现硬冲突判定
    expect(preview.draft.parse_warnings.some(warning => /行业冲突|属性冲突/.test(warning) && !warning.includes('不判定为行业冲突'))).toBe(false);
  });

  it('2) 配方/成分在缺少产品线依据时不进入已核公开 Fact，且保留条件适用信息', async () => {
    const { preview } = await setupConfirmed();
    // 配方出现在业务主链路/场景/门禁，不是公开事实
    expect(preview.draft.extracted_facts.some(fact => /配方|成分/.test(fact.statement))).toBe(false);
    // 条件适用信息保留
    expect(preview.draft.conditional_applicability_items.some(item => /配方|成分/.test(item))).toBe(true);
  });

  it('3) 已核事实/证据进入候选事实：80+ 国家 / 7000万销售额 / 多平台多国家复杂度', async () => {
    const { db, result } = await setupConfirmed();
    const repos = createBattleCardRepositories(db, CLOCK);
    const facts = await repos.facts.listByCustomer('cust-tinsol');
    const statements = facts.map(fact => fact.statement).join('\n');
    expect(statements).toContain('80多个国家和地区');
    expect(statements).toContain('7000万');
    expect(statements).toContain('多平台、多国家');
    expect(facts.every(fact => fact.source_import_id === result.import_id)).toBe(true);
  });

  it('4) H1-H4 进入假设（双行格式），不得进入事实', async () => {
    const { db } = await setupConfirmed();
    const repos = createBattleCardRepositories(db, CLOCK);
    const hypotheses = await repos.hypotheses.listByCustomer('cust-tinsol');
    expect(hypotheses.filter(hypothesis => hypothesis.status === 'PENDING').length).toBeGreaterThanOrEqual(4);
    const facts = await repos.facts.listByCustomer('cust-tinsol');
    expect(facts.every(fact => !/^H\d/.test(fact.statement))).toBe(true);
    expect(facts.some(fact => fact.statement.includes('聊天信息淹没'))).toBe(false);
  });

  it('5) 4B 原始飞书话术 400 字符逐字保留（含内部空行/引号）', async () => {
    const { preview } = await setupConfirmed();
    const original = preview.draft.feishu_talk_track.value_statement.original;
    expect(original.length).toBe(400);
    expect(original).toContain('“根据我目前看到的公开信息');
    expect(original).toContain('能很快判断飞书到底有没有价值。”');
    expect(original).toContain('\n\n'); // 内部空行保留
    expect(preview.draft.feishu_talk_track.value_statement.current).toBe(original);
  });

  it('6) 4C 六层实现路径 → solution scenarios（层名 + 验收指标）', async () => {
    const { preview } = await setupConfirmed();
    const layers = preview.draft.solution_scenarios.filter(scenario => scenario.source_section === 'implementation');
    expect(layers.length).toBeGreaterThanOrEqual(6);
    const layerNames = layers.map(layer => layer.scenario_name).join('|');
    expect(layerNames).toContain('业务对象层');
    expect(layerNames).toContain('流程层');
    expect(layerNames).toContain('数据层');
    expect(layerNames).toContain('自动化层');
    expect(layerNames).toContain('AI层');
    expect(layerNames).toContain('权限与验收');
    // 4 章场景也在
    expect(preview.draft.solution_scenarios.some(scenario => scenario.source_section === 'landing_points')).toBe(true);
  });

  it('7) SUPRENT / 触沃电子 / FF FlashFish 进入 peer references，继承 group context', async () => {
    const { preview } = await setupConfirmed();
    const names = preview.draft.peer_references.map(peer => peer.company_name);
    expect(names).toEqual(expect.arrayContaining(['SUPRENT', '触沃电子', 'FF FlashFish']));
    for (const peer of preview.draft.peer_references) {
      expect(peer.why_comparable).toContain('参照型号');
      expect(peer.non_transferable_boundary).toContain('不宣称其使用飞书');
    }
  });

  it('8) 事实/假设/同行/话术均可溯源到原始导入', async () => {
    const { db, preview, result } = await setupConfirmed();
    const repos = createBattleCardRepositories(db, CLOCK);
    const facts = await repos.facts.listByCustomer('cust-tinsol');
    expect(facts.every(fact => fact.source_import_id === result.import_id)).toBe(true);
    const hypotheses = await repos.hypotheses.listByCustomer('cust-tinsol');
    expect(hypotheses.every(hypothesis => hypothesis.source_import_id === result.import_id)).toBe(true);
    expect(preview.draft.peer_references.every(peer => peer.source_refs[0]?.import_ref?.startsWith('同行校准:'))).toBe(true);
    const importRow = await repos.imports.get(result.import_id);
    expect(importRow?.raw_content).toBe(GOLDEN_SAMPLE_TINSOL);
  });

  it('9) 美妆属性（功效/配方）与硬件属性（认证/版本/售后）不做非此即彼分类', async () => {
    const { preview } = await setupConfirmed();
    // 复合业务全文成立；配方作为条件适用项保留（不删除、不硬分类）
    expect(preview.draft.conditional_applicability_items.some(item => /配方|成分/.test(item))).toBe(true);
    expect(preview.draft.parse_warnings.some(warning => warning.includes('功效') && warning.includes('剔除'))).toBe(false);
  });
});

describe('黄金样本：作战卡端到端', () => {
  it('生成完整作战卡：双卡 + 关键假设 + 话术 + 同行 + POC', async () => {
    const { db } = await setupConfirmed();
    const engine = createStageCardEngine({ db, clock: CLOCK });
    const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    const payload = parsePayload(card.payload_json);

    expect(payload.action_card.key_hypotheses.filter(h => h.hypothesis_id !== 'insufficient').length).toBeGreaterThanOrEqual(3);
    expect(payload.solution_reference_card.peer_references).toHaveLength(3);
    expect(payload.solution_reference_card.poc_path.length).toBe(1);
    expect(payload.solution_reference_card.feishu_value_statement.original.length).toBe(400);
    expect(payload.action_card.current_situation).toContain('广州电秀');
    expect(payload.action_card.stage_goal).toContain('首次触达');
  });

  it('三个关键假设在卡片上完整呈现', async () => {
    const { db } = await setupConfirmed();
    const engine = createStageCardEngine({ db, clock: CLOCK });
    const card = await engine.generateStageCardDraft('cust-tinsol', 'NEW_LEAD');
    const payload = parsePayload(card.payload_json);
    const key = payload.action_card.key_hypotheses.filter(h => h.hypothesis_id !== 'insufficient');
    expect(key.length).toBeGreaterThanOrEqual(3);
    expect(key[0]?.statement).toContain('新品横跨品牌、产品、工厂');
    expect(key[1]?.statement).toContain('成分、标签、功效宣称');
  });
});
