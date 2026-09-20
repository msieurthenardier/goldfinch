# Leg: identity-boundary

**Status**: completed
**Flight**: [Identity Foundations](../flight.md)

## Objective

Pin the matching algorithm, implement DD1's scope-anchor admissibility rule as a
detector, and **prove the boundary against adversarial fixtures before anything
depends on it**. Settle the login/identity precedence question. No store, no page
wiring.

## Context

Flight DD1. This is the leg the flight's central bet lives or dies in: identity has
no structural anchor and no plausibility gate, so admissibility is the whole
security story. Leg 1 delivered the tokenizer this builds on
(`field-tokenizer.js` — `normalizeFieldHaystack`, `resolveAutocompleteToken`).

## Design Decisions (leg-level)

**LD1 — A role is a list of ALTERNATIVES, each an all-tokens-required SET.
Matching is conjunctive within an alternative, disjunctive across them, and the
alternative matching the MOST tokens wins.** Not a flat token set.
- Why not flat — verified by running Leg 1's real tokenizer, not reasoned:
  ```
  billingAddress1  -> ["billing","address1"]        <- NO "address" token exists
  billingFirstName -> ["billing","first","name"]
  billingLastName  -> ["billing","last","name"]     <- both contain "name"
  emailAddress     -> ["email","address"]
  ```
  A flat OR-set cannot reach `billingAddress1` at all without an explicit
  `address1` entry — and the leg's own first draft listed `addr1` (the
  abbreviation) but not `address1` (**the literal motivating spelling**), so the
  Jostens fixture could have anchored on its postcode while silently dropping its
  street address. A flat set also cannot tell a first-name field from a last-name
  field from a full-name field, because all three carry `name`; whichever role a
  naive implementation checked first would win.
- Shape: `street: [ {address1}, {address2}, {addr1}, {addr2}, {street,address},
  {address,line1}, {address,line2} ]`, `firstName: [ {first,name}, {fname},
  {given,name} ]`, `fullName: [ {name} ]`, and so on. Longest-match wins, so
  `{first,name}` beats `{name}` on `billingFirstName`.
- **The vocabulary must be written TWICE, once per mechanism**, because the two
  paths normalise differently: autocomplete values go through
  `resolveAutocompleteToken`, which splits on whitespace only and leaves hyphens
  intact (`postal-code` stays one token); name/id fallback goes through
  `normalizeFieldHaystack`, which turns hyphens into spaces first
  (`postal-code` → `["postal","code"]`). **A vocabulary literal copied from DD1's
  prose into the fallback path is a DEAD ENTRY that never fires** — silently, and
  invisibly if another spelling happens to cover the same role by luck.

**LD4 — Three round-2 decisions, made rather than escalated (see flight log).**
- **`address` is never bare-admissible**, at anchor or field. Closes the
  `emailAddress` tie. Flight DD1 amended accordingly.
- **An anchored scope needs ≥1 non-postal role** (name / email / phone). Closes the
  shipping-cost estimator. Address-plus-phone still qualifies, so this refuses only
  postal-ONLY scopes.
- **The incident-form shape is an ACCEPTED, NAMED false positive.** A form carrying
  a third party's address plus the reporter's own name and email clears every gate
  — and DD1's own founding principle ("nothing is inferred from shape, position or
  value") structurally forbids the only signal that could tell whose address it is.
  It is irreducible to a vocabulary-only detector, so it is accepted rather than
  pretended away. **DD2's conflict rule is the backstop**: a differing value never
  silently overwrites, it surfaces an explicit update naming what changes. The
  fixture stays in the corpus, pinned as admitted-with-reasoning.

**LD2 — The scope anchor is evaluated BEFORE any field is admitted.** A scope
qualifies only if it contains at least one admissible POSTAL role
(street/address-line, postal-code, or a prefix-qualified city/country). If it does
not, the detector returns nothing for that scope — no field is inspected further.
- **Anchor-qualification is a SEPARATE, UNGATED predicate that never consults
  anchored state.** Otherwise it is circular: field admissibility depends on the
  scope being anchored, and the anchor is computed from admissible fields.
- **Prefix-qualification is evaluated on a SINGLE FIELD's own haystack**, never
  across the scope. A per-scope reading would let an unrelated `billing_department`
  field plus a stray bare `city` jointly satisfy the anchor.
- **Bare `address` is NOT anchor-eligible.** It must be qualified (`address1`,
  `addr1`, `street address`, `address line…`, `billing address`). This is what
  stops `emailAddress` — which tokenizes to `["email","address"]` — from anchoring
  a newsletter form on a stray `address` token, i.e. exactly the over-admitted-email
  failure DD1 was rewritten to close.
- Rationale: DD1. The anchor replaces the structural signal identity lacks, and
  evaluating it first makes the refusal cheap and the code's intent obvious.

**LD3 — Login wins a contested field; identity yields.** Where the login detector
has claimed a field, identity must not also claim it.
- Rationale, and it is NOT what it looks like: `resolveLoginEntry`
  (`vault-fill-fields.js`) picks the username as the LAST text/email/tel input
  **preceding a password field, by document position only** — verified at design
  time; it never reads name, id or autocomplete. So the contest is structural, not
  name-based: any identity-admissible field sitting before a password is claimed by
  login regardless of spelling. A name-based precedence rule would simply not
  engage.
- Login wins because its claim is anchored on `input[type=password]`, a structural
  fact, while identity's is a vocabulary judgement. The stronger anchor wins.
- **This leg must leave a CALLABLE artifact, not prose plus a passing test.**
  Export a predicate — `isClaimedByLogin(field, doc)` — that Flight 3 is committed
  to calling, or have `findAllIdentityFields` itself refuse to double-claim. A test
  that merely computes both detectors' verdicts and documents the expectation in a
  comment would leave Flight 3 re-deriving the rule, which is this project's
  recurring failure mode.
- Enacting it in the live page is still Flight 3's wiring; this leg does not change
  the login detector.

## Acceptance Criteria

- [x] A pure, `require`-able identity detector module exists, consuming Leg 1's
      tokenizer, with no page or store coupling.
- [x] **LD2's scope anchor is enforced**: a scope with no postal role yields
      nothing, proven by a fixture whose fields would otherwise qualify.
- [x] **The motivating page passes**: a Jostens-shaped fixture
      (`billingFirstName`, `billingLastName`, `billingEmail`, `billingPhone`,
      `billingAddress1`, `billingCity`, `billingPostalCode`, `billingCountry`,
      all with `autocomplete="on"` — i.e. useless hints) is detected as an identity.
- [x] **The adversarial set is REFUSED, each as a named fixture**: a job
      application with a bare `city`; a flight search with `destination`; a
      newsletter with `name` + `email` and no address; and the existing anonymous
      `field1`/`field2`/`field3` shape.
- [x] **The named spellings from flight design are decided, not discovered** —
      `addr1`, `zipcode`, `fname`/`lname`, `mobile`, `emailAddress`,
      `streetAddress`, **`postcode`** (a glued lowercase token like `zipcode`,
      needing its own literal entry — the first draft named only `zipcode`),
      and a bare single-field "Full Name" checkout — each pinned
      as admitted or refused with the vocabulary ALTERNATIVE that decides it.
      **`address1`, `address2` and a bare `billingAddress` are named cases too** —
      the digit-suffixed longhand is the literal motivating spelling and the first
      draft omitted it.
- [x] **`assertDetectsEntry`'s family dispatch becomes THREE-WAY.** It is
      currently `family === 'card' ? findAllCardFields : findAllLoginFields`
      (`save-moment-assertions.js:145`), so `'identity'` silently falls through to
      the LOGIN detector — meaning every POSITIVE identity fixture would assert
      against the wrong family and could pass for entirely the wrong reason. The
      leg's first draft named only its sibling; this is the one that proves the
      positive criteria.
- [x] **`assertNoDetectableEntry` is extended to the identity family.** It
      currently asserts only that login and card find nothing
      (`save-moment-assertions.js`), so without this EVERY existing
      negative-detection fixture silently stops covering the new family the moment
      it is added. This is the single easiest thing in this leg to miss.
- [x] The corpus `family` union becomes three-way (`'login' | 'card' | 'identity'
      | null`) and the manifest documents it.
- [x] **LD3 is proven by unit test against the REAL `resolveLoginEntry`**, not a
      restatement: a fixture with an identity-admissible field immediately
      preceding a password shows login claiming it positionally, and the
      precedence rule yielding.
- [x] **The prefix vocabulary for city/country qualification is NAMED**, not left
      to the implementer: `billing`, `shipping`, `delivery`, `mailing`, `contact`,
      `home`, `work`. Omission or inclusion is a stated choice.
- [x] **`isClaimedByLogin(field, doc)` is built from the already-exported
      `findAllLoginFields`** — check `field === entry.username` across entries.
      This satisfies LD3's callable-artifact requirement without touching
      `vault-fill-fields.js`, as the constraint requires.
- [x] **Two further adversarial fixtures that DO anchor but are not identities**:
      a shipping-cost estimator (`zip` + `country`, no name, no email) and an
      incident form describing a THIRD-PARTY location (`city`/`address`/`zip` for
      where the problem is) plus a reporter's `name`/`email`. Every adversarial
      fixture in the first draft failed to anchor — none probed a scope that
      anchors correctly and still should not be treated as the operator's identity.
      Pin each either way, with reasoning.
- [x] **The per-field haystack builder is extracted** alongside Leg 1's tokenizer
      (`[name, id, placeholder, aria-label].join(' ')`, currently private to
      `vault-card-fields.js`), so the two families cannot drift on which attributes
      feed detection.
- [x] No store, no schema, no page wiring, no capture. `npm test` green.

## Verification Steps

- New unit suite for the detector; new corpus fixtures under
  `test/fixtures/save-moment/`, registered in the manifest as the sole tier source.
- The adversarial fixtures must FAIL against a detector without LD2's anchor —
  demonstrate that, so the anchor is proven load-bearing rather than assumed.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`.
- CI is local Concourse needing an interactive login unavailable to the crew — run
  local gates and say so.

## Implementation Guidance

1. **Write the vocabulary and the adversarial fixtures BEFORE the detector.** DD1
   says the table is not trusted until attacked; building the detector first
   invites fitting the vocabulary to whatever it happens to do.
2. Reuse `normalizeFieldHaystack` verbatim. Do not write a second normaliser.
3. Keep the detector's shape recognisable to the card family's
   (`findAllIdentityFields(doc)` → entries), so Flight 3 can wire it the same way.
4. Do NOT touch `vault-fill-fields.js` or the login detector.

## Edge Cases

- **A scope with an address but nothing else** — an address-only form. Decide
  explicitly whether a one-field identity is worth detecting; pin either way.
- **Two identity scopes in one document** (billing and shipping) — the detector
  returns both; which is "the" identity is Flight 3's problem, not this leg's.
- **A postal field that is also login-claimed** — LD3 applies; the anchor itself
  can be contested.

## Out of Scope

- The store, the schema, `classifyCapture` — Leg 3.
- Fill, capture, sheets, enacting LD3 — Flight 3.

## Files Affected

- New identity detector module + its test.
- `test/fixtures/save-moment/` — new fixtures; `manifest.js` three-way family.
- `test/helpers/save-moment-assertions.js` — BOTH `assertNoDetectableEntry` and
  `assertDetectsEntry` (three-way dispatch).
- `src/preload/field-tokenizer.js` — haystack-builder extraction.

## Citation Audit

Verified at design time (2026-09-19): `field-tokenizer.js` exports
`normalizeFieldHaystack` and `resolveAutocompleteToken` (Leg 1, landed).
`resolveLoginEntry` confirmed to select by document position only — it reads
`input.type` and nothing else, never name/id/autocomplete.
`assertNoDetectableEntry` confirmed to assert emptiness for login and card only.
Manifest `family` confirmed as `'login' | 'card' | null`.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing; `npm run format` run
- [x] Flight log updated; leg status `completed`; checked off in flight.md
- [x] Do NOT commit — deferred to flight end
