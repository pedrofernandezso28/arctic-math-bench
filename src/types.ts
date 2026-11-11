/**
 * Public types of arctic-math-bench: tasks, the neutral answer grammar, verdicts and adapters.
 *
 * Expressions are plain-text math: `^` for powers, implicit multiplication (`2x`, `3(x+1)`), the functions
 * sin cos tan sec csc cot asin acos atan sinh cosh tanh sqrt cbrt abs exp ln log, `log(x)` is base 10,
 * `log(x, b)` is base b, `ln` is natural, constants `pi` and `e`, the imaginary unit `i`, and `Infinity`.
 */

// ─── Solve: tasks ────────────────────────────────────────────────────────────

export type SolveKind =
  | 'equation'
  | 'inequality'
  | 'system'
  | 'derivative'
  | 'implicit-derivative'
  | 'antiderivative'
  | 'definite-integral'
  | 'limit'
  | 'ode'
  | 'matrix'
  | 'complex'
  | 'series'
  | 'simplify'
  | 'factor'
  | 'expand'
  | 'partial-fractions';

export interface SolveOptions {
  /** Unknown / variable of the problem when it is not `x`. */
  variable?: string;
  /** Angle unit used by trigonometric functions: radians unless `deg`. */
  angleUnit?: 'rad' | 'deg';
  /** `complex`: look for solutions in the complex numbers. */
  domain?: 'complex';
  /** Derivative order when it is not 1. */
  order?: number;
  /** Point at which the derivative must also be evaluated. */
  at?: string;
  /** Integration bounds of a definite integral ("0", "pi", "Infinity", "-Infinity", "∞"). */
  lower?: string;
  upper?: string;
  /** Limit point and side. */
  point?: string;
  side?: 'left' | 'right';
  /** Matrix operation: det, inverse, eigen, rank, solve, multiply, transpose. */
  operation?: string;
  /** Second matrix (multiply) or right-hand side vector (solve). */
  secondMatrix?: string;
  constants?: string;
}

export interface SolveTask {
  /** Stable id of the item. */
  id: string;
  kind: SolveKind;
  /** The problem exactly as a student types it. */
  input: string;
  options?: SolveOptions;
}

// ─── Solve: the neutral answer grammar ───────────────────────────────────────

/** An interval endpoint: a number or an expression ("sqrt(2)", "Infinity", "-Infinity", "e^2"). */
export type Bound = string | number;

export interface Interval {
  lo: Bound;
  hi: Bound;
  /** Default false: the endpoint is excluded. Infinite endpoints are always excluded. */
  loClosed?: boolean;
  hiClosed?: boolean;
}

export type Scalar = string | number;

export type SolveAnswer =
  /** The engine declines to answer. Counts as REFUSED. */
  | { type: 'refused'; reason?: string }
  /** No solution (empty solution set, inconsistent system). */
  | { type: 'none' }
  /** Every value is a solution (identity), optionally except some points. */
  | { type: 'all'; except?: Scalar[] }
  /** The operation is undefined for the input (for example a matrix product with incompatible shapes). */
  | { type: 'undefined' }
  /** The matrix is not invertible. */
  | { type: 'singular' }
  /** The limit does not exist. */
  | { type: 'dne' }
  /** The integral, series or sequence diverges. */
  | { type: 'diverges' }
  /** Isolated solutions (roots, complex roots, eigenvalues) and/or general-solution families in the integer parameter `k`. */
  | { type: 'values'; values?: Scalar[]; families?: string[] }
  /** A solution set written as intervals (a point is a closed interval with lo = hi). */
  | { type: 'intervals'; intervals: Interval[] }
  /** An expression in the task variable (derivative, antiderivative, simplified form, ODE general solution y(x)...). */
  | { type: 'expression'; expr: string; at?: Scalar }
  /** An implicit relation G(x, y) = C given by G (ODE solutions that cannot be isolated). */
  | { type: 'implicit'; expr: string }
  /** A scalar: number, exact expression, complex number (`2+3i`), `Infinity` or `-Infinity`. */
  | { type: 'number'; value: Scalar }
  | { type: 'matrix'; rows: Scalar[][] }
  | { type: 'vector'; values: Scalar[] }
  /** Solution tuples of a system: one object per solution, keyed by variable name. */
  | { type: 'solutions'; solutions: Array<Record<string, Scalar>> }
  /** A system with infinitely many solutions: `free` lists the free variables, `solution` gives the others in terms of them. */
  | { type: 'parametric'; free: string[]; solution: Record<string, Scalar> };

export type SolveClass = 'CORRECT' | 'WRONG' | 'INCOMPLETE' | 'REFUSED';

export interface Verdict {
  class: SolveClass;
  /** Short reason when the class is not CORRECT (always present, empty for CORRECT). */
  why: string;
  /** How the answer was checked. */
  how: string;
}

export interface SolveAdapter {
  name?: string;
  /** Solve one task. Throwing or returning `{ type: 'refused' }` counts as REFUSED. */
  solve(task: SolveTask): SolveAnswer | Promise<SolveAnswer>;
}

// ─── Graph ───────────────────────────────────────────────────────────────────

export type Pt = [number, number];

export interface GraphTask {
  id: string;
  /** The rows exactly as a student types them, one string per row (several rows share one plane). */
  rows: string[];
  /** World window [xMin, xMax, yMin, yMax] to draw. */
  window: [number, number, number, number];
  /** Canvas size in pixels; the window maps linearly onto it (y up in the world, down on the canvas). */
  canvas: { width: number; height: number };
  /** Values of free parameters (sliders). Parameters not listed here default to 1. */
  params?: Record<string, number>;
  /** Range of the angle / parameter of polar and parametric rows without their own range. Default [0, 2*pi]. */
  parameterDomain?: { min: number; max: number };
  /**
   * If present, the engine should also report points of interest.
   * `row >= 0`: roots, local maxima, local minima and the y-intercept of that row's curve.
   * `row = -1`: intersections between the curves of all rows.
   */
  pointsOfInterest?: { row: number };
}

export interface Stroke {
  /** Index of the row this polyline belongs to (omit when unknown or single-row). */
  row?: number;
  points: Pt[];
}

export interface RegionPlot {
  row?: number;
  /** One polygon (closed ring, even-odd filling with the other polygons of the same row). */
  polygon: Pt[];
  /** True when the boundary is not part of the region (strict inequality). */
  strict?: boolean;
}

export type PointKind = 'root' | 'maximum' | 'minimum' | 'yIntercept' | 'intersection' | 'point';

export interface PlotPoint {
  x: number;
  y: number;
  /** Default 'point' (a plotted dot). */
  kind?: PointKind;
  row?: number;
  label?: string;
}

export interface PlotResult {
  /** Polylines in world coordinates. A bare array of points is accepted in place of a Stroke. */
  strokes: Array<Pt[] | Stroke>;
  regions?: RegionPlot[];
  /** Plotted dots (kind 'point') and, if asked, points of interest. */
  points?: PlotPoint[];
  /** Names of the free parameters (sliders) the engine detected in the rows. */
  parameters?: string[];
  /** Row index (as a string) to message: the engine rejected that row. */
  errors?: Record<string, string>;
}

export interface GraphAdapter {
  name?: string;
  plot(task: GraphTask): PlotResult | Promise<PlotResult>;
}

export type GraphClass = 'CORRECT' | 'WRONG' | 'MISSING' | 'ROUGH' | 'REFUSED';

export interface GraphVerdict {
  class: GraphClass;
  reasons: string[];
  /** Class if the points-of-interest part is ignored (only the drawing is judged). */
  drawingClass: GraphClass;
  metrics?: Record<string, number | string | null>;
}
