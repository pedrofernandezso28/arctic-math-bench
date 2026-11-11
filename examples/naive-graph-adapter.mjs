// A naive uniform sampler. It plots explicit rows y = f(x), polar rows r = f(theta), parametric rows (x(t), y(t))
// and single points, sampling the window at a fixed number of equally spaced parameter values and joining
// every pair of finite neighbours. It does no adaptive refinement, does not detect poles, draws no implicit
// curves, no inequalities, no points of interest. It scores low on purpose: it is a naive baseline.
//
// Run: node dist/cli.js graph --adapter examples/naive-graph-adapter.mjs
import { create, all } from 'mathjs';

const math = create(all, {});
const nativeLog = math.log;
math.import({ ln: (x) => nativeLog(x), log: (x, b) => (b === undefined ? math.log10(x) : nativeLog(x) / nativeLog(b)), sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x) }, { override: true });

const SAMPLES = 400;

const prep = (s) => s.replace(/θ|theta/g, 't').replace(/\|([^|]+)\|/g, 'abs($1)').replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/,(\d)/g, '.$1');

function compile(text) {
  try {
    return math.parse(prep(text));
  } catch {
    return null;
  }
}

const freeSymbols = (node) => {
  const out = new Set();
  node.traverse((n, _p, parent) => {
    if (n.isSymbolNode && !(parent && parent.isFunctionNode && parent.fn === n)) out.add(n.name);
  });
  return [...out];
};

function evalAt(code, scope) {
  try {
    const v = code.evaluate(scope);
    return typeof v === 'number' ? v : NaN;
  } catch {
    return NaN;
  }
}

function polyline(fn, t0, t1) {
  const strokes = [];
  let cur = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = t0 + ((t1 - t0) * i) / SAMPLES;
    const p = fn(t);
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) cur.push(p);
    else if (cur.length) {
      strokes.push(cur);
      cur = [];
    }
  }
  if (cur.length) strokes.push(cur);
  return strokes;
}

export default {
  name: 'naive uniform sampler (400 samples, no refinement)',
  plot(task) {
    const [x0, x1] = task.window;
    const dom = task.parameterDomain ?? { min: 0, max: 2 * Math.PI };
    const strokes = [];
    const points = [];
    const parameters = new Set();
    const errors = {};
    task.rows.forEach((raw, row) => {
      const text = raw.trim();
      const rangeMatch = /\{\s*([-\d.π/a-z*]+)\s*<=?\s*[tθ]\s*<=?\s*([-\d.π/a-z*]+)\s*\}\s*$/.exec(text);
      const body = rangeMatch ? text.slice(0, rangeMatch.index).trim() : text;
      const lo = rangeMatch ? Number(math.evaluate(prep(rangeMatch[1]))) : dom.min;
      const hi = rangeMatch ? Number(math.evaluate(prep(rangeMatch[2]))) : dom.max;
      const scope = { ...Object.fromEntries(Object.entries(task.params ?? {})) };
      const add = (list) => list.forEach((points) => strokes.push({ row, points }));
      const withDefaults = (node) => {
        for (const s of freeSymbols(node)) {
          if (!['x', 't', 'y', 'e', 'pi', 'i'].includes(s) && !(s in scope)) scope[s] = 1;
          if (!['x', 't', 'y', 'e', 'pi', 'i', 'f', 'g', 'h'].includes(s) && s.length === 1) parameters.add(s);
        }
      };
      // point (a, b)
      const pt = /^\(\s*([^,]+?)\s*,\s*([^,]+?)\s*\)$/.exec(body);
      if (pt && !/[tx]/.test(pt[1] + pt[2])) {
        const a = compile(pt[1]);
        const b = compile(pt[2]);
        if (a && b) {
          withDefaults(a);
          withDefaults(b);
          points.push({ x: evalAt(a, scope), y: evalAt(b, scope), kind: 'point', row });
          return;
        }
      }
      // parametric (x(t), y(t))
      if (pt) {
        const a = compile(pt[1]);
        const b = compile(pt[2]);
        if (a && b) {
          withDefaults(a);
          withDefaults(b);
          add(polyline((t) => [evalAt(a, { ...scope, t }), evalAt(b, { ...scope, t })], lo, hi));
          return;
        }
      }
      // polar r = f(t)
      const polar = /^r\s*=\s*(.+)$/.exec(body);
      if (polar) {
        const f = compile(polar[1]);
        if (f) {
          withDefaults(f);
          add(polyline((t) => {
            const r = evalAt(f, { ...scope, t });
            return [r * Math.cos(t), r * Math.sin(t)];
          }, lo, hi));
        }
        return;
      }
      // explicit y = f(x), possibly with a restriction {..} that this adapter ignores
      const explicit = /^(?:y\s*=\s*)?([^=<>{}]+?)(?:\s*\{[^}]*\})?$/.exec(body);
      if (explicit && !/\by\b/.test(explicit[1])) {
        const f = compile(explicit[1]);
        if (f) {
          withDefaults(f);
          add(polyline((x) => [x, evalAt(f, { ...scope, x })], x0, x1));
          return;
        }
      }
      // everything else (implicit curves, inequalities, own functions, ...) is not drawn
    });
    return { strokes, points, parameters: [...parameters], ...(Object.keys(errors).length ? { errors } : {}) };
  },
};
