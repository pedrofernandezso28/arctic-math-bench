import type { Interval, SolveAnswer, SolveTask } from '../types.js';

/** Ground truth of a solve item. Every type is checked by the judge against the ORIGINAL problem, never against engine output. */
export type Truth =
  | { type: 'roots'; values: string[] }
  | { type: 'complexRoots'; values: string[] }
  | { type: 'none' }
  | { type: 'identity'; except?: string[] }
  | { type: 'solutionSet'; set: Interval[] }
  | { type: 'symbolicRoots'; params: string[]; values: string[] }
  | { type: 'trig'; base: string[]; unit: 'rad' | 'deg' }
  | { type: 'inequality'; reference: Interval[]; structural?: boolean; sampling?: boolean }
  | { type: 'systemSolutions'; solutions: Array<Record<string, string>> }
  | { type: 'underdetermined' }
  | { type: 'derivative'; range?: [number, number]; at?: string }
  | { type: 'implicitDerivative'; expr: string; points: Array<[number, number]> }
  | { type: 'antiderivative'; range?: [number, number] }
  | { type: 'number'; value: string }
  | { type: 'diverges' }
  | { type: 'dne' }
  | { type: 'ode'; order: number; residual: string; rhs?: string; exact?: string; initial?: number[]; range?: [number, number] }
  | { type: 'matrix'; rows: string[][] }
  | { type: 'eigenvalues'; values: string[] }
  | { type: 'singular' }
  | { type: 'undefined' }
  | { type: 'vector'; values: string[] }
  | { type: 'closedForm'; variable: string; samples: Array<[number, string]> }
  | { type: 'polynomial'; expr: string; range?: [number, number] }
  | { type: 'equivalent'; forms?: string[]; range?: [number, number]; requireChange?: boolean };

export interface SolveItem {
  id: string;
  category: string;
  level: 'lower-secondary' | 'upper-secondary' | 'university';
  task: Omit<SolveTask, 'id'>;
  truth: Truth;
  /** Plain-math version of the input, used by the judge when the typed input is a student spelling the judge cannot read. */
  judgeAs?: string;
  /** One valid answer in the neutral grammar (used by the self-tests and by the reference adapter). */
  reference: SolveAnswer;
  note?: string;
}
