# Squawk 0091: Fallback role words after an underscore-joined prefix are undetected

**Status**: escalated
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: —

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
