# Squawk 0053: Document the sequential dismiss-locked one-time-sheet pattern

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30
**Completed**: 2026-08-30

## Report
Flight 4 Leg 3 introduced a novel sheet-system idiom: to reveal two one-time
secrets without the chrome sheet manager's `'superseded'` firing and clobbering
the first dismiss-locked sheet, stash the second secret, show the first, and
chain the second only on the first's acknowledgment (`menu-overlay:activated`).
No prior flow shows two one-time sheets back-to-back, and the `'superseded'`
clobber it avoids is a lockout-class trap. Capture the pattern in the
sheet-system design notes so the next multi-one-time-sheet flow doesn't
rediscover it the hard way. Surfaced by the Flight 4 debrief.

## Evidence
- `src/main/menu-overlay-manager.js:325-355` — the `'superseded'` menuType-change
  path.
- `src/main/register-overlay-ipc.js` — the `menu-overlay:vault-import` handler
  (show recovery + stash admin) and the `menu-overlay:activated` chain
  (adminkey-show on recovery-ack).

## Corrective Action

Added a new bullet, **"Sequential dismiss-locked one-time sheets (M17 F4 L3)"**, to
`docs/vault.md`'s "The fill trust boundary" section, immediately after the existing
"Dismiss-locked one-time displays" bullet (which documents single dismiss-locked sheets but
said nothing about showing two in sequence). This section is the project's sheet-system design
notes for vault-hosted `menu-overlay` sheets — the natural home for the idiom, and adjacent to
the bullet it extends.

The new bullet documents:

- **The trap**: `menu-overlay-manager.js`'s `openMenu` treats any open-while-open as a
  model-replace and fires `'superseded'` on the still-open sheet (its `if (currentMenu) { … }`
  branch) — this clobbers a dismiss-locked one-time sheet before its secret is acknowledged, a
  lockout-class trap for an unrecoverable value (recovery key / admin private key).
- **The idiom**: stash the second secret, show only the first sheet, and chain the second on
  the first sheet's explicit acknowledgment — established by the fresh-profile-adopt flow (the
  first flow to surface two one-time secrets in one operation).
- **Pointers to the reference implementation**: `src/main/register-overlay-ipc.js`'s
  `menu-overlay:vault-import` handler (`stashAdoptAdminKey` + the `vault-recovery-show` send)
  and its `menu-overlay:activated` handler (the `vault-recovery-show` branch that calls
  `takeAdoptAdminKey` and sends `vault-adminkey-show` only on that ack).

No source or test files were changed — this is a documentation-only squawk.

## Verification

- Read `src/main/menu-overlay-manager.js`'s `openMenu` (its `if (currentMenu)` model-replace /
  `'superseded'` branch) and confirmed the described clobber mechanics match current source
  (the cited `:325-355` range in the squawk's Evidence covers this branch, give or take a few
  lines of surrounding comments — the substance is accurate).
- Read `src/main/register-overlay-ipc.js`'s `menu-overlay:vault-import` handler and confirmed
  it stashes the admin key (`stashAdoptAdminKey?.(chromeId, res.adminPrivateKeyB64)`) and shows
  only `vault-recovery-show` (`chrome?.send('vault-recovery-show', { recoveryKey:
  res.recoveryKeyDisplay, replacing: true })`) when `res.fresh === true`.
- Read the same file's `menu-overlay:activated` handler and confirmed the chain: on
  `current.menuType === 'vault-recovery-show'`, it calls `takeAdoptAdminKey?.(chrome?.id)` and,
  when a key was pending, sends `vault-adminkey-show` — i.e. the second sheet opens only after
  the first's acknowledgment, exactly as documented.
- `npx prettier --check docs/vault.md` — "All matched files use Prettier code style!", no
  formatting drift introduced.
- Confirmed no other doc references this section by line number that the insertion would stale
  (`grep -n 'vault\.md:' docs/*.md CLAUDE.md` returns no hits into the affected range).

## Sign-Off
**Reviewer**: independent Reviewer agent (squawk-review, scoped to the batch diff)
**Verdict**: confirmed — the `docs/vault.md` bullet accurately describes the
`openMenu` model-replace/`'superseded'` branch and the
`menu-overlay:vault-import` / `menu-overlay:activated` stash-then-chain wiring
(verified against current source); documentation-only, prettier clean
**Commit**: `squawk/turnaround-2026-08-30` (squash-merged via its PR)
