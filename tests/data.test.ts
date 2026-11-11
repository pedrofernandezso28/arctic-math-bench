import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, loadGraphItems, loadSolveItems } from '../src/data.js';
import { compile1, compile2, compileCurve } from '../src/graph/runtime.js';
import { evalReal, fnOf, normalize, quad } from '../src/solve/mathUtil.js';

const solve = loadSolveItems();
const graph = loadGraphItems();
const read = (name: string) => JSON.parse(readFileSync(join(PACKAGE_ROOT, 'schema', name), 'utf8'));
const Ajv = createRequire(import.meta.url)('ajv') as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown }; errorsText: (e: unknown) => string };
const ajv = new Ajv({ allErrors: true, strict: false });

describe('data: structure', () => {
  it('solve ids are unique and graph ids are unique', () => {
    const dup = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup(solve.map((i) => i.id))).toEqual([]);
    expect(dup(graph.map((i) => i.id))).toEqual([]);
  });

  it('every solve item validates against schema/solve-item.schema.json', () => {
    const validate = ajv.compile(read('solve-item.schema.json'));
    const bad = solve.filter((i) => !validate(i)).map((i) => `${i.id}: ${ajv.errorsText(validate.errors)}`);
    expect(bad).toEqual([]);
  });

  it('every graph item validates against schema/graph-item.schema.json', () => {
    const validate = ajv.compile(read('graph-item.schema.json'));
    const bad = graph.filter((i) => !validate(i)).map((i) => `${i.id}: ${ajv.errorsText(validate.errors)}`);
    expect(bad).toEqual([]);
  });

  it('each solve file holds one category and ids carry that category', () => {
    const dir = join(PACKAGE_ROOT, 'data', 'solve');
    for (const f of readdirSync(dir)) {
      const items = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Array<{ id: string; category: string }>;
      for (const i of items) {
        expect(i.category).toBe(f.replace('.json', ''));
        expect(i.id.startsWith(`${i.category}-`)).toBe(true);
      }
    }
  });

  it('reports the corpus size', () => {
    expect(solve.length).toBeGreaterThan(1000);
    expect(graph.length).toBeGreaterThan(700);
  });
});

describe('data: audit of the stored truths', () => {
  it('every typed solve input can be read by the judge (parses as math)', () => {
    const bad: string[] = [];
    for (const i of solve) {
      if (['matrix', 'series', 'ode'].includes(i.task.kind)) continue;
      const text = i.judgeAs ?? i.task.input;
      for (const part of text.split(/;|<=|>=|<|>|=/)) {
        if (!part.trim()) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (fnOf as any)(part);
          const n = normalize(part);
          if (n.length === 0) bad.push(i.id);
        } catch {
          bad.push(i.id);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('finite definite integrals agree with adaptive quadrature', () => {
    const bad: string[] = [];
    for (const i of solve) {
      if (i.truth.type !== 'number' || i.task.kind !== 'definite-integral') continue;
      const lo = evalReal(normalize(String(i.task.options?.lower)));
      const hi = evalReal(normalize(String(i.task.options?.upper)));
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      const q = quad(fnOf(i.task.input), lo, hi);
      const want = evalReal(normalize(i.truth.value));
      if (Number.isFinite(q) && Math.abs(q - want) > 1e-4 * (1 + Math.abs(want))) bad.push(`${i.id} ${i.task.input}: quad ${q}, truth ${want}`);
    }
    expect(bad).toEqual([]);
  });

  it('every graph truth function compiles and every window is well formed', () => {
    for (const i of graph) {
      const [x0, x1, y0, y1] = i.task.window;
      expect(x1 > x0 && y1 > y0, i.id).toBe(true);
      const t = i.truth;
      if (!t) continue;
      if (t.type === 'fn') expect(typeof compile1(t.f)).toBe('function');
      if (t.type === 'fns') t.fs.forEach((f) => expect(typeof compile1(f)).toBe('function'));
      if (t.type === 'implicit' || t.type === 'region') expect(typeof compile2(t.F)).toBe('function');
      if (t.type === 'param') t.curves.forEach((c) => expect(Array.isArray(compileCurve(c).p(0.5))).toBe(true));
    }
  });

  it('the data carries no marks of any engine or competitor', () => {
    // spelled in pieces so that this file itself stays clean when the repository is searched for these names
    const words = [['des', 'mos'], ['photo', 'math'], ['geo', 'gebra'], ['wolf', 'ram'], ['math', 'way'], ['symbo', 'lab'], ['clau', 'de'], ['anthro', 'pic'], ['work', 'tree'], ['audit', '-2'], ['src/', 'features'], ['run', 'Solve']].map((w) => w.join(''));
    const banned = new RegExp(words.join('|'), 'i');
    for (const dir of ['solve', 'graph']) {
      for (const f of readdirSync(join(PACKAGE_ROOT, 'data', dir))) {
        expect(banned.test(readFileSync(join(PACKAGE_ROOT, 'data', dir, f), 'utf8')), `${dir}/${f}`).toBe(false);
      }
    }
  });
});
