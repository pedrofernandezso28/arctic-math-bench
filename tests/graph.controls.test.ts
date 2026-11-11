import { describe, expect, it } from 'vitest';
import { loadGraphItems } from '../src/data.js';
import { judgeGraph } from '../src/graph/judge.js';
import { referencePlot } from '../src/graph/oracle.js';
import type { GraphItem } from '../src/graph/truth.js';
import type { PlotResult, Pt, Stroke } from '../src/types.js';

const items = loadGraphItems();
const get = (id: string): GraphItem => {
  const i = items.find((x) => x.id === id);
  if (!i) throw new Error(`no item ${id}`);
  return i;
};
const asStrokes = (r: PlotResult): Stroke[] => r.strokes.map((s) => (Array.isArray(s) ? { points: s } : s));
const pxSize = (i: GraphItem) => ({ dx: (i.task.window[1] - i.task.window[0]) / i.task.canvas.width, dy: (i.task.window[3] - i.task.window[2]) / i.task.canvas.height });
const shifted = (i: GraphItem, r: PlotResult, pxX: number, pxY: number): PlotResult => {
  const { dx, dy } = pxSize(i);
  return { ...r, strokes: asStrokes(r).map((s) => ({ ...s, points: s.points.map(([x, y]): Pt => [x + pxX * dx, y + pxY * dy]) })) };
};

describe('graph: negative controls', () => {
  const visibleCurves = items.filter((i, k) => i.truth && ['fn', 'fns', 'param', 'implicit'].includes(i.truth.type) && k % 3 === 0);
  describe('nothing drawn is MISSING for every curve item that is visible in its window (every 3rd item)', () => {
    for (const i of visibleCurves) {
      it(i.id, async () => {
        await new Promise((r) => setImmediate(r));
        const refPx = Number(judgeGraph(i, referencePlot(i)).metrics?.refPx ?? 0);
        if (refPx < 20) return; // nothing (or almost nothing) to see in this window
        expect(judgeGraph(i, { strokes: [] }).drawingClass).toBe('MISSING');
      });
    }
  });

  it('a curve shifted by 8 px is WRONG (or MISSING) on typical items', () => {
    for (const id of ['fn.x2.D', 'fn.sin.D', 'imp.circle25', 'polar.rose3', 'param.circle', 'lin.4x-7']) {
      const i = get(id);
      const v = judgeGraph(i, shifted(i, referencePlot(i), 6, 6));
      expect(['WRONG', 'MISSING'], `${id}: ${v.class} ${v.reasons.join('|')}`).toContain(v.class);
    }
  });

  it('a curve shifted by 1.6 px is ROUGH, not WRONG', () => {
    for (const id of ['fn.x2.D', 'fn.sin.D']) {
      const i = get(id);
      const v = judgeGraph(i, shifted(i, referencePlot(i), 0, 1.6));
      expect(v.class, `${id}: ${v.reasons.join('|')}`).toBe('ROUGH');
    }
  });

  it('half a curve is MISSING', () => {
    const i = get('fn.sin.D');
    const r = referencePlot(i);
    const half = { ...r, strokes: asStrokes(r).filter((s) => s.points[0]![0] < 0) };
    expect(judgeGraph(i, half).class).toBe('MISSING');
  });

  it('an engine error on a row is REFUSED; a thrown error is REFUSED', () => {
    const i = get('fn.x2.D');
    expect(judgeGraph(i, { strokes: [], errors: { '0': 'cannot read this row' } }).class).toBe('REFUSED');
    expect(judgeGraph(i, null, 'boom').class).toBe('REFUSED');
  });

  it('regions: the complement is WRONG, nothing shaded is MISSING, a wrong border style is WRONG', () => {
    const i = get('ineq.disk');
    const full = referencePlot(i);
    expect(judgeGraph(i, { ...full, regions: [] }).class).toBe('MISSING');
    const strictFlag = { ...full, regions: (full.regions ?? []).map((r) => ({ ...r, strict: false })) };
    expect(judgeGraph(i, strictFlag).class).toBe('WRONG');
    // shade the whole canvas: false everywhere outside the disk
    const [x0, x1, y0, y1] = i.task.window;
    const all = { ...full, regions: [{ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[], strict: true }] };
    expect(judgeGraph(i, all).class).toBe('WRONG');
  });

  it('dots: a missing dot is MISSING, an extra dot is WRONG', () => {
    const i = get('pts.two');
    expect(judgeGraph(i, referencePlot(i)).class).toBe('CORRECT');
    expect(judgeGraph(i, { strokes: [], points: [{ x: 1, y: 2 }] }).class).toBe('MISSING');
    expect(judgeGraph(i, { strokes: [], points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 9, y: 9 }] }).class).toBe('WRONG');
  });

  it('points of interest: missing, phantom and mislabelled points are caught', () => {
    const i = get('poi.x2minus4');
    const full = referencePlot(i);
    expect(judgeGraph(i, full).class).toBe('CORRECT');
    expect(judgeGraph(i, { strokes: [], points: (full.points ?? []).slice(1) }).class).toBe('MISSING');
    expect(judgeGraph(i, { strokes: [], points: [...(full.points ?? []), { x: 7, y: 0, kind: 'root' as const }] }).class).toBe('WRONG');
    expect(judgeGraph(i, { strokes: [], points: (full.points ?? []).map((p) => (p.kind === 'minimum' ? { ...p, y: p.y + 0.01 } : p)) }).class).toBe('WRONG');
  });

  it('corrected truth: two circles meet at (1, +-sqrt 3); two points sharing x must both be reported', () => {
    const i = get('poi2.sys.twoCircles');
    expect(i.poi?.cross).toEqual([[1, Math.sqrt(3)], [1, -Math.sqrt(3)]]);
    const both = [{ x: 1, y: Math.sqrt(3), kind: 'intersection' as const }, { x: 1, y: -Math.sqrt(3), kind: 'intersection' as const }];
    expect(judgeGraph(i, { strokes: [], points: both }).class).toBe('CORRECT');
    expect(judgeGraph(i, { strokes: [], points: [both[0]!] }).class).toBe('MISSING');
    expect(judgeGraph(i, { strokes: [], points: [both[0]!, both[0]!] }).class).not.toBe('CORRECT');
  });

  it('corrected truth: x^2+y^2=4 and x^2/9+y^2/4=1 touch at (0, +-2), not at (+-2, 0)', () => {
    const i = get('poi2.sys.circleEllipse');
    expect(i.poi?.cross).toEqual([[0, -2], [0, 2]]);
    const right = [{ x: 0, y: 2, kind: 'intersection' as const }, { x: 0, y: -2, kind: 'intersection' as const }];
    const old = [{ x: 2, y: 0, kind: 'intersection' as const }, { x: -2, y: 0, kind: 'intersection' as const }];
    expect(judgeGraph(i, { strokes: [], points: right }).class).toBe('CORRECT');
    expect(judgeGraph(i, { strokes: [], points: old }).class).not.toBe('CORRECT');
  });

  it('corrected truth: the border of x^2<y<4 includes the top edge y = 4 for |x| <= 2', () => {
    const i = get('ineq.chain');
    expect(i.truth?.type).toBe('region');
    const full = referencePlot(i);
    expect(judgeGraph(i, full).class).toBe('CORRECT');
    const noTop = { ...full, strokes: asStrokes(full).filter((s) => !s.points.every(([, y]) => Math.abs(y - 4) < 1e-6)) };
    expect(judgeGraph(i, noTop).class).toBe('MISSING');
  });

  it('a parameter that is not reported is MISSING', () => {
    const i = get('slider.default');
    const full = referencePlot(i);
    expect(judgeGraph(i, full).class).toBe('CORRECT');
    expect(judgeGraph(i, { ...full, parameters: [] }).class).toBe('MISSING');
  });
});
