# Flight Debrief: Keyboard Tab Navigation Parity

**Date**: 2026-07-14
**Flight**: [Keyboard Tab Navigation Parity](flight.md)
**Status**: landed
**Duration**: 2026-07-14 (single session: design → two legs → review fix
cycle → land)
**Legs Completed**: 2 of 2 (+ one FD-ruled fix cycle outside the leg
structure)

## Outcome Assessment

### Objectives Achieved

Full keyboard tab-navigation parity landed: `Ctrl+Tab`/`Ctrl+Shift+Tab` and
`Ctrl+PgDn`/`Ctrl+PgUp` cycle visual order with wrap; `Ctrl+1..8` jump;
`Ctrl+9` jumps to last — global, from all three capture points, with
AltGr-safe digits and AZERTY shift-tolerance. The `tab-cycling` spec passed
11/11 on its first run; the DD5 doc-pass rider closed the two-flight-old
CLAUDE.md debt; README's shortcut table completed (including a Flight-2
chord it had also been missing). PR #86 (stacked #84 ← #85 ← #86).

### Mission Criteria Advanced

- SC4 (cycle and jump from the keyboard, chrome or web content) — **fully
  advanced**, behavior-test-backed.

## What Went Well

- **The review-tier partition earned both tiers' keep, cleanly.** The
  flight-level design review caught the *semantic/premise* class before any
  code existed (AltGr/i18n, the address-replace premise correction, the
  sheet-test loop-pin landmine) — all held through implementation with zero
  leg-time deviations. The flight-end Reviewer caught the *drift* class the
  design review structurally cannot (README table gap + a second gap from
  Flight 2, a stale comment made false by the very change beside it, and
  one real behavioral bug — the auto-repeat divergence). Neither tier
  duplicated the other.
- **The one-classifier extension path proved itself a third time** — no new
  plumbing; the sheet hand-mirror was updated in lockstep as ruled.
- **The doc-pass rider mechanism worked**: four topics of debt from two
  prior flights + this flight's own keyboard map landed as one verified
  CLAUDE.md subsection — validating the F2 debrief's recommendation as a
  standard mechanism for cross-flight documentation debt.
- **Scope self-assessment was accurate**: renderer.js grew +37 lines against
  the flight's own "~30 lines" estimate (3510 → 3547).

## What Could Be Improved

### Process

- **Edge-Case rulings must be traced against every capture point's EXISTING
  guards.** The flight's one real behavioral miss (auto-repeat suppressed
  under guest focus) came from an Edge Cases ruling ("do NOT add an
  isAutoRepeat guard") that was checked only against the path being coded —
  the pre-existing blanket guard in `handleGuestChromeShortcut` was never
  enumerated. AUTHORING/leg-design note: an explicit "no guard" ruling
  requires an inventory of guards already present on every affected path.
- **"11/11 first run" needs honest framing**: two of eleven steps required
  live correction to be dispositive (Step 5's KEY_MAP substitution; Step
  8's improvised discriminating rerun). Both were handled correctly and
  recorded — but spec maturity claims should cite the deviations.

### Technical

- **The classifier hand-mirror is a linearly growing liability.**
  `sheet-accelerator.js` and `keydown-action.js` now duplicate the action
  table AND the alt/shift i18n semantics. Three lockstep updates have
  landed incident-free, but that measures review vigilance, not structure.
  **Disposition: BACKLOG/maintenance entry now** (unify via a shared
  mapping table or a shared-subset call) rather than another prose carry.
- **`isRepeatSafeAction`'s `tab-*` prefix carve-out is wider than needed**
  (only next/prev require it); a future non-idempotent `tab-*` action would
  silently classify repeat-safe. Comment flags it; known-issues note.
- **KEY_MAP lacks PageDown/PageUp** — small, self-contained
  automation-surface fix; route to the next maintenance pass; then upgrade
  `tab-cycling` Step 5 to the real keys.

### Documentation

- None owed — the rider mechanism cleared the ledger this flight. Flight 4's
  design decides whether the hand-mirror unification becomes its rider or a
  maintenance entry (recommend maintenance — it is code, not docs).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Fix cycle ran outside the leg structure (no new leg) | Three review findings, all cheap; FD-ruled | Yes — established pattern (pre-commit fix cycle on the flight branch) |
| Step 5 exercised Ctrl+Tab instead of PgDn/PgUp | pressKey KEY_MAP gap (apparatus, not product) | Documented in the spec; upgrade when the KEY_MAP lands |
| Step 8 gained a discriminating rerun mid-run | Prescribed sequence left the jump target already active | Yes — spec revision: activate a neutral tab between reorder and jump |

## Key Learnings

1. **Test metrics**: 1622/1622, 13 suites, ~1.08s, zero flakes. +57 vs
   flight 2 (1565): +39 leg-1 classifier/allowlist/sheet pins, +18
   fix-cycle `isRepeatSafeAction` pins — fully attributed.
2. **Review-tier economics** (for the mission debrief): design review =
   premise/semantic catches pre-code; flight-end review = drift catches
   post-code (docs/comments/adjacent guards). Plan both; skip per-leg review
   when the flight-level review already did the line-level audit.
3. **Apparatus facts recorded**: `evaluate` refused on the internal session
   even for admin (policy); `document.hasFocus()` unsatisfiable under WSLg
   (use delivery-by-construction + negative controls); KEY_MAP gap above.

## Recommendations

1. **Flight 4 (closed-tab stack + Ctrl+Shift+T)**: retire the reservation
   properly — flip the null-pins in BOTH classifier test files and the
   sheet mirror in lockstep (call it out in the leg spec preemptively).
   Decide early whether reopen is guest-forwardable and whether
   `INTERNAL_CHROME_ACTIONS` gets it. The action's dispatch is the first
   with a main-process side effect (stack mutation + possibly persistence)
   — check it fits `dispatchChromeAction` or needs new wiring, at design.
2. **Flight 4 pre-leg-1 spike** (the F2 lesson applied): live round-trip of
   `navigationHistory.getAllEntries()` → JSON persist → `restore()` across
   an app restart — the one unverified premise in Flight 4's inputs
   (`pageState` size/fidelity is exactly the kind of thing to probe first).
3. **Copy disciplines, not schemas**: `downloads-store.js` (bounded
   array-of-records, atomic rename, corrupt→empty recovery, injected path)
   for the stack's persistence; `history-recorder.js`'s positive
   jar-allowlist for burner exclusion (the reference implementation exists
   one file away).
4. **Open the maintenance ledger now**: BACKLOG entries for (a) classifier
   hand-mirror unification, (b) KEY_MAP PageDown/PageUp, (c) the
   `isRepeatSafeAction` scope note — stop carrying them as debrief prose.
5. **Flight-end Reviewer standing instruction**: include a README-table
   audit and a stale-comment grep — this flight proved both catch real
   drift.

## Action Items

- [ ] Flight 4 design: reservation-retirement lockstep note; guest/internal
      forwardability ruling; dispatch-shape check; pre-leg-1 nav-history
      spike.
- [ ] BACKLOG: hand-mirror unification; KEY_MAP PgDn/PgUp;
      isRepeatSafeAction scope note. (Next flight's Developer adds them —
      BACKLOG edits ride flights, not debriefs.)
- [ ] Mission debrief carry: review-tier economics; rider mechanism
      validation; Edge-Case guard-inventory rule.
