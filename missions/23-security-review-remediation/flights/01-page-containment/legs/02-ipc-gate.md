# Leg: ipc-gate

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Give every main-process IPC registration a named caller class through one gate module, move the 49 unchecked chrome-trust handlers onto it (deleting the nine that nothing calls), and install the standing guard that turns red on the next unclassified handler.

## Context

- **Why now, and how bad.** Leg 1 proved a page in a tab is handed the guest preload's IPC object once main sends that tab any message ([`probe-results.md`](../probe-results.md), Q1 — rig and product). Every handler with no sender check is therefore callable by web content today. The main-side gate is the boundary; nothing preload-side is.
- **DD1** (one gate module, a closed set of registrars, each naming who may call), **DD2** (standing source-scan guard plus a classification table), **DD13** (`settings-get` stops handing the chrome the automation key hashes). This leg builds all registrars and the guard, and migrates the unchecked handlers. `ipc-gate-complete` migrates the already-checked handlers and the 13 guest channels, and empties the legacy list.
- **Source of truth for channels**: [`ipc-census.md`](../ipc-census.md) — 214 channels, one row each with a proposed class. This leg confirms the class of every channel it migrates by reading the handler; the census is an index, not an authority.
- **Refinements to DD1 / DD2 decided at leg design** (recorded in the flight log):
  1. **No "deliberately open" registrar is built.** The one candidate, `automation:get-activity`, is sent by the chrome and by internal pages only, so it takes a positive **chrome-or-internal** class instead. An escape hatch with no user is not added.
  2. **The interim allowlist is channel-scoped, not file-scoped.** Nearly every registration file holds both unchecked and already-checked handlers, so a file-scoped allowlist would exempt the very files this leg edits. Instead a frozen `LEGACY` set names each not-yet-migrated channel; a raw registration is legal only for a channel in that set. `ipc-gate-complete` drives the set to empty and pins it at size 0.
  3. **The classification table is runtime data, not only a test fixture.** The gate refuses to register a channel whose registrar class differs from its table entry, so a mis-classed registration fails at boot and in every unit test that constructs a registrar module.
  4. **The tab-guest class (and its synchronous form) is built in `ipc-gate-complete`, not here** — it has no consumer in this leg and its popup / internal-tab switches ([`guard-audit.md`](../guard-audit.md), Q7) deserve review beside the channels that use them. The table still classes the 13 guest channels as `tab-guest`; they stay in `LEGACY`.
  5. **The chrome never receives an automation key hash on any channel.** Design review found the chrome's automation indicator derives its state from the hashes, from both `settings-get` and the `settings-changed` broadcast. Main computes a non-secret derived state instead and the indicator reads that.
- **Not in this leg**: the 78 already-refusing handlers (13 of which take a tab id without an ownership check) and the 13 guest channels — all 91 are in `LEGACY` — the tab-guest registrar, the preload's literal sends, sheet menu-type guards, `tab-create` re-validation; any vault, media or download behaviour change beyond the sender gate.

## Inputs

- Branch `flight/01-page-containment` at or after `f1d4520`; unit suite green (6348 tests).
- `ipc-census.md`; `src/main/internal-ipc.js` (`registerInternalHandler`); `src/main/window-registry.js` (`getWindowForChrome`, `getWindowForGuest`, `recordForOverlaySender`); the popup registry used by `src/main/guest-wiring.js`.
- Guard exemplars: `test/unit/window-closed-invariant.test.js`, `test/unit/internal-host-drift.test.js`, `test/unit/sheet-automation-gate-invariant.test.js`.
- Probe fixture: `tests/behavior/fixtures/page-containment-probe/` (the Q1 product harness shows how a main → guest message is triggered and how a page records what it saw).

## Outputs

- `src/main/ipc-gate.js` — new, Electron-free, injected deps. `src/main/ipc-channel-table.js` — new, the classification table and the `LEGACY` set (CJS, main-only).
- The 49 unchecked registrations: 40 routed through the gate, 9 deleted.
- `test/unit/ipc-gate.test.js`, `test/unit/ipc-gate-invariant.test.js` — new. A shared test helper that builds a **real** gate over a test's fake `ipcMain`.
- `tests/behavior/guest-ipc-refusal.md` (authored with this leg) and its fixture page.
- `CLAUDE.md` and `docs/` corrected where this leg makes a statement false.

## Acceptance Criteria

### Gate module

- [ ] `src/main/ipc-gate.js` does not `require('electron')`; it is constructed once in `main.js` from `ipcMain`, the window registry and a logger, and handed to registrar modules.
- [ ] It exposes exactly these caller classes, each in an invoke form and a one-way form: **chrome**; **owning chrome of a tab** (the registration supplies a function that extracts the tab id from the arguments; the sender's window record must be the record owning that tab); **chrome or internal page**. For the owning-chrome class the extractor may answer "no tab named", which passes as chrome-only — it never widens to another window's tab, and a tab id that is present but not owned by the sender's window is refused.
- [ ] The gate adds no asynchrony: a synchronous handler still returns synchronously through the gate (existing unit tests call handlers synchronously).
- [ ] Every invoke-form registration states its refusal explicitly: either "throw" or a literal value. There is no default. One-way registrations drop a refused message.
- [ ] The handler signature seen by migrated code is unchanged (`(event, ...args)`), so a migration is a change of registration line, not of handler body.
- [ ] Registering a channel that is absent from the classification table, whose registrar class differs from its table entry, or that is already registered, throws at registration time.
- [ ] A refusal emits one trace line when `GOLDFINCH_IPC_TRACE=1` and nothing otherwise: channel name, the class required, and the sender's kind (`chrome` / `tab` / `overlay` / `other`) — never arguments, URLs or titles.
- [ ] `requireChrome` / `ownsTab` logic is single-sourced in the gate. The closure-local copies (`src/main/register-tab-ipc.js`, `src/main/register-browser-ipc.js`, inline in `main.js`'s `vault-fill-generated`) may remain **only** as thin calls into the gate until `ipc-gate-complete`; no third implementation of the comparison is added.

### Migration

- [ ] Each of these is registered through the gate with the class shown and refuses by throwing:
  - **chrome**: `app-quit`; `history-suggest`; `jars-list`, `jars-add`, `jars-rename`, `jars-set-default`, `jars-get-default`, `jars-remove`, `jars-clear-data`, `jars-wipe`, `jars-set-retention`; `vault-lock-state-get`, `vault-automation-held-get`, `vault-lock`; `bookmarks-get`, `bookmarks-suggest`, `bookmark-add`, `bookmark-update`, `bookmark-remove`, `bookmark-reorder`; `choose-download-dir`, `open-downloaded-file`, `reveal-downloaded-file`, `show-item-in-folder`; `chrome-clipboard-write`, `chrome-welcome-set`, `settings-get`, `shields-get`, `shields-isolation-state`, `shields-set`, `shields-pause`, `toggle-bookmarks-bar`, `unpin-toolbar-item`; `closed-tab-stack-size`, `tab-reopen`; `vault-capture-dismiss` (its argument is an opaque capture id, not a tab id; a late dismiss of an expired capture must still be accepted from the chrome).
  - **owning chrome of a tab**: `vault-reachable-items` (tab id is the bare first argument), `vault-fill-human` (`payload.wcId`), `download-media` (`payload.webContentsId`, optional — absent means the sender window's active tab).
- [ ] `download-media` and `choose-download-dir` no longer fall back to the last-focused window: the gate guarantees a sender window, and the fallback is removed rather than left as dead code.
  - **chrome or internal page**: `automation:get-activity`.
  - If reading a handler shows a listed class is wrong (for example a channel in the owning-chrome list carries no tab id), the developer stops on that channel, records why in the flight log, and uses the narrowest class that keeps the real chrome working — never a wider one.
- [ ] These nine registrations are **deleted** together with their now-dead second registration lines, and their handler functions stay (the `internal-*` twins still use them): `history-page`, `history-search`, `history-delete`, `history-clear`, `history-count`, `jars-cookies-list`, `jars-cookies-remove`, `jars-sitedata-list`, `jars-sitedata-remove-origin`. Before deleting each, a repo-wide search confirms no sender in `src/`, `scripts/`, `tests/` or `docs/` recipes; a channel with a real sender is gated as **chrome** instead and noted.
- [ ] `tab-reopen` refuses a non-chrome sender **before** it pops the closed-tab stack.
- [ ] The chrome receives no automation key hash on any path: `settings-get` (whole-object call, and a call naming either hash key) and the `settings-changed` payload delivered to chrome views both omit `automationKeyHashes` and `automationAdminKeyHash`. In their place both carry one main-computed, non-secret field holding exactly what the indicator needs (which jars have a key, whether the admin key is enabled) and nothing derived from a hash value.
- [ ] The automation indicator behaves exactly as before — hidden with no keys, jar colour with a jar key active, admin mode when the admin key is enabled and active — at boot and after a live key change. `computeAutomationKeyState` (`src/renderer/chrome/privacy-controller.js`) and both of its feeders (the boot `settingsGet()` call there and the `settings-changed` handler in `window-controller.js`) read the new field; `test/unit/window-controller.test.js` and the indicator model tests are updated to the new shape.
- [ ] Internal pages are unaffected: `internal-settings-get` and whatever `goldfinch://automation` and `goldfinch://settings` read today are unchanged. If the `settings-changed` broadcast must now differ by audience, that is done in the one broadcast helper, the **shared mechanism** is listed in the flight log with every subscriber (chrome controllers, each internal page), and each is asserted unaffected by unit test or the live smoke.
- [ ] The real chrome works: no chrome-preload call site changes, `src/renderer/renderer.js` stays at 1504 lines, the evaluate seam stays at 41 entries.

### Standing guard

- [ ] `test/unit/ipc-gate-invariant.test.js` scans `src/main/**` (comments masked, the gate module's and `registerInternalHandler`'s own bodies blanked as the sanctioned wrappers) and fails when: a raw `ipcMain.handle(` / `ipcMain.on(` / `.once(` / `.handleOnce(` registers a channel not in `LEGACY`; a registration's channel argument is not a string literal; or the token `ipcMain` appears anywhere other than these enumerated contexts — (a) `ipcMain.handle(` / `ipcMain.on(` with a literal `LEGACY` channel, (b) the first argument of `registerInternalHandler(` / `registerInternal(`, (c) a destructured parameter or JSDoc type in a file that still holds `LEGACY` channels, (d) shorthand inside the object argument of a callee on a named allowlist of registrar functions, (e) the `require('electron')` destructure and the gate constructor call in `main.js`. Assignment from it, spreading it, and placing it in an array are banned outright.
- [ ] The same test asserts set equality between the channels the scan finds (raw, gate and internal registrations together; 205 after this leg — 214 less the nine deleted) and the classification table's keys, in both directions, and throws rather than passing when the scan finds nothing.
- [ ] `LEGACY` contains exactly the channels still raw-registered after this leg — expected 91: 78 refusing (chrome 44, `ownsTab` 7, sheet 19, find 2, save-prompt 6; `automation:dev-invoke` among them) plus 13 guest — and the test pins that exact size. If the count differs, the developer reconciles against `ipc-census.md` by channel name and records the difference.
- [ ] **Neuter-verified**, with each result recorded in the flight log: (a) a planted bare `ipcMain.handle('zz-planted', …)` in a registrar file turns the guard red; (b) a planted registration by a computed name turns it red; (c) removing one table entry turns the equality red; (d) a planted gate registration under the wrong class throws at construction in a unit test. All four plants are removed afterwards.
- [ ] `test/unit/broadcast-invariant.test.js` still sees every migrated mutating handler: its registration pattern recognises the gate's call shapes, and a neuter check (remove the broadcast from one migrated settings-mutating handler → red) is recorded.
- [ ] Handlers passed by reference and handlers wrapped in a call (`catchLocked(…)`) are seen by the scan (the census counts 47 and 7).

### Behaviour and regression

- [ ] **Non-vacuity, recorded before any source change**: with the fixture page and harness written first, one run against the unmodified build shows the page's two calls **succeed** (a settings object comes back; the bookmarks bar setting flips — restored afterwards). The observation goes in the flight log. If the page-held object cannot send or invoke at all on the unmodified build, stop and report: the spec's apparatus is then wrong and the leg's live criterion needs redesign.
- [ ] `tests/behavior/guest-ipc-refusal.md` passes when run by the Flight Director after implementation (`/mission-control:behavior-test guest-ipc-refusal`).
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass. Unit tests that construct a registrar module run their handlers **through a real gate** (via the shared helper), not through a stub that skips the sender check.
- [ ] **Live smoke on the migrated build**, every existing apparatus primitive, compared line for line with Leg 1's "before" reading in `probe-results.md`: `enumerateWindows`, `enumerateTabs`, `openTab`, `navigate`, `readDom`, `evaluate`, `click`, `typeText`, `pressKey`, `captureScreenshot`, `captureWindow`, `getChromeTarget`. Plus these chrome flows, driven through the chrome target, each of which crosses a migrated channel: add and remove a bookmark; toggle the bookmarks bar; open the downloads list; open `goldfinch://automation` and see the activity list populate; reopen a closed tab (Ctrl+Shift+T); switch a Shields toggle and read it back; lock state indicator present.
- [ ] **Shared mechanism — IPC registration** (flight "Shared Mechanisms Touched"): the unit suite is the per-feature assertion; the smoke above is the live one. No new `app.on` or session-wide listener is installed by this leg.

### Docs

- [ ] `CLAUDE.md`: the main ↔ chrome routing paragraph names the gate as the only registration path and the guard test; the "read-only channel consumed by both … must be a bare `ipcMain.handle`" rule is replaced by the chrome-or-internal class; "non-secret data only" for `settings-get` is corrected to say what it now withholds. Wording states what is true after **this** leg (legacy channels still exist) — it does not claim the migration is complete.
- [ ] `docs/` references to any deleted channel are removed or corrected.

## Verification Steps

- `npm test` (use `timeout 300`), `npm run typecheck`, `npm run lint`, `npm run format:check`.
- `node --test test/unit/ipc-gate.test.js test/unit/ipc-gate-invariant.test.js`.
- Grep-AC, each hit judged: `grep -rnE "ipcMain\.(handle|on|once|handleOnce)\(" src/main` — every hit is the wrapper site in `internal-ipc.js`, inside `ipc-gate.js`, or registers a `LEGACY` channel.
- `grep -rn "automationKeyHashes\|automationAdminKeyHash" src/renderer src/preload` — no chrome-side read.
- `wc -l src/renderer/renderer.js` → 1504.
- Neuter results in the flight log, with the failing assertion text for each plant.
- Live smoke: `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_IPC_TRACE=1 npm run dev:automation`, key captured from the printed line, env-key script via `scripts/lib/mcp-client.mjs`. Never the registered `goldfinch-dev` MCP server.
- Behavior spec: run by the Flight Director.

## Implementation Guidance

1. **Table first.** Write `ipc-channel-table.js` from the census: every channel → class (`chrome`, `owning-chrome`, `chrome-or-internal`, `tab-guest`, `internal`, `sheet`, `find`, `save-prompt`), plus `LEGACY`. Then write the invariant test and watch it fail for the right reasons before any migration.
2. **Gate.** Model the module shape on the other Electron-free injected-deps modules (`settings-store.js`, `menu-overlay-manager.js`). The popup registry is consulted for the sender-kind trace and the tab-guest class — read `guest-wiring.js` for its real shape before designing the dependency. `event.senderFrame` can be `null`; treat that as refused. For the sync form, set `event.returnValue` in a `finally`.
3. **Test helper.** Expect real churn: about 19 unit files construct a migrated registrar and fetch handlers from a fake map to call with `{}` as the event; most of it collapses into four harnesses (`test/unit/helpers/jar-ipc-harness.js`, the settings and history harnesses, and `register-download-ipc.test.js`'s inline one). Deleting the nine channels retargets roughly 70 call sites in `history-ipc.test.js` and `jar-data-ipc.test.js` to the `internal-*` twins. `jar-registry-ipc.test.js`'s "twins receive the same handler identity" assertion cannot hold through a wrapping gate — rewrite it to assert the same underlying handler by behaviour or via the helper, and rename it to say so. One helper (under `test/helpers/`) that builds a real gate around a fake `ipcMain` and a registry fake in which a chosen sender is a window's chrome. Existing tests that call `ipcMain.handle` fakes directly and invoke handlers with `{}` as the event need a sender the gate accepts; update them through the helper rather than weakening the gate.
4. **Migrate file by file**, running the affected unit tests after each: `register-settings-ipc.js`, `register-bookmarks-ipc.js`, `register-download-ipc.js`, `register-tab-ipc.js`, `register-browser-ipc.js`, `jar-registry-ipc.js`, `jar-data-ipc.js`, `history-ipc.js`, `app-lifecycle.js`, `main.js`. The twin modules (`history-ipc.js`, `jar-*-ipc.js`) register one handler function twice; after this leg the bare line is either a gate registration or gone, and the `internal-*` line is untouched.
5. **`settings-get` and the broadcast.** Project in main at the IPC edge, not in the store; keep `internal-settings-get` and the store API as they are. `broadcastSettings` (`register-settings-ipc.js`) sends `settings.getAll()` to chromes and internal contents alike — find every other `settings-changed` sender too. Check what each internal page reads from the broadcast before choosing between one projected payload for all and a per-audience payload.
6. **Verbatim-move TDZ check** (project rule): any handler moved into a new scope is checked for references to `const` / `let` declared below the new site.
7. **Fixture and spec — first, before step 1's migration work begins** (the non-vacuity run needs the unmodified build). Add `refusal.html` beside the Q1 pages, served by the existing `server.cjs`. It reaches the IPC object the way the Q1 detector observed it and makes exactly the two calls the spec names — nothing else.
8. **Docs last**, then the smoke, then the flight-log entry.

## Edge Cases

- **A migrated chrome channel is also sent by a view that is not a window's chrome** (an overlay preload, the find bar): the gate will refuse it. Search every preload for each migrated channel name before migrating; the census "Sent by" column is the starting point.
- **Chrome recovery** reloads the chrome view in place; the sender's webContents identity is unchanged, so the chrome class still resolves. Confirm from `chrome-recovery.js` rather than assume.
- **A window mid-boot or mid-close**: `getWindowForChrome` returns `null` once the record is gone, so a late chrome message is dropped. That is today's behaviour for checked handlers; confirm `app-quit` and the last-window close path still work.
- **`automation:dev-invoke`** is conditional, dev-only and already chrome-checked: it stays in `LEGACY` this leg.
- **Conditional registrations** (28 in the census): the table lists the channel whether or not a given boot registers it; the equality assertion is against the source scan, not a running app.
- **A unit test asserts a channel is "bare by design"** (comments in `main.js` say so for several vault channels): that test is inverted or renamed in this leg, not deleted.
- **`vault-fill-human` under the owning-chrome class** while the vault leg is diverted: only the sender gate changes here; payload, picker and fill behaviour are untouched.

## Files Affected

- `src/main/ipc-gate.js`, `src/main/ipc-channel-table.js` — new.
- `src/main/main.js`, `app-lifecycle.js`, `register-settings-ipc.js`, `register-bookmarks-ipc.js`, `register-download-ipc.js`, `register-tab-ipc.js`, `register-browser-ipc.js`, `jar-registry-ipc.js`, `jar-data-ipc.js`, `history-ipc.js` — registrations.
- `test/unit/ipc-gate.test.js`, `test/unit/ipc-gate-invariant.test.js`, `test/helpers/` — new; existing registrar tests updated.
- `tests/behavior/guest-ipc-refusal.md` (authored), `tests/behavior/fixtures/page-containment-probe/pages/refusal.html` (new) — spec and fixture.
- `src/renderer/chrome/privacy-controller.js`, `src/renderer/chrome/window-controller.js` — indicator reads the derived field. `test/unit/broadcast-invariant.test.js` — registration pattern.
- `CLAUDE.md`, `docs/` — corrections.

## Citation Audit

Design review (Developer, 2026-11-13): approve with changes, all incorporated — hash projection extended to the broadcast with a derived indicator field (`privacy-controller.js:261-268,361-366`, `window-controller.js:179-184`, `register-settings-ipc.js:37`); `vault-capture-dismiss` reclassed chrome (`register-browser-ipc.js:315`); owning-chrome extractors per channel (`main.js:2541,2545`, `register-download-ipc.js:48-53,77`); `broadcast-invariant.test.js:201` pattern; test-churn guidance; non-vacuity run; tab-guest registrar deferred; enumerated `ipcMain` rule. Reviewer confirmed by channel-name diff that the 49 match the census, that no other preload sends any of them, and that the nine deletions have no sender outside unit tests.

Checked at `f1d4520` (2026-11-13): `registerInternalHandler` (`internal-ipc.js:71`, wrapper `ipcMain.handle(channel, …)` at `:72`); `requireChrome` / `ownsTab` (`register-tab-ipc.js:194-200`); `getWindowForChrome` / `getWindowForGuest` / `recordForOverlaySender` (`window-registry.js`); bare `settings-get`, `shields-get`, `shields-isolation-state` (`register-settings-ipc.js:39-45`), `automation:get-activity` (`:215`), `chrome-clipboard-write` (`:220`), `unpin-toolbar-item` (`:224`); bare `vault-lock-state-get`, `vault-automation-held-get`, `vault-lock`, `vault-reachable-items`, `vault-fill-human` (`main.js:2489-2545`); `automation:dev-invoke` chrome-checked and conditional (`app-lifecycle.js:437`); `automationKeyHashes` / `automationAdminKeyHash` in the settings shape (`settings-store.js:38-39`); chrome `settingsGet` consumers (`window-controller.js:104-156`); `GOLDFINCH_VAULT_TRACE` as the existing opt-in trace convention. The migration list was cross-read against `ipc-census.md`'s bare and non-refusing rows: 49 channels = 40 gated + 9 deleted. All present.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
