# Flight Log: Decompose main.js and Restore renderer.js Headroom

**Flight**: [Decompose main.js and Restore renderer.js Headroom](flight.md)

## Summary

In flight (2026-11-19). Branch `flight/03-decompose-main` cut from `main` @ 25e3bbd (Flight 2 merged).

---

## Leg Progress

### Leg 01 `window-capture` - landed (not committed)

- **Move.** `grabWindow` (old main.js :776-1039) is now `createWindowGrabber({ registry, app, desktopCapturer })` in `src/main/window-capture.js` (`// @ts-check`, CJS, no `require('electron')`). The pure helpers and `AUTOMATABLE_MENU_TYPES` (from `'./automation/resolve'`) are required directly. `main.js` constructs it at the old site (`const { grabWindow } = createWindowGrabber({...})`, right before the MCP-server comment).
- **Verbatim diff.** `diff <(sed -n '/^async function grabWindow/,/^}$/p' <old block>) <(sed -n '/^  async function grabWindow/,/^  }$/p' window-capture.js | sed 's/^  //')` -> empty (IDENTICAL), re-run after Prettier. The composite template literal matches byte for byte.
- **grabWindow references in `main.js` (TDZ).** :665 a comment; :774 the construction; :1472 the `getEngine:` deps entry; :2954 the `registerAppLifecycle` deps entry. Both uses sit below the construction.
- **Dropped from `main.js`:** the `capture-source-picker`, `capture-timeout`, `capture-failure` requires and `AUTOMATABLE_MENU_TYPES` from the resolver import (`isInternalContents` kept). `desktopCapturer` stays in the electron destructure (injected).
- **Pins re-targeted** (each keeps its vacuity guard): `capture-window-failure-pins` (`MAIN` -> window-capture.js; the P1 neuter regex made indent-tolerant `\}(\n\s*)\}`), `sheet-automation-gate-invariant` AC7 x2 (AC9 engine sites stay on main.js), `save-prompt-automation-guard` `const layers = []` test (the `isSavePromptContents` pins stay on main.js). Comments updated in capture-failure.js, observe.js and four capture-* tests. Neuter checks: admit-all sheet predicate -> sheet pin + unit test red; retyped `'site-info'` literal -> AC7 red; `savePrompt` reference in the layer region -> AC25 red; `throw captureFailure` -> `return null` -> 3 reds (P1 pins). Note: removing only the pre-capture `sheetMenuAdmitted` gate stays green by design (the post-await re-check still drops the layer; both are pinned via the `.has(` count and the unit).
- **Tests.** New `test/unit/window-capture.test.js` (no record, destroyed chrome, per-call Wayland switch read, sheet allowlisted vs not, save prompt never composited, composite failure -> capture-failed, `observe.captureWindow` end-to-end scenario, Electron-free scan). "Sheet layered only for allowlisted type" and "save prompt never composited" are proven by pins and units only; both surfaces are unobservable live.
- **Line counts.** `main.js` 3,269 -> 2,999 (-270); `window-capture.js` 298. `npm test` 7359/7363 pass, 0 fail; lint, typecheck, format:check green.
- **Live smoke** (dev launch, scratch HOME/XDG, admin key via env-key script, app quit via `appQuit`, scratch dir and key file deleted): `enumerateWindows` ok (1 window, booted); `enumerateTabs` ok (`[]`); `captureWindow` ok (non-empty PNG, 118,860 b64 chars chrome-only; 57,472 after `openTab`); `captureScreenshot` on the tab ok; `evaluate` `1+1` -> 2; `getChromeTarget` ok. Path: the dev launcher's Wayland ozone default on this host was expected (composite path); I did not independently log the switch value, so treat the composite path as inferred.

---

### Leg 02 `vault-wiring` - landed (not committed)

- **Free-identifier inventory (written before cutting; block A = old main.js :777-1293, block B = :1360-1455).** Live handles injected: `app` (`getPath('userData')` only), `dialog`, `webContents` (`fromId`), `registry` (:485), `jars` (:26), `settings` (:67), `vaultStoreModule` (:74, injected so a test counts `load()`). By value (declared above the construction site): `documentMarks`, `revealGate`, `gestureTrace`, `chromeForTab` (:650, hoisted function declaration), `broadcastToChromeAndInternal`. Late-bound: `mcpServer` (`let` :724) -> `getMcpServer()` getter (one use, `zeroizeAutomationVaults`). Required inside the module: `crypto`, `fs`, `validateExportPath`, `mapVaultSheetError` + the two configs, `createVaultHuman`, `runVaultLockTeardown`, `routeCaptureDropped`, and the seven mid-file requires (now top-level). Not used in the blocks: `gate`, `session`, `path`.
- **Move.** `createVaultWiring(deps)` in `src/main/vault/vault-wiring.js` (`// @ts-check`, CJS, no `require('electron')`; 735 lines). Constructed in `main.js` right after the `revealGate` construction (the old `_vaultHuman` site) and destructured under the same names. Primitives (`gestureWitness`, `injectedInput`, `mediaProxyTokens`, `documentMarks`, `revealGate`) stay in `main.js`: scope of "human wiring" = the lazy constructors move, the instances stay. New accessors: `peekVaultStore`, `peekVaultHuman`, `getCompromiseReport`, `clearCompromiseReport`, `clearSeverOffer`. `vaultImportSeverDismiss` kept verbatim (its body IS a single `_severOffer = null`, but `clearSeverOffer` is a separate function, as the review asked for an explicit one). Finding #23 done: the orphaned MCP-server comment now sits above `startMcpServerInstance`; the `vault-store.js:624` reference now names `lockNow`.
- **Verbatim diff method.** Old blocks saved from the pre-edit file; both sides normalised (leading/trailing whitespace stripped, blank lines, `//` comment lines and the seven `require('./vault/...')` lines removed) and `diff`ed: 300 code lines each, the ONLY difference is `mcpServer?.zeroizeAllVaultSessions()` -> `getMcpServer()?.zeroizeAllVaultSessions()`. Re-run after Prettier.
- **Outside references to a moved name (TDZ).** Construction at main.js :847; every use is below it: `getVaultStore()` in the `startMcpServerInstance` deps (call at server start, not module load), `peekVaultHuman` in the tab-ipc / overlay / guest deps (closures), `releaseVaultHoldsForWindow` / `getVaultHuman` in registrar deps (function values), `vaultImport*` / `clearPendingVaultImport` / `browserImport*` in the browser-IPC deps, `severOfferRoute` / `getCompromiseReport` / `clearCompromiseReport` in the vault-IPC deps, `peekVaultStore()` in `createPowerLock` and `lockVaultForQuit` (closures), `resurfaceCompromiseReveal` as `onChromeBooted`. `getVaultStore` was hoisted before and is now a `const`; no deps object above the construction captured it by value (the app boots and runs, live smoke). `grep -nE "_vaultStore|_vaultHuman|_compromiseReport|_severOffer" src/main/main.js` -> nothing (comments updated too).
- **Removed from `main.js`:** `crypto`, `validateExportPath`, `createVaultHuman`, `runVaultLockTeardown`, `routeCaptureDropped`, `VAULT_IMPORT_PREVIEW_CONFIG`, `VAULT_RESTORE_COMMIT_CONFIG`; the six mid-file vault requires. Kept: `vaultStoreModule` (injected), `mapVaultSheetError` and the other configs (used later), `fs`. `createBrowserImportFlow` was never a top-level import in main.js (it was one of the mid-file requires). The `createVaultWiring` require is at the top with the other imports. Lint clean.
- **Pins re-targeted** (each keeps a vacuity guard; neuter-verified red then restored): `vault-browser-import-invariants` AC8 x3 (-> vault-wiring.js; function-end regex now indent-aware); `vault-lock-teardown` AC15 and AC9 (-> vault-wiring.js; AC9 now `getMcpServer()?.` and a new main.js assertion that `getMcpServer` is a getter, neuter: by-value capture -> red); `vault-power-lock` (onLock clearGrants -> vault-wiring.js; `lockVaultForQuit` -> `peekVaultStore()?.lockNow()`; new scan that the whole `createPowerLock` block and the quit dep contain no `getVaultStore(`; neuters N1/N2 red); `vault-fill-human-marker` (human block sliced from vault-wiring.js, marker + count guards, unmarked send must be absent from the wiring); `reveal-gate-item-writes` (restore -> dropAllGrants, count exactly 1, in vault-wiring.js; neuter red); `picker-dismissal` (vault-lock close scan); `vault-restore-workflow-invariants` (`_pendingAdoptAdminKeys` scan over main.js AND vault-wiring.js); `file-modes` (bundle export writer scan; neuter red). Found by the full run, beyond the leg's list: `file-modes` and `vault-import-logins` AC15b (the moved `MAX_BUNDLE_BYTES = 16 * 1024 * 1024` now lives under src/main/vault/: the scan excludes vault-wiring.js and pins its one literal by name). Unchanged and green: the `createEngine` pins, `revealGate` construction pin, `startVaultPowerLock`/`createPowerLock` pins, vault-context scopeCtx pin, secret-clipboard, vault-capture-handler. None went vacuous (each neuter above turned it red).
- **Tests.** New `test/unit/vault-wiring.test.js` (9 tests, real exports, fakes): peek null + zero `load()` calls through the quit-lock shape; memoized store; `onLock` captured from `load` options (grants cleared, every sheet `vault-lock`, live MCP server zeroized, lock-state broadcast, null server no-op); window release (import, suppression hold, other window untouched); browser import dropped by release and by lock; `vaultImportCommit` `dropAllGrants` once after restore and not on a stale handle; accessors (compromise report, sever offer); `ackVaultReveal`; Electron-free scan. The held-import stores arm real timers, so the rig's cleanup locks to drop them (without it the file hangs). The commit channel itself is covered by the existing registrar and wiring pins.
- **Line counts.** `main.js` 2,999 -> 2,409 (-590); `vault-wiring.js` 735. `timeout 300 npm test`: 7374 pass, 0 fail; `format:check`, `lint`, `typecheck` green.
- **Live smoke** (dev launch, scratch HOME/XDG, port 49795, admin key in a 0600 file, env-key script): `enumerateWindows` ok; `enumerateTabs` ok; `captureWindow` ok (image); internal `goldfinch://vault` tab opened via chrome `createTab(..., {trusted:true})` (`openTab` returns null for internal URLs by design); `enumerateTabs` shows it; `evaluate` `1+1` -> 2; `readDom` ok (title "Vaults - Goldfinch"); `vaultState()` -> `setUp:false, unlocked:false`; chrome `getVaultLockState` same; chrome `vaultLock()` -> `{ok:true}` (no-op, state unchanged); `appQuit` -> process gone, no electron process left, no ReferenceError/TypeError in the log (the only console error was my own script's `.then` on a non-promise). Quit ran `lockVaultForQuit` -> `peekVaultStore()` twice (once with the store already constructed by the lock call, once not). The smoke cannot observe store construction; that is pinned by the counting-`load` unit test and the power-lock scan. No master password typed. Scratch profile, key file and scripts deleted.

---

### Leg 03 `renderer-headroom` - landed (not committed)

- Moved the tab context-menu cluster (`tabCtx`, the two push caches with subscription-then-seed, `openTabContextMenu`) into `src/renderer/chrome/tab-context-controller.js` (`createTabContextController`, returns `{ tabCtx, openTabContextMenu }`). `renderer.js` binds the same names at the old site; `tabCtx` stays one object by identity. Seam tail untouched (`SEAM_COUNT` 41).
- Verbatim-diff method: old body (`git show HEAD:src/renderer/renderer.js` lines 1077-1142) and new body, indent stripped and `//` comment lines dropped, compared with `diff`. Result: only differences are `window.goldfinch` -> `goldfinch` (injected), the two added `.catch(() => {})` on the seeds (Prettier-wrapped), `@type any` param annotations, and the `return` line.
- TDZ reference list: `tabs`, `orderedTabIds`, `isInternalTab` (destructured from `tabController` ~:217), `openOverlayMenu` (:752), `chromePointToSheet` (function declaration, hoisted), `createPushCache`/`tabContextModel` (imports). All above the construction site. Consumers of `tabCtx`/`openTabContextMenu` (:178 lazy arrow, :455 handler, :947 getter, audit-hooks construction) are in closures or below it.
- Line counts: `renderer.js` 1504 -> 1447 newline-terminated (`wc -l`), 1448 by the tests' `split(/\r?\n/)` count. `RENDERER_LINE_BUDGET` 1505 -> 1448 (in `test/helpers/renderer-line-budget.js`); CLAUDE.md budget sentence updated.
- Pins: none re-targeted (no test read `renderer.js` text for the moved code). New `test/unit/tab-context-controller.test.js` (6 tests); neuter check: removing the `.catch` makes the rejected-seed test fail.
- Gates: format:check, lint, typecheck green; `npm test` 7369 tests, 0 fail.
- Live smoke (dev launch, scratch HOME/XDG, admin key in a 0600 temp file, port 49790): `enumerateWindows`, `enumerateTabs`, `openTab` x2, `captureWindow` (image returned), `evaluate` all ok. `openTabContextMenuForAudit()` returned without error and the census showed `sheetVisible: true`; `pressKey` Escape on the chrome returned ok but the census still showed the sheet visible (focus is in the sheet; the next `closeTab` dismissed it, `sheetVisible: false`). `closedTabStackSize()` was 0 before and 1 after closing a tab. App quit, scratch profile and keys deleted.

## Decisions

## Flight Director Notes

- **2026-11-19, flight start.** Loaded `.flightops/agent-crews/leg-execution.md` (Developer = Sonnet, Reviewer = Sonnet). Flight marked `in-flight`. Starting sizes: `main.js` 3,269 lines (Flight 2 added about 6), `renderer.js` 1,504 of its 1,505-line budget.
- **Scope note.** Flight 2's debrief, Recommendation 2, suggested also pulling the per-item write notes out of `reveal-gate.js` "when Flight 3 decomposes `main.js`". That is not in this flight's spec, which covers three blocks of `main.js` plus the `renderer.js` headroom. It is not added mid-flight; it stays a debrief recommendation for a later cycle.
- **Leg 1 `window-capture`, tier: HIGH.** The block carries the sheet-admission gate (`AUTOMATABLE_MENU_TYPES`) and the save-prompt exclusion for pixel reads, which is a security-sensitive surface. At least three test files read this code straight from `main.js` and must be re-targeted, which changes a shared interface. Design review spawned (cycle 1).
- **Leg 1 design review, cycle 1: approve with changes** (no high issue). Folded into the leg as "Design Review Resolutions":
  - the inventory resolved (three injected handles; the pure helpers required);
  - the injected registry named `registry`, so the pins still match;
  - the exact pin moves and stays;
  - a scenario test through `observe.captureWindow`;
  - a Wayland-path live smoke;
  - the verbatim-diff method and the typedefs.
  No second review was needed. Leg marked `ready`.
- **Leg 1 landed.** The live smoke's capture path was confirmed by the Flight Director from the host state: `WAYLAND_DISPLAY=wayland-0` resolves to the WSLg socket (`/mnt/wslg/runtime-dir/wayland-0`). `scripts/dev-launch.mjs` (`decideOzonePlatform`) therefore launched with `--ozone-platform=wayland`, so `captureWindow` ran the COMPOSITE path, not desktopCapturer.
- **Leg 2 `vault-wiring`, tier: HIGH.**
  - **Why high:** the vault lock fan-out and the quit/power lock are security-sensitive, it has about 660 lines of hoisted functions, and its raw `let` slots are read from outside the block, which carries a TDZ risk. At least five tests read this code straight from `main.js`, so moving it changes a shared interface. Design review spawned (cycle 1).
  - **Scope ruling:** the lazy `getVaultHuman` / `getBrowserImportFlow` constructors move. The primitive instances stay in `main.js` as composition (`gestureWitness`, `injectedInput`, `mediaProxyTokens`, `documentMarks`, `revealGate`), because both `createEngine` sites and many registrars use them and grep pins hold them there.
- **Leg 3 `renderer-headroom`, tier: LOW.**
  - **Why low:** a renderer-only verbatim extraction of about 75 lines, following an established precedent (`audit-hooks.js`), with no shared interface change and no security surface. Design review skipped.
  - **In parallel with leg 2:** it is implemented while leg 2's design review runs. The two touch disjoint files (`src/renderer/**` vs `src/main/**`); only the flight log and CLAUDE.md are shared, and edits to those are append-only and section-local.
  - **"Headroom" meaning:** the criterion means the count falls at least 40 below the old 1,505 budget, with the budget constant then retargeted to the new count (the CLAUDE.md zero-headroom rule).
- **Leg 2 design review, cycle 1: approve with changes** (no high issue). Folded in as "Design Review Resolutions":
  - the corrected inventory (`gestureTrace` added; `gate` / `session` / `path` removed);
  - removing the unused imports;
  - a vacuity fix for `vault-fill-human-marker`;
  - the AC9 live-read pin;
  - finding #23's orphaned comment;
  - the negative scan widened to the new file;
  - scenario criteria driven through the injected `load`'s `onLock`;
  - an Electron-free scan.
  No second review was needed. Leg marked `ready`; implementation waits for leg 3 to land, so two Developers are never editing and testing at once.
- **Flight review (Reviewer, Sonnet): [HANDOFF:confirmed]** on legs 01–03. The Reviewer ran `npm test` itself (7,374 pass, 0 fail, 4 todo), and lint, typecheck and format were clean.
  - **Behaviour-neutrality:** the Reviewer diffed all three moves and found no difference beyond the documented ones.
  - **TDZ:** the ordering was checked.
  - **Security invariants still pinned:** the shared `AUTOMATABLE_MENU_TYPES` object, the save prompt never composited, `peekVaultStore`-only quit and power locks, the lock fan-out, `dropAllGrants` exactly once, and both `createEngine` sites.
  - **Non-blocking nits:** the leg entries above cite mid-flight line numbers (e.g. `main.js` 2,999 / `:774` / `:847`), so treat them as stale. A test-header comment could name `window-capture.js`. Both are accepted.
- **Final sizes.**
  - `main.js`: 3,269 → **2,409** (−860; window capture −270, vault wiring −590). That is slightly above the flight's "about 2,300" verification target, which was a rough figure; the leg-level criteria (≥240 and ≥450) were both exceeded.
  - `renderer.js`: 1,504 → **1,447** lines (1,448 by the budget's `split` count). `RENDERER_LINE_BUDGET` is 1,448.
- **Committed. All legs completed; flight landed.**
- **Debrief (2026-11-19).**
  - [flight-debrief.md](flight-debrief.md) written.
  - The operator confirmed that the narrowed "human wiring" scope meets the mission criterion.
  - The suite ran at 10.5 s at load 2.7–5.5, back at baseline.
  - Squawk 0224 logged.
  - Flight marked `completed`.

