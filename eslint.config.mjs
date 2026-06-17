import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'tests/behavior/fixtures/**', 'eslint.config.mjs'] }, // standalone — ONLY the ignores key
  js.configs.recommended,
  {
    files: ['src/main/**', 'src/shared/**', 'src/preload/chrome-preload.js', 'test/**', '*.config.{js,mjs}'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] }
  },
  {
    // internal-preload.js runs in a sandbox:true + contextIsolation:true preload context:
    // it can require('electron') (contextBridge/ipcRenderer) AND has browser globals
    // (location, window, etc.) available at preload inject time.
    files: ['src/preload/internal-preload.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] }
  },
  {
    files: ['scripts/**'], // Node ESM scripts (CI helpers)
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] }
  },
  {
    files: ['src/preload/webview-preload.js'], // runs in page main world: node (ipcRenderer) AND DOM
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] }
  },
  {
    files: ['src/renderer/**/*.js'], // plain browser script + injected globals
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, isSafeTabUrl: 'readonly', isSafePosterUrl: 'readonly', isInternalPageUrl: 'readonly', windowPage: 'readonly', countNewer: 'readonly', activeLogOf: 'readonly', reduceAudit: 'readonly' }
    }
  },
  eslintConfigPrettier // last — Prettier owns formatting
];
