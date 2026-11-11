/**
 * Numeric helpers of the solve judges. Nothing here trusts the engine under test: answers are read as
 * plain-math text, normalised to mathjs syntax and checked numerically against the ORIGINAL problem.
 * Convention: log(u) is base 10, log(u, b) is base b, ln(u) is natural.
 */
import { create, all, type MathJsInstance } from 'mathjs';

export const math: MathJsInstance = create(all as any, {});
const nativeLog = math.log;
math.import(
  {
    ln: (x: any) => nativeLog(x),
    log: (x: any, b?: any) => (b === undefined ? math.divide(nativeLog(x), Math.LN10) : math.divide(nativeLog(x), nativeLog(b))),
    logbase: (b: any, x: any) => math.divide(nativeLog(x), nativeLog(b)),
    arcsin: (x: any) => math.asin(x),
    arccos: (x: any) => math.acos(x),
    arctan: (x: any) => math.atan(x),
    // Real odd roots, as a student reads cbrt(-8) = -2.
    cbrt: (x: any) => (typeof x === 'number' ? Math.cbrt(x) : math.pow(x, 1 / 3)),
    // a^(p/q) with q odd is the real q-th root of a, raised to p (textbook convention), so (-8)^(2/3) = 4.
    rpow: (b: any, p: number, q: number) => (typeof b === 'number' ? Math.pow(Math.sign(b) * Math.pow(Math.abs(b), 1 / q), p) : math.pow(b, p / q)),
    // erfi(x) = 2/sqrt(pi) * sum x^(2n+1) / (n! (2n+1)), converges for every x; |x| < 4 here.
    erfi: (x: number) => {
      let term = x;
      let s = x;
      for (let n = 1; n < 200; n += 1) {
        term *= (x * x) / n;
        s += term / (2 * n + 1);
      }
      return (2 / Math.sqrt(Math.PI)) * s;
    },
  },
  { override: true },
);

const FUNCS = new Set([
  'rpow', 'erfi', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'atan2', 'asec', 'acsc', 'acot', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'log', 'ln', 'logbase', 'sqrt', 'cbrt', 'abs', 'exp', 'sign', 'erf', 'gamma', 'floor', 'ceil', 'nthRoot', 'arcsin',
  'arccos', 'arctan', 'factorial', 're', 'im', 'conj', 'arg',
]);

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n' };
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

function bars(text: string): string {
  // |u| becomes abs(u). A bar opens after start / operator / "(" and closes otherwise.
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c !== '|') {
      out += c;
      continue;
    }
    const prev = out.replace(/\s+$/, '').slice(-1);
    const opens = depth === 0 || prev === '' || /[+\-*/^(,=<>]/.test(prev);
    if (opens) {
      out += 'abs(';
      depth += 1;
    } else {
      out += ')';
      depth -= 1;
    }
  }
  return out;
}

/** Plain-math text (also tolerating common typographic symbols) to mathjs syntax. Throws nothing; parse errors happen at evaluation. */
export function normalize(raw: string, opts: { deg?: boolean } = {}): string {
  let s = raw;
  s = s.replace(/[−–]/g, '-').replace(/[·×⋅]/g, '*').replace(/÷/g, '/');
  s = s.replace(/∞/g, 'Infinity');
  s = s.replace(/arcsin/g, 'asin').replace(/arccos/g, 'acos').replace(/arctan/g, 'atan');
  s = s.replace(/log([₀-₉]+)\s*\(/g, (_m, d: string) => `logbase(${[...d].map((c) => SUB[c]).join('')}, `);
  s = s.replace(/log_\{?(\d+)\}?\s*\(/g, (_m, d: string) => `logbase(${d}, `);
  s = s.replace(/[₀-₉]/g, (c) => SUB[c]!);
  s = s.replace(/(ln|log)\s*\|([^|]+)\|/g, '$1(abs($2))');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿ]+/g, (m) => `^(${[...m].map((c) => SUP[c]).join('')})`);
  s = s.replace(/([A-Za-z0-9)])\s*(?=[√∛])/g, '$1*');
  s = s.replace(/(?<![A-Za-z])([A-Z][0-9]?)e\^/g, '$1*e^');
  s = s.replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([A-Za-z0-9.]+)/g, 'sqrt($1)');
  s = s.replace(/∛\s*\(/g, 'cbrt(').replace(/∛\s*([A-Za-z0-9.]+)/g, 'cbrt($1)');
  s = s.replace(/π/g, ' pi ');
  s = s.replace(/°/g, opts.deg ? '' : ' * pi / 180');
  if (s.includes('|')) s = bars(s);
  // Juxtaposed letters are products (2xy becomes 2x*y); a capital constant glued to a letter too (Cx^2 becomes C*x^2). Function names are kept.
  s = s.replace(/(?<![A-Za-z_])([xyzabcdkmnstuv]{2,3})(?![A-Za-z0-9_(])/g, (m) => (FUNCS.has(m) || m === 'pi' ? m : [...m].join('*')));
  s = s.replace(/(?<![A-Za-z])([A-Z][0-9]?)(?=[a-z(])(?!nfinity)/g, '$1*');
  // f(...) with an unknown name is a product: x(x+1) becomes x*(x+1). Known functions stay.
  s = s.replace(/\b([A-Za-z_][A-Za-z_0-9]*)\s*\(/g, (_m, name: string) => (FUNCS.has(name) ? `${name}(` : `${name}*(`));
  s = s.replace(/\)\s*\(/g, ')*(');
  s = s.replace(/(\d)\s*\(/g, '$1*(');
  s = s.replace(/\)\s*([A-Za-z0-9])/g, ')*$1');
  s = realRationalPowers(s);
  return s.trim();
}

/** a^(p/q) with literal integers p, q and q odd becomes rpow(a, p, q) (real q-th root). Base = the (...) group with its function name, or the identifier / number before the caret. */
function realRationalPowers(input: string): string {
  let s = input;
  const re = /\^\(\s*(-?\d+)\s*\/\s*(\d+)\s*\)/g;
  for (let guard = 0; guard < 50; guard += 1) {
    let hit: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s))) if (Number(m[2]) % 2 === 1 && Number(m[2]) >= 3) hit = m;
    if (!hit) break;
    const idx = hit.index;
    let i = idx - 1;
    while (i >= 0 && s[i] === ' ') i -= 1;
    let start: number;
    if (s[i] === ')') {
      let depth = 0;
      let j = i;
      for (; j >= 0; j -= 1) {
        if (s[j] === ')') depth += 1;
        else if (s[j] === '(') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      start = j;
      while (start > 0 && /[A-Za-z_0-9]/.test(s[start - 1]!)) start -= 1;
    } else {
      start = i + 1;
      const run = /[0-9.]/.test(s[i]!) ? /[0-9.]/ : /[A-Za-z_]/; // 3x^(2/3) is 3*(x^(2/3)): the base is only the trailing number or name
      while (start > 0 && run.test(s[start - 1]!)) start -= 1;
    }
    if (start < 0 || start > i) break;
    const base = s.slice(start, i + 1);
    s = s.slice(0, start) + 'rpow(' + base + ', ' + hit[1] + ', ' + hit[2] + ')' + s.slice(idx + hit[0].length);
  }
  return s;
}

export type Scope = Record<string, unknown>;

const degScope = {
  sin: (x: number) => Math.sin((x * Math.PI) / 180),
  cos: (x: number) => Math.cos((x * Math.PI) / 180),
  tan: (x: number) => Math.tan((x * Math.PI) / 180),
};

/** Numeric value (real or complex) of a normalized expression; null when it does not evaluate. */
export function evalAny(expr: string, scope: Scope = {}, opts: { deg?: boolean } = {}): any {
  try {
    const v = math.evaluate(expr, { ...(opts.deg ? degScope : {}), ...scope });
    if (typeof v === 'number' || (v && typeof v === 'object' && 're' in v)) return v;
    if (typeof v === 'boolean') return v;
    if (v && typeof v.toNumber === 'function') return v.toNumber();
    return null;
  } catch {
    return null;
  }
}

/** Real value or NaN (complex with |im| > tol counts as not real). */
export function evalReal(expr: string, scope: Scope = {}, opts: { deg?: boolean } = {}): number {
  const v = evalAny(expr, scope, opts);
  if (v === null || typeof v === 'boolean') return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 're' in v) {
    if (Math.abs(v.im) <= 1e-9 * (1 + Math.abs(v.re))) return v.re;
    return NaN;
  }
  return NaN;
}

export function evalComplex(expr: string, scope: Scope = {}): { re: number; im: number } | null {
  const v = evalAny(expr, scope);
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : { re: v, im: 0 };
  if (typeof v === 'object' && 're' in v) return { re: v.re, im: v.im };
  return null;
}

/** Real value of an answer scalar (number or expression text), NaN when unreadable. */
export const realOf = (v: string | number, scope: Scope = {}, opts: { deg?: boolean } = {}): number => (typeof v === 'number' ? v : evalReal(normalize(v, opts), scope, opts));
export const complexOf = (v: string | number): { re: number; im: number } | null => (typeof v === 'number' ? (Number.isNaN(v) ? null : { re: v, im: 0 }) : evalComplex(normalize(v)));

export const close = (a: number, b: number, rel = 1e-6): boolean => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= rel * (1 + Math.abs(a) + Math.abs(b));
};

/** Split an equation "L = R" (ignores <=, >=). */
export function splitEquation(input: string): [string, string] | null {
  const parts = input.split(/(?<![<>!≤≥])=(?!=)/);
  if (parts.length !== 2) return null;
  return [parts[0]!, parts[1]!];
}

const bigMath: MathJsInstance = create(all as any, { number: 'BigNumber', precision: 64 });
const bigLn = bigMath.log;
bigMath.import(
  {
    ln: (x: any) => bigLn(x),
    log: (x: any, b?: any) => (b === undefined ? bigMath.log10(x) : bigMath.divide(bigLn(x), bigLn(b))),
    logbase: (b: any, x: any) => bigMath.divide(bigLn(x), bigLn(b)),
    rpow: (b: any, p: any, q: any) => bigMath.pow(b, bigMath.divide(p, q) as any),
    arcsin: (x: any) => bigMath.asin(x),
    arccos: (x: any) => bigMath.acos(x),
    arctan: (x: any) => bigMath.atan(x),
  },
  { override: true },
);

/** 64-digit evaluation of a plain-math text; null if it does not evaluate to a finite or infinite number. */
export function bigValue(text: string, scope: Record<string, unknown> = {}): any | null {
  try {
    const v = bigMath.evaluate(normalize(text), scope);
    return v && typeof v.isFinite === 'function' && !v.isNaN() ? v : null;
  } catch {
    return null;
  }
}

const LITERAL_INF = /^\s*[+-]?\s*(Infinity|∞|inf)\s*$/i;

/** Equality of two plain-math values; falls back to 64-digit arithmetic when doubles overflow (relative 1e-9). */
export function sameValue(a: string | number, b: string | number, rel = 1e-9): boolean {
  const x = realOf(a);
  const y = realOf(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return close(x, y, rel);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  const literal = (v: string | number) => typeof v === 'number' || LITERAL_INF.test(v);
  if (literal(a) && literal(b)) return x === y;
  // at least one side overflowed a double (for instance e^1000): compare in 64 digits
  const bx = bigValue(String(a));
  const by = bigValue(String(b));
  if (!bx || !by) return false;
  if (bx.eq(by)) return true;
  if (!bx.isFinite() || !by.isFinite()) return false;
  return bx.minus(by).abs().lte(bx.abs().plus(by.abs()).times(String(rel)));
}

function bigEquationHolds(l: string, r: string, variable: string, valueText: string): boolean {
  try {
    const v = bigMath.evaluate(normalize(valueText));
    const scope = { [variable]: v };
    const L = bigMath.evaluate(l, scope);
    const R = bigMath.evaluate(r, scope);
    if (!L?.isFinite?.() || !R?.isFinite?.()) return false;
    return L.minus(R).abs().lte(L.abs().plus(R.abs()).times('1e-6'));
  } catch {
    return false;
  }
}

/** Residual check of the original equation at a value: |L - R| relative. False when undefined or non-real. `valueText` enables the 64-digit fallback when doubles overflow. */
export function equationHolds(
  input: string,
  variable: string,
  value: number | { re: number; im: number },
  opts: { deg?: boolean; complex?: boolean; extra?: Scope; valueText?: string } = {},
): boolean {
  const sides = splitEquation(input);
  if (!sides) return false;
  const [l, r] = sides.map((side) => normalize(side, opts));
  const v = typeof value === 'number' ? value : math.complex(value.re, value.im);
  const scope = { [variable]: v, ...(opts.extra ?? {}) };
  if (opts.complex) {
    const L = evalComplex(l!, scope);
    const R = evalComplex(r!, scope);
    if (!L || !R) return false;
    const d = Math.hypot(L.re - R.re, L.im - R.im);
    return Number.isFinite(d) && d <= 1e-6 * (1 + Math.hypot(L.re, L.im) + Math.hypot(R.re, R.im));
  }
  const L = evalReal(l!, scope, opts);
  const R = evalReal(r!, scope, opts);
  if ((!Number.isFinite(L) || !Number.isFinite(R)) && opts.valueText !== undefined && !opts.deg && !opts.extra) {
    return bigEquationHolds(l!, r!, variable, opts.valueText);
  }
  if (!Number.isFinite(L) || !Number.isFinite(R)) return false;
  return Math.abs(L - R) <= 1e-6 * (1 + Math.abs(L) + Math.abs(R));
}

export function sameSet(got: number[], want: number[], rel = 1e-6): { missing: number[]; extra: number[] } {
  const missing = want.filter((w) => !got.some((g) => close(g, w, rel)));
  const extra = got.filter((g) => !want.some((w) => close(g, w, rel)));
  return { missing, extra };
}

// ─── Intervals ───────────────────────────────────────────────────────────────

export type Piece = { lo: number; hi: number; loIn: boolean; hiIn: boolean };

export const inPieces = (pieces: Piece[], x: number): boolean =>
  pieces.some((p) => (x > p.lo && x < p.hi) || (x === p.lo && p.loIn) || (x === p.hi && p.hiIn) || (p.lo === p.hi && Math.abs(x - p.lo) < 1e-12));

/** Chain of comparisons in 64 digits (Decimal compared directly; "equal" = relative 1e-40). null when BigNumber cannot evaluate it. */
function bigChain(texts: string[], ops: string[], variable: string, x: number): boolean | null {
  try {
    const vals = texts.map((t) => bigMath.evaluate(normalize(t), { [variable]: bigMath.bignumber(x) }));
    if (vals.some((v) => !v || typeof v.isFinite !== 'function' || v.isNaN())) return null;
    for (let i = 0; i < ops.length; i += 1) {
      const a = vals[i];
      const b = vals[i + 1];
      const eq = a.eq(b) || (a.isFinite() && b.isFinite() && a.minus(b).abs().lte(a.abs().plus(b.abs()).times('1e-40')));
      const op = ops[i];
      const ok = op === '<' ? a.lt(b) && !eq : op === '>' ? a.gt(b) && !eq : op === '<=' ? a.lt(b) || eq : op === '>=' ? a.gt(b) || eq : op === '!=' ? !eq : eq;
      if (!ok) return false;
    }
    return true;
  } catch {
    return null;
  }
}

/** Truth of the original inequality (chains allowed: 1 < 2x+3 <= 7). */
export function inequalityTruth(input: string, variable: string, x: number): boolean | null {
  const s = input.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=');
  const tokens = s.split(/(<=|>=|!=|<|>|=)/);
  if (tokens.length < 3) return null;
  const texts = tokens.filter((_, i) => i % 2 === 0);
  const sides = texts.map((t) => evalReal(normalize(t), { [variable]: x }));
  const ops = tokens.filter((_, i) => i % 2 === 1);
  // Far out, a double that overflowed (Infinity vs Infinity) says nothing about the order of the two sides: re-compare in 64 digits.
  if (Math.abs(x) >= 150 && sides.some((v) => !Number.isFinite(v))) {
    const big = bigChain(texts, ops, variable, x);
    if (big !== null) return big;
  }
  // Undefined at x (NaN, or an infinity from a division by zero / ln 0 at a finite point) is not a solution. Far out (|x| >= 150) an infinity is overflow, kept.
  if (sides.some((v) => Number.isNaN(v) || (!Number.isFinite(v) && Math.abs(x) < 150))) return false;
  for (let i = 0; i < ops.length; i += 1) {
    const a = sides[i]!;
    const b = sides[i + 1]!;
    const op = ops[i]!;
    const tol = 1e-13 * (1 + Math.abs(a) + Math.abs(b));
    const eq = a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol);
    const ok = op === '<' ? a < b && !eq : op === '>' ? a > b && !eq : op === '<=' ? a < b || eq : op === '>=' ? a > b || eq : op === '!=' ? !eq : eq;
    if (!ok) return false;
  }
  return true;
}

// ─── Calculus numerics ───────────────────────────────────────────────────────

export function fnOf(expr: string, variable = 'x', scope: Scope = {}): (x: number) => number {
  const norm = normalize(expr);
  let compiled: any;
  try {
    compiled = math.compile(norm);
  } catch {
    return () => NaN;
  }
  return (x: number) => {
    try {
      const v = compiled.evaluate({ ...scope, [variable]: x });
      if (typeof v === 'number') return v;
      if (v && typeof v === 'object' && 're' in v) return Math.abs(v.im) <= 1e-9 * (1 + Math.abs(v.re)) ? v.re : NaN;
      return NaN;
    } catch {
      return NaN;
    }
  };
}

const STENCIL: Record<number, { c: number[]; h: number }> = {
  1: { c: [1 / 12, -2 / 3, 0, 2 / 3, -1 / 12], h: 1e-3 },
  2: { c: [-1 / 12, 4 / 3, -5 / 2, 4 / 3, -1 / 12], h: 1e-3 },
  3: { c: [-1 / 2, 1, 0, -1, 1 / 2], h: 1e-2 },
  4: { c: [1, -4, 6, -4, 1], h: 2e-2 },
};

/** n-th derivative (n = 1..4) by a 5-point finite-difference stencil. */
export function nthDerivative(f: (x: number) => number, x: number, n: number): number {
  const st = STENCIL[n];
  if (!st) return NaN;
  const { c, h } = st;
  let sum = 0;
  for (let i = 0; i < 5; i += 1) sum += c[i]! * f(x + (i - 2) * h);
  return sum / h ** n;
}

/** Adaptive Simpson on [a, b] (finite). Used by the data audit, not by the judges. */
export function quad(f: (x: number) => number, a: number, b: number, eps = 1e-10): number {
  const simpson = (fa: number, fm: number, fb: number, a0: number, b0: number) => ((b0 - a0) / 6) * (fa + 4 * fm + fb);
  const rec = (a0: number, b0: number, fa: number, fm: number, fb: number, whole: number, e: number, depth: number): number => {
    const m = (a0 + b0) / 2;
    const lm = (a0 + m) / 2;
    const rm = (m + b0) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(fa, flm, fm, a0, m);
    const right = simpson(fm, frm, fb, m, b0);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * e) return left + right + (left + right - whole) / 15;
    return rec(a0, m, fa, flm, fm, left, e / 2, depth - 1) + rec(m, b0, fm, frm, fb, right, e / 2, depth - 1);
  };
  const aa = a + 1e-12 * (1 + Math.abs(a));
  const bb = b - 1e-12 * (1 + Math.abs(b));
  const fa = f(aa);
  const fb = f(bb);
  const fm = f((aa + bb) / 2);
  return rec(aa, bb, fa, fm, fb, simpson(fa, fm, fb, aa, bb), eps, 40);
}

/** Seeded RNG so runs are reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
