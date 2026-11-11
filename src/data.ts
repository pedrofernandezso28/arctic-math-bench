import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SolveItem } from './solve/truth.js';
import type { GraphItem } from './graph/truth.js';

/** Root folder of the package (where `data/` lives), from both `src/` and `dist/`. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJsonFolder<T>(folder: string): T[] {
  const dir = join(PACKAGE_ROOT, 'data', folder);
  const out: T[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as T[];
    out.push(...parsed);
  }
  return out;
}

/** Every solve item, sorted by category file name then by position. */
export const loadSolveItems = (): SolveItem[] => readJsonFolder<SolveItem>('solve');
/** Every graph item. */
export const loadGraphItems = (): GraphItem[] => readJsonFolder<GraphItem>('graph');
