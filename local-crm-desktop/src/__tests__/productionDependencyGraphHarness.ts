import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')];
  return candidates.find(candidate => existsSync(candidate) && ['.ts', '.tsx', '.js'].includes(extname(candidate))) ?? null;
}

export function buildProductionDependencyGraph(): readonly string[] {
  const queue = [resolve(ROOT, 'src/main.tsx'), resolve(ROOT, 'src/App.tsx')];
  const visited = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (visited.has(file) || !existsSync(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolveLocalImport(file, match[1] ?? match[2]);
      if (target && !visited.has(target)) queue.push(target);
    }
  }
  return [...visited].sort();
}

export function readGraphSources(): string {
  return buildProductionDependencyGraph().map(file => `// ${relative(ROOT, file)}\n${readFileSync(file, 'utf8')}`).join('\n');
}

export function readProductionBundle(): string {
  const assets = resolve(ROOT, 'dist/assets');
  if (!existsSync(assets)) throw new Error('Production bundle is missing; run npm.cmd run build first.');
  return readdirSync(assets).filter(name => name.endsWith('.js')).map(name => readFileSync(resolve(assets, name), 'utf8')).join('\n');
}
