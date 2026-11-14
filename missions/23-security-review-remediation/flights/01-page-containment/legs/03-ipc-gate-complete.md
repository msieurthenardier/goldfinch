# Leg: ipc-gate-complete

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Move the remaining 91 `LEGACY` registrations onto the gate — the 78 already-refusing handlers and the 13 guest-preload channels — so that every main-process IPC channel is registered through a named caller class, then delete the `LEGACY` set and pin the guard at zero exceptions. Close the checks the census found weaker than their label along the way.

## Context

- Leg `ipc-gate` built the gate (`src/main/ipc-gate.js`: `chrome`, `owningChrome`, `chromeOrInternal`), the runtime-enforced classification table (`src/main/ipc-channel-table.js`: `CHANNEL_CLASS`, 205 rows; `LEGACY`, 91) and the standing guard (`test/unit/ipc-gate-invariant.test.js`). This leg finishes DD1/DD2 and carries DD3 and the 22a / 22c halves of DD13.
- **Source of truth**: [`ipc-census.md`](../ipc-census.md) rows for the 91 channels (an index — every class below is confirmed by reading the handler), [`guard-audit.md`](../guard-audit.md) Q7 (popups) and findings NF3, NF7, NF8, NF10.
- **What DD3 is worth, stated honestly**: Leg 1 Q1 showed a page comes to hold the preload's IPC object. Literal preload sends are therefore hardening, not the boundary; the boundary is the main-side class check. Docs say exactly that.
- **Decisions taken at leg design** (logged in the flight log):
  1. **Four new classes**, all in the gate: `tab-guest`, `sheet`, `find`, `save-prompt`. `find-overlay:close` is sent by both the find overlay and the chrome, so it takes a fifth, narrow class `find-or-owning-chrome` rather than widening either.
  2. **Refused synchronous messages must still be answered.** A `sendSync` whose handler never sets `event.returnValue` blocks the sending renderer. The tab-guest registrar's synchronous form therefore requires a refusal value and always sets `returnValue`.
  3. **The sheet class owns two of the four guards**: sender identity and the menu-type match. Token freshness and the business gate stay in each handler, where the payload shape is known.
  4. **Refusal stays a throw on invoke channels.** Electron prints its own handler-error line (channel name and a source path, no arguments) for each refused invoke; that is accepted and documented, not worked around.
  5. **`guest-media-list` payload validation is not in this leg** — DD8 owns it, in `jar-isolation-and-downloads`, beside the proxy-token change that consumes it. `guest-privacy-fp` validation (NF8) is here.
  6. **The vault gesture channels keep today's semantics** (`guest-vault-gesture`, `guest-vault-icon-menu`): they move onto the tab-guest class only. Active-tab, real-input and rate rules are `vault-fill-trust` (revised DD4).
- **Not in this leg**: any vault picker, fill or capture behaviour; media proxy; downloads; the `internal-*` channels (already behind `registerInternalHandler`, recognised by the guard as today).

## Inputs

- Branch `flight/01-page-containment` with leg `ipc-gate` landed (uncommitted); unit suite green at 6392 pass / 0 fail.
- `src/main/ipc-gate.js`, `src/main/ipc-channel-table.js`, `test/helpers/ipc-gate-fixture.js`, `test/unit/ipc-gate.test.js`, `test/unit/ipc-gate-invariant.test.js`.
- `src/main/window-registry.js` (`getWindowForChrome`, `getWindowForGuest`, `recordForOverlaySender`, the record's `activeTabWcId`); the popup registry (`isPopupWcId`, already injected into the gate at `main.js` — "isPopupWcId: (id) => popupRegistry.isPopupWcId(id)").
- `tests/behavior/guest-ipc-refusal.md` (active, 8/8 on 2026-11-13) and `tests/behavior/farbling-correctness.md`.

## Outputs

- `src/main/ipc-gate.js` extended with the five classes; `src/main/ipc-channel-table.js` with final classes for all 205 channels, a sheet menu-type table, and **no `LEGACY` export**.
- All 91 registrations routed through the gate; no raw `ipcMain.handle` / `ipcMain.on` in `src/main/**` outside `ipc-gate.js` and the `registerInternalHandler` wrapper body in `internal-ipc.js`.
- Guest preload sends literal; a preload-side guard test.
- `tab-create` argument validation; `guest-privacy-fp` validation; the media panel's bulk download handles a refused download.
- Updated unit tests, `CLAUDE.md`, `docs/`.

## Acceptance Criteria

### New classes (gate)

- [ ] **`tab-guest`**, one-way form and synchronous form. Admits a sender only when all hold: `event.senderFrame` is present and is that webContents' **main frame** (fail-closed when either is absent); the sender is a **web** tab in some window's `tabViews`. Three per-registration switches, each default off and each stated at the call site: `popups` (also admit a webContents in the popup registry), `internalTabs` (also admit a trusted internal tab), `activeOnly` (the sender must be its window's active tab). The handler signature is unchanged; `event.sender.id` remains the only source of the tab id.
- [ ] The synchronous form takes a mandatory refusal value and sets `event.returnValue` on **every** path — allowed (the handler's value), refused (the refusal value), and a handler throw (the refusal value). Unit-pinned for all three.
- [ ] **`sheet`**, **`find`**, **`save-prompt`**: sender identity via the registry's existing overlay-sender lookup for that window's sheet / find overlay / save-prompt view, in invoke and one-way forms. **`find-or-owning-chrome`**: the find overlay, or the chrome of the window that owns the find target, exactly as `find-overlay:close` behaves today.
- [ ] The `sheet` registrars take a mandatory menu-type argument: a non-empty list of menu types under which the channel is valid, or one of two explicit literals: `'any-open-menu'` (valid under every menu type, refused when no menu is open) or `'sender-only'` (sheet identity alone, valid even with no menu open — for `menu-overlay:sheet-drag` only, whose `end` phase arrives after the sheet has blur-closed). The gate reads the current menu from the sheet record's own `getCurrentMenu()` (`{ menuType, token, … }` or `null`), not the automation reader `sheetMenuFor`, and refuses when the current menu type is not listed. The lists live in one table in `ipc-channel-table.js`.
- [ ] Every new class: explicit refusal on invoke forms, registration-time class check against the table, one trace line on refusal with the sender kind, no added asynchrony. `ipc-gate.test.js` covers each class with an allowed sender, each kind of wrong sender, and each switch on and off.

### Migration (91 channels; classes confirmed per handler)

- [ ] **chrome (25)**: `window-boot-config` (refusal value: today's default `{ bootTab: true }`), `automation:dev-invoke`, `window-minimize`, `window-toggle-maximize`, `window-close`, `window-is-maximized`, `window-create`, `new-container-create`, `identity-new`, `downloads-snapshot`, `menu-overlay:open`, `menu-overlay:close`, `tearoff-overlay:show`, `tearoff-overlay:move`, `tearoff-overlay:hide`, `save-prompt:open`, `save-prompt:anchor`, `shields-restart-to-apply`, `tab-create`, `move-targets`, `bookmark-drag-started`, `bookmark-drag-ended`, `tab-adopt-by-drop` (the sender is the **target** window by design; its `dragWcId` gate stays), `tab-focus-guest`, `vault-capture-finalize` (opaque capture id; its inline owner-of-capture and active-tab gates stay).
- [ ] **owning-chrome (26)**, each with a stated tab-id extractor: `vault-fill-generated`, `tab-close`, `tab-certificate-get`, `tab-hide`, `tab-navigate`, `tab-set-active`, `tab-set-bounds`, `tab-find`, `tab-move-to-new-window`, `tab-move-to-window`, `tab-tear-off`, `tab-drag-started`, `tab-drag-ended`, and the thirteen that today take a tab id **without** an ownership check (NF7): `rescan-media`, `zoom-apply`, `get-zoom`, `print`, `toggle-devtools`, `is-devtools-open`, `page-context-correct`, `page-context-action`, `privacy-cookies`, `privacy-clear-cookies`, `privacy-clear-storage`, `find-overlay:open`, `tab-history-snapshot`.
- [ ] For those thirteen the behaviour change is deliberate and unit-pinned: a tab id owned by **another** window is refused, and an id that names a non-tab webContents (the chrome, an overlay) is refused. Before changing each, every chrome caller is read; if any caller legitimately names another window's tab or a non-tab webContents, stop and signal `[BLOCKED]` with the call site.
- [ ] If reading a handler shows `tab-focus-guest` (or any chrome-listed channel) takes a tab id, it moves to owning-chrome and the table says so; the totals in the guard move with it.
- [ ] **sheet (19)**: `menu-overlay:activated`, `:dismissed`, `:refocus` — `'any-open-menu'`; `:sheet-drag` — `'sender-only'`, keeping its inline `start`-phase `bookmarks-overflow` check, with a unit test that `end` with no menu open still reaches the chrome; `:overflow-drop`, `:cert-override-proceed`, `:vault-compromise`, `:vault-compromise-recover` — the menu type each already checks, now enforced by the gate with the inline check removed or kept as a redundant assertion (one choice, applied uniformly); and the **eleven with no menu-type guard today (22a)** — `:vault-unlock`, `:vault-setup`, `:vault-stepup-mint`, `:vault-import`, `:vault-rotate-recovery`, `:vault-rotate-admin`, `:vault-change-master`, `:vault-recover`, `:copy-text`, `:auth-submit`, `:bookmark-edit-submit` — each gains an explicit list.
- [ ] The lists, derived at design review from the single sender site of each preload method in `src/renderer/menu-overlay.js` and re-confirmed by the Developer before enforcing: `:vault-unlock` → `vault-unlock`; `:vault-setup` → `vault-set`; `:vault-stepup-mint`, `:vault-rotate-recovery`, `:vault-rotate-admin` → `vault-stepup` (one card, three modes; the mode is not in the current-menu record, so the three are not separable by menu type — do not try); `:vault-import` → `vault-import-unlock`; `:vault-change-master` → `vault-change-master`; `:vault-recover` → `vault-recover`; `:copy-text` → `vault-recovery-show`, `vault-accesskey-show`, `vault-adminkey-show`; `:auth-submit` → `auth-basic`; `:bookmark-edit-submit` → `bookmark-edit`. A difference found on re-confirmation is recorded in the flight log with its sender site; a channel whose senders cannot be enumerated is a `[BLOCKED]`, never a guess and never a literal.
- [ ] Unit tests, per channel of the eleven: allowed under each listed menu type; refused under one unlisted menu type and with no menu open; a refused call writes nothing (store, clipboard, auth callback, vault) — asserted on the fake, not inferred.
- [ ] **find (1)**: `find-overlay:query`. **find-or-owning-chrome (1)**: `find-overlay:close`. **save-prompt (6)**: `save-prompt:pointer`, `:focus`, `:height`, `:dismiss`, `:save`, `:consent` (token, kind and business gates stay inline).
- [ ] **tab-guest (13)** with these switches and no others: `shields-farble` (sync; `popups`), `vault-eligible` (sync; `popups`), `guest-window-close` (`popups`), `guest-tab-boundary` (`internalTabs`, `activeOnly` — NF3), and with all switches off: `guest-vault-gesture`, `guest-vault-icon-menu`, `guest-vault-capture`, `guest-vault-capture-card`, `guest-vault-capture-identity`, `guest-vault-gesture-settle`, `guest-media-list`, `guest-privacy-fp`, `guest-bookmark-drop`.
- [ ] Synchronous refusal values: `shields-farble` → farbling **on** with a per-call random seed (a refused sender never gets an un-farbled surface or the session's seed; this deliberately replaces `guard-audit.md`'s wording that a seed-changing refusal value is unsafe — the popup is admitted, as that audit asked, so the refusal value is reached only by a sender that is not a tab or popup main frame. It is **not** a protection against the page itself: an admitted main-frame page can read its own session's seed, and the docs say so); `vault-eligible` → `{ eligible: false, unlocked: false }`.
- [ ] `guest-privacy-fp`: main forwards only a validated object — keys from the fixed set the preload counts, values finite non-negative integers clamped to a stated ceiling; anything else is dropped whole. The key set (`canvas`, `webgl`, `audio` today) is single-sourced in a `src/shared/` module the preload bundle already can require.
- [ ] Total check in the guard: 25 + 26 + 19 + 1 + 1 + 6 + 13 = 91 for this leg; table still 205 keys.

### Added at design review

- [ ] **Table edits stated**: `vault-capture-finalize` moves from owning-chrome to chrome; `find-overlay:close` moves to the new `find-or-owning-chrome`; `CLASSES` and the guard's class map gain the five new classes.
- [ ] **Refusal values mirror today's inline results**, never a new throw where the caller awaits without a catch: `get-zoom` → `null`; `toggle-devtools`, `is-devtools-open` → `false`; `privacy-cookies` → today's empty cookie result; `privacy-clear-cookies` → `{ removed: 0 }`; `privacy-clear-storage` → today's no-tab failure object; `page-context-correct`, `page-context-action` → `undefined`; `tab-history-snapshot` → `null`; `vault-capture-finalize` → its existing refused shape; each sheet invoke → the shape its handler returns today for a wrong sender. Every other migrated invoke keeps whatever it does today (throw or value), read from the handler.
- [ ] **Extractors are defensive**: each tab-id extractor tolerates a missing or non-object payload (the `download-media` form); the gate treats an extractor throw as a refusal (unit-pinned for the one-way form, where a throw would otherwise escape the listener); a non-numeric tab id is refused.
- [ ] **Main-frame test**: the tab-guest class compares the sender frame with the sender's main frame by frame-tree node id inside a `try` (a disposed main frame can throw), never by `parent === null` (also true for a frame no longer in the tree). The shared test fixture gains opt-in main-frame support so existing suites are untouched.
- [ ] **Transferred secrets on refusal**: for sheet invokes that carry a byte array, a refused call zeroes the array main-side before returning, as the handler's own `finally` does on the allowed path. Unit-pinned on one channel and applied to all that carry one.
- [ ] **Guard at zero exceptions**: a registrar module that no longer registers anything raw stops taking an `ipcMain` parameter unless it calls `registerInternalHandler`; the guard's allowed contexts for the `ipcMain` token are restated accordingly and its plants updated.
- [ ] `save-prompt:open` stays plain chrome (its active-tab gate already implies ownership) — noted in the flight log, not changed.

### `tab-create` (22c)

- [ ] Arguments are validated **before** any `webPreferences` are chosen: on the `trusted` branch the URL must pass `isInternalPageUrl`; on the untrusted branch the URL must pass `isSafeTabUrl` and `partition` must pass ONE main-side predicate: a partition in the registered jars list, or a burner partition by exact shape (the renderer mints burner names — `burner:<digits>`; today's prefix test is tightened to that shape) — and never `INTERNAL_PARTITION`. `trusted` must be exactly `true` or `false` (a truthy string selects the internal branch today). A `url` is always required (no chrome path sends a URL-less create). When `restoreHistory` is present, every entry URL passes `isSafeTabUrl` (as `tab-reopen` already checks), `index` is an integer in range and the entry count is capped; otherwise the create is refused. A refused create returns `null` (today's no-window result) and constructs no view.
- [ ] `identity-new` validates its `partition` with the same predicate before `session.fromPartition`, so it can neither create nor wipe an arbitrary partition.
- [ ] Unit matrix: trusted + web URL, untrusted + `goldfinch://`, untrusted + unknown partition, untrusted + internal partition, `trusted: 'yes'`, a restore entry carrying `file:` and one carrying `goldfinch:`, an out-of-range restore index — each refused, no view constructed; every existing create path (new tab, container tab, burner, internal page, restore with history, external URL) still constructs.

### Preload (DD3)

- [ ] Every `ipcRenderer.send` / `sendSync` / `invoke` in the guest preload sources (`src/preload/webview-preload.js`, `src/preload/vault-fill-icon.js`, `src/preload/guest-bookmark-drop.js`, `src/preload/vault-capture-plan.js`) passes a **string literal** channel — including `guest-bookmark-drop.js`, which today sends a named constant. The capture-plan loop ("ipcRenderer.send(c.channel, c.payload)" in `webview-preload.js`) becomes a per-kind dispatch (login / card / identity) with one literal send each; the plan keeps its `channel` field (unit tests and the save-moment helpers read it) and a drift test asserts each kind's literal equals the plan's channel; the per-family `try` / no-early-return shape (planner/actuator rule) is preserved.
- [ ] New standing test: the set of literal channels sent by the guest preload sources equals the table's `tab-guest` set (both directions), and a non-literal first argument fails the test. The test scans the four source files, never the generated bundle; `internal-preload.js`'s one `guest-tab-boundary` send is asserted separately as its only guest-class send. Neuter-verified both ways.
- [ ] `npm run build:preload` regenerates the (gitignored) bundles and a guest page loads with the rebuilt bundle.

### Standing guard

- [ ] `LEGACY` is deleted. `ipc-gate-invariant.test.js` asserts: no raw `ipcMain.handle` / `ipcMain.on` call in `src/main/**` outside `ipc-gate.js` and the `registerInternalHandler` wrapper; an explicit empty exception list pinned at size 0; table keys equal registered channels (205). The four existing neuter checks are re-run and their failing text recorded; a fifth plants a raw registration of a formerly-`LEGACY` channel name and must fail.
- [ ] The closure-local `requireChrome` / `ownsTab` thin copies in the tab and browser registrars are deleted where no handler body still needs the record; where a handler needs the window record it calls the gate's export.
- [ ] No handler loses a check it has today: for each migrated handler, every inline business gate (token, active tab, capture owner, `dragWcId`, URL gate on `tab-navigate`) is still present after the edit. Verified by diff review, listed in the flight log by channel where the inline sender check was removed.

### Regression carried from leg `ipc-gate`

- [ ] The media panel's bulk download (`bulkPump` in `src/renderer/chrome/media-controller.js`) handles a rejected `downloadMedia`: the item is marked failed and the pump continues; no unhandled rejection. Unit-tested with a rejecting stub.

### Shared mechanisms (each sharer asserted unaffected)

- [ ] **The sheet** — sharers: kebab and context menus, pickers, suggestions, bookmark edit and overflow, site info and cert viewer, cert override, auth card and cert picker, input dialog, downloads popup, every `vault-*` card. Assertion: existing overlay unit suites green; `:activated` / `:dismissed` reach their handlers under every menu type (unit, table-driven over the menu types found in the code).
- [ ] **Synchronous guest boot** (`shields-farble`, `vault-eligible`) — sharers: every web page load in a tab or popup. Assertion: live — a tab page and a popup page both finish loading and farbling is active in each.
- [ ] **Find overlay**, **save prompt** — existing unit suites green; live find open / query / close.

### Behaviour and regression

- [ ] `/mission-control:behavior-test guest-ipc-refusal` passes (run by the Flight Director).
- [ ] `/mission-control:behavior-test farbling-correctness` passes (run by the Flight Director) — the synchronous channel's real consumer. That spec is `draft` and cannot see a wrongly refused frame (a refused frame is still farbled, with the wrong seed), so the smoke below carries the decisive check.
- [ ] **Seed-equality smoke** (the only observable for a wrongly refused synchronous call): the same canvas read gives an equal hash in two tabs of one jar, in an opener and its popup, in one tab before and after a cross-site navigation, and after back / forward; and a different hash in a different jar. Any inequality within a jar is a failed AC.
- [ ] `guest-ipc-refusal` is extended by this leg (spec steps 9–10 and a second fixture function, authored with the leg): the page, holding the IPC object, calls one sheet-class invoke, one find-class send and one save-prompt-class send; each is refused with a trace line naming its class and sender kind `tab`, and nothing changes.
- [ ] Live smoke (dev mode, env-key script, never a registered MCP server) exercises **every** apparatus primitive (`enumerateWindows`, `enumerateTabs`, `getChromeTarget`, `openTab`, `navigate`, `readDom`, `evaluate`, `click`, `typeText`, `pressKey`, `captureScreenshot`, `captureWindow`, `readAxTree`, `scroll`, `findInPage`, zoom get/set, DevTools open/close, `printToPDF`) and these flows: a page opens a popup with `window.open` and the popup closes itself with `window.close()`; a tab page calls `window.close()`; Tab-key traversal out of a page reaches the chrome (`guest-tab-boundary`) from the active tab, and a **background** tab's boundary message moves nothing (run the fixture's call from a non-active tab and read the chrome's `document.activeElement`); the vault icon's eligibility on a persistent-jar tab versus a burner tab; find in page; a second window, a tab moved to it and back; zoom, DevTools toggle, privacy panel cookie list and clear (chrome DOM through the chrome target); new container through the chrome bridge call (its input dialog is on the sheet — `[by-eye]`); new window; reopen closed tab. Not driven: `print` (native dialog — channel unit-tested only) and the find overlay's own input (`find-overlay:query` — a separate view automation cannot script; unit-tested, `[by-eye]`). An iframe page (one same-origin, one cross-site frame) confirms the preload does not run in subframes.
- [ ] With `GOLDFINCH_IPC_TRACE=1`, a grep of the smoke's stdout for `[ipc-gate] refused` returns only the deliberate negative cases, each matched to its expected channel in the flight log.
- [ ] `[by-eye]`, deferred to `hat-and-alignment` and listed there by this leg: every sheet card behind the eleven newly guarded channels (unlock, set-up, step-up, import, both rotations, change master, recover, copy from a card, auth card, bookmark edit), tab tear-off by drag, and the save prompt's buttons. The Developer does not claim these as verified.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `renderer.js` ≤ 1505 lines, `bookmarks-bar.js` ≤ 1100, evaluate seam 41.

### Docs

- [ ] `CLAUDE.md`: the routing section states every channel is gate-registered and names the classes; the sheet section's four-guard rule names the gate as owner of the first and third guards; the guest section states literal sends are hardening and the main-side class is the boundary; the `LEGACY` sentence is removed. `docs/` updated where a statement became false.

## Verification Steps

1. `grep -rnE "ipcMain\.(handle|on)\(" src/main` — hits only in `ipc-gate.js` and the wrapper in `internal-ipc.js`.
2. `grep -n "LEGACY" src test` — no hit outside comments describing history.
3. `npm test` (with the runner's timeout), `npm run typecheck`, `npm run lint`, `npm run format:check`.
4. Neuter runs recorded with failing text (guard ×5, preload set ×2, one sheet menu-type list emptied → registration throws).
5. Live smoke as above with the trace on; stdout saved outside the project tree.
6. Flight Director: the two behavior tests.

## Implementation Guidance

1. Read every one of the 91 handlers before editing; record any class that differs from this leg in the flight log, with the reason.
2. Extend the gate and its unit tests first (classes, sync form), with no migration.
3. Re-confirm the sheet menu-type lists against `menu-overlay.js` and record them.
4. Migrate file by file in this order, running the suite after each: `app-lifecycle.js`, `register-settings-ipc.js`, `register-download-ipc.js`, `register-save-prompt-ipc.js`, `register-overlay-ipc.js`, `register-tab-ipc.js`, `register-browser-ipc.js`, `main.js`.
5. `tab-create` validation, `guest-privacy-fp` validation, preload literals + bundle rebuild, `bulkPump`.
6. Delete `LEGACY`, tighten the guard, run neuters.
7. Live smoke; docs.

## Edge Cases

- **Subframes (NF10).** The repo contradicts itself on whether the guest preload runs in subframes. Settle it first: check `webPreferences` for `nodeIntegrationInSubFrames` and confirm live with a page that embeds a same-origin and a cross-site iframe. If the preload does run in subframes and a subframe legitimately needs `shields-farble`, stop and signal `[BLOCKED]` — main-frame-only would then break farbling there and the class needs a ruling.
- **`senderFrame` null** during navigation or teardown: refused for one-way; the sync form still answers.
- **Popups** are not in `tabViews`; only the three listed channels admit them. A popup sending any other guest channel is refused and that is today's effective behaviour (those handlers resolve no tab for a popup) — confirm per handler.
- **Internal tabs** send only `guest-tab-boundary` (from `internal-preload.js`).
- **Viewless welcome tabs** have no webContents and send nothing; chrome calls that name `null` pass owning-chrome as chrome-only and the handler's own null handling applies.
- **A tab mid-move between windows**: ownership is resolved at event time; a message arriving during the move is judged against the current owner.
- **Conditional registrations** (the sheet's `vault-*`, `copy-text`, `auth-submit`, `bookmark-edit-submit`, `cert-override-proceed`; `automation:dev-invoke`) stay conditional; the table lists them regardless and the guard already tolerates that.
- **`find-overlay:close` from the chrome** names a tab; from the find overlay it does not.
- **Verbatim-move TDZ check**: any handler body moved into a new function scope keeps every referenced binding declared above its use.

## Files Affected

`src/main/ipc-gate.js`, `src/main/ipc-channel-table.js`, `src/main/app-lifecycle.js`, `src/main/main.js`, `src/main/register-{browser,tab,overlay,save-prompt,settings,download}-ipc.js`, `src/preload/webview-preload.js`, `src/preload/vault-fill-icon.js`, `src/preload/guest-bookmark-drop.js`, `src/preload/vault-capture-plan.js`, a new `src/shared/` key-set module, `tests/behavior/fixtures/page-containment-probe/pages/refusal.html`, `src/renderer/chrome/media-controller.js`, `test/unit/ipc-gate*.test.js`, the registrars' unit tests and `test/helpers/ipc-gate-fixture.js`, a new preload-channel guard test, `CLAUDE.md`, `docs/`.

## Citation Audit

Checked against the working tree on 2026-11-13 (leg `ipc-gate` landed, uncommitted): the 91 `LEGACY` names read from `ipc-channel-table.js`; guest registrations at `register-browser-ipc.js` — "ipcMain.on('shields-farble'", "ipcMain.on('vault-eligible'", "ipcMain.on('guest-tab-boundary'", "ipcMain.on('guest-privacy-fp'", "ipcMain.on('guest-window-close'" — and `register-tab-ipc.js` — "ipcMain.on('guest-bookmark-drop'"; the two `event.returnValue` sites; preload send sites including "ipcRenderer.send(c.channel, c.payload)"; `tab-create`'s branch on `trusted` ahead of its sender check. Census line numbers have drifted since leg `ipc-gate` edited these files; cite by symbol. Design review (2026-11-13) verified from code: the per-channel sheet menu types (one sender site each in `menu-overlay.js`), the callers of the thirteen NF7 channels (none names another window's tab or a non-tab webContents), `tab-focus-guest` takes no argument, burner partitions are renderer-minted `burner:<n>`, no `nodeIntegrationInSubFrames` anywhere in `src/`, `bulkPump` has no rejection handler.

## Post-Completion Checklist

- [ ] Leg status `landed`; flight log entry under `## Leg Progress` with the derivations, neuter text, smoke observations and any deviation.
- [ ] No commit. Signal `[LAND:leg]`.
