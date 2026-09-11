# Flight Debrief: Chrome Password Import

**Date**: 2026-09-11
**Flight**: [Chrome Password Import](flight.md)
**Status**: landed
**Duration**: 2026-09-08 (planning) → 2026-09-11 (HAT complete) — active build 2026-09-09
**Legs Completed**: 3 of 3 (Leg 3 the optional guided HAT, taken)

## Outcome Assessment

### Objectives Achieved

The flight delivered the whole Chrome-CSV import pipeline end to end and proved
it on a real Chrome export during the guided HAT:

- A hand-rolled RFC-4180 parser (`csv-parse.js`), a Chrome-row→`login` adapter
  with the full degenerate-row taxonomy and caps (`browser-import.js`), a new
  content-identity dedupe (`planLogins`), and a new batch commit op
  (`vault-store.js` `importLogins`, the twelfth gated store op) with
  Replace/Merge and lazy-vault creation.
- An operator-driven UI: a native file pick and an awaited native confirm
  (`browser-import-flow.js`), four internal IPC channels, a new page controller
  (`vault-browser-import-controller.js`), and a per-entry outcome report.
- The plaintext-payload handling: a separate zeroizing held-store
  (`pending-browser-imports.js`), Buffer read, drop on lock / window-close /
  pagehide, payload zeroized after commit.

### Mission Criteria Advanced

- **Logins arrive from a browser export** — met (S1–S5 on a real export).
- **Nothing lands without a destination choice** — met (S3, S4, S8).
- **Re-importing the same export does not duplicate** — met (S6, S7; the
  changed-entry-surfaces-as-a-copy trichotomy verified live).
- **Unmappable and degenerate rows are handled** — met (S2, S3; `android://`
  non-web-origin reads correctly, never "null").
- **The import reports its outcome per entry** — met (S4 completion modal).
- **The import path is never machine-driven** — met, and the boundary is the
  one that actually holds (native-dialog initiation + payload never serialized
  to the page + native confirm), directly verified in
  `browser-import-boundary.test.js`, not the internal-session guard.
- **goldfinch writes no plaintext credential to disk** — met (S12: FD-verified
  the vault dir holds only ciphertext + `manager.json`, no CSV, no sidecar;
  operator-verified a real-password grep returns zero hits).
- **Docs tell the new truth** — met for the Chrome half (`docs/vault.md`
  "Browser import (Chrome)"; CLAUDE.md Password-vault bullet).
- **The Chromium family comes in on the same path** — deferred to Flight 2 (by
  design; this flight proves the Chrome pipeline).

All checkpoints CP1–CP5 met; CP6 (HAT) satisfied.

## What Went Well

- **Design-review-before-code earned its keep repeatedly.** Both autonomous
  legs ran a design review that caught real defects before a line was written:
  a `writeFileAtomic` spy technique that could never observe anything (it is a
  destructured CJS import), a `MAX_IMPORT_ITEMS` circular-require that would
  have bound `undefined` silently, the `vault.js`-at-2820-not-2819 budget
  miscount, `BrowserImportFormatError.reason` vs `.code`, and a test regex that
  squawk 0063's rename would have broken. None of these reached implementation.
- **The flight-end review found a real blocking bug the leg ACs missed** — the
  `_importLogins` `skipDedupe` bypass that skipped `planLogins` entirely for a
  lazy/empty/replace destination, breaking intra-file dedupe on the most common
  case (first import into a fresh jar). Caught by an independent Reviewer, fixed
  with three regression tests before the single flight commit.
- **The DD5/DD13 admin-tier boundary argument is sound as built and directly
  verified.** The Architect confirmed the admin engine sets `allowInternal:true`
  (admin CAN drive the vault page), so the boundary that holds is exactly what
  DD5/DD13 claim: native dialogs have no automation surface, and the payload is
  never serialized into any IPC reply (`commit` returns `{ ok, target, counts }`
  only). The flight's insistence on asserting the guard that actually governs,
  correcting the mission's own draft wording, is a methodological win.
- **The second-import-surface separation from M18 restore was the right cut.**
  Reusing the id-keyed ciphertext-bundle merge for an id-less plaintext source
  would have meant faking ids or entangling two trust models. Two small sibling
  modules with an explicit shared-shape comment beat a parameterized abstraction.
- **Green bar tracked and independently re-verified at every leg boundary**
  (4294 → 4372 → 4421 → 4424 → 4427 → 4432), not just trusted from agent
  self-reports.

## What Could Be Improved

### Process

- **No real-boot verification before the HAT was the flight's one structural
  gap.** Two of the three HAT fixes are defect classes a source-scan review
  cannot see: the missing `/burner.js` route (needs walking the runtime ES
  import graph) and the `.vault-field[hidden]` cascade defect (needs a browser's
  style engine — an author `display` beats the UA `[hidden]` on cascade origin,
  not specificity). CP5 ("import completes end-to-end on the vault page") was
  worded as a checkpoint but nothing before the optional HAT could verify it —
  it was closer to a hope. Squawk 0063's own Note had flagged this exact route
  risk, so it was foreseeable. A gated real-boot smoke check should precede
  marking any internal-page-touching leg landed.
- **The leg ACs alone were not sufficient** for the intra-file dedupe property;
  it took the flight-end Reviewer's independent pass. A stateful wrapper around
  a pure decision function needs an AC that exercises every branch through the
  call site, not just the pure function in isolation.

### Technical

- **`vault.js` ends at its exact 2820-line budget ceiling, zero headroom** —
  the third consecutive flight (M18 F3, then here) to name the same debt:
  extract the restore mapping/completion modals into their own controller
  (M18 F3 debrief recommendation 2). This flight correctly declined per its own
  divert criterion, but Flight 2 will hit the identical zero-margin wall
  immediately.
- **The CSS-cascade defect class has no general guard.** The `.vault-field[hidden]`
  pin is a regression pin for this one selector, not a structural fix; a
  different specificity/origin collision elsewhere on the page would not be
  caught.

### Documentation

- **The `vault-page-model.js` pure-extraction pattern has now been demonstrated
  four times** (`restoreDestinationOptions`/`restoreOutcomeLines`, then this
  flight's `browserImport*` trio) and written down nowhere as a rule — itself a
  carry-forward from the M18 F3 debrief that recurred rather than closing.

## Test Metrics

Full suite on the landed HEAD (`npm test`): **4432 / 4432 pass, 0 fail, 0
skipped, 13 suites, wall-clock 5.76 s** (runner `duration_ms` 5433). `typecheck`,
`lint`, `format:check` all clean.

Trend (sourced from the M18 F3 debrief and this flight's log):

| Flight | Tests | Wall-clock |
|---|---|---|
| M18 F1 | 4008 | 3.58 s |
| M18 F2 | 4118 (+110) | 6.16 s |
| M18 F3 | 4294 (+176) | ~5.2–5.7 s |
| **M19 F1 (this)** | **4432 (+138)** | **5.76 s** |

Start-of-flight green bar was 4294, an exact match to the M18 F3 ending count —
no inter-flight drift. The +138 landed across the lifecycle (Leg 1 +78, Leg 2
+49, flight-end fix +3, HAT +8). Wall-clock stayed inside the M18 F3 band
despite the added volume, consistent with the FAST_SCRYPT-everywhere discipline
the new suites also follow. Slowest suites (none new to this flight):
`vault-compromise-rotate.test.js` 2548 ms, `vault-txn.test.js` 1969 ms,
`vault-context.test.js` 1472 ms, `navigation-controller.test.js` 1427 ms,
`vault-crypto.test.js` 957 ms. The six new M19 suites are all lightweight
(63–348 ms, mostly process startup).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Held-store `drop` inlines `payload.fill(0)` (no `zeroize` helper) | Lets a grep-AC pin that `.payload` is read only in `take`/`drop` | Yes — code shape chosen to make a security property greppable |
| AC10 second signal: byte-content, not mtime | mtime flaked on same-tick writes | Yes — don't assert filesystem timing the env can't guarantee |
| Page-controller deps collapsed (`dom` group, `getPresence`) | Hard 2820 line-budget | No — a symptom of the budget debt, not a pattern |
| "Resume browser import…" folded into the import button slot | Line budget | Revisit in Flight 2 (source distinction) |
| Replace label added ("Wipe and replace…") then shortened | Overflowed the select | No — one-off wording tuning |
| Global `.gfvault` unlinked in a test to reach the lazy-create branch | Unreachable via the app's own API | Acceptable test idiom |

## Key Learnings

- A pure function being correct does not prove the stateful wrapper calls it on
  every branch — the intra-file dedupe bypass shipped past Leg 1's own ACs for
  exactly this reason.
- Source-scan reviews are blind to two real defect classes on internal pages:
  runtime module-graph resolution and CSS cascade-origin. The new
  `internal-page-route-closure.test.js` closes the first class structurally
  (host-generic, non-vacuously proven); the second still needs a real-boot check.
- Live HAT budget is best spent on the un-unit-testable (real keyboard
  traversal, render/CSS defects, real-boot module load), not on re-observing
  unit-covered cross-process drops (S9/S10).
- The "assert the guard that actually governs" discipline caught a genuine
  mismatch between the mission's draft framing (sheet allowlist) and the real
  boundary (native-dialog absence + payload-never-serialized).

## Recommendations

1. **Add a real-boot internal-page smoke check to the standing toolkit** — a
   cheap headless-render assertion that each internal page's root populates
   after boot. Closes the other half of the hazard the route-closure test opened.
2. **Cite `internal-page-route-closure.test.js` as a standing guard in
   CLAUDE.md's internal-page section**, the way `csp-pins.test.js` is cited for
   the media-fetch invariant — the expected check for any allowlist widening.
3. **Execute the `vault.js` restore-modal extraction as its own maintenance
   flight** before Flight 2 needs the headroom — debt now named at the end of
   two consecutive flights that touched the file.
4. **Document the `vault-page-model.js` pure-extraction pattern** in CLAUDE.md
   or docs/vault.md (demonstrated four times, written down never).
5. **Before designing Flight 2, verify a real Edge export's header/column shape
   and check for blocklist-marker rows** rather than assuming Chromium-family
   byte-for-byte parity — the same verify-assumptions-against-reality discipline
   the mission applied to ABE.
6. **Adopt a standing convention** (alongside the Grep-AC and MockTimers
   entries): a stateful wrapper around a pure decision function needs at least
   one AC exercising every branch through the stateful call site.

## Action Items

- [ ] Real-boot internal-page smoke check — needs design (headless boot, what
      to assert); belongs to a maintenance flight or a design decision, not a
      squawk.
- [ ] `vault.js` restore-modal extraction — its own maintenance flight (needs
      design; thrice-named debt).
- [ ] Document the `vault-page-model.js` pure-extraction pattern — candidate
      squawk (servicing/doc).
- [ ] Cite `internal-page-route-closure.test.js` in CLAUDE.md's internal-page
      pattern — candidate squawk (servicing/doc).
- [ ] Flight 2: generalize `detectChromeExport` to a known-header table with a
      source tag (or per-browser adapters over the shared parser/dedupe/commit);
      activate the dormant `blocklist` reason code if Edge emits such rows;
      decide multi-source labeling in the resume slot at design time.

## Human Input

The operator drove the entire HAT and supplied feedback throughout, which stands
as the human interview: two mid-HAT feature asks (the delete-export info panel,
the clearer Replace wording) were captured and implemented; the operator caught
the "Replace reads as if it only swaps dupes" ambiguity and the overflowing
label. On the two closing questions: (1) **the flow's feel is settled** — the
operator judged the import flow good as-is, so the optional Flight 3 alignment
is not needed for feel. (2) **Nothing was a significant drag** — the operator
described the flight as basic alignment work; the WSLg window-visibility problem
(needed a machine restart to present the dev window) was a one-off environment
issue, resolved, and not flagged as recurring or squawk-worthy.
