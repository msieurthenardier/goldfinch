# Leg: fixture-corpus

**Status**: completed
**Flight**: [The Save Moment](../flight.md)

## Objective

Stand up the committed fixture corpus that **defines** what "coverage" means for
this mission, curated before the trigger heuristic exists so it specifies the
behaviour rather than ratifying it.

## Context

DD6 plus the mission's corpus constraints. Three tiers, three different bars:

- **Gated set** — every shape must offer. 100%, no exceptions.
- **Known-unsolved set** — documented and committed, explicitly outside the gate.
  It exists because a 100% gate with no manual fallback otherwise creates exactly
  one pressure: delete the hard shape to keep the suite green.
- **Negative set**, which splits in two because "offer" is not yet a computable
  outcome (design review — the trigger does not exist until Leg 5):
  - **detection-negative, GATED NOW**: shapes where detection itself must yield
    nothing — a search box, a form with no credential field. Asserted today with
    `assertNoDetectableEntry`.
  - **gesture-negative, DEFERRED**: shapes whose whole point is *which control was
    clicked* — a decoy Cancel beside a real password field. Detection finds the
    real field regardless, so asserting "no offer" today would be **vacuous**.
    These land committed and documented in their own sub-tier, asserted by
    `assertNoOffer` only once Leg 5 exists. Deferring them is honest; including
    them under a meaningless assertion is not.

Shapes are **promoted** when solved and **never deleted** to make the suite pass.
Demotion needs the same deliberate ruling as any other criterion change.

This leg lands the corpus with every positive shape in the known-unsolved tier;
Leg 5 promotes them as its trigger solves them. That is deliberate — it avoids
committing a knowingly-red suite AND exercises the promotion mechanism rather than
leaving it paper policy. The negative set is gated from the moment it lands: today
almost nothing offers, so it should already pass, and a negative-set failure
appearing later is precisely the signal worth having.

## Acceptance Criteria

- [x] An extractor turns committed HTML fixture text into the DOM surface the pure
      detection modules consume (`querySelectorAll('input, select')`, `.form` /
      `closest('form')`, attributes, `.type`, `.value`, `.options`, `.maxLength`).
      No new devDependency; no `fs` read at app runtime — this is test-only.
- [x] **The extractor reproduces form association by TWO PINNED RULES**, not by
      "handling nesting" generically:
      1. A `<form>` start tag encountered while a form is already open is
         **IGNORED** per the HTML parsing algorithm — a browser never builds a
         nested form; the content reparents to the OUTER form. A naive tree-builder
         constructs a genuinely nested form instead, and its own unit tests would
         then pass against its own wrong semantics while diverging from the
         shipped app. This is exactly the "extractor lies" failure DD6 names.
      2. A valid `form=` IDREF **wins over containment**, anywhere in the tree.
      Unit tests cover both, plus an input inside a form, and one outside every form.
- [x] **Attribute-vs-property normalization is covered**: a missing/invalid `type`
      normalizes to `'text'`; `.maxLength` defaults to `-1`, not null/undefined
      (`formatCombinedExpiry` reads it directly); a `<select>`'s `.value` derives
      from the selected option, not a literal attribute.
- [x] **The extractor's document interface includes `addEventListener` and
      `documentElement`**, not just the detection-read surface — `createEntryObserver`
      needs both, and widening now is cheap whereas rediscovering it mid-Leg-5 is
      the pattern this flight has already paid for four times.
- [x] **The assertion vocabulary is pinned, not left to the implementer**:
      `assertDetectsEntry(fixture)` and `assertNoDetectableEntry(fixture)` are the
      only outcomes this leg can assert, because detection is all that exists
      headlessly today. `assertNoOffer` is declared but **deferred** — it must not
      be faked with a detection-based stand-in that would pass for the wrong
      reason.
- [x] The harness runs headlessly under `node --test` with the three tiers
      distinguished mechanically: gated shapes are ordinary tests, known-unsolved
      shapes use Node's `{ todo: true }` (a todo that starts passing does not fail
      the run, which is what clean promotion needs), negative shapes are ordinary
      tests asserting **no** offer.
- [x] **The gated set may be empty at the end of this leg** — that is expected, not
      a failure. Leg 5 populates it by promotion.
- [x] The detection-negative set is populated and green at the end of this leg.
- [x] **A STANDING canary test proves the harness has teeth** — not a one-time
      check. It inverts a negative assertion against a known-positive fixture and
      requires it to fail. It must target the **negative** tier, which this leg
      guarantees is populated: an earlier draft pointed it at the gated tier, which
      this same leg says may be empty — a plain contradiction. Being standing, not
      one-time, is what protects against a future harness regression that makes
      the whole gate pass vacuously.
- [x] Every fixture carries provenance in-file: what real-world shape it models,
      why it is in the tier it is in, and the date. A corpus whose entries cannot
      be traced back to a real shape decays into a record of our own assumptions.
- [x] **Named known-unsolved shapes present from day one**, at minimum: the
      motivating submit-control-outside-every-form checkout; an SPA submit that
      neither navigates nor detaches; and the **framework-re-render field
      replacement** handed over from Leg 3 (a legitimate capture silently lost to
      ordinary React/Vue churn, no attacker involved).
- [x] A test fails if a fixture file exists that no tier references — so a shape
      cannot be quietly orphaned instead of demoted.
- [x] **No snapshot or golden-file baselines.** Assertions are DOM-shape and
      offer-outcome based. (House rule: snapshot baselines are never committed.)

## Verification Steps

- `npm test` green with the negative set gated and the positive shapes todo.
- Extractor unit tests, especially the four form-association cases.
- A deliberate mutation check: point a gated-tier assertion at a fixture that
  should not offer and confirm the harness goes red — proving the gate has teeth
  rather than passing vacuously.
- `npm run lint`, `npm run typecheck`, `npm run format`.

## Implementation Guidance

1. **Extractor first, with its own tests, before any fixture is written.** It is
   the thing most likely to be subtly wrong, and every fixture's meaning depends
   on it. **But be clear about what its unit tests can and cannot prove**: they
   show the extractor is internally consistent, never that it matches a real
   browser. Only the live cross-check required by DD6 retires that risk. If the
   two pinned association rules above turn out to be more than a hand-rolled
   parser can carry faithfully, say so and stop — an extractor that quietly
   diverges from Chromium makes every fixture a lie, which is worse than having
   no corpus.
2. Fixtures live under `test/fixtures/save-moment/` (or the project's equivalent),
   one shape per file, with a header comment carrying the provenance required
   above. Real markup, pasted and trimmed — not hand-idealised.
3. The tier manifest is data, not scattered `it.todo` calls: one place that lists
   each fixture and its tier, so promotion is a one-line edit and the
   orphan-detection test has something to read. **Tier lives in the manifest
   ONLY** — directory layout is cosmetic and must never become a second, driftable
   source of truth.
   The manifest entry carries an optional **`simulate(doc)` hook**, because some
   shapes are inherently dynamic and cannot be expressed as static markup. The
   framework-re-render shape is exactly this: a field is granted provenance, then
   replaced by an equivalent-looking node. Without a declared representation the
   implementer would invent a one-off format for that single fixture, which then
   has no home in the manifest.
   For a multi-form fixture the entry also records the **expected entry ordinal**
   (which detected entry should be acted on — an integer, never a node reference),
   so a gated multi-form shape can express disambiguation once Leg 5 lands.
4. Reuse the pure detection modules directly. The corpus tests detection and
   (from Leg 5) the trigger — never a reimplementation of either.

## Edge Cases

- **A fixture that stops parsing** after an extractor change should fail loudly,
  not silently produce zero fields and pass a negative-set assertion.
- **Card fixtures and the Luhn gate.** `findAllCardFields` detection is
  independent of the Luhn/plausibility gate, which DD7 applies later and main-side.
  A fixture with a well-formed `cc-number` field but a non-Luhn sample PAN detects
  fine yet could confuse a future end-to-end "does this offer" test for reasons
  unrelated to shape. Use Luhn-valid sample PANs in fixtures and say so in the
  header.
- **Negative-set shapes must be genuinely adversarial** — a decoy that no plausible
  heuristic would fire on proves nothing. Include at least one near-miss that a
  naive implementation WOULD fire on — in the **deferred** gesture-negative
  sub-tier, since discriminating it needs Leg 5's trigger.

## Out of Scope

- The trigger itself and any promotion into the gated set — Leg 5.
- Live-site testing. The corpus is the headless regression net by operator ruling.

## Files Affected

- `test/fixtures/save-moment/**` — new fixtures plus the tier manifest.
- `test/unit/save-moment-corpus.test.js` — new harness.
- `test/unit/save-moment-extractor.test.js` — new.
- `test/helpers/` — the extractor itself.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] `npm run format` run
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit
