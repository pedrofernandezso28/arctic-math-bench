#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGraphItems, loadSolveItems } from './data.js';
import { formatTable, graphMarkdown, benchGraph, benchSolve, solveMarkdown, summarizeGraph, summarizeGraphDrawing, summarizeSolve, type RunOptions } from './runner.js';
import type { GraphAdapter, SolveAdapter } from './types.js';

const USAGE = `arctic-math-bench: an engine-agnostic benchmark for math solvers and graphing engines

Usage:
  arctic-math-bench solve --adapter ./my-adapter.mjs [options]
  arctic-math-bench graph --adapter ./my-adapter.mjs [options]
  arctic-math-bench list  solve|graph

Options:
  --adapter <file>     module exporting the adapter (default export, or a named export "adapter", or a factory function)
  --category <a,b>     only these categories (solve) or groups (graph)
  --kind <a,b>         only these task kinds (solve)
  --level <a,b>        school levels (solve: lower-secondary, upper-secondary, university) or codes 1,2,3 (graph)
  --id <regex>         only items whose id matches
  --limit <n>          run at most n items
  --timeout <ms>       per-item timeout (default 30000)
  --out <dir>          where to write the JSON and Markdown reports (default ./bench-results)
  --format <f>         json, md or both (default both)
  --answers            keep the raw answers in the JSON report
  --quiet              no progress line
  -h, --help           this text
`;

function parseArgs(argv: string[]): { cmd: string; rest: string[]; flags: Record<string, string | true> } {
  const [cmd = '', ...tail] = argv;
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const a = tail[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = tail[i + 1];
      if (next !== undefined && !next.startsWith('--') && !['answers', 'quiet'].includes(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else if (a === '-h') flags.help = true;
    else rest.push(a);
  }
  return { cmd, rest, flags };
}

async function loadAdapter<T>(file: string, method: 'solve' | 'plot'): Promise<T> {
  const mod = (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>;
  let candidate: unknown = mod.default ?? mod.adapter ?? mod;
  if (candidate && typeof (candidate as Record<string, unknown>).default === 'object') candidate = (candidate as Record<string, unknown>).default;
  if (typeof candidate === 'function' && typeof (candidate as unknown as Record<string, unknown>)[method] !== 'function') candidate = await (candidate as () => unknown)();
  if (!candidate || typeof (candidate as Record<string, unknown>)[method] !== 'function') throw new Error(`${file} does not export an adapter with a ${method}() method`);
  return candidate as T;
}

const list = (v: string | true | undefined): string[] | undefined => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

async function main(): Promise<number> {
  const { cmd, rest, flags } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }
  if (cmd === 'list') {
    const items = rest[0] === 'graph' ? loadGraphItems().map((i) => ({ id: i.id, group: i.group })) : loadSolveItems().map((i) => ({ id: i.id, group: i.category }));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.group] = (counts[i.group] ?? 0) + 1;
    for (const [g, n] of Object.entries(counts)) process.stdout.write(`${g}\t${n}\n`);
    process.stdout.write(`total\t${items.length}\n`);
    return 0;
  }
  if (cmd !== 'solve' && cmd !== 'graph') {
    process.stderr.write(`unknown command "${cmd}"\n\n${USAGE}`);
    return 2;
  }
  if (typeof flags.adapter !== 'string') {
    process.stderr.write(`--adapter is required\n\n${USAGE}`);
    return 2;
  }
  const quiet = !!flags.quiet;
  const opts: RunOptions = {
    idPattern: typeof flags.id === 'string' ? new RegExp(flags.id) : undefined,
    categories: list(flags.category),
    kinds: list(flags.kind),
    levels: list(flags.level),
    limit: typeof flags.limit === 'string' ? Number(flags.limit) : undefined,
    timeoutMs: typeof flags.timeout === 'string' ? Number(flags.timeout) : undefined,
    includeAnswers: !!flags.answers,
    onProgress: quiet ? undefined : (done, total) => process.stderr.write(`\r${done}/${total}`),
  };
  const outDir = resolve(typeof flags.out === 'string' ? flags.out : 'bench-results');
  const format = typeof flags.format === 'string' ? flags.format : 'both';
  mkdirSync(outDir, { recursive: true });
  if (cmd === 'solve') {
    const adapter = await loadAdapter<SolveAdapter>(flags.adapter, 'solve');
    const name = adapter.name ?? String(flags.adapter);
    const results = await benchSolve(adapter, loadSolveItems(), opts);
    if (!quiet) process.stderr.write('\n');
    const summary = summarizeSolve(results);
    if (format !== 'md') writeFileSync(join(outDir, 'solve.json'), JSON.stringify({ adapter: name, summary, results }, null, 1));
    if (format !== 'json') writeFileSync(join(outDir, 'solve.md'), solveMarkdown(name, results));
    process.stdout.write(`adapter: ${name}\n\n${formatTable(summary, 'solve')}\nreports in ${outDir}\n`);
  } else {
    const adapter = await loadAdapter<GraphAdapter>(flags.adapter, 'plot');
    const name = adapter.name ?? String(flags.adapter);
    const results = await benchGraph(adapter, loadGraphItems(), opts);
    if (!quiet) process.stderr.write('\n');
    const summary = summarizeGraph(results);
    if (format !== 'md') writeFileSync(join(outDir, 'graph.json'), JSON.stringify({ adapter: name, summary, drawingOnly: summarizeGraphDrawing(results), results }, null, 1));
    if (format !== 'json') writeFileSync(join(outDir, 'graph.md'), graphMarkdown(name, results));
    process.stdout.write(`adapter: ${name}\n\n${formatTable(summary, 'graph')}\n${formatTable([summarizeGraphDrawing(results)], 'graph')}\nreports in ${outDir}\n`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
