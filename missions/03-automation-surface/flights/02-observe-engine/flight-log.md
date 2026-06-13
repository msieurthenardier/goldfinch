# Flight Log: Observe Engine (screenshot / DOM / a11y)

**Flight**: [Observe Engine (screenshot / DOM / a11y)](flight.md)

## Summary
Flight `in-flight` (started 2026-06-13). Branch `flight/02-observe-engine`, cut from
`flight/01-drive-engine` (Flight 1 not yet merged to `main`, and this flight reuses its
`src/main/automation/` module group). Building the observe engine (screenshot / DOM / a11y) across
six legs (`observe-scaffold-and-screenshot`, `observe-dom`, `observe-a11y`, `wire-and-docs`,
`verify-integration`, `hat-and-alignment`).

---

## Reconnaissance Report

Source artifact: the **Flight 1 debrief** action items (the only upstream artifact enumerating
follow-ups that touch this flight's scope). Verified against current code 2026-06-13.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Refresh stale "Pending Leg 6 live confirmation" comments in `input.js` | **confirmed-live** | `src/main/automation/input.js:52,63` still read "Pending Leg 6 live confirmation" (Leg 6 confirmed the recipe works as-built) | Bundle into Flight 2 (`wire-and-docs` leg) — shared automation surface |
| Add automation architecture section to `CLAUDE.md` | **confirmed-live** | `grep -i automation CLAUDE.md` → no automation docs | Bundle into Flight 2 (`wire-and-docs` leg) — shared automation surface |
| Flight 2: design the single-CDP-client conflict (debugger for a11y vs cdp-driver) | **confirmed-live** (design concern, not code debt) | `webContents.debugger` is one-client-per-contents; cdp-driver holds the chrome contents during the smoke | Addressed in flight Design Decisions DD3/DD7/DD8 |
| Flight 4: jar-scoping around `resolveContents` + session-type registry | **deferred (Flight 4)** | n/a — out of this flight's scope | Carried in mission/flight-1 debrief for Flight 4 |

Both `confirmed-live` code/doc items touch `src/main/automation/` + `CLAUDE.md` (a shared surface with
this flight's `observe.js` + engine wiring), so per the flight-planning bundling guideline they are
folded into the `wire-and-docs` leg rather than scheduled separately or left to decay. No items were
auto-retired; the two design/deferred items are recorded for traceability.

---

## Leg Progress

### Leg 1 — observe-scaffold-and-screenshot — **Status: landed** (2026-06-13)

Stood up `src/main/automation/observe.js`, the **read** half of the automation engine, with its first
two exports. Electron-free at top (`// @ts-check` + `'use strict'`, no `require('electron')`); imports
`resolveContents`/`classifyContents` from `./resolve`. No `webContents.debugger` (screenshots are
debugger-free; the debugger arrives only in Leg 3's `readAxTree`).

- **`captureScreenshot(wcId, { fromId, chromeContents, activate, waitForPaint, delayMs })`** — mirrors
  `input.js actOn`: resolve → (guest) `await activate(wcId)` → **re-resolve** (stale-handle guard) →
  paint-settle → `capturePage()`. Chrome targets do not activate. Returns
  `image.toPNG().toString('base64')`. Resolve-before-activate means an internal-session / bad-handle /
  dead wcId throws via `resolveContents` before `activate` or `capturePage` is reached (DD6 absolute
  exclusion preserved for screenshots too).
- **Injectable paint-settle (`waitForPaint` dep).** Default `defaultWaitForPaint`: primary
  (load-bearing) path is a small fixed delay for the already-loaded foreground guest (DD1 blank-capture
  is a compositor/visibility effect, no load event to await); the `wc.once('did-stop-loading', …)`
  branch is only the fallback for a guest foregrounded mid-navigation. **`DEFAULT_PAINT_DELAY_MS = 80`**
  is a conservative placeholder — the **real paint-settle value (and whether any delay even helps) is a
  Leg-5 live check** (flight Divert criterion), tunable via the injectable `delayMs` without editing the
  module.
- **`captureWindow({ chromeContents })`** — whole-window capture, its own export (not a null-wcId
  overload). No wcId, no activate, no classify. Nullish `chromeContents` throws the verbatim
  `'automation: chrome window unavailable'` string (the same one `engine.js` throws for the null-window
  condition — reused, not a new variant).

**Test coverage** (`test/unit/automation-observe.test.js`, 10 cases, mirrors the
`makeGuestWc`/`makeInternalWc`/`makeDestroyedWc`/`makeFakeFromId`/`callLog` style from
`automation-input.test.js`; fake `capturePage()` → fake NativeImage `{ toPNG: () => Buffer.from('PNGBYTES') }`;
immediate no-op `waitForPaint` so no real timer fires):
- guest activate-before-capturePage **ordering** (callLog) + activate-called-once-with-wcId;
- **re-resolve proof** — counter-backed `fromId` returns a *distinct* second handle post-activate; the
  test asserts the **second** handle's `capturePage` fires and the stale first handle's does **not**;
- chrome no-activate;
- resolve-rejection passthrough — bad-handle, dead, internal-session — each throws, and on the
  internal-session path **neither** activate **nor** capturePage is called;
- base64 return shape (`Buffer.from('PNGBYTES').toString('base64')`);
- `captureWindow` whole-window path + nullish-chrome verbatim throw (both `null` and `undefined`).

**Verification:** `node --test test/unit/automation-observe.test.js` → 10/10 pass. Full suite
`node --test test/unit/*.test.js` → 368 pass / 0 fail (no Flight-1 regressions). `npm run typecheck`
clean. `npm run lint` clean.

**Note on the recovery context:** `observe.js` already existed from an interrupted prior attempt (the
infrastructure error hit before tests were written). On validation against the AC + Flight-1
conventions it was found correct and complete — **kept as-is, not rewritten**. This leg's work was
writing the unit tests, running the gates, and logging.

**Anomalies:** none.

### Leg 2 — observe-dom — **Status: landed** (2026-06-13)

Added **`readDom(wcId, { fromId, chromeContents, activate })`** to `src/main/automation/observe.js`
(third export, alongside `captureScreenshot`/`captureWindow`) — a foreground-first, **debugger-free**
read of a target tab's full-fidelity live DOM via `wc.executeJavaScript`, returning
`{ url, title, html }`. Module stays Electron-free at top and has **no `webContents.debugger`**
(verified by grep — both terms appear only in the existing header comment).

- **Foreground-to-act sequence (DD5).** Mirrors `captureScreenshot` / `input.js actOn` exactly: resolve
  → if `classifyContents === 'guest'` **and** `typeof activate === 'function'`, `await activate(wcId)`
  then **RE-RESOLVE** (stale-handle guard, re-applies the DD6 guard post-activation) → read. Chrome
  targets never activate. A guest with **no** `activate` dep reads without foregrounding (guarded path).
- **`READ_DOM_SNIPPET` (module-level const, DD4).** A single `executeJavaScript` IIFE expression
  returning `{ url: location.href, title: document.title, html: document.documentElement ?
  document.documentElement.outerHTML : "" }` — **one round-trip** so url/title/html are a **consistent
  snapshot** taken at one renderer instant. The `documentElement ? … : ""` guard handles the rare
  no-documentElement case (non-HTML response) so the read resolves with empty `html` rather than
  throwing renderer-side. **Full outerHTML, no trimming/length-cap** (DD4); any projection is a later
  concern.
- **DD6 absolute exclusion preserved.** `readDom` propagates `resolveContents` rejections unchanged
  (bad-handle / dead / internal-session). Resolve-before-activate means on the **internal-session** path
  **neither** `activate` **nor** `executeJavaScript` runs.
- **`contextIsolation:false` faithfulness note (JSDoc).** `main.js:144` sets
  `webPreferences.contextIsolation = false` for non-internal/web guests; `executeJavaScript` evaluates
  in that same page **main world**, so the returned `outerHTML` reflects the **live,
  preload-and-script-mutated DOM as rendered** — not the raw network response. Intended faithfulness,
  not a defect (farbling wraps fingerprinting APIs — script-observable values — not the static HTML).
  The JSDoc also records the correct `executeJavaScript` precedent (**engine.js:35**, the dev-seam
  chrome-renderer read) and explicitly notes it is **not** modeled on `a11y-audit.mjs` (CDP
  `Runtime.evaluate` to bypass CSP — the opposite mechanism; see the DD2 correction below).

**Test coverage** (`test/unit/automation-observe.test.js`, **+9 `readDom` cases** → 19 cases in this
file). Reused the Leg-1 `makeGuestWc`/`makeInternalWc`/`makeDestroyedWc`/`makeFakeFromId`/`callLog`
helpers; added a fake `executeJavaScript(code)` to each fake wc that records the code string + a call
counter (`_execCount`/`_lastExecCode`) and returns a canned `{ url, title, html }`:
- guest **activate-before-executeJavaScript** ordering (callLog);
- **re-resolve proof** — counter-backed `fromId` returns a *distinct* second handle post-activate; the
  **second** handle's `executeJavaScript` fires, the stale first handle's does **not**;
- chrome **no-activate**;
- **guest-with-no-`activate`** — reads without foregrounding;
- resolve-rejection passthrough — bad-handle / dead / internal-session each throws with
  `executeJavaScript` count **0**; internal-session **also** asserts activate count **0** (mirrors
  Leg 1's `_captureCount === 0` internal-session test);
- `{ url, title, html }` **return shape**;
- **exact `READ_DOM_SNIPPET`** is the code passed to `executeJavaScript` (asserted against a
  byte-for-byte mirror const in the test file).

**Verification:** `node --test test/unit/automation-observe.test.js` → 19/19 pass. Full suite
`node --test test/unit/*.test.js` → **377 pass / 0 fail** (368 Leg-1 baseline + 9 new; no regressions).
`npm run typecheck` clean. `npm run lint` clean. Engine wiring **NOT** touched (`engine.js` dispatch +
dev seam are Leg 4).

**Anomalies:** none.

### Leg 3 — observe-a11y — **Status: landed** (2026-06-13)

Added **`readAxTree(wcId, { fromId, chromeContents, activate }, { depth, properties } = {})`** to
`src/main/automation/observe.js` (fourth export) — a foreground-first read of a target tab's
**accessibility tree** via the **in-process `webContents.debugger`** (`attach('1.3')` →
`Accessibility.enable` → `Accessibility.getFullAXTree` → `detach()` in `finally`). This is the
**only** `webContents.debugger` use in the entire engine (DD3 — no pure-JS path to the platform a11y
tree). Grep confirms the actual `wc.debugger.*` calls live only inside `readAxTree`; the other ops
(`captureScreenshot`/`captureWindow`/`readDom`) and the other modules (`resolve.js`/`input.js`) stay
debugger-free.

- **Foreground-to-act + re-resolve (DD5).** Mirrors `readDom`/`captureScreenshot`/`actOn`: resolve →
  if guest **and** `typeof activate === 'function'`, `await activate(wcId)` (BEFORE the lock) then
  **RE-RESOLVE** (stale-handle guard) → lock → attach. Chrome never activates. `resolveContents`
  rejections (bad-handle / dead / **internal-session**) propagate **before** any activate/lock/attach
  (DD6 absolute exclusion).
- **Synchronous single-client lock (DD7).** A module-private `const attached = new Set()`. The
  `has()` check and `add()` are synchronous with **no `await` between them** (the only awaits — the
  `sendCommand`s — are *after* the add). If the lock is already held → return the `locked` refusal
  **without** attaching. Released in the **outer** `finally` (`attached.delete(wcId)`) — even on
  attach-throw or sendCommand-throw. The lock is keyed on the **stable `wcId`**, not the per-resolve
  `wc` handle, so it correctly spans the re-resolve (code comment guards this). A second code comment
  guards against re-resolving between `attach` and `detach` (the `finally` detach must run on the same
  `wc` that was attached).
- **detach-in-finally lifecycle (DD7).** `detach()` runs in an **inner** `finally` so the contents is
  **never** left attached, even when `enable`/`getFullAXTree` rejects. `detach()` is itself wrapped in
  `try/catch {}` so a throw from it (already-detached) does **not** mask the real outcome (the success
  value, or the original sendCommand rejection).
- **Return-refusal contract (DD8 — the throw-vs-return decision already recorded in Decisions).**
  Implements the resolved contract: success → the **raw `nodes` array** (no trimming, DD4), **possibly
  empty `[]`** (a valid success, `Array.isArray` discriminates); lock-held or `attach()` throws →
  **RETURNS** `{ automation: 'debugger-unavailable', reason: 'locked' | 'attach-failed', wcId }` (an
  expected operational condition — first-class result, not an exception); **post-attach** `sendCommand`
  failure (attach succeeded, then `enable`/`getFullAXTree` rejects) → **PROPAGATES** (it is NOT
  "debugger-unavailable" — the debugger *was* available); `detach()` still runs.
- **DD4 Flight-9 stub.** The trailing `{ depth, properties }` options object is accepted in the
  signature but **unimplemented in v1** (`void depth; void properties;`) — never drops nodes. JSDoc
  records the stub, the stale-handle caveat on `backendNodeId`/`frameId` (CDP-session-scoped, go stale
  on detach — informational, not live references), and the **LIVE-UNKNOWN** note.
- **Module header updated.** No longer claims debugger-free: now states the debugger lives **only** in
  `readAxTree` (attach-on-demand / detach-in-finally / single-client lock / clean refusal —
  DD3/DD7/DD8/DD9); all other ops and modules remain debugger-free.

**Live-unknowns deferred to Leg 5/6 (NOT asserted as live-correct here).** Whether
`Accessibility.enable` must precede `getFullAXTree`, and whether protocol `'1.3'` attaches on a
**guest** webContents on Electron ^42, are unverified at unit-test time — the unit suite fakes the CDP
sequence. Live confirmation is the **Leg-5 smoke / Leg-6 HAT** (flight Open Question + Divert
criterion). The DD8 single-CDP-client open premise (in-process debugger vs `cdp-driver`'s external
`--remote-debugging-port` client) is likewise resolved live: primary unit = the `attachThrows` fake →
clean refusal (authoritative, present here); primary live = Leg-6 HAT (operator opens DevTools → a11y
read refuses cleanly); opportunistic Leg-5 smoke = record refuse-vs-succeed (not a required assertion).

**Test coverage** (`test/unit/automation-observe.test.js`, **+14 `readAxTree` cases** → **33 cases** in
this file). Added a `makeDebugger({ attachThrows, detachThrows, axNodes, sendImpl })` fake (ordered
`_log`, `_attached`/`_detached` counters, `isAttached()` for API parity though `readAxTree` never reads
it — the `Set` is the lock) and a `makeDeferred()` helper for the controllable pending `sendCommand`.
Each test uses a **distinct wcId** so the shared module-private lock stays isolated:
- **happy path**: `assert.deepEqual(dbg._log[0], ['attach','1.3'])`; `Accessibility.enable` logged
  **before** `getFullAXTree` (the ordering); returns the nodes; `_detached === 1`; lock released
  (subsequent call succeeds);
- **empty-tree success**: `{ nodes: [] }` → `[]` (`Array.isArray` true, not a refusal); plus a
  defensive **missing-`nodes` (`{}`) → `[]`** case;
- **attach-throw refusal**: returns `{ …reason:'attach-failed' }`; `_detached === 0`; lock released;
- **concurrent-lock refusal**: deferred pending `getFullAXTree`; two un-awaited calls on the same wcId;
  second returns `{ …reason:'locked' }` and `attach` called **once**; resolve deferred → first returns
  nodes; third call succeeds;
- **detach-on-sendCommand-error**: `getFullAXTree` rejects → `readAxTree` **rejects** (propagates);
  `_detached === 1`; lock released (subsequent healthy call succeeds);
- **detach() throws must not mask**: (a) happy + `detach` throws → still returns nodes; (b)
  `getFullAXTree` rejects **and** `detach` throws → the **original** sendCommand rejection propagates;
- **guest foreground** (activate before attach via callLog) + **re-resolve proof** (the **second**
  post-activate handle's `debugger` is the one attached **and** detached) + **chrome no-activate**;
- **three resolve-rejection paths** (bad-handle / dead / internal-session) throw before any
  lock/attach; the internal-session case asserts **no attach** and that the lock was untouched (a
  subsequent valid call on a different wcId succeeds — the behavioral proxy for "Set size 0", since the
  module-private `Set` is intentionally not exported).

**Verification:** `node --test test/unit/automation-observe.test.js` → **33/33 pass**. Full suite
`node --test test/unit/*.test.js` → **391 pass / 0 fail** (377 Leg-2 baseline + 14 new; no
regressions). `npm run typecheck` clean. `npm run lint` clean. Engine wiring **NOT** touched
(`engine.js` dispatch + dev seam are Leg 4).

**Anomalies:** none. (One transient lint catch during implementation — an unused `sendCount` scratch
var in the concurrent-lock test — removed; the `attach`-called-once assertion uses a `_log` filter.)

### Leg 4 — wire-and-docs — **Status: landed** (2026-06-13)

Wired the four observe ops into `engine.js`'s dispatch, refreshed the two stale `input.js` comments,
and added an **Automation engine** documentation section to `CLAUDE.md`. No source-logic change beyond
the four dispatch keys; `main.js` untouched.

- **Four dispatch keys + `require('./observe')`.** Added `const observe = require('./observe');`
  alongside the `tabs`/`nav`/`input` requires, and four keys to the returned dispatch object (after
  `pressKey`), mirroring the existing arrow-with-`@type`-JSDoc style:
  - `captureScreenshot: (wcId, opts) => observe.captureScreenshot(wcId, { ...deps(), ...opts })` — with
    a one-line comment that `opts` is for `delayMs`/`waitForPaint` **only** (the spread-after-`deps()`
    order means an over-supplied `opts` would override injected deps — the Leg-5 paint-settle tuning
    footgun);
  - `captureWindow: () => observe.captureWindow(deps())`;
  - `readDom: (wcId) => observe.readDom(wcId, deps())`;
  - `readAxTree: (wcId, opts) => observe.readAxTree(wcId, deps(), opts)` (passes the `{depth,properties}`
    stub through).
- **Auto-exposed via the dev seam — no `main.js` edit.** The seam (`main.js:738`,
  `automation:dev-invoke` → `engine[op](...args)`) dispatches dynamically, so the four new keys are
  reachable with no seam change. Verified: a throwaway `createEngine(() => null)` exposes
  `captureScreenshot`/`captureWindow`/`readDom`/`readAxTree` (+ the existing `enumerateTabs`/`pressKey`)
  all as `function`.
- **Both debugger-free claims clarified.** The file-top comment block and the `createEngine` JSDoc no
  longer read as if the whole engine is debugger-free now that it requires `./observe` — each now states
  `engine.js` itself is debugger-free (DD8, the Flight-1 number kept — not re-grafted) and wires
  `./observe`, whose `readAxTree` is the engine's sole debugger user. `grep` confirms no actual
  `webContents.debugger` / `.debugger.` *use* in `engine.js` (the only match is the clarifying prose).
- **`input.js` comments refreshed (no logic change).** Both `:52` and `:63` "Pending Leg 6 live
  confirmation" notes replaced with the confirmed finding — the buttons-bitmask click recipe
  (mouseMove → mouseDown(buttons:1) → mouseUp(buttons:0)) was **confirmed live in Flight-1 Leg 6**
  (the `cdp-driver` smoke). `grep -n "Pending Leg 6" src/main/automation/input.js` → no matches.
- **`CLAUDE.md` Automation engine section.** Added as a `### Automation engine` subsection under
  `## Patterns` (after the Internal-bridge security model subsection). Covers: `src/main/automation/`
  as the engine home; injected-deps / Electron-free-at-top convention; `webContentsId` (`wcId`) as the
  canonical tab handle; foreground-to-act + the stale-handle re-resolve discipline; the
  `executeJavaScript` main→guest read rationale (not CDP); the debugger-only-in-`observe.js`/`readAxTree`
  rule; the dev seam as interim (folded into the gated transport at Flight 3); and the
  no-release-until-Flight-4 invariant. Written in prose with **no** flight-scoped DD-number citations
  (durable cross-flight doc). `grep -i automation CLAUDE.md` → section present.
- **No test change needed.** Confirmed no unit test asserts the engine dispatch op set
  (`automation-dev.test.js` only tests `isAutomationDevEnabled`; `automation-observe.test.js` tests the
  observe functions directly off `observe.js`). The four added keys break nothing.

**Verification:** full suite `node --test test/unit/*.test.js` → **391 pass / 0 fail** (no regressions
off the Leg-3 baseline). `npm run typecheck` clean. `npm run lint` clean. Grep checks all as expected
(no "Pending Leg 6" in `input.js`; Automation section in `CLAUDE.md`; no debugger *use* in `engine.js`).

**Anomalies:** none.

### Leg 5 — verify-integration — **Status: completed** (2026-06-13)

FD-driven live smoke against the running app (`npm run dev:debug`, Electron **42.3.3**, CDP protocol
1.3, port 9222), driving the dev seam via `cdp-driver.mjs eval
"window.goldfinch.automationDevInvoke('<op>', [args])"`. Machine-read evidence captured to the
ephemeral dir `/tmp/behavior-tests/goldfinch/observe-verify/2026-06-13-18-33-52/` (**not committed** —
per ARTIFACTS.md; re-derive by re-running).

- **AC1 static** — `npm test` 391/0, `typecheck` clean, `lint` clean (re-confirmed).
- **AC2 guest screenshot** — `captureScreenshot(2)` on a google.com guest → non-blank **1398×810** RGB
  PNG (75 KB), visually faithful to the page. The **`DEFAULT_PAINT_DELAY_MS = 80` was sufficient** (the
  guest was already loaded/foregrounded); no tuning needed.
- **AC3 guest DOM** — `readDom(2)` → `{url:"https://www.google.com/", title:"Google", htmlLen:278688}`,
  `<html>` present; full-fidelity, matches the page.
- **AC4 guest a11y** — `readAxTree(2)` → a **163-node** array, root `RootWebArea`. **Resolves the flight
  Open Question:** `webContents.debugger.attach('1.3')` → `Accessibility.enable` → `getFullAXTree`
  **works on a guest `webContents` on Electron ^42**, and `enable`-before-`getFullAXTree` is the correct
  sequence (as coded).
- **AC5 whole window** — `captureWindow()` → **1400×900** PNG showing chrome (tab strip / toolbar /
  address bar / window controls) **and** the composited guest.
- **AC6 internal-session exclusion (security, load-bearing)** — opened `goldfinch://settings` (wcId 3,
  jar `internal`) via the trusted kebab path. (a) `enumerateTabs` returned **only** wcId 2 — the
  internal tab was **excluded**; (b) `captureScreenshot(3)` / `readDom(3)` / `readAxTree(3)` **each
  threw** `automation: internal-session — wcId 3 belongs to the internal goldfinch://settings session
  and cannot be driven`. DD6 holds live across all three observe ops.
- **AC7 chrome-a11y-under-cdp-driver (recorded, not asserted)** — confirmed wcId 1 is the chrome
  (`readDom(1)` → `index.html`, "Goldfinch"). `readAxTree(1)` on the chrome **SUCCEEDED** (154-node
  tree) while `cdp-driver` held the chrome's CDP target. **Finding: no contention** — see the Deviation
  below (apparatus-confounded).

**Anomalies:** none functional. The DD8 conflict-trigger finding is recorded under Deviations.

### Leg 6 — hat-and-alignment — **Status: completed** (2026-06-13)

Guided HAT, FD-driven with operator in the loop (operator confirmed the DevTools-window behavior and
set the DD8 disposition). Faithfulness verified by viewing the captured PNGs + machine read-backs.

- **Faithfulness** — guest screenshot and whole-window capture both render the **actual** page
  (Google homepage + doodle) and the real chrome; `readDom`/`readAxTree` correspond to the visible
  page. ✓
- **Foreground-correctness (foreground-to-act, live)** — with the google guest (wcId 2) **backgrounded**
  behind the active settings tab (3), `captureScreenshot(2)` **brought it to front** (active flag
  flipped 3→2) and returned a non-blank, faithful 1398×810 PNG. The DD5 foreground-to-act contract is
  visibly correct on a genuinely backgrounded tab. ✓
- **Refusal contract (live, via the lock path)** — two `readAxTree(2)` fired in the same renderer tick →
  one returned the 163-node tree, the other returned exactly
  `{automation:'debugger-unavailable', reason:'locked', wcId:2}`. The synchronous single-client lock and
  the refusal **return shape** are confirmed in the real wiring. ✓
- **DD8 DevTools-open conflict (primary live conflict test) — did NOT trigger; apparatus-limited.** See
  the Deviation. Disposition (operator, 2026-06-13): **record as apparatus-limited and land** — the
  `attach-failed` refusal stays unit-tested; real-conflict verification defers to the Flight-3 transport.
- **No leak** — after opening **and** closing DevTools on the guest plus the concurrent/attach churn,
  `readAxTree(2)` and `readDom(2)` still return cleanly. The detach-in-`finally` discipline holds live.
- **Alignment** — raw output shapes (163-node AX array, 278 KB DOM string) were workable for this
  machine-read verification; no projection prioritized (DD4 — raw is the v1 choice; a Flight-9 ergonomics
  concern).

---

## Flight Director Notes

- **2026-06-13 — Flight start.** Loaded `leg-execution.md` crew (validated: Crew / Interaction Protocol
  / Prompts all present; Developer=Sonnet, Reviewer=Sonnet-never-Opus). Marked flight `in-flight`.
  Branch `flight/02-observe-engine` cut from `flight/01-drive-engine` (Flight 1 is committed there but
  **not yet merged to `main`**, and this flight reuses Flight 1's `src/main/automation/`
  `resolve`/`classify`/`activate` + `engine.js` dispatch + dev seam).
- **Orchestration shape.** Legs 1–4 (`observe-scaffold-and-screenshot`, `observe-dom`, `observe-a11y`,
  `wire-and-docs`) are autonomous → per-leg design review, batch implement, **single** flight review +
  commit (per `/agentic-workflow`). Leg 5 `verify-integration` is operator-guided (live smoke needs the
  WSLg GUI; unit/typecheck/lint autonomous). Leg 6 `hat-and-alignment` is an interactive HAT
  (operator = ground-truth oracle, incl. the DD8 DevTools-open clean-refusal live test). No
  behavior-test spec authored (per flight interim-verification note; Witnessed backing deferred to
  Flight 6 migration).
- **2026-06-13 — Autonomous batch review + commit (Phase 2d).** Legs 1–4 each got a per-leg design
  review (Developer) before implementation; design feedback was accuracy/clarity only (no architectural
  rework) — notable items: DD2 `executeJavaScript` precedent corrected to `engine.js:35` (not
  `a11y-audit.mjs`/CDP), and the a11y `debugger-unavailable` throw-vs-return contradiction resolved in
  favour of DD8 (**return** a discriminated refusal) — both recorded under Decisions. After all four
  legs landed, a single **Reviewer** (Sonnet, never Opus) evaluated the whole uncommitted diff →
  `[HANDOFF:confirmed]`: all ACs met, gates green (391 pass / 0 fail, typecheck + lint clean), DD6
  internal-session exclusion verified before any side-effect in all four ops, no debugger-leak path.
  Committed legs 1–4 as one commit (code + artifacts; the unrelated untracked `src/renderer/assets/
  gf_01*.png` deliberately **excluded** — not this flight's work). Legs 1–4 → `completed`; flight stays
  `in-flight` (legs 5 `verify-integration` + 6 `hat-and-alignment` are operator-guided / live and
  remain). Draft PR opened with 1–4 checked.

## Decisions

### DD2 citation correction — `executeJavaScript` precedent is `engine.js:35`, not `a11y-audit.mjs`
**Context**: Flight DD2 cites `executeJavaScript` as "the same surface `a11y-audit.mjs` uses for axe."
The Leg-2 design review found this inaccurate: `scripts/a11y-audit.mjs` injects axe via **CDP
`Runtime.evaluate`** specifically to *bypass the page CSP* — the opposite mechanism. An implementer
mirroring that script would find CDP code, not the `executeJavaScript` path `readDom` needs.
**Decision**: Leg 2 (`observe-dom`) cites the correct precedent — `engine.js:35`
(`mw.webContents.executeJavaScript(code)`, the read the dev seam already uses) — and adds a CSP caveat
(self-contained-expression reads are CSP-safe; *library* injection is not, which is why a11y-audit
went CDP). Flight DD2's parenthetical is annotated here rather than rewritten in place (spec is a
snapshot).
**Impact**: No design change — `readDom` is still `executeJavaScript`-based. Forward-looking value:
Leg 3's `readAxTree` must not inherit a false "executeJavaScript always works under CSP" assumption
(it uses the debugger for the a11y tree regardless).

---

### `debugger-unavailable` is a RETURNED refusal, not a thrown error (reconciles DD8 vs the leg-list bullet)
**Context**: The flight contradicts itself on the a11y debugger-conflict signal. **DD8 says `readAxTree`
"returns a clear `debugger-unavailable` refusal"** (twice, incl. the unit-coverage wording); the
flight's leg-list bullet for `observe-a11y` calls it "the *thrown* `debugger-unavailable`."
**Decision**: Resolve in favor of **DD8 → RETURN** a discriminated object
`{ automation: 'debugger-unavailable', reason: 'attach-failed' | 'locked', wcId }`. bad-handle / dead /
**internal-session** still **throw** (via `resolveContents`). Rationale: a busy debugger (DevTools open
during dogfooding, or a second client) is an **expected operational condition** the caller routinely
handles — a first-class result, not an exception; whereas bad/dead/internal are programmer/security
errors. A Design Decision outranks the explicitly-"tentative" leg list. Confirmed in design review:
the union return (`Array<AXNode>` | refusal object) is discriminable via `Array.isArray`, is plain/
JSON-serializable, and flows through `engine.js` dispatch + the `ipcMain.handle` dev seam unchanged.
**Impact**: Leg 3 (`observe-a11y`) implements the return-refusal contract; Leg 4 wiring needs no special
handling; a future MCP consumer (Flight 3) discriminates on `Array.isArray`. The leg-list bullet's
"thrown" wording is superseded (annotated, not rewritten — spec is a snapshot).

## Deviations

### DD8 "DevTools-open → clean a11y refusal" primary live conflict test did NOT trigger — apparatus-limited
**Planned**: The flight (DD8 + Leg-6 HAT) names opening **DevTools** on a tab as the reliable live
trigger for the `attach-failed` refusal: an in-process `readAxTree` on a contents already held by a
second CDP client (DevTools) should `attach()`-throw → return
`{automation:'debugger-unavailable', reason:'attach-failed'}`.
**Actual**: With DevTools confirmed open on the guest (`webview.isDevToolsOpened() === true` on wcId 2),
`readAxTree(2)` **succeeded** (163-node tree) — no refusal. The opportunistic AC7 chrome read under
`cdp-driver` likewise succeeded. So no live trigger produced the `attach-failed` refusal.
**Reason (apparatus confound — surfaced by the operator)**: the dev seam is **only reachable over a CDP
port** — `npm run dev:debug` runs with `--remote-debugging-port=9222 --remote-allow-origins=*`, and
`cdp-driver` drives the seam through it. That port puts Chromium's debugging stack in **multi-session
mode** (flattened CDP sessions), which plausibly relaxes the one-client-per-contents exclusivity the
test assumes. The result is **confounded by construction**: every live invocation carries a CDP
connection, so a "no conflict" outcome can't be attributed to `observe.js` vs. the port, and the
classic Electron "attach throws when DevTools is open" behavior could not be reproduced here. (An
earlier characterization that "the in-process debugger is privileged" was **withdrawn** — not
supported.)
**Disposition (operator, 2026-06-13): record as apparatus-limited and land.** The `attach-failed`
refusal path stays **unit-tested** (fake `attach()` throws → clean refusal — authoritative); the
`locked` refusal path is **live-confirmed** (concurrent reads); the refusal **return shape** is
therefore live-exercised. Real second-client-conflict verification is **deferred to the Flight-3
transport**, which replaces this CDP-port apparatus (a production build has neither the port nor this
dev seam). The mission's "CDP single-client per contents" Open Question is **NOT** resolved by this
flight — it is reframed as: *verify under the Flight-3 transport, without a remote-debugging-port
confound.* The clean-refusal code remains correct, defensive, and the right design regardless.

## Anomalies
_None. (The DD8 conflict-trigger result is a test-apparatus limitation, recorded under Deviations, not a
defect: no observe op misbehaved, no debugger attach leaked.)_

---

## Session Notes
_Chronological notes from work sessions will be recorded here._
