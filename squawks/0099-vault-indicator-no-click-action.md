# Squawk 0099: The toolbar vault lock indicator has no click action — no path to unlock or to the vault page

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-21
**Completed**: 2026-09-22

## Report

Reported by the operator during Mission 21 Flight 3's HAT: clicking the toolbar
lock icon neither opens the vault page nor offers to unlock. When the vault is
LOCKED there is no interaction on the indicator at all.

Pre-existing, not a Flight 3 regression: the indicator has never had a left-click
action since it was introduced (Mission 12). Its only interaction is right-click →
"Lock now" (squawk 0038, the "#113 'Lock now' half"), and that item is OMITTED
when the vault is already locked — so a locked vault's indicator does nothing on
either mouse button, and the operator has no discoverable path from the lock icon
to unlocking.

## Evidence

- `src/renderer/chrome/vault-controller.js:261-264` — the ONLY listener on
  `els.vaultIndicator` is `contextmenu`; no `click` listener exists.
- `src/shared/page-context-model.js:73-74` — the indicator's menu is a single
  "Lock now" item, pushed only `if (!opts.vaultLocked)`.
- `git log -S "vaultIndicator.addEventListener('click'"` — no commit has ever added one.
- `git diff 016e540 HEAD` on the indicator wiring — empty; Flight 3 did not touch it.

## Corrective Action

Implemented in Mission 21 Flight 4 Leg 1 (`lock-indicator-click`), per operator ruling DD10.
`vault-controller.js` adds a `click` listener beside the `contextmenu` one. Locked →
`openOverlayMenu('vault-unlock', …)` in the `onVaultRequestUnlock` shape (no
`pendingVaultFlow`, so no fill picker springs after the unlock); unlocked →
`openVaultPage()`; not set up → no-op. The native `<button>` gives Enter/Space for free.
Unit-tested in `vault-controller-capture.test.js`. Live verification: Flight 4's HAT,
step 3. The squawk completes there.

Original note: a left-click listener — locked → raise the existing `vault-unlock` sheet;
unlocked → open `goldfinch://vault`. **Needs a one-line operator ruling on the
click semantics first** (issue #113 already carried one operator ruling on this
indicator — "the pinnable half is DECLINED"). If settling the semantics turns into
design work rather than one ruling, this fails the squawk gate and escalates.

## Verification

- Unit: `test/unit/vault-controller-capture.test.js`, covering the locked click (one
  `vault-unlock` open, no picker after unlock), the unlocked click (vault page), and
  the not-set-up no-op. HAT addition: the locked right-click shows "Unlock now"
  (`unlockNow()` / `indicatorAction()`), with the same tests plus `page-context-model`
  and `overlay-dispatch` cases.
- Live: Mission 21 Flight 4 HAT step 3 PASS (operator, 2026-09-22). Unlocked click →
  `goldfinch://vault`; locked click → unlock sheet with no picker after; Enter/Space match
  the click; right-click "Lock now" unlocked / "Unlock now" locked.

## Sign-Off

**Reviewer**: Flight-end Reviewer (Legs 1–4) + HAT-fix Reviewer (agents); operator live HAT
**Verdict**: confirmed
**Commit**: branch `flight/04-in-field-affordance` (Mission 21 Flight 4, PR #230); see that branch's HAT commit

## Disposition

Deferred — out of Mission 21 Flight 3's path (the HAT reached the vault page by
another route).
