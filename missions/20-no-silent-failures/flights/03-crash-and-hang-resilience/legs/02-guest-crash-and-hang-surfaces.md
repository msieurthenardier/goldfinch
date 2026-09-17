# Leg: guest-crash-and-hang-surfaces

**Status**: completed
**Flight**: [Crash and Hang Resilience](../flight.md)

## Objective

Make a dead guest renderer a crashed tab (hidden guest, the Flight 1 panel
specialised with reason copy and a Reload that revives it with history
intact, a marked strip entry, a `crashed` census state) and a frozen one a
hung tab (a non-blocking bar under the toolbar with Wait and Kill-and-reload,
cleared when the renderer answers), with every new state on its own push
channel, one strip-state derivation, one guest-takeover predicate, and the
admin census exposing each tab's renderer pid.

## Context

- Flight DDs binding this leg: **DD1** (crash surface; crash clears
  `loadFailure`/`hung`; `deriveStripLoadState`; `guestTakenOver`;
  `failedTabTitle` reads the crash url; F6 parity), **DD2** (clean-exit and
  teardown are not crashes; popup crash = record + close — the RECORD half
  lands in leg 3 with `crash-log.js`, this leg leaves a named hook), **DD3**
  (hang bar; kill-and-reload sequencing), **DD4** (no watchdog), **DD9**
  (census + admin pid), **DD12** (frozen contracts). Flight-log
  **Decisions**: the kill-reload bypass gates on `entry.killRequested`
  ALONE — never on `reason` (spike (f): `forcefullyCrashRenderer()` yields
  `crashed`/133 here, a real SIGKILL yields `killed`/9, SEGV `crashed`/139).
- Spike facts to build on: `render-process-gone` fires for a signalled guest;
  the `WebContents` object survives; `getURL()` and `navigationHistory` are
  intact after the crash; `wc.reload()` respawns the renderer and replays the
  current entry (back works); `unresponsive` fires only with input and
  `responsive` follows a `CONT` within seconds; `getOSProcessId()` returns
  `0` on a crashed renderer (coerce `0`/`undefined`/throw → `null`).
- **Leg 1 outcomes this leg depends on**: `refreshTabIndicators(tab, { force })`
  in `site-security-controller.js` is the ONE chip owner (the new push
  handlers call it — never `updateAddressChip` directly, AC5 of leg 1 stays
  green); `overlay-dispatch.js` owns the sheet switch (this leg adds no sheet
  menuType); `renderer.js` is at 1532 lines vs budget 1572 — this leg's
  glue in `renderer.js` is limited to subscription wiring and the two seam
  hooks (≤ 30 lines net); the surfaces live in controllers.
- **Rig facts**: carry forward every rig rule from leg 1 verbatim (env-only
  admin key via a scratch `chmod 600` file, never printed; kill by port pid;
  `127.0.0.2` fixtures; wayland capture caveat; settle-before-read). This
  leg's live check is a SHORT smoke (SEGV a tab → panel; Reload → page;
  STOP + click → bar; CONT → clears) with the FINISHED code — no temporary
  instrumentation this time; the admin census `pid` is the read. Shred the
  scratch app log at teardown (the leg-1 incident).
- **Current code (verified 2026-09-16 on the leg-1 tree)**:
  - `src/main/guest-wiring.js` — `wireTabViewEvents(view, wcId, partition)`
    at `:453`; `sendToChrome` at `:455`; `did-start-navigation` handler at
    `:474-506` (clears `entry.loadFailure` and re-pushes `tab-load-failure`
    null at `:492-495`); `did-fail-load` at `:508-580` (stamps
    `entry.loadFailure`, pushes `tab-load-failure` `:569`, forces
    `tab-security` none `:578-579`). Popups: `wireGuestContents(popupWc)`
    `:324`, `popupRegistry.register` `:325-330`, `teardown` + `onWindowClosed(win,
    teardown)` `:366-383`; `win` is the popup's own `BrowserWindow`.
  - `src/main/register-tab-ipc.js` — `applyGuestVisibility` `:19-22`
    (`setVisible(!!entry.active && !entry.loadFailure)`); the entry literal
    `:186-195` (`loadFailure: null`, `lastRequestedUrl`, `chromeNavPending`,
    cert/security fields); `queueChromeSend` `:72-82`; the move/adopt
    re-push block `:688-718` (`tab-load-failure` `:697-699`, `tab-security`
    `:706-708`, then `tab-nav-state`); `tab-navigate` verbs `:990-1040`
    (`loadURL`, `reload` → `wc.reload()` `:1030-1031`, `stop`, `goBack`,
    `goForward`); `tab-focus-guest` `:1052-1064` (inline `entry.loadFailure`
    `:1060`); `tab-set-active` re-arm `:1125`.
  - `src/main/window-factory.js:243-249` — `isFindableTab` (inline
    `!entry.loadFailure`).
  - `src/main/automation/tabs.js` — `mapEnumeratedTabs(rawTabs, { fromId,
    allowInternal })` `:41-66` (`loadState: t.loadState || LOAD_STATES.OK`
    `:61`, `security` `:65`); the internal-session drop gated on
    `!allowInternal` `:52`. `fromId(wcId)` returns the live `WebContents`.
  - `src/shared/load-failure.js` — `LOAD_STATES` `:12`
    (`OK/FAILED/CERT_BLOCKED`), `classifyLoadFailure` `:149`,
    `classifyCertError` `:247`, `failedTabTitle(tab)` `:288-295` (reads
    `tab.loadFailure.url`).
  - `src/renderer/chrome/load-failure-controller.js` — builds the panel DOM
    into `els.loadFailureSurface` (`:31-130`: heading/body/url/code, Retry,
    `#load-failure-view-cert` `:109`, `#load-failure-advanced`); `render(tab)`
    `:167-197` (cert branch → `classifyCertError`, `root.dataset.failureKind`);
    `show`/`hide` `:199-210`; `applyStripState(tab)` `:221-251` (sole writer of
    `dataset.loadState`, glyph `⚠`, `failedTabTitle` label, `— failed to
    load` suffix); `onTabLoadFailure` `:290-330` (`tab.url = failure.url`,
    `applyStripState`, active-only show, `refreshTabIndicators(tab, { force:
    true })`, guarded address-value write, `focusHeading` only when nothing
    holds focus); returns `{ show, hide, focusHeading, applyStripState }`
    `:331`.
  - `src/renderer/chrome/tab-controller.js` — `activateTab` projection
    `:904-921` (welcome → load-failure → neither; `hideLoadFailurePanel`/
    `showLoadFailurePanel` are late-bound wrappers); `listTabs()` census rows
    `:1205-1218` (`title: t.loadFailure ? failedTabTitle(t) : t.title`,
    `loadState` ternary `:1216`, `loadError` `:1217`).
  - `src/renderer/chrome/shortcut-controller.js:214` — F6 `focus-content`
    branch on `activeTab()?.loadFailure`.
  - `src/renderer/chrome/window-controller.js` — `applyBarVisibility` `:125-131`
    (`els.bookmarksBar.classList.toggle('hidden', !visible)` + the
    `sendActiveBounds()` on NET change), `applyBookmarksBar` `:133`,
    `setBarSuppressed` `:163` — the reflow precedent for the hang bar.
  - `src/renderer/index.html` — `#toolbar` `:83`, `#bookmarks-bar` `:337`
    (`class="hidden" role="group"`), `#main` `:352` / `#webviews` `:353`,
    `#load-failure-surface` `:365`. `styles.css` `#bookmarks-bar` rule `:685`
    (the INSTANT-reflow invariant comment lives there).
  - `src/preload/chrome-preload.js:361-365` — `onTabLoadFailure` /
    `onTabSecurity` bridge shape; `renderer-globals.d.ts:506-518` their
    types. `tabNavigate` bridge exists (verbs above).
  - `src/renderer/renderer.js` — `onTabTitle` short-circuits on
    `tab.loadFailure` (locate by `onTabTitle`); `isFindableTab`-adjacent
    find wiring is main-side only.
  - Tests: `test/unit/guest-wiring.test.js` (fake `wc.on` harness for
    `did-fail-load`), `register-tab-ipc.test.js` (`applyGuestVisibility`
    two-axis pins — will need the third term), `load-failure-controller.test.js`
    + `load-failure-surface-contract.test.js` (frozen ids),
    `load-failure.test.js`, `automation-tabs.test.js`, `tab-controller.test.js`,
    `site-security-controller.test.js`, `test/unit/helpers/fake-dom.js`.
  - `docs/mcp-automation.md:464-471` and the `enumerateTabs` row `:575`
    document the `loadState` enum ("grows in later flights").

## Inputs

- Leg 1 landed on the branch (uncommitted, gates green); `renderer.js` 1532.
- Fixtures: `tests/behavior/fixtures/crash/busy.html`,
  `tests/behavior/fixtures/keyboard-nav/`.

## Outputs

**Shared**
- `src/shared/load-failure.js`: `LOAD_STATES.CRASHED = 'crashed'`,
  `LOAD_STATES.HUNG = 'hung'`; `classifyCrash(reason)` → `{ heading, body }`
  (`killed` → "This page was closed by the system" / "The system ended this
  page's process, often to free memory."; `oom` → "This page ran out of
  memory" / "…"; every other reason (`crashed`, `abnormal-exit`,
  `integrity-failure`, `launch-failed`, `memory-eviction`, unknown) → "This
  page crashed" / "Something went wrong inside the page's process. Reloading
  usually fixes it."); `deriveStripLoadState(tab)` → `'crashed' | 'failed' |
  'hung' | null` with that precedence (crash > loadFailure > hung);
  `failedTabTitle` reads `tab.crash?.url ?? tab.loadFailure?.url`;
  `guestTakenOver(entry)` → `!!(entry && (entry.loadFailure || entry.crash))`
  (exported here so main and chrome share ONE definition — main `require`s
  this ESM file already for `LOAD_STATES`; if it does not, add the same
  `require(esm)` shape `automation/tabs.js` uses).

**Main**
- `register-tab-ipc.js`: entry literal gains `crash: null`, `hung: false`,
  `killRequested: false`; `applyGuestVisibility` → `setVisible(!!entry.active
  && !guestTakenOver(entry))`; `tab-focus-guest` and the `tab-set-active`
  re-arm use `guestTakenOver(entry)`; the adopt re-push block additionally
  queues `tab-crash` when `entry.crash` and `tab-hung` when `entry.hung`
  (same boot-gated path, right after `tab-security`); `tab-navigate` gains
  verb `kill-reload` (sets `entry.killRequested = true` then
  `wc.forcefullyCrashRenderer()`; refused for internal/trusted entries and
  when `wc.isDestroyed()`); the `reload` verb is unchanged (a crashed guest's
  Reload rides it).
- `window-factory.js`: `isFindableTab` uses `!guestTakenOver(entry)`.
- `guest-wiring.js` `wireTabViewEvents`: `render-process-gone` handler —
  ignore `reason === 'clean-exit'`; ignore when the owning window is gone
  (`getWindowForGuest` null) or the entry is absent; if `entry.killRequested`:
  clear it, clear `hung`, push `tab-hung false`, call `onCrash?.({ kind:
  'guest', reason, exitCode, wcId, url, recovery: 'reloaded' })` and
  `wc.reload()` — NO panel; else stamp `entry.crash = { reason, exitCode, url:
  effectiveUrl(entry) }`, `entry.loadFailure = null`, `entry.hung = false`,
  `applyGuestVisibility(entry)`, close the find overlay if this tab is active
  and the overlay is open (the existing per-window `findOverlay` slot's
  close), push `tab-crash { wcId, crash }`, push `tab-hung { wcId, hung: false }`
  only if it was hung, stamp `entry.security = SECURITY_STATES.NONE` AND push `tab-security none`
  (mirror `did-fail-load` `:578-579` — the stamp is what the adopt re-push
  reads after a cross-window move), and call `onCrash?.({ …, recovery:
  'panel' })`. `unresponsive` → `if (entry.trusted || entry.crash || entry.killRequested)
  return;` else `entry.hung = true`, push `tab-hung { wcId, hung: true }`
  (an internal `goldfinch://` tab never shows the bar — pinned); `responsive` →
  `entry.hung = false`, push `tab-hung false`. `did-start-navigation`
  additionally clears `entry.crash` (push `tab-crash null`), `entry.hung`
  (push false), and `entry.killRequested`. `onCrash` is an OPTIONAL injected
  dep added to `createGuestWiring(deps)`'s destructured deps (a module-level
  closure like `chromeForTab`, closed over by both `wireGuestContents` and
  `wireTabViewEvents`; leg 3 wires `crash-log.js` into it; this leg leaves the
  composition root passing nothing and unit-pins the call shape). Popups: `popupWc.on('render-process-gone')` →
  non-`clean-exit` → `onCrash?.({ kind: 'popup', reason, exitCode, url:
  popupWc.getURL(), recovery: 'closed' })` then `win.close()` guarded by
  `!win.isDestroyed()`.
- `automation/tabs.js` `mapEnumeratedTabs`: when `allowInternal` (the admin
  engine), each row gains `pid` — `fromId(wcId)?.getOSProcessId()` coerced
  (`0`/`undefined`/throw → `null`); jar-key rows never carry the key at all
  (unit-pinned both ways).

**Chrome**
- `chrome-preload.js` + `renderer-globals.d.ts`: `onTabCrash(cb)`,
  `onTabHung(cb)` (the `onTabLoadFailure` shape); `tabNavigate` already
  carries arbitrary verbs.
- `load-failure-controller.js`: `render(tab)` branches on `tab.crash` FIRST
  (heading/body from `classifyCrash`, `#load-failure-url` = the crash url,
  `#load-failure-code` = `${reason} (${exitCode})`, `root.dataset.failureKind
  = 'crash'`, Retry / View certificate / Advanced hidden, a new
  `#load-failure-reload` button shown; for a non-crash render the Reload
  button is hidden and everything else is as today); `#load-failure-reload`
  click → `window.goldfinch.tabNavigate({ wcId, verb: 'reload' })` for the
  panel's tab; `applyStripState(tab)` rewritten over `deriveStripLoadState`:
  `crashed` → glyph `⚠`, `— crashed`; `failed` → as today; `hung` → glyph `⏳`
  (or the existing glyph with a distinct `data-load-state`), `— not
  responding`; null → cleared; `onTabCrash({ wcId, crash })` handler
  (registered by this controller, the `onTabLoadFailure` shape): stamp
  `tab.crash`, clear `tab.loadFailure`/`tab.hung`, `tab.url = crash.url` when
  set, `applyStripState`, active-only show/hide, `refreshTabIndicators(tab,
  { force: true })`, guarded address-value write, `focusHeading` under the
  same nothing-holds-focus rule; `onTabLoadFailure` clears `tab.crash` when a
  failure arrives (a crash then a fresh failed load).
- `src/renderer/chrome/hang-notice-controller.js` (new, injected deps
  `{ els, isActiveTab, tabNavigate, refreshStrip, sendActiveBounds }`):
  renders `#hang-notice` (a `role="status"` row: text "This page isn't
  responding", `#hang-notice-wait`, `#hang-notice-kill`); `onTabHung({ wcId,
  hung })` stamps `tab.hung`, resets `tab.hangDismissed` on a rising edge,
  `applyStripState`-equivalent via the injected `refreshStrip(tab)`, and
  projects the bar for the ACTIVE tab (`visible = tab.hung && !tab.hangDismissed`);
  `project(tab)` is also called from `activateTab`; Wait sets
  `tab.hangDismissed = true` and hides; Kill sends `tabNavigate({ wcId, verb:
  'kill-reload' })`; visibility toggles `.hidden` and calls
  `sendActiveBounds()` ONLY on a net change (the `applyBarVisibility`
  precedent — INSTANT reflow, no animation).
- `src/renderer/chrome/context.js`: three `IDS` entries (`hangNotice:
  'hang-notice'`, `hangNoticeWait`, `hangNoticeKill` — the
  `loadFailureSurface: 'load-failure-surface'` precedent at `:72`), so
  `els.hangNotice` etc. exist at construction.
- `index.html`: `<div id="hang-notice" class="hidden" role="status">` between
  `#bookmarks-bar` and `#main`; `styles.css`: a fixed-height row rule with
  the same invariant comment as `#bookmarks-bar`; buttons styled as the
  panel's outline buttons.
- `tab-controller.js`: `activateTab` projection → crash (show panel) >
  loadFailure > welcome > neither, plus `hangNotice.project(tab)`;
  `listTabs()` rows: `loadState` = `crashed` when `t.crash`, else
  `cert-blocked`/`failed` as today, else `hung` when `t.hung`, else `ok`;
  `loadError` = `{ code: exitCode, name: reason }` for a crash; `title` uses
  `failedTabTitle` when crashed too.
- `renderer.js`: `onTabTitle` short-circuit extends to `tab.crash`;
  `shortcut-controller.js` F6 branch → `activeTab()?.loadFailure ||
  activeTab()?.crash`; `isFindableTab` chrome-side twin (if any `findOpen`
  gate reads `loadFailure`, it reads `guestTakenOver`-equivalent now); seam
  hooks `showCrashPanelForAudit()` and `showHangNoticeForAudit()` (synthetic
  records on the active tab that PERSIST until the tab's next real push
  clears them — the `showDownloadsIndicatorForAudit` precedent never reverts
  either; the a11y script audits each state in its own fresh tab, so
  persistence never occludes a later capture) added to the `Object.assign` tail →
  `SEAM_COUNT` 41 in `seam-contract.test.js` AND CLAUDE.md in lockstep.

**Tests** (new or extended): `load-failure.test.js` (`classifyCrash` table,
`deriveStripLoadState` precedence, `failedTabTitle` crash url,
`guestTakenOver`); `guest-wiring.test.js` (clean-exit ignored; window-gone
ignored; crash stamps + clears loadFailure/hung + pushes in order; kill
path: flag consumed, no `tab-crash`, `reload()` called, `onCrash` recovery
`reloaded`; `unresponsive`/`responsive` pushes; `did-start-navigation`
clears all three; popup crash closes the window; `onCrash` shape);
`register-tab-ipc.test.js` (visibility third term; `tab-focus-guest` refused
on crash; re-arm skipped on crash; adopt re-pushes `tab-crash`/`tab-hung`;
`kill-reload` verb sets the flag then calls `forcefullyCrashRenderer`;
refused for trusted/destroyed); a grep-AC test or assertion: no bare
`entry.loadFailure` at a visibility/focus site in `src/main/` (`applyGuestVisibility`,
`tab-focus-guest`, `tab-set-active` re-arm, `isFindableTab` all read
`guestTakenOver`); `automation-tabs.test.js` (admin rows carry `pid`,
`0`→`null`, throw→`null`; jar rows have NO `pid` key);
`load-failure-controller.test.js` (crash render branch, Reload verb, strip
states, `onTabCrash` handler, focus rule); `hang-notice-controller.test.js`
(new — rising edge resets dismissal, Wait hides for the episode, re-shows
on the next rising edge, Kill sends the verb, bounds only on net change);
`load-failure-surface-contract.test.js` (`#load-failure-reload`,
`#hang-notice`, `#hang-notice-wait`, `#hang-notice-kill` join the frozen
set; AND its existing 'applyStripState is the only writer' assertions
(`~:57-69` — the literal `dataset.loadState = 'failed'` substring and the
exactly-one `dataset.loadState = ` count) are REWRITTEN, not deleted, to pin
the new shape: exactly one `dataset.loadState =` write site whose value comes
from `deriveStripLoadState(`, and `delete tab.btn.dataset.loadState` for
null — rename the test to say so); `tab-controller.test.js` (projection precedence, census values);
`seam-contract.test.js` (41; budget).

**Docs**: `docs/mcp-automation.md` — `loadState` enum completed
(`ok | failed | cert-blocked | crashed | hung`), `loadError` for crashes,
admin-only `pid`; CLAUDE.md — the "Chrome panel in the guest slot" pattern
gains the crash specialisation and the `guestTakenOver` predicate; "Tab
strip" load-failure bullet notes `crash`/`hung`; seam note 39 → 41;
README's automation table if it lists `loadState`.

## Acceptance Criteria

- [x] AC1 A `render-process-gone` with `reason !== 'clean-exit'` on a tab
      guest hides the guest, stamps `entry.crash`, clears `loadFailure` and
      `hung`, and pushes `tab-crash { wcId, crash }` on its OWN channel;
      `clean-exit` and a gone-window are ignored (unit-pinned).
- [x] AC2 The kill-reload path: `tab-navigate { verb: 'kill-reload' }` sets
      `killRequested` and calls `forcefullyCrashRenderer()`; the following
      `render-process-gone` — WHATEVER its `reason` — consumes the flag,
      pushes no `tab-crash`, calls `wc.reload()`; `did-start-navigation`
      clears a lingering flag (unit-pinned; the test uses `reason: 'crashed'`
      to match spike (f)).
- [x] AC3 `unresponsive` → `entry.hung = true` + `tab-hung true`;
      `responsive` → false + push; a crashed, a kill-pending, and a TRUSTED
      (internal) entry each ignore `unresponsive` (unit-pinned, three cases).
- [x] AC4 `guestTakenOver` is the ONLY predicate at the four main-side
      focus/visibility sites; grep-AC `grep -rn "entry.loadFailure" src/main/` returns hits ONLY at
      state-management sites, each judged exempt in the flight log:
      `register-tab-ipc.js` entry literal, cert summary read (`:429`), adopt
      re-push (`:697-698`); `guest-wiring.js` `did-start-navigation`/
      `did-fail-load` stamps (`:492-493`, `:514`, `:531`, `:569`);
      `register-overlay-ipc.js:923` (cert read); `tab-entry-url.js:12`
      (comment). ZERO hits at a focus/visibility site — any new hit is real.
- [x] AC5 Chrome: the panel renders the crash branch with `classifyCrash`
      copy, the code line `<reason> (<exitCode>)`, and `#load-failure-reload`;
      Retry/View certificate/Advanced hidden; Reload sends `tabNavigate`
      `reload` for the panel's tab (unit-pinned); the strip carries
      `data-load-state="crashed"` and the `— crashed` suffix from
      `deriveStripLoadState` (precedence pinned: crash > failed > hung).
- [x] AC6 `#hang-notice` shows for the active hung tab with the copy and
      both buttons; Wait hides it for the episode and it re-shows on the
      next rising edge; Kill sends `kill-reload`; switching to a non-hung
      tab hides it; `sendActiveBounds` fires only on net visibility change
      (unit-pinned).
- [x] AC7 Census: `loadState` `crashed` (with `loadError { code: exitCode,
      name: reason }`) and `hung`; admin rows carry `pid` (null for a
      crashed guest); jar-key rows carry no `pid` key (unit-pinned).
- [x] AC8 `activateTab` projects exactly one of crash-panel / failure-panel /
      welcome / none and re-projects the hang bar; F6 on a crashed tab lands
      in the panel heading (unit-pinned).
- [x] AC9 The four frozen ids are in the surface-contract test;
      `SEAM_COUNT` 41 and CLAUDE.md agree; `renderer.js` within budget.
- [x] AC10 Live smoke on the rig with the finished code (no instrumentation):
      SEGV a `links.html` tab → admin census `crashed`, `pid: null`,
      `captureScreenshot(chromeWcId)` shows the panel with "This page
      crashed"; `evaluate` click on `#load-failure-reload` → census `ok`,
      new pid, `readDom` shows the page; STOP + one `click` → census `hung`
      within 40 s and the a11y tree shows the bar; CONT → `ok`, bar gone;
      STOP + click + `evaluate` click on `#hang-notice-kill` → `ok` with a
      new pid, never `crashed` in between. Findings in the flight log
      (pids as words); the scratch app log shredded.
- [x] AC11 `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check` exit 0; `docs/mcp-automation.md` and CLAUDE.md
      updated; no key/pid/path in artifacts.

## Verification Steps

- AC1–AC3, AC7, AC8: `node --test test/unit/guest-wiring.test.js
  test/unit/register-tab-ipc.test.js test/unit/automation-tabs.test.js
  test/unit/tab-controller.test.js`.
- AC4: the grep, pasted.
- AC5, AC6, AC9: `node --test test/unit/load-failure-controller.test.js
  test/unit/hang-notice-controller.test.js test/unit/load-failure.test.js
  test/unit/load-failure-surface-contract.test.js test/unit/seam-contract.test.js`.
- AC10: the smoke driver in the scratch dir; census reads twice.
- AC11: the four scripts.

## Implementation Guidance

1. **Shared first** (`load-failure.js`): enum, `classifyCrash`,
   `deriveStripLoadState`, `failedTabTitle`, `guestTakenOver`; tests.
2. **Main**: entry fields; `guestTakenOver` at the four sites; the
   `render-process-gone` / `unresponsive` / `responsive` handlers in
   `wireTabViewEvents` next to `did-fail-load` (mirror its structure: resolve
   `rec`/`entry` via the existing closure helpers, bail if absent; never
   read `win.*` after `closed`); `did-start-navigation` clears; the adopt
   re-pushes; the `kill-reload` verb; the popup handler beside `teardown`;
   `mapEnumeratedTabs` pid. Inject `onCrash` through `wireGuestContents`'s
   deps object the way `chromeForTab` is injected (leave the composition
   root passing `undefined` — leg 3 wires it).
3. **Chrome**: preload + d.ts; the panel's crash branch + Reload button
   (built where the other buttons are built, `:100-130`); `applyStripState`
   over `deriveStripLoadState`; `onTabCrash` handler; `hang-notice-controller.js`
   + markup + CSS; `activateTab` projection + `project(tab)`; census rows;
   F6; `onTabTitle`; the two seam hooks (synthetic `{ reason: 'crashed',
   exitCode: 139, url }` / `hung: true` on the active tab; persistence as above).
4. **Docs**, then **smoke**, then the flight-log entry (Changes Made, smoke
   findings, anomalies), leg `landed`, `flight.md` checkbox + CP2.

## Edge Cases

- **Crash while the sheet is open** (e.g. site-info on that tab): main's
  existing `tab-hide`/`tab-switch` closes do not fire — leave the sheet
  alone (it floats over the panel; Escape closes it). Document.
- **Crash on a background tab**: guest already hidden; the panel is NOT
  shown until activation; strip mark applies immediately.
- **Crash of a trusted internal guest** (`goldfinch://`): same path; the
  Reload verb works for internal tabs (it is `wc.reload()`); `kill-reload`
  is refused for trusted entries (no bar is ever shown for them either —
  skip `unresponsive` for trusted entries, they are ours).
- **`unresponsive` after `killRequested`**: ignore (the kill is in flight).
- **Reload on a crashed tab whose history is empty** (crashed before first
  commit): `wc.reload()` is a no-op → fall back to `loadURL(effectiveUrl)`
  when `navigationHistory.length() === 0` (the flight's acceptable
  variation), pinned.
- **`tab-crash null`** (cleared by navigation) must hide the panel for the
  active tab and clear the strip, exactly as `tab-load-failure null` does.
- **Two pushes settle order**: `tab-crash` before `tab-security none`, so the
  chip refresh in `onTabCrash` (`force`) already sees `tab.crash`.
- **Hang bar + bookmarks bar both visible**: two fixed rows; `#main` absorbs
  both; verify `sendActiveBounds` reads the real remaining height (it reads
  `#webviews`' rect, so no arithmetic).

## Files Affected

- `src/shared/load-failure.js`
- `src/main/guest-wiring.js`, `src/main/register-tab-ipc.js`,
  `src/main/window-factory.js`, `src/main/automation/tabs.js`
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`
- `src/renderer/chrome/load-failure-controller.js`,
  `src/renderer/chrome/hang-notice-controller.js` (new),
  `src/renderer/chrome/tab-controller.js`, `src/renderer/chrome/context.js`,
  `src/renderer/chrome/shortcut-controller.js`, `src/renderer/renderer.js`,
  `src/renderer/index.html`, `src/renderer/styles.css`
- `test/unit/load-failure.test.js`, `guest-wiring.test.js`,
  `register-tab-ipc.test.js`, `automation-tabs.test.js`,
  `load-failure-controller.test.js`, `hang-notice-controller.test.js` (new),
  `load-failure-surface-contract.test.js`, `tab-controller.test.js`,
  `seam-contract.test.js`
- `docs/mcp-automation.md`, `CLAUDE.md`, README (if the enum is listed)
- flight log, `flight.md`, this leg

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — the Flight Director commits after the flight-end review

## Citation Audit (2026-09-16, leg-1 tree)

Design review (cycle 1) verified ~20 `file:line` citations against the
working tree (all exact or within a few lines; `renderer.js` measures 1531 by
`wc -l`, 1532 by the test metric). Additions from the review: `context.js`
`IDS` (`:4-72`), the `register-overlay-ipc.js:923` cert read, and the
`load-failure-surface-contract.test.js` writer assertions (`~:57-69`).
