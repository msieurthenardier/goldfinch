# Leg: surface-adopted-keys

**Status**: landed
**Flight**: [Vault Trust-Boundary Hardening](../flight.md)
**Finding**: F8 (surfacing half — split from Leg 2 by the 2026-08-29 divert)
**Risk tier**: HIGH — multi-surface (store lock path + main delegate + IPC
handler + chrome sheets); lockout-critical (a dropped recovery display on
the recovery-adopt path is a hard lockout).
**Depends on**: Leg 2 (the fresh-adopt store return now carries
`recoveryKeyDisplay` + `adminPrivateKeyB64`).

## Objective

Reveal the two rotated one-time secrets from a fresh adopt (Leg 2) to the
operator — the new recovery key, then the new admin private key — each once
on its dismiss-locked sheet, **sequentially** so the second never clobbers
the first, and keep the profile unlocked until both are acknowledged so the
recovery-adopt path cannot lock out.

## Why sequential, not both-at-once (the [HIGH] the divert is built on)

The chrome sheet manager fires `'superseded'` when a menu of a different
`menuType` opens while one is showing (`menu-overlay-manager.js:325-355`).
`vault-recovery-show` → `vault-adminkey-show` IS a menuType change, so two
immediate `send()`s would destroy the dismiss-locked recovery sheet before
the user reads the one-time recovery key. On the recovery-adopt path (no
donor master password held, source recovery key rotated away) that is a
permanent lockout. So: show recovery FIRST; open adminkey-show only AFTER
the recovery sheet is acknowledged.

## Context (current code, verified 2026-08-29)

- Delegate: `vaultImportFromSheet(chromeId, buf, secretKind)` —
  `src/main/main.js:956`. Today it calls `getVaultStore().importVault(...)`
  and returns `{ ok: true }` on success WITHOUT capturing the store return.
- IPC handler: `menu-overlay:vault-import` —
  `src/main/register-overlay-ipc.js:283`. On `res.ok` it closes the import
  sheet and returns `{ ok: true }`; it already forwards a non-secret
  `res.reason` for a collision. `chromeForAttachment(rec.win)` is the
  send target; `chromeForAttachment(rec.win)?.id` is the per-window chrome
  id used to key `_pendingVaultImports`.
- Surfacing precedent (mirror exactly): rotate-recovery sends
  `chromeForAttachment(rec.win)?.send('vault-recovery-show', { recoveryKey,
  replacing: true })` (`:344`); rotate-admin sends
  `send('vault-adminkey-show', { adminPrivateKey })` (`:383`). Setup sends
  recovery-show without `replacing` (`:220`).
- Sheet acknowledgment: the read-only show sheets close through the
  `menu-overlay:activated` handler (`:90-114`), which resolves main-side
  then `closeMenuOverlay('activated', token)` and sends
  `menu-overlay-activated { menuType, id }` to the chrome. `current.menuType`
  is available there — the hook point for "recovery-show acknowledged →
  open adminkey-show".
- Lock: `lockNow()` (`vault-store.js:477`); the autolock timer arms/fires
  via `lockNow()` (`:456-465`). Suppressing autolock while surfacing is
  pending is the candidate lockout-window guard (feasibility → design review).
- IPC test harness: `test/unit/vault-import-handler.test.js` (records a
  `chromeSends` array from the fake `chromeForAttachment(...).send`) — the
  seam the AC5-family tests plug into. Sibling patterns in
  `vault-setup-handler.test.js`, `vault-rotation-handlers.test.js`.

## Acceptance Criteria

1. **Delegate forwards the fresh-adopt secrets.** `vaultImportFromSheet`
   (`main.js:956`) captures `importVault`'s return and returns `{ ok: true,
   fresh, recoveryKeyDisplay, adminPrivateKeyB64 }` on a fresh adopt, and
   `{ ok: true, fresh: false }` (no secrets) on an existing-profile adopt.
   (The store return uses `imported`; the delegate maps `imported`→`ok` and
   passes `fresh` + the two secrets through — store return shape confirmed at
   `vault-store.js:1085-1089` fresh / `:1108` existing.) Failure/collision
   returns unchanged. The secrets are NEVER placed in the
   sheet's invoke reply and NEVER enter any page DOM (mirror rotate-*).
2. **Handler shows recovery first + stashes the pending admin key.** In the
   `menu-overlay:vault-import` handler, on `res.ok && res.fresh === true`:
   close the import sheet, `send('vault-recovery-show', { recoveryKey:
   res.recoveryKeyDisplay, replacing: true })`, and record the pending
   `adminPrivateKeyB64` keyed by the window's chrome id (same keying idiom
   as `_pendingVaultImports`). The invoke still returns `{ ok: true }` with
   no secrets. Existing-profile adopt path is UNCHANGED (no sends).
3. **Chain: adminkey-show only after recovery is acknowledged.** The
   recovery-show acknowledge fires `menu-overlay:activated` with
   `{ id: 'ack' }` (`menu-overlay.js:1403-1406` — the ONLY close path; the
   sheet is `dismissible:false`). In the `menu-overlay:activated` handler
   (`register-overlay-ipc.js:90`), AFTER the existing `closeMenuOverlay`,
   place the hook alongside the cert-picker special-case (`:104-108`): when
   `current.menuType === 'vault-recovery-show'` AND a pending adopt admin key
   exists for `chromeForAttachment(rec.win)?.id`, `send('vault-adminkey-show',
   { adminPrivateKey })`, clear the pending record, and clear the autolock
   suppression (AC4). Exactly one show sheet is ever open at a time — no
   back-to-back sends. A `vault-recovery-show` with no pending admin key
   (setup / rotate-recovery) is unaffected. The `token === current.token`
   check already prevents a stale double-fire.
4. **Lockout-window guard — store-side autolock suppression (MANDATORY; the
   fallback is unsafe).** The autolock timer is store-owned: `_touch` arms
   `this._timer = this._setTimeout(() => this.lockNow(), ms)`
   (`vault-store.js:464-465`), and `_installMrk` calls `_touch` (`:723`), so
   a fresh adopt arms autolock immediately (default 10 min, floor 1 min).
   Main has NO interception point. Add a store-side boolean (`_suspendAutoLock`)
   consulted in the `_touch` timer callback — when set, re-arm/skip instead of
   `lockNow()` — touching ONLY the timer surface, never the crypto/rotation
   code Leg 2 closed. A small store setter is driven from main's pending
   lifecycle: SET when the admin key is stashed (AC2), CLEAR at the
   **recovery-show acknowledgment** — when the pending admin key is taken and
   the admin sheet opens (AC3) — plus window teardown. **Reconciled at
   flight-end review (2026-08-29):** clearing at recovery-ack (rather than
   holding to admin-ack) is verified safe — the lockout-critical secret is the
   RECOVERY key, whose window closes at recovery-ack; and `lockNow()`
   (`vault-store.js:508-524`) only zeroizes key buffers and pushes lock-state
   to the vault *page*, never touching the `menu-overlay` sheet system, so an
   idle autolock while the `vault-adminkey-show` sheet is open cannot close or
   lose the already-delivered admin key. The admin key is not lockout-critical.
   **Rejected fallback (recoverability premise is false).** "Re-adopt from the
   still-held donor bundle" does NOT recover: after the first adopt
   `isSetUp()` is true, so a re-adopt takes the existing-profile branch
   (`_requireMrk`, needs the store UNLOCKED, `:1097`); a `secretKind:'recovery'`
   adopter holds no master password and the donor recovery key was rotated
   away, so a new recovery key lost to autolock = **permanent lockout** — the
   exact failure this leg exists to prevent. Residuals documented, not fixed:
   a deliberate `before-quit → lockNow` during surfacing still locks
   (deliberate destructive action); manual lock is unreachable behind the
   modal dismiss-locked sheet.
   **Pending-key hygiene.** `adminPrivateKeyB64` is a JS string (immutable —
   not `fill(0)`-zeroizable) and now dwells in a main-side map for a
   user-controlled duration (until the recovery sheet is acked). Drop the map
   entry promptly on ack (AC3) and add window-destroyed/teardown cleanup that
   clears it AND the suppression flag (mirror whatever `_pendingVaultImports`
   does on teardown). State the non-zeroizability as consistent with existing
   one-time-secret handling; minimize dwell.
5. **IPC-layer tests** (`test/unit/vault-import-handler.test.js`), via the
   `chromeSends` harness — assert the DELEGATE RETURN-SHAPE branches (the
   meaningful IPC-layer distinction; genuine both-`secretKind` coverage lives
   in Leg 2's store tests, and the delegate is STUBBED here so `secretKind`
   does not change IPC behavior):
   - delegate returns `{ ok:true, fresh:true, recoveryKeyDisplay,
     adminPrivateKeyB64 }` → after the import invoke, `chromeSends` has
     exactly one `vault-recovery-show` (with the recovery key) and NO
     `vault-adminkey-show`; then simulating the recovery-show acknowledgment
     (`menu-overlay:activated`, `{ id:'ack' }`, with a mutable
     `getCurrentMenu` presenting `menuType:'vault-recovery-show'`) yields
     exactly one `vault-adminkey-show` (with the admin key) — assert by
     CHANNEL-FILTER, not array length (the activated handler also echoes
     `menu-overlay-activated` onto `chromeSends`);
   - delegate returns `{ ok:true, fresh:false }` → NEITHER show channel sent;
   - the invoke replies carry no secret material.
   **Harness note**: `sheet.getCurrentMenu` is currently a fixed
   `{ token:7, menuType:'vault-import' }` stub — make it mutable so step 2 can
   present `vault-recovery-show`. Add an AC4 suppression assertion if reachable
   through the store test seam.
6. **HAT before the flight commits** (operator-chosen verification). A short
   guided human acceptance test: live fresh adopt → recovery sheet appears
   with the new key → acknowledge → admin sheet appears with the new key →
   both captured, no clobber, profile still unlocked throughout. Recorded in
   the flight log; the flight does not commit until this passes.
7. **No regression.** `npm test` green with the new/extended tests;
   `npm run typecheck`, `npx eslint .`, `npx prettier --check .` clean.
   `npm run a11y` only if a sheet's DOM markup changes (it reuses the
   existing recovery-show/adminkey-show sheets, so likely not — state the call).

## Verification

- AC1/AC2/AC3: read the delegate + handler + activated-path hook; confirm
  exactly one show sheet open at any time.
- AC5: `node --test test/unit/vault-import-handler.test.js` green; assert on
  the `chromeSends` ordering (recovery before any admin; admin only post-ack).
- AC6: the guided HAT, driven by the Flight Director with the operator.
- AC7: `npm test` counts before/after; typecheck/eslint/prettier clean.

## Out of Scope

- The store-level rotation + return shape (Leg 2, landed).
- The donor MASTER-envelope residual (DD4 — documented in Leg 4).
- Any change to the one-time sheet DOM/templates themselves.
- `docs/vault.md` and squawk 0022 (Leg 4).

## Citation Audit

Verified 2026-08-29: `vaultImportFromSheet` main.js:956/962; `menu-overlay:vault-import`
handler register-overlay-ipc.js:283 (close+return :300-308); `menu-overlay:activated`
handler :90-114; recovery-show send precedent :220/:344, adminkey-show send :383;
`lockNow` vault-store.js:477, autolock arm/fire :456-465; harness
test/unit/vault-import-handler.test.js. All current.
