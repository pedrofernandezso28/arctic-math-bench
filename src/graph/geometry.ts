/**
 * Independent references and the comparison against what the engine drew. Nothing here imports an engine:
 * references are plain Math.* functions stored with the data.
 *
 * Curves (y = f(x), polar, parametric) are compared in pixel space of the task canvas:
 *  - reference polyline: adaptive subdivision of the true curve until every chord is <= 0.5 px; an interval
 *    that still moves > 0.5 px after ~60 bisections is a discontinuity (jump or pole) and is left open;
 *    an undefined endpoint is bisected to the domain edge.
 *  - deviation: every drawn stroke inside the canvas is sampled every 1 px; distance to the nearest reference chord.
 *  - coverage: every reference chord inside the canvas is sampled every 1 px; distance to the nearest drawn stroke.
 * Implicit curves: reference = own marching squares on the sign of F on a 0.5 px lattice (edge roots by bisection,
 * rejected when |F| at the root does not shrink: a pole is not a root), then the same two distances.
 * Inequalities: engine region polygons vs the sign of F on a 3 px grid, a band near the true border excluded.
 */
import type { ParamCurve } from './runtime.js';

export type Px = { x: number; y: number };
export type Seg = [Px, Px];
export type Win = { xMin: number; xMax: number; yMin: number; yMax: number };
export type Canvas = { w: number; h: number };
/** World x intervals where the truth is not judged. */
export type IgnoreList = Array<[number, number]>;

const MARGIN = 40;

class SegHash {
  private cells = new Map<number, Seg[]>();
  constructor(private size: number) {}
  private key(i: number, j: number) {
    return (i + 2000) * 100000 + (j + 2000);
  }
  add(s: Seg) {
    const i0 = Math.floor(Math.min(s[0].x, s[1].x) / this.size);
    const i1 = Math.floor(Math.max(s[0].x, s[1].x) / this.size);
    const j0 = Math.floor(Math.min(s[0].y, s[1].y) / this.size);
    const j1 = Math.floor(Math.max(s[0].y, s[1].y) / this.size);
    if (i1 - i0 > 400 || j1 - j0 > 400) {
      // very long segment (should not happen after clipping): split
      const mid = { x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 };
      this.add([s[0], mid]);
      this.add([mid, s[1]]);
      return;
    }
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(s);
      }
  }
  /** Distance to the nearest segment, searching up to `radius` px (returns radius+1 if none). */
  nearest(p: Px, radius: number): number {
    // Exact: widen the search until the best distance found fits inside the searched radius.
    const ci = Math.floor(p.x / this.size);
    const cj = Math.floor(p.y / this.size);
    for (const step of [this.size, 2 * this.size, 4 * this.size, 8 * this.size, radius]) {
      const R = Math.min(step, radius);
      let best = radius + 1;
      const r = Math.ceil(R / this.size);
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          const list = this.cells.get(this.key(ci + di, cj + dj));
          if (!list) continue;
          for (const s of list) {
            const d = segDist(p, s[0], s[1]);
            if (d < best) best = d;
          }
        }
      if (best <= R || R >= radius) return best;
    }
    return radius + 1;
  }
}

export function segDist(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!(l2 > 0)) return Math.hypot(p.x - a.x, p.y - a.y);
  let r = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  r = r < 0 ? 0 : r > 1 ? 1 : r;
  return Math.hypot(p.x - (a.x + dx * r), p.y - (a.y + dy * r));
}

/** Liang-Barsky clip of a segment to a rectangle; null when outside. */
function clip(a: Px, b: Px, x0: number, y0: number, x1: number, y1: number): Seg | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

export type Projector = { toPx: (x: number, y: number) => Px; toWorldX: (px: number) => number; toWorldY: (py: number) => number };
export function projector(win: Win, canvas: Canvas): Projector {
  const kx = canvas.w / (win.xMax - win.xMin);
  const ky = canvas.h / (win.yMax - win.yMin);
  return {
    toPx: (x, y) => ({ x: (x - win.xMin) * kx, y: (win.yMax - y) * ky }),
    toWorldX: (px) => win.xMin + px / kx,
    toWorldY: (py) => win.yMax - py / ky,
  };
}

const finitePx = (p: Px) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Reference chords of a parametric curve in pixel space (see header). */
export function referenceSegments(curves: ParamCurve[], win: Win, canvas: Canvas, ignore: IgnoreList = [], cap = 1_500_000): { segs: Seg[]; breaks: Px[]; incomplete: boolean } {
  const { toPx } = projector(win, canvas);
  const segs: Seg[] = [];
  const breaks: Px[] = [];
  let budget = cap;
  let incomplete = false;
  const ignored = (x: number) => ignore.some(([a, b]) => x >= a && x <= b);
  const offSameSide = (a: Px, b: Px) =>
    (a.x < -MARGIN && b.x < -MARGIN) || (a.x > canvas.w + MARGIN && b.x > canvas.w + MARGIN) || (a.y < -MARGIN && b.y < -MARGIN) || (a.y > canvas.h + MARGIN && b.y > canvas.h + MARGIN);
  for (const curve of curves) {
    const evalPx = (t: number): Px | null => {
      const [x, y] = curve.p(t);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const q = toPx(x, y);
      return finitePx(q) ? q : null;
    };
    const worldX = (t: number) => curve.p(t)[0];
    const refine = (ta: number, pa: Px | null, tb: number, pb: Px | null, depth: number): void => {
      if (budget-- <= 0) {
        incomplete = true;
        return;
      }
      if (pa && pb) {
        if (offSameSide(pa, pb)) return;
        const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (d <= 0.5) {
          segs.push([pa, pb]);
          return;
        }
        if (ignored(worldX(ta)) && ignored(worldX(tb))) return;
        const tm = 0.5 * (ta + tb);
        if (depth >= 64 || !(tm > ta && tm < tb)) {
          breaks.push(pa, pb);
          return;
        }
        const pm = evalPx(tm);
        refine(ta, pa, tm, pm, depth + 1);
        refine(tm, pm, tb, pb, depth + 1);
        return;
      }
      if (!pa && !pb) {
        if (depth >= 4) return;
        const tm = 0.5 * (ta + tb);
        const pm = evalPx(tm);
        if (!pm) return;
        refine(ta, null, tm, pm, depth + 1);
        refine(tm, pm, tb, null, depth + 1);
        return;
      }
      // one side undefined: walk to the domain edge
      const tm = 0.5 * (ta + tb);
      if (depth >= 64 || !(tm > ta && tm < tb)) return;
      const pm = evalPx(tm);
      refine(ta, pa, tm, pm, depth + 1);
      refine(tm, pm, tb, pb, depth + 1);
    };
    const n = curve.base ?? 4000;
    let tPrev = curve.t0;
    let pPrev = evalPx(tPrev);
    for (let i = 1; i <= n; i++) {
      const t = curve.t0 + ((curve.t1 - curve.t0) * i) / n;
      const p = evalPx(t);
      refine(tPrev, pPrev, t, p, 0);
      tPrev = t;
      pPrev = p;
    }
  }
  return { segs, breaks, incomplete };
}

/** Own marching squares on a `step`-px lattice: sign changes of F with a residual check. */
export function referenceImplicit(F: (x: number, y: number) => number, win: Win, canvas: Canvas, step = 0.5): Seg[] {
  const { toWorldX, toWorldY } = projector(win, canvas);
  const nx = Math.ceil(canvas.w / step);
  const ny = Math.ceil(canvas.h / step);
  const val = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const v = F(toWorldX(i * step), toWorldY(j * step));
      val[j * (nx + 1) + i] = Number.isFinite(v) ? v : Number.NaN;
    }
  const at = (i: number, j: number) => val[j * (nx + 1) + i]!;
  // edge root in pixels between lattice points (i0,j0)-(i1,j1), or null
  const root = (i0: number, j0: number, i1: number, j1: number): Px | null => {
    const a = at(i0, j0);
    const b = at(i1, j1);
    if (!(Number.isFinite(a) && Number.isFinite(b))) return null;
    if (a === 0 && b === 0) return null;
    if ((a > 0) === (b > 0) && a !== 0 && b !== 0) return null;
    let lo = 0;
    let hi = 1;
    let flo = a;
    const x0 = i0 * step;
    const y0 = j0 * step;
    const dx = (i1 - i0) * step;
    const dy = (j1 - j0) * step;
    let fm = 0;
    for (let k = 0; k < 40; k++) {
      const m = 0.5 * (lo + hi);
      fm = F(toWorldX(x0 + dx * m), toWorldY(y0 + dy * m));
      if (!Number.isFinite(fm)) return null;
      if (fm === 0) {
        lo = hi = m;
        break;
      }
      if ((fm > 0) === (flo > 0)) {
        lo = m;
        flo = fm;
      } else hi = m;
    }
    // pole check: a true root makes |F| tiny compared to the corner values
    if (Math.abs(fm) > 1e-3 * Math.max(Math.abs(a), Math.abs(b)) && Math.abs(fm) > 1e-9) return null;
    const m = 0.5 * (lo + hi);
    return { x: x0 + dx * m, y: y0 + dy * m };
  };
  const segs: Seg[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const pts = [root(i, j, i + 1, j), root(i + 1, j, i + 1, j + 1), root(i, j + 1, i + 1, j + 1), root(i, j, i, j + 1)].filter((p): p is Px => p !== null);
      if (pts.length === 2) segs.push([pts[0]!, pts[1]!]);
      else if (pts.length === 4) {
        segs.push([pts[0]!, pts[1]!]);
        segs.push([pts[2]!, pts[3]!]);
        segs.push([pts[0]!, pts[3]!]);
        segs.push([pts[1]!, pts[2]!]);
      } else if (pts.length === 3) {
        segs.push([pts[0]!, pts[1]!]);
        segs.push([pts[1]!, pts[2]!]);
      }
    }
  return segs;
}

export type CurveVerdict = {
  /** largest distance from a drawn point (inside the canvas) to the true curve, px (capped at 30) */
  maxDevPx: number;
  /** drawn length (px) farther than 1 px / 3 px from the truth */
  roughLenPx: number;
  falseLenPx: number;
  /** true curve length (px, inside canvas) with nothing drawn within 2 px */
  missingLenPx: number;
  refLenPx: number;
  drawnLenPx: number;
  worstFalse: { x: number; y: number; devPx: number } | null;
  worstMissing: { x: number; y: number } | null;
  missingSpans: Array<{ x0: number; x1: number; y0: number; y1: number; lenPx: number }>;
  refIncomplete: boolean;
};

/** Compare drawn strokes against reference chords (both pixel space). */
export function compareCurves(drawn: Seg[], reference: Seg[], win: Win, canvas: Canvas, ignore: IgnoreList = [], refIncomplete = false, missTol = 2): CurveVerdict {
  const { toWorldX, toWorldY } = projector(win, canvas);
  const ignored = (px: number) => {
    const x = toWorldX(px);
    return ignore.some(([a, b]) => x >= a && x <= b);
  };
  const refHash = new SegHash(4);
  let refLen = 0;
  const refIn: Seg[] = [];
  for (const s of reference) {
    const c = clip(s[0], s[1], -MARGIN, -MARGIN, canvas.w + MARGIN, canvas.h + MARGIN);
    if (!c) continue;
    refHash.add(c);
    const inside = clip(c[0], c[1], 0, 0, canvas.w, canvas.h);
    if (inside) {
      refIn.push(inside);
      refLen += Math.hypot(inside[1].x - inside[0].x, inside[1].y - inside[0].y);
    }
  }
  const drawnHash = new SegHash(4);
  let drawnLen = 0;
  const drawnIn: Seg[] = [];
  for (const s of drawn) {
    if (!finitePx(s[0]) || !finitePx(s[1])) continue;
    const c = clip(s[0], s[1], -MARGIN, -MARGIN, canvas.w + MARGIN, canvas.h + MARGIN);
    if (!c) continue;
    drawnHash.add(c);
    const inside = clip(c[0], c[1], 0, 0, canvas.w, canvas.h);
    if (inside) {
      drawnIn.push(inside);
      drawnLen += Math.hypot(inside[1].x - inside[0].x, inside[1].y - inside[0].y);
    }
  }
  let maxDev = 0;
  let rough = 0;
  let falseLen = 0;
  let worstFalse: CurveVerdict['worstFalse'] = null;
  for (const [a, b] of drawnIn) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      if (ignored(p.x)) continue;
      const d = refHash.nearest(p, 30);
      const w = k === 0 || k === n ? (0.5 * len) / n : len / n;
      if (d > maxDev) maxDev = d;
      if (d > 1) rough += w;
      if (d > 3) {
        falseLen += w;
        if (!worstFalse || d > worstFalse.devPx) worstFalse = { x: toWorldX(p.x), y: toWorldY(p.y), devPx: d };
      }
    }
  }
  let missing = 0;
  let worstMissing: CurveVerdict['worstMissing'] = null;
  const spans: CurveVerdict['missingSpans'] = [];
  let open: CurveVerdict['missingSpans'][number] | null = null;
  for (const [a, b] of refIn) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      if (ignored(p.x)) continue;
      const d = drawnHash.nearest(p, missTol + 1);
      const w = k === 0 || k === n ? (0.5 * len) / n : len / n;
      if (d > missTol) {
        missing += w;
        const wx = toWorldX(p.x);
        const wy = toWorldY(p.y);
        if (!worstMissing) worstMissing = { x: wx, y: wy };
        if (open) {
          open.x0 = Math.min(open.x0, wx);
          open.x1 = Math.max(open.x1, wx);
          open.y0 = Math.min(open.y0, wy);
          open.y1 = Math.max(open.y1, wy);
          open.lenPx += w;
        } else {
          open = { x0: wx, x1: wx, y0: wy, y1: wy, lenPx: w };
          spans.push(open);
        }
      } else open = null;
    }
  }
  return {
    maxDevPx: Math.min(30, maxDev),
    roughLenPx: rough,
    falseLenPx: falseLen,
    missingLenPx: missing,
    refLenPx: refLen,
    drawnLenPx: drawnLen,
    worstFalse,
    worstMissing,
    missingSpans: spans.filter((s) => s.lenPx >= 1).sort((p, q) => q.lenPx - p.lenPx).slice(0, 6),
    refIncomplete,
  };
}

/**
 * Column envelope judge for y = f(x) when the true curve oscillates faster than the pixels (the chord reference would
 * need millions of chords): per pixel column, the true [min, max] of f (golden-ratio samples per column) against
 * the vertical extent of the drawn strokes in that column. Missing = true extent not covered (> 2 px short);
 * false = drawn beyond the true extent by > 3 px.
 */
export function compareEnvelope(drawn: Seg[], f: (x: number) => number, win: Win, canvas: Canvas): CurveVerdict {
  const { toWorldX, toWorldY } = projector(win, canvas);
  const ky = canvas.h / (win.yMax - win.yMin);
  const cols: Array<{ lo: number; hi: number } | null> = Array.from({ length: canvas.w }, () => null);
  for (const [a, b] of drawn) {
    if (!finitePx(a) || !finitePx(b)) continue;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    for (let c = Math.max(0, Math.floor(x0)); c <= Math.min(canvas.w - 1, Math.floor(x1)); c++) {
      const s = clip(a, b, c, -MARGIN, c + 1, canvas.h + MARGIN);
      if (!s) continue;
      const lo = Math.max(0, Math.min(s[0].y, s[1].y));
      const hi = Math.min(canvas.h, Math.max(s[0].y, s[1].y));
      if (hi < 0 || lo > canvas.h || lo > hi) continue;
      const cur = cols[c];
      cols[c] = cur ? { lo: Math.min(cur.lo, lo), hi: Math.max(cur.hi, hi) } : { lo, hi };
    }
  }
  let missing = 0;
  let falseLen = 0;
  let maxDev = 0;
  let refLen = 0;
  let drawnLen = 0;
  let worstFalse: CurveVerdict['worstFalse'] = null;
  let worstMissing: CurveVerdict['worstMissing'] = null;
  const PHI = 0.6180339887498949;
  for (let c = 0; c < canvas.w; c++) {
    let tmin = Infinity;
    let tmax = -Infinity;
    // 4096 samples: enough to come within ~1e-3 column of a pole, so the envelope of tan reaches the canvas edges
    for (let k = 0; k < 4096; k++) {
      const v = f(toWorldX(c + ((k * PHI) % 1)));
      if (Number.isFinite(v)) {
        if (v < tmin) tmin = v;
        if (v > tmax) tmax = v;
      }
    }
    const e = cols[c];
    if (e) drawnLen += e.hi - e.lo;
    if (!(tmax >= tmin)) {
      if (e && e.hi - e.lo > 3) {
        falseLen += e.hi - e.lo;
        worstFalse = { x: toWorldX(c), y: toWorldY(e.lo), devPx: e.hi - e.lo };
      }
      continue;
    }
    const top = Math.max(0, (win.yMax - tmax) * ky);
    const bottom = Math.min(canvas.h, (win.yMax - tmin) * ky);
    if (top > canvas.h || bottom < 0) continue;
    refLen += Math.max(1, bottom - top);
    if (!e) {
      missing += Math.max(1, bottom - top);
      worstMissing ??= { x: toWorldX(c), y: toWorldY(top) };
      continue;
    }
    const shortTop = e.lo - top;
    const shortBottom = bottom - e.hi;
    if (shortTop > 2 || shortBottom > 2) {
      missing += Math.max(0, shortTop) + Math.max(0, shortBottom);
      worstMissing ??= { x: toWorldX(c), y: toWorldY(shortTop > 2 ? top : bottom) };
    }
    const overTop = top - e.lo;
    const overBottom = e.hi - bottom;
    const over = Math.max(overTop, overBottom);
    if (over > maxDev) maxDev = over;
    if (over > 3) {
      falseLen += Math.max(0, overTop) + Math.max(0, overBottom);
      if (!worstFalse || over > worstFalse.devPx) worstFalse = { x: toWorldX(c), y: toWorldY(overTop > overBottom ? e.lo : e.hi), devPx: over };
    }
  }
  return { maxDevPx: Math.min(30, maxDev), roughLenPx: 0, falseLenPx: falseLen, missingLenPx: missing, refLenPx: refLen, drawnLenPx: drawnLen, worstFalse, worstMissing, missingSpans: [], refIncomplete: false };
}

export function polylinesToSegs(polylines: Px[][]): Seg[] {
  const segs: Seg[] = [];
  for (const line of polylines) for (let i = 1; i < line.length; i++) segs.push([line[i - 1]!, line[i]!]);
  return segs;
}

/** Point-in-polygon (even-odd) over the engine region polygons on a grid, vs the sign of the truth. */
export function compareRegion(regions: Px[][], inside: (x: number, y: number) => boolean | null, win: Win, canvas: Canvas, gridPx = 3, bandPx = 3) {
  const { toWorldX, toWorldY } = projector(win, canvas);
  type Poly = { pts: Px[]; x0: number; x1: number; y0: number; y1: number };
  const polys: Poly[] = regions
    .filter((pts) => pts.length >= 3)
    .map((pts) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      return { pts, x0, x1, y0, y1 };
    });
  const rowSize = 8;
  const rows = new Map<number, Poly[]>();
  for (const poly of polys) {
    const r0 = Math.max(Math.floor(poly.y0 / rowSize), -50);
    const r1 = Math.min(Math.floor(poly.y1 / rowSize), Math.ceil(canvas.h / rowSize) + 50);
    for (let r = r0; r <= r1; r++) {
      let l = rows.get(r);
      if (!l) {
        l = [];
        rows.set(r, l);
      }
      l.push(poly);
    }
  }
  const inPoly = (px: number, py: number) => {
    let count = 0;
    for (const poly of rows.get(Math.floor(py / rowSize)) ?? []) {
      if (px < poly.x0 || px > poly.x1 || py < poly.y0 || py > poly.y1) continue;
      let c = false;
      const pts = poly.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]!;
        const b = pts[j]!;
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      if (c) count++;
    }
    return count;
  };
  // band: a point is near the border when the truth changes (sign or definedness) within bandPx around it
  const near = (px: number, py: number) => {
    const s = inside(toWorldX(px), toWorldY(py));
    for (const [dx, dy] of [[bandPx, 0], [-bandPx, 0], [0, bandPx], [0, -bandPx], [bandPx, bandPx], [-bandPx, -bandPx], [bandPx, -bandPx], [-bandPx, bandPx]]) {
      if (inside(toWorldX(px + dx!), toWorldY(py + dy!)) !== s) return true;
    }
    return false;
  };
  let tested = 0;
  let falseIn = 0;
  let falseOut = 0;
  let overlap = 0;
  const examples: Array<{ x: number; y: number; truth: boolean | null; engine: number }> = [];
  for (let py = gridPx / 2; py < canvas.h; py += gridPx)
    for (let px = gridPx / 2; px < canvas.w; px += gridPx) {
      if (near(px, py)) continue;
      const truth = inside(toWorldX(px), toWorldY(py));
      const engine = inPoly(px, py);
      tested++;
      if (engine > 1) overlap++;
      const shaded = engine > 0;
      if (truth === true && !shaded) {
        falseOut++;
        if (examples.length < 5) examples.push({ x: toWorldX(px), y: toWorldY(py), truth, engine });
      }
      if (truth !== true && shaded) {
        falseIn++;
        if (examples.length < 5) examples.push({ x: toWorldX(px), y: toWorldY(py), truth, engine });
      }
    }
  return { tested, falseIn, falseOut, overlap, mismatchFrac: (falseIn + falseOut) / Math.max(1, tested), examples };
}

/** 5 significant digits, the way a point label is written. */
export function label5(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) < 1e-12) return '0';
  return String(Number(v.toPrecision(5)));
}
