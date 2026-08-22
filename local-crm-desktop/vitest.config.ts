import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    env: {
      VITE_ALLOW_MEMORY_DB: 'true',
    },
  },
});
