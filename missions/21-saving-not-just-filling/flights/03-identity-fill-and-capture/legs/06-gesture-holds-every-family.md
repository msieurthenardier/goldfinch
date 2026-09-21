# Leg: gesture-holds-every-family

**Status**: completed
**Flight**: [Identity Fill and Capture](../flight.md)

> **Spawned from the HAT (Leg 5).** The HAT's pre-walk finding, confirmed live at
> Step 4a, showed that on a checkout where card and billing fields share ONE form,
> identity capture is impossible by any gesture. The operator ruled to fix it in
> this flight. Feature-class under the fix-vs-feature gate, so it gets this scoped
> design and a design review before any code. Leg 5 is `in-flight` and immutable,
> hence a new leg; the HAT resumes afterwards to re-walk 4a.

## Objective

Make one capture gesture hold EVERY family it maps to, not just the first, so a
combined checkout offers both the card and the billing identity — and a sign-up
form offers both the login and the identity (operator ruling).

## Context

- **Root cause** (HAT pre-walk finding): `resolveGestureTarget`
  (`vault-gesture-policy.js`) returns the FIRST family that resolves — login,
  card, identity — and `onCaptureGesture` (`webview-preload.js`) sends exactly one
  capture. `resolveOrdinalInFamily`'s step 2 is a FORM match, so in a shared form
  every target resolves to the card and identity is never checked. **Flight DD1
  named this outcome and then fixed four things at the hold / release / present
  layers, none at gesture resolution.** Everything downstream is built and PROVEN
  LIVE: multi-hold + the serial queue (HAT 4b), the locked drain (HAT 7b).
- **Operator rulings (2026-09-21)**: fix in this flight; on a sign-up form carrying
  a password AND an address, capture BOTH login and identity.
- **Negative-set audit, done at design time** (the zero-offers hard gate): the 7
  `negative-detection` fixtures assert that NOTHING is detected — a gesture-
  resolution change cannot reach detection. The single `negative-gesture` fixture
  (`decoy-cancel-beside-password`) carries only `username` + `password` — no postal
  anchor, so no identity entry exists to newly capture. **Structurally safe**; the
  suite still has to prove it.

## Leg-scoped decisions

**LD1 — `resolveGestureTarget` becomes `resolveGestureTargets`, returning a LIST.**
One `{ kind, ordinal }` per family that resolves, in the fixed order login, card,
identity — each family resolved independently by the EXISTING
`resolveOrdinalInFamily`. No new resolution logic. **The rename is deliberate**: an
array is truthy and has no `.kind`, so a stale singular caller would silently read
`undefined` and — through the guest dispatch's final `: logins[…]` else-branch —
fall into the LOGIN path. A rename turns every stale caller into a loud break. The
singular function is removed, not kept alongside (no parallel helper).

**LD2 — The per-family decision moves into a PURE, TESTED planner; the preload
only executes the plan.** ⚠ **Rewritten at design review (HIGH).** The first draft
said "`onCaptureGesture` becomes a per-family loop" and left its correctness to
source reading, because `webview-preload.js` cannot be `require`d under
`node --test`. The review found why that is dangerous here: today's function is
riddled with WHOLE-FUNCTION exits written when one family was the only
possibility — `if (!entry) return` (`:25`), `if (!snapshotHasProvenancedSecret(…))
return` (`:40`), and a `return` after the card send (`:62`) and the identity send
(`:86`), all inside ONE shared `try/catch` (`:42-100`). Wrap those in a loop without
converting every one, and the first family to be processed — or the first to FAIL
its gate — ends the gesture, silently dropping the rest: **the exact bug this leg
exists to fix, on the headline scenario, passing every automated check** (the
resolver tests stay green; only the live HAT would notice). And "cannot be required,
so verify by reading" is the same resignation Leg 2's review rejected for the
detach watch.

So: a new pure module, **`src/preload/vault-capture-plan.js`**, exports
`planCaptures({ resolved, entriesByKind, snapshot })` → an array of
`{ kind, channel, payload, watchFields }`, ONE entry per family that passes its own
gate. It owns everything per-family today's branches do: the explicit per-kind
lookup (`{ login, card, identity }[kind]`, yielding nothing for an unknown kind —
never a login default, Leg 4's LD1 principle applied guest-side); each family's own
value gate; each family's payload encoding (the card PAN/CVV and identity secrets as
`Uint8Array`, `expiryFromSnapshot`, DD3c's `usernameDetected`); each family's watch
fields. It is a plain CJS module (`TextEncoder` is a Node global), so it unit-tests
against fake entries and a plain snapshot.

`onCaptureGesture` then shrinks to: resolve the list, read the snapshot ONCE, build
the plan, and `for (const c of plan) { try { ipcRenderer.send(c.channel, c.payload);
armGestureDetachWatch(c.kind, c.watchFields); } catch {} }` — a per-iteration
`try/catch`, and no per-family logic left in which a `return` could hide. No new IPC
channel. The module's placement is deliberate: `vault-gesture-policy.js`'s own header
promises it "never reads a VALUE", and the planner encodes snapshot values, so it
does not belong there.

**LD3 — DD5's precedence retires as a winner-take-all rule.** Contested FIELDS stay
resolved at DETECTION — `isClaimedByLogin` / `isClaimedByCard` remove a
login- or card-claimed field from identity's candidates before anything else runs.
What goes is only "the first family to resolve takes the whole gesture". The fixed
order survives purely for determinism (offer order).

**LD4 — Why this widens WHEN, never WHAT.** Every family still passes its own value
gate — a provenanced password, a Luhn-valid PAN, DD2's anchor + non-postal gate —
and its own disposition rule. The `isTrusted` gesture gate is unchanged. The cost is
the wrong-moment budget: a page whose single out-of-form button maps to two
families may now raise two offers, but only for values the operator really typed.

## Acceptance Criteria

- [x] **AC1 — `resolveGestureTargets` returns every resolving family**, pinned for
      each shape below, with the exact list asserted:
      | shape | gesture | expected |
      |---|---|---|
      | card + billing in ONE form | the form's submit button | `[card, identity]` |
      | card + billing in ONE form | Enter in the billing Email field | `[card, identity]` |
      | card form + billing form, submit OUTSIDE both (the real Jostens shape) | the outside button | `[card, identity]` (each family's sole-entry fallback) |
      | card form + billing form, SEPARATE | "Save card" inside the card form | `[card]` only |
      | sign-up: name, email, address, password in one form | submit | `[login, identity]` |
      | plain login form | submit | `[login]` |
      | nothing detected | any button | `[]` |
- [x] **AC2 — `resolveGestureTarget` is gone.** `grep -rn "resolveGestureTarget\b"
      src/ test/` returns nothing — **run it AFTER `npm run build:preload`**, since the
      gitignored `webview-preload.bundle.js` on disk still carries 5 stale hits until
      the rebuild. Every consumer (the one production call site, the corpus helper,
      the unit tests) uses the plural.
- [x] **AC2b — `eslint.config.mjs` gains `src/preload/vault-capture-plan.js`** in the
      CJS-required-by-the-preload `files:` array (the Leg 2 AC13b / Leg 3 AC23 lesson:
      no `src/preload/**` wildcard exists, and an unlisted CJS module fails lint).
- [x] **AC3 — `planCaptures` exists in a new pure `src/preload/vault-capture-plan.js`**
      and owns ALL per-family decision logic (LD2). The per-kind lookup fails closed on
      an unknown kind. The guest-side nested ternary with a `: logins[…]` else-branch
      is gone.
- [x] **AC4 — Every resolving family is planned; one failing its gate does not stop
      the others — now UNIT-PROVEN, not read.** Pinned: `[card, identity]` with both
      provenanced → two plan entries; card provenanced, identity's anchor NOT → only
      the card; identity provenanced, card NOT → only the identity (the order-sensitive
      case — the first-listed family failing must not end the plan); an unknown kind →
      skipped, never a login payload; `[]` → `[]`. Each entry's `channel` matches its
      `kind` and no family's values appear in another's payload.
- [x] **AC4b — Neuter-verify the planner.** Make it stop after the first family (the
      exact shape of the bug the HIGH describes); confirm the two-family and the
      first-family-fails tests go RED; restore. Record the RED output.
- [x] **AC4c — `onCaptureGesture` carries no per-family logic.** Its body is resolve →
      one snapshot read → `planCaptures` → a loop that only sends and arms, with its
      `try/catch` INSIDE the loop. Grep-AC: no `return` statement appears between the
      loop's opening brace and its close. This part stays source-read — it is a
      handful of lines, and everything that could go wrong in it has moved.
- [x] **AC5 — Existing single-result tests become list tests at the SAME strength.**
      The ~14 `resolveGestureTarget` references in `vault-gesture-policy.test.js`
      that pin winner-take-all precedence are rewritten to assert the full list
      (e.g. "login wins over card" becomes "`[login, card]`, in that order"). Never
      deleted, never weakened; list each one touched (Leg 2's AC13 discipline).
- [x] **AC6 — Two NEW gated corpus fixtures**, curated BEFORE the implementation
      (the corpus specifies, it does not ratify): `checkout-combined-card-billing`
      (card + billing in one form, native submit) asserting BOTH families, and
      `signup-with-address` (password + address in one form) asserting login AND
      identity. `test/helpers/save-moment-assertions.js` gains a multi-family
      assertion. **Preferred: it calls the REAL `resolveGestureTargets` +
      `planCaptures`**, so the corpus exercises the actual shipping planner rather
      than a parallel reimplementation inside the helper — the same "the test runs the
      exact code the app ships" principle the `src/shared/` ESM rule states. If the
      implementer does otherwise, say why.
- [x] **AC7 — The negative set still produces ZERO offers**, and the standing
      canary still inverts and throws.
- [x] **AC8 — Documentation**: the ONE sentence asserting DD5 as a capture-time rule
      is `CLAUDE.md:345` — "…completing the precedence login > card > identity at
      detection, icon placement, **and gesture resolution alike**" (the reviewer
      grepped both `CLAUDE.md` and `docs/vault.md` for DD5 / winner-take-all / "checked
      LAST" / "gesture resolution": that is the only hit). Correct it: precedence holds
      at detection and icon placement; a capture gesture now holds every family it maps
      to. `docs/vault.md:448-456` describes only the DETECTION-layer contest, which LD3
      keeps — no change there. Also document `vault-capture-plan.js`. flight.md's DD5
      gets an amendment note.
- [x] **AC9 — Gates clean**: `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`. `renderer.js` 1550, `SEAM_COUNT` 41.
- [x] **AC6b — Pin the email-as-username sign-up shape** (added after the live
      re-walk found it untested). A sign-up form where the EMAIL is the field
      immediately before the password (no dedicated username field): the plan holds
      BOTH login and identity, the login payload's username is the email, and the
      identity payload carries NO email. Neuter-verify: bypass `isClaimedByLogin` in
      identity's candidate filter, confirm the test goes RED (email double-counted),
      restore.
- [x] **AC10 — Live re-walk (the HAT resumes)** — PASSED 2026-09-21: re-walk A
      (combined checkout → card + identity from one gesture) and re-walk B (sign-up →
      login + identity, email NOT on the identity sheet).: HAT 4a on `checkout.html` now yields
      TWO sheets (card + identity), and a sign-up page yields login + identity.

## Implementation Guidance

1. **Fixtures first** (AC6) — write both corpus fixtures and watch them FAIL against
   today's code. A fixture that passes before the fix proves nothing.
2. **Policy second** — `resolveGestureTargets` + its tests (AC1, AC2, AC5).
3. **Planner third** — `vault-capture-plan.js` + its tests + AC4b's
   neuter-verification (AC3, AC4, AC4b). Move each family's existing branch body in;
   convert every whole-function exit into "this family is not planned".
4. **Preload last** — shrink `onCaptureGesture` to resolve / read / plan / send
   (AC4c), then `npm run build:preload`, then AC2's grep.
4. **Search by shape before each edit**: `grep -n "resolved\.\|resolveGestureTarget\|kind ===\|: logins\["`.

## Edge Cases

- **Two families resolve, one fails its gate** (typed a card, left the address
  blank): only the card is held (AC4).
- **Three families on one page** (sign-up + card): up to three holds, three offers in
  sequence — the queue already handles N.
- **The Enter key** in a combined form both triggers native submission AND is a
  capture gesture — the holds are created before the navigation settles them, as
  today.
- **The outside-both-forms row of AC1 is fragile by construction.** It relies on
  `resolveOrdinalInFamily`'s step 3 sole-entry fallback, which fires only when a
  family has EXACTLY one detected entry and the target has no form. A page with a
  SECOND card form (or two billing sections) silently drops that family from the
  list — no error, just a shorter list. Accepted: guessing among several entries is
  what step 3 deliberately refuses. State it in a test name so the next reader sees
  it.
- **AC5's synthetic "all three families resolve" test** (`vault-gesture-policy.test.js:235-241`,
  one fake node shared by login, card and identity entries) will correctly assert
  `[login, card, identity]` under the new resolver — but update its comment: that
  shape cannot occur in production, because LD3's detection-time claims remove a
  contested field from identity's candidates. It is a resolver-in-isolation worst
  case, not a reachable page.

## Files Affected

- `src/preload/vault-gesture-policy.js` — `resolveGestureTargets`
- `src/preload/vault-capture-plan.js` — **new**, the pure planner (LD2)
- `src/preload/webview-preload.js` — shrinks to resolve / read / plan / send
- `eslint.config.mjs` — AC2b
- `test/unit/vault-gesture-policy.test.js`, `test/helpers/save-moment-assertions.js`
- `test/fixtures/save-moment/` — two new fixtures + manifest entries
- `CLAUDE.md`, `docs/vault.md`, flight.md (DD5 note), flight-log.md

## Citation Audit

2026-09-21, branch `flight/03-identity-fill-and-capture` at `45a9a44` (Legs 1-4
committed): `resolveGestureTarget` consumers by whole-tree grep — `vault-gesture-policy.js`
(2), `webview-preload.js` (2), `save-moment-assertions.js` (3),
`vault-gesture-policy.test.js` (14). **Confirmed.** No existing multi-result
resolver (`grep "function resolve[A-Za-z]*Targets"` → none). **Confirmed.** Negative
set: 8 fixtures, audited above. **Confirmed.**
Extended at design review: the reviewer also read all 9 GATED and KNOWN-UNSOLVED
fixture files in full for accidental cross-family exposure — no login or card
fixture contains a postal-anchor-shaped field, and the identity fixtures contain no
login or card field — so the negative-set safety argument extends to the gated and
known-unsolved tiers too. The early-exit sites in `onCaptureGesture` (`:25`, `:40`,
`:62`, `:86`, one shared `try` at `:42-100`) confirmed by the Flight Director before
LD2 was rewritten.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (AC1-AC10 and AC6b all verified; see flight-log.md)
- [x] Tests passing
- [x] Flight-log entry; leg status `landed`; checked off in flight.md
- [ ] Commit *(deliberately not done — orchestrator instruction; awaits code review)*
