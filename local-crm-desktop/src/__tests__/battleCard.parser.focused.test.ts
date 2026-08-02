/**
 * Agent B — 战前材料解析 focused tests（测试矩阵 A）。
 * 真实编号格式（附录 A）章节映射 / 事实假设分离 / 话术保真 / 同行 group / 来源映射 / 条件适用性 / 复合业务 / 确定性降级。
 */
import { describe, expect, it } from 'vitest';

import { parseIntelligenceMaterial, detectCompositeBusiness, determineApplicability, isFormulaConditional, INTELLIGENCE_SECTIONS, isPeerFalsePositive } from '../lib/battleCard/parser';
import { BATTLE_CARD_PARSER_VERSION } from '../lib/battleCard/schema';
import {
  GOLDEN_SAMPLE_TINSOL,
  RECONSTRUCTED_TINSOL_LEGACY,
  SYNTHETIC_COMPOSITE_TERMS,
  SYNTHETIC_EMPTY,
  SYNTHETIC_FORMULA_NO_PRODUCT_LINE,
  SYNTHETIC_NO_TITLES,
  SYNTHETIC_NUMBERED_VARIANTS,
  SYNTHETIC_PEERS_NO_BOUNDARY,
  SYNTHETIC_UNKNOWN_TITLES,
} from './battleCard.fixtures';

describe('section title mapping (real numbered format)', () => {
  it('maps numbered section titles 1-10 and 4A-4D without markdown headers', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const mapped = draft.source_mapping.map(entry => entry.section).sort();
    expect(mapped).toContain('company');
    expect(mapped).toContain('profile');
    expect(mapped).toContain('problem_hypotheses');
    expect(mapped).toContain('landing_points');
    expect(mapped).toContain('why_validate'); // 4A
    expect(mapped).toContain('feishu_talk'); // 4B
    expect(mapped).toContain('implementation'); // 4C
    expect(mapped).toContain('peers'); // 4D
    expect(mapped).toContain('first_questions');
    expect(mapped).toContain('human_gates');
    expect(mapped).toContain('poc');
    expect(mapped).toContain('adversarial');
    expect(mapped).toContain('recommendation');
    expect(mapped).toContain('sources');
    // 无未识别标题警告
    expect(draft.parse_warnings.some(warning => warning.includes('未识别的章节标题'))).toBe(false);
  });

  it('reports unknown titles as parse warnings without losing content', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_UNKNOWN_TITLES);
    expect(draft.parse_warnings.some(warning => warning.includes('未识别的章节标题'))).toBe(true);
  });

  it('handles title-less material deterministically', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_NO_TITLES);
    expect(draft.extracted_facts.length).toBeGreaterThan(0);
    expect(draft.reasoning.mode).toBe('DETERMINISTIC');
  });
});

describe('company extraction', () => {
  it('extracts the company from the first line and never from section titles', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    expect(draft.candidate_customer?.name).toBe('广州电秀科技发展有限公司');
    expect(draft.candidate_customer?.name).not.toContain('主体与公开事实');
    expect(draft.candidate_customer?.name).not.toContain('战前卡');
  });

  it('supports chinese-numeral and full-width punctuated variants', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_NUMBERED_VARIANTS);
    expect(draft.candidate_customer?.name).toBe('样本科技有限公司');
    const mapped = draft.source_mapping.map(entry => entry.section).sort();
    expect(mapped).toContain('company'); // 一、
    expect(mapped).toContain('profile'); // 二、
    expect(mapped).toContain('problem_hypotheses'); // 三、
    expect(mapped).toContain('feishu_talk'); // ４．
    expect(mapped).toContain('sources'); // ５．
    expect(draft.extracted_hypotheses).toHaveLength(1);
    expect(draft.feishu_talk_track.value_statement.original).toContain('话术内容一');
  });
});

describe('facts vs hypotheses separation', () => {
  it('H1-H4 enter hypotheses (double-line format), never facts', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const hypothesisStatements = draft.extracted_hypotheses.map(hypothesis => hypothesis.statement);
    expect(hypothesisStatements.length).toBeGreaterThanOrEqual(4);
    expect(hypothesisStatements[0]).toContain('新品横跨品牌、产品、工厂');
    expect(hypothesisStatements[1]).toContain('成分、标签、功效宣称');

    const factStatements = draft.extracted_facts.map(fact => fact.statement).join('\n');
    expect(factStatements).not.toContain('新品横跨品牌');
    expect(draft.extracted_facts.every(fact => !/^H\d/.test(fact.statement))).toBe(true);
  });

  it('only verified-evidence entries from section 1 become fact candidates', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const statements = draft.extracted_facts.map(fact => fact.statement).join('\n');
    // 已核事实/证据进入
    expect(statements).toContain('80多个国家和地区');
    expect(statements).toContain('7000万');
    // 画像/推演/假设/场景/路径/门禁/POC/同行/对抗 不生成 Fact
    for (const forbidden of ['业务主链路', '配方/包材', '场景1', '业务对象层', '人工确认门禁', '两周POC', '对抗式审查', 'SUPRENT']) {
      expect(statements).not.toContain(forbidden);
    }
  });

  it('hypotheses carry validation questions from the first-meeting questions section', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    expect(draft.validation_questions.length).toBeGreaterThanOrEqual(4);
    expect(draft.validation_questions[0]).toContain('一个新品到海外上市要多久');
    expect(draft.extracted_hypotheses[0]?.validation_question).toContain('一个新品到海外上市要多久');
  });

  it('warns when a hypothesis lacks a validation question', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_COMPOSITE_TERMS);
    expect(draft.extracted_hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(draft.parse_warnings.some(warning => warning.includes('缺少对应验证问题'))).toBe(true);
  });
});

describe('feishu talk track preservation', () => {
  it('preserves the complete talk track verbatim (400 chars, inner blank lines, quotes)', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const original = draft.feishu_talk_track.value_statement.original;
    expect(original.length).toBe(400);
    expect(original).toContain('“根据我目前看到的公开信息');
    expect(original).toContain('能很快判断飞书到底有没有价值。”');
    expect(original).toContain('\n\n');
    expect(draft.feishu_talk_track.value_statement.original).toBe(original);
    expect(draft.feishu_talk_track.value_statement.current).toBe(original);
    expect(draft.feishu_talk_track.paragraphs.join('\n')).toBe(original);
    expect(draft.feishu_talk_track.value_statement.version_history).toHaveLength(0);
  });

  it('warns when talk section is missing', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_FORMULA_NO_PRODUCT_LINE);
    expect(draft.parse_warnings.some(warning => warning.includes('飞书话术'))).toBe(true);
  });
});

describe('peer references group structure', () => {
  it('keeps exactly three peers with inherited group context', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const names = draft.peer_references.map(peer => peer.company_name);
    expect(names.sort()).toEqual(['FF FlashFish', 'SUPRENT', '触沃电子']);
    for (const peer of draft.peer_references) {
      expect(peer.why_comparable).toContain('参照型号');
      expect(peer.non_transferable_boundary).toContain('不宣称其使用飞书');
      expect(peer.comparison_level).toBe('SAME_INDUSTRY');
      expect(peer.source_section).toBe('peers');
      expect(peer.source_lines.length).toBeGreaterThan(0);
      expect(peer.source_excerpt.length).toBeGreaterThan(0);
    }
  });

  it('rejects false positives: platforms, systems, labels are not peers', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const names = draft.peer_references.map(peer => peer.company_name);
    for (const term of ['Amazon', 'TEMU', 'SHEIN', 'TikTok', 'ERP', 'PIM', 'PLM', 'WMS', 'TINSOL', 'Bee sting', '同类硬件出海参照', '同体量', '同阶段', '同城对照']) {
      expect(names).not.toContain(term);
    }
    expect(names).toHaveLength(3);
  });

  it('peer false-positive guard covers labels and systems', () => {
    expect(isPeerFalsePositive('同类硬件出海参照')).toBe(true);
    expect(isPeerFalsePositive('ERP')).toBe(true);
    expect(isPeerFalsePositive('Amazon')).toBe(true);
    expect(isPeerFalsePositive('TINSOL')).toBe(true);
    expect(isPeerFalsePositive('SUPRENT')).toBe(false);
    expect(isPeerFalsePositive('触沃电子')).toBe(false);
    expect(isPeerFalsePositive('FF FlashFish')).toBe(false);
  });

  it('warns when a peer section is empty of companies', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_PEERS_NO_BOUNDARY);
    expect(draft.peer_references.length).toBeLessThanOrEqual(1);
  });
});

describe('source mapping', () => {
  it('records line ranges per section', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    const company = draft.source_mapping.find(entry => entry.section === 'company');
    expect(company?.item_count).toBeGreaterThan(0);
    expect(company?.matched_title).toBe('主体与公开事实');
  });

  it('warns when sources section is missing', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_NO_TITLES);
    expect(draft.parse_warnings.some(warning => warning.includes('来源'))).toBe(true);
  });
});

describe('composite business and conditional applicability', () => {
  it('does not flag composite personal-care appliances as an industry conflict', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    expect(detectCompositeBusiness(GOLDEN_SAMPLE_TINSOL)).toBe(true);
    expect(draft.parse_warnings.some(warning => warning.includes('不判定为行业冲突'))).toBe(true);
  });

  it('marks formula/ingredient claims CONDITIONAL without product-line basis', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_FORMULA_NO_PRODUCT_LINE);
    expect(draft.parse_warnings.some(warning => warning.includes('CONDITIONAL'))).toBe(true);
    expect(isFormulaConditional('产品配方温和')).toBe(true);
    expect(isFormulaConditional('美容仪型号 A 的配方')).toBe(false); // 有型号依据
  });

  it('formula content in business chain / scenarios / gates never becomes facts', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    expect(draft.extracted_facts.some(fact => /配方|成分/.test(fact.statement))).toBe(false);
    // 条件适用信息保留
    expect(draft.conditional_applicability_items.some(item => /配方|成分/.test(item))).toBe(true);
  });

  it('classifies applicability deterministically', () => {
    expect(determineApplicability('品牌出海，覆盖多国家和多平台', false)).toBe('GLOBAL');
    expect(determineApplicability('电气认证按国家版本差异', false)).toBe('PARTIAL');
    expect(determineApplicability('产品配方温和，成分安全', false)).toBe('CONDITIONAL');
    expect(determineApplicability('多平台上市 → 配方/包材 → 测试与合规', true)).toBe('CONDITIONAL');
  });
});

describe('deterministic degradation (no provider)', () => {
  it('produces a full draft without any provider and never fakes AI success', () => {
    const draft = parseIntelligenceMaterial(GOLDEN_SAMPLE_TINSOL);
    expect(draft.parser_version).toBe(BATTLE_CARD_PARSER_VERSION);
    expect(draft.reasoning.mode).toBe('DETERMINISTIC');
    expect(draft.reasoning.model_called).toBe(false);
    expect(draft.extracted_facts.length).toBeGreaterThan(0);
    expect(draft.extracted_hypotheses.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects empty material', () => {
    const draft = parseIntelligenceMaterial(SYNTHETIC_EMPTY);
    expect(draft.extracted_facts).toHaveLength(0);
  });
});

describe('section definitions are closed', () => {
  it('every section key has a definition', () => {
    const keys = INTELLIGENCE_SECTIONS.map(section => section.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(14);
  });
});

describe('reconstructed legacy sample stays compatible but is clearly marked', () => {
  it('RECONSTRUCTED sample still parses (compatibility only, not real acceptance)', () => {
    const draft = parseIntelligenceMaterial(RECONSTRUCTED_TINSOL_LEGACY);
    expect(draft.extracted_hypotheses.length).toBe(4);
    expect(draft.peer_references.map(peer => peer.company_name).sort()).toEqual(['FF FlashFish', 'SUPRENT', '触沃电子']);
    expect(draft.candidate_customer?.name).toBe('广州电秀科技发展有限公司');
  });
});
