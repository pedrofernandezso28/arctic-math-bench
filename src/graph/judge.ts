/**
 * Judge for graph items. The drawing is compared in pixel space with references computed here from the
 * stored truth; points of interest are compared with truth lists computed independently.
 *
 * Classes: WRONG > MISSING > REFUSED > ROUGH > CORRECT (priority when several apply).
 * Pixel thresholds (canvas pixels):
 *  - WRONG   : more than 2 px of drawn stroke lie farther than 3 px from the true curve; a phantom or mislabelled
 *              point of interest; shading where the region is false; a wrong border style.
 *  - MISSING : 3 px or more of the true curve have no drawn stroke within 2 px; a required point of interest or dot is absent;
 *              3 or more grid points of a true region are not shaded; a requested parameter is not reported.
 *  - ROUGH   : none of the above, but the stroke deviates by more than 1 px over at least 2 px of drawn length.
 *  - REFUSED : the engine reported an error for a row, or threw.
 */
import type { GraphClass, GraphVerdict, PlotPoint, PlotResult, Pt, RegionPlot, Stroke } from '../types.js';
import type { GraphItem, PoiTruth } from './truth.js';
import { compile1, compile2, compileCurve, type ParamCurve } from './runtime.js';
import {
  compareCurves, compareEnvelope, compareRegion, label5, polylinesToSegs, projector, referenceImplicit, referenceSegments, type Canvas, type CurveVerdict, type Px, type Seg, type Win,
} from './geometry.js';

const ORDER: GraphClass[] = ['WRONG', 'MISSING', 'REFUSED', 'ROUGH', 'CORRECT'];
const worst = (classes: GraphClass[]): GraphClass => ORDER.find((k) => classes.includes(k)) ?? 'CORRECT';

const fmt = (v: number | undefined | null): string => (v === undefined || v === null || !Number.isFinite(v) ? '?' : String(Number(v.toPrecision(6))));

const asStroke = (s: Pt[] | Stroke): Stroke => (Array.isArray(s) ? { points: s } : s);
const forRow = (row: number | undefined, wanted: number[], all: boolean): boolean => all || row === undefined || wanted.includes(row);

function strokesOf(result: PlotResult, rows: number[], all: boolean): Array<Array<{ x: number; y: number }>> {
  const out: Array<Array<{ x: number; y: number }>> = [];
  for (const raw of result.strokes ?? []) {
    const s = asStroke(raw);
    if (!Array.isArray(s.points) || !forRow(s.row, rows, all)) continue;
    out.push(s.points.map(([x, y]) => ({ x, y })));
  }
  return out;
}

function toSegs(world: Array<Array<{ x: number; y: number }>>, win: Win, canvas: Canvas): Seg[] {
  const { toPx } = projector(win, canvas);
  return polylinesToSegs(world.map((line) => line.map((p) => toPx(p.x, p.y))));
}

function judgeCurve(item: GraphItem, result: PlotResult, win: Win, canvas: Canvas, rows: number[], all: boolean): { verdict: CurveVerdict; klass: GraphClass; reasons: string[] } | null {
  const truth = item.truth!;
  const width = win.xMax - win.xMin;
  let reference: Seg[];
  let incomplete = false;
  let ignore: Array<[number, number]> = 'ignore' in truth ? truth.ignore ?? [] : [];
  const drawn = toSegs(strokesOf(result, rows, all), win, canvas);
  if (truth.type === 'fn' || truth.type === 'fns') {
    const fs = (truth.type === 'fn' ? [truth.f] : truth.fs).map(compile1);
    const curves: ParamCurve[] = fs.map((f) => ({ p: (t: number) => [t, f(t)], t0: win.xMin - 0.02 * width, t1: win.xMax + 0.02 * width, base: 4000 }));
    const r = referenceSegments(curves, win, canvas, ignore, 250_000);
    reference = r.segs;
    incomplete = r.incomplete;
    if (r.incomplete && truth.type === 'fn' && !ignore.length) {
      // faster than the pixels: judge by column envelope instead (see compareEnvelope)
      const verdict = compareEnvelope(drawn, fs[0]!, win, canvas);
      const reasons = ['aliased truth: judged by per-column envelope'];
      const classes: GraphClass[] = [];
      // Excess over the column envelope is reported but never classed WRONG: a chord check of sin(x^2) on [-30, 30] found
      // at most 1.3 px deviation where the envelope claimed 842 px of excess, so the excess measure is unreliable.
      if (verdict.falseLenPx >= 3) reasons.push(`(info, unreliable) drawn ${verdict.falseLenPx.toFixed(1)} px beyond the column envelope (max ${verdict.maxDevPx.toFixed(1)} px) near (${fmt(verdict.worstFalse?.x)}, ${fmt(verdict.worstFalse?.y)})`);
      if (verdict.missingLenPx >= 3) {
        classes.push('MISSING');
        reasons.push(`true envelope uncovered over ${verdict.missingLenPx.toFixed(1)} px of ${verdict.refLenPx.toFixed(0)} px near (${fmt(verdict.worstMissing?.x)}, ${fmt(verdict.worstMissing?.y)})`);
      }
      return { verdict, klass: worst(classes), reasons };
    }
  } else if (truth.type === 'param') {
    const r = referenceSegments(truth.curves.map(compileCurve), win, canvas, ignore, 400_000);
    reference = r.segs;
    incomplete = r.incomplete;
  } else if (truth.type === 'implicit') {
    reference = referenceImplicit(compile2(truth.F), win, canvas, truth.step ?? 0.5);
    ignore = [];
  } else return null;
  const verdict = compareCurves(drawn, reference, win, canvas, ignore, incomplete);
  const reasons: string[] = [];
  const classes: GraphClass[] = [];
  if (verdict.falseLenPx >= 2) {
    classes.push('WRONG');
    reasons.push(`drawn ${verdict.falseLenPx.toFixed(1)} px farther than 3 px from the true curve (max ${verdict.maxDevPx.toFixed(1)} px) near (${fmt(verdict.worstFalse?.x)}, ${fmt(verdict.worstFalse?.y)})`);
  }
  if (verdict.missingLenPx >= 3) {
    classes.push('MISSING');
    reasons.push(`true curve absent over ${verdict.missingLenPx.toFixed(1)} px of ${verdict.refLenPx.toFixed(0)} px; first gap near (${fmt(verdict.worstMissing?.x)}, ${fmt(verdict.worstMissing?.y)})`);
  }
  if (verdict.maxDevPx > 1 && verdict.roughLenPx >= 2 && !classes.length) {
    classes.push('ROUGH');
    reasons.push(`deviation up to ${verdict.maxDevPx.toFixed(2)} px over ${verdict.roughLenPx.toFixed(1)} px of stroke`);
  }
  if (incomplete) reasons.push('reference hit its point cap (truth incomplete)');
  return { verdict, klass: worst(classes), reasons };
}

type EnginePoint = { kind: string; x: number; y: number };

function judgePoi(item: GraphItem, result: PlotResult, win: Win, truth: PoiTruth): { klass: GraphClass; reasons: string[]; missed: number; phantom: number } {
  const width = win.xMax - win.xMin;
  const height = win.yMax - win.yMin;
  const tol = 0.005 * width;
  const tolY = 0.005 * height;
  const edge = 0.002 * width;
  const poiRow = item.task.pointsOfInterest?.row ?? 0;
  const engine: EnginePoint[] = [];
  const kinds = poiRow >= 0 ? ['root', 'maximum', 'minimum', 'yIntercept'] : ['intersection'];
  for (const p of result.points ?? []) {
    const kind = p.kind ?? 'point';
    if (!kinds.includes(kind)) continue;
    if (poiRow >= 0 && p.row !== undefined && p.row !== poiRow) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    engine.push({ kind, x: p.x, y: p.y });
  }
  const expected: EnginePoint[] = [];
  if (poiRow >= 0) {
    for (const x of truth.roots ?? []) expected.push({ kind: 'root', x, y: 0 });
    for (const [x, y] of truth.max ?? []) expected.push({ kind: 'maximum', x, y });
    for (const [x, y] of truth.min ?? []) expected.push({ kind: 'minimum', x, y });
    if (truth.yInt !== undefined && truth.yInt !== null && win.xMin <= 0 && win.xMax >= 0) expected.push({ kind: 'yIntercept', x: 0, y: truth.yInt });
  } else for (const [x, y] of truth.cross ?? []) expected.push({ kind: 'intersection', x, y });
  const inside = (p: EnginePoint) => p.x > win.xMin + edge && p.x < win.xMax - edge;
  const optionalX = (x: number) => (truth.optional ?? []).some((o) => Math.abs(o - x) <= tol);
  const required = (p: EnginePoint) => {
    if (!inside(p) || optionalX(p.x)) return false;
    if (truth.dense) {
      const same = expected.filter((q) => q.kind === p.kind && q !== p);
      if (same.some((q) => Math.abs(q.x - p.x) < tol)) return false;
    }
    return true;
  };
  const missed: EnginePoint[] = [];
  const phantom: EnginePoint[] = [];
  const inaccurate: Array<{ kind: string; labelTruth: string; labelEngine: string }> = [];
  const used = new Set<EnginePoint>();
  for (const t of expected) {
    // Intersections are matched by x AND y (two truths may share x) and each engine point is used once.
    const candidates = engine
      .filter((e) => e.kind === t.kind && Math.abs(e.x - t.x) <= tol && (t.kind !== 'intersection' || (Math.abs(e.y - t.y) <= tolY && !used.has(e))))
      .sort((a, b) => Math.abs(a.x - t.x) + Math.abs(a.y - t.y) - (Math.abs(b.x - t.x) + Math.abs(b.y - t.y)));
    const e = candidates[0];
    if (!e) {
      if (required(t)) missed.push(t);
      continue;
    }
    used.add(e);
    const lx = label5(e.x) === label5(t.x);
    const ly = label5(e.y) === label5(t.y);
    if (!lx || !ly) inaccurate.push({ kind: t.kind, labelTruth: `(${label5(t.x)}, ${label5(t.y)})`, labelEngine: `(${label5(e.x)}, ${label5(e.y)})` });
  }
  for (const e of engine) {
    if (used.has(e)) continue;
    if (optionalX(e.x)) continue;
    // dense truths: an engine point is fine if it is a true point of that kind (within tolerance)
    const near = expected.some((t) => t.kind === e.kind && Math.abs(t.x - e.x) <= tol);
    if (near && truth.dense) continue;
    phantom.push(e);
  }
  const classes: GraphClass[] = [];
  const reasons: string[] = [];
  if (phantom.length) {
    classes.push('WRONG');
    reasons.push(`point of interest not in the truth: ${phantom.slice(0, 4).map((p) => `${p.kind} (${fmt(p.x)}, ${fmt(p.y)})`).join('; ')}${phantom.length > 4 ? ` ... (${phantom.length})` : ''}`);
  }
  if (inaccurate.length) {
    classes.push('WRONG');
    reasons.push(`point label differs at 5 significant digits: ${inaccurate.slice(0, 3).map((p) => `${p.kind} reported ${p.labelEngine}, truth ${p.labelTruth}`).join('; ')}`);
  }
  if (missed.length) {
    classes.push('MISSING');
    reasons.push(`point of interest missed: ${missed.slice(0, 5).map((p) => `${p.kind} (${fmt(p.x)}, ${fmt(p.y)})`).join('; ')}${missed.length > 5 ? ` ... (${missed.length})` : ''}`);
  }
  return { klass: worst(classes), reasons, missed: missed.length, phantom: phantom.length };
}

function judgePoints(item: GraphItem, result: PlotResult, pts: Array<[number, number]>, rows: number[], all: boolean) {
  const dots = (result.points ?? []).filter((p: PlotPoint) => (p.kind ?? 'point') === 'point' && forRow(p.row, rows, all)).map((p) => [p.x, p.y] as [number, number]);
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));
  const missing = pts.filter(([x, y]) => !dots.some(([a, b]) => same(a, x) && same(b, y)));
  const extra = dots.filter(([a, b]) => !pts.some(([x, y]) => same(a, x) && same(b, y)));
  const classes: GraphClass[] = [];
  const reasons: string[] = [];
  if (extra.length) {
    classes.push('WRONG');
    reasons.push(`extra dots ${JSON.stringify(extra)}`);
  }
  if (missing.length) {
    classes.push('MISSING');
    reasons.push(`missing dots ${JSON.stringify(missing)}`);
  }
  void item;
  return { klass: worst(classes), reasons };
}

function judgeRegion(item: GraphItem, result: PlotResult, win: Win, canvas: Canvas, rows: number[], all: boolean) {
  const truth = item.truth as Extract<NonNullable<GraphItem['truth']>, { type: 'region' }>;
  const F = compile2(truth.F);
  const { toPx } = projector(win, canvas);
  const regions: RegionPlot[] = (result.regions ?? []).filter((r) => forRow(r.row, rows, all));
  const polygons: Px[][] = regions.map((r) => r.polygon.map(([x, y]) => toPx(x, y)));
  const inside = (x: number, y: number) => {
    const v = F(x, y);
    if (!Number.isFinite(v)) return null;
    return truth.rel === '<' ? v < 0 : truth.rel === '<=' ? v <= 0 : truth.rel === '>' ? v > 0 : v >= 0;
  };
  const classes: GraphClass[] = [];
  const reasons: string[] = [];
  const r = compareRegion(polygons, inside, win, canvas);
  const strictExpected = truth.rel === '<' || truth.rel === '>';
  if (r.falseIn >= 3 || (r.mismatchFrac > 0.005 && r.falseIn > 0)) {
    classes.push('WRONG');
    reasons.push(`shaded where false at ${r.falseIn} of ${r.tested} grid points (e.g. ${r.examples.filter((e) => e.truth !== true).slice(0, 2).map((e) => `(${fmt(e.x)}, ${fmt(e.y)})`).join(' ')})`);
  }
  if (r.falseOut >= 3) {
    classes.push('MISSING');
    reasons.push(`not shaded where true at ${r.falseOut} of ${r.tested} grid points (e.g. ${r.examples.filter((e) => e.truth === true).slice(0, 2).map((e) => `(${fmt(e.x)}, ${fmt(e.y)})`).join(' ')})`);
  }
  // Border style is judged only when the engine states it.
  const stated = regions.find((g) => g.strict !== undefined);
  if (stated && !!stated.strict !== strictExpected) {
    classes.push('WRONG');
    reasons.push(`border style strict=${!!stated.strict}, expected ${strictExpected}`);
  }
  const border = truth.borderCurves ? referenceSegments(truth.borderCurves.map(compileCurve), win, canvas, [], 400_000).segs : referenceImplicit(F, win, canvas, 0.5);
  const v = compareCurves(toSegs(strokesOf(result, rows, all), win, canvas), border, win, canvas);
  if (v.falseLenPx >= 2) {
    classes.push('WRONG');
    reasons.push(`border drawn ${v.falseLenPx.toFixed(1)} px off the true border (max ${v.maxDevPx.toFixed(1)} px) near (${fmt(v.worstFalse?.x)}, ${fmt(v.worstFalse?.y)})`);
  }
  if (v.missingLenPx >= 3) {
    classes.push('MISSING');
    reasons.push(`border absent over ${v.missingLenPx.toFixed(1)} px of ${v.refLenPx.toFixed(0)} px near (${fmt(v.worstMissing?.x)}, ${fmt(v.worstMissing?.y)})`);
  }
  return { klass: worst(classes), reasons, metrics: { gridTested: r.tested, falseIn: r.falseIn, falseOut: r.falseOut, borderMissingPx: v.missingLenPx, borderFalsePx: v.falseLenPx } };
}

/** Judge one plot. Never throws. `result` null/undefined or `error` counts as REFUSED. */
export function judgeGraph(item: GraphItem, result: PlotResult | null | undefined, error?: string): GraphVerdict {
  if (!result || typeof result !== 'object') return { class: 'REFUSED', drawingClass: 'REFUSED', reasons: [error ? `engine error: ${error}` : 'no plot returned'] };
  try {
    return judgeInner(item, result);
  } catch (e) {
    return { class: 'WRONG', drawingClass: 'WRONG', reasons: [`judge could not read the plot: ${(e as Error).message}`] };
  }
}

function judgeInner(item: GraphItem, result: PlotResult): GraphVerdict {
  const [xMin, xMax, yMin, yMax] = item.task.window;
  const win: Win = { xMin, xMax, yMin, yMax };
  const canvas: Canvas = { w: item.task.canvas.width, h: item.task.canvas.height };
  const judgeRow = item.judgeRow ?? 0;
  const rows = [judgeRow];
  const all = !!item.judgeAll;
  const drawing: GraphClass[] = [];
  const poiClasses: GraphClass[] = [];
  const reasons: string[] = [];
  const metrics: Record<string, number | string | null> = {};
  const errorRows = Object.keys(result.errors ?? {}).map(Number);
  if (errorRows.length) {
    drawing.push('REFUSED');
    reasons.push(`rejected: ${errorRows.map((i) => `row ${i} "${item.task.rows[i] ?? ''}" -> "${result.errors![String(i)]}"`).join(' | ')}`);
  }
  if (item.expectParams) {
    const have = result.parameters ?? [];
    const missing = item.expectParams.filter((p) => !have.includes(p));
    if (missing.length) {
      drawing.push('MISSING');
      reasons.push(`parameters (sliders) not reported: ${missing.join(',')} (got ${have.join(',') || 'none'})`);
    }
  }
  const truth = item.truth;
  if (truth && !errorRows.includes(judgeRow)) {
    if (truth.type === 'points') {
      const p = judgePoints(item, result, truth.points, rows, all);
      drawing.push(p.klass);
      reasons.push(...p.reasons);
    } else if (truth.type === 'region') {
      const p = judgeRegion(item, result, win, canvas, rows, all);
      drawing.push(p.klass);
      reasons.push(...p.reasons);
      Object.assign(metrics, p.metrics);
    } else {
      const c = judgeCurve(item, result, win, canvas, rows, all);
      if (c) {
        drawing.push(c.klass);
        reasons.push(...c.reasons);
        metrics.maxDevPx = Number(c.verdict.maxDevPx.toFixed(3));
        metrics.missingPx = Number(c.verdict.missingLenPx.toFixed(2));
        metrics.falsePx = Number(c.verdict.falseLenPx.toFixed(2));
        metrics.refPx = Number(c.verdict.refLenPx.toFixed(1));
      }
    }
  }
  if (item.poi && !errorRows.length) {
    const p = judgePoi(item, result, win, item.poi);
    poiClasses.push(p.klass);
    reasons.push(...p.reasons);
    metrics.poiMissed = p.missed;
    metrics.poiPhantom = p.phantom;
  }
  const drawingClass = worst(drawing);
  return { class: worst([...drawing, ...poiClasses]), drawingClass, reasons, metrics };
}
