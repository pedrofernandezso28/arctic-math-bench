import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
    pool: 'forks',
    // the graph self-tests are CPU bound: keep the main process responsive
    maxWorkers: 3,
    minWorkers: 1,
  },
});
