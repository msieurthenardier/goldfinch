# Flight Debrief: Tab Surface

**Date**: 2026-06-26
**Flight**: [Tab Surface](flight.md)
**Status**: completed
**Duration**: 2026-06-25 – 2026-06-26
**Legs Completed**: 6 of 6 (`web-tabs-as-views`, `chrome-overlay-views`→`02b freeze-frame-html-menus`, `internal-tabs-as-views`, `remove-webview-machinery`, `verify-tab-surface-hat`)
**Landing commit**: `f035c89` (4 checkpoint commits; local; `main` untouched)

## Outcome Assessment

### Objectives Achieved
Every tab — web **and** internal `goldfinch://` — now renders as a per-tab `WebContentsView` driven by main-process geometry; the `<webview>` machinery (`webviewTag`, `will-attach-webview`, the dead `web-contents-created` filter) is gone (SC1 source-absence **met outright**). Per-tab partition/preload reproduced **byte-exact** at construction with farbling preserved; the internal trust model (four gates, session-scoped `protocol.handle`, origin-checked bridge, automation exclusion) transferred to constructed views with **no gate-code changes** because it keys on session identity, not the `<webview>` substrate. `captureWindow` re-homed to a window-grab/composite (DD11, PNG-verified in Leg 1). Chrome menus reverted to **styled HTML over a freeze-frame** of the guest. Render-correctness operator-confirmed on screen.

### Mission Criteria Advanced
- **SC1** (native guest surface, no `<webview>`) — **fully met**.
- **SC3** (browser-behavior parity) — met on the view surface (drive/observe MCP corpus + operator HAT).
- **SC5** (privacy/trust preserved) — met (byte-exact partition; jar-confinement live; farble spike-proven). *Pragmatic live smoke; formal `internal-session-exclusion` Witnessed run deferred to Flight 6 per the spec's own header; resolve-time rejection unit-tested.*
- **SC6** (automation forced subset) — `captureWindow` composite fixed; broad MCP parity remains the Flight-5 sweep.

## What Went Well

- **The security-critical risk transferred nearly for free.** DD3's byte-exact partition (constructed from the `INTERNAL_PARTITION` constant, never a literal) carried the entire internal trust boundary onto the views — the most load-bearing move in the mission, and it needed zero gate-code change. `internal-ipc`/`internal-assets`/`automation-resolve` unit suites stayed green untouched; live MCP confirmed enumerate-exclusion + jar-confinement.
- **Three reusable patterns emerged** (worth codifying): (1) freeze-frame freeze/unfreeze-the-active-view (capture guest → paint still in `#webviews` → hide live view → HTML renders above; decode-before-hide + dark `#webviews` bg kill the flash); (2) byte-exact-partition-carries-the-trust-boundary; (3) registry + **explicit** `wireGuestContents` at construction (the global `web-contents-created` fires *synchronously during* `new WebContentsView()`, so registry-membership can't see the view — explicit wiring is mandatory).
- **Design review caught three would-be bugs before code**: the `web-contents-created` sync-timing trap (DD4 mechanism superseded by explicit wiring); the DPR "divide by devicePixelRatio" error (CSS px == DIP; dividing shrinks the view at HiDPI); the web-spellcheck "no `spellcheck` key" subtlety (an explicit `false` at construction would wrongly freeze the session-layer toggle).
- **The HAT did its job as the integration gate** — it absorbed three internal-view regressions the per-leg design+review couldn't see (cross-cutting from DD0), all fixed inline + Reviewer-confirmed. The operator's runtime-smoke-before-stacking-legs discipline (Leg 1) and checkpoint-commit cadence kept the long flight recoverable.
- **The 02b Plan-agent codebase-validated review** (in lieu of a Developer design-review pass) surfaced load-bearing drift (the broken a11y audit; `menu-controller` extraction hazard; `window.prompt` unavailability) before implementation — an effective substitute.

## What Could Be Improved

### Process
- **The chrome-popup approach pivoted TWICE** (overlay→native→freeze-frame). The occlusion of HTML chrome by opaque guest views was classified in DD5/DD12 as an "F4-deferred convenience surface," when it actually broke **core nav UI** (new-tab dropdown, context menu) and was a Leg-1 blocker. Naming the HTML-chrome-over-native-view decision **at design time** (native widget vs. freeze-frame — CSS z-index cannot cross native view boundaries) would have avoided two failed implementation passes + an unplanned inserted leg (02b).
- **Substrate-opacity change wasn't traced through the guards.** DD0 pulled internal tabs onto the view substrate *after* DD5/02b were written assuming "internal = non-occluding `<webview>`." Three web-only guards (`!t.trusted` in `freezeGuest` + `sendActiveBounds`; `isInternalContents→null` in `capture-active-guest`) silently became wrong and only surfaced at the HAT. The per-leg Reviewer catches within-leg bugs; cross-cutting substrate implications need an explicit audit gate.
- **A broken verification harness silently hid a critical regression.** The a11y audit's `openPageContextMenuForAudit()` exercise point was removed in the Leg-2 native pivot, so the audit passed false-green through Legs 2–02b while masking a **critical** Leg-1 ARIA regression (dangling `aria-controls="webview-${id}"`). Restoring the audit in 02b surfaced + fixed it.

### Technical
- **Scattered `visibleWebTabWcId` / `!t.trusted` bookkeeping** across `createTab`/`activateTab`/`closeTab`/`freezeGuest`/`unfreezeGuest` is the root of the HAT regressions. A single "active-view" concept (web or internal, one wcId) would be cleaner than dual-tracking tab-model state + web-only view state. At minimum, rename/comment `visibleWebTabWcId` to make its web-only scope explicit.
- **Dead `find.js` automation path** — `src/main/automation/find.js:120,170` still `querySelectorAll('webview')` (empty now); the `findInPage` MCP op is non-functional. Deferred to Flight 4/5 per DD6 — must be Flight 4's first scope item.
- **`capture-active-guest` now captures internal pages** (HAT fix, Reviewer-confirmed safe — chrome-only freeze helper, no exfiltration); the handler comment should state this invariant precisely.
- **WSLg-vs-native rendering gap is accumulating**: transparent-overlay→black, captureWindow distortion, native-menu lag/ugliness, maximize-2/3, the internal-tab menu blip. The menu *architecture itself* was chosen on WSLg-observed behavior (native menus render fine on macOS). DD9's mac-unverified risk is now wider than a single DD.

### Documentation
- `CLAUDE.md` should document the **freeze-frame pattern** + the `capture-active-guest` contract, and add the **`INTERNAL_PARTITION` import-never-derive** convention as a named security rule (first-contact visible for anyone adding an internal view type). The CLAUDE.md tab architecture likely still describes the `<webview>` era.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD4 registry-predicate → explicit `wireGuestContents` in `tab-create` | `web-contents-created` fires synchronously *during* construction; registry can't see the view yet | **Yes** — explicit wiring at construction is the correct pattern |
| DD12 overlay → native → freeze-frame (two pivots) | Transparent overlay renders black on Electron 42/WSLg; in-window overlay → white-launch; native GTK menus look bad/lag on WSLg | Pattern yes (name it); the thrash no — decide pre-flight |
| Unplanned leg 02b inserted | Operator rejected native menus *after* Leg 2 landed; immutability → new leg | No (consequence of a post-landing rejection) |
| 3 HAT inline fixes (freeze/geometry/blip on internal tabs) | DD0 made internal tabs opaque; web-only guards became wrong | No — prevent via a substrate-guard audit gate |
| captureWindow test rewrite (+1 test) | `observe.js` gained `deps.grabWindow` injection (DD11) | n/a |

## Key Learnings
1. **Trust in Goldfinch is a session property, not a DOM property.** Byte-exact partition carried the whole internal trust boundary onto a new substrate for free. Any future view construction for internal content must import `INTERNAL_PARTITION`, never derive the string.
2. **When a migration changes a substrate's opacity/compositing/DOM-presence, audit EVERY guard keyed on the old substrate's properties** (`!t.trusted`, `tab.webview != null`, `isInternalContents`, `visibleWebTabWcId`). This is the Flight-2 "guard the real object" lesson extended.
3. **A broken verification-harness exercise point converts a passing check into a false-negative.** Treat "is the harness itself live (does a11y actually open the menu)?" as a per-leg checkpoint, especially after a pivot removes/re-routes a feature.
4. **HTML chrome cannot float over a native content view via CSS z-index — it's structural.** The only answers are native OS widgets (unstyleable) or freeze-frame (styled, async-capture latency). Decide which at design time.
5. **Per-leg review catches within-leg bugs; the HAT is the cross-cutting integration gate.** DD0's cross-leg implication was invisible to isolated leg review — the HAT is where it had to surface (and did).

## Test Metrics
`npm test` **951/951 pass, 0 fail, 0 skipped, no flakes**, ~1.9 s wall-clock (36 suites, single-process `node --test`); `typecheck` 0, `lint` 0, `a11y` 0 new violations. Trajectory: **950 (M05F2) → 951 (M05F3, +1)** — the sole delta is `automation-observe.test.js`, rewritten for the `captureWindow` `deps.grabWindow` signature (old 2 tests → 3: happy-path + two null-grab guards). Every other suite unchanged — expected, since the migration touches Electron/IPC/renderer-substrate that the electron-free unit suite doesn't reach. Slow outliers unchanged (`automation-mcp-server` ~1.9 s port-binding; `automation-port` ~0.9 s; `mcp-client` ~0.76 s). **First Mission-05 flight to capture per-suite metrics** — seeds the F4/F5/F6 baseline. The migration's visual/interaction layer (view construction, freeze-frame, z-order, geometry-on-resize) is **unit-untestable by design** and lives entirely in the HAT — a structural coverage boundary, not a gap to close in the unit suite.

## Recommendations
1. **Add a "substrate-guard audit" leg gate** for any migration that changes a content type's opacity/compositing: grep every `!t.trusted` / `tab.webview` / `isInternalContents` / `visibleWebTabWcId` reference and confirm each is correct under the new substrate (would have caught all three HAT regressions at design time).
2. **Make verification-harness liveness a checkpoint** — after any pivot, confirm `npm run a11y` actually exercises the dynamic path (opens the menu), not just static HTML.
3. **Author two behavior-test specs in Flight 4 planning** (this surface showed real regression risk): `tab-surface-geometry` (freeze open/dismiss, panel-resizes-guest, find-inset) and `internal-tab-menus` (kebab/container render + freeze/restore on Settings/Downloads) — currently operator-eyeball-only.
4. **Flight 4 must fix the `find.js` dead automation-find path first** (re-home the `found-in-page` listener off `querySelectorAll('webview')` onto the tab-view registry + the existing `tab-found-in-page` IPC), and update `responsive-tab-strip` per M05F2 Rec 5 (deferred F2→F3, don't defer again).
5. **Resolve the macOS gap at Flight 6's landing gate (DD9)** — the WSLg in-loop venue is diverging from the production target, and the *menu architecture itself* was WSLg-decided; front-load a macOS smoke before locking freeze-frame as the permanent answer. Flight 5 should design the internal-`wcId` readback apparatus so the formal `internal-session-exclusion` spec can finally run.

## Action Items
- [ ] **Flight 4 scope (first item):** re-home `find.js` automation `findInPage` off the dead `<webview>` query (removes the last `querySelectorAll('webview')` in the codebase).
- [ ] **Flight 4 planning:** author `tab-surface-geometry` + `internal-tab-menus` behavior specs (see `.claude/skills/behavior-test/AUTHORING.md`).
- [ ] **CLAUDE.md:** document the freeze-frame pattern, the `capture-active-guest` chrome-only contract, and the `INTERNAL_PARTITION` import-never-derive security convention.
- [ ] **Refactor (F4/F6):** consolidate `visibleWebTabWcId` + scattered `!t.trusted` bookkeeping toward a single active-view concept; comment/rename meanwhile.
- [ ] **Flight 5:** design the internal-`wcId` readback apparatus (unblocks the formal `internal-session-exclusion` Witnessed run).
- [ ] **Flight 6:** macOS smoke as a landing gate (validate menus/freeze/maximize/capture on the production target); optional belt-and-suspenders `chromeView.setBounds()` in the `maximize`/`unmaximize` handlers.
- [ ] **Carried known issues (operator-accepted, WSLg-class, non-blocking):** internal-tab menu-open blip; maximize ~2/3 screen — re-check on macOS.
- [ ] **Pending:** merge `flight/03-tab-surface` → the mission branch (operator decision, matching the Flight-2 local-only pattern).
