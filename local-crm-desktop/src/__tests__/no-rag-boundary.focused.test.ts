import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

describe('no-rag-boundary and provider-unconfigured-honesty', () => {
  it('contains no RAG/embedding/vector implementation in production sources', () => {
    const forbidden = /\bRAG\b|\bembeddings?\b|\bvector[ _-]?(?:db|database|store)\b|\bsimilarity search\b/i;
    const roots = [resolve('src'), resolve('src-tauri/src')];
    const productionHits = roots.flatMap(sourceFiles).flatMap(file => {
      if (file.includes('__tests__') || file.includes('no-rag-boundary')) return [];
      return readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line, index) => (
        forbidden.test(line) && !/明确不|不在 B[0-9]|未来 seam|属 B4|语义\/检索式搜索/.test(line)
          ? [`${file}:${index + 1}:${line}`]
          : []
      ));
    });
    expect(productionHits).toEqual([]);
  });
});
