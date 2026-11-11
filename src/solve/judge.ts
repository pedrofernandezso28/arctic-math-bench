/**
 * Independent judge for solve items. The engine under test is never consulted: every claim is checked
 * by substituting it into the ORIGINAL problem (roots, tuples, ODE solutions), by sampling it (inequalities,
 * equivalence), by finite differences (derivatives, antiderivatives) or by comparison with a value that was
 * derived by hand and re-checked by the data audit (limits, integrals, series, matrices).
 */
import type { Interval, Scalar, SolveAnswer, SolveTask, Verdict } from '../types.js';
import type { SolveItem, Truth } from './truth.js';
import {
  bigValue, close, complexOf, equationHolds, evalComplex, evalReal, fnOf, inequalityTruth, inPieces, math, normalize, nthDerivative, realOf, rng, sameSet,
  sameValue, splitEquation, type Piece,
} from './mathUtil.js';

const ok = (how: string): Verdict => ({ class: 'CORRECT', why: '', how });
const wrong = (why: string, how = ''): Verdict => ({ class: 'WRONG', why, how });
const incomplete = (why: string, how = ''): Verdict => ({ class: 'INCOMPLETE', why, how });
const refused = (why = ''): Verdict => ({ class: 'REFUSED', why, how: '' });

const varOf = (t: Omit<SolveTask, 'id'>) => t.options?.variable ?? 'x';
const srcOf = (item: SolveItem) => item.judgeAs ?? item.task.input;
const isDeg = (item: SolveItem) => item.task.options?.angleUnit === 'deg';
const str = (v: Scalar) => String(v);

const wrongType = (a: SolveAnswer, expected: string): Verdict => wrong(`answer of type "${a.type}" where ${expected} was expected`, 'answer grammar');

/** Drop a leading "y =", "y(x) =", "F(x) =" (and, for antiderivatives, a trailing "+ C") from an expression answer. */
export function cleanExpression(text: string, stripConstant = false): string {
  let s = text.trim();
  const m = /^\s*[A-Za-z][A-Za-z0-9_']*(?:\([^()]*\))?\s*=(?!=)\s*(.+)$/.exec(s);
  if (m && !/[<>]/.test(s)) s = m[1]!;
  return stripConstant ? s.replace(/\s*\+\s*C\d*\s*$/, '').trim() : s;
}

// ─── Intervals ───────────────────────────────────────────────────────────────

const INF = /^\s*\+?\s*(Infinity|∞|inf)\s*$/i;
const NEG_INF = /^\s*-\s*(Infinity|∞|inf)\s*$/i;
export function boundValue(b: string | number): number {
  if (typeof b === 'number') return b;
  if (INF.test(b)) return Infinity;
  if (NEG_INF.test(b)) return -Infinity;
  return evalReal(normalize(b));
}

/** Intervals to sorted, merged pieces; null when an endpoint cannot be read. */
export function toPieces(intervals: Interval[]): Piece[] | null {
  const pieces: Piece[] = [];
  for (const iv of intervals) {
    const lo = boundValue(iv.lo);
    const hi = boundValue(iv.hi);
    if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
    pieces.push({ lo, hi, loIn: !!iv.loClosed && Number.isFinite(lo), hiIn: !!iv.hiClosed && Number.isFinite(hi) });
  }
  return pieces;
}

/** Merge overlapping or touching pieces so that different spellings of one set compare equal. */
export function mergePieces(pieces: Piece[]): Piece[] {
  const live = pieces.filter((p) => p.lo < p.hi || (p.lo === p.hi && p.loIn && p.hiIn));
  live.sort((a, b) => a.lo - b.lo || Number(b.loIn) - Number(a.loIn));
  const out: Piece[] = [];
  for (const p of live) {
    const last = out[out.length - 1];
    if (last && (p.lo < last.hi || (p.lo === last.hi && (p.loIn || last.hiIn)))) {
      if (p.hi > last.hi) {
        last.hi = p.hi;
        last.hiIn = p.hiIn;
      } else if (p.hi === last.hi) last.hiIn = last.hiIn || p.hiIn;
    } else out.push({ ...p });
  }
  return out;
}

const answerIntervals = (a: SolveAnswer): Interval[] | null => {
  if (a.type === 'intervals') return a.intervals;
  if (a.type === 'none') return [];
  if (a.type === 'all' && !a.except?.length) return [{ lo: '-Infinity', hi: 'Infinity' }];
  if (a.type === 'all') return null;
  return null;
};

/** True when an endpoint is written as an expression whose value overflows a double (for instance e^1000). */
const overflows = (ivs: Interval[]) => ivs.some((iv) => [iv.lo, iv.hi].some((b) => typeof b === 'string' && !INF.test(b) && !NEG_INF.test(b) && !Number.isFinite(boundValue(b)) && !Number.isNaN(boundValue(b))));

/** Structural comparison of two interval lists after merging (endpoints within 1e-9; endpoints that overflow a double are compared in 64 digits). */
function sameIntervals(got: Interval[], want: Interval[]): boolean {
  if (overflows(got) || overflows(want)) return sameIntervalsBig(got, want);
  const g = toPieces(got);
  const w = toPieces(want);
  if (!g || !w) return false;
  const gm = mergePieces(g);
  const wm = mergePieces(w);
  if (gm.length !== wm.length) return false;
  return gm.every((p, i) => {
    const q = wm[i]!;
    return (p.lo === q.lo || close(p.lo, q.lo, 1e-9)) && (p.hi === q.hi || close(p.hi, q.hi, 1e-9)) && p.loIn === q.loIn && p.hiIn === q.hiIn;
  });
}

function sameIntervalsBig(got: Interval[], want: Interval[]): boolean {
  if (got.length !== want.length) return false;
  const order = (list: Interval[]) => [...list].sort((p, q) => boundValue(p.lo) - boundValue(q.lo) || boundValue(p.hi) - boundValue(q.hi));
  const a = order(got);
  const b = order(want);
  return a.every((p, i) => {
    const q = b[i]!;
    return sameValue(p.lo, q.lo) && sameValue(p.hi, q.hi) && !!p.loClosed === !!q.loClosed && !!p.hiClosed === !!q.hiClosed;
  });
}

// ─── Kind judges ─────────────────────────────────────────────────────────────

function judgeRoots(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'roots' }>): Verdict {
  if (a.type === 'none' || a.type === 'all') return wrong(a.type === 'none' ? `says no solution; expected ${truth.values.join(', ')}` : 'says every value is a solution', 'expected roots substituted (they hold)');
  if (a.type === 'intervals') return wrong('an interval answer for an equation with isolated roots', 'answer grammar');
  if (a.type !== 'values') return wrongType(a, 'roots');
  const v = varOf(item.task);
  const given = a.values ?? [];
  const reals: Array<{ x: number; text: string }> = [];
  for (const g of given) {
    const text = str(g);
    const x = realOf(text);
    const asComplex = complexOf(text);
    if (Number.isNaN(x) && !asComplex) return wrong(`could not read "${text}" as a number`, 'parse');
    if (Number.isNaN(x)) return wrong(`claimed root ${text} is not real`, 'substituted each claimed root in the original equation');
    reals.push({ x, text });
  }
  const bad = reals.filter((r) => !equationHolds(srcOf(item), v, r.x, { valueText: r.text }));
  if (bad.length) return wrong(`claimed root(s) fail substitution: ${bad.map((b) => b.text).join(', ')}`, 'substituted each claimed root in the original equation');
  const wantTexts = truth.values;
  // Scale-aware comparison: roots of size 1e-150 must not be confused with each other or with 0.
  const scale = Math.max(...wantTexts.map((w) => Math.abs(realOf(w))).filter(Number.isFinite), 1e-300);
  const rootEq = (a: string, b: string) => {
    const x = realOf(a);
    const y = realOf(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) <= 1e-6 * Math.max(Math.abs(x), Math.abs(y)) || Math.abs(x - y) <= 1e-12 * scale;
    return sameValue(a, b, 1e-6);
  };
  const missing = wantTexts.filter((w) => !reals.some((r) => rootEq(r.text, w)));
  const extra = reals.filter((r) => !wantTexts.some((w) => rootEq(r.text, w)));
  if (extra.length) return wrong(`root(s) satisfy the equation but are not in the verified solution set: ${extra.map((e) => e.text).join(', ')}`, 'substitution + set comparison');
  if (missing.length) return incomplete(`missing root(s): ${missing.join(', ')}`, 'set comparison against the verified roots (each verified by substitution)');
  return ok('substitution + set comparison');
}

function judgeComplexRoots(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'complexRoots' }>): Verdict {
  if (a.type === 'none') return wrong(`says no solution; expected ${truth.values.join(', ')}`, 'complex substitution');
  if (a.type !== 'values') return wrongType(a, 'complex roots');
  const v = varOf(item.task);
  const values = (a.values ?? []).map((g) => ({ text: str(g), c: complexOf(str(g)) }));
  if (!values.length) return incomplete('no complex roots given', 'set comparison');
  const unreadable = values.filter((x) => !x.c);
  if (unreadable.length) return wrong(`could not read: ${unreadable.map((u) => u.text).join(', ')}`, 'parse');
  const bad = values.filter((x) => !equationHolds(srcOf(item), v, x.c!, { complex: true }));
  if (bad.length) return wrong(`claimed root(s) fail substitution: ${bad.map((b) => b.text).join(', ')}`, 'complex substitution');
  const want = truth.values.map((w) => evalComplex(normalize(w))!);
  const extra = values.filter((g) => !want.some((w) => Math.hypot(g.c!.re - w.re, g.c!.im - w.im) < 1e-6));
  if (extra.length) return wrong(`root(s) satisfy the equation but are not in the verified solution set: ${extra.map((e) => e.text).join(', ')}`, 'complex substitution + set comparison');
  const missing = want.filter((w) => !values.some((g) => Math.hypot(g.c!.re - w.re, g.c!.im - w.im) < 1e-6));
  if (missing.length) return incomplete(`missing: ${missing.map((m) => `${m.re}${m.im >= 0 ? '+' : ''}${m.im}i`).join(', ')}`, 'set comparison');
  return ok('complex substitution + set comparison');
}

function judgeNone(item: SolveItem, a: SolveAnswer): Verdict {
  if (a.type === 'none') return ok('no-solution statement');
  if (a.type === 'all') return wrong('claims an identity for a problem without solution', 'known no-solution');
  if (a.type === 'values') {
    const v = varOf(item.task);
    const real = (a.values ?? []).filter((g) => Number.isFinite(realOf(str(g))));
    if (real.length) return wrong(`claims root(s) for a problem without real solution: ${real.map(str).join(', ')}`, 'substitution / known no-solution');
    if (a.families?.length) return wrong('claims a periodic family for a problem without solution', 'known no-solution');
    void v;
    return wrong('lists non-real values where no real solution exists', 'known no-solution');
  }
  if (a.type === 'intervals') {
    const p = toPieces(a.intervals);
    if (p && mergePieces(p).length === 0) return ok('empty set');
    return wrong('claims a non-empty solution set for a problem without solution', 'known no-solution');
  }
  return wrongType(a, 'no solution');
}

function judgeIdentity(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'identity' }>): Verdict {
  const except = truth.except ?? [];
  if (a.type === 'none') return wrong(except.length ? `says no solution; every x outside {${except.join(', ')}} satisfies it` : 'says no solution for an identity', 'known identity');
  if (a.type === 'values') return wrong('claims isolated values for an equation that holds on all of its domain', 'known identity');
  if (a.type === 'all') {
    if (!except.length) return a.except?.length ? incomplete('lists exceptions that are not exceptions', 'known identity') : ok('identity statement');
    const got = (a.except ?? []).map((e) => realOf(str(e)));
    if (!got.length) return incomplete(`says every value is a solution but does not exclude ${except.join(', ')}`, 'known identity off the excluded points');
    const want = except.map((e) => realOf(e));
    const { missing, extra } = sameSet(got, want, 1e-9);
    if (missing.length) return incomplete(`does not exclude ${missing.join(', ')}`, 'excluded points');
    if (extra.length) return wrong(`excludes ${extra.join(', ')} where the equation holds`, 'excluded points');
    return ok('identity statement naming the excluded points');
  }
  if (a.type === 'intervals') {
    const pieces = toPieces(a.intervals);
    if (!pieces) return wrong('could not read the intervals', 'parse');
    const v = varOf(item.task);
    for (let x = -6; x <= 6; x += 0.25) {
      const truthHolds = equationHolds(srcOf(item), v, x);
      if (inPieces(pieces, x) !== truthHolds) return inPieces(pieces, x) ? wrong(`at ${v}=${x} the interval says yes, the equation is undefined or false`, 'sampled membership') : incomplete(`at ${v}=${x} the equation holds but the interval says no`, 'sampled membership');
    }
    return ok('sampled membership');
  }
  return wrongType(a, 'an identity');
}

function judgeSolutionSet(item: SolveItem, a: SolveAnswer): Verdict {
  const v = varOf(item.task);
  if (a.type === 'none') return wrong('says no solution for an equation with a whole interval of solutions', 'sampled membership vs substitution');
  const intervals = a.type === 'intervals' ? a.intervals : a.type === 'all' && !a.except?.length ? [{ lo: '-Infinity', hi: 'Infinity' }] : null;
  if (!intervals) {
    if (a.type === 'values') {
      const vals = (a.values ?? []).map((g) => realOf(str(g)));
      if (vals.some((x) => Number.isNaN(x) || !equationHolds(srcOf(item), v, x))) return wrong('claimed values fail substitution', 'substitution');
      return incomplete('expected a whole interval of solutions; got isolated values', 'known interval of solutions');
    }
    return wrongType(a, 'an interval of solutions');
  }
  const pieces = toPieces(intervals);
  if (!pieces) return wrong('could not read the intervals', 'parse');
  for (let x = -6; x <= 6; x += 0.25) {
    const holds = equationHolds(srcOf(item), v, x);
    const got = inPieces(pieces, x);
    if (got !== holds) return got ? wrong(`at ${v}=${x}: the answer includes it, the equation does not hold`, 'sampled membership vs substitution') : incomplete(`at ${v}=${x}: the equation holds, the answer excludes it`, 'sampled membership vs substitution');
  }
  return ok('sampled membership vs substitution');
}

function judgeSymbolic(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'symbolicRoots' }>): Verdict {
  if (a.type === 'none') return wrong('says no solution for a parametric equation that has one', 'random parameter substitution');
  if (a.type !== 'values') return wrongType(a, 'expressions in the parameters');
  const v = varOf(item.task);
  const claims = (a.values ?? []).map(str);
  if (!claims.length) return incomplete('no expression given', 'random parameter substitution');
  const r = rng(7);
  for (let trial = 0; trial < 4; trial += 1) {
    const scope: Record<string, number> = {};
    for (const p of truth.params) scope[p] = 0.5 + 3 * r();
    const got = claims.map((c) => evalReal(normalize(c), scope));
    if (got.some((g) => !Number.isFinite(g))) return wrong(`claim does not evaluate: ${claims.join(' | ')}`, 'param substitution');
    for (const g of got) if (!equationHolds(srcOf(item), v, g, { extra: scope })) return wrong(`claim ${claims.join(', ')} fails at ${JSON.stringify(scope)}`, 'random parameter substitution');
    const want = truth.values.map((w) => evalReal(normalize(w), scope));
    const { missing } = sameSet(got, want);
    if (missing.length) return incomplete(`missing ${truth.values.join(', ')}`, 'random parameter substitution');
  }
  return ok('random parameter substitution');
}

function judgeTrig(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'trig' }>): Verdict {
  if (a.type === 'none') return wrong('says no solution for an equation that has solutions', 'family substitution');
  if (a.type !== 'values') return wrongType(a, 'a general solution (families in k)');
  const v = varOf(item.task);
  const deg = truth.unit === 'deg';
  const P = deg ? 360 : 2 * Math.PI;
  const eqOpts = { deg };
  const fams = a.families ?? [];
  const want = truth.base.map((b) => evalReal(normalize(b)));
  const found: number[] = [];
  const bad: string[] = [];
  for (const f of fams) {
    const norm = normalize(f, { deg });
    for (let k = -12; k <= 12; k += 1) {
      const val = evalReal(norm, { k, n: k });
      if (!Number.isFinite(val)) {
        bad.push(`${f} (k=${k}) does not evaluate`);
        break;
      }
      if (Math.abs(k) <= 3 && !equationHolds(srcOf(item), v, val, eqOpts)) bad.push(`${f} at k=${k} gives ${val}`);
      const m = ((val % P) + P) % P;
      if (m < P - 1e-9) found.push(m < 1e-9 ? 0 : m);
    }
  }
  for (const g of a.values ?? []) {
    const x = realOf(str(g), {}, eqOpts);
    if (!Number.isFinite(x) || !equationHolds(srcOf(item), v, x, eqOpts)) bad.push(str(g));
    else {
      const m = ((x % P) + P) % P;
      found.push(m < 1e-9 || P - m < 1e-9 ? 0 : m);
    }
  }
  if (bad.length) return wrong(`false solution(s): ${[...new Set(bad)].slice(0, 6).join('; ')}`, 'substituted family members k=-3..3 and listed values');
  if (!fams.length && !(a.values ?? []).length) return incomplete('no solutions given', 'parse');
  const { missing, extra } = sameSet(found, want, 1e-6);
  if (extra.length) return wrong(`values satisfy the equation but are not in the verified solution set: ${extra.map((x) => x.toFixed(6)).join(', ')}`, 'substitution + reduction mod period');
  if (missing.length) return incomplete(`solutions missing in [0, ${deg ? '360' : '2*pi'}): ${missing.map((m) => m.toFixed(6)).join(', ')}`, 'families reduced mod the period vs the verified set');
  if (!fams.length) return incomplete('only particular values, no general solution (families in k)', 'family presence');
  return ok('family substitution + reduction mod period');
}

function judgeInequality(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'inequality' }>): Verdict {
  const v = varOf(item.task);
  const intervals = answerIntervals(a);
  if (!intervals) return wrongType(a, 'intervals');
  const pieces = toPieces(intervals);
  if (!pieces) return wrong('could not read the interval endpoints', 'parse');
  if (truth.structural) {
    if (!sameIntervals(intervals, truth.reference) && !sameIntervalsBig(intervals, truth.reference)) {
      return wrong(`answer differs from the verified set ${describe(truth.reference)}`, 'structural comparison with the hand-derived set');
    }
    if (truth.sampling === false) return ok('structural comparison with the hand-derived set (overflow: no sampling)');
  }
  const pts = new Set<number>();
  for (let x = -60; x <= 60; x += 0.173) pts.add(Number(x.toFixed(6)));
  for (const x of [-1e4, -1e3, 1e3, 1e4, 0, 1, -1, 2, -2, 3, -3, Math.E, 1e-7, -1e-7]) pts.add(x);
  const decimalEndpoints = intervals.some((iv) => [iv.lo, iv.hi].some((b) => typeof b === 'number' ? false : /\d\.\d{4,}/.test(b)));
  for (const p of pieces) {
    for (const e of [p.lo, p.hi]) {
      if (!Number.isFinite(e)) continue;
      for (const d of [0, 1e-5, -1e-5, 1e-3, -1e-3]) {
        // An endpoint printed as a rounded decimal is not tested exactly.
        if (d === 0 && decimalEndpoints && Math.abs(e * 1e5 - Math.round(e * 1e5)) > 1e-6) continue;
        pts.add(e + d);
      }
    }
  }
  const extra: number[] = [];
  const missing: number[] = [];
  for (const x of pts) {
    const t = inequalityTruth(srcOf(item), v, x);
    if (t === null) return wrong('could not evaluate the original inequality (data problem)', '');
    const got = inPieces(pieces, x);
    if (got && !t) extra.push(x);
    if (!got && t) missing.push(x);
  }
  const shown = (xs: number[]) => xs.slice(0, 4).map((x) => +x.toPrecision(8)).join(', ');
  if (extra.length) return wrong(`interval contains non-solutions, e.g. ${v}=${shown(extra)}`, 'sampled ~700 points incl. endpoints +-1e-5 and +-1e-3 against the original inequality');
  if (missing.length) return incomplete(`interval misses solutions, e.g. ${v}=${shown(missing)}`, 'sampled ~700 points incl. endpoints');
  return ok('sampled ~700 points incl. endpoints against the original inequality');
}

const describe = (ivs: Interval[]) =>
  ivs.length ? ivs.map((i) => `${i.loClosed ? '[' : '('}${i.lo}, ${i.hi}${i.hiClosed ? ']' : ')'}`).join(' U ') : 'the empty set';

/** The rows of a typed system: separated by ";" or line breaks. */
export function systemRows(input: string): string[] {
  return input.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
}

function eqHoldsScope(eq: string, scope: Record<string, number>): boolean {
  const sides = splitEquation(eq);
  if (!sides) return false;
  const L = evalReal(normalize(sides[0]!), scope);
  const R = evalReal(normalize(sides[1]!), scope);
  return Number.isFinite(L) && Number.isFinite(R) && Math.abs(L - R) <= 1e-6 * (1 + Math.abs(L) + Math.abs(R));
}

function judgeSystem(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'systemSolutions' }>): Verdict {
  const eqs = systemRows(srcOf(item));
  if (a.type === 'none') return wrong('says no solution; the system has solutions', 'expected solutions hold');
  if (a.type === 'parametric') return wrong('a parametric family for a system with isolated solutions', 'answer grammar');
  if (a.type !== 'solutions') return wrongType(a, 'solution tuples');
  const got: Array<Record<string, number>> = [];
  for (const sol of a.solutions) {
    const scope: Record<string, number> = {};
    for (const [k, val] of Object.entries(sol)) scope[k] = realOf(str(val));
    if (Object.values(scope).some((x) => !Number.isFinite(x))) return wrong(`could not evaluate ${JSON.stringify(sol)}`, 'parse');
    if (!eqs.every((eq) => eqHoldsScope(eq, scope))) return wrong(`claimed solution fails: ${JSON.stringify(sol)}`, 'substituted in every equation');
    got.push(scope);
  }
  const want = truth.solutions.map((s) => Object.fromEntries(Object.entries(s).map(([k, val]) => [k, evalReal(normalize(val))])));
  const match = (x: Record<string, number>, y: Record<string, number>) => Object.keys(y).every((k) => x[k] !== undefined && close(x[k]!, y[k]!, 1e-6));
  const extra = got.filter((g) => !want.some((w) => match(g, w)));
  if (extra.length) return wrong(`solution(s) satisfy the system but are not in the verified set: ${JSON.stringify(extra)}`, 'substitution + set comparison');
  const missing = want.filter((w) => !got.some((g) => match(g, w)));
  if (missing.length) return incomplete(`missing solution(s): ${JSON.stringify(missing)}`, 'substitution + set comparison');
  return ok('substitution + set comparison');
}

function judgeSystemNone(a: SolveAnswer): Verdict {
  if (a.type === 'none') return ok('no-solution statement');
  if (a.type === 'solutions' || a.type === 'parametric') return wrong('claims solutions for an inconsistent system', 'known inconsistent');
  return wrongType(a, 'no solution');
}

function judgeUnderdetermined(item: SolveItem, a: SolveAnswer): Verdict {
  const eqs = systemRows(srcOf(item));
  if (a.type === 'none') return wrong('says no solution for a consistent system', 'known dependent system');
  if (a.type === 'solutions') return incomplete('infinitely many solutions expected; only particular solution(s) given', 'known dependent system');
  if (a.type !== 'parametric') return wrongType(a, 'a parametric solution');
  if (!a.free.length) return incomplete('no free variable named', 'known dependent system');
  const r = rng(3);
  for (let trial = 0; trial < 3; trial += 1) {
    const scope: Record<string, number> = {};
    for (const f of a.free) scope[f] = -2 + 4 * r();
    for (const val of Object.values(a.solution)) for (const sym of str(val).match(/\b[a-z]\b/g) ?? []) if (!(sym in scope) && !(sym in a.solution) && sym !== 'e') scope[sym] = -2 + 4 * r();
    for (const [k, val] of Object.entries(a.solution)) if (!a.free.includes(k)) scope[k] = evalReal(normalize(str(val)), scope);
    if (!eqs.every((eq) => eqHoldsScope(eq, scope))) return wrong(`parametric solution fails at ${JSON.stringify(scope)}`, 'random values of the free variable');
  }
  return ok('random values of the free variable');
}

const samplePoints = (range: [number, number], n = 9): number[] => Array.from({ length: n }, (_, i) => range[0] + ((i + 0.37) / n) * (range[1] - range[0]));

function exprOf(a: SolveAnswer): string | null {
  if (a.type === 'expression') return cleanExpression(a.expr);
  if (a.type === 'number') return cleanExpression(str(a.value));
  return null;
}

function judgeDerivative(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'derivative' }>): Verdict {
  if (a.type !== 'expression') return wrongType(a, 'an expression');
  const order = item.task.options?.order ?? 1;
  const variable = varOf(item.task);
  const exprText = cleanExpression(a.expr);
  let engine = fnOf(exprText, variable);
  const f = fnOf(srcOf(item), variable);
  const pts = samplePoints(truth.range ?? [-2.3, 2.3]);
  let valid = 0;
  const bad: string[] = [];
  const fallback = variable === 'x' ? engine : fnOf(exprText, 'x');
  for (const x of pts) {
    const want = nthDerivative(f, x, order);
    if (!Number.isFinite(want) || Math.abs(want) > 1e8) continue;
    let got = engine(x);
    if (!Number.isFinite(got)) got = fallback(x);
    if (!Number.isFinite(got)) {
      bad.push(`x=${x.toFixed(3)}: answer does not evaluate`);
      continue;
    }
    valid += 1;
    const tol = order <= 2 ? 1e-5 : 2e-3;
    if (!close(got, want, tol)) bad.push(`x=${x.toFixed(3)}: answer ${got}, finite differences ${want}`);
  }
  void engine;
  engine = fallback;
  if (valid < 4) return wrong(`could not evaluate the derivative expression: ${exprText}`, 'finite differences');
  if (bad.length) return wrong(bad.slice(0, 3).join('; '), `5-point finite differences of f (order ${order}) at ${pts.length} points`);
  if (truth.at !== undefined) {
    const given = a.at === undefined ? undefined : str(a.at).trim();
    if (truth.at === 'undefined') {
      if (given !== undefined && /^(undefined|dne|does not exist|not differentiable|no existe)/i.test(given)) return ok('derivative at a non-differentiable point reported as such');
      return given === undefined ? incomplete('expected "undefined" at the point; no value given', 'value at the point') : wrong(`expected "undefined" at the point; got ${given}`, 'value at the point');
    }
    if (given === undefined) return incomplete(`no value given at the point (expected ${truth.at})`, 'value at the point');
    const val = realOf(given);
    if (!Number.isFinite(val) || !sameValue(given, truth.at, 1e-8)) return wrong(`value at the point: ${given}; expected ${truth.at}`, 'exact value at the point');
  }
  return ok(`5-point finite differences of f (order ${order}) at ${valid} points`);
}

function judgeImplicitDerivative(a: SolveAnswer, truth: Extract<Truth, { type: 'implicitDerivative' }>): Verdict {
  if (a.type !== 'expression') return wrongType(a, 'an expression in x and y');
  const expr = cleanExpression(a.expr);
  for (const [x, y] of truth.points) {
    const got = evalReal(normalize(expr), { x, y });
    const want = evalReal(normalize(truth.expr), { x, y });
    if (!Number.isFinite(got)) return wrong(`answer does not read as dy/dx in x and y: ${expr}`, 'evaluated at points on the curve');
    if (!close(got, want, 1e-6)) return wrong(`at (${x}, ${y}) got ${got}, expected ${want}`, 'evaluated at points on the curve');
  }
  return ok('evaluated dy/dx at points on the curve');
}

function judgeAntiderivative(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'antiderivative' }>): Verdict {
  if (a.type !== 'expression') return wrongType(a, 'an expression');
  const variable = varOf(item.task);
  const exprText = cleanExpression(a.expr, true);
  const F = fnOf(exprText, variable, { C: 0.37, C1: 0.37, c: 0.37 });
  const f = fnOf(srcOf(item), variable);
  const pts = samplePoints(truth.range ?? [-2.3, 2.3]);
  let valid = 0;
  const bad: string[] = [];
  for (const x of pts) {
    const want = f(x);
    if (!Number.isFinite(want)) continue;
    const got = nthDerivative(F, x, 1);
    if (!Number.isFinite(got)) continue;
    valid += 1;
    if (!close(got, want, 1e-5)) bad.push(`x=${x.toFixed(3)}: F' ${got}, f ${want}`);
  }
  if (valid < 4) return wrong(`could not evaluate the antiderivative expression: ${exprText}`, 'finite differences');
  if (bad.length) return wrong(bad.slice(0, 3).join('; '), "F' by 5-point differences vs f");
  return ok(`F' by 5-point differences vs f at ${valid} points`);
}

const NUMBER_TOL = (kind: string): number => (kind === 'complex' || kind === 'matrix' ? 1e-9 : kind === 'series' ? 1e-8 : 1e-7);

function scalarMatches(gotText: string, wantText: string, tol: number, scope: Record<string, number> = {}): boolean | null {
  const g = evalComplex(normalize(gotText), scope);
  const w = evalComplex(normalize(wantText), scope);
  if (!g) return null;
  if (!w) return false;
  if (!Number.isFinite(w.re) || !Number.isFinite(g.re)) return g.re === w.re && g.im === w.im;
  return Math.hypot(g.re - w.re, g.im - w.im) <= tol * (1 + Math.hypot(w.re, w.im));
}

function judgeNumber(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'number' }>): Verdict {
  if (a.type === 'diverges' || a.type === 'dne') return wrong(`says the value ${a.type === 'dne' ? 'does not exist' : 'diverges'}; expected ${truth.value}`, 'known value');
  if (a.type !== 'number') return wrongType(a, 'a number');
  const tol = NUMBER_TOL(item.task.kind);
  const symbolic = /[a-d]/.test(truth.value) && item.task.kind === 'matrix';
  const scope: Record<string, number> = symbolic ? { a: 1.3, b: 0.7, c: 2.1, d: -0.4 } : {};
  const got = str(a.value);
  const m = scalarMatches(got, truth.value, tol, scope);
  if (m === null) {
    // doubles may not be able to hold the value (1e400): compare in 64 digits
    return sameValue(got, truth.value, tol) ? ok('known value (64-digit comparison)') : wrong(`could not read "${got}" as a number`, 'parse');
  }
  return m ? ok('known value') : wrong(`got ${got}, expected ${truth.value}`, 'known value');
}

function judgeDiverges(a: SolveAnswer): Verdict {
  if (a.type === 'diverges' || a.type === 'dne') return ok('divergence statement');
  if (a.type === 'number') return wrong(`a divergent problem given a value: ${str(a.value)}`, 'known divergent');
  return wrongType(a, 'divergence');
}

function judgeDne(a: SolveAnswer): Verdict {
  if (a.type === 'dne') return ok('DNE statement');
  if (a.type === 'number') return wrong(`the limit does not exist; got ${str(a.value)}`, 'known DNE (one-sided limits differ / oscillation)');
  return wrongType(a, 'the limit does not exist');
}

const symbolsOf = (expr: string): string[] => {
  try {
    const node = math.parse(expr);
    const out = new Set<string>();
    node.traverse((n: any, _p: any, parent: any) => {
      if (n.isSymbolNode && !(parent && parent.isFunctionNode && parent.fn === n)) out.add(n.name);
    });
    return [...out].filter((s) => !['x', 'e', 'pi', 'i', 'Infinity'].includes(s));
  } catch {
    return [];
  }
};

function judgeOde(a: SolveAnswer, truth: Extract<Truth, { type: 'ode' }>): Verdict {
  const residual = (x: number, y: number, y1: number, y2: number) => evalReal(normalize(truth.residual), { x, y, y1, y2 });
  if (a.type === 'implicit') {
    if (!truth.rhs) return incomplete('implicit solutions are only checked for first-order equations', 'G_x + G_y*f = 0');
    const G = normalize(cleanExpression(a.expr).replace(/=\s*C\d*\s*$/, ''));
    const h = 1e-5;
    for (const [x, y] of [[0.3, 0.7], [1.1, 0.2], [0.8, 1.5], [-0.5, 0.4]] as Array<[number, number]>) {
      const gx = (evalReal(G, { x: x + h, y }) - evalReal(G, { x: x - h, y })) / (2 * h);
      const gy = (evalReal(G, { x, y: y + h }) - evalReal(G, { x, y: y - h })) / (2 * h);
      const d = gx + gy * evalReal(normalize(truth.rhs), { x, y });
      if (!Number.isFinite(d) || Math.abs(d) > 1e-5 * (1 + Math.abs(gx) + Math.abs(gy))) return wrong(`implicit solution is not invariant: dG/dx = ${d} at (${x}, ${y})`, 'G_x + G_y*f = 0');
    }
    return ok('G_x + G_y*f = 0 at 4 points (implicit solution)');
  }
  if (a.type !== 'expression') return wrongType(a, 'y as an expression in x');
  const expr = normalize(cleanExpression(a.expr));
  const consts = symbolsOf(expr);
  const r = rng(11);
  const range = truth.range ?? [0.2, 1.8];
  for (let trial = 0; trial < 2; trial += 1) {
    const scope: Record<string, number> = {};
    for (const c of consts) scope[c] = 0.3 + 1.5 * r();
    const y = (x: number) => evalReal(expr, { ...scope, x });
    let valid = 0;
    for (const x of samplePoints(range, 7)) {
      const yy = y(x);
      const y1 = nthDerivative(y, x, 1);
      const y2 = truth.order >= 2 ? nthDerivative(y, x, 2) : 0;
      if (![yy, y1, y2].every(Number.isFinite)) continue;
      valid += 1;
      const res = residual(x, yy, y1, y2);
      const scale = 1 + Math.abs(yy) + Math.abs(y1) + Math.abs(y2);
      if (!(Math.abs(res) <= 1e-5 * scale)) return wrong(`residual ${res} at x=${x.toFixed(3)} with ${JSON.stringify(scope)}`, 'substituted y (finite-difference derivatives) into the ODE');
    }
    if (valid < 4) return wrong(`could not evaluate: ${cleanExpression(a.expr)}`, 'substitution');
  }
  if (truth.exact) {
    const want = fnOf(truth.exact);
    const got = (x: number) => evalReal(expr, { x });
    for (const x of samplePoints([-1, 1.5], 6)) {
      if (!close(got(x), want(x), 1e-7)) return wrong(`the initial-value solution differs from ${truth.exact} at x=${x.toFixed(3)}`, 'compared to the known initial-value solution');
    }
  } else if (consts.length < truth.order) {
    return incomplete(`general solution has ${consts.length} constant(s), order ${truth.order}`, 'constant count');
  }
  return ok('ODE residual with random constants' + (truth.exact ? ' + known initial-value solution' : ''));
}

const isMatrixRows = (rows: Scalar[][]) => Array.isArray(rows) && rows.every((r) => Array.isArray(r));

function judgeMatrix(a: SolveAnswer, truth: Extract<Truth, { type: 'matrix' }>): Verdict {
  if (a.type === 'singular') return wrong('says the matrix is singular; it has an inverse', 'hand-computed matrix');
  if (a.type !== 'matrix' || !isMatrixRows(a.rows)) return wrongType(a, 'a matrix');
  const got = a.rows.map((r) => r.map((c) => realOf(str(c))));
  if (got.some((r) => r.some((c) => !Number.isFinite(c)))) return wrong('could not read the matrix entries', 'parse');
  const want = truth.rows.map((r) => r.map((c) => evalReal(normalize(c))));
  const same = got.length === want.length && got.every((r, i) => r.length === want[i]!.length && r.every((c, j) => close(c, want[i]![j]!, 1e-9)));
  return same ? ok('hand-computed matrix') : wrong(`got ${JSON.stringify(got)}`, 'hand-computed matrix');
}

function judgeEigen(a: SolveAnswer, truth: Extract<Truth, { type: 'eigenvalues' }>): Verdict {
  if (a.type !== 'values') return wrongType(a, 'eigenvalues');
  const vals = (a.values ?? []).map((g) => complexOf(str(g)));
  if (vals.some((v) => !v)) return wrong('could not read an eigenvalue', 'parse');
  const got = vals as Array<{ re: number; im: number }>;
  if (!got.length) return incomplete('no eigenvalues given', 'hand-computed characteristic polynomial');
  const want = truth.values.map((w) => evalComplex(normalize(w))!);
  const extra = got.filter((g) => !want.some((w) => Math.hypot(g.re - w.re, g.im - w.im) < 1e-8));
  const missing = want.filter((w) => !got.some((g) => Math.hypot(g.re - w.re, g.im - w.im) < 1e-8));
  if (extra.length) return wrong(`wrong eigenvalue(s): ${JSON.stringify(extra)}`, 'hand-computed characteristic polynomial');
  if (missing.length) return incomplete(`missing eigenvalue(s): ${JSON.stringify(missing)}`, 'hand-computed characteristic polynomial');
  return ok('hand-computed characteristic polynomial');
}

function judgeVector(a: SolveAnswer, truth: Extract<Truth, { type: 'vector' }>): Verdict {
  const want = truth.values.map((w) => evalReal(normalize(w)));
  let nums: number[] | null = null;
  if (a.type === 'vector') nums = a.values.map((v) => realOf(str(v)));
  else if (a.type === 'matrix' && isMatrixRows(a.rows)) nums = a.rows.flat().map((v) => realOf(str(v)));
  else if (a.type === 'solutions' && a.solutions.length === 1) nums = Object.values(a.solutions[0]!).map((v) => realOf(str(v)));
  if (!nums) return a.type === 'none' ? wrong('says there is no solution', 'hand-solved') : wrongType(a, 'a vector');
  if (nums.length === want.length && want.every((w, i) => close(nums![i]!, w, 1e-9))) return ok('hand-solved');
  return wrong(`got ${JSON.stringify(nums)}`, 'hand-solved');
}

function judgeClosedForm(a: SolveAnswer, truth: Extract<Truth, { type: 'closedForm' }>): Verdict {
  if (a.type === 'number') return incomplete('a number where a closed form in the summation limit was expected', 'sample n');
  if (a.type !== 'expression') return wrongType(a, 'an expression');
  const expr = normalize(cleanExpression(a.expr));
  for (const [n, w] of truth.samples) {
    const got = evalReal(expr, { [truth.variable]: n });
    if (!Number.isFinite(got)) return wrong(`could not evaluate the closed form: ${a.expr}`, 'parse');
    if (!close(got, evalReal(normalize(w)), 1e-9)) return wrong(`the closed form at ${truth.variable}=${n} gives ${got}, expected ${w}`, 'sample n');
  }
  return ok('closed form sampled at the verified values');
}

function judgePolynomial(a: SolveAnswer, truth: Extract<Truth, { type: 'polynomial' }>): Verdict {
  if (a.type !== 'expression') return wrongType(a, 'a polynomial expression');
  const expr = normalize(cleanExpression(a.expr));
  for (const x of [0.1, 0.3, -0.4, 0.7]) {
    const got = evalReal(expr, { x });
    const want = evalReal(normalize(truth.expr), { x });
    if (!Number.isFinite(got)) return wrong(`could not evaluate: ${a.expr}`, 'parse');
    if (!close(got, want, 1e-9)) return wrong(`the polynomial differs from the known one at x=${x}`, 'compared to the known polynomial');
  }
  return ok('compared to the known polynomial at 4 points');
}

/** Canonical text for the textbook-form check: no spaces, `*` and `×` unified, `**` as `^`. */
export function canonicalText(text: string): string {
  return text.replace(/[·×⋅]/g, '*').replace(/[−–]/g, '-').replace(/\*\*/g, '^').replace(/\s+/g, '');
}

function judgeEquivalent(item: SolveItem, a: SolveAnswer, truth: Extract<Truth, { type: 'equivalent' }>): Verdict {
  if (a.type !== 'expression') return wrongType(a, 'an expression');
  const first = cleanExpression(a.expr);
  const got = normalize(first);
  const range = truth.range ?? [0.3, 2.7];
  let valid = 0;
  for (const x of samplePoints(range, 7)) {
    const scope = { x, y: x * 1.7 + 0.4 };
    const e = evalReal(got, scope);
    const input = evalReal(normalize(srcOf(item)), scope);
    if (!Number.isFinite(input)) continue;
    if (!Number.isFinite(e)) return wrong(`could not evaluate: ${first}`, 'parse');
    valid += 1;
    if (!close(e, input, 1e-9)) return wrong(`not equivalent at x=${x}: ${first}`, 'numeric equivalence');
  }
  if (valid < 3) return wrong('too few points to compare (data problem)', '');
  const canon = canonicalText(first);
  if (truth.requireChange && canon === canonicalText(srcOf(item))) return incomplete('the answer is the input unchanged', 'numeric equivalence + change');
  if (truth.forms && !truth.forms.some((f) => new RegExp(f).test(canon))) return incomplete(`equivalent but not in the requested form: ${first}`, 'numeric equivalence + form');
  return ok('numeric equivalence at 7 points' + (truth.forms ? ' + form' : ''));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Judge one answer. Never throws. */
export function judgeSolve(item: SolveItem, answer: SolveAnswer | null | undefined): Verdict {
  if (!answer || typeof answer !== 'object' || typeof (answer as { type?: unknown }).type !== 'string') return refused('no answer');
  if (answer.type === 'refused') return refused(answer.reason ?? '');
  try {
    return judgeInner(item, answer);
  } catch (e) {
    return wrong(`judge could not read the answer: ${(e as Error).message}`, 'parse');
  }
}

function judgeInner(item: SolveItem, a: SolveAnswer): Verdict {
  const t = item.truth;
  switch (t.type) {
    case 'roots': return judgeRoots(item, a, t);
    case 'complexRoots': return judgeComplexRoots(item, a, t);
    case 'none': return item.task.kind === 'system' ? judgeSystemNone(a) : judgeNone(item, a);
    case 'identity': return judgeIdentity(item, a, t);
    case 'solutionSet': return judgeSolutionSet(item, a);
    case 'symbolicRoots': return judgeSymbolic(item, a, t);
    case 'trig': return judgeTrig(item, a, t);
    case 'inequality': return judgeInequality(item, a, t);
    case 'systemSolutions': return judgeSystem(item, a, t);
    case 'underdetermined': return judgeUnderdetermined(item, a);
    case 'derivative': return judgeDerivative(item, a, t);
    case 'implicitDerivative': return judgeImplicitDerivative(a, t);
    case 'antiderivative': return judgeAntiderivative(item, a, t);
    case 'number': return judgeNumber(item, a, t);
    case 'diverges': return judgeDiverges(a);
    case 'dne': return judgeDne(a);
    case 'ode': return judgeOde(a, t);
    case 'matrix': return judgeMatrix(a, t);
    case 'eigenvalues': return judgeEigen(a, t);
    case 'singular': return a.type === 'singular' ? ok('singular statement') : a.type === 'matrix' ? wrong('returns an inverse of a singular matrix', 'det = 0') : wrongType(a, 'singular');
    case 'undefined': return a.type === 'undefined' ? ok('operation reported as undefined') : a.type === 'matrix' ? wrong('returns a product of incompatible shapes', 'known: a 2x3 times a 2x2 is undefined') : wrongType(a, 'undefined');
    case 'vector': return judgeVector(a, t);
    case 'closedForm': return judgeClosedForm(a, t);
    case 'polynomial': return judgePolynomial(a, t);
    case 'equivalent': return judgeEquivalent(item, a, t);
    default: return wrong(`no judge for ${(t as { type: string }).type}`, '');
  }
}

export { bigValue };
