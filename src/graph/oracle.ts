/**
 * Reference plotter: draws exactly what the truth of an item says (used by the self-tests and as the
 * upper bound adapter). It is NOT an engine: it needs the ground truth, which a real adapter never sees.
 */
import type { GraphAdapter, GraphTask, PlotPoint, PlotResult, Pt, RegionPlot, Stroke } from '../types.js';
import type { GraphItem } from './truth.js';
import { compile1, compile2, compileCurve } from './runtime.js';
import { projector, referenceImplicit, referenceSegments, type Canvas, type Seg, type Win } from './geometry.js';

function winOf(item: GraphItem): { win: Win; canvas: Canvas } {
  const [xMin, xMax, yMin, yMax] = item.task.window;
  return { win: { xMin, xMax, yMin, yMax }, canvas: { w: item.task.canvas.width, h: item.task.canvas.height } };
}

const toStrokes = (segs: Seg[], win: Win, canvas: Canvas, row: number | undefined): Stroke[] => {
  const { toWorldX, toWorldY } = projector(win, canvas);
  return segs.map((s) => ({ ...(row === undefined ? {} : { row }), points: s.map((p) => [toWorldX(p.x), toWorldY(p.y)] as Pt) }));
};

const pushAll = <T,>(target: T[], more: T[]) => {
  for (const m of more) target.push(m);
};

/** Plot of one item as the truth describes it. */
export function referencePlot(item: GraphItem): PlotResult {
  const { win, canvas } = winOf(item);
  const row = item.judgeAll ? undefined : item.judgeRow ?? 0;
  const result: PlotResult = { strokes: [] };
  const truth = item.truth;
  if (truth) {
    const width = win.xMax - win.xMin;
    if (truth.type === 'fn' || truth.type === 'fns') {
      const fs = (truth.type === 'fn' ? [truth.f] : truth.fs).map(compile1);
      const curves = fs.map((f) => ({ p: (t: number): [number, number] => [t, f(t)], t0: win.xMin - 0.02 * width, t1: win.xMax + 0.02 * width, base: 4000 }));
      const r = referenceSegments(curves, win, canvas, truth.ignore ?? [], 250_000);
      if (r.incomplete && truth.type === 'fn' && !(truth.ignore ?? []).length) {
        // faster than the pixels: one vertical stroke per pixel column spanning the true extent
        const { toWorldX, toWorldY } = projector(win, canvas);
        for (let c = 0; c < canvas.w; c++) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let k = 0; k < 4096; k++) {
            const v = fs[0]!(toWorldX(c + ((k * 0.6180339887498949) % 1)));
            if (Number.isFinite(v)) {
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
          }
          if (hi >= lo) result.strokes.push({ ...(row === undefined ? {} : { row }), points: [[toWorldX(c + 0.5), lo], [toWorldX(c + 0.5), hi]] });
        }
        void toWorldY;
      } else pushAll(result.strokes, toStrokes(r.segs, win, canvas, row));
    } else if (truth.type === 'param') {
      pushAll(result.strokes, toStrokes(referenceSegments(truth.curves.map(compileCurve), win, canvas, truth.ignore ?? [], 400_000).segs, win, canvas, row));
    } else if (truth.type === 'implicit') {
      pushAll(result.strokes, toStrokes(referenceImplicit(compile2(truth.F), win, canvas, truth.step ?? 0.5), win, canvas, row));
    } else if (truth.type === 'region') {
      const F = compile2(truth.F);
      const { toWorldX, toWorldY } = projector(win, canvas);
      const inside = (x: number, y: number) => {
        const v = F(x, y);
        if (!Number.isFinite(v)) return false;
        return truth.rel === '<' ? v < 0 : truth.rel === '<=' ? v <= 0 : truth.rel === '>' ? v > 0 : v >= 0;
      };
      const regions: RegionPlot[] = [];
      const grid = 3;
      for (let py = 0; py < canvas.h; py += grid) {
        let start: number | null = null;
        const cy = py + grid / 2;
        for (let px = 0; px <= canvas.w; px += grid) {
          const on = px < canvas.w && inside(toWorldX(px + grid / 2), toWorldY(cy));
          if (on && start === null) start = px;
          if (!on && start !== null) {
            const poly: Pt[] = [[toWorldX(start), toWorldY(py)], [toWorldX(px), toWorldY(py)], [toWorldX(px), toWorldY(py + grid)], [toWorldX(start), toWorldY(py + grid)]];
            regions.push({ ...(row === undefined ? {} : { row }), polygon: poly, strict: truth.rel === '<' || truth.rel === '>' });
            start = null;
          }
        }
      }
      result.regions = regions;
      const border = truth.borderCurves ? referenceSegments(truth.borderCurves.map(compileCurve), win, canvas, [], 400_000).segs : referenceImplicit(F, win, canvas, 0.5);
      pushAll(result.strokes, toStrokes(border, win, canvas, row));
    } else if (truth.type === 'points') {
      result.points = truth.points.map(([x, y]): PlotPoint => ({ x, y, kind: 'point', ...(row === undefined ? {} : { row }) }));
    }
  }
  if (item.poi) {
    const poiRow = item.task.pointsOfInterest?.row ?? 0;
    const pts: PlotPoint[] = result.points ?? [];
    if (poiRow >= 0) {
      for (const x of item.poi.roots ?? []) pts.push({ x, y: 0, kind: 'root', row: poiRow });
      for (const [x, y] of item.poi.max ?? []) pts.push({ x, y, kind: 'maximum', row: poiRow });
      for (const [x, y] of item.poi.min ?? []) pts.push({ x, y, kind: 'minimum', row: poiRow });
      if (item.poi.yInt !== undefined && item.poi.yInt !== null && win.xMin <= 0 && win.xMax >= 0) pts.push({ x: 0, y: item.poi.yInt, kind: 'yIntercept', row: poiRow });
    } else for (const [x, y] of item.poi.cross ?? []) pts.push({ x, y, kind: 'intersection' });
    result.points = pts;
  }
  if (item.expectParams) result.parameters = [...item.expectParams];
  return result;
}

/** Adapter that answers from the ground truth of the items (self-tests, upper bound). */
export function referenceGraphAdapter(items: GraphItem[]): GraphAdapter {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    name: 'reference (ground truth, upper bound)',
    plot(task: GraphTask) {
      const item = byId.get(task.id);
      if (!item) throw new Error(`unknown item ${task.id}`);
      return referencePlot(item);
    },
  };
}
