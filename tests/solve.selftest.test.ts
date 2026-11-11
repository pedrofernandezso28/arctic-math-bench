import { describe, expect, it } from 'vitest';
import { loadSolveItems } from '../src/data.js';
import { judgeSolve } from '../src/solve/judge.js';
import { evalReal, normalize } from '../src/solve/mathUtil.js';
import type { SolveAnswer } from '../src/types.js';
import type { SolveItem } from '../src/solve/truth.js';

const items = loadSolveItems();

describe('solve: every ground truth is accepted by its own judge', () => {
  it('the reference answer of every item is CORRECT', () => {
    const bad = items.map((i) => ({ i, v: judgeSolve(i, i.reference) })).filter((x) => x.v.class !== 'CORRECT');
    expect(bad.map((x) => `${x.i.id} [${x.i.task.input}] ${x.v.class}: ${x.v.why}`)).toEqual([]);
  });

  it('no answer at all is REFUSED', () => {
    for (const i of items.slice(0, 50)) {
      expect(judgeSolve(i, null).class).toBe('REFUSED');
      expect(judgeSolve(i, undefined).class).toBe('REFUSED');
      expect(judgeSolve(i, { type: 'refused', reason: 'x' }).class).toBe('REFUSED');
    }
  });
});

// ── negative controls: deliberately wrong answers for every item ──────────────

const BOGUS = '12345.678';
const finite = (t: string) => Number.isFinite(evalReal(normalize(t)));

/** Wrong answers for an item, each with the classes the judge is allowed to give (never CORRECT). */
function mutants(item: SolveItem): Array<{ name: string; answer: SolveAnswer; allowed: string[] }> {
  const t = item.truth;
  const r = item.reference;
  const out: Array<{ name: string; answer: SolveAnswer; allowed: string[] }> = [];
  const NOT = ['WRONG', 'INCOMPLETE'];
  switch (t.type) {
    case 'roots':
    case 'complexRoots':
    case 'eigenvalues': {
      if (r.type !== 'values') break;
      const vals = r.values ?? [];
      if (vals.length > 1) out.push({ name: 'drop a root', answer: { type: 'values', values: vals.slice(1) }, allowed: ['INCOMPLETE'] });
      out.push({ name: 'extra bogus root', answer: { type: 'values', values: [...vals, BOGUS] }, allowed: ['WRONG'] });
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      out.push({ name: 'empty', answer: { type: 'values', values: [] }, allowed: ['INCOMPLETE'] });
      break;
    }
    case 'none':
      out.push({ name: 'a root', answer: item.task.kind === 'system' ? { type: 'solutions', solutions: [{ x: 1, y: 1 }] } : { type: 'values', values: ['1'] }, allowed: ['WRONG'] });
      out.push({ name: 'identity', answer: { type: 'all' }, allowed: ['WRONG'] });
      break;
    case 'identity':
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      out.push({ name: 'isolated values', answer: { type: 'values', values: ['1'] }, allowed: ['WRONG'] });
      if (t.except?.length) out.push({ name: 'forgets the exclusions', answer: { type: 'all' }, allowed: ['INCOMPLETE'] });
      break;
    case 'solutionSet':
      out.push({ name: 'far interval', answer: { type: 'intervals', intervals: [{ lo: 1000, hi: 1001, loClosed: true, hiClosed: true }] }, allowed: NOT });
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      break;
    case 'symbolicRoots':
      out.push({ name: 'shifted expression', answer: { type: 'values', values: t.values.map((v) => `(${v}) + 1`) }, allowed: NOT });
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      break;
    case 'trig': {
      if (r.type !== 'values') break;
      out.push({ name: 'shifted family', answer: { type: 'values', families: (r.families ?? []).map((f) => `${f} + 0.1`) }, allowed: ['WRONG'] });
      const k0 = (r.families ?? []).map((f) => evalReal(normalize(f, { deg: t.unit === 'deg' }), { k: 0 }));
      out.push({ name: 'particular values only', answer: { type: 'values', values: k0 }, allowed: ['INCOMPLETE'] });
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      break;
    }
    case 'inequality':
      if (t.reference.length) out.push({ name: 'no solution', answer: { type: 'none' }, allowed: NOT });
      else out.push({ name: 'all reals', answer: { type: 'all' }, allowed: ['WRONG'] });
      out.push({ name: 'far small interval', answer: { type: 'intervals', intervals: [{ lo: 50.5, hi: 50.6 }] }, allowed: NOT });
      break;
    case 'systemSolutions': {
      if (r.type !== 'solutions') break;
      if (r.solutions.length > 1) out.push({ name: 'drop a solution', answer: { type: 'solutions', solutions: r.solutions.slice(1) }, allowed: ['INCOMPLETE'] });
      const first = Object.fromEntries(Object.entries(r.solutions[0]!).map(([k, v]) => [k, `(${v}) + 0.5`]));
      out.push({ name: 'perturbed solution', answer: { type: 'solutions', solutions: [first] }, allowed: ['WRONG'] });
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      break;
    }
    case 'underdetermined':
      out.push({ name: 'particular solution only', answer: { type: 'solutions', solutions: [{ x: 1, y: 1, z: 1 }] }, allowed: ['INCOMPLETE', 'WRONG'] });
      out.push({ name: 'no solution', answer: { type: 'none' }, allowed: ['WRONG'] });
      if (r.type === 'parametric') {
        const k = Object.keys(r.solution)[0]!;
        out.push({ name: 'perturbed family', answer: { ...r, solution: { ...r.solution, [k]: `(${r.solution[k]}) + 1` } }, allowed: ['WRONG'] });
      }
      break;
    case 'derivative':
      if (r.type !== 'expression') break;
      out.push({ name: 'derivative plus x', answer: { type: 'expression', expr: `(${r.expr}) + x`, ...(r.at !== undefined ? { at: r.at } : {}) }, allowed: ['WRONG'] });
      if (t.at !== undefined) out.push({ name: 'no value at the point', answer: { type: 'expression', expr: r.expr }, allowed: ['INCOMPLETE'] });
      break;
    case 'implicitDerivative':
      out.push({ name: 'doubled', answer: { type: 'expression', expr: `2*(${t.expr})` }, allowed: ['WRONG'] });
      break;
    case 'antiderivative':
      if (r.type !== 'expression') break;
      out.push({ name: 'antiderivative plus x', answer: { type: 'expression', expr: `(${r.expr}) + x` }, allowed: ['WRONG'] });
      break;
    case 'number': {
      const want = evalReal(normalize(t.value));
      if (Number.isFinite(want)) {
        const cand = [`(${t.value})*1.5 + 3`, `(${t.value})*0.5 + 7`];
        const pick = cand.find((c) => Math.abs(evalReal(normalize(c)) - want) > 1e-3 * (1 + Math.abs(want))) ?? cand[0]!;
        out.push({ name: 'perturbed value', answer: { type: 'number', value: pick }, allowed: ['WRONG'] });
      } else out.push({ name: 'finite value for an infinite one', answer: { type: 'number', value: '3' }, allowed: ['WRONG'] });
      out.push({ name: 'diverges', answer: { type: 'diverges' }, allowed: ['WRONG'] });
      break;
    }
    case 'diverges':
      out.push({ name: 'a value', answer: { type: 'number', value: '5' }, allowed: ['WRONG'] });
      break;
    case 'dne':
      out.push({ name: 'a value', answer: { type: 'number', value: '0' }, allowed: ['WRONG'] });
      break;
    case 'ode': {
      out.push({ name: 'wrong function', answer: { type: 'expression', expr: 'C1*x' }, allowed: ['WRONG'] });
      if (!t.exact && r.type === 'expression' && /C\d/.test(r.expr)) {
        out.push({ name: 'constants removed', answer: { type: 'expression', expr: r.expr.replace(/C\d/g, '1') }, allowed: ['INCOMPLETE', 'WRONG'] });
      }
      break;
    }
    case 'matrix': {
      const rows = t.rows.map((row, i) => row.map((c, j) => (i === 0 && j === 0 ? `(${c}) + 1` : c)));
      out.push({ name: 'perturbed entry', answer: { type: 'matrix', rows }, allowed: ['WRONG'] });
      out.push({ name: 'singular', answer: { type: 'singular' }, allowed: ['WRONG'] });
      break;
    }
    case 'singular':
      out.push({ name: 'an inverse', answer: { type: 'matrix', rows: [['1']] }, allowed: ['WRONG'] });
      break;
    case 'undefined':
      out.push({ name: 'a product', answer: { type: 'matrix', rows: [['1']] }, allowed: ['WRONG'] });
      break;
    case 'vector':
      out.push({ name: 'perturbed vector', answer: { type: 'vector', values: t.values.map((v) => `(${v}) + 1`) }, allowed: ['WRONG'] });
      break;
    case 'closedForm':
    case 'polynomial':
      out.push({ name: 'plus one', answer: { type: 'expression', expr: `(${r.type === 'expression' ? r.expr : '0'}) + 1` }, allowed: ['WRONG'] });
      break;
    case 'equivalent':
      out.push({ name: 'not equivalent', answer: { type: 'expression', expr: `(${r.type === 'expression' ? r.expr : '0'}) + x` }, allowed: ['WRONG'] });
      break;
  }
  // every item: a grammar mismatch and unreadable text
  out.push({ name: 'unreadable expression', answer: { type: 'expression', expr: 'foo bar(' }, allowed: ['WRONG'] });
  return out;
}

describe('solve: negative controls (deliberately wrong answers are rejected)', () => {
  it('no mutated answer is CORRECT, and each lands in its expected class', () => {
    const failures: string[] = [];
    let checks = 0;
    for (const item of items) {
      for (const m of mutants(item)) {
        checks += 1;
        const v = judgeSolve(item, m.answer);
        if (v.class === 'CORRECT' || !m.allowed.includes(v.class)) failures.push(`${item.id} [${item.task.input}] ${m.name}: got ${v.class} (${v.why}), allowed ${m.allowed.join('/')}`);
      }
    }
    expect(checks).toBeGreaterThan(3000);
    expect(failures).toEqual([]);
  });

  it('covers every truth type with at least one control', () => {
    const covered = new Set<string>();
    for (const item of items) if (mutants(item).length > 1) covered.add(item.truth.type);
    const all = new Set(items.map((i) => i.truth.type));
    expect([...all].filter((t) => !covered.has(t))).toEqual([]);
  });
});
void finite;
