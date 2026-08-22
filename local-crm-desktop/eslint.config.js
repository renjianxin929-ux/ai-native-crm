import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target/**', 'node_modules/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/__tests__/**'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Component modules are Fast Refresh boundaries. Page modules intentionally
    // expose pure projection helpers as their test seam, so they are linted by
    // TypeScript + React Hooks but are not treated as component-only modules.
    files: ['src/components/**/*.tsx', 'src/App.tsx', 'src/main.tsx'],
    extends: [reactRefresh.configs.vite],
  },
  {
    files: ['src/lib/i18n/LocaleProvider.tsx'],
    extends: [reactRefresh.configs.vite],
    rules: {
      'react-refresh/only-export-components': ['error', { allowExportNames: ['useAppLocale'] }],
    },
  },
  {
    files: ['src/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['scripts/**/*.{ts,tsx}', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
