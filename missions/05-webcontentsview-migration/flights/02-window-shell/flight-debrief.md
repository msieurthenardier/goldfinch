# Flight Debrief: Window Shell

**Date**: 2026-06-25
**Flight**: [Window Shell](flight.md)
**Status**: landed → completed
**Duration**: 2026-06-24 – 2026-06-25 (resumed `/agentic-workflow` session; Leg 1 implemented in a prior session and adopted on resume)
**Legs Completed**: 3 of 3 (`basewindow-chrome-shell`, `window-controls-parity`, `verify-shell-hat`)

## Outcome Assessment

### Objectives Achieved

The window host migrated from `BrowserWindow` to `BaseWindow` + a chrome `WebContentsView` at behavior parity, with guest tabs deliberately left as `<webview>` inside the chrome doc (Flight 3's scope). Every `mainWindow.webContents.*` site was re-pointed through a single `getChromeContents()` accessor (grep-verified zero matches), the automation-engine accessor contract was flipped window→contents, and the whole surface was proven live: 27 MCP tools, real-page browsing via `<webview>`, and — the flight's one carried unknown — `captureWindow` composites the in-chrome guest. An operator-surfaced EPIPE crash was diagnosed as a broken-stdout-pipe robustness gap (independent of the migration) and fixed in-flight (D-EPIPE).

### Mission Criteria Advanced

- **SC8** (frameless window + per-platform window controls at parity) — **advanced/met on Linux/WSLg**: frameless render, maximize/restore + DD7 state-sync confirmed; macOS unverified per DD5 (build-readiness only). Drag-by-hand + minimize/close clicks deferred at HAT (low risk).
- Lays the `BaseWindow` + chrome-`WebContentsView` **foundation** SC1/SC3 build on in Flight 3 (engine + capture survive the host swap).

### Checkpoints

All In-Flight checkpoints met except the explicit drag/minimize/close eyeball (operator wrapped the HAT early after migration-critical assertions passed). `captureWindow`-composites-guest checkpoint **met early** during Leg 1 runtime verification.

## What Went Well

- **The grep-driven "zero old-reference survives" gate (Leg 1 AC7).** Making `grep "mainWindow.webContents" → 0` the acceptance signal forced completeness across 23 new `getChromeContents` call sites and caught what a hand-list would have missed (the JSDoc comment, the inline `scopeCtx` accessor, the guard conversions). A reusable pattern for any accessor-introduction migration.
- **The design-review catch that saved the engine.** The first design draft said "no engine change needed"; review found `engine.js` dereferences `mw.webContents` internally, so a `BaseWindow` (no `.webContents`) would have silently broken all 27 MCP tools + `captureWindow` + the dev seam. Flipping the accessor contract window→contents was the load-bearing fix — caught before any code shipped.
- **Carrying the `captureWindow` unknown as a divert-trigger-into-execution** (rather than blocking pre-flight) was correct: it could only be answered against the real app code path, cost one agent-reads-PNG loop, and surfaced a nuance (paint-timing sensitivity) no pre-flight probe would have.
- **The `isDestroyed()` guard-conversion insight** — `BaseWindow.isDestroyed()` compiles/lints clean while gating the wrong object — was specced as an explicit edge case and landed uniformly across all four sends.
- **EPIPE guard is exemplary defensive code** — non-obvious invariants (no `throw`, no `console.*`, EPIPE-only) documented at the point of enforcement; folded into Leg 2 as a governed, operator-approved scope addition rather than silent creep.
- **Resume resilience**: Leg 1 arrived already-implemented from a prior session; the Flight Director adopted it via static-gate re-verification instead of re-spawning a Developer that would have clobbered it.

## What Could Be Improved

### Process
- **Audit accessor *consumers*, not just direct references.** The engine-contract miss in the first draft came from auditing `main.js` reference sites but not `engine.js`'s internal dereference. Future accessor changes should grep all consumers of the thing being changed.
- **The behavior-test corpus was only partially run.** `responsive-tab-strip` Steps 1–3 PASS; Steps 4–8 + `tab-keyboard-operability` + `settings-shell` deferred (operator "enough confirmed"). Defensible (renderer-internal, untouched by the host swap), but the corpus should run in full at **Flight 3's** HAT — not defer further.

### Technical
- **One consistency nit**: `getChromeContents().on('will-attach-webview', …)` (main.js ~330) is the lone non-`?.` accessor call. Safe today (synchronous, right after assignment) but a latency trap if `createWindow` is ever refactored to defer view creation.
- **Untested edge cases carried forward**: WSLg un-maximize/restore flakiness (operator-visual only); `captureWindow` paint-timing + the WSLg compressed-top-left capture artifact; HTML5-fullscreen resize (pre-existing — no `enter/leave-html-full-screen` handler).
- **Test metrics**: `npm test` 950 pass / 0 fail / 0 skipped, ~1.0 s wall-clock (12 suites); typecheck + lint clean; no flakes on two runs. **Flat vs M04 F6 (also 950)** — correct: the migration touches only main-process Electron/IPC wiring, which the electron-free unit suite cannot reach. Trajectory: 96→147→358→590→773→803→879→938→**950 (M04 F6, M05 F2 — flat)**.

### Documentation
- CLAUDE.md was synced to the new shell (commit `0dad2b1`) and verified accurate (no `BrowserWindow` residue; `getChromeContents()` described). Complete.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| D-EPIPE: added a `process.stdout/stderr` EPIPE guard (out of original scope) | Operator hit a broken-stdout-pipe crash mid-run under `--enable-logging`; robustness gap independent of the migration | Yes — install the EPIPE guard pattern in any Electron main process |
| Leg 1 adopted from a prior session (not re-implemented) | Resumed run found Leg 1 already implemented uncommitted | Yes — adopt + re-verify static gates rather than re-spawn (don't clobber) |
| DD3 initial bounds from ctor size, not `getContentBounds()` at construction | `getContentBounds()` can lag the requested size at the construction instant → gap flash | Yes — set initial child-view bounds from ctor size; let `resize` own steady state |
| HAT wrapped at behavior-test Step 3 (corpus partial) | Migration-critical assertions confirmed; remainder is renderer-internal | Case-by-case — acceptable when deferred items are provably untouched by the change |

## Key Learnings

1. **A `BaseWindow` has no `.webContents` — every accessor *consumer* must be audited, not just reference sites.** The engine internal dereference was the trap.
2. **On WSLg, the capture surface can lie even when the screen is right** (`captureWindow` compressed top-left while DOM + on-screen render are correct). This is the mission's "DOM-correct ≠ render-correct" theme appearing in the *test apparatus*. Prefer maximized capture or `evaluate()` numeric reads.
3. **`evaluate()` IS available** over the chrome `wcId` — the `responsive-tab-strip` spec's "no in-page numeric read" assumption is outdated and made the run harder than necessary. (See Action Items.)
4. **`captureWindow` composites the in-chrome guest, but only once the guest has painted** — a capture before paint returns chrome-without-guest. A general caveat for any `captureWindow`-based behavior test.
5. **macOS-unverified risk is accumulating** (DD5). Each flight adds unverified mac surface; Flight 6's landing gate (build-readiness + contributor mac build) must resolve it — name it explicitly in Flight 3/4 planning, don't let it accrue silently.

## Recommendations

1. **Flight 3: extend the seam, don't replace it.** Introduce a parallel `getTabView(wcId)`/`getTabContents(wcId)` accessor for per-tab views; leave `getChromeContents()` for chrome-renderer sends. Carry the guard-conversion lesson (`tab.isDestroyed()` on a wrapper vs the real send target) into the Flight 3 edge-cases section.
2. **Flight 3: remove the vestigial `<webview>` machinery.** Once tabs are per-tab views, `webviewTag:true` and the `will-attach-webview` hook become dead — remove them (clean-up gate), and revisit the `download-media` fallback (`wc || getChromeContents()` → likely `wc || getActiveTabContents()`).
3. **Flight 3: run the security-identity behavior tests FIRST** (`internal-session-exclusion`, `mcp-jar-scoping`) — session-object-identity drift in the partition rewiring is undetectable by inspection, and run the full Flight-2-deferred corpus (`responsive-tab-strip` 4–8, `tab-keyboard-operability`, `settings-shell`) at the Flight 3 HAT.
4. **Standardize three patterns**: the zero-grep "no old reference survives" acceptance gate; the module-scoped, JSDoc'd, single-definition accessor with a documented null contract; and the "settle the guest before `captureWindow`" test-authoring note.
5. **Update the `responsive-tab-strip` spec** to adopt `evaluate()` numeric reads as a first-class observable + a `captureWindow`→`evaluate()` WSLg fallback + an active fixture-distinctness probe (duplicate "Example Domain" titles would have made Step 5 ambiguous).

## Action Items
- [ ] Flight 3 planning: design `getTabView`/`getTabContents` accessor + per-tab view geometry/z-order; pull the Flight-1 spike's one-per-tab-vs-pool finding forward; account for `contextIsolation:false` farbling on directly-constructed views.
- [ ] Flight 3: remove `webviewTag:true` + the `will-attach-webview` hook once tabs are views; revisit `download-media` fallback.
- [ ] Flight 3 HAT: run the full behavior corpus deferred here, security-identity specs first.
- [ ] Update `tests/behavior/responsive-tab-strip.md`: `evaluate()` as observable + WSLg capture fallback + fixture-distinctness probe (next behavior-test authoring pass).
- [ ] Minor: add `?.` to the `getChromeContents().on('will-attach-webview', …)` call for accessor-call consistency (or remove the hook in Flight 3, which moots it).
- [ ] Name the accumulating macOS-unverified (DD5) risk explicitly in Flight 3/4 planning; ensure Flight 6's landing gate resolves it.
