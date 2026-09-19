# Squawk 0090: camelCase normalisation widened expiry-role false positives

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: —

## Report

Squawk 0087's `splitCamelHumps` normalisation introduced NEW false positives for
the `expiry` / `expMonth` / `expYear` fallback roles. Unlike `number` and
`cardholder`, those three patterns carry no `card`/`cc` prefix requirement at all,
so once camel humps become spaces they match unrelated expiration-ish field names.

Found by the independent reviewer of the 0086/0087 turnaround, and verified
directly against the shipped module.

## Evidence

Probed against the post-0087 module (all returned `null` before the change):

```
expiry    sessionExpiry
expiry    couponExpirationDate
expiry    passwordExpirationDate
expiry    licenseExpirationDate
expMonth  membershipExpMonth
```

Bounded, but real: these only bite inside a scope that already resolved a
`number` role (`findAllCardFields` discards a scope with no card-number field) AND
carries no `cc-*` autocomplete token. A checkout page with a card-number field and
an unrelated promo/membership expiration field — exactly the hint-free shape 0087
targeted — mis-tags the unrelated field as the card's expiry, capturing or filling
the wrong value. `vault-card-fields.js`'s own header names this class as the
primary risk: *"FALSE POSITIVES ARE THE RISK TO MANAGE, not false negatives."*

Separately confirmed as PRE-EXISTING and out of scope here: `accNumber` resolves
to `number` both before and after 0087, because the `number` pattern's
`(card|cc|creditcard|pan)` group has no leading `\b`.

## Disposition

**Logged open, deliberately NOT folded into 0087.** It fails squawk qualification
criterion 2 (*no design decisions*): the obvious tightening — requiring a
`card`/`cc`/`payment` token to co-occur — would break `expirationMonth`, which is
detected today on genuine card forms and should stay detected. Choosing between
narrower patterns, a co-occurrence rule scoped to the whole form rather than the
field, or accepting the trade is a real decision and likely escalates to a flight.

Accepted knowingly in the meantime: 0087 fixes a demonstrated failure on a real
site (Jostens' `card_cardExpMonth` / `card_cardExpYear` were undetected) and trades
it for a bounded, lower-harm mis-tag risk on mixed forms. A wrong expiry fails a
checkout; it does not leak a secret.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*
