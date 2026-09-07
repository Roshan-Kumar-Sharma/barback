import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The Temporal conformance suite starts a real (local) Temporal server and
    // exercises its retry policy, so it needs headroom the unit tests do not.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
