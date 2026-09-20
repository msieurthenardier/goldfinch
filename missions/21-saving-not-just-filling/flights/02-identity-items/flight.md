# Flight: Identity Foundations

**Status**: completed
**Mission**: [Saving, Not Just Filling](../../mission.md)

> **Scope reduced at design review.** This flight was drafted as "Identity Items" —
> detection, fill, capture and sheets in one. Review judged that a repeat of
> Flight 1's sizing mistake: its Leg 3 bundled four separable concerns that Flight 1
> needed multiple dedicated legs and six review rounds to get right across a
> *narrower* split. Fill, capture and the sheet work now belong to a follow-on
> flight. What remains here is one decision cluster: **what an identity IS, and how
> it is stored.** No page-facing behaviour ships in this flight.

## Contributing to Criteria

- [ ] Identity capture is gated by a stated plausibility rule (this flight *pins*
      the rule and proves it against adversarial fixtures; the follow-on flight
      applies it to live capture).
- [ ] A name, address, email and phone can be saved and filled per jar
      *(foundations only here — the data layer and the detector)*.
- [ ] No spurious offer anywhere in the corpus, including near-miss cases.

---

## Pre-Flight

### Objective

Decide and pin what qualifies as an identity field, fix the fallback patterns both
existing families already sit on, and add the identity item type to the vault
substrate — including making bundle import survive a type it does not know.

### Design Decisions

**DD1 — A SCOPE ANCHOR gates the form; token rules then gate the field.** Nothing
is inferred from shape, position or value.
- **Scope gate (the anchor identity otherwise lacks).** A scope is an identity
  context only if it contains at least one admissible **postal** role — a street /
  address-line token, a postal-code token, or a prefix-qualified `city`/`country`.
  **Without a postal anchor, NOTHING in that scope is admissible.**
- **⚠ TWO AMENDMENTS (Leg 2 design review round 2), both closing holes in the rule
  as first written:**
  1. **`address` is NEVER admissible bare — at the anchor OR as a field.** The
     original rule made `address` a generic token needing no prefix once anchored.
     That creates a reachable TIE: `emailAddress` tokenizes to
     `["email","address"]` and would match `email`'s `{email}` and `street`'s bare
     `{address}` at equal length, with the winner decided by whichever the
     implementer happened to check first — exactly the ambiguity the alternatives
     model was introduced to remove. `address` therefore always requires a
     prefix or compound form (`{billing,address}`, `{street,address}`,
     `{address1}`, `{address,line1}`…). This also settles `billingAddress`
     cleanly.
  2. **An anchored scope additionally requires at least one NON-POSTAL identity
     role** — a name, email or phone. A postal anchor alone does not constitute a
     person. Without this, a shipping-cost estimator (`zip` + `country`) satisfies
     the anchor and is admitted as an identity. An address-plus-phone shape still
     qualifies, so this refuses postal-ONLY scopes and nothing else.
- **Field gate, inside an anchored scope.** A WHATWG autofill identity token always
  qualifies. So does a specific token (`given-name`, `family-name`, `surname`,
  `firstname`/`fname`, `lastname`/`lname`, `postal-code`/`postcode`/`zip`/`zipcode`,
  `address-line1/2`/`addr1`/`addr2`, `street-address`, `tel`/`phone`/`mobile`,
  `email`). And — because the anchor is present — so do generic tokens (`name`,
  `address`, `city`, `town`, `state`, `province`, `region`, `country`) **without**
  needing a qualifying prefix.
- Rationale, and what changed: an earlier draft made generic tokens require a
  `billing`/`shipping` prefix and let specific tokens stand alone anywhere. Review
  showed that fails in both directions. **It over-admitted `email`** — a bare
  standalone email field is among the most overloaded widgets on the web
  (newsletter boxes, contact forms, password resets, "email a friend"), and once
  Flight 3 wires this into the broadened capture machinery every one of those
  becomes a save candidate. That is a wrong-moment cost of a different order than
  the mission's "budget, not a wall" framing anticipated. **And it under-admitted a
  bare single "Full Name" field**, which is the most common identity shape on small
  checkouts that do not split given/family name.
  The scope anchor fixes both: a postal address present in the form IS the
  structural signal identity has no field-level equivalent for, and it mirrors the
  card family's own "a form that hints even once is trusted to hint completely"
  discipline. A newsletter has no address; a checkout does.
- **The motivating page passes**: `billingAddress1` and `billingPostalCode` anchor
  the scope; everything else in it then qualifies.
- **Refused, deliberately**: a newsletter `email`, a contact form with no address,
  a flight search's `destination`, and the anonymous `field1`/`field2` shape —
  whose fixture therefore **stays negative** rather than being re-tiered.
- **⚠ The matching ALGORITHM is not yet chosen, and the verdicts above depend on
  it.** Word-token set vs. boundary-anchored regex vs. whole-string changes whether
  `zipcode` (no separator — a `\b`-anchored `zip` fails exactly as squawk 0091
  failed on `card_nameOnCard`), `addr1`, `fname`/`lname`, `emailAddress` and
  `streetAddress` match at all. **Leg 2 must pin the algorithm as its own decision
  before writing the corpus**, and the corpus must carry those five spellings plus
  a bare single-field "Name" checkout as NAMED cases — decided, not discovered.
- **Not trusted until proven.** Leg 2 attacks this table with adversarial
  near-misses before anything depends on it. A pattern table asserted and not
  attacked is exactly what shipped squawks 0090 and 0091.

**DD2 — One composite profile, and a differing value NEVER silently overwrites.**
- Shape: a single record holding name, email, phone and address. Multiple profiles
  (home vs work) are out of scope for this mission.
- **The conflict rule, promoted from an open question at review's insistence** —
  it is load-bearing because it determines schema shape, and Flight 1 learned the
  hard way that deferring a data-model decision forces rework a leg later:
  - Capture values that all MATCH the stored profile → no offer (unchanged).
  - Capture that only FILLS GAPS (fields absent from the profile) → offer a merge.
  - Capture that CONFLICTS with a stored value → offer an explicit update naming
    exactly which fields change, never a silent write.
- Rationale for the conflict case: a gift-shipping checkout carries someone else's
  name and address. Silently overwriting would corrupt the operator's own identity
  with a stranger's — and then fill it into an unrelated later form. That is a
  correctness *and* privacy defect, softer than DD3c's hard-zero but the same
  family. Declining to overwrite silently is the mission's stated bias.
- Consequence for schema: the merge rule needs per-field presence to be
  expressible. Leg 3 must ship a shape that supports it, not one that has to be
  reworked to — AND a pure, unit-tested `classifyCapture(stored, captured)`
  returning match / gap-fill / conflict plus the changed field list, even with no
  live caller. Without it the rule stays a paper decision until Flight 3, which is
  precisely the failure DD1's own "not trusted until proven" language warns about.
- **Named residual, acknowledged rather than hidden**: on a FRESH profile every
  captured field is a gap, so DD2's own motivating scenario — a gift-shipping
  checkout carrying a stranger's details — classifies as an ordinary gap-fill merge
  if it happens to be the first identity capture ever. Still an offer, never a
  silent write, so no hard-zero is breached; but the rule does not catch its own
  headline case in that one situation, and saying so beats discovering it.

**DD3 — Bundle import becomes tolerant of unknown item types and REPORTS them.
Three call sites, three different fixes.**
- Corrected blast radius (the draft said "one throw at `:549`" — wrong):
  `validateImportedItems` is called from **three** structurally different sites:
  - `_importVault` (`:2236`) — returns `{imported, fresh, vaultId, …}`. **No
    outcome-array shape exists here at all**; a skipped-types field is new
    plumbing end to end (store → IPC → page), not an extension.
  - `restoreProfile` COMMIT loop (`:2496`) — has a `results.push({entryHandle,
    outcome, …})` precedent to extend, BUT the current throw is **not caught
    per-entry**; it propagates out of the whole loop, so today one unknown type
    anywhere aborts the entire restore including vaults that already landed, with
    no results array at all. Tolerance here means adding per-entry exception
    handling, not relaxing a validator.
  - `restoreProfile` PREVIEW (`:2660`) — feeds `itemCount` at the Secret step,
    before a destination is chosen. **Filtering silently here would itself be a
    swallow**, which this DD forbids: the preview must state that some items are
    of an unknown type, even though nothing has been committed yet.
- Rationale: fixing it tolerantly once fixes it for every future type; versioning
  would still leave an older build unable to import the logins and cards it *does*
  understand.
- **⚠ Softens Mission 18's "load loudly" stance for exactly these paths.** The
  `.gfvault` parse path is untouched and keeps loading loudly.

**DD4 — THREE ITEM_TYPES sources must be edited in parallel** (amended at Leg 3
design review — the original named two). `vault-item-schema.js`
derives from `SCHEMA`; `vault-store.js:126` is an independent hardcoded literal
checked at `:549`/`:2834`/`:3203`. They are not one cascading into the other. **And there is a third**:
`vault-editor-model.js`'s `EDITOR_LAYOUT`/`EDITOR_TYPES`, pinned to the schema by an
`assert.deepEqual` drift guard, so adding a type turns that test red until the
editor layout gains an entry with a UI label per field. A fourth site,
`vault.js`'s `ITEM_SUBSECTIONS`, is hardcoded separately and renders only the types
it lists — a type added everywhere else but not there is bucketed correctly and
then silently never drawn.

**DD5 — Detection lives in the isolated world; the automation surface stays
login-only.** Both inherited verbatim from Flight 1 (DD3f/DD3g/DD3h) and from the
card family's documented exclusion. No new design.

**DD6 — Leg 1 fixes the CARD patterns only, and extracts family-agnostic
primitives. It does not design identity's table.**
- Narrowed at review: building shared matching infrastructure "for a third family"
  before DD1's boundary is proven risks baking in card-appropriate looseness
  (0091's underscore relaxation) that is too permissive for identity's anchor-free
  bar. Extract the tokenizer (camelCase/underscore splitting, autocomplete lookup);
  leave identity's pattern table to Leg 2, where the corpus proves it.
- Squawks 0090 and 0091 close here. 0090 is a regression this project shipped.

### Open Questions

- [x] What is identity's plausibility gate? → DD1, with the boundary drawn.
- [x] Composite or fields? Conflict handling? → DD2.
- [x] Bundle forward compatibility? → DD3.
- [x] **Family conflict — broader than it first looked, and structural.**
      `resolveLoginEntry` (`vault-fill-fields.js`) picks the login username as the
      LAST text/email/tel input PRECEDING a password field, **by document position
      only** — it never reads name, id or autocomplete. So ANY identity-admissible
      field that happens to sit before a password is claimed by the login detector
      regardless of spelling, while the identity detector claims it independently by
      content. Leg 2 must produce a concrete precedence **DD** (not a ticked
      checkbox) stating which family wins and which icon renders, verified against
      that positional logic rather than an assumed name-based one. Enacting it is
      Flight 3's wiring; deciding it is Leg 2's.

### Prerequisites

- [x] Flight 1 landed and merged (`c7585a1`).
- [x] Squawks 0090 and 0091 verified still live at planning.
- [x] `validateImportedItems` three call sites verified (`:2236`, `:2496`, `:2660`).
- [x] `ITEM_TYPES` confirmed as two independent sources.
- [x] **`renderer.js` is 1576 lines against a 1577 budget — one line of slack.**
      Not a concern for THIS flight (no renderer work), but the follow-on flight's
      sheets leg starts in deficit and must plan an extraction from day one.
- [x] Reviewer's claim of 5 `isCard` sites in `vault-picker-template.js` checked
      and REJECTED — there are 7, as the recon said.

---

## In-Flight

### Technical Approach

Three legs, ordered so the riskiest design is proven before anything depends on it:
fix what is known-wrong, prove the new boundary against adversarial fixtures, then
build the data layer that stores what it admits.

The fixture corpus is reused, not paralleled — its `detects` / `no-detect`
vocabulary already covers what this flight needs, and identity shapes slot into the
same tiers under the same promotion discipline.

### Checkpoints

- [x] Card patterns correct again; no new false positive introduced.
- [x] DD1's boundary survives adversarial near-misses — a job-application `city`,
      a flight-search `destination`, a newsletter `name` all refused.
- [x] An identity profile persists and round-trips through the store, per jar.
- [x] A bundle containing an unknown item type imports its known items, reports
      what it skipped, and does so at preview as well as commit.

### Adaptation Criteria

**Divert if**: DD1's boundary cannot be made to admit the motivating page while
refusing the adversarial set — that would mean the strong-hint rule is not
achievable and the plausibility DD needs re-deciding, not widening in place.

### Legs

- [x] **Leg 1** `fallback-pattern-foundation` — close squawks 0090 and 0091 for
      the CARD family; extract family-agnostic tokenizing primitives. No identity
      patterns. Must add a `card_nameOnCard` case with **no placeholder** — the
      existing test passes only because it supplies `placeholder: 'Name on Card'`,
      the exact crutch squawk 0091 names as non-general.
- [x] **Leg 2** `identity-boundary` — DD1's token table, the identity detector,
      and the adversarial corpus fixtures that prove the boundary. Settles the
      family-conflict open question. No store, no page wiring.
- [x] **Leg 3** `identity-item-type` — schema (both ITEM_TYPES sources), the
      profile shape DD2's conflict rule requires **plus the pure unit-tested
      `classifyCapture`**, DD3's tolerant importer across all three call sites, and
      an explicit ruling on whether the store ENFORCES one profile per vault or
      leaves it to caller discipline (a capture race could otherwise create
      duplicates).
      Note: Leg 3 has no technical dependency on Leg 2 — the profile's field set
      comes from DD1's taxonomy, and DD2/DD3 are decided. The stated ordering is
      risk-retirement narrative, not a hard sequence.

*(Fill, capture, sheets and the HAT move to the follow-on flight — see the scope
note at the top.)*

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Tests passing
- [x] Documentation updated (`docs/vault.md`, CLAUDE.md)
- [x] Squawks 0090 and 0091 marked completed and linked here
- [x] Mission flight list updated to reflect the split

### Verification

- Corpus: identity shapes gated, adversarial near-misses refused, the anonymous
  form still negative, zero offers across the negative set.
- Unit coverage for the token table, the profile shape, the conflict rule, and the
  tolerant importer at all three call sites including the preview report.
- No live HAT in this flight — nothing page-facing ships. The follow-on flight
  carries live acceptance.
