import type { CurveSpec } from './truth.js';

/**
 * Helpers available to the truth functions stored in `data/graph/*.json`.
 * The functions are arrow-function sources over plain `Math.*` plus the names below.
 */
const PI = Math.PI;

function gamma(z: number): number {
  // Lanczos (g = 7), reflection for z < 0.5; poles at non-positive integers.
  if (z < 0.5) {
    const s = Math.sin(PI * z);
    return s === 0 ? Number.NaN : PI / (s * gamma(1 - z));
  }
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let a = c[0]!;
  const t = z + g + 0.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  return Math.sqrt(2 * PI) * t ** (z + 0.5) * Math.exp(-t) * a;
}

type F1 = (x: number) => number;
type F2 = (x: number, y: number) => boolean;

export const HELPERS: Record<string, unknown> = {
  PI,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  ln: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sec: (x: number) => 1 / Math.cos(x),
  csc: (x: number) => 1 / Math.sin(x),
  cot: (x: number) => Math.cos(x) / Math.sin(x),
  mod: (x: number, m: number) => x - m * Math.floor(x / m),
  /** Real rational power p/q (q odd): the real q-th root of x, raised to p. */
  rpow: (x: number, p: number, q: number) => {
    const m = Math.pow(Math.abs(x), p / q);
    if (x >= 0) return m;
    return p % 2 === 0 ? m : -m;
  },
  gamma,
  /** f(x), but NaN where the predicate ok(x, f(x)) is false. */
  restrict: (f: F1, ok: F2): F1 => (x) => {
    const y = f(x);
    return ok(x, y) ? y : Number.NaN;
  },
};

const NAMES = Object.keys(HELPERS);
const VALUES = NAMES.map((n) => HELPERS[n]);
const cache = new Map<string, unknown>();

function build<T>(src: string): T {
  const hit = cache.get(src);
  if (hit) return hit as T;
  // eslint-disable-next-line no-new-func
  const fn = new Function(...NAMES, `"use strict"; return (${src});`)(...VALUES) as T;
  cache.set(src, fn);
  return fn;
}

/** `(x) => number` from a source string. Data files are trusted code: never load a data file you did not read. */
export const compile1 = (src: string): ((x: number) => number) => build(src);
/** `(x, y) => number` from a source string. */
export const compile2 = (src: string): ((x: number, y: number) => number) => build(src);

export interface ParamCurve {
  p: (t: number) => [number, number];
  t0: number;
  t1: number;
  base?: number;
}

export const compileCurve = (c: CurveSpec): ParamCurve => ({ p: build<(t: number) => [number, number]>(c.p), t0: c.t0, t1: c.t1, base: c.base });
