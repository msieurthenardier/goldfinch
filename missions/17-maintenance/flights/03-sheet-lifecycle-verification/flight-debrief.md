# Flight Debrief: Sheet Lifecycle Verification

**Date**: 2026-08-29
**Flight**: [Sheet Lifecycle Verification](flight.md)
**Status**: landed
**Duration**: 2026-08-28 (design ruling → land, single session) — debrief 2026-08-29
**Legs Completed**: 2 of 2 (+ the design-ruling leg `sheet-verification-design`)

## Outcome Assessment

### Objectives Achieved

Executable verification now sits under the menu-overlay sheet layer that had
almost none: `createSheetEntry` was extracted into the importable
`src/shared/modal-card-controller.js`, **all 19** `menuController.register` sites
were converted (0 left raw), the F23 duplication was removed, and each of the
three secret-show sheets' scrub was relocated into an importable template
`scrub()` closure pinned **red-on-delete**. The automation read surface was not
touched — `resolve.js` / `AUTOMATABLE_MENU_TYPES` are byte-for-byte unchanged, so
Flight 2's secret-sheet wall is intact. All gates green (see metrics).

**Honest scope of "verification" (record this as a deliberately-deferred gap,
not a closed one).** Criterion 5 ("no sheet verified by source-text presence
alone") is met at the **shared-envelope + secret-scrub level**: the
`createSheetEntry` composition order is unit-tested once generically, and the
three `scrub()` closures are red-on-delete tested against real importable code.
But each sheet's **sheet-specific `onOpen`/`onClose` middle** (e.g. `suggestions`
never-focus-on-open, the pickers' roving `startIndex` consumption, `input-dialog`
value-clear-before-unhide) still lives inside the un-importable 2761-line
`menu-overlay.js` IIFE and is exercised by no unit test. Rendered-state /
screenshot verification of the non-secret sheets (downloads, auth-basic,
cert-picker) — the coverage only the cut Lever A could have provided — remains
absent. This was the correct trade given the secret-exposure risk of widening the
sheet allowlist, but a future flight must not assume these sheets are
behaviorally covered.

### Mission Criteria Advanced

- **Criterion 5** (sheet lifecycles have executable verification; no sheet
  verified by source-text presence alone — F14, F23) — advanced at the
  envelope + secret-scrub level, with the per-sheet-middle gap recorded above.

## What Went Well

- **The lever ruling was the flight's real work, and the process produced the
  right call.** A deep security-model walkthrough (the sheet lock is a third gate
  independent of the admin and jar tiers; admin's `allowInternal` does not lift
  it; a jar agent fills via `answerAuth` and never reads sheets; widening the
  allowlist for secret sheets would let automation screenshot master-password
  plaintext) led to Lever B and the cutting of Lever A — avoiding a reopening of
  Flight 2's exposure, a new launch-flag surface, and the recurring behavior-test
  flake.
- **Two-cycle design review caught an unsatisfiable acceptance criterion before
  any code was written** (see Key Learnings) — the highest-value catch of the
  flight.
- **The extraction is a genuinely good structural change.** 19 hand-rolled
  register sites → one injected-deps ESM factory that owns only the invariant
  edges (hide + trailing `reportDismissed`) and delegates the variadic middle to
  hooks; the roving `startIndex`/`-1` path is forwarded; `lastStimulus` is left
  alone. Relocating the secret scrub into template `scrub()` closures *increased*
  cohesion (each secret's clearing sits with its display nodes) and made
  red-on-delete testability possible.
- **Independent flight-end review traced behavior preservation across all 19
  sites** and re-verified the security invariants.

## What Could Be Improved

### Process

- **An unverified test count propagated into committed artifacts.** "3988/3988"
  originated in the Leg 1 Developer's report and was repeated by the flight-end
  Reviewer, the flight log, both leg outcomes, the commit message, and the PR —
  none measured it. The debrief Developer measured **3982** twice and the FD
  confirmed it directly (`npm test` → 3982 pass; 3966 parent + net-16 new tests =
  3982). A reported metric that lands in a commit must be measured by the
  reporter, not relayed. (Corrected in the flight log and leg outcomes; the commit
  message keeps 3988 as immutable history.)
- **When a lever is cut mid-flight, strike its verification promises.** The
  flight's Post-Flight Verification block still promises "the `downloads` and
  `auth-basic` run logs dated after this flight" — a Lever A step. Lever A was
  cut; those logs were never produced. CP3 self-marked N/A but the Verification
  prose was not reconciled.

### Technical

- **Line-number and count citations in a flight-level Technical Approach are
  liabilities.** The spec's `register`-site line numbers had drifted and its
  "21 attachModalCard" was a raw grep line-count (true call sites: 12); Leg 1 had
  to re-derive both. Prefer greppable anchors (symbol names, `/* template: X */`
  labels) over absolute line numbers in specs.
- **The `sheet-automation-gate-invariant.test.js` AC8 pin is a brittle
  source-scan** coupled to caller-side local names (`recovery`/`accessKey`/
  `adminKey`). It had to be retargeted when the seam moved and is now doubly
  pinned (source-scan needle + template test). Flight 4 may be able to retire the
  grep pin in favor of the red-on-delete template tests + a structural assertion.
- **19× injected-dep repetition** — `register: menuController.register` +
  `reportDismissed` are hand-repeated at every call. A thin per-file
  `const sheet = (o) => createSheetEntry({ register: menuController.register, reportDismissed, ...o })`
  partial would collapse it. Intentional for injectability, but an easy follow-on.

### Documentation

- **F34 is only partially paid.** The chrome-indicator subsection and the
  `createSheetEntry` naming landed; F34 still owes the **popup** and **drag**
  subsystem subsections — carried forward to the next flight touching those files
  (per the 2026-08-27 report's own recommendation).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `sheet-automation-gate-invariant.test.js` AC8 needles retargeted (beyond the leg's enumerated Files Affected) | The scrub moved from inline `textContent=''` to `refs.scrub()`; the co-residency pin had to follow the seam | No — mechanical follow; the invariant is now better-covered (call-site pin + red-on-delete template tests) |
| Scrub-comment DD citations corrected `(DD5)`/`(DD4)` → `(M15 F3 DD1f)` across 5 files (post-review fix) | Leg 1 Developer invented non-existent Flight-3 DD numbers; the real provenance is the M15 F3 DD1f eager-close-scrub invariant | No — one-off correctness fix |
| Test-count of record corrected 3988 → 3982 (flight log + leg outcomes) | 3988 was never measured; canonical `npm test` yields 3982 | Yes — measure metrics before they enter an artifact |

## Key Learnings

- **Audit the testability premise at design time — before writing the acceptance
  criterion.** Leg 1's original criterion 4 asked a mock-node factory test to go
  red when the *real sheet's* scrub was deleted. Unsatisfiable: a factory test can
  only assert the factory invokes the `onClose` it was handed; the actual clearing
  lived in the un-importable IIFE. The fix was to *move the behavior to an
  importable seam first* (the template `scrub()` closure). Every red-on-delete or
  characterization criterion should carry an explicit check at design: **what
  module does the asserting test import, and can it see the thing it claims to
  pin?** A criterion that asserts a behavior in an un-importable module cannot be
  satisfied no matter how the implementer tries.
- **The un-importable IIFE is the ceiling on this whole area.** `createSheetEntry`
  is now the seam that makes a future per-sheet-module split incremental rather
  than a big-bang rewrite — that split is the enabling refactor for true per-sheet
  lifecycle tests and for behavior-testing the focus/roving sheets.
- **Extraction + relocation-to-importable-seam is a repeatable recipe** for
  putting tests under untestable-by-construction code: pull the invariant edges
  into an injected-deps factory, and move any security-relevant inline behavior
  into a co-located importable closure that a red-on-delete test can reach.

## Recommendations

1. **Correct the metric of record to 3982** (done in-artifact) and keep the
   recurring behavior-test flake on standing watch — it did **not** reproduce
   across two full runs this flight; the next red-then-green run should still
   capture it.
2. **Adopt a design-time testability-premise audit** for red-on-delete /
   characterization criteria ("what does the asserting test import, and can it
   observe what it pins?"). This is a mission-control *methodology* candidate, not
   a goldfinch code change — recorded here for the next methodology review.
3. **Standardize `createSheetEntry` as the required path** for any new sheet
   (state it as a rule in CLAUDE.md's Menu-overlay sheet section) so the
   extraction doesn't erode on the next sheet added; optionally collapse the 19×
   injected-dep repetition with a thin `sheet()` partial.
4. **Record the deferred verification gap** (per-sheet behavioral middles +
   rendered-state verification of the non-secret sheets: `suggestions`,
   `vault-picker`, `cert-picker`, page-context `menu`). The path to closing it is
   (a) split `menu-overlay.js` into importable per-sheet modules, and/or (b)
   behavior-test the focus/roving sheets once the flake is identified.
5. **Reconcile the flight spec's stale Lever-A residue** (Technical Approach line
   numbers/counts; Post-Flight Verification's downloads/auth-basic run-log
   promise) so the artifact reads consistently with the Lever-B outcome.
6. **The deferred god-mode feature flight is a single atomic capability**: the
   secret-wall lift must ship *with* an enforced-isolation gate (a real refusal on
   any non-isolated/packaged context, at least as strong as the wall it removes),
   a tested key-revocation kill switch, and an "all-access" indicator built as a
   fourth instance of the chrome-indicator `build*IndicatorModel` pattern — never
   the read-surface widening alone.

## Action Items

- [x] Correct 3988 → 3982 in the flight log and leg outcomes (done in the debrief pass)
- [ ] Collapse the 19× `createSheetEntry` injected-dep repetition with a thin per-file `sheet()` partial (squawk candidate — servicing)
- [ ] Reconcile the flight spec's stale Lever-A Technical Approach + Post-Flight Verification text (artifact hygiene)
- [ ] Carry F34's remaining popup + drag CLAUDE.md subsections to the next flight touching those files
- [ ] Standing watch: the recurring transient behavior-test flake (did not reproduce this flight)
- [ ] Methodology (mission-control): add a design-time testability-premise audit to the flight/leg design checklist
