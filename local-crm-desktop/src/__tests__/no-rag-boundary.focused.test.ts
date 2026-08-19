import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('no-rag-boundary and provider-unconfigured-honesty', () => {
  it('contains no RAG/embedding/vector implementation in production sources', () => {
    const output = spawnSync('rg', ['-n', '--pcre2', '(?i)\\bRAG\\b|\\bembeddings?\\b|\\bvector[ _-]?(?:db|database|store)\\b|\\bsimilarity search\\b', 'src', 'src-tauri/src'], { encoding: 'utf8' });
    expect(output.error, `rg failed to start: ${output.error?.message ?? ''}`).toBeUndefined();
    if (output.status !== 0 && output.status !== 1) {
      throw new Error(`rg exited ${String(output.status)} (0=matches, 1=no matches). stderr=${output.stderr ?? ''}`);
    }
    const productionHits = (output.stdout ?? '').split(/\r?\n/).filter(line => (
      line
      && !line.includes('__tests__')
      && !line.includes('no-rag-boundary')
      && !/明确不|不在 B[0-9]|未来 seam|属 B4|语义\/检索式搜索/.test(line)
    ));
    expect(productionHits).toEqual([]);
  });
});
