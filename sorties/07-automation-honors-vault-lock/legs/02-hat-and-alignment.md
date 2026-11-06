# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Automation Honors the Vault Lock](../flight.md)

## Objective
The operator watches and drives the parts of Sortie 07 that automation cannot see: the vault
indicator's right-click menu, the badge by eye, Lock now from the operator's OWN unlocked vault,
the operator's idle auto-lock, and Lock-now-while-locked dropping a pending locked-vault save
offer.

## Context
- **Interactive leg.** The Flight Director guides one step at a time. Look-and-feel FIXES ride
  inline. Anything that adds behavior is a FEATURE and goes to a scoped design review first. A
  fix spanning more than one surface gets a Developer design-review pass before the implementing
  spawn.
- **Already proven live** by `vault-mcp-lock-coupling` (PASS 10/10):
  - the lock-while-locked zeroize;
  - the bad-key `held` report;
  - cue set/clear timing on unlock, lock, re-unlock and teardown.
  The HAT does not repeat these except where a step passes through them.
- **Apparatus**:
  - a throwaway `vault-login` fixture profile (master password known from the builder JSON);
  - the fixture served on 127.0.0.1:8099 (`python3 -u -m http.server`);
  - the app launched with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --user-data-dir=<dir>`.
  The FD plays "the agent" through a persistent attach-only driver (one held Jar A session J,
  plus an admin session A for indicator reads). The operator types the master password into the
  unlock sheet and uses the mouse and keyboard.
- **Accepted behaviors** (do not file as defects):
  - Lock-now-while-locked drops a pending locked-vault save offer (flight DD1).
  - A lock ends the agent's CURRENT access, not its grant; it can re-unlock (DD1).
  - No badge while the operator is unlocked (DD5).

## Acceptance Criteria (verification steps, one at a time)
- [x] H1 **Operator unlock**: the operator unlocks by hand (master password). The icon shows
      unlocked. Right-click shows the single item **Lock now**.
- [x] H2 **Agent unlocks while the operator is unlocked**: the FD's session J runs
      `vaultUnlock`. There is no badge on the (unlocked) icon. The right-click menu is still just
      Lock now.
- [x] H3 **Lock now from the operator's unlocked vault**: right-click → Lock now. The icon shows
      locked with no badge. The FD confirms that J's `vaultList` returns `[]` and `held` is `[]`.
- [x] H4 **Badge by eye**: J re-unlocks while the operator is locked. The badge is visible on the
      locked padlock, sized and placed sensibly. It is legible in the active theme; if practical,
      also check the other light/dark theme. The button size and toolbar layout don't shift.
- [x] H5 **Locked + held menu**: right-click shows **Unlock now** then **Lock now**, keyboard
      navigable. Choosing Lock now clears the badge, and the FD confirms J is locked out.
      Choosing Unlock now (in a re-held state) raises the unlock sheet as before.
- [x] H6 **Idle auto-lock**: set `vaultAutoLockMinutes` to 1 (Settings). The operator unlocks,
      then J unlocks. Leave both idle for about 70 s. The operator's vault auto-locks, the FD
      confirms J is locked out (`held: []`), and no badge remains.
- [x] H7 **Lock-while-locked drops a pending locked save offer**: with the operator locked and J
      held, submit the capture-mode fixture page with a unique credential. The corner prompt shows
      "Unlock & save". Then right-click → Lock now. The prompt closes, the offer is gone, nothing
      is saved, and J is locked out. This is accepted behavior; confirm it reads acceptably.
- [x] H8 **Operator sign-off**: the operator is satisfied with the badge, the label and the menu,
      or lists alignment fixes.

## Verification Steps
The operator reports by eye on H1–H8. The FD records J's tool results and the indicator class
and label reads (admin `evaluate`) at H2, H3, H5, H6 and H7 as corroboration. Evidence is
ephemeral under `/tmp/behavior-tests/goldfinch/sortie-07-hat/<ts>/`.

## Edge Cases
- **WSLg focus**: if the unlock sheet or menu doesn't take keyboard focus, click the window first
  (known rig condition).
- **Idle timer**: `_touch` re-arms on every store operation, so avoid vault-page activity during
  the H6 wait.

## Files Affected
None planned. Inline fixes, if any, are recorded in the flight log and committed at HAT end.

---

## Post-Completion Checklist
Completion steps are Flight Control protocol, driven by the execution workflow. Not repeated here.
