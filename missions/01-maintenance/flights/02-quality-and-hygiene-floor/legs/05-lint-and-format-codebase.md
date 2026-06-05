# Leg: lint-and-format-codebase

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Adopt ESLint + Prettier across the whole repo (F10), run the auto-fix/format sweep, and declare a Node version floor (F9) — gated by a mandatory diff-review and the green test/typecheck suites so the sweep changes no behavior.

## Context
- Flight DD "Lint/format — whole-repo clean slate". Operator chose the clean-slate end state (whole-repo `eslint --fix` + Prettier) over a touched-files-only floor. **Mandatory mitigation (design review)**: `npm test` covers only `url-safety`/`download-path`/`jars`/`trackers`/`shields` — it does NOT observe `renderer.js`/`main.js`/`webview-preload.js` runtime behavior. So a **human diff-review** of the auto-fix diff (scanning for any semantic change — operator-precedence rewrites, ternary regrouping, `==`→`===` changes that alter coercion) is required before the leg lands; the test gate alone is insufficient.
- Pre-decided Prettier config: `singleQuote:true`, `trailingComma:'none'`, `printWidth:120` (matches existing style → minimizes churn).
- This leg runs AFTER the typecheck legs so it formats the JSDoc/`@ts-check` comments they added. Must keep `npm run typecheck` clean afterward.

## Inputs
- All `src/**` + `test/**` `.js`, `package.json`.

## Outputs
- `eslint.config.js` (flat) — exact structure (design review):
  ```js
  import js from '@eslint/js';
  import globals from 'globals';
  import eslintConfigPrettier from 'eslint-config-prettier';
  export default [
    { ignores: ['node_modules/**', 'dist/**', 'build/**', 'tests/behavior/fixtures/**'] }, // standalone — ONLY the ignores key
    js.configs.recommended,
    { files: ['src/main/**', 'src/shared/**', 'src/preload/chrome-preload.js', 'test/**', '*.config.js'],
      languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
      rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } },
    { files: ['src/preload/webview-preload.js'], // runs in page main world: node (ipcRenderer) AND DOM
      languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
      rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } },
    { files: ['src/renderer/**/*.js'], // plain browser script + injected globals
      languageOptions: { sourceType: 'script', globals: { ...globals.browser, isSafeTabUrl: 'readonly', isSafePosterUrl: 'readonly' } } },
    eslintConfigPrettier, // last — Prettier owns formatting
  ];
  ```
  Note: `src/shared/` is in the commonjs block (uses `module.exports`); `webview-preload.js` gets its own node+browser block; renderer is `sourceType:'script'` (no imports); `goldfinch` is NOT a global (always accessed as `window.goldfinch`).
- `.prettierrc` (or `prettier` key) — `{ singleQuote: true, trailingComma: "none", printWidth: 120 }`.
- `.prettierignore` — `node_modules`, `dist`, `build`, `package-lock.json`, `missions/`, `maintenance/`, `tests/`, `*.md` (keep the sweep to code; do NOT reformat the Flight Control markdown artifacts or README/CLAUDE — the docs leg owns those).
- `package.json` — devDeps `eslint`, `@eslint/js`, `globals`, `prettier`, `eslint-config-prettier`; scripts `"lint": "eslint ."`, `"format": "prettier --write ."`; `"engines": { "node": ">=20" }` (F9).
- The whole repo's `.js` — reformatted by Prettier + ESLint `--fix`.

## Acceptance Criteria
- [ ] `eslint.config.js` (flat config) exists; `eslint-config-prettier` is applied last so ESLint owns correctness and Prettier owns formatting (no rule conflicts). `ignores` includes `tests/behavior/fixtures/**`.
- [ ] Globals are configured so `no-undef` passes: `src/main`/`src/preload`/`test` get Node globals; `src/renderer` gets browser globals + the injected `isSafeTabUrl`/`isSafePosterUrl`/`goldfinch`.
- [ ] `.prettierrc` has `singleQuote:true`, `trailingComma:"none"`, `printWidth:120`; `.prettierignore` excludes docs/artifacts/markdown.
- [ ] `package.json` has `lint`/`format` scripts, the 5 devDeps, and `engines.node ">=20"` (F9).
- [ ] After the pre-fix cleanup + `eslint --fix .` + `prettier --write .`: **`npm run lint` exits 0** — expected with **no rule downgrades** (design review confirmed the config + cleanup suffices); a downgrade-to-`warn` is allowed only for an unforeseen disproportionate rule, with a rationale + report. **`npm test` is 147 green** (auto-fix changed no behavior), and **`npm run typecheck` is 0 errors** (formatting didn't break the `@ts-check` annotations).
- [ ] **Diff-review gate**: the implementer reviews the full sweep diff and confirms (in the leg log) that no change altered runtime semantics — call out anything that touched logic (precedence, equality operators, control flow) and justify or revert it. Genuinely dead code removed by a rule (e.g. the unused `pGroup` at `renderer.js:992`) is noted explicitly.

## Verification Steps
- `npm run lint` → exit 0.
- `npm test` → 147 pass.
- `npm run typecheck` → 0 errors.
- `git diff --stat` → review the breadth; spot-check `git diff` on `renderer.js`/`main.js` for any non-formatting (logic) change.

## Implementation Guidance
1. `npm install --save-dev eslint @eslint/js globals prettier eslint-config-prettier`.
2. Write `eslint.config.js` exactly per the Outputs template (the `ignores` object must contain ONLY the `ignores` key, or it becomes file-scoped and lints everything).
3. Write `.prettierrc` + `.prettierignore` (per Outputs). `.d.ts` files may be formatted (safe). Add scripts + `engines.node ">=20"` to `package.json`.
4. **Pre-`--fix` manual cleanup** (these 3 classes are NOT auto-fixable — do them first so the run ends clean):
   - Remove the dead `pGroup` function (`renderer.js`, ~`:1010`, defined-not-called — replaced by `pGroupStatus`).
   - Add a comment to the 3 truly-empty catches in `renderer.js` (~`:278`,`:279`,`:304`): `catch { /* webview not ready */ }`.
   - Convert the 6 unused `catch(e)` in `webview-preload.js` (~`:191`,`:203`,`:249`,`:284`,`:285`,`:287`) to bindingless `catch { /* reason */ }` (satisfies both `no-unused-vars` and `no-empty`).
5. Run `npx prettier --write .` then `npx eslint --fix .`. With the config + cleanup above, **`npm run lint` should reach exit 0 with no rule downgrades** (design review confirmed). Only if an unforeseen rule is genuinely disproportionate, downgrade *that* rule to `warn` with a one-line rationale — and report it.
6. Run `npm test` AND `npm run typecheck` — both must stay green. If a test flips, STOP, find the rule/format change that caused it, disable that rule (do not accept a behavior change).
7. **Diff-review (mandatory, not a rubber-stamp)**: `git diff` the sweep; for each non-test source file, scan specifically for *semantic* changes — operator-precedence rewrites, `==`↔`===`, control-flow, removed/added logic — distinct from pure whitespace/quote/semicolon formatting. Record an explicit verdict in the flight log ("reviewed N files; all changes formatting-only except {X}") + note the `pGroup` removal.

## Edge Cases
- **Markdown/artifacts**: `.prettierignore` must exclude `missions/`,`maintenance/`,`tests/`,`*.md` — otherwise Prettier reflows all the Flight Control artifacts and docs (noise + the docs leg's territory).
- **`@ts-check`/JSDoc survival**: Prettier preserves comments; re-run `npm run typecheck` to be sure the casts/typedefs still parse.
- **`no-unused-vars` on intentional unused** (e.g. `_event`, `_e` ipc params): the codebase uses `_`-prefixed throwaways — set `argsIgnorePattern: '^_'` so they don't error.
- **`globals` package**: use `globals.node`/`globals.browser` rather than hand-listing; avoids `no-undef` false positives on `process`/`document`/etc.
- **Behavior-test fixtures** don't exist yet (Leg 6 creates them) but the `ignores`/`.prettierignore` entries are in place so Leg 6 isn't re-linted.

## Files Affected
- `eslint.config.js`, `.prettierrc`, `.prettierignore` (new); `package.json`/`package-lock.json` (devDeps, scripts, engines)
- Whole repo `.js` under `src/`/`test/` — reformatted (+ any cheap lint fixes / dead-code removal)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`) + `npm run lint` exit 0 + `npm run typecheck` clean
- [ ] Diff-review verdict recorded in flight log
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 5 of 7)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
