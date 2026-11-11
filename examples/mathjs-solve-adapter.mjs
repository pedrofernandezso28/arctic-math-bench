// A deliberately tiny reference adapter built on mathjs. It answers only what mathjs does directly:
// polynomial equations up to degree 3, linear systems, derivatives, matrix det / inverse / transpose /
// product / eigenvalues / linear solve, complex arithmetic, simplify, and finite definite integrals
// (Simpson). Everything else is reported as "refused". It scores low on purpose: it is a naive baseline.
//
// Run: node dist/cli.js solve --adapter examples/mathjs-solve-adapter.mjs
import { create, all } from 'mathjs';

const math = create(all, {});
const nativeLog = math.log;
math.import({ ln: (x) => nativeLog(x), log: (x, b) => (b === undefined ? math.log10(x) : nativeLog(x) / nativeLog(b)) }, { override: true });

const refused = (reason) => ({ type: 'refused', reason });

// "2x + 3" -> "2*x + 3", "3(x+1)" -> "3*(x+1)"; mathjs already accepts most implicit products.
const clean = (s) => s.replace(/\|([^|]+)\|/g, 'abs($1)').replace(/\s+/g, ' ').trim();

function matrixOf(text) {
  const t = text.trim();
  if (t.startsWith('[')) return math.matrix(math.evaluate(t));
  return math.matrix(t.split(';').map((row) => row.split(',').map((c) => math.evaluate(c.trim()))));
}
const rowsOf = (m) => m.toArray().map((r) => r.map((c) => String(typeof c === 'number' ? math.round(c, 12) : math.format(c, { precision: 12 }))));

function polynomialRoots(task) {
  const v = task.options?.variable ?? 'x';
  const sides = task.input.split('=');
  if (sides.length !== 2) return refused('not an equation');
  const expr = `(${clean(sides[0])}) - (${clean(sides[1])})`;
  const r = math.rationalize(expr, {}, true);
  if (r.variables.length !== 1 || r.variables[0] !== v) return refused('not a polynomial in one variable');
  const c = r.coefficients;
  if (c.length > 4) return refused('degree above 3');
  if (c.length === 1) return Number(c[0]) === 0 ? { type: 'all' } : { type: 'none' };
  const roots = math.polynomialRoot(...c.slice(0, 4).map((x) => Number(x)));
  const complex = task.options?.domain === 'complex';
  const kept = roots.filter((z) => (typeof z === 'number' ? true : complex || Math.abs(z.im) < 1e-12)).map((z) => (typeof z === 'number' ? z : complex ? math.format(z, { precision: 14 }) : z.re));
  return kept.length ? { type: 'values', values: kept.map((z) => (typeof z === 'number' ? z : String(z))) } : { type: 'none' };
}

function linearSystem(task) {
  const rows = task.input.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const vars = [...new Set(rows.join(' ').match(/\b[a-z]\b/g) ?? [])].filter((s) => s !== 'e').sort();
  const A = [];
  const b = [];
  for (const row of rows) {
    const [l, r] = row.split('=');
    const f = (scope) => math.evaluate(`(${clean(l)}) - (${clean(r)})`, scope);
    const zero = Object.fromEntries(vars.map((x) => [x, 0]));
    const c0 = f(zero);
    const coeffs = vars.map((x) => f({ ...zero, [x]: 1 }) - c0);
    // linearity check at a second point
    const probe = Object.fromEntries(vars.map((x, i) => [x, i + 2]));
    if (Math.abs(f(probe) - (c0 + coeffs.reduce((s, c, i) => s + c * (i + 2), 0))) > 1e-9) return refused('nonlinear system');
    A.push(coeffs);
    b.push(-c0);
  }
  if (A.length !== vars.length) return refused('not square');
  try {
    const sol = math.lusolve(A, b).map((r) => r[0]);
    return { type: 'solutions', solutions: [Object.fromEntries(vars.map((x, i) => [x, sol[i]]))] };
  } catch {
    return refused('singular system');
  }
}

function simpson(f, a, b, n = 2000) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

export default {
  name: 'mathjs baseline (tiny, naive)',
  solve(task) {
    const v = task.options?.variable ?? 'x';
    try {
      switch (task.kind) {
        case 'equation':
          return polynomialRoots(task);
        case 'system':
          return linearSystem(task);
        case 'derivative': {
          let d = math.parse(clean(task.input));
          for (let i = 0; i < (task.options?.order ?? 1); i++) d = math.derivative(d, v);
          const out = { type: 'expression', expr: d.toString() };
          if (task.options?.at !== undefined) out.at = String(d.evaluate({ [v]: math.evaluate(task.options.at) }));
          return out;
        }
        case 'simplify':
          return { type: 'expression', expr: math.simplify(clean(task.input)).toString() };
        case 'complex': {
          const z = math.evaluate(clean(task.input));
          return { type: 'number', value: math.format(z, { precision: 14 }) };
        }
        case 'definite-integral': {
          const lo = math.evaluate(task.options.lower);
          const hi = math.evaluate(task.options.upper);
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) return refused('infinite bounds');
          const f = math.compile(clean(task.input));
          return { type: 'number', value: simpson((x) => f.evaluate({ [v]: x }), lo, hi) };
        }
        case 'matrix': {
          const op = task.options?.operation;
          const A = matrixOf(task.input);
          if (op === 'det') return { type: 'number', value: math.det(A) };
          if (op === 'transpose') return { type: 'matrix', rows: rowsOf(math.transpose(A)) };
          if (op === 'multiply') {
            const B = matrixOf(task.options.secondMatrix);
            if (A.size()[1] !== B.size()[0]) return { type: 'undefined' };
            return { type: 'matrix', rows: rowsOf(math.multiply(A, B)) };
          }
          if (op === 'inverse') {
            if (Math.abs(math.det(A)) < 1e-12) return { type: 'singular' };
            return { type: 'matrix', rows: rowsOf(math.inv(A)) };
          }
          if (op === 'eigen') {
            const { values } = math.eigs(A);
            return { type: 'values', values: values.toArray().map((z) => (typeof z === 'number' ? z : math.format(z, { precision: 12 }))) };
          }
          if (op === 'solve') {
            const b = task.options.constants.split(',').map((c) => math.evaluate(c));
            return { type: 'vector', values: math.lusolve(A, b).map((r) => r[0]) };
          }
          return refused(`matrix operation ${op}`);
        }
        default:
          return refused(`kind ${task.kind} is not supported by this adapter`);
      }
    } catch (e) {
      return refused(String(e?.message ?? e));
    }
  },
};
