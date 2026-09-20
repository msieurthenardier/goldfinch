# Leg: fallback-pattern-foundation

**Status**: completed
**Flight**: [Identity Foundations](../flight.md)

## Objective

Make the card family's fallback detection correct again — closing escalated squawks
0090 and 0091 — and extract the tokenizing primitive a second family will need.
**No identity patterns are written in this leg.**

## Context

Flight DD6. Both squawks concern `FALLBACK_PATTERNS` in
`src/preload/vault-card-fields.js`, and they pull in opposite directions (0090
tightens, 0091 loosens), which is why they were escalated to be fixed together
rather than in two passes that could undo each other.

**0090 is a regression this project shipped** in squawk 0087: `splitCamelHumps`
widened the expiry roles enough that unrelated fields now match.

## Inputs (verified at design time)

- `src/preload/vault-card-fields.js` — `FALLBACK_PATTERNS` (six entries, every one
  currently anchored on `\b` or `^…$`), `splitCamelHumps` (camelCase only:
  `str.replace(/([a-z0-9])([A-Z])/g, '$1 $2')`), `fallbackRoleOf`, `rolesIn`,
  `findAllCardFields`.
- Underscore tolerance today lives inside each regex's `[-_ ]?` class, **not** in a
  normalisation step.
- Current behaviour, probed directly:
  - `sessionExpiry` → `expiry`, `couponExpirationDate` → `expiry`,
    `membershipExpMonth` → `expMonth` (0090, all should be null)
  - `card_nameOnCard` → `null`, `card_securityCode` → `null` (0091)
  - `accNumber` → `number` (pre-existing, adjacent — see Scope)

## Acceptance Criteria

- [x] **0091 closed by NORMALISATION, not by loosening a regex.** The tokenizer
      maps `_` and `-` to spaces in addition to splitting camel humps, so
      `card_nameOnCard` → `cardholder` and `card_securityCode` → `csc` **by name
      alone**. The existing `card_nameOnCard` test passes only because it also
      supplies `placeholder: 'Name on Card'` — the exact crutch 0091 names as
      non-general. **Add a no-placeholder variant**; it must fail before the fix.
- [x] **0090 closed by a TWO-CONDITION GATE on the expiry family** — selection
      alone does not fix it. An `expiry` / `expMonth` / `expYear` candidate
      qualifies only if EITHER (a) its own haystack carries a card-context token
      (`card` / `cc` / `credit` / `payment`), OR (b) it sits within a stated,
      constant window of candidate-field positions from the detected card-number
      anchor. Both halves are needed:
      - (a) alone would reject `expirationMonth` — a real spelling on real card
        forms, detected today. That is buying the fix with a false negative.
      - (b) alone is what an earlier draft of this leg proposed as
        anchor-proximity SELECTION, and design review proved it largely cosmetic:
        four of 0090's five evidence lines are SINGLE-candidate scopes, where
        proximity has nothing to select between. Verified by tracing the squawk's
        own evidence through the proposed patterns.
      - Together they admit a card form's adjacent `expirationMonth` and reject a
        `sessionExpiry` sitting elsewhere in the same form.
- [x] **The window is BIDIRECTIONAL** — `|candidate.index - anchor.index| <= W`,
      never forward-only. Real forms place cardholder or expiry BEFORE the number
      field, and a forward-only check would silently create a new false negative on
      those — the same class of incomplete fix this leg already had to correct
      once. **A regression case with the expiry PRECEDING the number in DOM order
      is required**; no fixture in the repo exercises a reversed order today, so the
      gap is untested by construction.
- [x] **The window is a named constant with its own tests**, and its value is
      justified rather than taste. Distance probes at design review show the anchor
      → its-own-expiry distance stays at 2–3 even with 16 preceding billing fields
      (those sit BEFORE the anchor, not between it and the candidate), and reaches
      3 with two unrelated card-capable selects interleaved. **A value of 4–6 is
      defensible, derived from "one card entry's own field count" (number, name,
      month, year, csc ≈ 5)** — pick within that range and state the derivation in
      a comment.
- [x] **When the gate admits MULTIPLE candidates for one role, the winner is
      first-match in document order among survivors** — not nearest-to-anchor. The
      design is gate-then-first-match, consistent with the rest of the module.
      (An earlier draft's "ties in proximity" language belonged to the superseded
      selection-based design and is removed.)
- [x] **Honest residual, named CONCRETELY in a comment AND in the squawk's
      closure** — not left abstract: a `couponExpirationDate` laid out adjacent to
      the payment section still resolves as the card's expiry. That is one of
      0090's own five evidence lines, and promo-code fields commonly sit beside
      payment on real checkouts, so it is foreseeable rather than remote.
      **Squawk 0090 therefore closes as `completed` with an explicitly-named
      accepted residual**, not a blanket completion.
- [x] **The 0090 closure must state the fix is PIPELINE-level, not field-level.**
      `fallbackRoleOf({name:'sessionExpiry'})` called in isolation still returns
      `'expiry'` after this leg — correctly, because the gate lives in `rolesIn`
      and depends on the anchor, which a bare field probe has no notion of. The
      squawk's original evidence was phrased as bare `fallbackRoleOf` probes, so
      without this note a future reader will expect `null` and be confused.
- [x] **Accepted non-goal, stated once so it is not mistaken for an oversight**:
      `giftCardExpiryDate` / `loyaltyCardExpMonth` pass condition (a) purely
      because they contain the literal token `card`. This mirrors an ambiguity
      already present in the `number` pattern's own `(card|cc|creditcard|pan)`
      group — not new, not addressed here.
- [x] **A full-pipeline regression test** (through `findAllCardFields`, not just
      `fallbackRoleOf`) reproduces a scope containing a card number plus ONLY a
      `sessionExpiry`, and asserts it is now rejected. A field-level probe cannot
      prove this gate, because the gate depends on the anchor.
- [x] **A disqualifier denylist was considered and REJECTED** — unbounded, and
      fragile in exactly the way these patterns have already failed twice.
- [x] **`expirationMonth` and every other currently-detected spelling still
      resolves.** The fix must not buy 0090 with false negatives. Regression-pin
      the existing positive set explicitly — **including the literal no-separator
      spellings `ccmonth`, `ccyear`, `ccexp`**, which are the ONLY cases the
      `^…$` anchored alternatives still cover. Without them pinned, a future edit
      that removes those dead-looking alternatives regresses silently.
- [x] **The pre-existing `accNumber` → `number` false positive is closed** by
      anchoring the `(card|cc|creditcard|pan)` group on a word boundary — `cc`
      currently substring-matches inside `acc`. In scope because it is the same
      class, in the same patterns this leg is already editing. Must not break
      `payment.cardNumber` or `card_cardNumber`.
- [x] **The tokenizer is extracted as a family-agnostic primitive** — its own
      module, `require`-able, unit-tested independently, with no card vocabulary in
      it. Identity will consume it in Leg 2; this leg writes no identity patterns.
- [x] **The autocomplete-token LOOKUP MECHANISM is extracted too** (split the
      attribute on whitespace, resolve each token against a caller-supplied map) —
      the data (`AUTOCOMPLETE_ROLES`) stays card-side, since it is entirely card
      vocabulary. DD6 named both halves; the leg's first draft silently narrowed to
      the string half. Leg 2 needs this shape for DD1's WHATWG tokens and the login
      family has NO precedent to borrow from, so without it Leg 2 would either
      duplicate the mechanism or reach into this leg's file.
- [x] **The two changes are separately tested.** Normalisation and selection are
      independent mechanisms; a test suite that can only prove them together cannot
      tell which one regressed.
- [x] Negative set unchanged: `pan`, `acctNum`, `tenderNumber`, `paymentNumber`,
      `creditCard` alone, `number` alone all still resolve to `null` **after**
      normalisation — normalisation creates new word boundaries, so this is a real
      risk, not a formality.
- [x] `npm test` green; squawks 0090 and 0091 updated to `completed` with sign-off
      and linked to this flight.

## Verification Steps

- Unit tests in `test/unit/vault-card-fields.test.js` plus a new suite for the
  extracted tokenizer.
- A before/after probe recorded in the flight log for each of the three symptom
  spellings (`sessionExpiry`, `card_nameOnCard`, `accNumber`).
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`.
- **Note**: CI is local Concourse and needs an interactive login unavailable to the
  crew — run the local gates and say so rather than implying CI ran.

## Implementation Guidance

1. **Extract the tokenizer first**, on its own, with its own tests, before touching
   any pattern. It is the piece a second family depends on, and conflating it with
   the regression fixes is this leg's stated risk (DD6).
2. **Normalisation**: `_`/`-` → space, plus the existing camel-hump split. The
   regexes' `[-_ ]?` classes already match a space, so this is backward-compatible
   by construction — but prove it with the positive regression pin, do not assume.
3. **Restructure `rolesIn` — this is surgery, not a checkpoint.** Design review
   corrected the leg's earlier description: `rolesIn` does NOT resolve `number`
   first in any staged sense. Both passes are single linear scans where each field
   claims its own role and `roles.set` fires immediately if the slot is empty, so
   by the time `findAllCardFields` can name the anchor, every other role is already
   locked by first-match-wins. Implementing the gate requires two phases:
   (1) resolve the anchor's field and its index, (2) collect ALL candidates per
   remaining role and apply the gate. Verified feasible: `candidateFields(scope)`'s
   array index is a faithful document-order proxy, and the fake-DOM test contract
   already returns fixed insertion order — no new DOM surface is needed.
   **Scope the gate to the FALLBACK pass only.** The autocomplete pass keeps
   first-match-wins; its existing comment about "a checkout with a hidden duplicate
   keeps the first live one" stays true and must not go stale.
4. **Do NOT write identity patterns, a scope-anchor rule, or anything
   identity-shaped.** That is Leg 2, and it depends on a matching algorithm this
   leg does not choose.

## Edge Cases

- **Normalisation creating new matches.** Mapping `_` to a space fires word
  boundaries that previously did not. That is the point for 0091 and the hazard for
  everything else — the negative set is the guard.
- **A scope with no number field** resolves nothing, unchanged.
- **Multiple survivors of the gate** — first document order wins, per the AC. The
  superseded selection design's tie-breaking language is gone.
- **Expiry before the number in DOM order** — admitted, because the window is
  bidirectional. Explicitly tested.

## Out of Scope

- Identity patterns, the scope-anchor rule, the matching algorithm — Leg 2.
- The store, the schema, the importer — Leg 3.
- Anything page-facing.

## Files Affected

- `src/preload/vault-card-fields.js` — patterns, selection, tokenizer call.
- New tokenizer module + its test.
- `test/unit/vault-card-fields.test.js`.
- `squawks/0090-*.md`, `squawks/0091-*.md` — completion records.

## Citation Audit

Verified at design time (2026-09-19): `FALLBACK_PATTERNS`' six entries and their
`\b`/`^…$` anchoring confirmed verbatim; `splitCamelHumps` confirmed camelCase-only;
underscore tolerance confirmed to live in the regexes' `[-_ ]?` classes, not a
normalisation step. All three symptom behaviours (`sessionExpiry` → `expiry`,
`card_nameOnCard` → `null`, `accNumber` → `number`) reproduced by direct probe
against the current module, not inferred.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] `npm run format` run
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed`; squawks 0090/0091 to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — review and commit are deferred to the end of the flight
