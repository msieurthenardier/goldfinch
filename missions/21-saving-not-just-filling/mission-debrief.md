# Mission Debrief: Saving, Not Just Filling

**Date**: 2026-09-22
**Mission**: [Saving, Not Just Filling](mission.md)
**Status**: completed
**Duration**: 2026-09-18 (planning, after the Jostens investigation) – 2026-09-22 (Flight 4 merged, #230)
**Flights Completed**: 4 of 4 planned (optional Flight 5 dropped by operator decision)

## Outcome Assessment

### Success Criteria Results

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | No-submit flows offered for saving, every gated corpus shape, both families (*behavior-test-backed*) | **Partially met** | See note 1 below the table |
| 2 | Offer at settle, not at gesture; unsettled holds dropped and zeroized | Met | See note 2 |
| 3 | Identity saved from a checkout and filled later, per jar | Met | Live end-to-end at Flight 3's HAT |
| 4 | Password generated in-field at creation and rotation, same save path | Met | See note 4 |
| 5 | No offer without a genuine gesture; page script cannot steer disposition | Met | See note 5 |
| 6 | Corpus curated before the heuristic; shapes demoted, never deleted | Met | See note 6 |
| 7 | Existing exclusions hold (burner, internal, subframe, zeroized buffers) | Met | See note 7 |
| 8 | In-field badge is recognisably Goldfinch, with lock state, legible, page-safe | Met (different form) | See note 8 |
| 9 | Zero offers on the entire negative set | Met | Non-vacuous: standing canaries per tier; re-verified after F3's rework and after F4 |
| 10 | Identity capture gated by a stated plausibility rule, "the same protection Luhn gives cards" | **Partially met** | See note 10 |

Notes:

1. **Criterion 1.** The corpus has 31 entries: 18 gated, 4 known-unsolved and 9 negative,
   all running real assertions in `save-moment-corpus.test.js`. But no
   `tests/behavior/` spec exists for it: every flight declined one, because the capture
   sheet cannot be observed by automation. The live proof is three HAT walks (F1, F3,
   F4). The motivating Jostens shape (submit control with no form relation) is still
   `known-unsolved` and proven only live; its gated sibling uses a `form=` IDREF.
2. **Criterion 2.** DD4 settles on a navigation commit or a field detachment only; the
   TTL always drops, never offers. Live at the F1 and F3 HATs, including the SPA detach
   case.
4. **Criterion 4.** Leg 3 extended the existing CSPRNG generator to honour
   `minlength`/`maxlength`/`passwordrules`. A generated fill is granted provenance and
   captured like a typed one. Live at F4 HAT steps 4–7. Rotation updates the matching
   login and keeps its username. The documented miss (a fully unmarked current + new
   form) fails safe.
5. **Criterion 5.** This is the most rigorously proven criterion. A four-round defeat arc
   ended in isolated-world provenance, which blocks page forgery by construction. F4's
   password-match disposition reads only provenanced values, and its DD3c exemption was
   neuter-verified.
6. **Criterion 6.** Exercised under pressure: `checkout-submit-outside-form` was promoted,
   found vacuous at F1's HAT, and demoted back. Nothing was ever deleted.
7. **Criterion 7.** Holds for every capture, offer and generate path, and generation is
   absent from the MCP surface. The adjacent chrome-IPC owner-check gap is logged under
   Known Issues; it is not a breach of this criterion's letter.
8. **Criterion 8.** The shipped badge is a 30×16 toggle pill: a goldfinch knob with the
   lock in a dark track, and an "Open Vault" tooltip. It is the operator's pick from a
   six-variant design lab after the planned round mark-plus-overlay was rejected live as
   hard to read. The mission prose describes a different shape.
10. **Criterion 10.** No capture-time value check exists (`captureIdentity`: "No
    plausibility gate"). The protection is F2's structural admissibility rule (a postal
    anchor AND a non-postal role, each provenanced), which was ablation-proven. It is a
    form-context rule, not a value checksum like Luhn, and a well-formed decoy carrying
    a third party's address passes it (a named, accepted residual). The hard-zero intent
    holds in practice; the Luhn analogy does not.

### Overall Outcome

**Achieved.** The vault now saves as well as it fills:
- **Logins and cards** are captured from script-driven flows that never fire a form
  submit (the Jostens checkout).
- **Identity** is a real, per-jar vault family: it is captured, filled, and deduplicated
  against one profile per vault.
- **Passwords** can be generated in the field at sign-up and at rotation.
- **The badge** is now recognisably Goldfinch.

The central risk, a broader trigger eroding "a save offer represents something the
operator really did", was closed more strongly than before the mission. Provenance now
lives in an isolated world that page script cannot reach, where before it rested on a
single `isTrusted`-guarded submit.

The goal was still the right one at the end. The operator dropped the optional Flight 5:
- a pending save offer surviving window blur;
- before/after values on the identity update sheet;
- an alignment session.

These are preferences on top of a complete outcome, not gaps in it.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1 — The save moment | completed (#222) | Broadened, `isTrusted`-gated gesture trigger. Read at gesture, release at settle. Isolated-world provenance (value-bound, TTL). The save-moment corpus (gated / known-unsolved / negative). HAT 7/7. *No flight debrief was written.* |
| 2 — Identity foundations | completed (#226, #227) | The identity admissibility boundary (scope anchor + alternatives table, bare `address` never admissible), the identity item type, one profile per vault on every write path, a tolerant bundle import. Split from a larger flight at design review. |
| 3 — Identity fill and capture | completed (#228) | Three-way detection and fill with ordinal precision (DD9), per-family holds with a serial offer queue, `dispatchByFamily` fail-closed, planner/actuator for capture. The HAT found the DD1/DD5 contradiction, fixed in-flight as Leg 6. |
| 4 — The in-field affordance | completed (#230) | Password-field roles and rotation disposition, generate in picker (including while locked), the toggle-pill badge, the toolbar lock click / "Unlock now". Squawk 0100 root-caused (resize-then-remove of a visible sheet) and fixed. |

Between flights 3 and 4: a squawk turnaround (#229) closed squawks 0093–0101 in one
independently reviewed batch.

### Flight Patterns

- **Every flight's HAT found something real.** In the operator's words, "the HAT always
  finds something":
  - F1: a vacuous `offers` assertion;
  - F3: a design-decision contradiction that had survived five reviews;
  - F4: 4 of 9 steps failed on first pass.

  The autonomous legs plus the HAT worked well *because* the HAT was treated as
  load-bearing.
- **Design review caught every pre-code HIGH.** Examples:
  - F1's four-round provenance arc;
  - F2's fourth `ITEM_TYPES` source;
  - F4's null-username overwrite on rotation;
  - F4's picker-dispatch misroute.

  The defects that got past it were of two kinds: boundary mismatches between hops, and
  surfaces automation cannot see.
- **Sizing improved after F1.** F1 was the mission's one oversized flight (flagged at
  review, accepted). F2 was split at review to avoid repeating that. F3 and F4 were sized
  by counting their unproven adversarial axes, a rule F2's debrief introduced.

## What Went Well

1. **Categories were closed by construction, not instance by instance.** The mission's
   signature move:
   - isolated-world provenance ended the page-spoofing category;
   - the zeroize-every-Buffer superset covered F4's new `currentPassword` with zero
     edits;
   - planner/actuator retired "the loop drops its siblings";
   - `dispatchByFamily` retired "binary with an implicit login else";
   - the two-candidate generator closed the ReDoS axis without a retry channel.
2. **Corpus first with honest tiers.** Fixtures specified behaviour before the heuristics
   existed, caught real bugs (the change-password shapes saving the OLD password; a
   mis-read snapshot), and were demoted rather than deleted when an assertion proved
   vacuous.
3. **Neuter verification became house standard,** and kept paying for itself. It caught
   vacuous tests three times in F1's corpus and once in F4 (AC14(d)), and proved every
   new security gate has teeth.
4. **Test growth without slowdown.** 5173 → 5654 tests (+481) across the mission, with
   wall-clock steady around 5.2–7.9 s.
5. **`renderer.js` zero-headroom discipline held.** F3 planned an extraction up front;
   F4 added nothing (one dependency line swapped 1:1).

## What Could Be Improved

1. **Surfaces automation cannot see need human-first diagnosis.** Squawk 0100 cost two
   automation diagnoses, a false-positive repro and one wrong fix. The operator's hand
   repro plus a `document.visibilityState` probe, then a 10-minute experiment matrix,
   solved it. The same class limited criterion 1's "behavior-test-backed" wording.
2. **Per-hop tests do not prove chains.** Boundary-vocabulary bugs shipped past full
   per-hop coverage twice: F3's ordinal fix reached capture but not fill, and F4's `null`
   vs `-1` "no limit" hid Generate until the HAT. The fix, a real-output → real-input
   contract test, landed only reactively.
3. **Lessons written in debriefs did not reach the working rules.**
   - F2's "collapse the four `ITEM_TYPES` sources", F3's Scenario Trace and
     DD-consistency questions, and F4's unobservable-surface rule are all still absent
     from CLAUDE.md or `.flightops`.
   - F1's debrief was never written, although two later debriefs flagged it.
   - `mission.md`'s criteria checkboxes and Known Issues lagged the actual state until
     this debrief.
4. **Visual design was guessed, then rebuilt.** F4 pinned a specific badge form, built it
   with its full test suite, and then rebuilt both after the HAT rejected it. A design lab
   (which the FD improvised at the HAT) should precede the implementing leg.
5. **A stricter rule was added beside a laxer one without converging them.** The new
   `vault-fill-generated` owner check sits next to two unchecked older handlers. That
   repeats a pre-existing habit (the vault page's getter-shape split).

## Lessons Learned

- **Technical:**
  - A native view's visibility can desync from every API read. Resizing a still-visible
    overlay and removing it in the same tick left the sheet permanently `hidden`; this is
    the second instance of "state correct, pixels missing" after the guest-bounds
    animation gotcha.
  - Provenance must be value-bound and read through world-isolated accessors. A sticky
    flag or a main-world getter is always one spoof away.
- **Process:**
  - Check the unobservable-surfaces list before planning any diagnosis.
  - Count adversarial axes at drafting.
  - Treat an FD "verified" claim as a probe output, not a reading.
  - When a remedy is proposed, run the one experiment that could refute it before
    building it.
- **Domain:**
  - Identity has no value-level anchor, so its safety is structural (form context), and
    a third party's address on a well-formed form is irreducible without inference the
    mission forbids.
  - Password-field roles need layered evidence (autocomplete, then tokens, then
    structure), and one shape (an unmarked current + new form) is genuinely ambiguous.

## Methodology Feedback

- **The mission/flight/leg hierarchy worked,** especially with risk-tiered leg design
  review (low-risk legs went straight to implementation, while every high-risk leg's
  review found at least one HIGH). The flight-end single review plus commit kept the
  overhead low.
- **Autonomy level:** the operator judged it right. Autonomous legs followed by a HAT that
  is expected to find things; no earlier checkpoint requested.
- **Gap: debrief recommendations lack a landing mechanism.** They accumulate in flight
  debriefs and silently fail to reach CLAUDE.md or the crew prompts. Recommend that each
  flight debrief's methodology recommendations become either an immediate
  `.flightops/agent-crews/*` or CLAUDE.md edit, or a squawk. That makes them actions, not
  prose.
- **Gap: the squawk gate correctly rejects security-sensitive items (the owner-check
  retrofit), but nothing then owns them.** When a flight ends with such an item, it
  should be written into `mission.md` Known Issues (done here) or the next mission's
  scope.

## Action Items

- [ ] **Owner-check retrofit** on `vault-fill-human` / `vault-reachable-items` (match
      `vault-fill-generated`). A design-reviewed leg in the next vault-touching work;
      failed the squawk gate (security-sensitive). Recorded in mission.md Known Issues.
- [ ] **Port the carried methodology rules** into `.flightops/agent-crews/` and
      CLAUDE.md's project planning rules:
      - F3's Scenario Trace and DD-consistency review questions;
      - an unobservable-surface human-first diagnosis rule;
      - a contract test per multi-hop main↔guest chain;
      - "a survives test uses the row shape the guard would act on";
      - a design lab before visual implementation.
- [ ] **CLAUDE.md compaction** (maintenance flight). At about 25k words, the file's
      Password vault section is roughly a fifth of it. Move stable sections (App
      database, History store, Bookmarks) and the vault detail into `docs/*.md` with
      short pointers. Extend the WebContentsView gotcha to overlay views
      (close-before-resize).
- [ ] **Collapse the four vault item-type sources** toward one derivation point before
      any fifth type.
- [ ] **Backfill or explicitly waive** Flight 1's missing flight debrief.
- [ ] **Consider a toolbar-menu-never-empty invariant test** (squawk candidate from F4).
- [ ] Run `/mission-control:routine-maintenance` before the next mission; the items above
      are its natural input.
