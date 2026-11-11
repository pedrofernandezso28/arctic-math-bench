import type { GraphAdapter, GraphClass, GraphTask, PlotResult, SolveAdapter, SolveAnswer, SolveClass, SolveTask } from './types.js';
import type { SolveItem } from './solve/truth.js';
import type { GraphItem } from './graph/truth.js';
import { judgeSolve } from './solve/judge.js';
import { judgeGraph } from './graph/judge.js';

export interface RunOptions {
  /** Only items whose id matches. */
  idPattern?: RegExp;
  /** Only these categories (solve) or groups (graph). */
  categories?: string[];
  /** Only these task kinds (solve). */
  kinds?: string[];
  /** Only these school levels (solve) or school codes 1..3 (graph, as strings). */
  levels?: string[];
  /** Run at most this many items (after filtering). */
  limit?: number;
  /** Per-item timeout in ms (default 30000). A synchronous busy loop in the adapter cannot be interrupted. */
  timeoutMs?: number;
  /** Include the raw answer / plot size in the results. */
  includeAnswers?: boolean;
  onProgress?: (done: number, total: number, last: { id: string; class: string }) => void;
}

export interface SolveResult {
  id: string;
  category: string;
  level: string;
  kind: string;
  input: string;
  class: SolveClass;
  why: string;
  how: string;
  ms: number;
  answer?: SolveAnswer | null;
  error?: string;
}

export interface GraphResult {
  id: string;
  group: string;
  school: number;
  rows: string[];
  class: GraphClass;
  /** Class when only the drawing is judged (points of interest ignored). */
  drawingClass: GraphClass;
  /** Whether the item has a drawing truth (curve, region or dots), so `drawingClass` means something. */
  hasDrawingTruth: boolean;
  /** Whether the item asks for points of interest. */
  hasPoi: boolean;
  reasons: string[];
  metrics?: Record<string, number | string | null>;
  ms: number;
  error?: string;
}

function withTimeout<T>(p: Promise<T> | T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function pick<T extends { id: string }>(items: T[], opts: RunOptions, extra: (i: T) => boolean): T[] {
  let list = items.filter((i) => (!opts.idPattern || opts.idPattern.test(i.id)) && extra(i));
  if (opts.limit !== undefined) list = list.slice(0, opts.limit);
  return list;
}

export async function benchSolve(adapter: SolveAdapter, items: SolveItem[], opts: RunOptions = {}): Promise<SolveResult[]> {
  const list = pick(items, opts, (i) => (!opts.categories || opts.categories.includes(i.category)) && (!opts.kinds || opts.kinds.includes(i.task.kind)) && (!opts.levels || opts.levels.includes(i.level)));
  const out: SolveResult[] = [];
  for (const item of list) {
    const task: SolveTask = { id: item.id, ...item.task };
    const t0 = performance.now();
    let answer: SolveAnswer | null = null;
    let error: string | undefined;
    try {
      answer = await withTimeout(adapter.solve(structuredClone(task)), opts.timeoutMs ?? 30000);
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    }
    const ms = Math.round(performance.now() - t0);
    const verdict = error ? { class: 'REFUSED' as SolveClass, why: error, how: '' } : judgeSolve(item, answer);
    out.push({
      id: item.id, category: item.category, level: item.level, kind: item.task.kind, input: item.task.input, class: verdict.class, why: verdict.why, how: verdict.how, ms,
      ...(opts.includeAnswers ? { answer } : {}), ...(error ? { error } : {}),
    });
    opts.onProgress?.(out.length, list.length, { id: item.id, class: verdict.class });
  }
  return out;
}

export async function benchGraph(adapter: GraphAdapter, items: GraphItem[], opts: RunOptions = {}): Promise<GraphResult[]> {
  const list = pick(items, opts, (i) => (!opts.categories || opts.categories.includes(i.group)) && (!opts.levels || opts.levels.includes(String(i.school))));
  const out: GraphResult[] = [];
  for (const item of list) {
    const task: GraphTask = { id: item.id, ...item.task };
    const t0 = performance.now();
    let result: PlotResult | null = null;
    let error: string | undefined;
    try {
      result = await withTimeout(adapter.plot(structuredClone(task)), opts.timeoutMs ?? 30000);
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    }
    const ms = Math.round(performance.now() - t0);
    const v = judgeGraph(item, result, error);
    out.push({
      id: item.id, group: item.group, school: item.school, rows: item.task.rows, class: v.class, drawingClass: v.drawingClass, hasDrawingTruth: !!item.truth, hasPoi: !!item.poi, reasons: v.reasons,
      ...(v.metrics ? { metrics: v.metrics } : {}), ms, ...(error ? { error } : {}),
    });
    opts.onProgress?.(out.length, list.length, { id: item.id, class: v.class });
  }
  return out;
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export const SOLVE_CLASSES: SolveClass[] = ['CORRECT', 'WRONG', 'INCOMPLETE', 'REFUSED'];
export const GRAPH_CLASSES: GraphClass[] = ['CORRECT', 'WRONG', 'MISSING', 'ROUGH', 'REFUSED'];

export interface SummaryRow {
  name: string;
  n: number;
  counts: Record<string, number>;
  /** CORRECT / n, in percent with one decimal. */
  score: number;
}

function summarize(rows: Array<{ key: string; cls: string }>, classes: string[]): SummaryRow[] {
  const keys = [...new Set(rows.map((r) => r.key))];
  const make = (name: string, list: typeof rows): SummaryRow => {
    const counts = Object.fromEntries(classes.map((c) => [c, list.filter((r) => r.cls === c).length]));
    return { name, n: list.length, counts, score: list.length ? Math.round((1000 * (counts.CORRECT ?? 0)) / list.length) / 10 : 0 };
  };
  return [...keys.map((k) => make(k, rows.filter((r) => r.key === k))), make('ALL', rows)];
}

export const summarizeSolve = (results: SolveResult[], by: 'category' | 'level' | 'kind' = 'category'): SummaryRow[] => summarize(results.map((r) => ({ key: r[by], cls: r.class })), SOLVE_CLASSES);
export const summarizeGraph = (results: GraphResult[], by: 'group' | 'school' = 'group'): SummaryRow[] => summarize(results.map((r) => ({ key: String(r[by]), cls: r.class })), GRAPH_CLASSES);

/** Drawing-only summary: items with a drawing truth, points of interest ignored. */
export const summarizeGraphDrawing = (results: GraphResult[]): SummaryRow => {
  const list = results.filter((r) => r.hasDrawingTruth);
  const rows = summarize(list.map((r) => ({ key: 'drawing', cls: r.drawingClass })), GRAPH_CLASSES);
  return { ...rows[rows.length - 1]!, name: 'drawing only' };
};

function table(rows: SummaryRow[], classes: string[]): string {
  const head = `| name | n | ${classes.join(' | ')} | score |\n|---|---:|${classes.map(() => '---:').join('|')}|---:|\n`;
  return head + rows.map((r) => `| ${r.name === 'ALL' ? '**ALL**' : r.name} | ${r.n} | ${classes.map((c) => r.counts[c] ?? 0).join(' | ')} | ${r.score.toFixed(1)} % |`).join('\n') + '\n';
}

export function solveMarkdown(adapterName: string, results: SolveResult[]): string {
  let md = `# arctic-math-bench: solve results\n\nAdapter: ${adapterName}\n\nItems run: ${results.length}. score = CORRECT / n.\n\n## By category\n\n${table(summarizeSolve(results, 'category'), SOLVE_CLASSES)}\n## By school level\n\n${table(summarizeSolve(results, 'level'), SOLVE_CLASSES)}\n## By task kind\n\n${table(summarizeSolve(results, 'kind'), SOLVE_CLASSES)}\n`;
  for (const cls of ['WRONG', 'INCOMPLETE', 'REFUSED'] as SolveClass[]) {
    const list = results.filter((r) => r.class === cls);
    if (!list.length) continue;
    md += `\n## ${cls} (${list.length})\n\n`;
    for (const r of list.slice(0, 400)) md += `- **${r.id}** \`${r.input.replace(/`/g, "'")}\`: ${r.why.replace(/\n/g, ' ').slice(0, 220)}\n`;
    if (list.length > 400) md += `- ... and ${list.length - 400} more (see the JSON file)\n`;
  }
  return md;
}

export function graphMarkdown(adapterName: string, results: GraphResult[]): string {
  const drawing = summarizeGraphDrawing(results);
  let md = `# arctic-math-bench: graph results\n\nAdapter: ${adapterName}\n\nItems run: ${results.length}. score = CORRECT / n. Overall class = worst of the drawing and the points of interest.\n\n## By group\n\n${table(summarizeGraph(results, 'group'), GRAPH_CLASSES)}\n## By school code (1 = every student, 2 = common in a course, 3 = occasional / stress)\n\n${table(summarizeGraph(results, 'school'), GRAPH_CLASSES)}\n## Drawing only (points of interest ignored)\n\n${table([drawing], GRAPH_CLASSES)}\n`;
  for (const cls of ['WRONG', 'MISSING', 'REFUSED', 'ROUGH'] as GraphClass[]) {
    const list = results.filter((r) => r.class === cls);
    if (!list.length) continue;
    md += `\n## ${cls} (${list.length})\n\n`;
    for (const r of list.slice(0, 400)) md += `- **${r.id}** \`${r.rows.join(' ; ').replace(/`/g, "'")}\`: ${r.reasons.join(' | ').slice(0, 220)}\n`;
    if (list.length > 400) md += `- ... and ${list.length - 400} more (see the JSON file)\n`;
  }
  return md;
}

export function formatTable(rows: SummaryRow[], suite: 'solve' | 'graph'): string {
  return table(rows, suite === 'solve' ? SOLVE_CLASSES : GRAPH_CLASSES);
}
