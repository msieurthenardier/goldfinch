# Leg: window-capture

**Status**: completed
**Flight**: [Decompose main.js and Restore renderer.js Headroom](../flight.md)

## Objective

Move `grabWindow`, the window-capture composite behind MCP `captureWindow`, out of `src/main/main.js` into a new `src/main/window-capture.js` (`createWindowGrabber(deps)`). Behaviour stays byte-identical, and every source-scan pin that reads the capture code from `main.js` is re-targeted to the new file.

## Context

- **Flight Design Decision:** "lowest hazard first". The window-capture block (maintenance report 2026-11-18, main.js extraction map, block 2) goes first.
- **The block:** `main.js` `async function grabWindow(windowId)`, from the comment "Grab a screenshot of the main window" (~:776) to the closing brace before "Create + start a fresh MCP server instance" (~:1039), about 260 lines.
  - It resolves the record once (`registry.get` / `registry.getLastFocused`).
  - It tries `desktopCapturer` unless running on Wayland, and falls back to a chrome-plus-guest canvas composite through `executeJavaScript`.
  - It layers the sheet ONLY when the sheet's current menu type is in `AUTOMATABLE_MENU_TYPES` (imported from the resolver), and never composites the save prompt.
  - Its failure paths throw `captureFailure(...)` and go through `withCaptureTimeout` / `captureWithOneRetry`. `pickSourceByMediaSourceId` chooses the desktop source.
- **What it closes over** (identifiers resolved at main.js top level): `registry` (~:494), `app` and `desktopCapturer` (the electron require, ~:3–19), `AUTOMATABLE_MENU_TYPES` (~:199), `captureFailure`, `withCaptureTimeout`, `captureWithOneRetry` (~:172–173), `pickSourceByMediaSourceId` (~:169), `applyGuestVisibility` (~:148; check whether it is used or only mentioned), and `path` (~:20; check). `record.htmlFullscreen` is a property read, not the `htmlFullscreen` module.
- **Consumers:** `main.js` passes `grabWindow` into the `app-lifecycle` deps (`app-lifecycle.js` `grabWindow` → the `createEngine` deps). `automation/engine.js` / `observe.js` `captureWindow({ grabWindow })` is its only caller.
- **TDZ checklist (CLAUDE.md planning rule):** `grabWindow` is a hoisted function declaration today, so it can be referenced above its definition. After the move it becomes `const grabWindow = createWindowGrabber({...}).grabWindow` (or similar). Every reference to `grabWindow` in `main.js` must sit BELOW that construction, or go through a getter. Grep every use.
- **Source-scan pins that read `main.js` for this code** (each must be re-targeted, not deleted):
  - `test/unit/capture-window-failure-pins.test.js`: reads `main.js` and slices `async function grabWindow(` with `findMatchingBracket`.
  - `test/unit/sheet-automation-gate-invariant.test.js` AC7: `readMasked('main', 'main.js')` asserts `grabRec.sheet && grabRec.sheet.isVisible()` and that the allowlist is imported, not re-typed. The same file has other `main.js` reads (the engine sites, ~:261) that STAY on `main.js`.
  - `test/unit/save-prompt-automation-guard.test.js`: `MAIN` reads `main.js`. Some of its pins are about the engine sites (they stay); any that are about the capture composite move.
  - `test/unit/capture-timeout.test.js` and `test/unit/capture-source-picker.test.js`: these mention `main.js` in comments and may also read it. Check.

## Inputs

- `main` @ `25e3bbd` (Flight 2 merged). `main.js` is 3,269 lines and `renderer.js` 1,504.

## Outputs

- **New `src/main/window-capture.js`:**
  - `// @ts-check`, CommonJS, and Electron-FREE. `app`, `desktopCapturer`, `registry` and the capture helpers are injected; the module never calls `require('electron')`.
  - Exports `createWindowGrabber({ registry, app, desktopCapturer, ...helpers })`, which returns `{ grabWindow }`.
- **`src/main/main.js`:** the block is replaced by one construction plus a require. The net reduction is at least 240 lines.
- **New `test/unit/window-capture.test.js`:** unit tests with fakes.
- **The re-targeted pins.**
- **CLAUDE.md:** the Architecture bullet names `window-capture.js`. The MCP automation section mentions where `captureWindow`'s compositing lives, if it names `main.js` today.

## Acceptance Criteria

- [ ] **The move.**
  - `grabWindow`'s body moves verbatim into `window-capture.js`, with only the free identifiers turned into injected deps.
  - The diff of the body (old vs new, ignoring the deps destructure and indentation) shows no logic change. Record the comparison method in the flight log.
- [ ] **Electron-free.**
  - `window-capture.js` contains no `require('electron')`.
  - `AUTOMATABLE_MENU_TYPES` is still IMPORTED from the resolver module, so the two predicates stay the same object. It is never re-typed and never passed as a copied array.
- [ ] **TDZ.** Every reference to `grabWindow` in `main.js` sits below its construction or goes through a getter. Grep all of them and list them in the flight log.
- [ ] **Unit tests** (`window-capture.test.js`, with fakes). They cover:
  - no record, so `null`;
  - a destroyed chrome, so `null`;
  - the Wayland switch skipping `desktopCapturer`;
  - the sheet layered only for an allowlisted menu type, and NOT for a non-allowlisted one;
  - a visible save prompt never composited;
  - a composite failure surfacing as `capture-failed`.
- [ ] **Pins re-targeted.** Every source-scan pin that read the capture code from `main.js` now reads `window-capture.js`. Each keeps its vacuity guard and still fails when its subject is mutated (neuter-verified, recorded in the flight log). Pins about the engine sites still read `main.js`.
- [ ] **Line count.** `main.js` drops by at least 240 lines.
- [ ] **No regression.** `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check` are green.
- [ ] **Live smoke** (CLAUDE.md planning rule: every existing apparatus primitive against the new state). In a dev launch (`npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, env-key script), run `enumerateWindows`, `enumerateTabs`, `captureWindow` (a non-empty PNG), `captureScreenshot` on a tab, and `evaluate` on a tab. Record the results in the flight log, and quit the app.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/window-capture.test.js test/unit/capture-window-failure-pins.test.js test/unit/sheet-automation-gate-invariant.test.js test/unit/save-prompt-automation-guard.test.js test/unit/capture-timeout.test.js test/unit/capture-source-picker.test.js test/unit/automation-observe.test.js`
- `grep -n "require('electron')" src/main/window-capture.js` returns nothing.
- `grep -n "grabWindow" src/main/main.js`: the construction, and every use below it.
- `wc -l src/main/main.js`
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`
- The live smoke, as above.

## Implementation Guidance

1. **Inventory first.** List every free identifier in the block, then decide for each whether it is injected or required directly. Pure helper modules (`capture-failure`, `capture-timeout`, `capture-source-picker`, the resolver's `AUTOMATABLE_MENU_TYPES`) can be `require`d by `window-capture.js` itself; only live handles (`registry`, `app`, `desktopCapturer`) are injected.
2. **Move the body verbatim**, wrapping it in `function createWindowGrabber(deps) { async function grabWindow(windowId) { … } return { grabWindow }; }`.
3. **In `main.js`**, construct it where `registry` and `app` exist (after `registry` is built), and fix every reference.
4. **Re-target the pins.** Read each pin file first.
5. **Tests, the live smoke, then docs.**

## Edge Cases

- **A comment in the block that cites "main.js" line numbers or names:** update it to say `window-capture.js`.
- **`app.commandLine.getSwitchValue('ozone-platform')`** is read per call today. Keep it per call; do not cache it at construction.

## Design Review Resolutions (cycle 1: approve with changes, folded in; these take precedence over anything above)

- **Inventory, resolved.**
  - Inject the live handles: `registry`, `app`, `desktopCapturer`.
  - `require` the pure helpers directly: `pickSourceByMediaSourceId`, `withCaptureTimeout`, `captureFailure`, `captureWithOneRetry`, and `AUTOMATABLE_MENU_TYPES` from `'./automation/resolve'`, using EXACTLY that specifier (the AC7 regex matches it). Their own suites test them.
  - `applyGuestVisibility`, `path` and the `htmlFullscreen` module are NOT used in the body (comment mentions only). Do not inject them.
  - **Name the injected registry `registry`** (destructure `const { registry, app, desktopCapturer } = deps`) so the AC7 literals `registry.sheetMenuFor(` and `AUTOMATABLE_MENU_TYPES.has(` still match.
  - In `main.js`, keep the `./automation/resolve` import line and drop only names that no longer have a user (`isInternalContents` is still used), or lint fails.
- **Placement.** Construct the grabber at the old site, right before the "Create + start a fresh MCP server instance" comment. No identifier it needs is declared below :780, and both uses (the `getEngine:` arrow ~:1737, and the `registerAppLifecycle` deps ~:3219) sit below it, so there is no TDZ issue.
- **Pins to move** (the rest stay on `main.js`):
  - `capture-window-failure-pins.test.js`: `MAIN` / `REAL` re-point to `window-capture.js`. Keep `async function grabWindow(` verbatim inside the factory, which the locator and the :174 rename mutation need. Verify the indentation-sensitive tail regex in P1 after the move.
  - `sheet-automation-gate-invariant.test.js`: both AC7 tests (:50–77, :81–86) read `window-capture.js`. AC9 (:261–265, the engine sites) STAYS on `main.js`.
  - `save-prompt-automation-guard.test.js`: only the `const layers = []` test (:230–234) reads the new file. The `isSavePromptContents` pins (:221–226) stay on `main.js`.
  - `capture-timeout.test.js`, `capture-source-picker.test.js` and `capture-failure.test.js` only mention `main.js` in comments; update those comments. Do the same for the comments in `capture-failure.js` and `observe.js`.
- **Scenario test.** Add one unit test that drives `observe.captureWindow({ grabWindow: grabber.grabWindow })` end to end (the real entry function, with fakes underneath). State in the flight log that the "sheet layered only for an allowlisted type" and "save prompt never composited" scenarios are proven by pins and units only, because both surfaces are unobservable live.
- **Live smoke** runs under the dev launcher's Wayland ozone path, which is the default on this WSLg host, so the composite path is exercised. Record which path ran (desktopCapturer or composite).
- **Verbatim check.** Diff the old body against the new with the extra indent stripped (e.g. `diff <(sed -n '/async function grabWindow/,/^}/p' old.js) <(sed 's/^  //' … new body)`). The template-literal composite script, with its backslash escapes, must match byte for byte. Record the command and its result.
- **Typecheck.** Give the deps a JSDoc typedef, e.g. `registry: ReturnType<typeof import('./window-registry').createWindowRegistry>`, so `npm run typecheck` passes.
- **Line count.** The net reduction is about 250 lines. Verify with `wc -l`; at least 240 still holds.
- **Per-call switch read.** The unit fake for `app.commandLine.getSwitchValue` returns different values across two calls, to pin the per-call read.

## Files Affected

- `src/main/window-capture.js` (new), `src/main/main.js`
- `test/unit/window-capture.test.js` (new) and the re-targeted pin files
- `CLAUDE.md`

## Citation Audit

Checked 2026-11-19 on `main` @ 25e3bbd:
- `main.js`: `async function grabWindow(windowId)` (:780) through its closing brace (~:1039).
- The free identifiers' declarations: `registry` :494, `AUTOMATABLE_MENU_TYPES` :199, the capture helpers :169–173, `applyGuestVisibility` :148.
- `app-lifecycle.js`: `grabWindow` at :79 and :450.
- The pin files listed above read `main.js`: `capture-window-failure-pins.test.js` :32, `sheet-automation-gate-invariant.test.js` :50, `save-prompt-automation-guard.test.js` :219.
