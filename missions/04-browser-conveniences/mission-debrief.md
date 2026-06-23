# Mission Debrief: Standard Browser Conveniences

**Date**: 2026-06-23
**Mission**: [Standard Browser Conveniences](mission.md)
**Status**: completed
**Duration**: 2026-06-18 – 2026-06-22
**Flights Completed**: 6 of 6 (all landed + merged to main)

## Outcome Assessment

### Success Criteria Results
| Criterion | Status | Notes |
|-----------|--------|-------|
| **SC1** — Page zoom | ✅ Met | Flight 1; keyboard `Ctrl±/0` + `#zoom-percent`; behavior-test seams driveable |
| **SC2** — Print / Save-as-PDF | ✅ Met (manual) | Flight 1; OS-native dialog is outside the in-app apparatus (manual verification) |
| **SC3** — Spellcheck | ⚠️ Met, partially verified | Flight 4 shipped; the squiggle paint + native `NSSpellChecker` suggestions are macOS-authoritative; `spellcheck.md` spec still `draft` (WSLg-runnable rows un-run) |
| **SC4** — Find in page | ✅ Met | Flight 2; mid-flight rebuilt to the renderer-route (`found-in-page` not delivered to the main-process guest `webContents` — Deviation D1) |
| **SC5** — First-class DevTools | ✅ Met (detached) | Flight 3; pinnable button + `F12`/`Ctrl+Shift+I`. Docked-in-window is impossible pre-`WebContentsView` (guest has no native host region) — shipped detached, the single change point at `src/main/devtools.js:36` |
| **SC6** — Custom page context menu | ⚠️ Met, partially verified | Flight 4; on-brand keyboard-operable menu, native toolbar menu retired; `page-context-menu.md` spec still `draft` |
| **SC7** — Downloads surface | ✅ Met | Flight 5; app-level persisted surface + `downloadsList` tool; 3 real defects caught + fixed at HAT |
| **SC8** — Agent parity (MCP) | ✅ Met | Every convenience landed an MCP tool via a *shared code path* (no parallel impl); tool count 21→27; gating inherited wholesale, never widened — no parity drift |
| **SC9** — MCP schema hygiene | ✅ Met | Flight 6; `pressKey` `anyOf` flattened + a **standing schema-hygiene test** (cannot-regress, count-agnostic) |
| **SC10** — Side-panel animation polish (#27) | ❌ **Not met — deferred** | Flight 6; reverted at HAT after 3 mechanism attempts. Structural: Electron `<webview>` native surface mis-positions on DOM-layout-change under WSLg. **Downstream of the `WebContentsView` migration**, not a CSS fix |

**9 of 10 criteria met.** SC10 is the lone miss, and it failed for a *structural* reason rather than an
execution one — it is carried as known debt (operator decision, this debrief), tied to the `WebContentsView`
migration rather than reopened as a polish flight.

### Overall Outcome
**The mission delivered its stated outcome** — Goldfinch gained the table-stakes browser conveniences
(zoom, print/PDF, find, first-class DevTools, custom context menu, spellcheck, downloads surface) it
conspicuously lacked, each built natively on the Electron/`webContents` primitives and each extended to the
automation surface (agent parity held cleanly across all six flights). The codebase came out **structurally
healthier than it went in** — the automation engine's injected-dependency discipline, the internal-page
trust model (now multi-origin), and the standing-invariant test convention were all hardened. The one
unclosed criterion (SC10) is honest debt with a clear cause and a clear home.

## Flight Summary
| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1 — Core conveniences (zoom & print) | completed | SC1 + SC2(part) + SC8(part). Live dual-key run surfaced the `WCID_FIRST_OPS` jar-scope gap → produced the first standing-invariant test |
| 2 — Find in page | completed | SC4 + SC8(part). Deviation D1: rebuilt to the renderer-route after `found-in-page` wasn't delivered to the guest `webContents` (first `<webview>` boundary hit) |
| 3 — First-class DevTools | completed | SC5 + SC8(part). DevTools detached-only — docked needs `WebContentsView` (second `<webview>` boundary hit); macOS apparatus first flagged as deferred |
| 4 — Context menu + spellcheck | completed | SC6 + SC3 + SC8(part). Native toolbar menu retired; `menuController` graduation nominated; 2 specs left `draft` |
| 5 — Downloads surface | completed | SC7 + SC8(part). App-level persisted store behind a repo interface; `menuController` graduated; HAT caught 3 real defects |
| 6 — Polish & MCP hygiene | completed | SC9 met (+ settings cleanup, downloads refactor, app icon); **SC10/#27 reverted/deferred** (third+ `<webview>` boundary hit); HAT caught it pre-merge |

## What Went Well
- **Agent-parity (SC8) held cleanly across the whole mission with zero drift.** Each convenience landed its
  MCP tool via a shared code path, not a parallel implementation (DevTools is the model: one `setDevTools`
  mechanic, two entries). The gating model was inherited wholesale and never widened. The dual-surface
  discipline even *caught* coupling bugs early (F1's jar-scope gap).
- **The standing-invariant CI guard became an established, healthy convention** — two instances now (F1's
  `WCID_FIRST_OPS` membership-equality test; F6's count-agnostic schema-hygiene test). Both convert a
  one-time fix into a cannot-regress invariant. This is the mission's best reusable pattern.
- **The electron-free injected-dependency module pattern stayed consistent and deepened** —
  `settings-store` → `downloads-store`/`downloads-manager` → F6's `downloads-payload.js` accessor-injection
  refinement (inject a live object's *reads* so they're unit-testable, not just transforms). The repo-interface
  seams are real (verified), keeping the future SQLite swap a one-module change.
- **HAT verification repeatedly earned its keep on native-surface work** — F2's behavior test caught an
  architectural defect that two design reviews + a green unit suite missed; F5's HAT caught 3 real download
  defects; F6's HAT caught the #27 regression *before merge*. Where the apparatus runs, it delivers.
- **The divert criterion made the hardest moment (the #27 revert) clean, not a thrash.** Because the F6 spec
  pre-authorized "descope if it needs a structural change bigger than a polish leg warrants," the operator
  could revert in full at HAT without it reading as failure. Risk isolation (legs 2–6 shared no files with
  the risky leg 1) meant the collapse cost the four mechanical wins nothing.
- **Security improved, not just maintained** — the internal-page trust seam generalized single→multi-origin
  without weakening; the previously-ungated privileged internal IPC was closed (F5/F6); id-resolution closes
  an arbitrary-file-open vector by construction.

## What Could Be Improved
- **The `<webview>` native-surface boundary is the mission's defining structural constraint — and it kept
  surfacing as feature bugs rather than being treated as one architectural fact.** It bit four times (F2
  find-delivery, F3 DevTools-docking, F2/F6 compositing) with the same shape: "DOM/CSS correct, native
  surface wrong." Each was worked around per-flight; only at F6 was the pattern named and documented
  (`CLAUDE.md` gotcha bullet). Recognizing it as *one constraint* earlier would have reframed #27 (and
  DevTools docking) as migration-gated from the start.
- **The macOS verification apparatus was deferred every flight and is now the most important *unaddressed*
  gap — 4 macOS-authoritative specs deep** (DevTools CDP conflict, spellcheck squiggle/native suggestions,
  context-menu materialization, #27 compositing). "macOS-authoritative" has functionally meant "permanently
  deferred" because there is no macOS venue in the loop. This gates the *verification* of already-shipped
  features and is a prerequisite for verifying any future `WebContentsView` work.
- **Behavior-test debt accumulated** — `page-context-menu.md` and `spellcheck.md` have been `draft` since
  Flight 4, carried unchanged through F5 and F6; three `SKELETON-PENDING-HAT-RUN.md` placeholder run-logs are
  committed (a confusing draft-spec + empty-run-log state). The apparatus isn't failing — HAT sessions kept
  getting consumed by higher-priority diverts (esp. F6's #27). A dedicated debt-clearing pass is a real quick win.
- **#27 specifically cost a full leg build-and-revert that a ~30-min spike would have prevented.** The
  `<webview>` compositing failure was *auditable in advance* — the mission's own Known Issues already
  recorded the failure mode twice. The premise (apparatus/environment axis) wasn't audited before committing
  a 473-line, twice-reviewed leg.

## Lessons Learned
- **"CSS/DOM correctness ⇒ correct render" is false for `<webview>` under this stack.** Now corroborated five
  times across M03–M04. Must be a stated, audited assumption for any flight touching the webview region —
  documented in `CLAUDE.md`, but the *practice* (below) needs to be a named gate.
- **Native-surface work has a blocking apparatus/environment premise, dischargeable only by a cheap empirical
  spike.** Reasoning about the DOM layer is necessary but provably insufficient; the acceptance signal is the
  *rendered* surface, observed. This is the mission's top methodology takeaway.
- **A decided verification venue must exist for each authoritative environment.** Deferring "macOS-authoritative"
  without a macOS venue doesn't defer the work — it abandons it. Verification apparatus is infrastructure,
  not a per-flight afterthought.
- **Standing-invariant registry tests + accessor-injection are proven, promotable conventions** — they should
  be default tools in leg design, not rediscovered per flight.
- **Internal-page UI is a permanent HAT-only verification class** (3 flights confirm the automation surface
  can't read the internal session's DOM); plan its HAT as load-bearing from day one.

## Methodology Feedback
- **The flight skill's "premise-audit the apparatus on both axes" guidance exists but was not applied to
  DD1's environment axis.** The methodology was right; the gap was application. Recommendation: make
  "premise-audit-with-a-spike for native-surface / environment-sensitive work" a **named, blocking
  flight-design gate**, not just prose — the cost asymmetry (30-min spike vs. a leg's build+revert) justifies
  a hard gate.
- **The divert criterion is a high-value spec element and worked exactly as intended.** Every risky/uncertain
  leg should carry one; reinforce it in the flight skill.
- **The mission/flight/leg hierarchy + deferred-commit `/agentic-workflow` model held up well** across 6
  flights — per-leg design review caught real issues before implementation (e.g. F6's accessor-injection
  correction at planning), and the single flight-level review/commit kept overhead low. The HAT leg, when run
  (F5, F6), was decisive. The friction was workflow discipline (draft specs left un-run), not the structure.
- **Recurring cross-flight recommendations should escalate faster.** The macOS apparatus was the #1
  recommendation in 4 consecutive flight debriefs without resolution — a mission-level item raised per-flight
  has no owner until mission-debrief. Consider a lightweight "standing cross-flight action" register the
  flight skill checks, so a thrice-repeated recommendation forces a decision rather than re-deferring.

## Action Items
- [x] Mark Mission 04 `completed` (this debrief); SC10 carried as known debt.
- [ ] **Decide the macOS verification apparatus** (periodic mac session / mac CI runner / explicit operator
  mac-pass gate) — the highest-priority *unaddressed* structural item; prerequisite for closing the 4
  macOS-authoritative specs and for verifying any `WebContentsView` work. Owner: `/routine-maintenance`.
- [ ] **Clear the behavior-test debt** — run `page-context-menu` + `spellcheck` (`draft→active`) and the
  hardened `downloads-surface` re-run; resolve the committed SKELETON run-logs. Bounded quick win.
- [ ] **Evaluate the `WebContentsView` migration as a strong candidate next mission** (NOT committed here —
  next-mission call deferred to a separate planning conversation, operator decision). It is the convergence
  point of 5 cross-mission data points and unblocks #27/SC10, docked DevTools, find-directness, and stronger
  extensions; the automation engine (addresses `webContents` by id) largely survives it. **Mandatory first
  step: a spike** (`WebContentsView` + `BaseWindow` on Electron ^42 — validate frameless + drag-region +
  panel-overlay-as-native-view) before any commitment; re-verify renderer-consumed `<webview>` events
  (`found-in-page` is migration-fragile). Decide the macOS apparatus alongside it.
- [ ] **#27 / SC10** — do NOT re-attempt as a CSS leg. Re-attempt only on macOS/Windows gated by an
  on-platform `<webview>`-compositing spike, or (cleaner) after the `WebContentsView` migration when panel
  composition becomes main-process view geometry.
- [ ] **Promote two patterns to stated flight/leg-design conventions**: the standing-invariant registry test
  (next candidates: `INTERNAL_ORIGINS↔INTERNAL_HOSTS` parity; the admin-only-façade-refusal idiom, now 3
  instances) and accessor-injection for live-Electron-object reads.
- [ ] **Write the one missing pattern doc**: "ops that observe `<webview>` events use the renderer route" in
  `docs/mcp-automation.md` (the lone pattern-inconsistency: `find.js` vs the main-side ops).
- [ ] **Cosmetic sweep** (`/routine-maintenance`): `Ctrl+M`/custom-app-menu (bundle with a keybinding pass);
  `goldfinch_mono.png` orphan (wire or delete); `build/icon.png` 1024 master; duplicated `ZOOM_MIN/MAX`
  (extract to `src/shared/`); `find.js` cold-start retry (gate on a macOS run); stale leg-text scrubs.
- [ ] **SQLite storage migration** (seeded) — lower urgency; sequence *with* the browsing-history mission,
  after `WebContentsView`. The `downloads-store` repo interface already makes it a one-module swap.
