import type { GraphTask } from '../types.js';

/**
 * A parametric curve in world coordinates. `p` is the source of a JavaScript arrow function `(t) => [x, y]`
 * written with plain `Math.*` (and the small helper set listed in README, see `runtime.ts`).
 */
export interface CurveSpec {
  p: string;
  t0: number;
  t1: number;
  /** Initial number of parameter steps (default 4000). */
  base?: number;
}

/** World x intervals where the truth is not judged (an unresolvable smear such as sin(1/x) near 0). */
export type Ignore = Array<[number, number]>;

/** The drawing truth. Function sources are JavaScript arrow functions over plain `Math.*`. */
export type GraphTruth =
  | { type: 'fn'; f: string; ignore?: Ignore }
  | { type: 'fns'; fs: string[]; ignore?: Ignore }
  | { type: 'param'; curves: CurveSpec[]; ignore?: Ignore }
  | { type: 'implicit'; F: string; step?: number }
  | { type: 'region'; F: string; rel: '<' | '<=' | '>' | '>='; borderCurves?: CurveSpec[] }
  | { type: 'points'; points: Array<[number, number]> };

export interface PoiTruth {
  roots?: number[];
  max?: Array<[number, number]>;
  min?: Array<[number, number]>;
  /** y of the y-intercept; null means there is none (f(0) undefined). */
  yInt?: number | null;
  cross?: Array<[number, number]>;
  /** x values of points that may or may not be reported without penalty (corners, dense clusters, edge cases). */
  optional?: number[];
  /** Truth points closer than 0.5 % of the window width to a neighbour of the same kind are optional. */
  dense?: boolean;
}

export interface GraphItem {
  id: string;
  group: string;
  /** 1 = every student plots it, 2 = common in a course, 3 = occasional / stress case. */
  school: 1 | 2 | 3;
  task: Omit<GraphTask, 'id'>;
  /** Row whose layer is judged against `truth` (default 0). */
  judgeRow?: number;
  /** Judge the layers of all rows together against `truth` (systems / piecewise written as several rows). */
  judgeAll?: boolean;
  /** Free parameters (sliders) the engine must detect in the rows. */
  expectParams?: string[];
  truth?: GraphTruth;
  poi?: PoiTruth;
  note?: string;
}
