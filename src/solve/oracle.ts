import type { SolveAdapter, SolveTask } from '../types.js';
import type { SolveItem } from './truth.js';

/** Adapter that answers with the stored reference answer of each item (self-tests, upper bound). Not an engine. */
export function referenceSolveAdapter(items: SolveItem[]): SolveAdapter {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    name: 'reference answers (upper bound)',
    solve(task: SolveTask) {
      const item = byId.get(task.id);
      if (!item) throw new Error(`unknown item ${task.id}`);
      return item.reference;
    },
  };
}
