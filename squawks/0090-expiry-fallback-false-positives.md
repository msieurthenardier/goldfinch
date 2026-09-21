# Squawk 0090: camelCase normalisation widened expiry-role false positives

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: 2026-09-19

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

## Disposition at logging (superseded)

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

## Disposition

**Escalated** 2026-09-19. Failed squawk qualification criterion 2 (no design decisions).

Tightening the `expiry`/`expMonth`/`expYear` patterns to require a `card`/`cc`
token would break `expirationMonth`, which is detected today on genuine card forms
and should stay detected. Choosing between narrower patterns, a co-occurrence rule
scoped to the form rather than the field, proximity-to-the-number-field, or
accepting the trade is a real design decision.

**Escalated to**: Mission 21 ("Saving, Not Just Filling") **Flight 2 — identity
items**, rather than a dedicated flight. Flight 2 must design detection heuristics
for a family with NO structural anchor at all — no `input[type=password]`, no Luhn
— so it is already solving the fallback-pattern problem from scratch. Taking these
two there means one coherent conversation about pattern design instead of hardening
card patterns now and rediscovering the same trade-offs a flight later.

Link the flight artifact here once Flight 2 is planned.

**Watch item (raised at review, recorded deliberately):** this is a regression
this project shipped, deferred to a flight with no firm date — Mission 21's
flights are planned one at a time. If Flight 2 slips significantly, re-escalate
THIS squawk to `grounding` rather than leaving it riding an indefinitely
postponed flight. The deferral is defensible because the fix needs a design
decision and the impact is bounded; it stops being defensible if "later" becomes
"never".

## Corrective Action

Fixed in **Mission 21 ("Saving, Not Just Filling") Flight 2 ("Identity Items"),
[Leg 1 — fallback-pattern-foundation](../missions/21-saving-not-just-filling/flights/02-identity-items/legs/01-fallback-pattern-foundation.md)**,
after two design-review rounds recorded in that flight's flight-log (round 1
rejected an anchor-proximity SELECTION design as largely cosmetic; round 2 found
the window direction unspecified and pinned it bidirectional).

**⚠ PIPELINE-level fix, not field-level — read this before re-probing.** The fix
lives in `rolesIn`/`findAllCardFields` (`src/preload/vault-card-fields.js`), NOT
in `fallbackRoleOf`. Calling `fallbackRoleOf({name:'sessionExpiry'})` in isolation
**still returns `'expiry'`** after this fix — correctly — because the gate needs
a resolved card-number ANCHOR, which a bare field-level probe has no notion of.
The squawk's own evidence above was phrased as bare `fallbackRoleOf` probes; a
future reader re-running that exact probe will see no change and should not read
that as a regression. The real coverage is at the `findAllCardFields`/
`findCardFields` pipeline level — see the Verification section below.

**The fix — a two-condition gate on the expiry family only**
(`expiry`/`expMonth`/`expYear`; every other fallback role stays plain
first-match-wins, unchanged). A candidate qualifies iff EITHER:
  - **(a)** its own haystack carries a card-context token (`card`/`cc`/`credit`/
    `payment`, word-bounded, post-normalisation) — admits `expirationMonth`,
    `cc-exp-month`-style names, `card_cardExpMonth`, etc. regardless of where
    they sit in the form; or
  - **(b)** it sits within `EXPIRY_ANCHOR_WINDOW` (= 5, named constant, derived
    from one card entry's own field count — number/name/month/year/csc ≈ 5) of
    the detected card-number anchor's position among `candidateFields(scope)`,
    in EITHER direction (bidirectional — an earlier draft's forward-only design
    was caught and corrected at round 2, since real forms sometimes place expiry
    BEFORE the number field).

Each half alone fails: (a) alone would reject `expirationMonth`, an
already-shipped, already-tested spelling (a false negative this squawk must not
buy); (b) alone was tried first (anchor-proximity SELECTION) and round 1 review
proved it largely cosmetic — four of this squawk's five evidence lines are
single-candidate scopes at the field-probe level, where selection has nothing to
select between. The two together admit a card form's own adjacent
`expirationMonth` and reject an unrelated `sessionExpiry`/`passwordExpirationDate`/
`licenseExpirationDate`/`membershipExpMonth` sitting elsewhere in the same form,
verified against all five of this squawk's own evidence lines.

A disqualifier denylist (`session`, `coupon`, `password`, `license`, …) was
considered and rejected — unbounded, and fragile in exactly the way these
patterns have already failed twice (0087, this squawk).

**Also folded in, same class, same patterns already being edited**: the
`number` pattern's `(card|cc|creditcard|pan)` group gained a leading `\b` —
`cc` was substring-matching inside `acc`, so `accNumber`/`acctNumber`/
`successNumber` resolved as a card number. Verified this closes those three
without affecting `payment.cardNumber`, `card_cardNumber`, `cc_number`,
`ccNumber`, `cardNumber`, `creditCardNumber`, `cardNo`, `CCNumber`,
`cardNumberDisplay`, or `ccNumberInput`.

**NAMED ACCEPTED RESIDUAL — closing this as `completed`, not a blanket clean
close.** An unrelated expiry-shaped field laid out genuinely ADJACENT to the
card number — e.g. `couponExpirationDate` right beside the payment section, one
of this squawk's own five evidence lines — still resolves as the card's expiry,
via condition (b). Narrower than before this fix (it previously fired from
anywhere in the scope, not just adjacent), and stated here rather than silently
papered over. Promo-code fields commonly sit beside payment on real checkouts,
so this is foreseeable, not remote.

**Accepted non-goal, not new**: `giftCardExpiryDate` / `loyaltyCardExpMonth`
pass condition (a) purely on the literal token `card`. This mirrors an ambiguity
the `number` pattern's own `(card|cc|creditcard|pan)` group already has, and is
not addressed here.

The tokenizing primitive this fix's normalisation step depends on
(`src/preload/field-tokenizer.js`) is shared with squawk 0091's fix — both land
in this same leg per DD6, since fixing the same regexes in two independent
passes risked each undoing the other.

## Verification

- Before/after probes recorded in the leg's flight-log entry, at both the
  field level (`fallbackRoleOf`, confirming the trap above: `sessionExpiry`
  unchanged) and the pipeline level (`findCardFields`/`findAllCardFields`,
  confirming the actual fix).
- `test/unit/vault-card-fields.test.js`: dedicated pipeline-level regression
  tests for the bidirectional window, the window's inclusive boundary (admit at
  exactly `EXPIRY_ANCHOR_WINDOW`, reject one past it), condition (a) admitting
  regardless of distance, all five of this squawk's evidence lines rejected when
  realistically distant from the anchor, the named residual (adjacent
  `couponExpirationDate` still resolving), the `accNumber`/`acctNumber`/
  `successNumber` fix plus its unaffected-positives list, and the pipeline-vs-
  field-level trap itself.
- `npm test` (full suite, timeout-guarded): 5203 pass / 0 fail / 3 pre-existing
  todo. `npm run lint`, `npm run typecheck` clean. `npm run format` run.
- CI itself (local Concourse) was not run — it needs an interactive login
  unavailable to this agent; the local gates above stand in for it.

## Sign-Off

**Reviewer**: independent Reviewer, flight-end review batched across Flight 2's
legs (see `flight.md`'s Technical Approach and `flight-log.md`'s Leg 1 entries
for the two PRIOR design-review rounds this leg itself already went through
before implementation) — reviewed as part of PR #226's flight-end review, which
reported no blocking issues.
**Verdict**: confirmed
**Commit**: `016e540` — `flight/02: Identity Foundations (Mission 21) (#226)`
