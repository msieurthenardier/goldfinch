# Flight Log: Closed-Tab Stack and Reopen

**Flight**: [Closed-Tab Stack and Reopen](flight.md)

## Summary

Leg 1 (`restore-spike-and-stack`) landed: the `navigationHistory.restore()`
fidelity spike passed (no divert), the pure `closed-tab-stack.js` module +
unit net are green, and capture wiring is live in `tab-close`.

Leg 2 (`reopen-chain`) landed: the full reopen chain per DD2's four numbered
steps — reservation retirement (classifier + sheet mirror + allowlist, in
lockstep), the `tabReopen`/`tab-reopen` invoke pair, the renderer dispatch +
`createTab` `insertAt`/`restoreHistory` fields, and the `tab-create` restore
branch. Live-checked end-to-end from all three chrome-shortcut capture
points, plus the empty-stack, burner-exclusion, internal-exclusion, and
jar-deleted-fallback edge cases — all PASS. `closed-tab-reopen.md` authored
(draft); the three F3-debrief BACKLOG entries added.

---

## Leg Progress

### Leg 3 — `verify-integration`

**Status**: landed
**Dates**: 2026-07-14

- `/behavior-test closed-tab-reopen` — **PASS 9/9 on the spec's first run**
  (`tests/behavior/closed-tab-reopen/runs/2026-07-14-21-48-13.md`, live
  Witnessed mode, fresh crew). Proven live: the close→capture→reopen round
  trip; restore() fidelity on a fresh view (real goBack/goForward); all
  three capture points incl. async sheet dismissal; empty-stack no-op
  positive control; structural burner AND internal non-capture; jar-deleted
  fallback with announcement — which exercised a STRONGER case than
  authored (the deleted jar was the resolved DEFAULT, forcing live default
  re-resolution before fallback; handled cleanly).
- Deviations recorded (none verdict-affecting): non-fresh dev profile
  (ruled proceed; step 9 judged parameterized); WSLg hasFocus; teardown
  residue (work jar re-added + re-defaulted; pre-run retentionDays 14 not
  restorable — now 30; jar data wiped by the delete). Future fresh-seed
  runs should point XDG_CONFIG_HOME at a scratch dir.
- Run finding → spec-polish candidate: every reopen in the run landed at
  the LAST strip position (insertAt indistinguishable from append there);
  mid-strip coverage rests on the leg-2 live check — a future variant
  should close a mid-strip tab.
- `npm run a11y` "No NEW violations" ✅; `npm test` 1640/1640; lint,
  typecheck clean.

---



### Leg 1 — `restore-spike-and-stack` — landed 2026-07-14

**SPIKE VERDICT: PASS.** Live round-trip via the in-process MCP automation
surface (`dev:automation`, admin key), a temporary main-side probe (added,
exercised, then fully removed — see Decisions), and the `fixtures-tabstrip`
3-page fixture set:
1. Opened a jar (`work`) tab, navigated it through 3 pages
   (page1 → page2 → page3).
2. Captured `getAllEntries()` (3 entries, each with a non-empty `pageState`)
   + `getActiveIndex()` (`2`) via the probe — the exact DD2 capture shape.
3. Closed the tab through the REAL `tab-close`/automation `closeTab` path
   (not a stub).
4. Constructed a fresh `WebContentsView` in the SAME partition
   (`persist:container:work`) and called
   `navigationHistory.restore({ entries, index })` on it.
5. Result: `restoreErr: null`; `afterUrl`/`afterIndex` matched the captured
   state exactly (page3, index 2); a screenshot of the restored view
   confirmed the page actually rendered (not blank/broken); `canGoBack` was
   `true` and `goBack()` landed on page2 (URL matched); `canGoForward` was
   then `true` and `goForward()` returned to page3. Full fidelity — no
   narrowing needed, DD2's URL+jar+history shape stands as designed.
6. Reproduced the sequence twice (once with, once without the screenshot
   instrumentation) — same result both times.

**Stack module + unit net**: `src/shared/closed-tab-stack.js` (pure ESM,
consumed from `main.js` via `require(esm)`, precedented by
`sheet-accelerator.js`) — `push`/`pop`/`peek`/`size`, `MAX_ENTRIES = 25`
oldest-evicted, `toJSON()`/`fromJSON()` seam (Flight-9 hook, unused this
flight). `test/unit/closed-tab-stack.test.js` — 13 tests: LIFO order,
empty-pop, non-mutating peek, bound/evict (both a small injected bound and
the real `MAX_ENTRIES=25` default), entry-shape passthrough, toJSON/fromJSON
round-trip (incl. over-capacity truncation keeping the newest and a
non-array defensive case).

**Capture wiring**: `ipcMain.on('tab-close', ...)` in `src/main/main.js` now
captures `{url, title, jarId, stripIndex, navEntries, navIndex, closedAt}`
onto the `closedTabStack` singleton, sitting strictly BEFORE `destroy()`/
`tabViews.delete` (the webContents must still be alive to read
`navigationHistory`). Positive persist-jar allowlist — `jars.list().find(j
=> j.partition === entry.partition)` (the `history-recorder` idiom) — plus a
belt-and-suspenders `!entry.trusted` check; the whole block is
try/catch-wrapped so a capture failure can never break tab close.
`stripIndex` rides from the renderer: `closeTab(id)` in `renderer.js`
snapshots `orderedTabIds().indexOf(id)` BEFORE the DOM-removal line (the
Architect second-pass nit — capturing after removal always yields -1); the
`tabClose` preload bridge (`chrome-preload.js`) and `renderer-globals.d.ts`
both gained the optional second arg.

**Live verification of capture wiring** (temp read-only probe, added and
then removed — see Decisions), via the automation surface:
- Persist-jar (`work`) tab, navigated through 2 pages, closed → stack size
  1, entry `{url: page2, jarId: 'work', stripIndex: 1, navEntries: [2
  entries], navIndex: 1, closedAt}` — correct on every field.
- Burner tab (`window.createTab(url, window.makeBurner())`), closed → stack
  size UNCHANGED (still 1, same top entry) — burner never captured.
- Internal tab (`goldfinch://settings`, admin-closed via the real
  `closeTabByWcId` path), closed → stack size UNCHANGED — internal never
  captured.

**Suites**: `npm test -- --test-timeout=30000` → 1635/1635 pass (0 fail).
`npm run lint` clean. `npm run typecheck` clean.

### Leg 2 — `reopen-chain` — landed 2026-07-14

**DD2 step 1 — reservation retirement (lockstep).** `keydownToAction` gains
`shift && (key === 'T' || key === 't') → 'reopen-closed-tab'`.
`guest-forward-allowlist.js`: `reopen-closed-tab` added to BOTH
`WEB_CHROME_ACTIONS` and `INTERNAL_CHROME_ACTIONS` (navigation-neutral class,
same ruling as tab-cycle/jump); `isRepeatSafeAction` needed no code change
(the action doesn't start with `tab-`), pinned by a dedicated test.
`sheet-accelerator.js`: `'T'` pulled out of the negative shifted-chords test
loop, a dedicated `Ctrl+Shift+T → {scope:'chrome', action:'reopen-closed-tab'}`
branch added BEFORE the unshifted `t`/new-tab match (shift-disambiguation-
first pattern, alongside Ctrl+Shift+I/P). Grep-AC confirmed: no `reserved`
Ctrl+Shift+T comments remain in `src/` or `test/`.

**DD2 step 2 — `tabReopen` bridge + `tab-reopen` handler.**
`chrome-preload.js` gains `tabReopen: () => ipcRenderer.invoke('tab-reopen')`
(+ `renderer-globals.d.ts` entry). `main.js`'s new `ipcMain.handle('tab-reopen')`
pops `closedTabStack`, re-validates `isSafeTabUrl(entry.url)` (defense-in-
depth, two-point-boundary parity — mirrors `internal-open-tab-in-jar`'s own
pattern), resolves the entry's jar by id against `jars.list()`, and returns
`{url, title, partition?, stripIndex, navEntries, navIndex, jarFallback}` or
`null` on an empty stack.

**DD2 step 3 — renderer dispatch + `createTab` fields.**
`dispatchChromeAction`'s new `'reopen-closed-tab'` case calls `tabReopen()`,
resolves the container via the existing `inheritContainerFromPartition`
(same path popups use — the fallback chain absorbs the jar-fallback case
with zero new resolution code), and calls `createTab(url, container,
{trusted: false, restoreHistory: {entries, index, title}, insertAt:
stripIndex})`; announces via `#tab-status` on `jarFallback`. `createTab`
gains the two optional fields: `insertAt` clamps to `[0, current-max]` and
lands the tab at its original position via `commitTabMove` (a negative/
non-integer `insertAt` — the capture-side "-1, position unknown" sentinel —
is treated as "no move," not "clamp to position 0," to avoid misrepresenting
an unknown position as "was first"); `restoreHistory.title` seeds the tab's
initial title (mirroring `onTabTitle`'s four update points) so a reopened
tab never flashes "New tab."

**DD2 step 4 — `tab-create` restore branch.** When the payload carries
`restoreHistory`, `tab-create` skips `loadURL(url)` entirely and calls
`view.webContents.navigationHistory.restore({entries, index})` instead
(avoiding the two-competing-navigations race), passing `index` EXPLICITLY
(omitting it silently loads the newest entry). A diagnostic `.catch` mirrors
the existing `loadURL` branch (Electron's `restore()` already attaches its
own no-op rejection handler).

**Live-check** (fresh scratch profile, `dev:automation` mint envs, no port
pin — server free-fell to 49709; fixtures-tabstrip served on 8000; admin SDK
client per the `mcp-admin-client.mjs` helper) — every row of
`closed-tab-reopen.md` exercised and PASS:
- **Empty-stack no-op** (run first, before any close — the stack starts
  empty every launch): `enumerateTabs()` + DOM order byte-identical
  before/after `Ctrl+Shift+T`.
- **Chrome-focus reopen, full fidelity**: closed a 3-history-entry Work-jar
  tab (page1→page2→page3) at strip position 1; reopened via chrome-focus
  `Ctrl+Shift+T` — new wcId, SAME url (page3), SAME jar (`work`), SAME strip
  position (1); `goBack` landed on page2, `goForward` returned to page3 —
  full history fidelity confirmed live (not just the pre-leg-1 spike).
- **Guest-delivered reopen**: chord delivered directly into a background
  guest's wcId (not chrome) reopened the correct entry (page2, `work`) —
  confirms the generalized guest forwarder now admits `reopen-closed-tab` on
  both guest kinds. (`document.hasFocus()` read `false` immediately
  post-click — the same WSLg apparatus limitation `tab-cycling.md` already
  documents; delivery-by-construction is the actual proof, not the focus
  read.)
- **Sheet-open reopen**: chord delivered to the probed menu-overlay sheet
  wcId reopened the correct entry (page1, `work`) AND closed the menu — the
  close is asynchronous (fires once the reopened tab's wcId arrives and
  `tab-set-active`'s close-family hook runs), unlike `tab-cycling.md`'s
  synchronous tab-switch close; both were confirmed via `captureWindow()`.
- **Burner exclusion**: minted a burner tab via the `createTab`/`makeBurner`
  evaluate-reachable seam, closed it, reopened — the burner's URL appeared
  NOWHERE in the post-reopen tab list (the stack was empty at that point, so
  this doubled as a repeat empty-stack no-op — also a valid proof the burner
  was never captured).
- **Internal exclusion**: opened + admin-closed `goldfinch://settings`;
  reopen was a byte-identical no-op — the internal tab was never captured.
- **Jar-deleted fallback**: closed a Work-jar tab, then deleted the Work jar
  (cascading-closing the OTHER open Work tabs per the pre-existing DD6
  tabs-close-on-delete sweep — those cascade closes did NOT double-push
  onto the stack, since by the time their `tab-close` capture ran, `work`
  had already left `jars.list()`, so the capture's jar-resolution found
  nothing and skipped the push; only the deliberately-closed tab's entry
  survived on top). Reopen resolved to the default jar (`personal`, NOT a
  resurrected `work`) and the `#tab-status` region read: "Reopened tab —
  its cookie jar no longer exists; reopened in the default jar."

Evidence (raw automation call/response logs, `captureWindow` screenshots)
saved under `/tmp/behavior-tests/goldfinch/flight4-leg2/` — never in the
repo. App and fixture server killed after the run.

**Suites**: `npm test -- --test-timeout=30000` → 1640/1640 pass (0 fail, +5
vs Leg 1's 1635 — net new/changed pins across `keydown-action.test.js`,
`guest-forward-allowlist.test.js`, `sheet-accelerator.test.js` for the
reservation retirement, incl. loop-array membership additions that each add
one generated test). `npm run lint` clean. `npm run typecheck` clean.

---

## Decisions

- **Temporary main-side probe code, added twice and fully removed both
  times** — required because the spike and the capture-wiring live check
  both need main-process access (`navigationHistory.getAllEntries()`/
  `restore()`, and a read of the `closedTabStack` singleton) that no
  existing automation op exposes. Added two small `ipcMain.handle` probes
  (`debug-spike-capture`/`debug-spike-restore` for the spike;
  `debug-stack-peek` for the wiring check) + matching `chrome-preload.js`
  bridge methods, invoked via the `evaluate` automation op against the
  chrome wcId (`getChromeTarget`). Each probe was added, the app was
  restarted, the check was run and recorded, then the probe was removed
  again before moving to the next step — confirmed by a repo-wide grep for
  `debug-spike`/`debugSpike`/`debug-stack-peek`/`debugStackPeek`/`TEMP` (0
  hits) before landing this leg. No probe code shipped.
- Evidence (raw automation call logs, the restored-page screenshot) saved
  under `/tmp/behavior-tests/goldfinch/flight4-leg1/` — never in the repo.
- **Leg 2 — `insertAt`'s negative-sentinel handling** (not spelled out in
  DD2's prose): a negative/non-integer `insertAt` (the capture-side "-1,
  position unknown at capture time" sentinel) is treated as "leave the tab
  appended at the end," not "clamp up to position 0" — clamping to 0 would
  misrepresent an unknown original position as "was first," which is worse
  than the honest fallback of appending. Recorded here since it is a design
  choice within DD2's "clamped" instruction, not a literal reading of it.
- **Leg 2 — `restoreHistory.title`** rides inside the `restoreHistory`
  object (`{entries, index, title}`) rather than as a third top-level
  `createTab` option — DD2 names only two new fields (`restoreHistory`,
  `insertAt`); the captured title is data that belongs to "the entry," so it
  travels with `restoreHistory` instead of growing the option surface.
- **Leg 2 evidence** (raw automation call/response logs, `captureWindow`
  screenshots) saved under `/tmp/behavior-tests/goldfinch/flight4-leg2/` —
  never in the repo.

---

## Deviations

- None for Leg 1. The spike passed with full fidelity; DD2's designed shape
  (URL+jar+navigation-history restore) stands as written — no divert to a
  URL+jar-only fallback was needed.
- None for Leg 2. All nine `closed-tab-reopen.md` rows passed on first
  live run; no spec correction or product fix cycle was needed.

---

## Anomalies

---

## Session Notes

### Flight Director Notes

- 2026-07-14 — Flight `ready` → `in-flight`; branch `flight/4-closed-tab-reopen`
  stacked on flight/3 (PR chain #84←#85←#86 awaits operator merges).
- Flight design went through TWO Architect passes: pass 1 found the draft
  DD2 wiring (main-constructs-renderer-adopts) has no codebase analog —
  CRITICAL correction to a renderer-orchestrated two-invoke chain; pass 2
  confirmed the rewrite + two nits (stale Technical-Approach prose, fixed;
  stripIndex-before-DOM-removal trap, embedded in leg 1).
- Legs 1 and 2 tier **LOW** despite touching shared surfaces: the two
  Architect passes performed the line-level audit (capture timing, restore
  race, pin-flip inventory incl. the sheet loop split, jar-fallback
  resolution path) and the rulings are embedded verbatim in DD2/leg specs.
  Flight-end Reviewer covers the code, with the F3 standing instruction
  (README-table audit + stale-comment grep).
- 2026-07-14 — Leg 2 (`reopen-chain`) landed: DD2's four numbered steps
  followed exactly (confirmed no divergence needed against the leg spec);
  the live-check ran clean on the first pass across all nine
  `closed-tab-reopen.md` rows, including a genuinely useful discovery mid-run
  (the jar-deleted-fallback row's cascade-close tabs don't double-push onto
  the stack, because their capture's jar-lookup fails post-removal — see
  Decisions) that made that row simpler to reason about than anticipated at
  design time, not harder.
- 2026-07-14 — Fix cycle (flight-end review): addressed two documentation
  findings — README's keyboard-shortcuts table gained the `Ctrl+Shift+T` row
  and CLAUDE.md's M09 keyboard map gained `Ctrl+Shift+T` + a closed-tab-stack
  note (reservation-retired language only, no stray "reserved" mentions
  left); `npm run typecheck` clean, `git status` confirmed only README.md and
  CLAUDE.md touched by this fix cycle.
