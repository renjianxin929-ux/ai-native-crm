import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isBundledCliBuild = process.env.CRM_BUNDLED_CLI_BUILD === '1';
const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  ...(isBundledCliBuild
    ? {
      // The packaged CLI must not resolve any JavaScript dependency from a
      // source checkout. This build-only alias supplies better-sqlite3 with
      // the staged native addon path from the installed sidecar runtime.
      resolve: {
        alias: {
          'better-sqlite3': resolve(projectRoot, 'src/cli/bundledBetterSqlite3.ts'),
        },
      },
      ssr: {
        noExternal: true,
      },
    }
    : {}),
  optimizeDeps: {
    exclude: ['better-sqlite3'],
  },
  build: {
    rollupOptions: {
      ...(isBundledCliBuild ? {} : { external: ['better-sqlite3'] }),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
