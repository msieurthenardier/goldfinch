# Flight: Crash and Hang Resilience

**Status**: completed
**Mission**: [No Silent Failures](../../mission.md)

## Contributing to Criteria

- [x] A crashed tab recovers in place — crash surface with a working reload;
      back/forward history intact; strip shows the crashed state; reason in
      the copy where it helps (killed / out of memory / crashed)
- [x] A crashed chrome view recovers without losing the window — strip,
      toolbar, and active tab rebuilt from main's record; open guests survive
      untouched; several simultaneous crashes recover without a reload storm
- [x] A hung tab offers wait-or-kill — non-blocking notice; kill-and-reload
      recovers; a renderer that recovers on its own clears the notice
- [x] Every crash leaves a local record — reason, exit code, origin; dumps
      collected locally; no upload, no network request
- [x] *(partial — `crashed` / `hung` census values; keyboard-operable new
      surfaces subject to Known Issue #216)* New surfaces are safe and
      accessible

---

## Pre-Flight

### Objective

A dead or frozen renderer stops looking like a broken browser. A guest whose
renderer dies becomes a crashed tab: hidden guest, the Flight 1 panel
specialised with reason-aware copy and a Reload that respawns the renderer
with its history intact, a marked strip entry, and a `crashed` census state.
A guest that stops responding shows a non-blocking notice under the toolbar
with Wait and Kill-and-reload, cleared the moment the renderer answers again.
A chrome view whose renderer dies is reloaded at once and reconciled from
main's registry — every live guest re-adopted in order, the active tab
re-activated, per-tab state re-pushed — with a debounce and a cap so a crash
loop or a sleep/resume storm never becomes a reload storm. Every crash writes
a local record whose fields can never carry browsing data or secrets, and
Chromium's minidumps are collected locally with no upload path. Before any of
it, the chrome composition root gets the headroom two new surfaces need.

### Open Questions

- [x] Surface for a crashed guest → DD1 (the Flight 1 panel, specialised —
      the mission's one mechanism)
- [x] Where a hung tab's notice lives → DD3 (a toolbar-adjacent bar, not the
      sheet, not the guest slot)
- [x] Does `unresponsive` fire without input; does `responsive` follow →
      spike (a)/(b)
- [x] Crash-injection apparatus → DD10 (OS signals against an admin-visible
      pid; the mission's `process.crash()` text is drifted — sandboxed guests
      have no `process`)
- [x] Chrome recovery: what to rebuild → DD5; policy → DD6 (operator ruling:
      reload at once, cap 3 per 60 s)
- [x] Crash records: where and what → DD7/DD8 (JSONL in userData; field
      allowlist; operator constraint: never a vector for browsing data or
      secrets)
- [x] Substrate: extract before glue → DD11
- [x] HAT leg → yes, small (operator ruling 2026-09-16)
- [x] Architect design review — cycle 1 approve-with-changes; five high
      issues folded (see flight log); cycle 2 (deltas): two gaps folded — `restoreTabs` left
      intact (hazard gate), grep-AC widened to `src/main/` + F6 parity

### Design Decisions

**DD1 — A crashed guest is a hidden guest under the Flight 1 panel,
specialised.** `guest-wiring.js` gains one `render-process-gone` handler per
guest: for `reason !== 'clean-exit'` it records
`entry.crash = { reason, exitCode, url: effectiveUrl(entry) }`, hides the
guest through `applyGuestVisibility` (the two-axis invariant grows a third
term: visible iff active AND no `loadFailure` AND no `crash`), closes the
find overlay if active, and pushes `tab-crash { wcId, crash | null }`
(own channel — CLAUDE.md's per-tab-state rule). The chrome's
`load-failure-controller.js` `render(tab)` branches on `tab.crash` exactly
as it branches on `cert`: heading/body from a new `classifyCrash(reason)` in
`src/shared/load-failure.js` (`killed` → "This page was closed by the
system", `oom` → "This page ran out of memory", `crashed`/`abnormal-exit`/
`integrity-failure`/`launch-failed`/`memory-eviction` → "This page crashed",
each with a one-line body and the raw `reason (exitCode)` line), a
**Reload** button (`#load-failure-reload`, additive contract hook) that
sends `tabNavigate { verb: 'reload' }` — `wc.reload()` respawns the renderer
and replays the current history entry (spike (d): history intact). The
`WebContents` OBJECT survives a crash (the overlay managers' documented
premise), so no wiring is re-installed; `did-start-navigation` clears
`entry.crash` the way it clears `loadFailure`; `activateTab`'s projection
gains the crashed case (one of welcome / load-failure-or-crash / neither);
`isFindableTab` excludes crashed tabs; `effectiveUrl` keeps reporting the
committed URL (spike (c)); the strip gets `data-load-state="crashed"` and
the "— crashed" aria suffix through `applyStripState`; `LOAD_STATES.CRASHED = 'crashed'`. **Precedence and exclusivity (design-review
amendments):** the crash handler stamps `entry.crash` AND clears
`entry.loadFailure` and `entry.hung` in the same step — a dead renderer is
neither failed nor hung; the error document it was showing died with it —
so the panel never has two states to choose between, and `activateTab`'s
projection list reads crash > loadFailure > welcome > neither. The strip's
`data-load-state` has ONE writer: a pure `deriveStripLoadState(tab)`
(`src/shared/load-failure.js`: crashed > failed > hung > none) applied by
`applyStripState` from every push handler — never three field-scoped writers
racing one attribute. `failedTabTitle` reads `tab.crash?.url ?? tab.loadFailure?.url`
so a crashed tab's strip/census title resolves to its host the way a failed
one does. Guest focus is gated by a shared `guestTakenOver(entry)` predicate
(`!!(entry.loadFailure || entry.crash)`) used by `applyGuestVisibility` AND
by the two inline focus sites that today read `entry.loadFailure` directly —
`tab-focus-guest` (`register-tab-ipc.js:1060`), `tab-set-active`'s
page-focus re-arm (`:1125`), and `window-factory.js`'s `isFindableTab`
(`:248`) — grep-AC over ALL of `src/main/`: no bare `entry.loadFailure` read
remains at a focus/visibility site. Chrome-side, `shortcut-controller.js`'s
F6 `focus-content` branch (`:214`, `activeTab()?.loadFailure`) gains the
crash case so F6 lands in the panel heading for a crashed tab too — never
stranded on a refused `focusActiveGuest`. **No guest ever auto-reloads** — a storm of guest crashes is a
row of crash panels, never N reloads (the storm guard for guests is
structural).
- Rationale: the mission decided the surface once; the panel already owns
  projection, strip, address preservation, focus routing, and the census.
- Trade-off: `Retry` and `Reload` are different buttons on the same panel
  (a failed load retries the intended address; a crash reloads the current
  entry) — copy must keep them distinct.

**DD2 — `clean-exit` and the chrome's own teardown are not crashes.**
`render-process-gone` with `reason === 'clean-exit'` (a normal renderer
shutdown, e.g. during window close or a deliberate `wc.close()`) is ignored;
a crash arriving for an entry whose window is mid-teardown (`closed` already
fired, or `win.isDestroyed()`) is logged (DD7) and otherwise ignored —
**never read `win.*` in a `closed`-or-later handler** (the Wayland wedge).
The close teardown in `window-factory.js` must tolerate a crashed guest
(`wc.isDestroyed()` is false; `destroy()` still works — spike (e)).
**Popups** (`popupRegistry`, never `tabViews` — `guest-wiring.js:325-330`)
have no strip, no panel, and no chrome to push to: a popup's
`render-process-gone` (non-`clean-exit`) writes a `kind: 'popup'` record
(DD7) and CLOSES the popup window (`win.close()` guarded by
`!win.isDestroyed()`; its existing teardown deregisters and cancels its
auth challenges) — the opener page sees an ordinary closed window instead
of a gray one that never answers. No reload affordance for popups (accepted:
an OAuth flow re-opens from the page).

**DD3 — A hung tab gets a non-blocking bar under the toolbar.** On
`webContents` `unresponsive`, main stamps `entry.hung = true` and pushes
`tab-hung { wcId, hung: true }`; on `responsive` it clears and pushes
`false`. The chrome renders `#hang-notice` — a fixed-height row between
`#toolbar` (or the bookmarks bar) and `#main`, the `#bookmarks-bar` shape
(`.hidden` toggle; the slot reflow is an INSTANT layout step, never
animated) — with the text "This page isn't responding", **Wait** (hides the
bar for THIS hang episode; it reappears on the next `unresponsive`), and
**Kill and reload** (`tabNavigate { verb: 'kill-reload' }` — sequencing
below). The bar shows
only for the ACTIVE tab (projected on activation like the panels); the
strip gets `data-load-state="hung"` and a "— not responding" suffix;
`LOAD_STATES.HUNG = 'hung'`. The guest stays VISIBLE and attached while hung
(the operator may be waiting on it); only the notice is added.
**Kill-and-reload sequencing**: main calls `wc.forcefullyCrashRenderer()`
and marks `entry.killRequested = true`; the resulting `render-process-gone`
(`reason: 'killed'`) sees the flag, does NOT show the crash panel, clears
the flag, and immediately `wc.reload()`s — the tab goes hung → reloading →
page, never through the crash panel. Spike (f) confirms
`forcefullyCrashRenderer` emits `render-process-gone` with `killed`.
- Rationale: the sheet is modal and closes on tab switch; the guest slot
  cannot be overlaid by chrome DOM (native surface); a bar the bookmarks-bar
  way is the one non-blocking chrome-DOM placement that reaches the eye.
- Trade-off: a hung tab's bar is per-window chrome DOM projected from
  `tab.hung` — one bar, projected on activation, the panel discipline.

**DD4 — Hang detection is Chromium's, input-driven; the flight does not
add a watchdog.** Electron's `unresponsive` fires when the renderer fails
to acknowledge input within Chromium's hung-renderer delay; with no input
there may be no event (spike (a)). Accepted: a busy page nobody is
interacting with is not a user-facing hang. `responsive` clears (spike (b)).
No debounce on `unresponsive` (Chromium already waits); the bar's Wait
suppresses re-showing until the next `responsive`/`unresponsive` cycle.
- Rationale: a main-side JS-ping watchdog would add a periodic
  `executeJavaScript` into every page (a new page-visible signal and a CPU
  cost); the mission asked for confirmation that heavy-but-legitimate pages
  don't false-positive — Chromium's own threshold is the calibration.

**DD5 — Chrome recovery reconciles from the registry, reusing the boot
barrier and the adopt path.** On the chrome view's `render-process-gone`
(`reason !== 'clean-exit'`), `window-factory.js` (which owns the chrome
view) calls a new Electron-free `chrome-recovery.js`
(`createChromeRecovery({ registry, buildAdoptPayload, queueChromeSend,
logger, now })`) which: (1) records the crash (DD7); (2) closes the sheet
(`sheet.closeMenuOverlay('teardown')` — every pending auth challenge
resolves-cancel through the existing `teardown` mapping), hides the find
overlay and tear-off overlay, and resets `record.bootConfigServed = false`;
`record.restoreTabs` is NOT touched (it is the boot-restore hazard gate
`isRestorePending` reads — nulling it mid-restore would let a partial
snapshot overwrite the good one); instead the boot-config handler checks
`recoverTabs` strictly BEFORE `restoreTabs` (`app-lifecycle.js:190`), so a
session-restored window's recovery never replays its original boot tab list. **Push routing during the gap**: `guest-wiring.js`'s
`sendToChrome` (`:455`) today sends straight through `chromeForTab`, which
checks only `isDestroyed()` — never `bootConfigServed` — so a push racing the
reload would land in a document with no listeners and vanish. This flight
injects a `sendOrQueue(wcId, channel, payload)` helper (built beside
`queueChromeSend` in `register-tab-ipc.js`, threaded into `wireTabViewEvents`
like `chromeForTab`) that sends when the owning record is booted and queues
otherwise; `sendToChrome` routes through it, so every per-tab push during the
gap is replayed after the adopts (unit-pinned: a `tab-title` sent while
`bootConfigServed` is false arrives after `adopt-tab` on boot); (3) sets `record.recoverTabs = true` and
`chromeView.webContents.reload()` — wait: `reload()` on a crashed
`WebContents` respawns the renderer and re-runs `index.html` (spike (g);
fallback `loadFile(paths.chromeHtml)`); (4) the fresh document's
`window-boot-config` invoke (`app-lifecycle.js:169`) — extended: when
`record.recoverTabs` is set it returns `{ bootTab: false }` and, BEFORE
flushing the queue, enqueues one `adopt-tab` per `record.tabViews` entry in
insertion order (the session snapshot's order — the strip's own order died
with the renderer; documented) built by the existing `buildAdoptPayload`
shape (url via `effectiveUrl`, title, jar, `active` flag), followed by the
existing adopt re-pushes (`tab-load-failure`, `tab-security`, plus
`tab-crash`/`tab-hung` from this flight), then the previously queued
pushes — `pendingChromeSends` is a plain append FIFO (`register-tab-ipc.js:72-82`),
so the handler sends the adopts and re-pushes DIRECTLY and only then flushes
the queue (unit-pinned order); the gap-queued sends are deduped last-wins per
`(wcId, channel)` before replay so a stale intermediate `tab-loading: true`
cannot flicker a spinner after the adopt already carried the final state; the chrome's existing adopt-tab branch (`tab-controller.js:1091`)
inserts each strip record WITHOUT `tab-create` and `activateTab`s the
active one — `tab-set-active` then re-asserts guest visibility/bounds/
focus exactly as a cross-window move does. Chrome-only state is dropped and
documented: welcome records and pending queries (a viewless welcome tab is
not in `tabViews` — it is gone; a rebooted chrome with zero adoptable tabs
boots a home/welcome tab through the normal path), find text, suggestions,
typed-but-uncommitted address text, the bookmark-edit popover, and any open
sheet's half-typed content — including a vault credential sheet: the
`survivesBlur` carve-out covers `'blur'` only, and `'teardown'` closes it
(resolution-family; every pending auth challenge resolves-cancel). Guests are
never touched (not hidden, not reloaded); the active guest keeps compositing
through the ~100 ms flicker.
- Rationale: #133's own fix shape; `window-boot-config` + `pendingChromeSends`
  exist for exactly this "chrome isn't ready" class; `adopt-tab` already
  rebuilds a strip record from a registry entry.
- Trade-off: strip order after recovery is registry order; welcome tabs
  vanish. Both are the mission's "honestly dropped" ruling.

**DD6 — Recovery policy: reload at once; cap 3 per 60 s; then stop.**
(Operator ruling 2026-09-16.) `chrome-recovery.js` keeps a per-window
ring of crash timestamps; a fourth crash inside 60 s does NOT reload: it
logs (DD7), sets the window title to "Goldfinch — chrome crashed (recovery
paused)" via `win.setTitle` guarded by `!win.isDestroyed()`, and stops; the
window stays open with its guests compositing (the operator can close it
from the OS; a manual recovery affordance is out of scope — no UI exists to
host it). The pause is for the WINDOW'S LIFETIME — the ring decides only
whether the fourth crash pauses; once paused, a later crash never re-arms
recovery (a crash loop whose cause was fixed needs a new window or a
relaunch; the title says so). A window close during a pending reload must not throw (DD2).
**Storm guard across windows**: each window recovers independently (one
reload each); guests never reload (DD1) — a sleep/resume that kills N
guests and M chromes produces M chrome reloads and N crash panels, never a
reload per guest.

**DD7 — Every crash leaves a local record — and the record can never
carry browsing data or secrets.** (Operator constraint 2026-09-16.)
`src/main/crash-log.js` (Electron-free, injected `{ dir, now, fs, cap =
200 }`) appends one JSON line per event to `userData/crash-log.jsonl`
(rotated: when the file exceeds `cap` lines, the oldest half is dropped on
the next write) with a CLOSED field set: `ts` (ISO), `kind`
(`guest` | `chrome` | `popup` | `gpu` | `utility` | `other`), `reason`,
`exitCode`, `origin` (scheme + host + non-default port of the committed
URL for a `guest`; `goldfinch://<host>` for an internal tab; `null` for a
BURNER tab; absent for non-guest kinds), `jarKind` (`persistent` |
`burner` | `internal` | null), `windowId`, `recovery` (`panel` |
`reloaded` | `paused` | `ignored`). NEVER: a full URL, path, query,
fragment, title, jar name, cookie, header, referrer, or any page content.
Pinned by (a) a source-scan test that the writer's object literal has
exactly those keys and (b) a redaction test (a URL with path/query/fragment
and userinfo → origin only; burner → `null`). `app.on('child-process-gone')`
records `gpu`/`utility`/`other` kinds (reason + exitCode only). Writes are
fail-soft (try/catch; never throw into an event handler) and guarded by
`appDb`-independent plain `fs` so a record survives an `app.db` failure.
`app.log` gets the same one line at `warn`.
- Rationale: the mission's criterion 9; the operator's constraint that the
  log is not a leak vector — the field allowlist is the enforcement, the
  tests make it durable.

**DD8 — Crash dumps: Chromium's minidumps, local only, documented as
profile-sensitive, count-capped.** `crashReporter.start({ uploadToServer: false, compress: false,
ignoreSystemCrashHandler: false, rateLimit: false })` — NO `submitURL` key
at all — runs in `main.js` at module load, before `app.whenReady()` (the
mission's "before readiness so early crashes are caught") but AFTER the
dev-profile `app.setPath('userData', devUserDataPath(…))` redirect at
`main.js:274`: Electron 44 has no `crashesDirectory` option, the dump
database path is resolved from `userData` at `start()` time, and a call
placed beside `registerSchemesAsPrivileged` (`:233`) would write dev-launch
dumps into the operator's REAL profile (squawk 0017 / #121 isolation).
Source-scan pinned: the `start(` call appears textually after the
`setPath('userData'` line. Dumps land in
`app.getPath('crashDumps')` (inside the profile directory). A minidump is a
memory image of the crashed process and MAY contain page content — it is
exactly as sensitive as the rest of the profile directory it lives in, and
never leaves the machine: no `submitURL`, no `extra` parameters, no
`addExtraParameter` calls (source-scan pinned: the only `crashReporter.`
call in `src/` is the one `start(`, its options literal contains
`uploadToServer: false`, and neither `submitURL` nor `addExtraParameter`
appears anywhere in `src/`). At each `app.ready`, `crash-log.js`'s
`pruneDumps(dir, keep = 20)` deletes all but the newest 20 dump files
(fail-soft). `docs/dev-testing.md` and the README's privacy notes state
plainly: dumps are local, profile-sensitive, deleted with the profile, and
can be disabled by deleting the directory — this flight adds no setting
(a "collect dumps" preference is a follow-on if the operator wants one).
- Rationale: criterion 9 wants dumps; the operator's constraint wants
  clarity — the clarity is the documentation plus the pinned no-upload
  shape.
- Trade-off: no in-app viewer or clear-dumps control; the jars-page wipe
  does not touch dumps (they are per-profile, not per-jar).

**DD9 — Census and shared models.** `LOAD_STATES` gains `CRASHED` and
`HUNG` (`src/shared/load-failure.js`, the Flight 1 promise); `listTabs()`
reports `loadState: 'crashed'` when `tab.crash` is set (with `loadError:
{ code: exitCode, name: reason }`), `'hung'` when `tab.hung` (a hung tab
that is also failed/crashed cannot exist — a dead renderer is not hung;
`hung` is cleared as an explicit step of the shared `render-process-gone`
handler — both the `killRequested` reload branch and the ordinary
crash-recording branch); `mapEnumeratedTabs` passes them;
`docs/mcp-automation.md` and the tool description document the enum's
completion (`ok | failed | cert-blocked | crashed | hung`). The admin-tier
census additionally carries **`pid`** (`wc.getOSProcessId()`, null when the
renderer is gone — spike (j) settles what the call returns on a crashed,
not-yet-reloaded renderer: `0`, `undefined`, or a throw; the mapper coerces
all three to `null`) and `enumerateWindows` carries `chromePid` — admin only
(`allowInternal`-gated in `mapEnumeratedTabs`; jar keys never see a pid).
- Rationale: the flight's acceptance apparatus (DD10) and any operator
  diagnosing a crash need the pid; it is process metadata, not page data.

**DD10 — Verification apparatus: OS-signal injection, act + observe
audited.** The mission's `process.crash()` premise is drifted (sandboxed
guests have no `process`; `chrome://crash` is refused by `isSafeTabUrl`).
Instead: *Act* — `enumerateTabs`/`enumerateWindows` (admin) → `pid` /
`chromePid`; `kill -SEGV <pid>` (→ `reason: 'crashed'`) or `kill -KILL`
(→ `'killed'`) from the shell for crashes; `kill -STOP <pid>` then one
`click` op on that tab (input is what Chromium's hang monitor times) for a
hang, `kill -CONT` for recovery; the Reload / Wait / Kill-and-reload buttons
via admin `evaluate` clicks on the chrome; several guests killed in one
shell loop for the storm row; the CHROME pid killed for chrome recovery.
*Observe* — `captureScreenshot(chromeWcId)` (hidden guest → chrome panel;
squawk 0075 stands) and `captureWindow` once the guest is visible again;
`readAxTree(chromeWcId)` for the panel/bar/strip; `enumerateTabs` for
`loadState`/`loadError`/`pid` (a crashed tab's `pid` is null until reload);
`enumerateWindows` `booted` flipping false → true across a chrome reload
with `activeTabWcId` unchanged; `readDom` of the reloaded page;
`tab-history-snapshot` via admin `evaluate` on the chrome
(`window.goldfinch.tabHistorySnapshot`) for "history intact"; the shell
reads `crash-log.jsonl` (redaction assertions) and lists `crashDumps`.
Settle-before-read: `loadState` may flip before `pid` refreshes; read twice.
- Rationale: signals are real crashes with no product seam; the pid is the
  one new read.

**DD11 — Substrate first: the composition root gets headroom, the chip
refresh gets one owner.** Leg 1 extracts `dispatchOverlayActivation`
(`renderer.js:932-1222`) and `handleOverlayClosed` (`:1236-1259`) into
`src/renderer/chrome/overlay-dispatch.js` (`createOverlayDispatch(deps)` —
the generic switch with every action injected; the three controllers'
`handleActivation`/`handleClosed` chains stay where they are, ahead of it),
pinning behaviour with the existing menu specs' unit twins, and unifies the
chip refresh: one `refreshTabIndicators(tab)` in
`site-security-controller.js` called by every per-tab push handler
(failure, security, crash, hung) and by activation — the F2 debrief's two
recommendations. `RENDERER_LINE_BUDGET` is lowered to the measured count
(expected ≤ 1550) and this flight's glue (panel deps, the bar controller,
census, two seam hooks) must fit with ≥ 40 lines to spare. Seam hooks:
`showCrashPanelForAudit()` and `showHangNoticeForAudit()` (synthetic
records) → `SEAM_COUNT` 39 → 41 (FD ruling; CLAUDE.md in lockstep).
- Rationale: 1805/1806 today; five re-pins last flight; the debrief's
  recommendation 2.

**DD12 — Frozen contracts (this flight).** `#load-failure-reload`;
`#hang-notice`, `#hang-notice-wait`, `#hang-notice-kill`;
`data-load-state` values `crashed` / `hung` and their aria suffixes;
census `loadState` values, `loadError` for crashes, admin `pid`/`chromePid`;
push payloads `tab-crash { wcId, crash | null }`, `tab-hung { wcId, hung }`;
the crash-log field set (DD7). A HAT change is a spec re-author.

### Prerequisites

- [x] `main` at `3613542` or later (Flight 2 + squawks merged); flight branch
      `flight/03-crash-and-hang-resilience` cut from `main`.
- [x] Live rig launchable (leg-1-of-F2 rules: env-only key, kill by port
      pid, `127.0.0.2` refuses, ozone wayland); `kill` available (yes).
- [x] Leg-1 spike logged before leg 2 (full table + exact reason/exitCode
      pairs: flight-log "Spike Results (leg 1)"): (a) does `unresponsive`
      fire for a busy-looping page with NO input, and after one `click` —
      **holds**, input-driven; (b) does `responsive` follow `kill -CONT` —
      **holds**; (c) `wc.getURL()`, `navigationHistory` and `effectiveUrl`
      after `kill -SEGV` — **holds**, both survive; (d) `wc.reload()` on a
      crashed guest respawns and keeps history (back works) — **holds**;
      (e) window close with a crashed guest attached does not throw —
      **holds**; (f) `forcefullyCrashRenderer()` emits `render-process-gone`
      with `reason: 'killed'` — **VARIANT**: actually yields
      `reason: 'crashed'`, `exitCode: 133` on this rig — **flagged for leg 2
      design** (recommend gating kill-and-reload on `entry.killRequested`
      alone, not on `reason`); (g) `reload()` on the crashed CHROME
      webContents re-runs `index.html` and re-invokes `window-boot-config` —
      **holds** (no `loadFile` fallback needed); (h) `render-process-gone`
      `reason`/`exitCode` for SEGV (`crashed`/139) vs KILL (`killed`/9) —
      **holds**; OOM skipped (optional); (i) `app.getPath('crashDumps')`
      receives a minidump after a SEGV with `crashReporter` started
      local-only, and NO network request is attempted — **holds** (6 real
      `.dmp` files; confirmed under a refusing-proxy relaunch too); (j)
      `wc.getOSProcessId()` on a crashed, not-yet-reloaded renderer —
      **holds**, always `0` (never `undefined`/throw).
- [x] Fixture: `tests/behavior/fixtures/keyboard-nav` (links page) on
      `127.0.0.2:{P}` for a normal page; a tiny `busy.html` fixture with a
      "Busy loop 20 s" button (new, in `tests/behavior/fixtures/crash/`) for
      the input-driven hang row.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

1. **Substrate (leg 1)** — `overlay-dispatch.js` extraction; one
   `refreshTabIndicators`; budget lowered; the spike (a)–(i) logged.
2. **Guest crash + hang (leg 2)** — `classifyCrash`, `LOAD_STATES`
   growth; `render-process-gone` / `unresponsive` / `responsive` handlers
   in `guest-wiring.js`; `applyGuestVisibility` third term; `tab-crash` /
   `tab-hung` pushes + adopt re-pushes; the panel's crash branch + Reload;
   the `#hang-notice` bar (`hang-notice-controller.js`), Wait /
   Kill-and-reload with the `killRequested` sequencing; strip states;
   census fields + admin `pid`; preload/typing; find exclusion; unit pins.
3. **Chrome recovery + records (leg 3)** — `chrome-recovery.js` + the
   `window-factory.js` chrome `render-process-gone` hook; `window-boot-config`
   `recoverTabs` branch with ordered adopts and re-pushes; the cap/pause;
   `crash-log.js` with the field allowlist + rotation + `pruneDumps`;
   `crashReporter.start` local-only at module load; `child-process-gone`;
   `enumerateWindows.chromePid`; docs (privacy notes).
4. **Acceptance gate (leg 4, ships nothing else)** — the
   `crash-and-hang-surfaces` Witnessed run; `npm run a11y` with the two new
   states; README/CLAUDE.md pattern updates (the guest-slot panel gains its
   third specialisation; the recovery pattern); docs.
5. **HAT (leg 5, optional, elected)** — copy per reason, the bar, chrome
   recovery by eye, a simulated multi-crash, the crash log's contents.

### Checkpoints

- [x] CP1 — Spike logged; `renderer.js` under its new budget; dispatch
      extraction green on the menu-spec unit twins
- [x] CP2 — A SEGV'd guest shows the crash panel; Reload recovers with
      history; a STOPped guest shows the bar after one click; CONT clears it;
      census `crashed` / `hung`
- [x] CP3 — A killed chrome renderer comes back with every tab and the
      active tab; a fourth crash in 60 s pauses; `crash-log.jsonl` has
      redacted rows; a minidump exists; no network attempt
- [x] CP4 — `crash-and-hang-surfaces` run: partial (14/16 + 12b pass; row 6 by-eye → HAT); `npm run a11y` exit 0
- [x] CP5 — HAT complete; flight `landed`

### Adaptation Criteria

**Divert if**:
- `render-process-gone` does not fire for a signalled guest on Electron 44
  — the premise is wrong.
- `reload()` on a crashed guest loses history or does not respawn — DD1's
  Reload needs a `loadURL(effectiveUrl)` fallback (acceptable variation),
  but if the guest cannot be revived at all, re-plan (destroy + recreate the
  view, a much larger change).
- The chrome cannot be reloaded in place (spike (g) fails both ways) —
  recovery becomes "recreate the chrome view", which changes the registry
  record's identity; re-plan DD5.
- `unresponsive` never fires even with input — DD3/DD4's premise is wrong;
  hang detection needs its own design.

**Acceptable variations**:
- Reload via `loadURL(effectiveUrl(entry))` if `reload()` misbehaves.
- The hang bar placed inside `#toolbar`'s row instead of its own row.
- Cap/window constants; the dump keep-count.
- Skipping the OOM variant row.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned
> and created one at a time as the flight progresses. This list will evolve
> based on discoveries during implementation.

- [x] `dispatch-extraction-and-crash-spike` — `overlay-dispatch.js`,
      `refreshTabIndicators`, budget re-pin, spike (a)–(i) logged. Ends with
      green gates and the premises settled. **Landed 2026-09-16** — nine of
      ten premises `holds`, premise (f) is a `variant`
      (`forcefullyCrashRenderer()` yields `reason: 'crashed'`, not
      `'killed'`) flagged for leg 2's design; see flight-log Anomalies.
- [x] `guest-crash-and-hang-surfaces` — DD1–DD4, DD9 (census + admin pid),
      the panel's crash branch, the hang bar, pushes, pins. Ends with a
      signalled guest recovering by Reload and a stopped guest showing the
      bar live. **Landed 2026-09-16** — all 11 ACs verified; see flight-log
      for the live smoke findings and two Anomalies (a SIGSTOPped renderer
      cannot service `forcefullyCrashRenderer()`'s IPC — the kill-and-reload
      row was re-verified with the real busy-loop fixture instead; a driver
      bug, not a product bug, from a multi-window persisted dev profile).
- [x] `chrome-recovery-and-crash-records` — DD5–DD8; `crash-log.js`,
      `crashReporter`, `chrome-recovery.js`, the boot-config branch, docs.
      Ends with a killed chrome coming back with its tabs and a redacted
      record on disk. **Landed 2026-09-16** — all 11 ACs verified; live
      smoke (16/16 rows pass) confirmed chrome reload-and-reconcile,
      the 3-per-60s cap + pause, and redacted crash-log records; see
      flight-log for findings and two Anomalies (SEGV proved unreliable
      against a sandboxed guest renderer this run — KILL substituted; a
      driver return-shape bug, not a product defect).
- [x] `acceptance-and-docs` — the Witnessed run (operator present for
      nothing — every row is automatable), a11y states, README/CLAUDE.md.
- [x] `hat-and-alignment` *(optional, operator-elected)* — small walk.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged (PR #219)
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`, `npm run a11y` exit 0)
- [x] Documentation updated (`docs/mcp-automation.md`, `docs/dev-testing.md`,
      README privacy notes, CLAUDE.md patterns)

### Verification

- Behavior spec `tests/behavior/crash-and-hang-surfaces.md` — run via
  `/mission-control:behavior-test crash-and-hang-surfaces`; verdict `pass`
  (no operator row; the settle-before-read and no-preliminary-click clauses
  built in).
- `npm run a11y` exit 0 with `crashed` and `hung` chrome states.
- Unit: `classifyCrash` table; `LOAD_STATES` completion; guest-wiring crash/
  hang handlers (clean-exit ignored; teardown-safe; `killRequested`
  sequencing; clears on `did-start-navigation`); `applyGuestVisibility`
third term via `guestTakenOver` (grep-AC over `src/main/`: no bare
`entry.loadFailure` read remains at a visibility/focus site — `:1060`,
`:1125`, and `window-factory.js:248` included); F6 crash parity in
`shortcut-controller.js`; `deriveStripLoadState` precedence table;
`sendOrQueue` (booted → send, unbooted → queued, replayed after adopts);
popup crash → record + close;
  `chrome-recovery` (cap ring: 3 reloads, the 4th pauses; window-gone
  safety; `bootConfigServed` reset; queued pushes replayed after boot);
  `window-boot-config` `recoverTabs` branch (ordered adopts, active flag,
  re-pushes before queued sends); `crash-log` (field allowlist source-scan;
  redaction; rotation; `pruneDumps` keep-newest; fail-soft); `crashReporter`
  source-scan (one `start(`, `uploadToServer: false`, no `submitURL` host,
  no `addExtraParameter`); census mapping incl. admin-only `pid`;
  `hang-notice-controller` (Wait hides for the episode; Kill sends the
  verb; projection on activation); `load-failure-controller` crash branch;
  `overlay-dispatch` behaviour pins; `refreshTabIndicators` called from
  every push handler (grep-AC); `seam-contract` (41; budget).
- Mission criteria 6, 7, 8, 9 checked off at landing; criterion 10's census
  half completed.
