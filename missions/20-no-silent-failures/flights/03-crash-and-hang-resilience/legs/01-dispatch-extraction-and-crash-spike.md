# Leg: dispatch-extraction-and-crash-spike

**Status**: completed
**Flight**: [Crash and Hang Resilience](../flight.md)

## Objective

Give the chrome composition root the headroom legs 2–3 need — extract the
generic overlay dispatch switch and the overlay-closed handler out of
`renderer.js` into an injected-deps controller, unify the address-chip
refresh behind one `refreshTabIndicators(tab)` owner — and settle the
flight's ten empirical premises (a)–(j) on the live rig with temporary
instrumentation that is removed before handoff.

## Context

- Flight DDs binding this leg: **DD11** (extraction + unification; budget
  lowered to measured; seam count untouched by the MOVE — the two audit
  hooks land in leg 2, not here), the **Prerequisites** spike list (a)–(j),
  and the **Adaptation Criteria** (a failed premise diverts BEFORE leg 2 is
  designed — record the finding, do not improvise a fix).
- **Behaviour-preserving move.** Nothing in this leg changes product
  behaviour. Every menuType's action must dispatch exactly as before; the
  chip must render exactly as before from every site.
- **Flight Director rulings**: (1) spike instrumentation is TEMPORARY — any
  logging, dev-invoke key, or `crashReporter.start` added for the spike is
  removed before handoff (grep-AC below); findings live in the flight log,
  not in code. (2) The spike may add the `tests/behavior/fixtures/crash/`
  fixture (a busy-loop page) — that is a kept artifact, leg 4 uses it.
  (3) `refreshTabIndicators` is the ONLY new call shape; it does not absorb
  address-VALUE writes, `updateNavButtons`, or `refreshStar` (those stay at
  their sites — the unification is the chip, which had four independent
  callers by the end of Flight 2).
- **Rig facts (carry-forward, mandatory)**:
  - Launch: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
    npm run dev:automation > <scratch>/app.log 2>&1 &`. Capture the admin
    key from the single `AUTOMATION_DEV_MINT {...}` stdout line into a
    `chmod 600` file under the session scratchpad with a script; load it
    ONLY through `GOLDFINCH_MCP_ADMIN_KEY=$(cat <file>)` into
    `scripts/lib/mcp-client.mjs`'s `connectAutomation` / `callTool`
    (`callTool` returns `{ value, isError }`, `value` already parsed;
    `evaluate` takes `{ wcId, expression }`). NEVER print, echo, paste, log,
    or commit a key; delete the file at teardown. NEVER use any
    session-registered `mcp__goldfinch*` / `mcp__chrome-devtools*` tool —
    drive only through the attach client.
  - Kill the dev app by the pid holding `:49707` (`ss -ltnp`), never by a
    `pkill -f` / `pgrep -f` pattern (it matches the calling shell).
  - WSL2 mirrored networking: use `127.0.0.2` for a refusing address; fixtures
    serve on `127.0.0.2:{P}` via `python3 -u -m http.server {P} --bind
    127.0.0.2 --directory <dir>`.
  - Ozone backend is wayland; `captureWindow` paints hidden guests over
    chrome panels — use `captureScreenshot(chromeWcId)` / `readAxTree` for
    a rendered read of the chrome (this leg needs none — the spike reads
    logs and the census).
  - `navigate` returns `isError` for a blocked load (a normal result to
    read); census fields settle one push apart — read twice.
- **Current code (verified 2026-09-16, HEAD `e09389a`)**:
  - `src/renderer/renderer.js` — 1805 lines vs `RENDERER_LINE_BUDGET = 1806`
    (`test/unit/seam-contract.test.js:260`, metric
    `split(/\r?\n/).length`). `dispatchOverlayActivation` at `:932-1222`
    (the `switch (menuType)` over kebab / container / new-container /
    auth-basic / cert-picker / bookmark-edit / bookmarks-overflow /
    page-context / tab-context / suggestions / … cases), `handleOverlayClosed`
    at `:1236-1259` (suggestions reset → `vaultController.handleClosed` →
    `siteSecurityController.handleClosed`). The channel-6 wiring at `:526-531`
    chains `downloadsController` / `vaultController` /
    `siteSecurityController` `.handleActivation(payload)` AHEAD of the
    generic dispatch — that chain stays in `renderer.js`; only the generic
    switch and the closed handler move. The `Object.assign(globalThis, {…})`
    seam tail (`:1700-1800` region — locate by the literal) republishes the
    39-entry closed set; the move must not add or remove an entry.
  - Chip refresh sites today: `renderer.js:1483` (`onTabDidNavigate`),
    `:1514` (`onTabDidNavigateInPage`), `tab-controller.js:923`
    (`activateTab`), `load-failure-controller.js:312` (`onTabLoadFailure`,
    unconditional — CLAUDE.md rule (c)), `site-security-controller.js:177`
    (`onTabSecurity`, active-guarded). `updateAddressChip` itself is defined
    in `navigation-controller.js:43` and re-exported through `renderer.js:228`.
  - `site-security-controller.js` already receives `updateAddressChip` and
    `isActiveTab` as deps (`:26-54`) — the natural home for
    `refreshTabIndicators`.
  - Unit twins for the dispatch: `test/unit/seam-contract.test.js` is the
    only test naming `dispatchOverlayActivation`/`handleOverlayClosed` (a
    source scan, not behaviour); the menu behaviour twins live per-surface
    (`page-context-model`, `tab-context-model`, `bookmarks-bar`, …) and test
    the MODELS, not the switch. The extraction therefore adds its own
    behaviour pins (below) — the switch has never had them.
  - `test/unit/helpers/fake-dom.js` — the shared fake-DOM harness
    (squawk 0077) for controller tests.
  - `automation:dev-invoke` (`app-lifecycle.js:276`, chrome-preload `:465`)
    is the dev-only, `!app.isPackaged`-gated seam whose dispatch keys
    auto-expose — acceptable ONLY as temporary spike instrumentation.
  - Electron 44 (`package.json`): `WebContents` emits `render-process-gone`
    (`RenderProcessGoneDetails { reason, exitCode }`), `unresponsive`,
    `responsive`; `wc.forcefullyCrashRenderer()`, `wc.getOSProcessId()`,
    `wc.reload()`, `wc.navigationHistory`; `crashReporter.start` accepts no
    `submitURL` when `uploadToServer: false`; `app.getPath('crashDumps')`
    derives from `userData`, which the dev-profile redirect sets at
    `main.js:274`.

## Inputs

- Branch `flight/03-crash-and-hang-resilience` at `e09389a` (flight spec
  committed on `main`, branch cut from it), clean tree.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`
  green at HEAD.
- The live rig launchable per the rig facts; `kill` available.

## Outputs

- `src/renderer/chrome/overlay-dispatch.js` — `createOverlayDispatch(deps)`
  → `{ dispatchActivation({ menuType, id, value }), handleClosed({ menuType,
  reason }) }`; every action the switch invokes is an injected dependency
  (no `import` of renderer.js state, no `globalThis` reach).
- `renderer.js` — the switch and closed handler replaced by construction +
  two one-line delegations; controller `handleActivation` chain unchanged;
  seam tail unchanged (39 entries). Measured line count ≤ 1550.
- `site-security-controller.js` — `refreshTabIndicators(tab)`; the five
  chip sites call it; `updateAddressChip` is called from exactly one place
  outside its definition/re-export.
- `test/unit/overlay-dispatch.test.js` — behaviour pins for every menuType
  case (each id routes to the injected action; unknown ids are validated
  no-ops; `handleClosed` ordering: suggestions reset → vault → site-security).
- `test/unit/seam-contract.test.js` — `RENDERER_LINE_BUDGET` lowered to
  measured + 40 (≤ 1590), comment updated; `SEAM_COUNT` still 39.
- `tests/behavior/fixtures/crash/busy.html` — a page with a "Busy loop 20 s"
  button (synchronous loop) and a heading; plain HTML, no external assets.
- Flight log: a `## Spike Results (leg 1)` table with one row per premise
  (a)–(j): premise | method | observed | verdict (`holds` / `fails` /
  `variant`), plus the exact `reason`/`exitCode` pairs seen for SEGV, KILL,
  and (optional) OOM.
- CLAUDE.md: the `RENDERER_LINE_BUDGET` figure in the "Formatting is
  Prettier's" bullet updated to the new number; a one-line note in the
  Renderer architecture bullet that `overlay-dispatch.js` owns the generic
  sheet dispatch.

## Acceptance Criteria

- [x] AC1 `overlay-dispatch.js` exists with the shape above; `renderer.js`
      no longer contains a `switch (menuType)` (grep-AC: zero hits for
      `switch (menuType)` in `src/renderer/renderer.js`).
- [x] AC2 Every `case` label present in the pre-move switch has a pin in
      `test/unit/overlay-dispatch.test.js` proving its ids route to the
      injected action with the same arguments (the test enumerates the
      cases from a fixed list and fails if the module's source gains or
      loses a `case` without a matching pin — the sheet-automation-gate
      bounded-scan idiom).
- [x] AC3 `handleClosed` pins: suggestions reset called only for
      `menuType === 'suggestions'`; vault then site-security `handleClosed`
      called for every payload in that order.
- [x] AC4 `renderer.js` measures ≤ 1550 by the seam-contract metric;
      `RENDERER_LINE_BUDGET` is measured + 40 or less; `SEAM_COUNT` 39;
      the seam-contract suite is green. (Measured 1532; budget re-pinned to
      1572 — an extra 10 lines beyond the design review's estimate, from a
      SECOND TDZ hazard found during implementation; see flight-log
      Anomalies.)
- [x] AC5 grep-AC: `updateAddressChip(` appears in `src/renderer/` ONLY at
      its definition (`navigation-controller.js`), the re-export in
      `renderer.js`, the deps-injection lines, and ONE call inside
      `refreshTabIndicators`. The five former sites call
      `refreshTabIndicators(tab)`.
- [x] AC6 `refreshTabIndicators` is unit-pinned: refreshes the chip for the
      active tab; for a background tab it is a no-op EXCEPT when called from
      the load-failure push path, which stays unconditional (CLAUDE.md
      "Chrome indicators" rule (c)) — achieve this with a
      `{ force: true }` option used by `onTabLoadFailure` only, pinned.
- [x] AC7 Spike results (a)–(j) recorded in the flight log with the verdict
      column filled; no premise left `unknown`. If any premise `fails`, the
      leg still lands (the divert decision is the Flight Director's) — the
      table says so plainly. (Nine `holds`, one `variant` — premise (f); OOM
      row of premise (h) skipped per the Acceptable Variations.)
- [x] AC8 grep-AC: no spike instrumentation remains — zero hits for
      `spike` (case-insensitive) in `src/`; no `crashReporter` reference in
      `src/` (leg 3 lands the real one); `git status --porcelain -- src/main/` is EMPTY
      at handoff (pasted into the flight-log entry as evidence). (The
      literal "zero hits" clause is unsatisfiable against 41 PRE-EXISTING,
      unrelated hits from other flights — see flight-log Anomalies; the
      load-bearing evidence, empty `git status --porcelain -- src/main/` and
      zero `crashReporter` references, is met.)
- [x] AC9 `busy.html` exists under `tests/behavior/fixtures/crash/` and its
      button runs a synchronous loop for ~20 s (a `while (Date.now() < t)`
      loop) — verified by the spike (a).
- [x] AC10 `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check` all exit 0; no admin key, pid, or operator path
      appears in any artifact. (One incident recorded in flight-log
      Anomalies: a key transiently appeared in this session's own output via
      an automatic notification, not a deliberate print — both dev-app
      instances were killed before write-up, invalidating the exposed key
      hashes; no repo file/commit/artifact contains it.)

## Verification Steps

- AC1/AC5/AC8: the literal greps above, run and pasted (paths only) into
  the flight-log entry.
- AC2/AC3/AC6: `node --test test/unit/overlay-dispatch.test.js
  test/unit/site-security-controller.test.js` (create the latter's
  `refreshTabIndicators` cases beside its existing tests).
- AC4: `node --test test/unit/seam-contract.test.js` after `npm run format`.
- AC7: read the flight log's spike table.
- AC9: open the fixture in the rig and click; the census `hung` state is
  NOT expected yet (no product code) — the spike observes the `unresponsive`
  event via the temporary log line.
- AC10: the four npm scripts.

## Implementation Guidance

1. **Extract the dispatch (first — it is the headroom everything else
   needs).** Read `renderer.js:932-1259` in full. List every free identifier
   the switch body references (actions, controllers, `openNewTab`,
   `jarsClient`, `pageCtx`, `bookmarksBar…`, `navigationController`, the
   suggestions state, …). Create `createOverlayDispatch(deps)` in
   `src/renderer/chrome/overlay-dispatch.js` with the body moved VERBATIM
   (comments included — they carry design history) and each free identifier
   read from `deps` — a FLAT object (~27 entries: `KEBAB_ACTIONS`,
   `openNewContainerOverlay`, `openNewTab`, `jarsClient`, `openJarsPage`,
   `createContainerAndOpenTab`, `bookmarksBarController`, `findTabByWcId`,
   `createTab`, `basenameFromUrl`, `toast`, `capPendingQuery`, `toUrl`,
   `openWelcomeTab`, `orderedTabIds`, `ctx`, `activateTab`, `closeTab`,
   `tabs`, `announceTabStatus`, `moveOutcomeMessage`, `dispatchChromeAction`,
   `handleBookmarkStarActivate`, `handleSuggestionsClosed`, the vault and
   site-security `handleClosed`s, …) documented in a JSDoc block the way
   `site-security-controller.js:13-31` documents its deps. **MANDATORY
   getters for `pageCtx` and `tabCtx`**: both are `const` objects declared
   AFTER the switch's home (`renderer.js:1273` and `:1376`), so passing them
   as direct properties at construction is a temporal-dead-zone
   `ReferenceError` at module load — inject `pageCtx: () => pageCtx`,
   `tabCtx: () => tabCtx` and read `deps.pageCtx()` / `deps.tabCtx()` at
   dispatch time. Same shape for anything else `const`-declared below the
   construction site (function declarations hoist; `const`/`let` do not). Construct it in `renderer.js` right
   where the old functions sat, passing the same identifiers; keep
   `dispatchOverlayActivation`/`handleOverlayClosed` as one-line thunks ONLY
   if the seam tail or another site references them by name — otherwise
   delete the names. Run `npm run format` and measure.
2. **Pin it.** `test/unit/overlay-dispatch.test.js`: construct with a deps
   object of `mock.fn()`s; one `describe` per case label; assert the call and
   its arguments for every id the case handles and a no-call for an unknown
   id. Add the bounded case-label scan (regex over the module source,
   compared to the test's own list).
3. **Unify the chip refresh.** In `site-security-controller.js` add
   `refreshTabIndicators(tab, { force } = {})` → `if (force || isActiveTab(tab))
   updateAddressChip(tab)`; export it in the controller's return object;
   thread it to `renderer.js` (the two navigate handlers), `tab-controller.js`
   (activateTab), and `load-failure-controller.js` (`{ force: true }`).
   **Construction order**: `siteSecurityController` is constructed at
   `renderer.js:901`, AFTER `tabController` (`:160`) and
   `loadFailureController` (`:652`) — thread a late-bound closure,
   `refreshTabIndicators: (tab, opts) => siteSecurityController.refreshTabIndicators(tab, opts)`,
   exactly like the existing `onAdvanced: (tab) => siteSecurityController.openCertOverrideOverlay(tab)`
   dep (commented "late-bound (constructed below)"), never a direct
   property read at construction.
   Replace the five calls. Grep-verify AC5.
4. **Re-pin the budget.** `RENDERER_LINE_BUDGET` = measured + ≤ 40; rewrite
   the comment (what moved, when, the measured figure). CLAUDE.md figure in
   lockstep — note CLAUDE.md's "Formatting is Prettier's" bullet still says
   1835 (stale since before this leg; the test's real pre-leg value is
   1806); overwrite the whole figure and date.
5. **Fixture.** `tests/behavior/fixtures/crash/busy.html` + a two-line
   README note in `tests/behavior/fixtures/README.md` if one exists.
6. **Spike (live rig).** Add TEMPORARY instrumentation on a scratch basis:
   in `guest-wiring.js`'s `wireTabViewEvents` log `[spike] pid <wcId> <pid>`
   on `did-finish-load`, and log the full `details` object on
   `render-process-gone`, `unresponsive`, `responsive`; log the chrome view's
   pid at window creation; add a temporary `automation:dev-invoke` key
   `spike-force-crash` that calls `forcefullyCrashRenderer()` on a wcId and a
   `spike-reload` that calls `wc.reload()`; add a temporary
   `crashReporter.start({ uploadToServer: false })` AFTER `main.js:274`.
   Launch, then for each premise:
   - (a) open `busy.html`, click the button via the `click` op, watch for
     `unresponsive` in the log with NO further input; then send one more
     `click` — does it fire now? Record both. Then `kill -STOP <pid>` on a
     normal page + one `click` — record the delay to `unresponsive`.
   - (b) `kill -CONT` — does `responsive` fire, and how long after?
   - (c) after `kill -SEGV`: `wc.getURL()`, `navigationHistory.getActiveIndex()`
     / `.length()` (log them in the `render-process-gone` handler).
   - (d) `spike-reload` on the crashed guest: does the page come back; does
     `goBack` (MCP op) then work with a two-entry history?
   - (e) close a window holding a crashed guest (`window-close` via
     `evaluate` on the chrome calling `window.goldfinch.windowClose()`, or
     the `closeTab` op then the last-tab close) — any throw in the log? Does
     the window close?
   - (f) `spike-force-crash`: which `reason` arrives?
   - (g) `kill -SEGV <chromePid>`: does `render-process-gone` fire on the
     chrome webContents; does `chromeView.webContents.reload()` (add a
     temporary `spike-reload-chrome` key) re-run `index.html` and re-invoke
     `window-boot-config` (log in that handler)? If `reload()` does nothing,
     try `loadFile(paths.chromeHtml)` and record which worked.
   - (h) `reason`/`exitCode` for SEGV, KILL; OOM optional (a page allocating
     arrays until death).
   - (i) after a SEGV with the temporary `crashReporter.start`: list
     `<devProfile>/Crashpad` or `app.getPath('crashDumps')` (log the path) —
     is there a new `.dmp`? Run the crash with `HTTPS_PROXY=http://127.0.0.2:9`
     `HTTP_PROXY=http://127.0.0.2:9` in the app's env and confirm no
     connection attempt (no proxy error in the log; `ss` shows nothing).
   - (j) `getOSProcessId()` on the crashed, not-reloaded guest — `0`,
     `undefined`, or throw (log it inside the `render-process-gone` handler,
     try/caught).
   Record every observation in the flight-log table as you go. Then REVERT
   every instrumentation change (`git checkout -- src/main/` is the
   simplest — leg 1 makes no intended `src/main/` change), kill the app by
   port pid, delete the key file.
7. **Docs + artifacts.** CLAUDE.md lines; flight log leg entry (Changes
   Made, the spike table, anomalies); leg status `landed`; check the leg in
   `flight.md`.

## Edge Cases

- **`pageCtx` and `tabCtx`** (and any other `const` declared below the
  construction site): a getter is MANDATORY — declaration order (TDZ), not
  just staleness. Mutable state of any kind: pass a getter, never a
  snapshot — the switch reads it at dispatch time.
- **Cases that are validated no-ops** (auth-basic, cert-picker,
  bookmark-edit): keep them as explicit `case` labels with their comments;
  pin that they call nothing.
- **`handleClosed` for suggestions** reaches `navigationController` — inject
  `handleSuggestionsClosed` as a dep, not the controller object.
- **Budget after Prettier**: measure AFTER `npm run format`; the metric is
  one above `wc -l`.
- **Spike (a) never fires without input**: that is a `holds` for DD4's
  premise (input-driven), not a failure — record it as such.
- **Spike (g) `reload()` misbehaves**: `loadFile` is the acceptable
  variation; record which one leg 3 must use.
- **A premise fails outright** (no `render-process-gone` for a signalled
  guest; no revival at all): record `fails`, land the leg, and STOP — the
  Flight Director diverts per the flight's Adaptation Criteria.

## Files Affected

- `src/renderer/chrome/overlay-dispatch.js` — new
- `src/renderer/renderer.js` — switch + closed handler removed; construction;
  chip sites → `refreshTabIndicators`
- `src/renderer/chrome/site-security-controller.js` — `refreshTabIndicators`
- `src/renderer/chrome/tab-controller.js`,
  `src/renderer/chrome/load-failure-controller.js` — chip site swap
- `test/unit/overlay-dispatch.test.js` — new
- `test/unit/site-security-controller.test.js` — `refreshTabIndicators` pins
- `test/unit/seam-contract.test.js` — budget re-pin
- `tests/behavior/fixtures/crash/busy.html` — new
- `CLAUDE.md` — budget figure; renderer bullet
- `missions/20-no-silent-failures/flights/03-crash-and-hang-resilience/flight-log.md`,
  `flight.md`, this leg

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. the spike table)
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] Do NOT commit — the Flight Director commits after the flight-end review (not committed)

## Citation Audit (2026-09-16, HEAD `e09389a`)

Design review (cycle 1) verified every `file:line` above against the branch;
the `dispatchOverlayActivation` end line was corrected from `:1235` to
`:1222`. `tests/behavior/fixtures/README.md` does not exist — a
`crash/README.md` is optional. No other drift.
