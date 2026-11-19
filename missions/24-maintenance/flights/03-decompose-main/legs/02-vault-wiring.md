# Leg: vault-wiring

**Status**: completed
**Flight**: [Decompose main.js and Restore renderer.js Headroom](../flight.md)

## Objective

Move the vault wiring out of `src/main/main.js` into a new `src/main/vault/vault-wiring.js` (`createVaultWiring(deps)`), with no behaviour change. That covers the lazy vault store and its lock fan-out, the lock-state broadcast, the import/restore delegates, the autolock holds, the compromise and sever state, the bundle save path, and the lazy `getVaultHuman` / `getBrowserImportFlow` constructors. Every source-scan pin that reads this code from `main.js` is re-targeted.

## Context

- **Flight Design Decision:** blocks 1 and 3 of the maintenance extraction map, after leg 1. Hoist the late requires first. Keep both `createEngine` grep pins intact. Expose `peekVaultStore()` for the quit lock.
- **Leg 1 landed:** `main.js` is now 2,999 lines (line numbers below are as of leg 1).
- **The block** in `main.js` (as of leg 1):
  - **~:780–1303:** the comment block and `closeVaultCredentialSheetsOnLock` (:797); `let _vaultStore` and `getVaultStore()` (:803–860, which builds the store with `onLock` / `onUnlock`); `computeVaultLockState` / `broadcastVaultLockState` (:861–898); `notifyVaultImportLabelsReady` (:899); the mid-file requires and stores `_pendingVaultImports` (:919–920), `_pendingBrowserImports` (:927–929) and `_autolockSuppression` (:940–941); `releaseVaultHoldsForWindow` (:953); the compromise and sever block (:974–1075: `_compromiseReveals`, `let _compromiseReport`, `mintGeneration`, `let _severOffer`, `severOfferRoute`, `stashCompromiseReveal`, `ackVaultReveal`, `resurfaceCompromiseReveal`); `vaultPickSavePath` / `vaultSaveBundleToFile` (:1076–1155); and the import delegates (:1156–1303: `vaultImportBeginFromFile` … `vaultImportSeverDismiss`).
  - **~:1360–1456:** `let _vaultHuman`, `getVaultHuman()`, `let _browserImportFlow`, `getBrowserImportFlow()`.
  - **STAYS in `main.js`:** `gestureWitness`, `injectedInput`, `mediaProxyTokens`, `documentMarks` and the `revealGate` construction (~:1305–1358). These are composition primitives handed to many registrars and both `createEngine` sites (grep-pinned); moving them adds risk and no clarity. The flight log must record this as the scope of "human wiring": the lazy constructors move, the primitive instances stay.
- **Outside uses (TDZ, from a grep as of leg 1):** every use of the moved names from outside the block sits BELOW ~:1499 (registrar and deps objects). So constructing the wiring at the old `_vaultHuman` site (~:1359, right after `revealGate`) puts every use below the construction. That site also comes after `documentMarks` and `revealGate`, which `getVaultStore`'s `onLock` and the import commit use.
- **Mutable slots read or written outside the block need accessors:**
  - `_vaultStore`: `lockVaultForQuit: () => _vaultStore?.lockNow()` (~:2886) and the power-lock deps (~:2841–2849) read the raw slot and must never construct the store. Expose `peekVaultStore()`.
  - `_vaultHuman`: read raw at ~:1736, 1857, 1905 and 2167–2174 (`vaultHuman: () => _vaultHuman`, `_vaultHuman?.dropContextsForTabs`). Expose `peekVaultHuman()`.
  - `_compromiseReport`: read at ~:2825–2827. Expose `getCompromiseReport()`, and whatever the clearing site needs.
  - `_severOffer`: written `= null` at ~:2351 and ~:2382. Expose `clearSeverOffer()`.
- **Free identifiers the block uses from `main.js`:** `registry` (:485), `gate` (:491), `jars` (:26), `settings` (:67), `mcpServer` (`let` :724, so pass a getter), `chromeForTab` (:650), `crypto` / `fs` / `path`, `vaultStoreModule` (:74), and Electron's `app`, `dialog`, `webContents`, `session`. There are also many module-level functions defined elsewhere in `main.js` (e.g. `broadcastToChromeAndInternal`, the menu-overlay helpers), plus `documentMarks` / `revealGate` / `injectedInput` / `gestureWitness`. **The Developer must build the complete inventory** (each identifier: declaration line; whether it is a live handle, late-bound or pure; inject or require), and inject late-bound values as getters.
- **Source-scan pins that read this code from `main.js` (found so far; the Developer must grep for the rest):**
  - `test/unit/vault-browser-import-invariants.test.js` reads `MAIN_JS` for `function releaseVaultHoldsForWindow(chromeId) {` and `_pendingVaultImports.dropAll()`.
  - `test/unit/vault-power-lock.test.js:475` asserts `lockVaultForQuit:\s*\(\)\s*=>\s*_vaultStore\?\.lockNow\(\)`. It becomes `peekVaultStore()?.lockNow()` or equivalent; the "never constructs" intent must be kept and pinned.
  - `test/unit/vault-fill-human-marker.test.js` uses `main.indexOf('_vaultHuman = createVaultHuman({')`.
  - `test/unit/vault-lock-teardown.test.js:87` has a regex on the `onLock` composition.
  - `test/unit/reveal-gate-item-writes.test.js:259` asserts that `restoreProfile` is followed by `revealGate.dropAllGrants()` in `vaultImportCommit` (Mission 24 Flight 2).
  - Likely more, e.g. the reveal-gate wiring tests, the close-on-lock tests, and the compromise and adopt invariants. `grep -rln "main.js" test/unit | xargs grep -l "<each moved symbol>"` is the starting point.
- **`main.js` text pins that must keep matching `main.js`:** the two production `createEngine` sites (`markScripted`, `injectedInput`, `sheetMenuFor`, `isSavePromptContents`) and the `revealGate` construction. None of them move.

## Inputs

- Leg 1 landed, uncommitted on the flight branch. Re-read `main.js` before editing; the line numbers above are as of leg 1.

## Outputs

- **New `src/main/vault/vault-wiring.js`:** `// @ts-check`, CommonJS. It takes Electron handles through deps, not `require('electron')`, so it can be unit-tested with fakes.
- **New `test/unit/vault-wiring.test.js`.**
- **`src/main/main.js`:** the block is replaced by the requires plus one construction, destructuring the same names, so the call sites further down are unchanged except the raw-slot reads above. The net reduction is at least 450 lines.
- **The re-targeted pins.**
- **CLAUDE.md:** the Architecture bullet names `vault/vault-wiring.js`. Fix any CLAUDE.md sentence that says `main.js` owns the vault lock fan-out or the quit lock.

## Acceptance Criteria

- [ ] **The move.**
  - The moved functions' bodies are unchanged except for free identifiers becoming deps or getters, and the raw-slot accessors.
  - Diff the bodies old against new; record the method and the result in the flight log.
  - The late requires (`pending-imports`, `pending-browser-imports`, `browser-import-flow`, `autolock-suppression`, `pending-compromise-reveal`, `sever-offer`, `resurface-compromise-reveal`) move into `vault-wiring.js` as top-level requires. None remains mid-file in `main.js`.
- [ ] **TDZ.**
  - The wiring is constructed after `documentMarks` / `revealGate`.
  - Every `main.js` reference to a name it provides sits below the construction or inside a closure that runs later. List each one in the flight log.
  - Late-bound values (`mcpServer`, and anything assigned after the construction) are passed as getters.
- [ ] **The quit and power lock never construct the store.** `lockVaultForQuit` and the power-lock deps use `peekVaultStore()`. A unit test asserts that `peekVaultStore()` returns `null` before the first `getVaultStore()` and does not construct the store.
- [ ] **Accessors.** `peekVaultHuman()`, `getCompromiseReport()` and `clearSeverOffer()` (or equivalents) replace every raw-slot read or write outside the module. A grep finds no `_vaultStore`, `_vaultHuman`, `_compromiseReport` or `_severOffer` token left in `main.js`.
- [ ] **Unit tests** (`vault-wiring.test.js`, with fakes):
  - `getVaultStore` is memoized;
  - the lock fan-out calls `closeMenuOverlay('vault-lock')` on every record's sheet, `documentMarks.clearGrants()`, and the lock-state broadcast;
  - `releaseVaultHoldsForWindow` clears the pending imports, the browser imports and the suppression hold for that window;
  - `vaultImportCommit` calls `revealGate.dropAllGrants()` after a successful restore;
  - the accessors behave as described.
  These run through the module's real exports, not a re-transcription.
- [ ] **Pins re-targeted.** Every source-scan pin that read the moved code from `main.js` reads `vault-wiring.js`. Each keeps its vacuity guard and is neuter-verified; list every pin touched in the flight log. Pins on `main.js`'s own composition (the `createEngine` sites, the `revealGate` construction) still read `main.js` and pass unchanged.
- [ ] **Line count.** `main.js` drops by at least 450 lines from its leg-1 count of 2,999.
- [ ] **No regression.** `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check` are green.
- [ ] **Live smoke** (every existing primitive against the new state). Use a dev launch on a scratch profile with env-key scripts. Run `enumerateWindows`, `enumerateTabs`, `captureWindow`, `openTab`, `evaluate`, `readDom` on an internal page. Then exercise the vault through the internal page with admin `evaluate`, NO master password typed by an agent: `goldfinch://vault` `vaultState()` shows not set up; `vaultLockNow` (or the lock channel) is a no-op; `appQuit` exits cleanly, which exercises `lockVaultForQuit` → `peekVaultStore()` with no store constructed. Record the results, and remove the scratch profile and keys.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/vault-wiring.test.js test/unit/vault-browser-import-invariants.test.js test/unit/vault-power-lock.test.js test/unit/vault-fill-human-marker.test.js test/unit/vault-lock-teardown.test.js test/unit/reveal-gate-item-writes.test.js` (plus every pin file touched).
- `grep -nE "_vaultStore|_vaultHuman|_compromiseReport|_severOffer" src/main/main.js` returns nothing.
- `grep -n "require(" src/main/main.js | awk -F: '$1>200'` shows no vault requires mid-file.
- `wc -l src/main/main.js`
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`, and the live smoke.

## Implementation Guidance

1. **Inventory first.** Run the free-identifier sweep across the moved ranges, and list declaration lines and lifetimes. Write it into the flight log before cutting anything.
2. **Pin inventory.** Grep `test/unit` for every moved symbol in files that read `main.js`, and list the pin sites.
3. **Create the module.** Move the functions verbatim inside `createVaultWiring(deps)`. Turn the module-level `let`s into closure variables. Add the accessors. Return the same names `main.js` uses today.
4. **`main.js`.** Delete the ranges. Add `const { … } = createVaultWiring({ … })` at the old `_vaultHuman` site, after `revealGate`. Replace the raw-slot reads with the accessors.
5. **Pins, tests, docs, then the live smoke.**

## Edge Cases

- **`getVaultStore` is a hoisted function today,** so a deps object built ABOVE the construction that captures `getVaultStore` by VALUE would now hit a TDZ `ReferenceError` at module load. The grep shows none, but confirm by running the app (the live smoke).
- **`resurfaceCompromiseReveal` is passed as `onChromeBooted`** (~:2978). That is fine, since it sits below the construction.
- **A test that `require`s `main.js`:** none should; it is never loaded by tests. If one does, it will notice.

## Design Review Resolutions (cycle 1: approve with changes, folded in; these take precedence over anything above)

- **The inventory, corrected:**
  - Inject the live handles: `app` (for `getPath('userData')`), `dialog`, `webContents.fromId`, `registry`, `jars`, `settings`.
  - Inject `mcpServer` as a GETTER (`getMcpServer: () => mcpServer`).
  - Inject by value (declared between the block and the construction site): `documentMarks`, `revealGate`, **`gestureTrace`** (`getVaultHuman` uses it). Also inject `chromeForTab` and `broadcastToChromeAndInternal`.
  - **Inject `vaultStoreModule`**, so a test can count `load()` calls.
  - Require inside the wiring: `crypto`, `fs`, `validateExportPath`, `mapVaultSheetError`, `VAULT_IMPORT_PREVIEW_CONFIG`, `VAULT_RESTORE_COMMIT_CONFIG`, `createVaultHuman`, `runVaultLockTeardown`, `routeCaptureDropped`, and the in-block requires.
  - `gate`, `session` and `path` are NOT used in the moved ranges.
- **Remove the imports `main.js` no longer uses** (`crypto`, `vaultStoreModule`, `validateExportPath`, `createVaultHuman`, `runVaultLockTeardown`, `routeCaptureDropped`, `createBrowserImportFlow`, `VAULT_IMPORT_PREVIEW_CONFIG`, `VAULT_RESTORE_COMMIT_CONFIG`; check each with a grep). Keep `mapVaultSheetError`, which is used later. `npm run lint` must be clean.
- **`_severOffer`:** expose an explicit `clearSeverOffer()` for the two outside `= null` writes. Do not reuse `vaultImportSeverDismiss` unless its body is exactly that single assignment; record which you chose.
- **Finding #23, in this leg:** move the orphaned "Create + start a fresh MCP server instance…" comment (~:770, directly above the vault block) to sit above `startMcpServerInstance`. Fix the "`vault-store.js:624`" line reference in the moved comment to name the symbol (`lockNow`). Other stale line references are optional.
- **Pins that move to `vault-wiring.js`:**
  - `vault-browser-import-invariants.test.js:35–49`
  - `vault-lock-teardown.test.js:79–87` (AC15) and `:121–127` (AC9). The `mcpServer?.zeroizeAllVaultSessions()` literal becomes the getter call. The pin must still prove that the LIVE server is read at lock time, and must fail if the server is captured by value.
  - `vault-power-lock.test.js:473`, the `onLock: () => { documentMarks.clearGrants();` part
  - `vault-fill-human-marker.test.js:19–21`, `:36`. Slice `humanBlock` from `vault-wiring.js`. Anchor the "exactly 1 unmarked `createVaultHuman`" count to a marker that is still in the file it scans, and keep a vacuity guard, so the pin cannot go VACUOUS (`indexOf` returning -1).
  - `reveal-gate-item-writes.test.js:257–262`, including the `revealGate.dropAllGrants()` count of exactly 1
  - `picker-dismissal.test.js:107`
  - `vault-restore-workflow-invariants.test.js:60`: the negative `_pendingAdoptAdminKeys` scan covers BOTH `main.js` and `vault-wiring.js`
- **Pins that stay on `main.js`:**
  - `vault-power-lock.test.js:475`, retargeted to `peekVaultStore()?.lockNow()`. Extend it so that `lockVaultForQuit` AND every `createPowerLock` dep (~:2844–2849) use `peekVaultStore()` only, never `getVaultStore()`.
  - `startVaultPowerLock` and the `createPowerLock` pins (:473–474)
  - the `createEngine` pins in `reveal-gate-wiring-invariant` and `sheet-automation-gate-invariant`
  - the `vault-context` scopeCtx pin (:689)
  - `secret-clipboard.test.js:214` and `vault-capture-handler.test.js:126`
- **Scenario criteria, tightened:**
  - **"Never constructs the store":** a counting fake `vaultStoreModule.load` shows ZERO loads after `lockVaultForQuit` and the power deps run against `peekVaultStore()`, plus the extended pin above. The live smoke cannot observe construction, so say so.
  - **The lock fan-out test** drives the `onLock` the wiring hands to the injected `vaultStoreModule.load` (the real idle/lock entry point): call `load`, capture its `onLock` option, then invoke it. Do not call an internal helper.
  - **`dropAllGrants` after restore:** the real entry is the import-commit channel. State in the flight log that the existing registrar and wiring pins cover the channel, and unit-test `vaultImportCommit` through the module's export.
- **The grep check** for raw slots counts CODE only (comment-masked; `test/helpers/source-scan` `maskComments`). Update the comments that mention `_vaultStore` (~:2841) as well.
- **Add an Electron-free scan test** for `vault-wiring.js`, like leg 1's.
- **Live smoke note:** the flight-level verification ("an evaluated reveal raising the native dialog, cancelled") is NOT part of this leg; it belongs to the flight's end. This leg's smoke stays as written.

## Files Affected

- `src/main/vault/vault-wiring.js` (new), `src/main/main.js`
- `test/unit/vault-wiring.test.js` (new), plus the re-targeted pin files
- `CLAUDE.md`

## Citation Audit

Checked 2026-11-19 against the flight branch after leg 1 (`main.js` 2,999 lines):
- The declarations listed in Context at the cited lines.
- The outside-use lines from `grep -nw`.
- The pin sites: `vault-power-lock.test.js:475`, `vault-fill-human-marker.test.js:20`, `vault-lock-teardown.test.js:87`, `reveal-gate-item-writes.test.js:259`, `vault-browser-import-invariants.test.js:39–44`.
