import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'tests/behavior/fixtures/**', 'eslint.config.mjs'] }, // standalone — ONLY the ignores key
  js.configs.recommended,
  {
    // find-overlay-preload.js and menu-overlay-preload.js are chrome-class (M05 F7 DD1 /
    // F8 DD8) — they stay in this node-globals block alongside chrome-preload.js.
    files: ['src/main/**', 'src/shared/**', 'src/preload/chrome-preload.js', 'src/preload/find-overlay-preload.js', 'src/preload/menu-overlay-preload.js', 'test/**', '*.config.{js,mjs}'],
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
    // Dual-export module that DEFINES menuController/focusItem: CJS export (module)
    // for the test runner + globalThis branch for the renderer. Matched before the
    // generic renderer block so it is NOT given menuController/focusItem as injected
    // globals (it owns the definitions — those would trip no-redeclare).
    files: ['src/renderer/menu-controller.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.node } }
  },
  {
    files: ['src/renderer/**/*.js'], // plain browser script + injected globals
    ignores: ['src/renderer/menu-controller.js'], // it DEFINES the menu globals (own block above)
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, isSafeTabUrl: 'readonly', isSafePosterUrl: 'readonly', isInternalPageUrl: 'readonly', keydownToAction: 'readonly', menuController: 'readonly', focusItem: 'readonly', windowPage: 'readonly', countNewer: 'readonly', activeLogOf: 'readonly', reduceAudit: 'readonly', pageList: 'readonly', pageCount: 'readonly', isSafeColor: 'readonly', deriveSiteInfo: 'readonly', buildContainerModel: 'readonly', pageContextModel: 'readonly', BURNER: 'readonly', resolveNewTabContainer: 'readonly', inheritContainerDecision: 'readonly', inheritFromPartition: 'readonly', buildJarPageModel: 'readonly', PALETTE: 'readonly', buildAutomationIndicatorModel: 'readonly', JAR_DATA_CLASSES: 'readonly', jarDataClassById: 'readonly' }
    }
  },
  eslintConfigPrettier // last — Prettier owns formatting
];
