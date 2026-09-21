# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Identity Fill and Capture](../flight.md)

## Objective

Operator-driven HAT on the dev build: confirm on real pages what no headless
apparatus can observe — the identity capture sheet, its copy per mode, identity
fill, the ordinal fill fix, the SPA detach settle, the capture-offer queue under
cross-window and supersede conditions — and fix what fails, inline where it is a
look-and-feel fix and via a scoped design review where it is a feature (the
fix-vs-feature gate).

## Pre-walk finding — recorded BEFORE step 1 (Flight Director)

**The flight's headline case does not work, and it is a DESIGN gap, not an
implementation bug.** While writing the expected result for the checkout step,
the Flight Director verified the premise against the code:

- `resolveGestureTarget` (`vault-gesture-policy.js`) returns the FIRST family that
  resolves — login, then card, then identity — i.e. exactly ONE `{kind, ordinal}`.
- `onCaptureGesture` (`webview-preload.js`) handles exactly that one kind and
  sends exactly ONE capture IPC.

So on a checkout carrying card AND billing identity fields, clicking "Pay now"
resolves to the card, and identity is never checked. **The identity is never
held, so never offered.** DD1 named exactly this ("on the mission's own
motivating page the card would win and the billing identity would never be
offered at all") and then specified four fixes — family-scoped supersession, an
array-returning `captureRelease`, iterating settle sites, a chrome queue — **all
at the hold / release / present layers. None touches gesture resolution, where
the cause lives.** Multi-hold is necessary but not sufficient: it lets two holds
coexist, and nothing creates two from one gesture.

The planning recon wrote the root cause down in as many words — "resolveGestureTarget
returns exactly one `{kind, ordinal}`" (flight-log Reconnaissance Report) — and the
design still fixed the layer below it. Every design review and the flight-end
Reviewer also missed it; Leg 2's tests proved coexistence with two SEPARATE hold
calls, which is precisely the case that works.

**What does work**: identity capture on an identity-only form (no card, no
password); and two holds coexisting when the operator makes two separate
gestures that each resolve a different family.

**Classification**: a FEATURE-class change (one gesture holding every family it
maps to), security-adjacent (it widens what one gesture can capture), and with an
open design question (does a password on the same form suppress identity?). Per
the fix-vs-feature gate it is NOT an inline fix. Operator decides after the walk:
fix within this HAT via a scoped design review, or carry it forward.

## Environment

- App: `npm run dev:automation` — the canonical dev launch. `scripts/dev-launch.mjs:41`
  calls `buildPreloadBundle()`, so the isolated-world bundle is current. Dev profile
  is isolated (`~/.config/goldfinch-dev`) — the operator's real vault is untouched.
- Pages: served by the Flight Director at `http://127.0.0.1:8765/` from the session
  scratchpad (throwaway apparatus, not committed): `billing.html`, `checkout.html`,
  `two-forms.html`, `spa.html`. `isSafeTabUrl` refuses `file://`, hence `http://`.
  Pages carry NO pre-filled values — pre-filled values are not provenanced and are
  correctly never captured; the operator must TYPE.
- Use **fake data only** (the GET forms put typed values in the URL).
- A normal, persistent-jar tab — never a burner (burner captures nothing, by design).

## Acceptance Criteria (verification steps, walked one at a time)

- [x] **Step 0 — Setup.** App running, vault set up and UNLOCKED, a persistent-jar
      tab, and no pre-existing identity profile in either the jar vault or Global.
- [x] **Step 1 — Fresh identity save.** `billing.html`, all fields EXCEPT Phone,
      Continue → a "Save your details?" sheet listing field LABELS and NO values,
      with a vault choice → Save → the vault page's Identity section shows one
      item titled "My details".
- [x] **Step 2 — Mixed gap-fill + conflict.** `billing.html` again: the same values,
      but ADD a phone and CHANGE the email → "Update your saved details?", naming
      Email as changed and Phone as added, and showing NO values → Update → the
      vault item has the new email and the phone, every other field unchanged.
- [x] **Step 3 — Identity fill + ordinal precision.** `two-forms.html`: an identity
      icon on a field in form B → the picker's Identity row "My details" → form B
      filled; form A still EMPTY.
- [x] **Step 4 — Checkout (REFRAMED by the pre-walk finding, then CORRECTED
      mid-walk).**
      **4a** `checkout.html` (card + billing in ONE form), all typed, "Pay now" →
      expect ONE sheet ("Save card?") and NO identity offer — confirming the gap.
      **4b** `split-checkout.html` (card and billing in SEPARATE forms): "Save
      card" → "Save address" → "Place order" → TWO sheets, one after the other
      (the Leg 2 multi-hold + serial queue, live).
      **⚠ Correction (Flight Director, before this step was walked):** the first
      draft's 4b — "press Enter in the Email field of the SAME form, then Pay now →
      two sheets" — was WRONG. Re-derived against `resolveOrdinalInFamily`: its
      step 2 is a FORM match, and cards are checked before identity, so in a form
      shared by card and billing fields EVERY gesture target — the Email field
      included — resolves to the card. **In a combined form, no gesture can capture
      the identity at all**, which makes the pre-walk gap stronger than first
      stated. Two holds genuinely coexist only when card and identity live in
      SEPARATE scopes, gestured separately — hence the new page.
- [x] **Step 5 — SPA detach settle.** `spa.html`, type all four, "Save address" →
      the form is removed by script with NO navigation → an identity offer
      appears (Leg 2's per-family detach watch, full-detachment semantics).
- [x] **Step 6 — Supersede does not kill future offers** (the Leg 2 post-landing
      fix). Raise a save sheet, open the KEBAB menu over it → the sheet closes →
      submit again → a NEW offer DOES appear.
- [x] **Step 7 — REPLACED mid-walk: the original was not performable.** It asked
      for a save sheet up in window A while the vault is locked from window B — but
      focusing window B BLURS window A, and `vault-capture` is dismissed on blur by
      design (absent from `VAULT_BLUR_SURVIVAL_MENU_TYPES`), so the sheet is gone
      before the lock can land. Any same-window lock gesture (right-click the lock
      icon) likewise supersedes the sheet first. Replaced with two tests that ARE
      performable and exercise the same shared state:
      **7a — Cross-window lock drops a PENDING hold (LD7 + `dropAllCaptures`).**
      Unlocked. Window A, `split-checkout.html`: type billing, "Save address"
      (identity held, no sheet). Window B (a new Ctrl+N window): right-click the
      lock icon → "Lock now". Back in A: "Place order". Expect NOTHING — the lock
      dropped and zeroized the held record. An unlock prompt appearing instead
      would mean the held identity SURVIVED the lock — a failure.
      **7b — Locked-vault drain, Leg 2's round-1 HIGH, live.** Vault LOCKED
      (holds are gated on set-up + jar + origin, NOT unlock, so gestures still
      hold). `split-checkout.html`: card + billing, "Save card", "Save address",
      "Place order" → expect ONE unlock prompt (AC7), and after unlocking, TWO
      sheets in sequence (AC6). Before the round-1 fix, a scalar kept only the
      last captureId and one offer was silently zeroized two minutes later.

## Post-Completion Checklist

- [x] All steps walked; results recorded in flight-log.md
- [x] Every failure either fixed (and re-verified) or dispositioned by the operator
- [x] Leg status → `completed`; checked off in flight.md
- [x] Flight → `landed`; mission.md flight list + Known Issue 3; PR marked ready
- [ ] Commit

## Operator feedback carried forward

- **Update sheet: show before/after values, nicely formatted** (raised at the
  re-walk). NOT a squawk — reverses DD6 and is security-sensitive (secret PII over
  a non-zeroized channel into the sheet DOM; stored secrets shown on a page-raised
  sheet). **Carried to mission Flight 5** (alignment; its scope names "the identity
  sheet") as a named design question — masked hints, reveal-on-click via the secret
  channel, or new-values-only.
- **DD2's gate consequence** (observed at Step 6): an operator who changes only a
  non-postal field on a form whose address the SITE pre-filled is never offered an
  update — the pre-filled anchor was not typed. Accepted by design; for the debrief.

