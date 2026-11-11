# Arctic Math Bench

An engine-agnostic benchmark for math solvers and graphing engines. It contains problems, ground truths, independent judges and a small adapter API. It contains no engine: you plug yours in.

- **Solve suite**: 1,119 problems typed the way a student types them (equations, inequalities, systems, derivatives, integrals, limits, ODEs, matrices, complex numbers, series, algebra), each with a hand-derived ground truth.
- **Graph suite**: 722 plotting cases (functions, implicit curves, inequalities, polar and parametric curves, restrictions, piecewise functions, sliders, own functions, points of interest) with analytic truths written in plain `Math.*`.
- Judges that **never trust the engine under test**: they substitute, sample, differentiate numerically and compare pixels against references they compute themselves.
- Results per item (`CORRECT`, `WRONG`, `INCOMPLETE`, `REFUSED`, plus `MISSING` and `ROUGH` for graphs), a summary table per category, JSON and Markdown reports.

The problems were extracted from the test batteries of a calculator application and rewritten so that nothing about that application, or any other engine, is needed to run them.

## The numbers

Solve suite (1,119 items):

| category | n | category | n | category | n |
|---|---:|---|---:|---|---:|
| absolute value | 23 | inequality | 90 | rational | 34 |
| algebra (simplify, factor, expand, partial fractions) | 34 | limit | 98 | series and sequences | 41 |
| antiderivative | 84 | linear | 31 | student-typed spellings | 66 |
| complex | 36 | logarithmic | 41 | system | 59 |
| definite and improper integral | 67 | matrix | 50 | trigonometric | 71 |
| derivative (incl. implicit) | 83 | ODE | 51 | |  |
| exponential | 39 | polynomial | 50 | quadratic / radical | 40 / 31 |

By task kind: equation 432, antiderivative 84, limit 98, inequality 92, derivative 74, definite integral 67, system 59, ODE 51, matrix 50, series 41, complex 29, implicit derivative 9, simplify 17, factor 11, partial fractions 3, expand 2. By school level: lower secondary 205, upper secondary 633, university 281.

Graph suite (722 items, 611 with a drawing truth, 111 that only ask for points of interest; 111 items in total have a points-of-interest truth):

| group | n | group | n | group | n |
|---|---:|---|---:|---|---:|
| fn-basic | 32 | implicit | 30 | typing | 52 |
| fn-domain | 25 | x=f(y) | 8 | typed-es | 44 |
| fn-asymptote | 18 | inequality | 42 | typed-format | 24 |
| fn-hole | 5 | polar | 37 | typed-glued | 23 |
| fn-jump | 11 | parametric | 34 | own-function | 23 |
| fn-highfreq | 11 | restriction | 10 | derivative | 8 |
| fn-steepflat | 8 | piecewise | 13 | sliders | 9 |
| fn-window | 1 | points / lists | 6 / 2 | poi (points of interest) | 67 |
| hard-window | 41 | lines / parabolas / cubics | 5 / 11 / 7 | poi-cross (intersections) | 28 |
| trig / abs | 14 / 11 | rationals / exp-log / conics | 12 / 16 / 18 | system | 16 |

School codes: 1 (every student plots it) 320, 2 (common in a course) 285, 3 (occasional or stress case) 117.

### What was dropped from the source batteries

- Solve: 1 item whose truth depends on a convention (`x^(2/3) = 4` over negative `x`), and 5 exact duplicates after the task kinds were unified.
- Graph: 19 three-dimensional cases (their judge depended on a mesh builder that is not part of this project), 10 items marked unsure, ambiguous (`1/2x`, `e^2x`, `sinx^2`, `e^x^2`) or relying on a guessed integral syntax or an engine-specific function name.

### Corrections applied to the data

Three graph items were wrong in the original batteries (the engine was right):

- `poi2.sys.circleEllipse` (`x^2+y^2=4` with `x^2/9+y^2/4=1`): the true contact points are (0, ±2), not (±2, 0).
- `poi2.sys.twoCircles`: two truth points share x = 1, so the judge now matches intersections by x **and** y and uses each reported point once.
- `ineq.chain` (`x^2<y<4`): the border of the region includes the top edge y = 4 for |x| <= 2.

## Quick start

```bash
git clone <this repository> && cd arctic-math-bench
npm ci            # installs, then builds dist/ (the "prepare" script)
npm test          # self-tests: 951 checks, several minutes (the graph judge is CPU bound)

# score an engine
node dist/cli.js solve --adapter ./my-solve-adapter.mjs
node dist/cli.js graph --adapter ./my-graph-adapter.mjs
# once published or linked:  npx arctic-math-bench solve --adapter ./my-adapter.js
```

Options: `--category a,b`, `--kind a,b`, `--level a,b`, `--id <regex>`, `--limit n`, `--timeout ms`, `--out dir`, `--format json|md|both`, `--answers`, `--quiet`. `arctic-math-bench list solve|graph` prints the item counts. Reports are written to `./bench-results/{solve,graph}.{json,md}`.

An adapter is a module whose default export (or named export `adapter`, or a factory function returning one) has a `solve(task)` method (solve suite) or a `plot(task)` method (graph suite). Both may be async.

```js
// my-solve-adapter.mjs
export default {
  name: 'my engine',
  async solve(task) {
    // task = { id, kind: 'equation', input: 'x^2 - 5x + 6 = 0', options?: { variable, angleUnit, ... } }
    const roots = await myEngine.solveEquation(task.input);   // your code
    return { type: 'values', values: roots.map(String) };      // neutral answer, see "Answer grammar"
  },
};
```

```js
// my-graph-adapter.mjs
export default {
  name: 'my plotter',
  async plot(task) {
    // task = { id, rows: ['y=x^2'], window: [xMin, xMax, yMin, yMax], canvas: { width: 390, height: 500 }, params?, ... }
    return { strokes: [[[x0, y0], [x1, y1] /* ... */]] };      // polylines in world coordinates
  },
};
```

Throwing, timing out (default 30 s) or answering `{ type: 'refused' }` counts as `REFUSED`. A synchronous infinite loop cannot be interrupted: run engines that might hang in a worker or child process inside your adapter.

## How the judges work, and why they do not trust the engine

An item stores a problem and a ground truth derived by hand. The judge never compares the answer's text with the truth's text. It checks the **mathematics of the claim**:

| what the engine returns | how it is checked |
|---|---|
| roots of an equation | each claimed root is substituted into the **original** equation (also in 64-digit arithmetic when doubles overflow, as for `e^x = 10^500`); the set is compared with the verified roots: a false root is WRONG, a missing root is INCOMPLETE |
| complex roots | substitution with complex arithmetic |
| trigonometric solutions | families in the integer `k` are substituted for k = -3..3, reduced modulo the period for k = -12..12 and compared with the verified solutions of one period; particular values alone are INCOMPLETE |
| a parametric solution (`a*x + b = 0`) | substituted for four random values of the parameters |
| inequalities | the answer intervals are tested against the **original inequality** at about 700 points, including every endpoint and 1e-5 / 1e-3 around it; hand-derived sets are compared structurally where doubles cannot see the answer (`ln(x) < 1000`) |
| systems | every tuple is substituted in every equation; infinite families are tested with random values of the free variable |
| derivatives, antiderivatives | 5-point finite differences of the problem (or of the engine's antiderivative) at nine points |
| ODEs | the claimed y(x) is substituted (finite-difference derivatives) with random constants; implicit solutions must satisfy G_x + G_y f = 0; initial-value problems are also compared with the known solution |
| limits, definite integrals, series, matrices, eigenvalues | compared with values derived by hand; the data tests re-compute finite definite integrals by independent quadrature |
| simplify / factor / expand | numeric equivalence with the input at seven points, then a textbook-form check |
| graphs | see below |

Graph judging is done in pixel space of the task canvas:

1. A **reference polyline** is built from the stored analytic truth by adaptive subdivision until every chord is at most 0.5 px; an interval that still moves more than 0.5 px after 64 bisections is a discontinuity (jump or pole) and is left open; implicit curves get a reference from the judge's own marching squares on a 0.5 px lattice, with a pole check.
2. **Deviation**: every drawn stroke is sampled every 1 px inside the canvas and its distance to the nearest reference chord is measured. **Coverage**: every reference chord is sampled every 1 px and the distance to the nearest drawn stroke is measured.
3. Thresholds (canvas pixels):

| class | meaning |
|---|---|
| `WRONG` | at least 2 px of drawn stroke lie farther than 3 px from the true curve; shading where the region is false (3 or more grid points of a 3 px grid, outside a 3 px band around the border); a wrong border style when stated; a phantom or mislabelled point of interest (5 significant digits); an extra plotted dot |
| `MISSING` | at least 3 px of the true curve have no stroke within 2 px; 3 or more grid points of a true region are not shaded; a required point of interest or plotted dot is absent; a reported parameter is absent |
| `ROUGH` | none of the above, but the stroke deviates by more than 1 px over at least 2 px of drawn length |
| `REFUSED` | the engine reported an error for a row, or threw, or timed out |

When several apply, the class is the worst in the order WRONG, MISSING, REFUSED, ROUGH. Curves that oscillate faster than the pixels are judged by the per-pixel-column envelope of the true function (only missing envelope counts; excess is reported as information because that measure is unreliable). Points of interest use a tolerance of 0.5 % of the window width; roots, extrema and the y-intercept are matched by x, intersections by x and y, each reported point at most once.

Each graph result also carries `drawingClass`, the class if points of interest are ignored, and the Markdown report gives a "drawing only" line, so engines without points of interest can be compared fairly.

## Answer grammar (solve)

An answer is a JSON object with a `type`. Expressions are plain-math strings: `^` power, implicit multiplication (`2x`, `3(x+1)`), functions `sin cos tan sec csc cot asin acos atan sinh cosh tanh sqrt cbrt abs exp ln log`, constants `pi` and `e`, imaginary unit `i`, `Infinity`. **`log(x)` is base 10, `log(x, b)` is base b, `ln` is natural.** Numbers may be JSON numbers or strings. A leading `y =` or `F(x) =` is ignored.

| `type` | fields | used for |
|---|---|---|
| `refused` | `reason?` | any task the engine declines |
| `none` | | no solution, empty set, inconsistent system |
| `all` | `except?: [...]` | identity; "every x except 1" is `{ "type": "all", "except": [1] }` |
| `values` | `values?: [...]`, `families?: [...]` | roots, complex roots (`"-1+2i"`), eigenvalues, trigonometric general solutions |
| `intervals` | `intervals: [{ lo, hi, loClosed?, hiClosed? }]` | solution sets; endpoints are numbers or expressions, `"-Infinity"` / `"Infinity"` for unbounded; a single point is `lo = hi` with both closed |
| `expression` | `expr`, `at?` | derivatives (`at`: the value at the requested point, or `"undefined"`), antiderivatives (any constant, `+ C` allowed), simplified / factored / expanded forms, ODE solutions y(x) with named constants (`C1`, `C2`), closed forms in `n`, Taylor polynomials |
| `implicit` | `expr` | an ODE solution `G(x, y) = C`, given as `G` |
| `number` | `value` | limits, definite integrals, sums, determinants, rank, complex numbers (`"2+3i"`), `"Infinity"`, `"-Infinity"` |
| `dne` | | the limit does not exist |
| `diverges` | | the improper integral, series or sequence diverges (`dne` is also accepted) |
| `matrix` | `rows: [[...]]` | inverse, product, transpose |
| `vector` | `values` | solution of a linear system `A x = b` |
| `solutions` | `solutions: [{ x: 3, y: 2 }]` | tuples of a system |
| `parametric` | `free: ['z']`, `solution: { x: '1 - z' }` | systems with infinitely many solutions |
| `singular` | | the matrix is not invertible |
| `undefined` | | the operation is undefined (matrix product with incompatible shapes) |

Examples:

```json
{ "type": "values", "values": ["2", "3"] }                                   // x^2 - 5x + 6 = 0
{ "type": "values", "families": ["pi/6 + 2*k*pi", "5*pi/6 + 2*k*pi"] }       // sin(x) = 1/2, k an integer
{ "type": "intervals", "intervals": [{ "lo": "-Infinity", "hi": 2, "hiClosed": true }, { "lo": 3, "hi": "Infinity", "loClosed": true }] }
{ "type": "expression", "expr": "2*x*cos(x^2)" }                              // d/dx sin(x^2)
{ "type": "expression", "expr": "6x", "at": "12" }                            // second derivative of x^3, also evaluated at x = 2
{ "type": "expression", "expr": "C1*cos(3x) + C2*sin(3x)" }                  // y'' + 9y = 0
{ "type": "number", "value": "pi^2/6" }                                       // sum(1/k^2, k, 1, inf)
{ "type": "parametric", "free": ["y"], "solution": { "x": "1 - y" } }         // x + y = 1; 2x + 2y = 2
```

Which answer types each task kind accepts:

| task kind | accepted answers |
|---|---|
| `equation` | `values` (roots, `families` for trigonometric equations), `none`, `all`, `intervals` (when the solution set is an interval) |
| `inequality` | `intervals`, `none`, `all` |
| `system` | `solutions`, `parametric`, `none` |
| `derivative`, `implicit-derivative`, `antiderivative` | `expression` |
| `definite-integral`, `limit`, `complex` | `number`, `dne`, `diverges` |
| `series` | `number`, `diverges`, `expression` (closed form or Taylor polynomial) |
| `ode` | `expression`, `implicit` |
| `matrix` | `number`, `matrix`, `vector`, `values`, `singular`, `undefined` |
| `simplify`, `factor`, `expand`, `partial-fractions` | `expression` |

### Task fields

`{ id, kind, input, options? }`. `input` is the problem as a student types it. Options: `variable` (the unknown when it is not `x`), `angleUnit` (`"deg"`, default radians), `domain` (`"complex"`), `order` (derivative order), `at` (evaluate the derivative there), `lower` / `upper` (integral bounds), `point` / `side` (limit), `operation` / `secondMatrix` / `constants` (matrices: `det`, `inverse`, `eigen`, `rank`, `solve`, `multiply`, `transpose`).

Input conventions you will meet: `^`, implicit multiplication, `|x|` or `abs(x)`, `sqrt`, `cbrt`, `ln` / `log` (base 10) / `log(x, 2)`, `e^x`, `pi`; systems separated by `;`; ODEs as `y' + y = x; y(0) = 1` or `dy/dx = ...`; matrices as `1,2;3,4` or `[[1,2],[3,4]]`; series as `sum(1/k^2, k, 1, inf)`, `sequence((1+1/n)^n, n)`, `taylor(sin(x), x, 0, 7)`; complex numbers with `i`, `conj`, `arg`, polar `2∠60°`. The `student-typed spellings` category deliberately contains typographic forms (`x²`, `·`, `÷`, `−`, `√`, `½`), decimal commas (`0,5x`) and Spanish function names (`raiz`, `ln x`); an engine that cannot read them is REFUSED or WRONG, which is a legitimate result. For such items the stored `judgeAs` field holds the plain-math reading used by the judge.

## The graph contract

`plot(task)` receives `{ id, rows, window, canvas, params?, parameterDomain?, pointsOfInterest? }`:

- `rows`: strings as typed, one per row, sharing one plane: `y=x^2`, `x^2+y^2=4`, `y>x^2`, `x^2<y<4`, `x^2 {x>0}`, `{x<0: -x, x^2}`, `r=1+cos(θ)`, `(cos(t), sin(t)) {0<t<2π}`, `(1,2)`, `f(x)=x^2` followed by `f(x)+1`, `f'(x)`, `a*sin(b*x)` (free parameters are sliders: unknown parameters default to 1 unless `params` gives a value).
- `window`: `[xMin, xMax, yMin, yMax]` in the world; draw exactly this window on a `canvas.width x canvas.height` pixel canvas (default 390 x 500; the scale may differ in x and y).
- `parameterDomain`: range of the angle or parameter of polar and parametric rows without their own range (default 0 to 2 pi).
- `pointsOfInterest: { row }`: also report points. `row >= 0`: roots, local maxima, local minima and the y-intercept of that row's curve; `row = -1`: intersections between the curves of all rows.

It returns `{ strokes, regions?, points?, parameters?, errors? }`:

```ts
strokes: Array<[x, y][] | { row?: number; points: [x, y][] }>   // polylines in WORLD coordinates; `row` attributes a stroke to a row
regions: Array<{ row?: number; polygon: [x, y][]; strict?: boolean }> // shaded polygons (even-odd with the others of the row); strict = border excluded
points: Array<{ x, y, kind?: 'root'|'maximum'|'minimum'|'yIntercept'|'intersection'|'point', row?, label? }>
parameters: string[]                      // names of the sliders the engine detected
errors: { [rowIndex: string]: string }    // a row the engine rejected
```

Plotted dots (`(1,2)`) are points of kind `point`; a point that is both a maximum and a y-intercept is reported once per kind. For multi-row items tag strokes with `row` so the judge can pick the row it grades; untagged strokes count for every row. The border of an inequality region is a stroke; `strict` is only judged when you state it.

Graph truths are stored as JavaScript arrow-function sources over plain `Math.*` (plus the helpers `sec csc cot mod rpow gamma restrict` and the aliases `sin cos tan exp ln sqrt abs PI`, see `src/graph/runtime.ts`) and are evaluated with `new Function`. Treat the data files as code: do not load a data file you did not read.

## Baselines (naive, not a ranking)

The two example adapters exist so you can see the machinery work. They are deliberately naive and score low.

- `examples/mathjs-solve-adapter.mjs`: about 150 lines on top of mathjs. It answers polynomial equations up to degree 3, linear systems, first and higher derivatives, `simplify`, complex arithmetic, finite definite integrals by Simpson, and matrix determinant, inverse, product, transpose, eigenvalues and linear solve. Everything else is refused.
- `examples/naive-graph-adapter.mjs`: samples explicit functions, polar and parametric rows and single points at 400 equally spaced values and joins finite neighbours. No refinement, no pole detection, no implicit curves, no inequalities, no restrictions, no points of interest.

Measured with the commands in the quick start, on this repository at version 0.1.0.

**Solve, mathjs baseline**: 284 of 1119 items CORRECT (25.4 %), 43 WRONG, 20 INCOMPLETE, 772 REFUSED.

| name | n | CORRECT | WRONG | INCOMPLETE | REFUSED | score |
|---|---:|---:|---:|---:|---:|---:|
| absolute | 23 | 0 | 0 | 0 | 23 | 0.0 % |
| algebra | 34 | 1 | 0 | 16 | 17 | 2.9 % |
| antiderivative | 84 | 0 | 0 | 0 | 84 | 0.0 % |
| complex | 36 | 31 | 0 | 0 | 5 | 86.1 % |
| definite | 67 | 31 | 14 | 0 | 22 | 46.3 % |
| derivative | 83 | 46 | 10 | 0 | 27 | 55.4 % |
| exponential | 39 | 0 | 0 | 0 | 39 | 0.0 % |
| inequality | 90 | 0 | 0 | 0 | 90 | 0.0 % |
| limit | 98 | 0 | 0 | 0 | 98 | 0.0 % |
| linear | 31 | 19 | 0 | 0 | 12 | 61.3 % |
| logarithmic | 41 | 0 | 0 | 0 | 41 | 0.0 % |
| matrix | 50 | 38 | 4 | 0 | 8 | 76.0 % |
| ode | 51 | 0 | 0 | 0 | 51 | 0.0 % |
| polynomial | 50 | 25 | 0 | 0 | 25 | 50.0 % |
| quadratic | 40 | 34 | 1 | 0 | 5 | 85.0 % |
| radical | 31 | 0 | 0 | 0 | 31 | 0.0 % |
| rational | 34 | 16 | 13 | 0 | 5 | 47.1 % |
| series | 41 | 0 | 0 | 0 | 41 | 0.0 % |
| student | 66 | 27 | 1 | 0 | 38 | 40.9 % |
| system | 59 | 16 | 0 | 4 | 39 | 27.1 % |
| trig | 71 | 0 | 0 | 0 | 71 | 0.0 % |
| **ALL** | 1119 | 284 | 43 | 20 | 772 | 25.4 % |

**Graph, naive uniform sampler**: 295 of 722 items CORRECT (40.9 %), 85 WRONG, 342 MISSING, 0 ROUGH, 0 REFUSED. Looking at the drawing only (the 611 items that have a drawing truth, points of interest ignored): 286 CORRECT (46.8 %).

| name | n | CORRECT | WRONG | MISSING | ROUGH | REFUSED | score |
|---|---:|---:|---:|---:|---:|---:|---:|
| abs | 11 | 10 | 0 | 1 | 0 | 0 | 90.9 % |
| conics | 18 | 0 | 0 | 18 | 0 | 0 | 0.0 % |
| cubics | 7 | 7 | 0 | 0 | 0 | 0 | 100.0 % |
| derivative | 8 | 0 | 6 | 2 | 0 | 0 | 0.0 % |
| exp-log | 16 | 9 | 0 | 7 | 0 | 0 | 56.3 % |
| fn-asymptote | 18 | 8 | 6 | 4 | 0 | 0 | 44.4 % |
| fn-basic | 32 | 31 | 0 | 1 | 0 | 0 | 96.9 % |
| fn-domain | 25 | 12 | 0 | 13 | 0 | 0 | 48.0 % |
| fn-highfreq | 11 | 4 | 0 | 7 | 0 | 0 | 36.4 % |
| fn-hole | 5 | 4 | 0 | 1 | 0 | 0 | 80.0 % |
| fn-jump | 11 | 2 | 8 | 1 | 0 | 0 | 18.2 % |
| fn-steepflat | 8 | 8 | 0 | 0 | 0 | 0 | 100.0 % |
| fn-window | 1 | 1 | 0 | 0 | 0 | 0 | 100.0 % |
| hard-window | 41 | 22 | 2 | 17 | 0 | 0 | 53.7 % |
| implicit | 30 | 0 | 0 | 30 | 0 | 0 | 0.0 % |
| inequality | 42 | 0 | 0 | 42 | 0 | 0 | 0.0 % |
| lines | 5 | 2 | 0 | 3 | 0 | 0 | 40.0 % |
| lists | 2 | 0 | 0 | 2 | 0 | 0 | 0.0 % |
| own-function | 23 | 0 | 0 | 23 | 0 | 0 | 0.0 % |
| parabolas | 11 | 7 | 0 | 4 | 0 | 0 | 63.6 % |
| parametric | 34 | 30 | 1 | 3 | 0 | 0 | 88.2 % |
| piecewise | 13 | 0 | 4 | 9 | 0 | 0 | 0.0 % |
| poi-cross | 28 | 4 | 0 | 24 | 0 | 0 | 14.3 % |
| poi | 67 | 4 | 0 | 63 | 0 | 0 | 6.0 % |
| points | 6 | 3 | 0 | 3 | 0 | 0 | 50.0 % |
| polar | 37 | 30 | 3 | 4 | 0 | 0 | 81.1 % |
| rationals | 12 | 10 | 0 | 2 | 0 | 0 | 83.3 % |
| restriction | 10 | 0 | 8 | 2 | 0 | 0 | 0.0 % |
| sliders | 9 | 6 | 2 | 1 | 0 | 0 | 66.7 % |
| system | 16 | 1 | 0 | 15 | 0 | 0 | 6.3 % |
| trig | 14 | 12 | 2 | 0 | 0 | 0 | 85.7 % |
| typed-es | 44 | 20 | 11 | 13 | 0 | 0 | 45.5 % |
| typed-format | 24 | 14 | 2 | 8 | 0 | 0 | 58.3 % |
| typed-glued | 23 | 8 | 12 | 3 | 0 | 0 | 34.8 % |
| typing | 52 | 26 | 18 | 8 | 0 | 0 | 50.0 % |
| x=f(y) | 8 | 0 | 0 | 8 | 0 | 0 | 0.0 % |
| **ALL** | 722 | 295 | 85 | 342 | 0 | 0 | 40.9 % |



## Limitations and known judge blind spots

- **Sampling is not proof.** Derivatives, antiderivatives, equivalence, ODE solutions and inequalities are checked at finitely many points. An answer that agrees with the truth at every sample but differs elsewhere passes. Derivative checks use a fixed 5-point stencil (tolerance 1e-5 up to order 2, 2e-3 beyond), so ill-conditioned problems use restricted sample ranges stored with the item.
- **Inequalities** are sampled at about 700 points; an isolated solution or a gap narrower than the grid can slip through unless it coincides with an endpoint the answer itself states (endpoints are always tested). Answers whose endpoints are rounded decimals are not tested exactly at those endpoints.
- **Roots outside the verified set are WRONG** even if they satisfy the equation: the data was checked to list every real root, but a mistake in the data would punish a correct engine. Please report such cases.
- **Trigonometric families** are reduced modulo 2 pi (360 degrees). Equations with a longer period, such as `sin(x/2) = 1`, have the correct family (`pi + 4*k*pi`) in the data; a family whose members are valid only because of a longer period is judged by its members.
- **Limits, integrals, series and matrix values** are compared with hand-derived values. The data tests re-compute finite integrals by quadrature, and about a third of the solve items were additionally re-checked numerically with independent code (root scans, quadrature, high-precision limits) before release; the rest rely on the derivation.
- **Form checks** (simplify, factor, expand) are regular expressions over whitespace-free text. Equivalent forms written in an order the data did not anticipate are marked INCOMPLETE. Only a small number of items have a form requirement.
- **Implicit ODE solutions** are only checked for first-order equations. **Second-order** problems need an explicit y(x).
- **Graph judging** is blind to features smaller than a pixel, to isolated points and tiny loops of an implicit curve (the reference uses a 0.5 px lattice), and to anything outside the window. An item whose truth is not visible in its window is CORRECT with nothing drawn.
- **Aliased curves** (`sin(1000x)`) are judged by envelope: only missing coverage counts.
- **Conventions are part of the data**: `log` is base 10, trigonometry is in radians unless `angleUnit` says degrees, `a^(p/q)` with q odd is the real root, ambiguous typings such as `1/2x` were removed from the data. The student-typed and typed-* groups reflect Spanish-speaking classroom typing and will penalise engines that do not read it.
- **Not covered**: three-dimensional graphs (the cases in the source batteries were left out), animation, text or LaTeX rendering, step-by-step explanations, word problems, performance and memory, numeric display formatting, symbolic forms beyond the checks above, languages other than the typed conventions.
- **Truth functions are code.** Do not load data files from untrusted sources.

## En español

Arctic Math Bench es un banco de pruebas independiente del motor para solucionadores matemáticos y motores de gráficas. Incluye 1.119 problemas de resolución (ecuaciones, inecuaciones, sistemas, derivadas, integrales, límites, EDO, matrices, complejos, series, álgebra) y 722 casos de gráficas (funciones, curvas implícitas, inecuaciones, polares, paramétricas, restricciones, deslizadores, puntos de interés), cada uno con su verdad calculada a mano. Los jueces no confían en el motor evaluado: sustituyen las raíces en la ecuación original, muestrean, derivan numéricamente y comparan píxeles contra referencias propias.

Uso rápido: `npm ci`, `npm test`, y luego `node dist/cli.js solve --adapter ./mi-adaptador.mjs` o `... graph --adapter ...`. Un adaptador es un módulo con un método `solve(task)` o `plot(task)` que devuelve la estructura neutra descrita arriba (gramática de respuestas). Las clases por problema son CORRECT, WRONG, INCOMPLETE y REFUSED, y en gráficas además MISSING y ROUGH, con umbrales en píxeles documentados. Los dos adaptadores de ejemplo (mathjs y un muestreador uniforme) son líneas base ingenuas, no una clasificación. Las limitaciones honestas están en la sección anterior. Licencias: código Apache-2.0, datos CC BY 4.0.

## Licence

Code: Apache-2.0 (`LICENSE`). Problems, ground truths and notes in `data/`: CC BY 4.0 (`LICENSE-DATA`). Runtime dependency: mathjs (Apache-2.0), see `NOTICE`.
