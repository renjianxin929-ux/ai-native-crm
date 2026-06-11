import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      VITE_ALLOW_MEMORY_DB: 'true',
    },
  },
});
