import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('no-rag-boundary and provider-unconfigured-honesty', () => {
  it('contains no RAG/embedding/vector implementation in production sources', () => {
    const output = spawnSync('rg', ['-n', '--pcre2', '(?i)\\bRAG\\b|\\bembeddings?\\b|\\bvector[ _-]?(?:db|database|store)\\b|\\bsimilarity search\\b', 'src', 'src-tauri/src'], { encoding: 'utf8' }).stdout;
    const productionHits = output.split(/\r?\n/).filter(line => line && !line.includes('__tests__') && !line.includes('no-rag-boundary'));
    expect(productionHits).toEqual([]);
  });
});
