# Flight Debrief: Polish & MCP Hygiene

**Date**: 2026-06-22
**Flight**: [Polish & MCP Hygiene](flight.md)
**Status**: landed
**Duration**: 2026-06-20 (planned) – 2026-06-22 (landed; HAT spanned 06-20→06-21)
**Legs Completed**: 5 of 7 `completed` (2,3,4,5 + 6-deterministic + 7-HAT); **1 `aborted` (#27 reverted)**; behavior-test runs deferred

## Outcome Assessment

### Objectives Achieved

The closing flight of Mission 04 shipped **four of its five work items** and cleanly deferred the fifth:

- **#56 / SC9 — MCP schema hygiene (MET).** Flattened the `pressKey` `inputSchema` (removed the top-level
  `anyOf` strict-MCP consumers reject), enforced "name-or-key" with a distinct runtime guard
  (`mcp-tools.js:340-347`, surfaces as an `isError` tool result, not a crash), and added a **standing,
  count-agnostic schema-hygiene unit test** asserting no tool's `inputSchema` carries a top-level
  `anyOf`/`oneOf`/`allOf`/`not`. SC9 is now a regression-proof invariant, not a point-fix.
- **settings-cleanup** — removed the dead `goldfinch://settings` Downloads nav link + placeholder section
  and fixed the garbled spellcheck-note copy. Query-driven scrollspy self-adjusted; a11y-clean.
- **downloads-handler-refactor** — extracted `wireDownloadHandler`'s record/payload construction into a
  pure, electron-free, **accessor-injected** helper (`src/main/downloads-payload.js`); behavior-preserving;
  unit-tests the two Flight-5 HAT-fix behaviors (`filename = basename(getSavePath())`, `paused = isPaused()`).
- **app-icon** — `goldfinch_new.png` (761×761) wired in as `build/icon.png` via `git mv`; orphan removed.
- **#27 / SC10 — side-panel animation: REVERTED at HAT, DEFERRED.** See What Could Be Improved.

**Gates:** 950 unit tests pass (0 fail/skip), typecheck + lint clean, `npm run a11y` green (0 new violations).

### Mission Criteria Advanced

- **SC9** — MCP schema hygiene. ✅ **MET** (unit-test-backed; standing guard).
- **SC10** — Side-panel animation polish. ❌ **NOT MET — deferred** (reverted at HAT; carried to the
  macOS/Windows verification pass, possibly downstream of the `WebContentsView` migration — see Recommendations).

Net: Mission 04's other conveniences (settings hygiene, downloads-code health, app branding) advanced; SC10
is the one mission criterion this flight could not close.

## What Went Well

- **The divert framing made the #27 revert a clean decision, not a thrash.** The spec singled out #27 as the
  only item with explicit Adaptation/Divert criteria ("descope if it needs a structural change bigger than a
  polish leg warrants; do not destabilize the panels for a closing flight"). When all three mechanism
  attempts failed at HAT, the operator invoked exactly that pre-authorized escape hatch — the revert read as
  the plan firing correctly, not as a failure.
- **Risk isolation worked perfectly.** Legs 2–6 shared no files with leg 1, so #27's collapse cost the four
  mechanical wins nothing — they shipped, fully backed. Bundling one risky visual item with low-risk wins is
  safe *when the wins don't depend on it*, and the leg sequencing guaranteed that.
- **The HAT earned its keep — it caught the #27 regression before merge.** Without the live HAT, a visibly
  broken animation (DOM-correct but render-broken) would have merged green.
- **Two durable architectural assets landed.** The DD2 standing-invariant test (converts SC9 from
  fixed-once to cannot-regress) and the DD4 accessor-injection seam (isolates Electron `DownloadItem` reads,
  makes them unit-testable, single-sources both payload sites) — both are reusable patterns.
- **Legs 2/3/4/5 landed first-pass**, each with a single approve design-review cycle. The DD4 accessor-injection
  correction made *at planning* (architect cycle) meant the implementer hit no surprise. Planning worked.
- **The reverted code is genuinely clean** — `git diff main...HEAD` shows zero delta on `renderer.js`/`styles.css`;
  no half-built `slidePanel` scaffolding or dangling CSS survived.

## What Could Be Improved

### Process
- **DD1 (#27) needed an empirical spike to gate the mechanism — and the failure was auditable in advance, not
  unforeseeable.** The mechanism reasoning was correct on its *one* axis (does the DOM reflow? — yes, so use
  a composited transform). But the apparatus/environment axis was never audited: *"will an Electron
  `<webview>` native compositing surface re-composite correctly when an adjacent element animates next to it
  under WSLg?"* The signal was present — the mission's **own Known Issues already record two prior
  `<webview>`-native-surface-vs-WSLg divergences** (find-in-page `{0,0}` cold-start; DevTools docking needing
  `WebContentsView` because the `<webview>` guest has no native host region). "DOM correct, native surface
  wrong" was a *known recurring failure mode in this exact codebase*, and #27 animates layout around that
  surface. A ~30-minute throwaway spike (transform a box next to a live `<webview>` under WSLg, watch the
  surface) would have surfaced it **before** a 473-line, twice-design-reviewed, two-prong leg was built,
  landed, and reverted in full. The cost asymmetry is the lesson: a one-box spike vs. an entire leg's
  design+implement+review+three-HAT-attempts+revert.
- **The three HAT attempts (transform+width-swap → overlay → clipped overlay) were diagnosis-by-iteration on
  the most expensive surface (live HAT).** Once the first attempt showed the DOM-correct/render-shifted gap,
  that gap *was* the diagnosis — the native surface, not CSS. The 2nd and 3rd CSS-mechanism attempts chased a
  cause that the first attempt had already ruled out of the DOM/CSS layer.

### Technical
- **Panel-animation layout correctness on a `<webview>`-bearing surface is inherently HAT/visual — not unit-
  or DOM-behavior-testable.** Every automatable observable (`getBoundingClientRect`, a11y tree, chrome-side
  `evaluate`) read the layout *correct* while the screen was broken. Only pixel-level `captureWindow` diffing
  could catch it — and per the operator's global instruction, visual snapshot baselines are local-only, not a
  committed CI net. So there is **no standing automated guard** possible for this; the re-attempt must plan a
  visual HAT as load-bearing from day one.
- **DD5 only partially met — behavior-test runs deferred.** `page-context-menu.md` + `spellcheck.md` remain
  `draft` (the same state carried *into* this flight); the hardened `downloads-surface.md` is `active` but
  its re-run never executed (the unit-level downloads-payload tests are the actual backstop right now). Three
  `SKELETON-PENDING-HAT-RUN.md` run-logs are committed as placeholders — useful scaffolding, but a `draft`
  spec + committed empty run-log is a slightly confusing artifact state the follow-up should resolve.

### Documentation
- **The `<webview>`-layout-change compositing gotcha is undocumented in CLAUDE.md** — the single
  highest-leverage doc action. Without a one-line warning + pointer, the next person *will* repeat the
  three-attempt cycle. The full diagnosis lives in the flight log HAT note and the reverted leg-01 spec; only
  the warning is missing from the durable location.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| #27/SC10 reverted in full at HAT | Electron `<webview>` native surface mis-positions on DOM-layout-change under WSLg (3 mechanisms; DOM geometry correct, render shifted). Spec's divert criterion invoked. | No (one-off revert) — but the *premise-spike lesson* IS a standing practice |
| Three CSS-mechanism attempts before reverting | Diagnosis-by-iteration on live HAT | No — once attempt 1 showed DOM-correct/render-shifted, the native surface was the diagnosis; stop iterating CSS |
| Behavior-test runs (DD5) deferred to follow-up | #27 detour consumed the HAT session (operator decision) | No — bounded follow-up; the skeleton run-logs are staged |
| `Ctrl+M` minimizes window (found at HAT) | Pre-existing (no custom app menu → Electron default owns Ctrl+M); NOT a Flight-6 regression | No (bug) — carry to a keybinding/menu pass |
| `goldfinch_new.png` shipped at 761 (below 1024 "ideal") | Operator "Ship 761 now"; meets ≥512 floor | No — future 1024 master is a follow-up |

## Key Learnings

- **"CSS/DOM correctness ⇒ correct render" is FALSE for `<webview>` under this stack.** Three Known Issues
  now corroborate it. This must become a *stated, audited assumption* for any future flight touching the
  webview region — not an unexamined one.
- **Native-surface-touching work has a blocking apparatus/environment premise, dischargeable only by a cheap
  empirical spike.** This is the fourth environment-authoritative discovery in Mission 04 (Flight-3 DevTools,
  Flight-4 spellcheck/context-menu, Flight-5's download HAT defects, now Flight-6's `<webview>` compositing).
  Anything touching a native surface (paint, dialog, compositing) is HAT/OS-authoritative and resists
  pre-flight prediction by reasoning alone — but IS catchable by a spike.
- **The divert criterion is a high-value spec element for risky items.** Pre-authorizing the escape hatch let
  the team revert cleanly without it reading as failure. Every risky/uncertain leg should carry one.
- **Test trajectory healthy:** 803 (F1) → 834 (F2) → 879 (F3) → 879 (F4) → 938 (F5) → **950 (F6, +12)**, all
  real coverage (10 downloads-payload + 2 net automation-mcp-tools). Suite 950/950, ~1.1s, electron-free; no
  flake reproduced on a double-run (the earlier transient was a parallel-leg mid-edit read artifact).

## Recommendations

1. **Document the `<webview>`-layout-change gotcha in CLAUDE.md** (highest leverage): one sentence —
   "changing the DOM layout *around* an Electron `<webview>` can mis-position its native compositing surface
   under WSLg even when DOM geometry reads correct; animate via compositor-only properties that don't change
   layout around the guest, and verify visually on the target OS" — plus a pointer to this flight's log.
2. **Adopt "premise-audit-with-a-spike" as a named, blocking practice for native-surface work.** For any
   future change touching/surrounding the `<webview>`, a cheap empirical spike on the target platform(s)
   gates mechanism commitment. "DOM geometry reads correct" is necessary but provably insufficient evidence;
   the acceptance signal is the *rendered* surface, observed.
3. **Plan the #27 re-attempt on macOS/Windows with a visual HAT as load-bearing from day one** — ride the
   mission's planned macOS verification pass. First spike whether the target OS's `<webview>` composites
   correctly under a layout change around it; if it has the same property, the mechanism class is dead and
   #27 is **downstream of the `WebContentsView` migration** already seeded in `BACKLOG.md` (flag this to
   `/mission-debrief` — it may make #27 an architecture item, not a polish item).
4. **Activate the deferred behavior specs** (`page-context-menu`, `spellcheck` → `draft→active`) and run the
   hardened `downloads-surface` re-run — the apparatus premise is confirmed YES and the skeleton run-logs are
   staged; this moves SC6/SC3 off "formally unchecked" and gives the download regression guards their first
   green end-to-end run.
5. **Standardize two shipped patterns** in future leg specs: the **standing-invariant unit test** (iterate
   the registry, assert no offenders — count-agnostic; from DD2) for any cross-tool contract; and
   **accessor-injection** (inject a live Electron object's methods as a bag so the *reads*, not just
   transforms, are unit-testable; from DD4) for any main-process logic reading off a live Electron object.

## Action Items
- [x] Add the `<webview>`-layout-change compositing warning + flight-log pointer to `CLAUDE.md`. *(Done
  2026-06-22 — Architecture section gotcha bullet.)*
- [ ] Carry #27/SC10 to the macOS/Windows verification pass; gate any mechanism on an on-platform
  `<webview>`-compositing spike; evaluate whether it's downstream of the `WebContentsView` migration (raise
  at `/mission-debrief`).
- [ ] Run the deferred behavior tests: `page-context-menu` + `spellcheck` → `active`; `downloads-surface`
  re-run (resolve the committed SKELETON run-logs).
- [ ] Carry the `Ctrl+M`/custom-application-menu fix to a keybinding/menu pass (bundle with `menuController`
  graduation if/when that happens).
- [ ] Dead-asset sweep: wire or delete `src/renderer/assets/goldfinch_mono.png` (confirmed orphaned).
- [ ] Optional follow-up: replace `build/icon.png` with a 1024×1024 master for top-slot fidelity.
- [ ] Methodology: record "premise-audit-with-a-spike for native-surface work" where the project keeps its
  flight-planning conventions.
