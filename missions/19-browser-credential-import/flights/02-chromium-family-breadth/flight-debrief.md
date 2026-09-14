# Flight Debrief: Chromium Family Breadth

**Date**: 2026-09-14
**Flight**: [Chromium Family Breadth](flight.md)
**Status**: landed
**Duration**: 2026-09-14 (planned + built + HAT in one session)
**Legs Completed**: 3 of 3 (leg 3 the guided HAT, taken)

## Outcome Assessment

### Objectives Achieved

- **Edge comes in on the same pipeline.** A real Edge export was verified
  byte-identical to Chrome's at planning (header `name,url,username,password,note`,
  8 rows exercising the same taxonomy) and re-confirmed LIVE end-to-end in the
  HAT (HE1–HE4) on the full real file. Zero adapter work was needed; the divert
  trigger never fired.
- **The operator is no longer told "Chrome" for a non-Chrome source.** The two
  operator-facing strings, the docs, and CLAUDE.md now read for the Chromium
  family (generalized guidance, no source picker — source is provably
  undetectable from byte-identical content).
- **The thrice-named `vault.js` restore-modal extraction is paid.** `vault.js`
  2820 → 2102 (`split` metric), `VAULT_PAGE_LINE_BUDGET` lowered to 2150 (~48
  lines of locked-in headroom). The restore/export modals now live in a new
  `vault-restore-controller.js`; the page is cleanly three-controller decomposed
  (nav / browser-import / restore) over a thin `vault.js`.

### Mission Criteria Advanced

- **The Chromium family comes in on the same path** — met (Edge verified +
  HAT-confirmed).
- **Docs tell the new truth (Chromium-family half)** — met.
- With Flight 1's Chrome half, all seven non-deferred mission success criteria
  are now met. The operator judged **Mission 19 effectively complete**; Flight 3
  (optional alignment) is discretionary, not a gap. Other Chromium browsers
  (Brave/Opera/Vivaldi) are deliberately deferred until real demand — DD2's
  generalized guidance covers them nominally, and a divergent format fails
  safely into the already-generalized refusal.

All checkpoints CP1–CP3 met (CP1's restore spot-check folded into the HAT).

## What Went Well

- **DD1's verify-the-premise discipline, applied twice.** The Flight 1 debrief's
  "verify a real Edge export before designing" recommendation was followed to
  the letter — checked at planning, re-checked live at the HAT. This is the
  mission's own methodology closing a feedback loop, and it collapsed a
  "family breadth" flight's three divert-risk questions (format divergence,
  blocklist activation, multi-source labeling) into a pure copy-and-docs leg.
- **The two design-review layers caught real pre-code breaks, non-redundantly.**
  The flight-level Architect review caught the `pendingImportRecord` six-site
  coupling, the `openExportModal`/`buildVaultSelect` sharing, and the grep-AC
  precision problem. The leg-1 Developer design review then caught TWO MORE the
  first missed: `pendingNotice` as a second state coupling that would have
  thrown a `ReferenceError` on every export, and a second invariants file whose
  AC13/AC10 would have gone red. Neither substitutes for the other — the
  flight-level review works at design-decision granularity, the leg review at
  the line-level extraction set.
- **The extraction decomposed complexity rather than relocating it.** Both state
  handoffs (`pendingImportRecord` → `heldRecord`, `pendingNotice` → `setNotice`)
  are genuine single-source-of-truth ownership transfers, not thin re-exports.
  The `setNotice` handoff notably was NOT folded into the existing `refresh`
  callback (which would have conflated "recompute view" with "surface a one-shot
  notice") — a good instance of not over-generalizing.
- **CP1 folded into the HAT, honestly.** The no-DOM-harness gap was flagged in
  the log as a live risk rather than silently accepted, and closed with a real
  live-app check (HR1–HR3), which passed with zero HAT fixes.
- **Wall-clock stayed flat** (5.83s) across three flights of accumulation.

## What Could Be Improved

### Process

- **DD4 bundled a large, HIGH-risk behavior-preserving refactor onto a small
  copy-change flight, after its own headroom premise had dissolved.** The log is
  honest about this: Edge needed none of the headroom. It worked out — but only
  because leg 1 got full flight-grade rigor (a dedicated design review, a
  move-not-rewrite diff verification, the flight-end Reviewer, and the HAT
  fold-in). The Architect's "run it as its own maintenance flight, or reorder
  the small leg first" was available in the Adaptation Criteria and not taken.
  The FD's own `git checkout` slip during the leg-to-HAT handoff is a second data
  point (after Flight 1's WSLg restart) that this exact handoff moment is where
  operational friction clusters — a friction a decoupled flight avoids.
- **The citation audit missed the same class of thing three times in a row**
  (Architect review, leg design review, then the running suite). The
  `exportProfile`/`exportVault` invariant scan was caught only by running the
  green bar, despite the leg's audit header claiming "verified." The green bar,
  not the citation list, is the real backstop — the audit step should include
  running the affected suite, not treat it as a fallback.
- **A debt named at two consecutive debriefs (M18 F3, then M19 F1) was only paid
  on the third flight**, and only via an operator ruling to bundle it. A firmer
  rule — auto-schedule such debt as its own leg in the NEXT flight — would remove
  the reliance on bundling unrelated paydown into a feature flight.

### Technical

- **`vault-restore-controller.js` is 855 lines with NO line budget** (vs. its
  330-line sibling). It houses five nontrivial modals and is positioned to become
  the next multi-flight "thrice-named debt" if it accretes unchecked — the exact
  cycle `vault.js` just finished. Cheapest to pin a budget while fresh.
- **Getter-shape inconsistency between the two sibling controllers**:
  `vault-browser-import-controller.js` takes one `getPresence()`;
  `vault-restore-controller.js` takes two `getJarRows()`/`getJarVaultPresence()`.
  Functionally identical, but a third controller has no single precedent to copy
  — pattern drift from copy-by-example rather than copy-by-contract.

### Documentation

- The **injected-deps page-controller extraction pattern** (closure-owned state +
  getter/loader + a single-purpose injected callback for a second coupling) has
  now been used twice with near-identical shape and is written down nowhere — the
  same "demonstrated repeatedly, documented never" gap the Flight 1 debrief
  flagged for `vault-page-model.js`'s pure-extraction pattern (now a logged
  squawk, 0065).

## Test Metrics

`npm test` on landed HEAD: **4436 / 4436 pass, 0 fail, 0 skipped, 13 suites,
wall-clock 5.83s** (`duration_ms` 5478). `typecheck`, `lint`, `format:check`
all clean.

| Flight | Tests | Wall-clock |
|---|---|---|
| M18 F3 | 4294 | ~5.2–5.7 s |
| M19 F1 | 4432 (+138) | 5.76 s |
| **M19 F2 (this)** | **4436 (+4)** | **5.83 s** |

The +4 = +1 (squawk 0064's regression test, landed in the turnaround before this
flight) + leg 2's +3. **Leg 1 — the 854-line extraction — added ZERO net tests**,
correct for a pure verbatim move (it retargeted six pre-existing source-scan
invariants; no new logic to unit-test). Slowest suites unchanged and untouched by
this flight (`vault-compromise-rotate` 2438ms, `vault-txn` 1976ms,
`vault-context` 1454ms, `navigation-controller` 1419ms, `vault-crypto` 971ms).
Wall-clock flat in the mission's standing 5.2–5.8s band.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Errant `git checkout main -- .` reverted the tree pre-HAT | FD slip at the leg→HAT handoff; caught at once, `git reset --hard HEAD` restored cc877d0 exactly, no work lost | No — but note the handoff moment as a friction cluster (2nd data point) |
| One extra invariant scan (`exportProfile`/`exportVault`) retargeted beyond the leg's list | Citation audit missed it; the green bar caught it | Yes — fold "run the affected suite" into the citation audit |
| `vault-restore-controller.js` has no line budget | Followed the sibling precedent (which also has none) | No — the sibling is 330 lines; this is 855; give it a budget (squawk) |
| Getter-shape differs from the sibling controller | Copy-by-example drift | Reconcile to one canonical shape (recommendation) |

## Key Learnings

- A "family breadth" flight can collapse to nearly nothing when the premise
  (format parity) is verified against a real artifact first — the verify-before-
  designing discipline is worth its cost.
- Source that is provably underivable (byte-identical Chrome/Edge exports) should
  be operator-declared or omitted, never faked into a picker — DD2's honest
  boundary.
- A behavior-preserving move needs a move-not-rewrite verification (diff vs.
  main), not new unit tests; the real regression risk on a no-DOM-harness page is
  rendering, which only the HAT covers.
- Source-scan pins tracking moved code are a recurring audit blind spot; the
  green bar is the authoritative check.

## Recommendations

1. **Design and land the real-boot internal-page smoke check** (open across two
   flight debriefs now, higher urgency here). This flight's only guard against a
   rendering regression in an 854-line UI move was one operator, once. Closes the
   CSS-cascade-origin defect class the route-closure test doesn't reach.
2. **Give `vault-restore-controller.js` its own line budget** now, while fresh —
   pin `seam-contract.test.js` at its current count + a small buffer, the same
   mechanism `vault.js` uses. (Squawk candidate.)
3. **Document the injected-deps page-controller extraction pattern** in CLAUDE.md
   (constructor shape, getter-injection, state-ownership-handoff idiom),
   reconciling the `getPresence()` vs. split-getter inconsistency into one
   canonical shape. (Squawk candidate for the doc; the code reconciliation is a
   follow-on touch.)
4. **Fold "run the affected test suite" into the citation-audit step** rather
   than treating the green bar as a fallback — three consecutive misses of the
   same class say the audit alone is not trustworthy.
5. **Name "large behavior-preserving refactor riding a small feature flight" as
   an explicit planning-time question**, with "own maintenance flight, or reorder
   the small leg first" as the default; auto-escalate a debt named at two
   consecutive debriefs into the next flight's leg list.

## Action Items

- [ ] Real-boot internal-page smoke check — needs design; a maintenance-flight /
      design item (also open from Flight 1).
- [ ] Give `vault-restore-controller.js` a line budget — logged as **squawk
      0069** (servicing).
- [ ] Document the page-controller extraction pattern in CLAUDE.md — logged as
      **squawk 0070** (servicing/doc); note the canonical getter shape.
- [ ] Reconcile the two controllers' getter-dep shape — debrief recommendation
      (small follow-on code touch).
- [ ] Mission 19: the operator judged it complete — close via
      `/mission-control:mission-debrief` (a separate step; a future Linux/macOS
      direct-read enhancement remains a deferred, not-planned, option).

## Human Input

The operator drove the HAT (all 7 steps pass, no fixes) and answered the two
closing questions: (1) **Mission 19 can be called complete** — Flight 3 alignment
is not wanted; the flow was judged settled at Flight 1. (2) **Other Chromium
browsers wait for real demand** — no speculative per-browser verification;
Chrome and Edge are the ones that matter. This validates DD2's generalized-
guidance approach as sufficient and the mission's scope as met.
