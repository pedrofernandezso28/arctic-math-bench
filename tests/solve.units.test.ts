import { describe, expect, it } from 'vitest';
import { loadSolveItems } from '../src/data.js';
import { judgeSolve } from '../src/solve/judge.js';
import type { SolveAnswer } from '../src/types.js';

const items = loadSolveItems();
const byInput = (input: string, kind?: string) => {
  const found = items.find((i) => i.task.input === input && (!kind || i.task.kind === kind));
  if (!found) throw new Error(`no item for ${input}`);
  return found;
};
const cls = (input: string, answer: SolveAnswer | null, kind?: string) => judgeSolve(byInput(input, kind), answer).class;

describe('solve judge: specific behaviours', () => {
  it('equivalent spellings of one solution set are accepted (intervals are merged)', () => {
    const i = 'x^2 - 5x + 6 >= 0';
    expect(cls(i, { type: 'intervals', intervals: [{ lo: '-Infinity', hi: 2, hiClosed: true }, { lo: 3, hi: 'Infinity', loClosed: true }] })).toBe('CORRECT');
    expect(cls(i, { type: 'intervals', intervals: [{ lo: '-Infinity', hi: 1, hiClosed: true }, { lo: 0, hi: 2, hiClosed: true }, { lo: 3, hi: 'Infinity', loClosed: true }] })).toBe('CORRECT');
  });

  it('open versus closed endpoints matter', () => {
    expect(cls('x^2 - 4 < 0', { type: 'intervals', intervals: [{ lo: -2, hi: 2, loClosed: true, hiClosed: true }] })).toBe('WRONG');
  });

  it('the overflow cases are judged in 64 digits', () => {
    expect(cls('e^x = 10^500', { type: 'values', values: ['500*ln(10)'] })).toBe('CORRECT');
    expect(cls('e^x = 10^500', { type: 'values', values: ['1151.2925464970229'] })).toBe('CORRECT');
    expect(cls('e^x = 10^500', { type: 'values', values: ['1000'] })).toBe('WRONG');
    expect(cls('log(x) = 400', { type: 'values', values: ['10^400'] })).toBe('CORRECT');
    expect(cls('ln(x) < 1000', { type: 'intervals', intervals: [{ lo: 0, hi: 'e^1000' }] })).toBe('CORRECT');
    expect(cls('ln(x) < 1000', { type: 'intervals', intervals: [{ lo: 0, hi: 'Infinity' }] })).toBe('WRONG');
  });

  it('trig: a particular solution is not a general solution, and the period of sin(x/2) is 4 pi', () => {
    expect(cls('sin(x/2) = 1', { type: 'values', families: ['pi + 4*k*pi'] })).toBe('CORRECT');
    expect(cls('sin(x/2) = 1', { type: 'values', families: ['pi + 2*k*pi'] })).toBe('WRONG');
    expect(cls('sin(x/2) = 1', { type: 'values', values: ['pi'] })).toBe('INCOMPLETE');
  });

  it('degrees: families in degrees are read in degrees', () => {
    const i = items.find((x) => x.task.options?.angleUnit === 'deg' && x.task.input === 'sin(x) = 1/2')!;
    expect(judgeSolve(i, { type: 'values', families: ['30 + 360*k', '150 + 360*k'] }).class).toBe('CORRECT');
    expect(judgeSolve(i, { type: 'values', families: ['pi/6 + 2*k*pi', '5*pi/6 + 2*k*pi'] }).class).not.toBe('CORRECT');
  });

  it('an identity off some points must name the points', () => {
    const i = '(x-1)/(x-1) = 1';
    expect(cls(i, { type: 'all', except: [1] })).toBe('CORRECT');
    expect(cls(i, { type: 'all' })).toBe('INCOMPLETE');
    expect(cls(i, { type: 'none' })).toBe('WRONG');
    expect(cls(i, { type: 'intervals', intervals: [{ lo: '-Infinity', hi: 1 }, { lo: 1, hi: 'Infinity' }] })).toBe('CORRECT');
  });

  it('a derivative is judged by finite differences, not by text', () => {
    expect(cls('sin(x^2)', { type: 'expression', expr: '2*x*cos(x^2)' })).toBe('CORRECT');
    expect(cls('sin(x^2)', { type: 'expression', expr: 'cos(x^2)*x*2' })).toBe('CORRECT');
    expect(cls('sin(x^2)', { type: 'expression', expr: 'cos(x^2)' })).toBe('WRONG');
    expect(cls('sin(x^2)', { type: 'expression', expr: "y = 2*x*cos(x^2)" })).toBe('CORRECT');
  });

  it('antiderivatives may carry any constant', () => {
    expect(cls('cos(3x)', { type: 'expression', expr: 'sin(3x)/3 + C' })).toBe('CORRECT');
    expect(cls('cos(3x)', { type: 'expression', expr: 'sin(3x)/3 + 17' })).toBe('CORRECT');
    expect(cls('cos(3x)', { type: 'expression', expr: 'sin(3x)' })).toBe('WRONG');
  });

  it('ODE: a general solution needs its constants, an implicit one is checked along the flow', () => {
    expect(cls("y' = 2y; y(0) = 3", { type: 'expression', expr: '3e^(2x)' })).toBe('CORRECT');
    expect(cls("y' = 2y; y(0) = 3", { type: 'expression', expr: '5e^(2x)' })).toBe('WRONG');
    expect(cls("y'' + 9y = 0", { type: 'expression', expr: 'C1*cos(3x)' })).toBe('INCOMPLETE');
    expect(cls("y' = e^(x - y)", { type: 'implicit', expr: 'e^y - e^x' })).toBe('CORRECT');
    expect(cls("y' = e^(x - y)", { type: 'implicit', expr: 'e^y + e^x' })).toBe('WRONG');
  });

  it('limits: infinity, one-sided, does not exist', () => {
    expect(cls('1/x', { type: 'number', value: 'Infinity' }, 'limit')).toBe('WRONG');
    expect(cls('1/x', { type: 'dne' }, 'limit')).toBeDefined();
    const right = items.find((x) => x.task.kind === 'limit' && x.task.input === '1/x' && x.task.options?.side === 'right')!;
    expect(judgeSolve(right, { type: 'number', value: 'Infinity' }).class).toBe('CORRECT');
    expect(judgeSolve(right, { type: 'dne' }).class).toBe('WRONG');
  });

  it('a refused answer is REFUSED and never mistaken for a wrong one', () => {
    expect(cls('2x + 3 = 7', { type: 'refused' })).toBe('REFUSED');
    expect(cls('2x + 3 = 7', null)).toBe('REFUSED');
  });

  it('simplify / factor: equivalent but not in the requested form is INCOMPLETE', () => {
    expect(cls('x^3 - x', { type: 'expression', expr: 'x*(x-1)*(x+1)' }, 'factor')).toBe('CORRECT');
    expect(cls('x^3 - x', { type: 'expression', expr: 'x^3 - x' }, 'factor')).toBe('INCOMPLETE');
    expect(cls('x^3 - x', { type: 'expression', expr: 'x^3 - 2x' }, 'factor')).toBe('WRONG');
  });
});
