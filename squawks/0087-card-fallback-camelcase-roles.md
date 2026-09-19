# Squawk 0087: Card fallback patterns miss camelCase role names

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-18
**Completed**: 2026-09-19

## Report

Every fallback pattern in the card field detector ends in `\b`, which never fires
at a camelCase hump. Detection therefore only works when the role word lands at the
END of the name, which is arbitrary: `creditCardNumber` matches, `ccExpMonth` does
not.

Found during the live Jostens investigation that motivated Mission 21. On that real
payment page, running the real `findAllCardFields` against the captured markup
detected `card_cardNumber`, `card_nameOnCard` and `card_securityCode` but MISSED
`card_cardExpMonth` and `card_cardExpYear` — so a card saved from that site gets a
null expiry and a fill leaves Exp Date blank.

Other affected spellings: `cardNumberDisplay`, `ccNumberInput`,
`creditCardExpirationMonth`, `cardSecurityCode`, `cvvNumber`, `cardholderName`.

## Evidence

- `src/preload/vault-card-fields.js:FALLBACK_PATTERNS` — every entry ends `\b`.
- Probed against the real module: `fallbackRoleOf({name:'ccExpMonth'})` → `null`;
  `fallbackRoleOf({name:'creditCardNumber'})` → `'number'`.
- The fallback runs only on forms carrying no `cc-*` autocomplete token at all —
  the Jostens payment page has zero `autocomplete` attributes, so it is the only
  detection path there.

## Corrective Action

Added a `splitCamelHumps(str)` helper in `src/preload/vault-card-fields.js` that
inserts a space at every camelCase hump (a lowercase letter or digit immediately
followed by an uppercase letter) — `ccExpMonth` becomes `cc Exp Month`. This
gives `FALLBACK_PATTERNS`' existing `\b` anchors a real boundary to fire on at
an internal hump, which a plain letter-to-letter transition never provided
regardless of case.

`fallbackRoleOf` now normalizes the built haystack (name + id + placeholder +
aria-label, joined) through `splitCamelHumps` once, before running it against
`FALLBACK_PATTERNS`, in place of testing the raw haystack. `FALLBACK_PATTERNS`
themselves are byte-for-byte unchanged — per the squawk's own diagnosis,
normalizing the haystack rather than loosening the regexes is what keeps the
module's stated false-positive resistance intact: a role word still has to
land at a real word boundary (start/end of name, an existing separator, or now
also a camelCase hump) to match at all.

No other files touched; `parseExpiry` (squawk 0086) is untouched.

## Verification

Extended `test/unit/vault-card-fields.test.js` with four new tests, alongside
0086's additions (not disturbed):

- `squawk 0087: camelCase role names are now detected by name alone` — asserts
  `fallbackRoleOf` now resolves `ccExpMonth`, `ccExpYear`,
  `creditCardExpirationMonth`, `creditCardExpirationYear`, `cardNumberDisplay`,
  `ccNumberInput`, `cardSecurityCode`, `cvvNumber`, `cardholderName`, and the
  real-world `card_cardExpMonth` / `card_cardExpYear` spellings.
- `squawk 0087: the real Jostens field set now detects a complete card entry`
  — an integration-level `findCardFields` check over a form shaped like the
  captured Jostens markup (zero `autocomplete` attributes), confirming
  `expMonth`/`expYear` are now resolved where they previously were missed
  (the field name/id set is name-only for number/month/year, matching the
  reported `card_cardExpMonth`/`card_cardExpYear` spelling; cardholder/csc
  additionally carry realistic placeholder text, since those two were already
  detected pre-fix per the report and this test's new coverage is the
  previously-missed expiry pair).
- `squawk 0087: previously-working non-camelCase and boundary-adjacent names
  are unaffected` — re-asserts every name in the squawk's "still detected
  exactly as today" list (`creditCardNumber`, `cardNumber`, `ccNumber`,
  `cc_number`, `card-number`, `cardNo`, `CCNumber`, `payment.cardNumber`,
  `cvv`, `securityCode`, `expirationMonth`, `nameOnCard`) still resolves to
  its expected role.
- `squawk 0087: camelCase splitting introduces no new false positives` — the
  negative group the squawk called out explicitly (`pan`, `acctNum`,
  `tenderNumber`, `paymentNumber`, `creditCard` alone, `number` alone) all
  stay `null` after normalization.

Ran and confirmed green:
- `node --test test/unit/vault-card-fields.test.js` — 30/30 pass (including
  0086's tests).
- `npm test` — full suite, 5173 tests, 5170 pass / 0 fail / 3 todo.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format` — no diff (already Prettier-clean).

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-19 turnaround
**Verdict**: confirmed — corrective action correct, tested, and confined to the
reported surface; non-vacuousness verified by running both functions against the
pre-fix file and confirming the new tests would fail there
**Commit**: see `squawk: turnaround 2026-09-19`
