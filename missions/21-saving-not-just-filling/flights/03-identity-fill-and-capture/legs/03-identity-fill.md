# Leg: identity-fill

**Status**: completed
**Flight**: [Identity Fill and Capture](../flight.md)

## Objective

Make a stored identity profile fillable into a live page: detection wired into the
isolated world, a third in-field icon kind, a third picker arm, an in-world
identity fill, and `fillHuman`'s third type branch — and close the fill-precision
regression for all three families with an integer ordinal. No capture; that is
Leg 4.

## Context

- **Flight DD2** (the `anchorRole` propagation), **DD5** (card beats identity;
  `isClaimedByCard` checks all six card roles), **DD7** (identity fill is NOT
  origin-gated; automation stays login-only), **DD8** (identity's two-icon
  placement, the `anchorKinds()` walk, the `nonPostalCandidate` propagation),
  **DD9** (the ordinal fill fix, a shared helper, the `callScript`
  single-argument constraint, `npm run build:preload`), **DD11** (detection in
  the isolated world, no new trust boundary). Read all six in full.
- Legs 1-2 landed (uncommitted by design). Leg 1's `KIND_TABLE` in
  `vault-picker-template.js` makes the picker's third family a one-key addition.
- **2 unproven adversarial axes**: the icon's third kind, and the ordinal fill fix.
- **This flight's standing lesson, now three incidents deep**: enumerate by SHAPE,
  never by spelling. The Citation Audit below does so; the implementer must too.

## Inputs — the fill path, enumerated by shape

Every consumer of the two existing finders (`grep -rn
"findAllCardFields\|findAllLoginFields" src/`), each of which needs an identity
counterpart:

| site | today | this leg |
|---|---|---|
| `vault-entry-observer.js:86-94` | injects login + card finders | + identity finder, `IDENTITY_ROLES` |
| `vault-entry-observer-bootstrap.js:29-39` | requires + passes both; `fillLogin`/`fillCard` handle methods | + identity; `fillIdentity` method |
| `vault-entry-tracker.js:52-60` `resolveTargetForAnchor` | login then card arm | + identity arm (last) |
| `vault-entry-tracker.js` `fillLogin`/`fillCard` routers, `EMPTY_SNAPSHOT`, `readSnapshot` shape check | two families | + identity, and the DD9 ordinal |
| `vault-fill-icon.js:156-163` deps; `:190-200` `targetForAnchor`; `:390-403` `anchorKinds()`; `:53` `buildVaultLockIcon` noun | two families | third kind throughout |
| `webview-preload.js:11-12` requires; `:331-338` icon + `resolveTarget` injection; `:441` / `:453` fill handlers | two families | + identity; `vault-fill-identity` handler; DD9 ordinal on all three |

Main side:
- `vault-human.js` `reachableItems` (`:203`) — login + card arms; `fillHuman`'s
  type dispatch (`:289` card branch, then the login origin check).
- `vault-store.js:3514` `reachableCardItems(jarId)` — the no-origin precedent.
- `main.js:1368-1377` `fillDelegate` / `fillCardDelegate` wiring.

Presentation:
- `vault-picker-template.js` `KIND_TABLE` (Leg 1) and its `EMPTY_PICKER_NOTE`
  constant.

Setters:
- `setFieldValue` exists in **two** private copies (`vault-fill-fields.js:92`,
  `vault-card-fields.js:416`); `setChoiceValue` is private to
  `vault-card-fields.js:434`. Neither is exported.

## Leg-scoped decisions

**LD1 — Extract card's two setters into a shared module; do not create a third
copy.** Identity needs both `setFieldValue` and `setChoiceValue` (country and
region are routinely `<select>`s). Move `vault-card-fields.js`'s two setters
**verbatim** into a new `src/preload/field-setters.js`, consumed by card and
identity — the same shape as Flight 2 Leg 1 extracting `field-tokenizer.js` out
of `vault-card-fields.js`. **The login copy in `vault-fill-fields.js:92` is left
alone** and logged as a squawk: verifying it is behaviourally identical before
merging it is its own small job, and folding it in here would widen the leg
without buying it anything.

**LD2 — The empty-picker copy changes HERE, not in Leg 4.** Leg 1 routed it
through one constant for a later leg to change, and named Leg 4. But this leg is
the one that makes an identity appear in the picker, so "No saved logins or cards
to fill here" becomes wrong the moment this leg lands. Reassigned to this leg.

**LD3 — The ordinal resolves against the SAME finder, in BOTH worlds.** The main
world computes the index of the entry containing the icon-bound field among
`findAll<Family>Fields(document)`; the isolated world resolves
`findAll<Family>Fields(document)[ordinal]`. Both call the identical pure finder
on the identical DOM, so the integer means the same entry in both — the premise
the capture gesture already relies on. The mutation-between-enumerations race
the mission's Known Issues names is NOT closed by this; a stale or out-of-range
ordinal falls back to entry 0, exactly as today.

## Acceptance Criteria

**Detection (isolated world)**

- [x] **AC1 — `isClaimedByCard(field, doc)`** in `vault-identity-fields.js`, built
      from the already-exported `findAllCardFields` exactly as `isClaimedByLogin`
      is built from `findAllLoginFields`, checking **all six** card roles (DD5).
      Applied in `candidateFields` alongside `isClaimedByLogin`, before role
      resolution — so a card-claimed field cannot anchor an identity scope either.
      `vault-card-fields.js`'s detection logic is not modified (LD1's setter move
      is its only change).
- [x] **AC2 — Pinned by a real contested field.** A form carrying `card_nameOnCard`
      (squawk 0091's own spelling — `{name}` matches identity's `fullName`) plus a
      detected card number: `fullName` is NOT resolved from that field. And a
      control where the same spelling sits in a scope with NO card number: it is.
- [x] **AC3 — The entry carries `anchorRole` and the non-postal anchor**, threaded
      at the ONE call site in `identityEntryForScope` where `anchorCandidate` and
      `nonPostalCandidate` are already in scope (DD2, DD8). Never re-derived
      downstream.
- [x] **AC3b — ONE definition of the identity role list.** `vault-identity-fields.js`
      exports `IDENTITY_ROLES = [...POSTAL_ROLES, ...NON_POSTAL_ROLES]` — the eleven
      roles, derived from the two sets it already exports, never hand-typed again.
      The observer (AC4) and the ordinal call (AC9) both import it. Rationale:
      `CARD_ROLES` already exists as two independent hand-typed copies
      (`vault-gesture-policy.js:31` and `vault-entry-observer.js`); identity must not
      start a third instance of that pattern. `identity-profile.js`'s existing drift
      guard already asserts its `IDENTITY_FIELDS` equals this same union.
- [x] **AC4 — The observer snapshots identities.** `createEntryObserver` takes an
      injected `findAllIdentityFields`; it uses AC3b's imported `IDENTITY_ROLES`;
      `snapshot()` returns `{ logins, cards, identities }`; provenance, the TTL and
      the detachment eviction apply to identity fields identically. The
      "carries no policy" source-scan pin in `vault-entry-observer.test.js` still
      passes.

**Fill**

- [x] **AC5 — `fillIdentityForm(doc, identity, ordinal)`** in
      `vault-identity-fields.js`: top-frame only (the `window.top !== window`
      guard, same as its twins); resolves the entry by LD3's ordinal with a
      fall-back to entry 0; writes each stored field into the matching detected
      role; uses `field-setters.js` for every write (`setChoiceValue` for a
      `<select>`); returns `{ filled, fields: [{ field, value }] }` — the same
      contract, so the observer's `grantForFill` grants provenance for exactly
      what was written. A role with no stored value, or no detected field, is
      skipped, never written empty.
- [x] **AC6 — LD1's extraction.** `src/preload/field-setters.js` holds
      `setFieldValue` and `setChoiceValue` moved verbatim from
      `vault-card-fields.js`, which now imports them. **Card's existing tests pass
      unmodified at the point the move lands** — a pure move, proven before any
      other edit. *(Mid-leg checkpoint, not an end-of-leg invariant: AC11 later
      rewrites two tests in `vault-card-fields.test.js`, so its end-of-leg diff is
      non-empty by design.)* `vault-fill-fields.js`'s `setFieldValue` is not
      touched by LD1.
- [x] **AC7 — The isolated world gains `fillIdentity`.** The bootstrap handle
      exposes `fillIdentity({ identity, ordinal })`, calling `fillIdentityForm`
      then `observer.grantForFill`, returning only `{ filled }` — no node, no
      per-field detail crosses back out (DD3g). `createEntryTracker`'s returned
      object gains the matching router, `fillIdentity: (payload) =>
      runFill('fillIdentity', payload)`, beside `fillLogin`/`fillCard`.
- [x] **AC8 — `npm run build:preload` regenerates the observer bundle**, and
      `vault-entry-observer-bundle.test.js` passes against the regenerated
      output. If its inlined-names list (`:73`) needs the new finder or
      `fillIdentityForm`, add them — ADD, never remove.

**DD9 — the ordinal fix, all three families**

- [x] **AC9 — REUSE the existing ordinal resolver; write no new one.**
      `resolveOrdinalInFamily(target, entries, roles)` already exists at
      `vault-gesture-policy.js:117`, exported at `:181` with `LOGIN_ROLES` and
      `CARD_ROLES`, pure and unit-tested — and its own module header (`:8-12`)
      names fill precision as a stated purpose: "ordinal recovers the PR#112
      finding-9 precision Leg 3 accepted losing for fill". `webview-preload.js`
      already requires that module (`:16`). Each fill handler calls it with its
      family's detected entries and role list; identity passes AC3b's
      `IDENTITY_ROLES`. Its step 1 (the target IS one of the entry's role fields)
      always resolves for a fill, because the icon-bound target is always a
      detected field — the identity target is the postal anchor, which is itself
      one of the eleven role fields. Steps 2-3 (form match, sole-entry fallback)
      are inert here and harmless.
      **⚠ CORRECTED at design review — the fourth enumeration miss of this
      flight.** The first draft (and flight DD9, now amended) specified a NEW
      helper in `vault-entry-tracker.js`, which would have been the third
      implementation of the same walk. The design-time audit shape-grepped every
      CALLER of the finders; it never searched for an existing IMPLEMENTATION of
      the capability being specified — and the Flight Director had read this very
      function earlier in the same session.
- [x] **AC10 — All three fill handlers pass an ordinal.** In `webview-preload.js`,
      `vault-fill`, `vault-fill-card` and the new `vault-fill-identity` each take
      `consumeFillTarget(kind)`'s field, resolve it to an ordinal via AC9, and
      route `{ <payload>, ordinal }` into the isolated world. `callScript` embeds
      ONE JSON argument, so this is a single object, never a second positional.
- [x] **AC11 — The fill helpers take an ordinal, and ONLY an ordinal.**
      `fillLoginForm` and `fillCardForm`'s third parameter changes from a node
      target to an integer ordinal (or `null`), resolving
      `findAll<Family>Fields(doc)[ordinal]` and falling back to today's
      first-detected-entry behaviour when it is `null` or out of range. **No
      overloading** — never accept both a node and a number in one parameter.
      Verified at design review: the only PRODUCTION caller
      (`vault-entry-observer-bootstrap.js`) passes no third argument today, so the
      node branch has no production consumer to preserve.
- [x] **AC11b — Five existing tests are REWRITTEN to the ordinal contract, not
      deleted.** They pass a node (or `null`) as the third argument and would
      otherwise silently fill the wrong form: `vault-fill-fields.test.js:242`
      (second login form), `:264` (`null` → first), `:270` (foreign node → first);
      `vault-card-fields.test.js:465` (second card form), `:475` (detached node →
      first). These ARE the PR#112 finding-9 regression tests — the exact
      precision DD9 restores — so deleting them would remove the regression net at
      the moment it matters most. Rewrite each at the SAME strength: second-form
      cases pass ordinal `1` and still assert form B filled and form A untouched;
      the stale/foreign/detached cases become an out-of-range ordinal (e.g. `99`)
      and still assert the first-entry fallback. Leg 2's contract-update
      discipline applies: list every test touched, never weaken an assertion.
- [x] **AC11c — `isLivePasswordField` / `isLiveCardNumberField` are left in place.**
      After AC11 each has ZERO production callers (verified: each is called only
      inside the fill function whose node parameter AC11 removes). Liveness is now
      structural — a freshly enumerated `findAll(doc)[ordinal]` is live by
      construction. Removing a still-exported symbol is out of this leg's scope;
      keep both and their standalone tests unchanged, and the Flight Director logs
      the dead exports as a squawk.
- [x] **AC12 — The regression is pinned, and the pin bites.** AC11b's rewritten
      second-form tests ARE this pin (no duplicate tests). Add the identity twin:
      two identity-anchored forms, ordinal `1`, the second is filled.
      **Neuter-verify** all three families: force the ordinal to `null` inside the
      handler path, confirm the second-form tests go RED, restore. Record the RED
      output in the flight log.

**Icon**

- [x] **AC13 — The icon's third kind, at every site DD8 enumerates.**
      `vault-fill-icon.js` gains an injected `findAllIdentityFields`;
      `anchorKinds()` gets a THIRD walk, identity last, behind the same
      `!kinds.has(field)` guard; identity anchors are the entry's postal anchor
      and its non-postal anchor (AC3), and never any other role field;
      `targetForAnchor` resolves an identity anchor to the entry's postal anchor
      as its fill target; `buildVaultLockIcon`'s noun becomes three-way.
- [x] **AC14 — The icon's hostile-page-readable attribute set is unchanged.** The
      kind rides the accessible name ONLY; the existing pin in
      `vault-fill-icon.test.js` that guards the icon's attribute set passes
      unmodified. No `data-kind`.
- [x] **AC15 — `resolveTargetForAnchor` gains the identity arm**, checked last —
      login, then card, then identity (DD5's precedence).

**Main side**

- [x] **AC16 — `reachableIdentityItems(jarId)`** in `vault-store.js`, the
      `reachableCardItems` shape: no origin parameter (DD7); `[]` when locked or
      `jarId` is null; visits only global + the tab's jar; returns metadata only —
      `{ vaultId, id, title, fullName }`, `vault-item-schema.js`'s two non-secret
      identity fields and nothing else. Reads through `identityProfileOf`, never
      `items.find(…)`.
- [x] **AC17 — `reachableItems` gains a third arm**, stamping `type: 'identity'`
      at the merge point exactly as the other two do.
- [x] **AC18 — `fillHuman`'s third branch.** Chosen by the STORED item's own
      `type` (never anything the guest, page or chrome sends); not origin-gated
      (DD7); every other gate unchanged — unlocked, persistent jar, jar scope.
      Builds the identity payload from the stored item and calls a new
      `fillIdentityDelegate`. **Any unrecognised type is still refused.**
- [x] **AC19 — `main.js` wires `fillIdentityDelegate`** beside
      `fillCardDelegate`: `webContents.fromId(wcId)?.send('vault-fill-identity',
      identity)` — top frame only, never returned to chrome.

**Picker**

- [x] **AC20 — `KIND_TABLE` gains an `identity` entry**: section heading
      "Identity", generic title "Identity", a person-shaped icon builder, and a
      secondary line of `fullName` (non-secret) — never any secret field. LD2's
      empty-picker copy updated to name all three families, **and the
      `EMPTY_PICKER_NOTE` comment (`vault-picker-template.js:38-40`, "Leg 4 changes
      the text; this leg only relocates it") corrected to name Leg 3** — Leg 1's
      own design review established that a comment misattributing a boundary is
      worse than a stale one.

**Negative pins**

- [x] **AC21 — Automation is still login-only.** A test asserting `vault-context.js`
      refuses an identity item at every resolution site (`:357`, `:493`, `:549`).
      No code change expected; this pins it.
- [x] **AC22 — No capture.** `grep -n "identity" src/preload/vault-gesture-policy.js`
      returns nothing new, and `resolveGestureTarget` is unchanged. Capture is
      Leg 4.
- [x] **AC23 — `eslint.config.mjs` gains `src/preload/field-setters.js`** in the
      CJS-required-by-the-preload `files:` array — Leg 2's AC13b lesson: there is
      no `src/preload/**` wildcard, and an unlisted CJS module fails lint with
      `'module' is not defined`.
- [x] **AC24 — Gates clean**: `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`. `renderer.js` still 1550 (this leg should not touch
      it; if it must, stop and report — Leg 1 bought 27 lines of headroom, not a
      blank cheque).

## Verification Steps

- AC1/AC2: unit tests in `vault-identity-fields.test.js`, including the control.
- AC3/AC4: unit tests in `vault-identity-fields.test.js` / `vault-entry-observer.test.js`.
- AC5/AC6: unit tests; `git diff --stat test/unit/vault-card-fields.test.js` shows
  no change (AC6 is a pure move).
- AC7/AC8: `npm run build:preload`, then the bundle test.
- AC9-AC12: unit tests, with AC12's neuter-verification RED output recorded in
  the flight log.
- AC13-AC15: `vault-fill-icon.test.js` / `vault-entry-tracker.test.js`.
- AC16-AC19: unit tests against the store and `createVaultHuman` with injected
  fakes, as the card precedent does.
- AC20: `vault-picker-template.test.js`.
- AC21: a new test against `vault-context.js`.
- AC22-AC24: the stated greps and gates.
- **Live fill is the HAT's.** Unit coverage proves the pieces; only the operator
  on a real page proves a stored profile lands in a real checkout.

## Implementation Guidance

1. **Detection first, fill second, icon third, main side fourth, picker last** —
   each step green before the next.
2. **LD1's extraction as its own first commit-sized step**: move the setters, run
   card's tests unmodified, only then build on them.
3. **Enumerate by shape before editing each file.** For the icon, grep
   `kind` and every literal family name across `vault-fill-icon.js` — `anchorKinds`
   is the site that gates rendering, and it is easy to miss (flight DD8 records
   that the flight spec itself missed it once).
4. **Regenerate the bundle after every change to anything the observer imports**
   — a stale generated file makes the bundle test pass or fail for the wrong
   reason.

## Edge Cases

- **A form with ONLY identity fields and no password or card** (a shipping-address
  form): the identity icon must render — DD8's whole reason for existing.
- **A checkout with card AND identity fields in one `<form>`**: `card_nameOnCard`
  goes to card (AC2); the identity entry still anchors on its own postal field; two
  icon kinds coexist on different fields.
- **An identity profile with no postal fields stored** but a detected anchor on the
  page: the fill writes whatever roles it has; it never writes empty strings.
- **A `<select>` country with no matching option**: `setChoiceValue` contributes no
  entry, exactly as card's expiry selects do.
- **A burner tab**: `reachableIdentityItems(null)` is `[]`; `fillHuman` refuses at
  its burner gate before the type branch.

## Files Affected

- `src/preload/vault-identity-fields.js` — `isClaimedByCard`, propagation, `fillIdentityForm`
- `src/preload/field-setters.js` — **new** (LD1)
- `src/preload/vault-card-fields.js` — imports the moved setters (LD1 only)
- `src/preload/vault-entry-observer.js`, `vault-entry-observer-bootstrap.js`
- `src/preload/vault-entry-tracker.js` — identity arm in `resolveTargetForAnchor`,
  `fillIdentity` router (NO new ordinal helper — AC9 reuses the existing one)
- `src/preload/vault-fill-icon.js` — third kind
- `src/preload/vault-fill-fields.js` — ordinal in `fillLoginForm` (AC11 only)
- `src/preload/webview-preload.js` — requires, injection, `vault-fill-identity`, ordinals
- `src/main/vault/vault-store.js` — `reachableIdentityItems`
- `src/main/vault/vault-human.js` — third arm, third branch
- `src/main/main.js` — `fillIdentityDelegate`
- `src/shared/vault-picker-template.js` — identity `KIND_TABLE` entry, copy
- `eslint.config.mjs` — AC23
- tests for each; `missions/.../flight-log.md`

## Carry-forward for Leg 4 (recorded here so it cannot be missed)

**Leg 2's `familyOf` is binary** (`vault-human.js:82` — `rec && rec.kind === 'card'
? 'card' : 'login'`). An identity capture record would map to `'login'`, so an
identity gesture would evict a pending login hold and vice versa — defeating DD1
for exactly the family it was built for. **Leg 4 must make `familyOf` three-way
before any identity record exists.** Found by this leg's shape-grep; not a Leg 2
defect (identity records do not exist until Leg 4), and not this leg's to fix.

## Citation Audit

Re-probed 2026-09-20, branch `flight/03-identity-fill-and-capture` (Legs 1-2
landed, uncommitted), **by shape**:

- Finder consumers: `grep -rn "findAllCardFields\|findAllLoginFields" src/`
  (excluding bundles) — every consumer is in the Inputs table. **Confirmed.**
- Family branches in the fill path: `grep -rn "=== 'card'\|!== 'card'\|kind === "`
  across `vault-fill-icon.js`, `vault-entry-tracker.js`, `webview-preload.js`,
  `vault-human.js`, `vault-context.js` — every fill-side hit is covered; the
  capture-side hits (`webview-preload.js:554-569`, `vault-human.js:587,656,711,
  815,892,941`) are Leg 4's. **Confirmed.**
- Setters: `grep -n "^function setChoiceValue\|^function setFieldValue"` →
  `vault-fill-fields.js:92`, `vault-card-fields.js:416`, `:434`; `vault-card-fields.js`
  `module.exports` exports neither. **Confirmed.**
- `reachableCardItems` at `vault-store.js:3514`; `fillDelegate`/`fillCardDelegate`
  at `main.js:1368-1377`; `vault-context.js` login filters at `:357`, `:493`,
  `:549`. **Confirmed.**
- `vault-entry-observer-bundle.test.js:73` asserts a list of inlined names.
  **Confirmed** — AC8 addresses it.
- `familyOf` binary at `vault-human.js:82`. **Confirmed** — carried to Leg 4.
- **Added at design review — the capability search the first audit never ran.**
  `grep -rn "function resolveOrdinal\|Ordinal" src/preload/` →
  `vault-gesture-policy.js:117 resolveOrdinalInFamily`, exported `:181`. The first
  audit enumerated every CALLER of the finders by shape and still missed this,
  because it never searched for an existing IMPLEMENTATION of the capability the
  leg specified. The rule this adds to "search by shape": **before specifying a
  new helper, search for one that already does the job.**
- Node-target test callers: `grep -rn "fillLoginForm(\|fillCardForm(" test/unit/`
  → `vault-fill-fields.test.js:242,264,270`, `vault-card-fields.test.js:465,475`.
  Production: `isLivePasswordField` / `isLiveCardNumberField` each have one caller,
  inside the function AC11 changes. **Confirmed.**

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — review and commit come after the last autonomous leg
