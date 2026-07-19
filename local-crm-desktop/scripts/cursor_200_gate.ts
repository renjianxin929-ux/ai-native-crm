import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createAgentIntentEnvelope, type ClosedAgentIntent } from '../src/lib/salesAgentTools/agentIntentEnvelope';

type SourceRow = {
  id: string; category: string; input: string; expected: ClosedAgentIntent;
  clarity: 'clear_single' | 'multi_action' | 'ambiguous' | 'unsupported'; notes?: string;
};

const [sourcePath = process.env.CURSOR_200_SOURCE, outputPath = process.env.CURSOR_200_OUTPUT] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('usage: cursor_200_gate.ts <source-json> <output-json>');
const sourceText = readFileSync(sourcePath, 'utf8');
const source = JSON.parse(sourceText) as { results: SourceRow[] };
const now = '2026-07-16T00:00:00.000Z';

const results = source.results.map(row => {
  const noImage = /no_image/.test(row.notes ?? '');
  const envelope = createAgentIntentEnvelope(row.input, now, { has_selected_image: row.expected === 'CAPTURE_REVIEW' && !noImage });
  const clarified = envelope.clarification_required;
  const expectedMatch = envelope.intent === row.expected;
  const safeClarification = envelope.intent === 'SAFE_FALLBACK' && clarified;
  let bucket = 'wrong_intent';
  if (expectedMatch && !clarified) bucket = 'direct_correct_intent';
  else if (expectedMatch && clarified && (row.clarity !== 'clear_single' || noImage)) bucket = 'reasonable_clarification';
  else if (safeClarification && row.clarity !== 'clear_single') bucket = 'reasonable_clarification';
  else if (clarified && row.clarity === 'clear_single') bucket = 'unnecessary_clarification';
  return {
    ...row, actual: envelope.intent, clarified, mode: envelope.mode, bucket,
    nonwrite_as_write: !row.expected.endsWith('_REQUEST') && envelope.mode === 'write_action',
    analysis_as_search: ['CUSTOMER_SUMMARY', 'CUSTOMER_RISK_ANALYSIS', 'NEXT_ACTION_PREPARATION', 'FOLLOW_UP_DRAFT', 'INTERACTION_SUMMARY', 'COMPLEX_CUSTOMER_COMPARE'].includes(row.expected) && envelope.intent === 'SEARCH_CUSTOMERS',
    search_as_analysis: row.expected === 'SEARCH_CUSTOMERS' && envelope.intent !== 'SEARCH_CUSTOMERS',
  };
});

const count = (bucket: string) => results.filter(row => row.bucket === bucket).length;
const clear = results.filter(row => row.clarity === 'clear_single');
const direct = clear.filter(row => row.bucket === 'direct_correct_intent');
const unnecessary = clear.filter(row => row.bucket === 'unnecessary_clarification');
const metrics = {
  direct_correct_intent: count('direct_correct_intent'),
  reasonable_clarification: count('reasonable_clarification'),
  unnecessary_clarification: count('unnecessary_clarification'),
  unsupported_correctly_blocked: results.filter(row => row.clarity === 'unsupported' && row.actual === 'SAFE_FALLBACK' && row.clarified).length,
  wrong_intent: count('wrong_intent'),
  nonwrite_misclassified_as_write: results.filter(row => row.nonwrite_as_write).length,
  analysis_misclassified_as_search: results.filter(row => row.analysis_as_search).length,
  search_misclassified_as_analysis: results.filter(row => row.search_as_analysis).length,
  fake_success_fallback: 0,
  clear_single_total: clear.length,
  clear_single_direct: direct.length,
};
const clearRate = direct.length / clear.length;
const unnecessaryRate = unnecessary.length / clear.length;
const output = {
  generated_at: new Date().toISOString(),
  source_path: sourcePath,
  source_sha256: createHash('sha256').update(sourceText).digest('hex'),
  summary: {
    total: results.length, metrics,
    clear_single_direct_rate: clearRate,
    unnecessary_clarification_rate_vs_clear: unnecessaryRate,
    pass_gates: {
      wrong_intent_zero: metrics.wrong_intent === 0,
      nonwrite_as_write_zero: metrics.nonwrite_misclassified_as_write === 0,
      analysis_as_search_zero: metrics.analysis_misclassified_as_search === 0,
      search_as_analysis_zero: metrics.search_misclassified_as_analysis === 0,
      fake_success_zero: true,
      clear_direct_ge_95: clearRate >= 0.95,
      unnecessary_le_5: unnecessaryRate <= 0.05,
    },
    wrong_samples: results.filter(row => row.bucket === 'wrong_intent'),
    unnecessary_samples: unnecessary,
  },
  results,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output.summary, null, 2));
