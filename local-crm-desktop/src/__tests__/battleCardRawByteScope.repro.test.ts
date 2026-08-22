/**
 * P0-A 复现测试：CRLF 归一化后 Source Span 指向 normalized content 的字节偏移，
 * 切原始 raw_content 时错位、excerpt SHA 无法由原始字节重算。
 * 修复前必须真实失败；不得用 LF fixture 绕过。
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  SOURCE_SPAN_CONTRACT_VERSION,
  buildImportScopeId,
  parseIntelligenceMaterial,
} from '../lib/battleCard/parser';
import { sha256HexSync } from '../lib/salesAgentTools/confirmedWrite';

const CRLF_SAMPLE = [
  '广州电秀科技发展有限公司 战前卡',
  '',
  '1. 主体与公开事实',
  '',
  '已核事实/证据：',
  '广州品牌出海案例明确其专注生活电器与个人护理小家电，销售覆盖80多个国家和地区。',
  '',
  '等级：A/B',
  '来源：广州品牌出海案例',
  '',
  '已核事实/证据：',
  '官方案例披露2023年在Amazon、AliExpress、TEMU、SHEIN、TikTok美国站销售额突破7000万元。',
  '',
  '3. 当前问题假设',
  '',
  'H1（待验证）：',
  '新品横跨品牌、产品、工厂、包材、法规、设计、内容和运营，状态可能被聊天信息淹没。',
  '',
].join('\r\n');

const PARITY_RAW = '# 主体与公开事实\r\n广州电秀科技发展有限公司专注生活电器与个人护理小家电。\r\n官方案例披露2023年在Amazon销售额突破7000万元。😊\r\n产品配方与成分属于在售商品的一部分。\r\n# 当前问题假设\r\nH1（待验证）：\r\n新品状态可能被聊天信息淹没。😊\r\n';

const PARITY_MATRIX_LF = [
  '广州电秀科技发展有限公司 战前卡',
  '',
  '1. 主体与公开事实',
  '',
  '',
  '广州品牌出海案例明确其专注生活电器与个人护理小家电，销售覆盖80多个国家和地区。',
  '官方案例披露2023年在Amazon销售额突破7000万元。😊',
  '产品配方与成分属于在售商品的一部分。',
  '',
  '3. 当前问题假设',
  '',
  'H1（待验证）：',
  '第一行内容😊',
  '第二行补充内容',
  '第三行补充内容',
  'H2：跨部门协作可能缺少统一推进节奏。',
  'H3：合规信息可能在销售前未被完整核验。',
  'H4：售后反馈可能没有形成产品改进闭环。',
  '以上均不是已发生事实，仅供人工验证，不得进入 Hypothesis。',
  '',
  '4B. 可直接复述的飞书话术',
  '',
  '第一段话术：先统一原始材料与候选事实。',
  '',
  '第二段话术：再由人工确认后推进。',
].join('\n') + '\n';

type ParityFixture = Readonly<{
  fixture_id: string;
  raw_content: string;
  customer_id: string;
  source_kind: string;
}>;

const PARITY_MATRIX: readonly ParityFixture[] = [
  {
    fixture_id: 'guangzhou-lf-chinese-consecutive-blank-eof-newline',
    raw_content: PARITY_MATRIX_LF,
    customer_id: 'customer-parity-lf',
    source_kind: 'MANUAL_PASTE',
  },
  {
    fixture_id: 'guangzhou-crlf-chinese-emoji-multiline-h1-eof-newline',
    raw_content: PARITY_MATRIX_LF.replace(/\n/g, '\r\n'),
    customer_id: 'customer-parity-crlf',
    source_kind: 'MANUAL_PASTE',
  },
  {
    fixture_id: 'guangzhou-mixed-crlf-lf-chinese-emoji-no-eof',
    raw_content: PARITY_MATRIX_LF
      .replace(/\n/g, '\r\n')
      .replace('主体与公开事实\r\n\r\n\r\n广州', '主体与公开事实\n\r\n广州')
      .replace('第一行内容😊\r\n第二行补充内容', '第一行内容😊\n第二行补充内容')
      .replace(/\r\n$/, ''),
    customer_id: 'customer-parity-mixed',
    source_kind: 'MANUAL_PASTE',
  },
  {
    fixture_id: 'guangzhou-full-width-chapter-crlf-h1-h4-4b-multiparagraph',
    raw_content: PARITY_MATRIX_LF
      .replace('1. 主体与公开事实', '１．主体与公开事实')
      .replace('3. 当前问题假设', '３．当前问题假设')
      .replace('4B. 可直接复述的飞书话术', '４B．可直接复述的飞书话术')
      .replace(/\n/g, '\r\n'),
    customer_id: 'customer-parity-full-width',
    source_kind: 'MANUAL_PASTE',
  },
  {
    fixture_id: 'guangzhou-lf-no-eof',
    raw_content: PARITY_MATRIX_LF.replace(/\n$/, ''),
    customer_id: 'customer-parity-lf-no-eof',
    source_kind: 'MANUAL_PASTE',
  },
];

function countCrlf(value: string): number {
  return (value.match(/\r\n/g) ?? []).length;
}

function countLf(value: string): number {
  return (value.match(/\n/g) ?? []).length;
}

function textareaBoundaryEvidence(value: string) {
  return {
    utf8_bytes: new TextEncoder().encode(value).byteLength,
    crlf_count: countCrlf(value),
    lf_count: countLf(value),
    sha256: sha256HexSync(value),
  } as const;
}

function buildTsParityCase(fixture: ParityFixture) {
  const draft = parseIntelligenceMaterial(fixture.raw_content, {
    customer_id: fixture.customer_id,
    source_kind: fixture.source_kind,
  });
  const candidates = [
    ...draft.extracted_facts.map(candidate => ({
      candidate_kind: 'FACT',
      candidate_id: candidate.fact_id,
      import_scope_id: buildImportScopeId({
        customerId: fixture.customer_id,
        rawContentSha256: sha256HexSync(fixture.raw_content),
        parserContractVersion: draft.parser_version,
        sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
        sourceKind: fixture.source_kind,
      }),
      source_section: candidate.source_section,
      start_byte: candidate.start_byte,
      end_byte: candidate.end_byte,
      source_excerpt: candidate.source_excerpt,
      source_excerpt_utf8_bytes: Array.from(new TextEncoder().encode(candidate.source_excerpt)),
      source_excerpt_sha256: candidate.excerpt_sha256,
      statement: candidate.statement,
      statement_sha256: candidate.statement_sha256,
      applicability: candidate.applicability,
      fact_category: candidate.fact_category,
      rationale: null,
      validation_question: null,
      parser_contract_version: candidate.parser_contract_version,
      source_span_contract_version: candidate.source_span_contract_version,
    })),
    ...draft.extracted_hypotheses.map(candidate => ({
      candidate_kind: 'HYPOTHESIS',
      candidate_id: candidate.hypothesis_id,
      import_scope_id: buildImportScopeId({
        customerId: fixture.customer_id,
        rawContentSha256: sha256HexSync(fixture.raw_content),
        parserContractVersion: draft.parser_version,
        sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
        sourceKind: fixture.source_kind,
      }),
      source_section: candidate.source_section,
      start_byte: candidate.start_byte,
      end_byte: candidate.end_byte,
      source_excerpt: candidate.source_excerpt,
      source_excerpt_utf8_bytes: Array.from(new TextEncoder().encode(candidate.source_excerpt)),
      source_excerpt_sha256: candidate.excerpt_sha256,
      statement: candidate.statement,
      statement_sha256: candidate.statement_sha256,
      applicability: candidate.applicability,
      fact_category: '',
      rationale: candidate.rationale,
      validation_question: candidate.validation_question,
      parser_contract_version: candidate.parser_contract_version,
      source_span_contract_version: candidate.source_span_contract_version,
    })),
  ];
  return {
    fixture_id: fixture.fixture_id,
    raw_content_sha256: sha256HexSync(fixture.raw_content),
    import_scope_id: buildImportScopeId({
      customerId: fixture.customer_id,
      rawContentSha256: sha256HexSync(fixture.raw_content),
      parserContractVersion: draft.parser_version,
      sourceSpanContractVersion: SOURCE_SPAN_CONTRACT_VERSION,
      sourceKind: fixture.source_kind,
    }),
    parser_contract_version: draft.parser_version,
    source_span_contract_version: SOURCE_SPAN_CONTRACT_VERSION,
    candidates,
  };
}

function runRustParityMatrix(fixtures: readonly ParityFixture[]) {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'battle-card-parity-'));
  const fixturePath = join(fixtureDirectory, 'fixtures.json');
  try {
    writeFileSync(fixturePath, JSON.stringify(fixtures), 'utf8');
    const rustOutput = execFileSync(
      'cargo',
      ['test', 'crlf_candidates_reconstruct_from_original_utf8_bytes', '--', '--nocapture'],
      {
        cwd: new URL('../../src-tauri/', import.meta.url),
        encoding: 'utf8',
        env: {
          ...process.env,
          BATTLE_CARD_PARITY_DUMP: '1',
          BATTLE_CARD_PARITY_FIXTURE_FILE: fixturePath,
        },
      },
    );
    const match = rustOutput.match(/BATTLE_CARD_RUST_PARITY_JSON:(.+)/);
    expect(match?.[1], 'Rust production parser must emit exactly one parity matrix').toBeTruthy();
    return JSON.parse(match![1]!);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

describe('P0-A: CRLF raw-byte source span', () => {
  it('excerpt 可由原始字节切片重算（raw_bytes[start:end] == excerpt 且 SHA 一致）', () => {
    const draft = parseIntelligenceMaterial(CRLF_SAMPLE, { customer_id: 'cust-test', source_kind: 'MANUAL_PASTE' });
    const fact = draft.extracted_facts[0];
    const rawBytes = new TextEncoder().encode(CRLF_SAMPLE);
    const slice = new TextDecoder().decode(rawBytes.subarray(fact.start_byte, fact.end_byte));
    expect(slice, 'raw slice must equal the authoritative source_excerpt').toBe(fact.source_excerpt);
    expect(new TextEncoder().encode(fact.source_excerpt)).toEqual(rawBytes.subarray(fact.start_byte, fact.end_byte));
    expect(sha256HexSync(slice)).toBe(fact.excerpt_sha256);
  });

  it('多行 Candidate 内部 CRLF 保留且 span 正确（H1 双行）', () => {
    const draft = parseIntelligenceMaterial(CRLF_SAMPLE, { customer_id: 'cust-test', source_kind: 'MANUAL_PASTE' });
    const hyp = draft.extracted_hypotheses[0];
    const rawBytes = new TextEncoder().encode(CRLF_SAMPLE);
    const slice = new TextDecoder().decode(rawBytes.subarray(hyp.start_byte, hyp.end_byte));
    expect(slice, 'raw slice must equal the authoritative source_excerpt').toBe(hyp.source_excerpt);
    expect(new TextEncoder().encode(hyp.source_excerpt)).toEqual(rawBytes.subarray(hyp.start_byte, hyp.end_byte));
    expect(slice.startsWith('H1（待验证）：')).toBe(true);
    expect(slice.includes('\r\n')).toBe(true);
    expect(slice.endsWith(hyp.statement)).toBe(true);
    expect(sha256HexSync(slice)).toBe(hyp.excerpt_sha256);
  });

  it('原始 Raw Content 未变化（无全局归一化副作用）', () => {
    const draft = parseIntelligenceMaterial(CRLF_SAMPLE, { customer_id: 'cust-test', source_kind: 'MANUAL_PASTE' });
    expect(draft.raw_content).toBe(CRLF_SAMPLE);
  });
});

describe('TEXTAREA transport canonicalization boundary', () => {
  it('treats the formal textarea API value as the only payload that may enter parsing', () => {
    const sourceFixtureBeforeUi = PARITY_RAW;
    const dom = new JSDOM('<textarea aria-label="战前材料原文"></textarea>');
    const textarea = dom.window.document.querySelector('textarea');
    expect(textarea).not.toBeNull();

    textarea!.value = sourceFixtureBeforeUi;
    const canonicalUiPayload = textarea!.value;
    const expectedLfPayload = sourceFixtureBeforeUi.replace(/\r\n|\r/g, '\n');

    expect(textareaBoundaryEvidence(sourceFixtureBeforeUi)).toMatchObject({ crlf_count: 7, lf_count: 7 });
    expect(canonicalUiPayload).toBe(expectedLfPayload);
    expect(textareaBoundaryEvidence(canonicalUiPayload)).toMatchObject({ crlf_count: 0, lf_count: 7 });

    const draft = parseIntelligenceMaterial(canonicalUiPayload, {
      customer_id: 'customer-textarea-canonical',
      source_kind: 'MANUAL_PASTE',
    });
    expect(draft.raw_content).toBe(canonicalUiPayload);
    expect(sha256HexSync(draft.raw_content)).toBe(textareaBoundaryEvidence(canonicalUiPayload).sha256);
    expect(sha256HexSync(draft.raw_content)).not.toBe(textareaBoundaryEvidence(sourceFixtureBeforeUi).sha256);
  });
});

describe('P0-A: TypeScript/Rust raw-byte parity envelope', () => {
  it('compares every authoritative Candidate field across the LF, CRLF, mixed, Chinese, Emoji, full-width, EOF, H1-H4, 4B, Fact, and boundary-note matrix', () => {
    const tsCases = PARITY_MATRIX.map(buildTsParityCase);
    const rustParity = runRustParityMatrix(PARITY_MATRIX);
    expect(rustParity).toEqual({ cases: tsCases });

    for (const fixture of PARITY_MATRIX) {
      const draft = parseIntelligenceMaterial(fixture.raw_content, {
        customer_id: fixture.customer_id,
        source_kind: fixture.source_kind,
      });
      const candidates = [...draft.extracted_facts, ...draft.extracted_hypotheses];
      expect(draft.extracted_facts, `${fixture.fixture_id}: exact Fact count`).toHaveLength(3);
      expect(draft.extracted_hypotheses, `${fixture.fixture_id}: exact H1-H4 count`).toHaveLength(4);
      expect(draft.extracted_hypotheses.map(candidate => candidate.rationale)).toEqual([
        'H1 假设',
        'H2 假设',
        'H3 假设',
        'H4 假设',
      ]);
      expect(draft.extracted_hypotheses.some(candidate => candidate.statement.includes('以上均不是已发生事实'))).toBe(false);

      for (const candidate of candidates) {
        const rawBytes = new TextEncoder().encode(fixture.raw_content);
        const rawSlice = rawBytes.subarray(candidate.start_byte, candidate.end_byte);
        const rawExcerpt = new TextDecoder('utf-8', { fatal: true }).decode(rawSlice);
        expect(rawExcerpt, `${fixture.fixture_id}:${candidate.source_section} source excerpt`).toBe(candidate.source_excerpt);
        expect(Array.from(new TextEncoder().encode(candidate.source_excerpt))).toEqual(Array.from(rawSlice));
        expect(sha256HexSync(candidate.source_excerpt)).toBe(candidate.excerpt_sha256);
        expect(candidate.source_excerpt.endsWith('\n') || candidate.source_excerpt.endsWith('\r')).toBe(false);
      }

      const h1 = draft.extracted_hypotheses[0]!;
      expect(h1.statement, `${fixture.fixture_id}: H1 statement stays the business body`).toBe('第一行内容😊');
      expect(h1.source_excerpt.startsWith('H1（待验证）：')).toBe(true);
      expect(h1.source_excerpt.endsWith(h1.statement)).toBe(true);
      expect(h1.source_excerpt.includes('\n')).toBe(true);
    }

    const crlfCase = PARITY_MATRIX.find(fixture => fixture.fixture_id.includes('crlf'))!;
    const crlfH1 = parseIntelligenceMaterial(crlfCase.raw_content, {
      customer_id: crlfCase.customer_id,
      source_kind: crlfCase.source_kind,
    }).extracted_hypotheses[0]!;
    expect(crlfH1.source_excerpt).toContain('\r\n');
    expect(crlfH1.source_excerpt).toContain('第一行内容😊');

    const rawContentHashes = PARITY_MATRIX.map(fixture => sha256HexSync(fixture.raw_content));
    expect(new Set(rawContentHashes).size).toBe(PARITY_MATRIX.length);
    expect(tsCases[0]!.candidates[0]!.candidate_id).not.toBe(tsCases[1]!.candidates[0]!.candidate_id);
  }, 600_000);
});
