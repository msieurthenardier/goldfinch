# Flight Debrief: Popup & Opener Ruling + Implementation

**Date**: 2026-07-28
**Flight**: [Popup & Opener Ruling + Implementation](flight.md)
**Status**: landed
**Duration**: 2026-07-27 → 2026-07-28 (autonomous run; one human gate)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The mission-gated human ruling was obtained on a spike-grounded proposal (**Option B — real BrowserWindow popups**; the recommendation, A, was declined with costs surfaced), and B was implemented faithfully with the parity bill paid in full: qualifying popups open as native windows with a live opener and the opener's jar session; challenges route/present/cancel through the store with the exactly-once ledger intact; census + jar addressability landed at the DD8 gate via `isPopupWcId` only; self-close (the spike's silent no-op) works end to end; guest-shape nav guards pinned sharper than parity (popup refuses `file:`). Commit `6d5f8d8` (43 files, +2533); stacked draft PR #142; 3089 tests (+96), lint/typecheck clean; independent flight-wide review `[HANDOFF:confirmed]` with zero blocking issues.

### Mission Criteria Advanced

The ruling criterion (human-approved with parity checklist) is **satisfiable from artifacts alone and closes now**. The OAuth-fixture, census-visibility, and live-GitHub criteria await the HAT bundle (below).

## What Went Well

- **Premise-check-first, again**: the pre-flight spike bought the adopt-hook wedge taboo (catastrophic to find in-flight — silent permanent renderer wedge), the partition-override-ignored fact, and the preload/self-close chain; both in-leg checks were favorable, and check #1's payoff was *code not written* (the DD1c fallback stayed unused, `app-lifecycle.js` untouched and byte-pinned). Instance-identity discipline (F1's lesson) applied throughout; the port-49717 WSL2 anomaly validated binds-exactly-or-fails-loudly.
- **Risk-tiered design review kept its 100% hit rate**: the DD3 disposition axis (middle-clicks would have become popups), popup-originated `window.open` resolution ("forgot password" links would vanish), the DD1b eligibility decoupling (approved rule strands challenges on a dead opener), cancel-on-rekey, and `plugins:true` parity — all caught pre-code. Zero implementation deviations from reviewed specs across both legs.
- **House tripwires worked**: the raw-`closed` teardown registration was refused by the pre-existing invariant test; the renderer budget pin fired on draft comments and forced net-zero (DD5 held — no third ratchet).
- **The declined-recommendation ruling was well-served**: implementation delivered B's actual upside while paying every mission-critical parity row; costs matched the proposal's pricing with zero mid-flight surprises.

## What Could Be Improved

### Process
- **Price non-recommended options to comparable depth when a decline is plausible.** B lacked an A-style parity checklist, so DD1a–f had to be derived post-ruling — good work, but work the proposal could have pre-paid. A proposal's recommendation should not concentrate its rigor.
- **Delegated-latitude boundary stretched**: DD1b's eligibility refinement *replaced* an approved sub-clause (vs DD3's narrowing). Correct call, correctly logged — the mission debrief should ratify "replace a wrong approved sub-rule, log it, don't re-open the ruling" as the intended shape.
- Leg lifecycle vocabulary (`landed` header vs "set to completed" checklist) persists from F1 — still no agreed convention; the mechanical flight-close artifact lint remains unbuilt.

### Technical
- **The popup registry is a permanent parallel-to-tabViews structure**: every future guest-facing feature now has a possible silent-popup-gap state. Pins protect what exists, not what's added next. **Standing rule recommended: any flight adding guest-facing wiring carries an explicit "popups: in scope / named-out" line in its DDs** (like the internal-vs-web classification today).
- **goldfinch CLAUDE.md doesn't know popups exist** — README and mcp-automation.md were updated, but the architecture file says nothing about the window class, registry, DD2 taboo, or DD3 predicate. Add a popup subsection (HAT or next maintenance).
- renderer.js at 1765/1766 — extraction is now effectively a **pre-flight prerequisite** for anything touching renderer.js.
- Exact-literal main.js source pins should normalize toward the regex-within-block form when next touched (formatting-pass brittleness).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD3 disposition conjunction (refines approved predicate) | Middle-click/named-link capture; delegated latitude | Yes — the predicate gap existed in the proposal's shared scope guard (would have hit A too) |
| DD1b eligibility replacement | Approved rule conceptually wrong + strands challenges | Ratify the latitude shape at mission debrief |
| Cancel-on-rekey over challenge migration | Tab parity, zero reshaping | Yes |
| Seam signature `(entry)`→`(popupWcId)` | Leg-02 spec precision | Trivial |

## Key Learnings

1. **Premise checks whose payoff is unwritten code** are as valuable as ones that gate written code — budget for them.
2. A parallel registry to a core structure (tabViews) converts structural guarantees into convention+pins — sustainable only with a mandatory per-flight classification line.
3. Named-consequence pinning (featureless-named → tab, unit-pinned) is cheap insurance against HAT "bug" reports for by-design behavior.
4. The Electron-bump standing tax grows three popup premises: latch-timing order, posture-under-override, partition-override-ignored (plus the disposition classification semantics) — all observed-not-documented behaviors.

## Recommendations

1. **HAT (Flight 3) inventory confirmed — seven items, in order**: `web-compat-fullscreen` (still first: zero live evidence, render-correctness class) → `web-compat-basic-auth` + `vaultAnswerAuth` + vault-login re-run → `web-compat-client-cert` (install `libnss3-tools`) → `web-compat-pdf` → **`web-compat-oauth-popup`** (core jar-runnable; census steps admin-tier) → **live GitHub OAuth witnessed run**. Plus human-judgment probes: popup feel/focus-return, the named-accepted input gaps (Ctrl+L/T/F/J, context menu), DD1f close-with-opener, popup-marker copy on glass, the DD3 named-no-features probe, burner-popup admin-only census.
2. Add the CLAUDE.md popup subsection; adopt the "popups: in scope / named-out" DD rule; schedule renderer.js extraction as a prerequisite.
3. Maintenance queue additions: source-pin normalization; Electron-bump tax entries.

## Action Items

- [ ] HAT: run the seven-item bundle (admin-keyed session; order above) + human-judgment probes
- [ ] CLAUDE.md popup subsection (HAT or maintenance)
- [ ] Methodology: "popups in-scope/named-out" DD line for guest-facing flights; ratify delegated-latitude shape at mission debrief
- [ ] Maintenance: renderer.js extraction (pre-flight prerequisite status); pin-form normalization; Electron-bump tax entries

## Test Suite Timing

3089 pass / 0 fail / 0 skipped, no flakes; ~2795 ms runner-internal (flat vs F1's ~2815 ms at +96 tests; count remains the comparable metric). Ledger: 2993 → 3025 (leg 01) → 3089 (leg 02), matching flight-log claims. No new slow-test class; pre-existing crypto suites remain the tail.
