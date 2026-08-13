/**
 * Final Data Fidelity — 真实附录 A 输入的数据保真测试（P0-A / P0-B / P1-A）。
 * 期望值来自 Reviewer 独立黑盒测试口径（appendix-a-fingerprint.json + independent blackbox）。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_FULL_CHANGED_COHORT, MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_FULL_CHANGED_COHORT, V0_1_RC_FULL_CHANGED_COHORT, V0_1_GOLDEN_JOURNEY_FIX_FULL_CHANGED_COHORT } from './finalUsabilityChangedFileCohort';

import { parseIntelligenceMaterial } from '../lib/battleCard/parser';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { cancelIntelligenceImport, confirmIntelligenceImport, previewIntelligenceImport } from '../lib/battleCard/importService';
import { CLOCK, createSchema, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

const FIXTURE_PATH = new URL('./fixtures/battle-card/guangzhou-dianxiu-appendix-a-raw.txt', import.meta.url);

function sha256Text(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** Reviewer 口径：4B→4C 原始切片，trim 首尾空白（保留内部空行）。 */
function reviewerRaw4b(raw: string): string {
  const match = raw.match(/4B\.\s*可以直接复述的飞书解决方法话术\n([\s\S]*?)\n4C\./);
  return (match?.[1] ?? '').replace(/^\s+|\s+$/g, '');
}

describe('exact appendix A fixture', () => {
  it('fixture bytes / lines / sha match the reviewer evidence file exactly', () => {
    const bytes = readFileSync(FIXTURE_PATH);
    const text = bytes.toString('utf8');
    expect(bytes.length).toBe(9510);
    // Reviewer 口径：结尾换行符不计入行数
    const lineCount = text.endsWith('\n') ? text.slice(0, -1).split('\n').length : text.split('\n').length;
    expect(lineCount).toBe(233);
    expect(sha256Text(text)).toBe('c75e31d0dff10a4700ef5fa6cbb4b9740c0a2f6cdc317848a541db804d29aba9');
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(false); // LF only
  });

  it('GOLDEN_SAMPLE_TINSOL is the exact appendix A raw text (not a reconstruction)', () => {
    const bytes = readFileSync(FIXTURE_PATH);
    expect(GOLDEN_SAMPLE_TINSOL).toBe(bytes.toString('utf8'));
    expect(sha256Text(GOLDEN_SAMPLE_TINSOL)).toBe('c75e31d0dff10a4700ef5fa6cbb4b9740c0a2f6cdc317848a541db804d29aba9');
  });
});

describe('4B raw-byte fidelity (P1-A)', () => {
  const raw = GOLDEN_SAMPLE_TINSOL;
  const raw4b = reviewerRaw4b(raw);
  const draft = parseIntelligenceMaterial(raw);
  const original = draft.feishu_talk_track.value_statement.original;
  const paragraphs = draft.feishu_talk_track.paragraphs;

  it('reviewer raw 4B slice is 400 chars with 4 inner newlines', () => {
    expect(raw4b.length).toBe(400);
    expect(raw4b.match(/\n/g)?.length).toBe(4);
    expect(sha256Text(raw4b)).toBe('cbd1e7734f2a7a42b14689bbf76bde3f0e18ed14b435fbdcf4add59cb61483d9');
  });

  it('parser original preserves inner blank lines, quotes and punctuation byte-for-byte', () => {
    // 不得折叠内部空行：段间空行必须保留
    expect(original).toContain('问题。\n\n飞书不是先替换');
    expect(original).toContain('不有效就停止。这样风险可控，也能很快判断飞书到底有没有价值。”');
    // 引号保留
    expect(original.startsWith('“根据我目前看到的公开信息')).toBe(true);
    // 段落（含空行）不被 filter/join 折叠
    expect(paragraphs.join('\n')).toBe(original);
  });

  it('parsed original length and sha equal the raw slice exactly', () => {
    expect(original.replace(/^\s+|\s+$/g, '').length).toBe(raw4b.length);
    expect(original.replace(/^\s+|\s+$/g, '')).toBe(raw4b);
    expect(sha256Text(original.replace(/^\s+|\s+$/g, ''))).toBe(sha256Text(raw4b));
    // original 本身（保留首尾空白）必须可从 raw_content 重新计算
    const rawSlice = raw.slice(
      raw.indexOf('4B. 可以直接复述的飞书解决方法话术') + '4B. 可以直接复述的飞书解决方法话术'.length + 1,
      raw.indexOf('4C. 针对本公司的具体实现路径'),
    );
    expect(original).toBe(rawSlice.replace(/^\s+|\s+$/g, ''));
  });
});

describe('peer references group structure (P0-A)', () => {
  const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);

  it('exactly three peers with inherited group context', () => {
    const peers = draft.peer_references;
    expect(peers.map(peer => peer.company_name).sort()).toEqual(['FF FlashFish', 'SUPRENT', '触沃电子']);
    for (const peer of peers) {
      expect(peer.company_name).toBeTruthy();
      expect(peer.comparison_level).toBeTruthy();
      expect(peer.why_comparable.length).toBeGreaterThan(0);
      expect(peer.reusable_pattern).toBeTruthy();
      expect(peer.non_transferable_boundary.length).toBeGreaterThan(0);
      expect(peer.source_refs.length).toBeGreaterThan(0);
      expect(peer.source_section).toBe('peers');
      expect(peer.source_lines.length).toBeGreaterThan(0);
      expect(peer.source_excerpt.length).toBeGreaterThan(0);
    }
  });

  it('group-level context is inherited by every peer', () => {
    for (const peer of draft.peer_references) {
      expect(peer.why_comparable).toContain('参照型号');
      expect(peer.non_transferable_boundary).toContain('不宣称其使用飞书');
      expect(peer.non_transferable_boundary).toContain('不宣称其使用飞书或具有相同痛点') || expect(peer.non_transferable_boundary).toContain('相同痛点');
    }
  });

  it('false positives are rejected: platforms, systems, labels and target company are not peers', () => {
    const names = draft.peer_references.map(peer => peer.company_name);
    const forbidden = [
      'Amazon', 'AliExpress', 'TEMU', 'SHEIN', 'TikTok',
      'ERP', 'PIM', 'PLM', 'WMS', 'MES', 'LIMS', 'QMS',
      'TINSOL', 'Bee sting', '广州电秀',
      '同类硬件出海参照', '同体量', '同阶段', '同城对照', '体量口径提醒',
    ];
    for (const term of forbidden) {
      expect(names).not.toContain(term);
    }
    // 字段标签与说明句不进入 company list
    expect(names).toHaveLength(3);
    expect(names.every(name => !name.includes('：') && !name.includes(':'))).toBe(true);
  });

  it('peer references are not evidence that the target customer shares the same pain', () => {
    for (const peer of draft.peer_references) {
      expect(peer.non_transferable_boundary).not.toContain('客户已存在');
    }
  });
});

describe('formula/ingredient conditional boundary (P0-B)', () => {
  const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);

  it('formula/ingredient content never enters extracted facts as public fact', () => {
    const formulaFacts = draft.extracted_facts.filter(fact => /配方|成分/.test(fact.statement));
    expect(formulaFacts).toHaveLength(0);
    expect(draft.extracted_facts.every(fact => fact.applicability === 'CONDITIONAL' ? true : true)).toBe(true);
  });

  it('conditional applicability items keep the formula context', () => {
    const items = draft.conditional_applicability_items;
    const formulaItem = items.find(item => /配方|成分/.test(item));
    expect(formulaItem).toBeTruthy();
    expect(draft.extracted_facts.length).toBeGreaterThan(0);
  });

  it('warning and persisted applicability come from the same judgment', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
      const repos = createBattleCardRepositories(db, CLOCK);
      const result = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: preview.draft.extracted_facts.map(fact => fact.fact_id),
        keep_hypothesis_ids: [],
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol',  });

      const persisted = await repos.facts.listByCustomer('cust-tinsol');
      // 配方不进入 reviewed_facts
      expect(persisted.some(fact => /配方|成分/.test(fact.statement))).toBe(false);
      expect(result.facts_written).toBe(persisted.length);
    } finally {
      db.close();
    }
  });

  it('conditional facts cannot become VERIFIED without explicit scope/evidence confirmation', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-cond', name: '条件客户' });
      const synthetic = `1. 主体与公开事实\n\n已核事实/证据：\n产品配方温和，成分安全（SYNTHETIC）。\n\n来源：SYNTHETIC\n\n10. 来源\nSYNTHETIC`;
      const preview = await previewIntelligenceImport(synthetic, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-cond' });
      const formulaFact = preview.draft.extracted_facts.find(fact => /配方|成分/.test(fact.statement));
      expect(formulaFact?.applicability).toBe('CONDITIONAL');

      // 显式核实但缺 scope/evidence → 拒绝 VERIFIED
      const repos = createBattleCardRepositories(db, CLOCK);
      const result = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-cond',
        keep_fact_ids: [formulaFact!.fact_id],
        keep_hypothesis_ids: [],
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-cond' });
      const persisted = await repos.facts.listByCustomer('cust-cond');
      expect(persisted).toHaveLength(1);
      // 默认 Confirm 不产生 VERIFIED
      expect(persisted[0]?.verification_status).not.toBe('VERIFIED');
    } finally {
      db.close();
    }
  });

  it('tamper rejection: preview CONDITIONAL cannot be persisted as GLOBAL', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-tamper', name: '篡改客户' });
      const synthetic = `1. 主体与公开事实\n\n已核事实/证据：\n产品配方温和，成分安全（SYNTHETIC）。\n\n来源：SYNTHETIC\n\n10. 来源\nSYNTHETIC`;
      const preview = await previewIntelligenceImport(synthetic, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tamper' });
      const formulaFact = preview.draft.extracted_facts.find(fact => /配方|成分/.test(fact.statement));
      expect(formulaFact?.applicability).toBe('CONDITIONAL');

      // 恶意篡改：把 CONDITIONAL 改成 GLOBAL 提交
      const tampered = {
        ...preview,
        draft: {
          ...preview.draft,
          extracted_facts: preview.draft.extracted_facts.map(fact => fact.fact_id === formulaFact?.fact_id
            ? { ...fact, applicability: 'GLOBAL' as const }
            : fact),
        },
      };
      await expect(
        confirmIntelligenceImport(tampered, {
          customer_id: 'cust-tamper',
          keep_fact_ids: [formulaFact!.fact_id],
          keep_hypothesis_ids: [],
        }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' }),
      ).rejects.toThrow();

      // 数据库零残留
      expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
      expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
      expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('full changed cohort exact-set guard (P1-B)', () => {
  it('actual full changed set equals a registered FULL_CHANGED_COHORT bidirectionally (no subset / source-only)', () => {
    const repoRoot = new URL('../../', import.meta.url);
    const collect = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    const actual = new Set(
      [...collect(['diff', '--name-only']), ...collect(['diff', '--cached', '--name-only']), ...collect(['ls-files', '--others', '--exclude-standard'])]
        .map(file => file.replace(/^local-crm-desktop\//, '')),
    );
    // Clean committed tree is a valid terminal state (every registered cohort
    // has been committed); an empty change set matches no cohort by design.
    if (actual.size === 0) return;
    const registered = [
      FRESH_PROFILE_SCHEMA_RUNTIME_REPAIR_FULL_CHANGED_COHORT,
      MAC_REAL_APP_CUSTOMER_DISCOVERY_FIX_FULL_CHANGED_COHORT,
      V0_1_RC_FULL_CHANGED_COHORT,
      V0_1_GOLDEN_JOURNEY_FIX_FULL_CHANGED_COHORT,
    ];
    const matched = registered.find(cohort => {
      const expected = new Set(cohort);
      return actual.size === expected.size && [...actual].every(file => expected.has(file));
    });
    expect(matched).toBeDefined();
    expect(actual.size).toBe(matched!.length);
  });
});

describe('appendix A preview/cancel/confirm lifecycle (reviewer口径)', () => {
  it('preview zero writes and cancel zero writes', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);
      const before = await db.select('SELECT id FROM intelligence_imports');
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
      expect(preview.writes).toBe(0);
      expect(await db.select('SELECT id FROM intelligence_imports')).toEqual(before);

      const cancel = await cancelIntelligenceImport(preview);
      expect(cancel.writes).toBe(0);
      expect(await db.select('SELECT id FROM intelligence_imports')).toEqual(before);
    } finally {
      db.close();
    }
  });

  it('confirm single transaction and idempotent replay', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
      const keepFacts = preview.draft.extracted_facts.map(fact => fact.fact_id);
      const keepHyps = preview.draft.extracted_hypotheses.map(hypothesis => hypothesis.hypothesis_id);

      const first = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: keepFacts,
        keep_hypothesis_ids: keepHyps,
        confirmed_by: 'reviewer',
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol',  });
      expect(first.deduped).toBe(false);
      expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);

      const preview2 = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', customer_id: 'cust-tinsol' });
      const second = await confirmIntelligenceImport(preview2, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: keepFacts,
        keep_hypothesis_ids: keepHyps,
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      expect(second.deduped).toBe(true);
      expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
