# Mission Debrief: First-Class Tab Management

**Date**: 2026-07-17
**Mission**: [First-Class Tab Management](mission.md)
**Status**: completed
**Duration**: 2026-07-14 – 2026-07-17
**Flights Completed**: 11 of 11
**Released as**: v0.10.0

## Outcome Assessment

### Success Criteria Results

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Strip never scrollbars; progressive shrink to a compact floor, active tab keeps close | Met | F1, container-query staged shrink (zero JS). DD2 amended at the Witnessed run to an active-only 64px floor after the sliver-stage clip. `responsive-tab-strip` evolved. |
| 2 | Pointer reorder with live drop indicator; never fights the window-move drag zone | Met | F2 built the pointer drag + `dragPointer` op two flights early; F11 folded it into the unified native-DnD gesture. |
| 3 | Every pointer gesture has a keyboard equivalent; existing tablist contract holds | Met | F2 keyboard reorder; `tab-keyboard-operability` extended and green throughout. |
| 4 | Cycle + jump from the keyboard, from chrome and page content | Met | F3, full Ctrl+Tab/PgDn/1..9 parity across all three capture points; AltGr/AZERTY-safe. |
| 5 | Reopen a closed tab (address, jar, history where supported); bounded; burners never captured | Met | F4, `Ctrl+Shift+T` reservation went live; nav-history restore spike-verified; burner exclusion by positive allowlist. |
| 6 | Tab context menu from sheet (close/others/right/duplicate/move-to-window/reopen); middle-click closes | Met | F5, near-total pattern reuse, zero product defects, 10/10 first run. |
| 7 | Tab → its own new window by drag and by command; new window is fully functional | Met | Tear-off by drag (F8) + move-to-new-window command (F6); F11 unified tear-off onto native DnD. |
| 8 | Tab dragged between windows moves, keeping jar identity and page state | Met | F11. Transport died at F8 (measured), resurrected at F10 Station C (HTML5 DnD, GO), shipped at F11. **Witnessed live by the operator on X11** (same `wcId`, jar intact, history live). |
| 9 | Multi-window: closing one leaves others working; last-window quit holds; no cross-talk | Met | F6 (registry + lifecycle split) and F7 (per-window overlays; singleton machinery deleted). |
| 10 | Setting-gated session restore; burners excluded; default-off byte-identical | Met | F9 implemented; **live quit→relaunch→restore witnessed by the operator at F10**. |
| 11 | Jar identity + burner ephemerality hold across reorder, reopen, tear-off, drag, restore | Met | Single-sourced `persist-jar-gate` positive allowlist is the sole boundary for both persistence paths. |

The operator ran the full keyed HAT gauntlet on their own rig after F11 — the real `npm run a11y` verdict, the `tab-tearoff` re-run and row 8a, `responsive-tab-strip` Step 5, the first run of `cross-window-drag.md`, and the DD12-repointed spec re-runs — closing every live-verification item the flights had HAT-scoped. No success criterion remains implemented-but-unwitnessed.

### Overall Outcome

The mission delivered its stated outcome in full: working with many tabs in Goldfinch now feels like a mainstream browser — the strip absorbs any count without a scrollbar, tabs go where the operator puts them (reorder, tear-off, cross-window drag) with a keyboard equivalent for every gesture, closed tabs reopen where they left off, opt-in session restore brings the previous session back, and through all of it jar identity travels with the tab and burners stay structurally ephemeral. The mission's deepest risk — cross-window drag transport, which the issue itself mandated a spike for — was measured dead on the WSLg rig at F8, correctly deferred rather than faked, and then genuinely resurrected once a second measurement (F10 Station C) refuted the pessimistic reasoning. Criterion 8 shipping on real HTML5 DnD, witnessed live, is the mission's signature result. The largest structural change since the M05 view migration — the single-window→multi-window shell conversion — landed cleanly across F6/F7 with the singleton machinery deleted rather than left dormant.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 01 — Shrink-to-fit strip | completed | Chrome-style progressive shrink via container queries, zero JS; PR #84 |
| 02 — Tab order model & reorder | completed | DOM order as single authority; pointer + keyboard reorder; PR #85 |
| 03 — Keyboard tab navigation | completed | Full cycle/jump parity across all three capture points; PR #86 |
| 04 — Closed-tab stack & reopen | completed | `Ctrl+Shift+T` live; jar + history + position fidelity; PR #87 |
| 05 — Tab context menu | completed | Sheet-rendered tab menu, near-total reuse, zero product defects; PR #88 |
| 06 — Multi-window shell 1 | completed | Window registry, lifecycle split, live-guest re-parent; PR #89 |
| 07 — Multi-window shell 2 | completed | Per-window overlays (singletons deleted), multi-window automation semantics; PR #90 |
| 08 — Tear-off & cross-window drag | completed | Tear-off by drag + keyboard cross-window move; transport measured dead, criterion 8 deferred honestly; PR #91 |
| 09 — Session restore | completed | Setting-gated restore, single-sourced burner boundary, F8 debts paid; PR #92 |
| 10 — HAT & alignment | completed | Operator-witnessed session restore + 5 alignment fixes; Station C measured HTML5-DnD GO |
| 11 — Cross-window drag | completed | Criterion 8 satisfied via wholesale native-DnD rewrite; provenance-gated adopt; PR #93 |

All eleven PRs were stacked bottom-up and merged to `main` on 2026-07-17, released as v0.10.0. Branches deleted; source issue #82 closed.

## What Went Well

- **Spike-first gating changed or confirmed architecture before every high-risk leg** — F2 (event coalescing), F4 (restore fidelity), F6 (re-parent GO), F10 (DnD GO), F11 (draggable-timing). No flight committed to an unproven mechanism, and the two spikes that mattered most (F8 transport, F10/F11 DnD) each overturned a confident prior belief.
- **Two-pass flight-level design review with embedded rulings was load-bearing** — it caught the most expensive would-be bug in F2, F3, F4, F5, F6, and F9, where round 2 caught a bug that round 1's own fix had introduced. This is the machinery that let most legs run at LOW risk-tier with zero deviations.
- **First-run Witnessed passes were the norm** — F2/F3/F4/F5 all landed their behavior specs green on the first run, and the mission repeatedly corrected its own framing honestly (F3's "11/11" was footnoted as requiring two live corrections rather than claimed clean).
- **Pure-module extraction discipline paid off under rewrite** — `tab-order.js`, `window-census.js`, `move-targets.js`, `session-store.js`, `classifyDragPoint`, and the `persist-jar-gate` predicate stayed testable offline and survived the F11 drag-layer rewrite intact. The positive-allowlist burner boundary and the pure-decision-model / thin-DOM-commit split are the two strongest reusable patterns the mission produced.
- **Honesty under a dead result** — when F8's transport was measured impossible on the rig, the flight re-scoped and recorded criterion 8 UNSATISFIED rather than shipping a capability no user could perform. That honesty is precisely what made the later genuine resurrection legible.

## What Could Be Improved

- **The `main.js` / `renderer.js` god-files grew the whole mission and were never split.** `main.js` went from ~2,994 to ~3,966 lines (+32%); `renderer.js` sits at ~4,194. Both are executed by zero unit tests — behavior is pinned indirectly by source-scan suites, which are now the test-suite's timing tail (they `readFileSync` + comment-mask the god-files rather than run them). The debt was self-diagnosed at F2 and re-flagged at F6, F7 (with a numeric budget that was then blown), F8, and F9 ("six flights unactioned") — the mission closed with it live and larger. The root mechanism: the "pure logic extracted, Electron wiring stays in main.js" policy has no counterbalancing trigger for when the *wiring itself* should be pulled into a testable module.
- **Proxy-substitution / label-over-artifact was the mission's dominant defect class** — F7 unified 13 instances of it, and the same family recurred as F8's coordinate "cached fiction," F9's false recon dynamics claims, and F11's wrong-backend spike. The through-line: a reading taken by an instrument reporting on itself is not verification. Every generation of correction inherited its predecessor's blind spot until the *instrument* changed, not just the care taken.
- **Doc / enumeration drift appeared in every flight F3–F7** despite escalating mechanisms (rider → standing audit → grep-AC). Count and enumeration drift is a distinct class that grep-ACs structurally cannot catch — arity survives even when content corrupts.
- **WSLg apparatus limits repeatedly forced HAT-scoping** — inert focus APIs (F6), coordinate fiction (F8), Wayland drag-cancel (F11). Much of the keyed gauntlet existed only because the dev environment could not witness these behaviors in-session; the operator's rig was the instrument of last resort three times over.
- **One orchestration hygiene lapse recurred** — the FD leaked admin keys via a redaction that missed the JSON mint shape (F10), re-opening the F6 key-leak class. The rule was upgraded to "never print a key-bearing stream at all," but the lapse shows a prose rule alone doesn't hold.

## Lessons Learned

- **A read-back is not a second reading unless it is a second instrument.** F8's most portable product: the cross-window coordinate premise survived two design reviews and died to one `powershell.exe`/Win32 call, because every prior reading had been Electron reporting on Electron. Promote to a recon/spike default for any geometry or coordinate premise.
- **An environment/transport spike must replicate the app's real launch flags.** F10/F11's "boundary death" was the WSLg Wayland backend, not the code — the GO had been measured on bare-Electron X11 while the app runs `--ozone-platform=wayland`. Cost a full flight's drag layer, ripped out and rewritten. Probes should log an environment fingerprint and inherited GOs deserve a fixture-fidelity audit.
- **"No exception thrown" ≠ "the event loop is alive."** F6's window-close hang came from a native-object deref inside a `closed` handler whose throw was swallowed with the process — and the throw *manufactured* the misleading "closed never fires" evidence. A defect can fabricate evidence against its own location, defeating exclusion-based debugging; process-liveness is a behavior-test observable, not an inference.
- **A test row that drives the defective path is not coverage of it — the observable read is.** F8's double-active-tab defect survived every green net because the nets exercised the path without reading the property it corrupted.
- **The provenance-gate pattern** (declare-at-dragstart / verify-sender-owns-`wcId` / consume-at-adopt / grace-timer) is the reusable shape for any payload-named-object IPC surface, and the chrome-over-guest overlay `WebContentsView` (F10 L4) is the reusable primitive whenever chrome DOM needs to paint over a guest.

## Methodology Feedback

- **The HAT-gate tension is real and recurred, but is left as an open question here (no ruling).** F9 landed session restore "complete" at 0% runtime verification of its headline behavior; F8 deferred criterion 8 to a downstream flight; both were honest, premise-gated calls, but both let a flight land "complete" while its defining behavior was unwitnessed. The candidate ruling — *a criterion dischargeable only by live HAT is a hard gate inside its landing flight, not deferrable downstream* — is recorded as a tension for a future methodology decision, not adopted. It trades faster flight cadence against later verification-debt pile-up (the very "keyed gauntlet" this mission accumulated), and that trade wants a deliberate call rather than a debrief default.
- **New HIGH-risk trigger, validated by F7:** a leg that authors or rewrites the flight's own verification assertions is HIGH regardless of product-code blast radius — F7's MEDIUM-tiered leg 4 authored the flight's assertions and originated three instrument defects.
- **Prose design review is structurally blind to implementation-fidelity defects** (F6's process-killing deref sat in the most-scrutinized leg). Consider a lightweight code-level pass immediately after high-risk native-lifecycle legs, rather than relying on prose review to catch them.
- **Budget the right unit.** F7's flight-net line target was unactionable and F8 showed the *unit* was wrong — total lines taxes the very comments the methodology demands. Per-leg, code-lines-not-total-lines budgets (F8 DD11, honored in F11) are the working form.
- **Orchestration hygiene rulings that earned their keep this mission:** deferrals must create an AC in the target leg at deferral time, not a prose note (F7's AC27 landed unowned and sat green-but-failing two legs behind its root cause); re-run gates after any flight-end fix, because the commit message is outside the checklist's reach (F8 shipped a commit claiming "a11y green" the log refused); never print a key-bearing stream at all (F10); and `N` failed code-shaped hypotheses should trigger an environment-fidelity probe next (F11).

## Action Items

- [ ] **Module-split maintenance decision (deferred by operator, 2026-07-17).** The `main.js` / `renderer.js` god-file split is recorded as the top compounding debt with a measured second-order cost (source-scan suites are the test-timing tail). Operator will decide maintenance-vs-feature sequencing separately; `/routine-maintenance` is the natural venue to size it with numeric per-file targets.
- [ ] **Document two mission patterns in CLAUDE.md / architecture notes:** the positive-allowlist security-boundary predicate (`persist-jar-gate`) as the template for any future boundary check, and the provenance-gate (declare/verify/consume/grace) for payload-named-object IPC surfaces. F11 also owes a CLAUDE.md note on the native-DnD wiring facts.
- [ ] **`npm run a11y` exit-code collision** (mission Known Issue, quick win): reserve a distinct non-1 exit for "apparatus not configured" so "not run" can never be misread as green or as a real violation.
- [ ] **Retire now-dead code surfaced by the mission:** `tearoff-overlay-manager.js` is consumer-less on the shipped native-DnD path (keep-or-retire call); `getAttachedWindow` / `crossWindow` retirement was unblocked by F7's V7 verdict and deferred twice; remove F11's `[DRAGDIAG]` temp logging if any survived the merge.
- [ ] **Standing maintenance items already in BACKLOG** (surfaced by M09 F3, left intact): classifier hand-mirror unification (`sheet-accelerator.js` / `keydown-action.js`), `pressKey` `KEY_MAP` PageDown/PageUp gap, and the `isRepeatSafeAction` `tab-*` carve-out narrowing. Fold into the next maintenance pass.
- [ ] **Spike-fidelity as a `/flight` prerequisite** (F11 recommendation): environment/transport spikes must replicate real launch flags and log an environment fingerprint before any leg builds on the result.
- [ ] **Packaged-build smoke of criterion 8** (F11 minor): the full-parity cross-window-drag claim rests on the X11 HAT proxy; confirm on a packaged native target when convenient.
