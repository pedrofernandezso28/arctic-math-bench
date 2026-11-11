import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, loadGraphItems, loadSolveItems } from '../src/data.js';
import { referenceGraphAdapter } from '../src/graph/oracle.js';
import { referenceSolveAdapter } from '../src/solve/oracle.js';
import { graphMarkdown, benchGraph, benchSolve, solveMarkdown, summarizeGraph, summarizeSolve } from '../src/runner.js';

const solve = loadSolveItems();
const graph = loadGraphItems();
const load = async (f: string) => ((await import(pathToFileURL(join(PACKAGE_ROOT, 'examples', f)).href)) as { default: never }).default;

describe('runner and example adapters', () => {
  it('the reference adapter scores 100 % on a slice of solve', async () => {
    const res = await benchSolve(referenceSolveAdapter(solve), solve, { limit: 120 });
    expect(summarizeSolve(res).at(-1)!.score).toBe(100);
  });

  it('the reference adapter scores 100 % on a slice of graph', async () => {
    const res = await benchGraph(referenceGraphAdapter(graph), graph, { idPattern: /^(fn\.x2|imp\.circle|ineq\.disk|pts\.|poi\.x2)/ });
    expect(res.length).toBeGreaterThan(5);
    expect(summarizeGraph(res).at(-1)!.score).toBe(100);
  });

  it('the mathjs example adapter runs, answers some kinds and refuses others', async () => {
    const adapter = await load('mathjs-solve-adapter.mjs');
    const res = await benchSolve(adapter, solve, { kinds: ['matrix', 'complex', 'limit'] });
    const by = Object.fromEntries(summarizeSolve(res, 'kind').map((r) => [r.name, r]));
    expect(by.matrix!.counts.CORRECT).toBeGreaterThan(10);
    expect(by.limit!.counts.REFUSED).toBe(by.limit!.n);
    expect(solveMarkdown('x', res)).toContain('## By category');
  });

  it('the naive sampler example runs on explicit functions and misses implicit curves', async () => {
    const adapter = await load('naive-graph-adapter.mjs');
    const res = await benchGraph(adapter, graph, { idPattern: /^(fn\.x2\.D|fn\.cubic\.D|imp\.circle\.D)$/ });
    const by = Object.fromEntries(res.map((r) => [r.id, r.class]));
    expect(by['fn.x2.D']).not.toBe('REFUSED');
    expect(by['imp.circle.D']).toBe('MISSING');
    expect(graphMarkdown('x', res)).toContain('## By group');
  });

  it('an adapter that throws or times out is REFUSED', async () => {
    const throwing = { solve: () => { throw new Error('boom'); } };
    const slow = { solve: () => new Promise<never>(() => undefined) };
    const a = await benchSolve(throwing, solve, { limit: 2 });
    expect(a.every((r) => r.class === 'REFUSED' && r.error === 'boom')).toBe(true);
    const b = await benchSolve(slow, solve, { limit: 1, timeoutMs: 50 });
    expect(b[0]!.class).toBe('REFUSED');
  });
});
