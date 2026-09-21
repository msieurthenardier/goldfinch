# Squawk 0091: Fallback role words after an underscore-joined prefix are undetected

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: 2026-09-19

## Report

`_` is a word character in JS regex, so `\b` never fires between an underscore and
an adjacent letter. Every `FALLBACK_PATTERNS` entry that opens with `\b` therefore
fails when its role word directly follows an underscore-joined prefix — regardless
of camelCase, so squawk 0087's normalisation does nothing for it.

Affects every role except `number`, which is immune only because its pattern
happens to lack a leading `\b` at all.

Surfaced twice: first by the 0087 implementer, whose draft test asserting
`card_nameOnCard` detection failed and who narrowed the test rather than loosening
the pattern to make it pass; then confirmed independently by the batch reviewer.

## Evidence

Probed against the post-0087 module:

```
card_nameOnCard    -> null   (expected: cardholder)
card_securityCode  -> null   (expected: csc)
form_expMonth      -> null   (expected: expMonth)
```

Matters on the very page that motivated Mission 21: two of the five Jostens card
fields use this spelling. They are detected in practice only because the real
markup also supplies placeholder text (`Name on Card`, `Security Code`), which the
haystack picks up — not guaranteed generally.

## Disposition at logging (superseded)

**Logged open. A genuinely SEPARATE defect family from 0087, not evidence that
0087 is incomplete** — the reviewer was asked to judge this specifically and did
so without hedging. 0087 addressed `\b` failing at a camelCase hump (a
letter-to-letter transition with no boundary character present); this is the
independent fact that `\b` never fires against `\w`-class `_`. Camel splitting
cannot help it, and 0087 never claimed to.

Note before fixing: the likely remedy interacts with squawk 0090 (the same
patterns' false-positive exposure). Whoever picks these up should probably take
them together rather than tightening and loosening the same regexes in two passes.

## Disposition

**Escalated** 2026-09-19. Failed squawk qualification criterion 2 (no design decisions).

The remedy interacts directly with 0090 — both change the same
`FALLBACK_PATTERNS` regexes, one loosening and one tightening. Fixing them in two
independent passes risks each undoing the other.

**Escalated to**: Mission 21 ("Saving, Not Just Filling") **Flight 2 — identity
items**, rather than a dedicated flight. Flight 2 must design detection heuristics
for a family with NO structural anchor at all — no `input[type=password]`, no Luhn
— so it is already solving the fallback-pattern problem from scratch. Taking these
two there means one coherent conversation about pattern design instead of hardening
card patterns now and rediscovering the same trade-offs a flight later.

Link the flight artifact here once Flight 2 is planned.

## Corrective Action

Fixed, together with squawk 0090 as anticipated above, in **Mission 21 ("Saving,
Not Just Filling") Flight 2 ("Identity Items"),
[Leg 1 — fallback-pattern-foundation](../missions/21-saving-not-just-filling/flights/02-identity-items/legs/01-fallback-pattern-foundation.md)**.

**Fixed by NORMALISATION, not by loosening a regex** — the patterns themselves
are untouched by this fix (0090's fix does touch them, separately). A new
family-agnostic tokenizer module, `src/preload/field-tokenizer.js`
(`normalizeFieldHaystack`), maps `_` and `-` to a space, IN ADDITION to the
existing camelCase-hump split (0087's fix) — both now run before a field's
haystack is matched against `FALLBACK_PATTERNS`. `card_nameOnCard` normalises to
`card name On Card`, `card_securityCode` to `card security Code`, and
`form_expMonth` to `form exp Month` — each now carries a real space where `\b`
can fire, so the SAME patterns match by name alone, no placeholder text needed.

**Extracted as its OWN module** (not folded into `vault-card-fields.js`), per
this leg's DD6: a second detector family (identity, Flight 2 Leg 2) will
consume the same tokenizing primitive without duplicating it or reaching into
the card module. The module carries no card vocabulary at all. It also extracts
the sibling mechanism DD6 named — the autocomplete-token LOOKUP shape (split an
`autocomplete`-style attribute value on whitespace, resolve each token against a
caller-supplied map) — as `resolveAutocompleteToken`; the card-specific
`AUTOCOMPLETE_ROLES` data itself stays in `vault-card-fields.js`, since it is
entirely card vocabulary.

**Regression discipline**: normalisation and 0090's gate are two independent
mechanisms, tested independently so a regression can be attributed to one or the
other — `test/unit/field-tokenizer.test.js` proves the tokenizer alone (no card
or any family's vocabulary in that suite at all); `test/unit/vault-card-fields.test.js`
proves the card patterns/gate, including a no-placeholder `card_nameOnCard` /
`card_securityCode` variant that fails before this fix and passes after (per this
leg's own acceptance criterion — the exact crutch this squawk names as
non-general is removed from the test).

Negative set re-verified AFTER normalisation (a real risk, not a formality —
normalisation creates new word boundaries): `pan`, `acctNum`, `tenderNumber`,
`paymentNumber`, `creditCard` alone, and `number` alone all still resolve to
`null`.

## Verification

- `test/unit/field-tokenizer.test.js` (new, 16 tests): camelCase splitting,
  digit→uppercase humps, underscore→space, hyphen→space, combined
  underscore+camelCase, no-op on already-normalised/empty strings, no false
  split on consecutive uppercase letters; `resolveAutocompleteToken` — bare
  token, prefix-chain resolution, case-insensitivity, irregular whitespace,
  null/empty/no-match handling.
- `test/unit/vault-card-fields.test.js`: `card_nameOnCard`/`card_securityCode`/
  `form_expMonth` detected from name alone with NO placeholder; the full
  Jostens field set detected from name alone with no placeholders anywhere;
  the pre-existing placeholder-crutched tests still pass unchanged; the
  negative set re-confirmed post-normalisation.
- Before/after probe recorded in the leg's flight-log: `card_nameOnCard` via
  `fallbackRoleOf` resolves `null` against the pre-leg module and `cardholder`
  against the fixed module.
- `npm test` (full suite, timeout-guarded): 5203 pass / 0 fail / 3 pre-existing
  todo. `npm run lint`, `npm run typecheck` clean. `npm run format` run.
- CI itself (local Concourse) was not run — it needs an interactive login
  unavailable to this agent; the local gates above stand in for it.

## Sign-Off

**Reviewer**: independent Reviewer, flight-end review batched across Flight 2's
legs (see `flight.md`'s Technical Approach) — reviewed as part of PR #226's
flight-end review, which reported no blocking issues.
**Verdict**: confirmed
**Commit**: `016e540` — `flight/02: Identity Foundations (Mission 21) (#226)`
