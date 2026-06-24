# Flight Log: Window Shell

**Mission**: WebContentsView Migration
**Flight**: 02 — Window Shell
**Status**: in-flight

> Execution notes recorded here per leg. Planning premise-spike (webview-in-WebContentsView) verified GO —
> see flight.md Open Questions / DD1; evidence in the ephemeral scratch dir
> (`premise-report.json`, `premise-webview-in-view.png`).

## Leg Notes

### Leg 1 — basewindow-chrome-shell
**Status**: completed (implemented in a prior session; adopted + runtime-verified + batched flight review passed; committed)

#### Adoption (resumed run)
On resume, the working tree already carried the full Leg 1 implementation (uncommitted) from a prior
session: `BaseWindow` + chrome `WebContentsView`, the `getChromeContents()` accessor, every DD2 site
re-pointed, the `isDestroyed()` guards converted to gate the chrome contents, and the engine accessor
contract flipped window→contents (`engine.js`). Re-verified the static gates before adopting:
- `grep -n "mainWindow\.webContents" src/main/main.js` → **0 matches** (AC7 ✓)
- `npm run typecheck` → clean (AC10 ✓)
- `npm run lint` → clean (AC10 ✓)
No autonomous Developer re-spawn — the implementation is complete; re-running one would clobber it.

#### Runtime verification (AC9 — PROVEN this session, not deferred)
Operator challenged the premature "landed" (they'd seen a crash during prior-session Leg-1 testing), so
AC9 was verified live rather than deferred to the HAT. Clean instrumented relaunch
(`GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, **stdout→file** so no broken pipe), then drove
the real MCP consumer path (`scripts/mcp-example-client.mjs`) against the loopback server
(`127.0.0.1:49709`, fallback from 49707):
- **27 tools advertised** → engine alive; the `createEngine(getChromeContents, …)` accessor-contract
  change is correctly wired (this is the whole-engine proof the wide re-point demanded).
- `openTab https://example.com` → **wcId**; `navigate` → `{"ok":true}`; `readDom` → real
  `{"url":"https://example.org/","title":"Example Domain", …}` → **`<webview>` tabs actually browse and
  render real web content inside the view-hosted chrome** (DD1 premise holds in the real app).
- `captureScreenshot` → 25 KB PNG; `enumerateTabs` → two live tabs. Per-tab capture path intact.
- **EPIPE count in the file-sink log: 0** → confirms the operator's crash was the stdout-pipe plumbing
  gap (D-EPIPE), reproducibly ABSENT when stdout is a file. The migration does not cause it.

#### captureWindow guest-compositing — CARRIED OPEN QUESTION / DIVERT TRIGGER: resolved favorably
The flight's one carried unknown (and explicit divert trigger): does `captureWindow`
(`chromeContents.capturePage()`) composite the in-chrome `<webview>` guest now that the chrome is a
`WebContentsView`? Tested via the agent-reads-PNG loop (admin key; evidence in the ephemeral scratch dir):
- First capture (default new-tab, guest **not yet painted** — tab title still "New tab") → chrome
  rendered, guest content area **blank white**. Looked like the divert condition.
- Re-test with a deliberately navigated + activated + settled guest (`example.org`, ~2.5 s paint): per-tab
  `captureScreenshot` shows the page; **`captureWindow` shows the full chrome WITH the guest composited in
  the content area** ("Example Domain …").
- **Conclusion**: `captureWindow` composites the in-chrome guest correctly on the `WebContentsView` shell —
  **divert trigger does NOT fire** (satisfies the SC6 capture-path checkpoint early). **Caveat for Leg 3 /
  any captureWindow-based behavior test**: the capture is paint-timing-sensitive — a window capture taken
  before the active guest has painted yields chrome-without-guest. Add a settle/wait (or wait-for-paint)
  before capturing. Not a structural regression.

AC9 ✓ (engine + browse + capture, live). Remaining Leg-1 acceptance now fully met; full HAT pixel walk
(drag, controls, behavior-test corpus, a11y) still happens at Leg 3 with the operator.

#### Design
- Authored `legs/01-basewindow-chrome-shell.md` from DD1/DD2/DD3/DD6 + source grounding (main.js, engine.js).
- Design review (Developer, Sonnet): **approve with changes**. Line refs confirmed accurate against working tree; `WebContentsView.setBackgroundColor` confirmed present in Electron 42 (inherited from `View`).
- Incorporated (no architectural change, so no 2nd review cycle):
  - AC5: added the two `window-maximized-change` sends (`310–311`) — required for AC7's zero-grep — with the Leg1/Leg2 split made explicit (Leg 1 re-points the `.send` payload; Leg 2 owns the event registration + control-method re-point + activate fix).
  - AC5/Edge: required guard conversion on `isDestroyed()`-gated sends (broadcast `850`, downloadURL `993`, privacy-net `682`, privacy-permission `825`) — a `BaseWindow.isDestroyed()` guard compiles but gates the wrong object (silent break).
  - AC7: explicitly includes the comment/JSDoc at `main.js:839` (literally matches the grep).
  - Geometry-timing edge case; tightened AC6 engine.js wording; dropped the `setBackgroundColor` hedge.

### Leg 2 — window-controls-parity
**Status**: completed (implemented + batched flight review passed; committed)

#### Implementation (Developer, Opus)
Changes to `src/main/main.js` (built on the uncommitted Leg 1 working tree; not committed):
- **AC4 (D-EPIPE guard)**: installed a `for (const stream of [process.stdout, process.stderr])` /
  `stream.on('error', …)` guard immediately after the `require(...)` block (after the last require at
  line 29, before any app/window wiring and before the `AUTOMATION_DEV_MINT` write). Swallows
  `err.code === 'EPIPE'` (returns), surfaces anything else via `process.emitWarning(err)` — no `throw`,
  no `console.*`, no write to the broken stream.
- **AC1 (DD7)**: `app.on('activate')` changed from `BrowserWindow.getAllWindows()` →
  `BaseWindow.getAllWindows()`.
- **AC2**: removed `BrowserWindow` from the `const { … } = require('electron')` destructure at `main.js:3`
  (unused after AC1). `grep -n "BrowserWindow" src/main/main.js` → single hit, the descriptive comment
  (now ~line 289 after the guard shifted line numbers), left as-is. No live code references.
- **AC3 (DD4)**: confirmed the four window-control IPC handlers (`window-minimize`,
  `window-toggle-maximize`, `window-close`, `window-is-maximized`, ~main.js:1165–1173) call identical
  `BaseWindow` methods and never dereference `.webContents` — **no handler change needed**, which is the
  correct outcome. `maximize`/`unmaximize` event registration left on `mainWindow`.

#### Evidence
- `npm run typecheck` → EXIT 0.
- `npm run lint` → EXIT 0 (would have caught a stray unused `BrowserWindow` if AC2 were missed).
- `grep -n "mainWindow\.webContents" src/main/main.js` → 0 (no Leg 1 regression).
- `grep -n "BrowserWindow" src/main/main.js` → only the descriptive comment; no live code refs.
- Live EPIPE/window-controls check deferred to the Leg 3 HAT (operator venue); not launched here.

#### Design
- Authored `legs/02-window-controls-parity.md`: `activate` → `BaseWindow.getAllWindows()` (DD7), drop the
  now-unused `BrowserWindow` import, confirm window-control handlers operate on the `BaseWindow` (no churn —
  identical API, no `.webContents`), plus the D-EPIPE stdout/stderr guard.
- Design review (Developer, Sonnet): **approve with changes**. All file:line refs confirmed against the
  post-Leg-1 working tree; `BrowserWindow` confirmed unused after the `activate` fix (lint backstop valid).
- Incorporated (no architectural change, no 2nd cycle): the EPIPE guard must **not** `throw` inside the
  `stream.on('error')` listener (re-raises as uncaught — the very crash it prevents) and must not
  `console.*` (re-enters the broken stream) → use `process.emitWarning` for non-EPIPE; semantic placement
  (not a literal line); leave the line-277 comment as-is.

## Deviations

_None this flight. (D-EPIPE is a recorded scope addition, not a deviation — see Decisions.)_

## Decisions

### D-EPIPE — Main-process stdout/stderr EPIPE guard (operator-approved scope addition)
**Context**: Mid-run, the operator hit a modal "A JavaScript error occurred in the main process — Uncaught
Exception: write EPIPE" dialog while the app ran under `npm run dev:automation` (`--enable-logging
--automation-dev`). Stack is Electron-internal: a guest/renderer `console.*` message being forwarded to the
main process **stdout** (a pipe) whose read end had closed → `write EPIPE` → uncaught (the main process has
no `process.stdout`/`stderr` error handler and no `uncaughtException` handler; only the raw
`process.stdout.write('AUTOMATION_DEV_MINT …')` at `main.js:1493`). Root cause is a broken-stdout-pipe
robustness gap, **independent of the `BaseWindow` migration** (no migration code calls `console.info`).
**Decision**: Operator chose **fix in this flight**. Add an `EPIPE`-swallowing error handler on
`process.stdout`/`process.stderr` in the main process so a closed stdout reader cannot crash the app.
Implemented as an explicit acceptance criterion folded into **Leg 2** (the other main-process /
app-lifecycle change, not yet started — avoids re-scoping in-flight work and keeps the leg count at 3),
recorded here as a deliberate, governed scope addition rather than silent creep.
**Impact**: Slightly widens Leg 2 beyond pure window-controls parity; removes a crash that would otherwise
recur during the Leg 3 HAT and any `--enable-logging` run. Verified at the HAT (Leg 3) by launching under
`--enable-logging` without the modal dialog.

## Flight Director Notes

### 2026-06-24 — Resume + operator interventions
- Resumed an in-progress run: Leg 1 was already implemented (prior session, uncommitted). Adopted it after
  re-verifying static gates (grep/typecheck/lint); did NOT re-spawn a Developer (would clobber the work).
- Operator interrupted the planned autonomous Leg-1 Developer spawn and surfaced the EPIPE crash dialog.
  Diagnosed as a broken-stdout-pipe robustness gap (see D-EPIPE), not a migration defect. Operator elected
  to fix it in-flight → folded into Leg 2 as an explicit AC.

### 2026-06-24 — Batched flight review (Legs 1+2)
- Per the `/agentic-workflow` single-review model: one Reviewer (Sonnet, never Opus) over ALL uncommitted
  changes after both autonomous legs. Verdict: **[HANDOFF:confirmed]**, zero blocking/non-blocking issues.
  Independently re-ran the gates: `npm run typecheck` clean, `npm run lint` clean, `npm test` → **950 pass /
  0 fail**. Confirmed grep `mainWindow.webContents` = 0, `BrowserWindow` only in a comment, security gates
  (internal partition / four gates / `isSafeTabUrl` / origin-checked bridge) untouched.
- Committing Legs 1+2 together (code + artifacts), statuses → completed, checked off in flight.md. Flight
  stays **in-flight**: Leg 3 (`verify-shell-hat`, interactive HAT) remains. PR/push deferred until after the
  HAT and operator go-ahead (outward-facing; mission keeps `main` stable, flight branches off the mission
  branch).

### 2026-06-24 — Flight start (`/agentic-workflow`)
- Loaded crew phase file `leg-execution.md` (well-formed: Crew / Interaction Protocol / Prompts present).
- Created branch `flight/02-window-shell` off `mission/05-webcontentsview-migration` (mission constraint: flights branch off the mission branch, not `main`).
- Flight + flight-log status → `in-flight`.
- Plan: Legs 1 (`basewindow-chrome-shell`) and 2 (`window-controls-parity`) run autonomous (design → design-review → implement) and are batched into a single end-of-flight review + commit. Leg 3 (`verify-shell-hat`) is an interactive HAT — run after the batch commit, operator-driven, its own commit.
- Models: Developer + Reviewer on Sonnet per crew file (Reviewer never Opus).
