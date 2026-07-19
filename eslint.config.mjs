import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'tests/behavior/fixtures/**', 'eslint.config.mjs'] }, // standalone — ONLY the ignores key
  js.configs.recommended,
  {
    // find-overlay-preload.js and menu-overlay-preload.js are chrome-class (M05 F7 DD1 /
    // F8 DD8) — they stay in this node-globals block alongside chrome-preload.js.
    // The four named src/shared/ files are the CJS-by-design carve-outs from the
    // M07 Flight 2 ESM conversion (automation-dev.js + internal-page.js are
    // preload-reachable — preload require graphs must stay ESM-free; dev-profile.js
    // + guest-forward-allowlist.js by zero-benefit ruling). They bind commonjs HERE;
    // the src/shared/** module block below ignores them so this binding survives
    // later-wins — that keeps the lint parse guard (an `export` in a preload-reachable
    // file must FAIL lint, the leg-1 blocker class).
    files: ['src/main/**', 'src/shared/automation-dev.js', 'src/shared/internal-page.js', 'src/shared/dev-profile.js', 'src/shared/guest-forward-allowlist.js', 'src/preload/chrome-preload.js', 'src/preload/find-overlay-preload.js', 'src/preload/menu-overlay-preload.js', 'test/**', '*.config.{js,mjs}'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // M09 F7 DD8 — destroyed-window rule (CLAUDE.md), complementing onWindowClosed
      // and test/unit/window-closed-invariant.test.js. A BaseWindow `closed` handler
      // must never read through the window: property access on a destroyed BaseWindow
      // THROWS, and an uncaught throw inside the native `closed` emission aborts the
      // listener chain AND permanently wedges the Wayland close path with zero error
      // output (the F6 leg-4 fix-cycle root cause).
      //
      // The `>` CHILD COMBINATOR IS LOAD-BEARING (recon S5): as a bare descendant
      // match the trailing MemberExpression also matches the `win.on` CALLEE itself,
      // firing on EVERY registration including correct ones — verified empirically on
      // a 14-case fixture via Linter.verify (7 findings, 4 false positives). Do not
      // "simplify" this selector; copy it verbatim.
      //
      // Scope note: this matches Electron's `'closed'` ONLY. Node's stream/server
      // `'close'` (used throughout automation/mcp-server.js) is a DIFFERENT event that
      // differs by exactly one character — do NOT widen the value to `'close'`.
      //
      // Known limits (which is why the WRAPPER is the primary net, not this rule):
      // defeated by aliasing (`const w = win`), indirection (`helper(win)`), and
      // MemberExpression objects (`this.win`, `rec.win`).
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name=/^(on|once)$/][arguments.0.value='closed'] > :matches(ArrowFunctionExpression, FunctionExpression) MemberExpression[object.name='win']",
          message:
            "Destroyed-window rule (CLAUDE.md): a `closed` handler must not read through `win` — a destroyed BaseWindow property access throws and wedges the native close path. Capture what you need at registration time; use onWindowClosed(win, handler) (main.js), which passes the captured winId."
        }
      ]
    }
  },
  {
    // M07 Flight 2 end-state: src/shared/ is real ESM. This block no longer
    // inherits from the commonjs block above (src/shared/** left its files),
    // so it carries the node globals and the house no-unused-vars rule itself.
    // The `ignores` entry is LOAD-BEARING: without it, later-wins would silently
    // re-bind the four CJS-by-design files to module and lose the parse guard
    // on exactly the preload-constrained files.
    files: ['src/shared/**'],
    ignores: [
      'src/shared/automation-dev.js',
      'src/shared/internal-page.js',
      'src/shared/dev-profile.js',
      'src/shared/guest-forward-allowlist.js'
    ],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
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
      // Only the menu-controller globals remain injected (DD6 carve-out — the
      // provider stays a classic script). The shared-module globals were retired
      // with the M07 Flight 2 ESM conversion: pages import what they use.
      globals: { ...globals.browser, menuController: 'readonly', focusItem: 'readonly' }
    }
  },
  {
    // M07 Flight 2 leg 5: the page controllers are ES modules now (import
    // their shared dependencies; renderer.js additionally publishes the
    // explicit evaluate-reachable seam). Later-wins over the renderer
    // script block above — sourceType flips to module; globals/rules merge,
    // so the browser globals (and the injected menu-controller globals)
    // persist. menu-controller.js is untouched — the product's one remaining
    // classic script (DD6 carve-out). jars-history-panel.js (M08 Flight 3,
    // Leg 2) is jars.js's panel-content module; jars-tabs.js (H4, M08
    // Flight 6, Leg 3) is jars.js's per-jar tab-widget module; jars-confirm-
    // modal.js (H7, M08 Flight 6, Leg 5) is jars.js's page-level confirm
    // modal module; jars-cookies-panel.js / jars-sitedata-panel.js (M10
    // Flight 2, Leg 2) are jars.js's Cookies / Other-site-data panel-content
    // modules — also real ES modules, the jars-history-panel.js precedent.
    files: [
      'src/renderer/renderer.js',
      'src/renderer/chrome/**/*.js',
      'src/renderer/pages/jars.js',
      'src/renderer/pages/jars-page-state.js',
      'src/renderer/pages/jars-nav-controller.js',
      'src/renderer/pages/jars-history-panel.js',
      'src/renderer/pages/jars-cookies-panel.js',
      'src/renderer/pages/jars-sitedata-panel.js',
      'src/renderer/pages/jars-tabs.js',
      'src/renderer/pages/jars-confirm-modal.js',
      'src/renderer/pages/settings.js',
      'src/renderer/menu-overlay.js'
    ],
    languageOptions: { sourceType: 'module' }
  },
  eslintConfigPrettier // last — Prettier owns formatting
];
