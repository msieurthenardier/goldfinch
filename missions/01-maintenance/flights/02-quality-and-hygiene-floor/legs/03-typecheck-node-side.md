# Leg: typecheck-node-side

**Status**: completed
**Flight**: [Quality & Hygiene Floor](../flight.md)

## Objective
Stand up JS type-checking (F11) and bring the **Node-side** source files (main process, preload bridge, shared, main helpers) to zero type errors via per-file `// @ts-check` — leaving the DOM-heavy renderer for the next leg.

## Context
- Flight DD "Type-checking — whole codebase (F11)", sub-split seam (a). **Leg-level refinement**: use **per-file `// @ts-check`** with `checkJs` left **off** in `jsconfig.json`, rather than `checkJs:true`. Rationale: `checkJs:true` checks *every* `.js` in scope immediately, which would block this leg on renderer errors; per-file `@ts-check` lets the Node side land clean now and the renderer land in Leg 4. End state after both legs is identical (every source file annotated → checked).
- `strict` is **off** for this first adoption (type-correctness only, no `strictNullChecks` flood); can tighten in a later cycle.
- Files in this leg are Node/Electron (no DOM): `src/main/main.js`, `src/preload/chrome-preload.js`, `src/main/shields.js`, `src/main/trackers.js`, `src/main/jars.js`, `src/main/download-path.js`, `src/shared/url-safety.js`. (`renderer.js` + `webview-preload.js` → Leg 4.)
- Electron ships its own types (the `electron` package `types` field), so `require('electron')` resolves typed.

## Inputs
- The seven Node-side source files above.
- `package.json` (add devDeps + script).

## Outputs
- `jsconfig.json` (new) — `allowJs:true`, `checkJs:false`, `noEmit:true`, `target:"es2022"`, `lib:["es2022"]` (no DOM — Node side), `module:"commonjs"`, `moduleResolution:"node"`, `strict:false`, `skipLibCheck:true`, `types:["node"]`; `include:["src/**/*.js"]`.
- `package.json` — devDeps `typescript`, `@types/node`; `"typecheck": "tsc --noEmit -p jsconfig.json"`.
- `src/main/session-augments.d.ts` (new) — module augmentation declaring the dynamic flags so zero suppressions hold: `declare module 'electron' { interface Session { __goldfinchShields?: boolean; __goldfinchDownloads?: boolean } }`.
- The seven files — `// @ts-check` at top + JSDoc annotations to resolve diagnostics.
- `src/shared/url-safety.js` — restructure the dual-export to **if/else** so `require` (Node/tests) gets `module.exports` and the renderer `<script>` branch sets the global; cast `globalThis` to `any` to satisfy `@ts-check`. This also fixes the debrief Node-global-pollution item (Node no longer gets the global):
  ```js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isSafeTabUrl, isSafePosterUrl };
  } else {
    /** @type {any} */ (globalThis).isSafeTabUrl = isSafeTabUrl;
    /** @type {any} */ (globalThis).isSafePosterUrl = isSafePosterUrl;
  }
  ```
  Re-run `npm test` — tests use `require` (the `module.exports` branch), so they stay green; the renderer loads it as a classic `<script>` (no `module`), so it still gets the globals.

## Acceptance Criteria
- [ ] `jsconfig.json` exists with the options above; `npm run typecheck` runs `tsc --noEmit -p jsconfig.json`.
- [ ] Each of the seven Node-side files starts with `// @ts-check` and type-checks with **zero errors**.
- [ ] `@ts-expect-error`/`@ts-ignore` count across these files is **0** (Node/Electron code should be fully typable with JSDoc; reserve the suppression budget for Leg 4's `<webview>` spots). If any spot genuinely needs one, document the reason inline and flag it in the leg log.
- [ ] `url-safety.js` dual-export restructured to if/else (`module.exports` for `require`; cast-`any` `globalThis` global only in the `<script>` else-branch); `npm test` still green.
- [ ] `renderer.js`/`webview-preload.js` are NOT yet `@ts-check`'d (no annotation) — so `npm run typecheck` is clean even though they're in `include`.
- [ ] `npm run typecheck` exits 0; `npm test` still passes (147+).
- [ ] devDeps installed and committed in `package.json`/`package-lock.json` (this leg runs `npm install --save-dev typescript @types/node`).

## Verification Steps
- `npm run typecheck` → exits 0.
- `grep -L "@ts-check" src/main/*.js src/preload/chrome-preload.js src/shared/url-safety.js` → empty (all seven annotated). (`renderer.js`/`webview-preload.js` intentionally NOT annotated yet.)
- `grep -rn "@ts-ignore\|@ts-expect-error" src/main src/preload/chrome-preload.js src/shared` → none (or documented).
- `npm test` → green.

## Implementation Guidance
1. `npm install --save-dev typescript @types/node` (checker only — no TS source, no build change).
2. Write `jsconfig.json` (see Outputs). Keep `checkJs:false`; rely on `// @ts-check` per file. `include: ["src/**/*.js"]`.
3. Add `"typecheck": "tsc --noEmit -p jsconfig.json"` to `package.json` scripts.
4. For each Node-side file: add `// @ts-check`, run `npm run typecheck`, resolve diagnostics with JSDoc (`@param`/`@returns`/`@type`, `@typedef` for shared shapes — e.g. an IPC payload typedef in `chrome-preload.js`/`main.js`). Prefer real annotations over suppression. **Known friction points (per design review)**: `globalThis.*` writes (use the `@type {any}` cast); `ses.__goldfinchShields`/`__goldfinchDownloads` (covered by the `session-augments.d.ts` augmentation — no cast needed); `webContents.fromId()` returns `WebContents|undefined` (annotate as such, not `|null`). With `strict:false`, null-access patterns (`mainWindow.webContents` etc.) do **not** error, so zero suppressions is achievable.
5. Restructure `url-safety.js` dual-export to the if/else form above. Re-run `npm test`.
6. Add `src/main/session-augments.d.ts` (Session augmentation) — it's a `.d.ts` in `include`, picked up automatically.
7. Confirm renderer/webview-preload remain unannotated (Leg 4 handles them).

## Edge Cases
- **Electron type resolution**: if `require('electron')` doesn't resolve types, ensure `skipLibCheck:true` and that `electron` is installed (it is). Do not add `@types/electron` (Electron ships its own).
- **`process`/`__dirname`/Node globals**: covered by `@types/node` + `types:["node"]`.
- **CommonJS `module.exports`**: `module:"commonjs"` so `require`/`module.exports` type correctly.
- **No behavior change**: `@ts-check` + JSDoc are comments/annotations only; the sole runtime change is the `url-safety` `globalThis` guard — covered by `npm test`.

## Files Affected
- `jsconfig.json` (new), `src/main/session-augments.d.ts` (new), `package.json`/`package-lock.json` (devDeps + script)
- `src/main/main.js`, `src/main/shields.js`, `src/main/trackers.js`, `src/main/jars.js`, `src/main/download-path.js`, `src/preload/chrome-preload.js`, `src/shared/url-safety.js` — `@ts-check` + annotations (+ url-safety global guard)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`) + `npm run typecheck` clean
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 3 of 7)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
