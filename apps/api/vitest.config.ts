import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globs, so a new `*.test.ts` runs the moment it exists — the old explicit file list let a
    // forgotten entry pass as a green suite.
    include: ['src/**/*.test.ts', 'drizzle/**/*.test.ts'],
    // The database tests share one schema; running their file alongside others is fine, but the
    // cases inside it must not interleave.
    sequence: { concurrent: false },
    // outlet.service.test.ts, rbac.service.test.ts and auth.service.test.ts all truncate one
    // shared `_test` database in beforeEach; running them in separate workers would interleave
    // their truncations across files, not just within one.
    fileParallelism: false,
  },
});
