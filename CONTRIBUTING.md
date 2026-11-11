# Contributing

Thanks for helping. The benchmark is only as good as its ground truths, so the bar for a new problem is a derivation that somebody else can re-check.

## Proposing a problem

Open an issue or a pull request with:

1. **The input exactly as a student would type it** (and, if it uses a spelling the judge cannot read, such as `sen(x)` or a decimal comma, a plain-math version for the `judgeAs` field).
2. **The task kind** and options (see the README: equation, inequality, system, derivative, antiderivative, definite integral, limit, ODE, matrix, complex, series, simplify, factor, expand, partial fractions; for graphs the rows, window and canvas).
3. **The ground truth** in the neutral form of the matching `truth` type (see `src/solve/truth.ts` and `src/graph/truth.ts`).
4. **A derivation**: how you obtained the truth, in a few lines that a reader can follow with pencil and paper (for example: "factor as (x-2)(x-3); both roots satisfy the equation; no domain restriction"). If a number comes from software, name the software and the precision, and say how the number was cross-checked by a second, independent route.
5. **A reference answer** in the neutral answer grammar. The self-tests feed it to the judge and it must come out CORRECT.
6. For graph items, the truth as a plain `Math.*` arrow function (or parametric / implicit function) written by hand from the textbook meaning of the input, and, when points of interest are requested, the roots, extrema and intercepts computed independently of any plotting code.

Please do not propose items whose truth depends on how one particular product reads ambiguous typing (`1/2x`, `e^2x`, `sinx^2`). If the reading is a convention, either use unambiguous input or state the convention in the item `note` and keep it out of the default set.

## Adding the item

- Solve items live in `data/solve/<category>.json`, one object per item. Ids are `<category>-NNN`; take the next free number.
- Graph items live in `data/graph/<group>.json`. Ids are free-form dotted strings and must be unique.
- Keep one item per line in the JSON files so diffs stay readable.

## Checks that must pass

```
npm ci
npm run build
npm test
```

`npm test` verifies that every item validates against the schema, that ids are unique, that the reference answer (solve) or the drawing made from the truth (graph) is judged CORRECT, and that deliberately wrong answers are rejected. A new truth type needs a judge, a negative control and a schema entry.

## Changing a judge

A change to a judge can move scores of every user, so it needs a reason that is checkable: a counter-example item that the old judge misclassifies, written as a failing test first. Do not loosen a tolerance to make an engine pass.

## Corrections to existing items

If you believe a truth is wrong, open an issue with the derivation of the correct truth. When the benchmark was wrong and an engine was right, the item is fixed and the fix is listed in the changelog section of the README.

## Licence

By contributing you agree that code is licensed under Apache-2.0 and data under CC BY 4.0.
