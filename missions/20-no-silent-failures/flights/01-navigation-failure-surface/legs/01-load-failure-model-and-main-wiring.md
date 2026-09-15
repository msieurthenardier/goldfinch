# Leg: load-failure-model-and-main-wiring

**Status**: completed
**Flight**: [The Failure Surface and Navigation Errors](../flight.md)

## Objective

Main learns about every failed top-frame load, records it on the tab's own
registry entry, hides the guest under the flight's two-axis visibility/focus
invariant, keeps the intended address authoritative for the address bar and
persistence, and pushes the failure to the owning chrome — with the pure
classification model that the chrome leg will render and the census will
report.

## Context

- **Design decisions in force**: DD1 (two-axis invariant via one helper,
  every show/focus site enumerated), DD2 (`did-fail-load`, main frame,
  never `-3`; clear on the next real navigation; `lastRequestedUrl`
  sources), DD3 (pure model + `LOAD_STATES`), DD4 (`effectiveUrl`), DD8
  (adopt re-push). Read them in `../flight.md` before starting.
- **DD4 refinement (this leg)**: `effectiveUrl(entry)` substitutes
  `entry.lastRequestedUrl` whenever the live URL is a `chrome-error:` URL
  and the field is non-null — *not* only while `loadFailure` is set. The
  error document's `did-navigate` may fire BEFORE `did-fail-load` (spike
  check (d) settles the order), so an order-independent predicate is the
  only safe one. If the live URL is not `chrome-error:`, it is returned
  as-is.
- **The spike comes first (CP1).** Four premises are settled on the live rig
  before the design is locked: (a) `did-fail-load` fires for provisional
  failures (DNS, refused); (b) what `wc.getURL()` and the `did-navigate`
  push carry after the error commit; (c) toolbar Reload on an error page
  retries the original URL; (d) whether the error document's own
  `chrome-error://chromewebdata/` commit raises `did-start-navigation` /
  `did-navigate`, and in what order relative to `did-fail-load`. Recorded in
  the flight log as a table (event → args → order), instrumentation removed
  afterwards. Every outcome has a designed branch; none is a divert unless
  (a) fails AND `did-fail-provisional-load` does not fire either.
- **This leg is safe to land alone**: the chrome has no subscriber for
  `tab-load-failure` yet (an `ipcRenderer.on` with no listener is inert) and
  no consumer of the new entry fields. A failed tab will show a *hidden*
  guest over the chrome's `#webviews` background until leg 2 renders the
  panel — on the flight branch only, never merged in that state.
- **Nothing in this leg touches chrome files** except `chrome-preload.js`
  (one subscription) and `renderer-globals.d.ts` (its typing).
- **House rules that bite here**: never read `win.*` in `closed`-or-later
  handlers; every guest event handler stays inside `guard()`; the
  `moveTabIntoWindow` synchrony invariant (no `await` between the
  `tabViews.delete` and `.set`) must survive untouched; Electron-free
  modules take live handles as arguments; `src/shared/` modules are ESM
  with `.js` import extensions, `require(esm)`-testable.

## Inputs

- Flight branch `flight/01-navigation-failure-surface` at the planning
  baseline commit `1c76c2b`; working tree clean; `npm test` 4469/4469 green
  (13 suites), lint/typecheck/format:check green.
- `src/main/guest-wiring.js` — `wireTabViewEvents(view, wcId, partition)`
  (`:437`), `sendToChrome` (`:439`), `guard` (`:440-445`), the existing
  `did-start-navigation` handler (`:451-456` — `e.isMainFrame &&
  !e.isSameDocument` gate), `did-navigate` (`:457-470`).
- `src/main/register-tab-ipc.js` — `tab-create` entry creation
  (`:154 — "rec.tabViews.set(wcId, { view, partition: …, trusted, active:
  false })"`), restore branch (`:175-184`), `loadURL` (`:185`);
  `moveTabIntoWindow` (`:424`, show at `:488 — "entry.view.setVisible(true)"`,
  `entry.active = true` at `:511`, adopt send at `:595 — "queueChromeSend(target,
  () => ['adopt-tab', …])"`); `tab-hide` (`:844`); `tab-navigate` `loadURL` (`:895`);
  `tab-focus-guest` (`:919-928`); `tab-set-active` (`:930`; show at
  `:976`, raise `:981`, `wasPageFocused` re-arm `:988`).
- `src/main/window-registry.js` `WindowRecord` typedef (`:35-50`).
- `src/main/main.js` — `createGuestWiring({...})` deps object (`:1673-1699`)
  and `registerTabIpc(...)` (`:1891`); `require('./register-tab-ipc')` at
  `:111`.
- `src/main/session-snapshot.js` (`:41 — "url: wc.getURL()"`),
  `src/main/closed-tab-capture.js` (`:67 — "url: wc.getURL()"`).
- `src/main/window-factory.js` `isFindableTab` (`:220-223`).
- `src/preload/chrome-preload.js` push subscriptions (`:348-354`),
  `src/renderer/renderer-globals.d.ts` — interface `GoldfinchBridge` (`:46`),
  `onTabDomReady` at `:500` (the new declaration lands beside it).
- Unit harnesses: `test/unit/guest-wiring.test.js` (`FakeContents` extends
  `EventEmitter`, `:19-56`; `setup()` `:58`; tab-event tests drive
  `h.wiring.wireTabViewEvents({ webContents: wc }, wcId, 'persist:jar-a')`
  then `wc.emit(...)`), `test/unit/register-tab-ipc.test.js` (`FakeIpc`/`FakeContents`/`FakeView`
  with a `visible`-tracking `setVisible`, `setup()`/`addTab()` `:8-217`;
  already drives `tab-set-active`, `tab-focus-guest`, and
  `tab-move-to-new-window` via `h.ipcMain.invoke(...)` — the move tests live
  IN this file, there is no separate move suite),
  `test/unit/session-snapshot.test.js` (`makeWc` `:24-26`, `makeEntry`
  `:28-30`), `test/unit/closed-tab-capture.test.js` (same shape, `:34-44`).

## Outputs

- `src/shared/load-failure.js` (new, ESM) — `LOAD_STATES`,
  `classifyLoadFailure`, `shouldRecordLoadFailure`, `isChromeErrorUrl`.
- `src/main/tab-entry-url.js` (new, Electron-free) — `effectiveUrl(entry)`.
- `src/main/register-tab-ipc.js` — entry fields, `applyGuestVisibility`,
  `lastRequestedUrl` stamps, gated focus sites, adopt re-push.
- `src/main/guest-wiring.js` — `did-fail-load` handler, extended
  `did-start-navigation`, `effectiveUrl` in the `did-navigate` push.
- `src/main/session-snapshot.js`, `src/main/closed-tab-capture.js` —
  `effectiveUrl`.
- `src/main/window-factory.js` — `isFindableTab` exclusion.
- `src/main/window-registry.js` — typedef.
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts` —
  `onTabLoadFailure`.
- Tests: `test/unit/load-failure.test.js` (new),
  `test/unit/tab-entry-url.test.js` (new), extensions to
  `guest-wiring.test.js`, `register-tab-ipc.test.js`,
  `session-snapshot.test.js`, `closed-tab-capture.test.js`, and a new
  `test/unit/guest-visibility-invariant.test.js` (grep-AC).
- Flight log: spike table + leg entry.

## Acceptance Criteria

- [ ] **AC0 — Spike recorded.** The flight log has a "Leg 1 spike" table
      with the measured answers to (a)–(d), each with the observed event
      order for the refused (`http://127.0.0.1:1/`) and DNS (`.invalid`)
      cases and the Reload observation; temporary instrumentation is removed
      (the diff contains no leftover spike logging).
- [ ] **AC1 — Pure model.** `src/shared/load-failure.js` exports:
      `LOAD_STATES = Object.freeze({ OK: 'ok', FAILED: 'failed' })`;
      `classifyLoadFailure({ code, name })` returning
      `{ kind, title, body, retryable }` for every kind in DD3 (`dns`,
      `refused`, `timeout`, `offline`, `unreachable`, `dropped`, `cert`,
      `tls`, `blocked`, `redirect-loop`, `scheme`, `unknown`), matching on
      `name` first (any `ERR_CERT_*` → `cert`) and code second, never
      throwing on `undefined`/non-string input (→ `unknown`);
      `shouldRecordLoadFailure({ errorCode, isMainFrame })` → `true` only
      when `isMainFrame === true` and `errorCode !== -3`;
      `isChromeErrorUrl(url)` → `true` for any string starting with
      `chrome-error:`. `test/unit/load-failure.test.js` pins the full truth
      table via `require(esm)`.
- [ ] **AC2 — Entry fields.** Every `tabViews` entry created by `tab-create`
      carries `loadFailure: null` and `lastRequestedUrl: string | null`
      (initialised to the `loadURL` argument, or to
      `restoreHistory.entries[restoreHistory.index]?.url ?? null` on the
      restore branch). The `WindowRecord` typedef and the
      `session-snapshot.js` entry typedef document both fields.
- [ ] **AC3 — Failure recorded, guest hidden, find closed, chrome told — in
      that order.** `wireTabViewEvents` handles `did-fail-load` inside
      `guard()`: when `shouldRecordLoadFailure` passes, it sets
      `entry.loadFailure = { code: errorCode, name: errorDescription, url:
      validatedURL }`, sets `entry.lastRequestedUrl = validatedURL` (when
      non-empty), then — if the entry is the owner's active tab —
      `applyGuestVisibility(entry)` (hides) and `owner.findOverlay?.hide()`,
      then `sendToChrome('tab-load-failure', { wcId, failure })` where
      `failure` is the recorded object. Subframe failures and `-3` are
      ignored entirely (no state, no push). A unit test pins the call order
      with a recording fake.
- [ ] **AC4 — Clear on the next real navigation only.** The existing
      `did-start-navigation` handler additionally, for `e.isMainFrame &&
      !e.isSameDocument && !isChromeErrorUrl(e.url)`: stamps
      `entry.lastRequestedUrl = e.url`, and if `entry.loadFailure` was
      non-null, sets it to `null`, calls `applyGuestVisibility(entry)`
      (shows if active), and `sendToChrome('tab-load-failure', { wcId,
      failure: null })`. A `did-start-navigation` whose `url` is
      `chrome-error:` changes nothing (unit-pinned). The auth-challenge
      cancel already in that handler is unchanged.
- [ ] **AC5 — `lastRequestedUrl` stamped at every request site.**
      `tab-navigate`'s `loadURL` branch stamps the entry before calling
      `wc.loadURL`; `tab-create` stamps per AC2. (The `did-start-navigation`
      stamp of AC4 covers page-initiated navigations.)
- [ ] **AC6 — `effectiveUrl`.** `src/main/tab-entry-url.js` exports
      `effectiveUrl(entry)`: reads `entry.view.webContents.getURL()`; if
      `isChromeErrorUrl(url) && entry.lastRequestedUrl` returns
      `entry.lastRequestedUrl`, else returns `url`. Consumed by the
      `did-navigate` push (`tab-did-navigate` payload `url` AND the history
      recorder's `url`), `buildSessionSnapshot`, and
      `captureClosedTabEntry`. Unit tests: the helper's truth table; the
      snapshot and closed-tab suites gain a failed-entry case asserting the
      intended URL, and the `did-navigate` test asserts the substituted push.
      *(The `did-navigate-in-page` push is unchanged — an in-page navigation
      cannot land on an error document.)*
- [ ] **AC7 — Two-axis invariant through one helper.** `register-tab-ipc.js`
      defines `applyGuestVisibility(entry)` (`setVisible(entry.active &&
      !entry.loadFailure)` on a non-destroyed view) and every guest show
      site calls it: `tab-set-active` (replacing the bare `setVisible(true)`
      at `:976`, with `entry.active = true` set BEFORE the call),
      `moveTabIntoWindow` (replacing `:488`; note `entry.active = true` is
      currently set AFTER the show at `:511` — move that assignment to
      before the helper call; it is a synchronous reassignment outside the
      `tabViews.delete`/`.set` pair, so the synchrony pin is untouched),
      and the two `guest-wiring.js` transitions. **Placement is decided**:
      `applyGuestVisibility` is a plain TOP-LEVEL function in
      `register-tab-ipc.js` (NOT nested in `registerTabIpc(deps)`'s closure
      like `queueChromeSend`/`ownsTab` — it needs no injected deps),
      exported as `module.exports = { registerTabIpc, applyGuestVisibility }`;
      `main.js` requires it and passes it into `createGuestWiring({...})`'s
      deps object (`main.js:1673-1699`) — deps threading, so
      `guest-wiring.test.js`'s `setup()` can inject a RECORDING fake and
      AC3's call-order test is a real order assertion, not a side-effect
      inference. Focus axis:
      `tab-set-active`'s `wasPageFocused` re-arm is skipped when
      `entry.loadFailure` is set; `tab-focus-guest` returns `false` for a
      failed active tab without calling `focus()`. After this leg,
      `grep -n "setVisible(true)" src/main/register-tab-ipc.js` returns
      **zero** hits (grep-AC, pinned by
      `test/unit/guest-visibility-invariant.test.js`, which also asserts
      the helper name appears at ≥ 3 call sites and that `tab-focus-guest`'s
      body references `loadFailure`). `register-browser-ipc.js:499`'s
      `wc.focus()` is acknowledged in that test's header comment as
      structurally unreachable while hidden (context-menu path only) and is
      NOT gated.
- [ ] **AC8 — Find exclusion.** `isFindableTab` in `window-factory.js`
      additionally requires `!entry.loadFailure`.
- [ ] **AC9 — Adopt re-push.** In `moveTabIntoWindow`, immediately after
      the `adopt-tab` `queueChromeSend`, when `entry.loadFailure` is set a
      second `queueChromeSend(target, () => ['tab-load-failure', { wcId,
      failure }])` is queued (same boot-gated path, so it lands after the
      adopt payload). The moved guest stays hidden (AC7). Unit-pinned in the
      move suite.
- [ ] **AC10 — Preload + typing.** `chrome-preload.js` exposes
      `onTabLoadFailure: (cb) => ipcRenderer.on('tab-load-failure', (_e, d)
      => cb(d))` beside the other `onTab*` lines; `renderer-globals.d.ts`
      declares `onTabLoadFailure(cb: (d: { wcId: number; failure: { code:
      number; name: string; url: string } | null }) => void): void;`.
- [ ] **AC11 — Gates.** `npm test` (all suites, `--test-timeout` set),
      `npm run lint`, `npm run typecheck`, `npm run format:check` all green;
      no existing test renamed or deleted except by explicit inversion noted
      in the flight log (none is expected — no test pins a shown-while-failed
      guest today).
- [ ] **AC12 — Live check.** On the rig, navigating a tab to
      `http://127.0.0.1:1/` leaves the guest hidden (the chrome's
      `#webviews` background is what paints), `enumerateTabs` still reports
      `url: "http://127.0.0.1:1/"` (never `chrome-error:`), and a subsequent
      `navigate` to a reachable page re-shows the guest. Recorded in the
      flight log with the exact observations (screenshot via
      `captureWindow` optional).

## Verification Steps

- AC0/AC12: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  npm run dev:automation`, drive with `scripts/lib/mcp-client.mjs` (or the
  example client) per `docs/dev-testing.md`; read main's stdout for the
  spike instrumentation; use `enumerateTabs` and `captureWindow`.
- AC1: `node --test test/unit/load-failure.test.js` — one assertion per
  kind, the `-3`/subframe predicate cases, the `chrome-error:` predicate.
- AC3/AC4/AC6: `node --test test/unit/guest-wiring.test.js` — new cases
  emit `wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED',
  'http://x.invalid/', true)`, `(..., false)` (subframe), `(..., -3, …)`,
  then `wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument:
  false, url: 'http://ok.test/' })` and the `chrome-error:` variant; the
  fake registry record needs `activeTabWcId`, `findOverlay: { hide }`, and
  a `tabViews` Map holding the entry.
- AC2/AC5/AC7/AC9: `node --test test/unit/register-tab-ipc.test.js` (the
  move tests live in this same file) — assert the entry shape after `tab-create`; activate a
  failed entry and assert `setVisible(false)` and no `focus()`;
  `tab-focus-guest` → `false`; move a failed entry and assert the queued
  re-push and hidden state.
- AC6: `node --test test/unit/tab-entry-url.test.js
  test/unit/session-snapshot.test.js test/unit/closed-tab-capture.test.js`.
- AC7 grep-AC: `node --test test/unit/guest-visibility-invariant.test.js`.
- AC11: `npm test && npm run lint && npm run typecheck && npm run
  format:check`.

## Implementation Guidance

1. **Spike (CP1) before any design-bearing code.** Add temporary
   `logger.info` lines in `wireTabViewEvents` for `did-start-navigation`
   (url, isMainFrame, isSameDocument), `did-navigate` (`wc.getURL()`),
   `did-fail-load` (all args), and `did-fail-provisional-load`; launch;
   navigate to the refused and DNS URLs; then click the toolbar Reload and
   observe whether the original URL is re-requested. Write the table into
   the flight log's Leg Progress section. Remove the instrumentation.
2. **Model** — `src/shared/load-failure.js`: a frozen table keyed by
   `name` with a `code` fallback map; app-authored copy (short title, one
   sentence body, no engine strings interpolated); `retryable: true` for
   all but `scheme` and `blocked`. Keep it DOM-free and side-effect free.
3. **`tab-entry-url.js`** — three lines of logic, imports
   `isChromeErrorUrl` from the shared model (CJS `require` of the ESM file
   — the established main-side pattern: `settings-store.js:24`,
   `bookmarks-store.js:53`, `main.js:43` all `require('../shared/url-safety')`).
   Both new files carry `// @ts-check` (house style; `jsconfig.json` checks
   `src/**/*.js` regardless).
4. **Entry fields + stamps** in `register-tab-ipc.js`; then
   `applyGuestVisibility` as a top-level exported function (see AC7 —
   placement is decided); replace the two `setVisible(true)` sites; gate
   the two focus sites; add the helper to `createGuestWiring`'s deps in
   `main.js` and to `guest-wiring.test.js`'s `setup()` as a recording fake.
5. **`guest-wiring.js`** — the `did-fail-load` handler and the extended
   `did-start-navigation`; resolve the owner record via
   `registry.getWindowForGuest(wcId)` and the entry via
   `owner.tabViews.get(wcId)` (both already available in this file's deps);
   `effectiveUrl` in the `did-navigate` push.
6. **Persistence readers**, `isFindableTab`, adopt re-push, preload, typing.
7. **Tests**, then gates, then the live check (AC12), then the flight-log
   entry.

## Edge Cases

- **Failure on an inactive tab**: record + push only; the helper's
  `setVisible(false)` on an already-hidden view is a no-op; no find/sheet
  touch (not the active tab).
- **Retry fails again**: `did-start-navigation` clears (shows, pushes
  `null`), then `did-fail-load` records again (hides, pushes) — two pushes,
  latest wins; no dedupe needed.
- **Failure arrives during teardown**: `guard()` drops it; the entry may
  already be gone from `tabViews` — null-check the entry, never throw.
- **`validatedURL` empty** (some engine paths): keep the prior
  `lastRequestedUrl`; `failure.url` falls back to it.
- **Fullscreen tab fails**: hide via the helper regardless; the
  `htmlFullscreen` exit path already re-shows on exit, and the invariant
  re-hides — acceptable; note if the spike shows anything odd.
- **Popup windows** (`did-create-window` guests) have no `tabViews` entry
  and are wired by `wireGuestContents` only — out of scope; a popup that
  fails stays as today.
- **Internal (`goldfinch://`) tab fails** (bad route): same path; the entry
  is `trusted` — the chrome panel (leg 2) renders regardless of trust.
- **Session restore of a failed tab**: the snapshot carries the intended
  URL (AC6), so restore retries it at boot — desired.
- **Shields never produces a main-frame failure**: `applyShields`'s
  `onBeforeRequest` excludes `resourceType === 'mainFrame'` from the block
  path (`session-runtime.js:176`), so the `blocked` kind is reached only by
  upstream/extension-originated cancels — say so in the model's comment.
- **`guardNav` refusals are not failures**: a `will-navigate`/`will-redirect`
  `preventDefault()` from the two-point hostile-URL boundary cancels before
  the navigation starts and raises no `did-fail-load` — a deliberate
  security refusal, out of this mission's scope (recorded here so nobody
  reads its silence as a gap).

## Files Affected

- `src/shared/load-failure.js` — new pure model
- `src/main/tab-entry-url.js` — new `effectiveUrl`
- `src/main/register-tab-ipc.js` — entry fields, helper, stamps, focus
  gates, adopt re-push
- `src/main/guest-wiring.js` — `did-fail-load`, `did-start-navigation`,
  `did-navigate` push
- `src/main/session-snapshot.js`, `src/main/closed-tab-capture.js` —
  `effectiveUrl`
- `src/main/window-factory.js` — `isFindableTab`
- `src/main/window-registry.js` — typedef
- `src/main/main.js` — `require` + thread `applyGuestVisibility` into
  `createGuestWiring` deps
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`
- `test/unit/load-failure.test.js`, `test/unit/tab-entry-url.test.js`,
  `test/unit/guest-visibility-invariant.test.js` — new
- `test/unit/guest-wiring.test.js`, `test/unit/register-tab-ipc.test.js`,
  `test/unit/session-snapshot.test.js`,
  `test/unit/closed-tab-capture.test.js` — extended
- `missions/20-no-silent-failures/flights/01-navigation-failure-surface/flight-log.md`

## Citation Audit

2026-09-15 (design + Developer design review): every `file:line` above
re-checked against `flight/01-navigation-failure-surface` @ `1c76c2b`
(identical to `main` @ `0fcb100` for `src/`): `register-tab-ipc.js` `:154`,
`:175-184`, `:185`, `:424`, `:488`, `:511` (corrected from `:512`), `:595`,
`:844`, `:895`, `:919-928`, `:976`, `:981`, `:988`; `guest-wiring.js`
`:437-470`; `session-snapshot.js:41`; `closed-tab-capture.js:67`;
`window-factory.js:220-223`; `window-registry.js:35-50` (corrected);
`chrome-preload.js:348-354`; `renderer-globals.d.ts:500` (`onTabDomReady`,
corrected; interface `GoldfinchBridge` `:46`); `main.js:111`, `:1673-1699`,
`:1891` — all present with the quoted snippets.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
