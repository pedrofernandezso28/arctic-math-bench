import { describe, expect, it } from 'vitest';
import { loadGraphItems } from '../src/data.js';
import { judgeGraph } from '../src/graph/judge.js';
import { referencePlot } from '../src/graph/oracle.js';

/** Self-test: the plot drawn from the ground truth must be CORRECT for every item of this shard. */
export function graphShard(index: number, count: number): void {
  const items = loadGraphItems().filter((_, i) => i % count === index);
  describe(`graph: truths accepted by their own judge (shard ${index + 1}/${count}, ${items.length} items)`, () => {
    for (const item of items) {
      it(item.id, async () => {
        await new Promise((r) => setImmediate(r)); // let the runner talk to its parent: long sync suites otherwise hit an RPC timeout
        const v = judgeGraph(item, referencePlot(item));
        expect(v.class, v.reasons.join(' | ')).toBe('CORRECT');
      });
    }
  });
}
