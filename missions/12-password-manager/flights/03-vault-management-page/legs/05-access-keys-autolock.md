# Leg: access-keys-autolock

**Status**: completed
**Flight**: [Vault Management Page](../flight.md)

## Objective

Complete `goldfinch://vault`: per-vault access-key management (list existing grants, mint a new one
behind a chrome-owned **step-up** master-password prompt, revoke), and the auto-lock duration setting
UI — the last of F1's unwired primitives to get their management surface.

## Context

- **Flight DD5 / mission "durable-grant step-up"** — minting an access key requires a **fresh
  master-password confirmation even while unlocked** (F1's `mintAccessKey` step-up gate). Per DD5 the
  master password is entered on the **chrome-owned sheet** (a `vault-stepup` kind, reusing leg-4's
  modal-card helper + the invoke-Buffer channel), never the page DOM.
- **F1 substrate** — `mintAccessKey(target, { masterPassword })` → `{ secret, keyId }` once (step-up
  re-unwraps the master envelope before any write, `vault-store.js:897`; wrong pw → `VaultAuthError`,
  nothing minted); `revokeAccessKey(vaultId, keyId)` → bool (`:1025`, takes a raw vaultId);
  `listEnvelopeKeyIds(parsed)` (`vault-crypto.js:727`) enumerates a vault's envelope key-ids.
  `vaultAutoLockMinutes` setting (default 10, validator int [1,1440]) + the `settingsGet/Set` bridge.
- **Leg-4 substrate** — the modal-card helper (dismissibility-parameterized), the `vault-set` +
  `menu-overlay:vault-setup` Buffer-channel pattern the step-up mint mirrors, the `vault-recovery-show`
  dismiss-locked one-time-secret display, the cross-renderer request-trigger idiom.
- **Access keys ≠ automation transport keys** — the vault-store `access` envelopes (unlock a vault's
  key) are a SEPARATE system from the MCP transport bearer tokens (`automationKeyHashes` / `mintJarKey`).
  This leg manages the **vault access envelopes** only.

## Open Questions

- [x] **Where the minted access secret is shown once** → **the chrome sheet** (`vault-accesskey-show`,
      dismiss-locked, like `vault-recovery-show`) — Architect-confirmed. The step-up password is
      already on the sheet, so showing the result there adds no new secret→page path; it mirrors
      leg-4's setup flow and reuses the audited dismiss-locked one-time display. (The access secret is
      scoped, not master-equivalent, so the page would be defensible — but the sheet is uniform + adds
      no TCB.)
- [x] **Does `mintAccessKey` accept a Buffer master password?** → **YES, natively — NO widening
      needed.** Unlike `setup` (which had a `typeof === 'string'` reject), `mintAccessKey` has no such
      guard; it passes the password to `vc.unwrapMaster`→`deriveMasterKey`→`crypto.scrypt`, all of
      which accept `string | Buffer` (like `unlock`). Only an optional JSDoc `@param` tidy — not
      required for typecheck (the Buffer call sites aren't `@ts-check`). A **wrong password genuinely
      refuses**: the step-up `unwrapMaster` runs before any write → `VaultAuthError` → nothing minted
      (the delegate maps it to `{ ok:false }`, the `vaultUnlock` pattern).

## Inputs

- `src/main/vault/vault-store.js` — `mintAccessKey`/`revokeAccessKey`; a net-new **list-access-keys**
  op (read the vault file's envelopes → `listEnvelopeKeyIds` → filter to `access`). `_requireMrk`.
- `src/main/vault/vault-crypto.js` — `listEnvelopeKeyIds(parsed)`.
- `src/main/settings-store.js` — `vaultAutoLockMinutes` (get/set via the existing settings IPC).
- `src/renderer/menu-overlay.js` + `src/shared/modal-card-controller.js` + `vault-set-template.js` /
  `vault-recovery-template.js` (leg 4) — the sheet-flow patterns to mirror (`vault-stepup` like
  `vault-set`; `vault-accesskey-show` like `vault-recovery-show`).
- `src/main/register-overlay-ipc.js` — the `menu-overlay:vault-setup` handler to mirror for step-up mint.
- `src/main/register-vault-ipc.js` — the internal-IPC composition; add list/revoke + the request-mint trigger.
- `src/preload/internal-preload.js` — `settingsGet/Set` + the vault bridge.
- `src/renderer/pages/vault.{js,css}` — add the access-key + auto-lock sections.

## Outputs

- **Store op (net-new)** — `listAccessKeys(target)`: `_requireMrk()` → **`_resolveTarget(target)`**
  (the allowlist — excludes burner/unknown, avoids raw-target path construction) → `_readVault` →
  filter `e.keyId !== 'mrk'` (the sentinel idiom; `TYPE_ACCESS` is **not** exported) → `[{ keyId }]`
  (**no secret** — keyIds are plaintext fingerprints). MRK-gating is a **policy** choice (uniform
  locked-routing), not crypto necessity.
- **Mint-with-step-up flow (mirrors leg-4 setup byte-for-byte)** — page "mint access key" →
  cross-renderer request carrying `{ target }` (non-secret) → chrome opens the `vault-stepup` sheet
  (master password, one field) → `Uint8Array` + `target` over a new `menu-overlay:vault-stepup-mint`
  invoke channel (payload `{ token, secret, target }`; otherwise mirrors `menu-overlay:vault-setup`:
  sender+token, `secret instanceof Uint8Array`, `Buffer.from`, **dual-zeroize** in `finally`) → the
  main delegate `(buf, target) => getVaultStore().mintAccessKey(target, { masterPassword: buf })`
  (positional target — no widening needed) → `{ ok, secret, keyId }`; a **`VaultAuthError` (wrong
  step-up password) → `{ ok:false }`** and the mint refuses (the store's `_resolveTarget` is the
  main-side authority that also rejects a burner/unknown target even if a compromised sheet supplied
  one) → chrome opens `vault-accesskey-show` (dismiss-locked, one-time `{ secret, keyId }` + copy +
  acknowledge). Page refreshes the list.
- **Revoke** — `internal-vault-accesskey-revoke(target, keyId)` (`registerInternalHandler` +
  `catchLocked` — sync throw, so `catchLocked` catches it) → `revokeAccessKey`; the handler passes a
  **`_resolveTarget`-validated** vaultId (the store's `revokeAccessKey` takes a raw `vaultId`, unlike
  mint/list — validate at the handler for symmetry). Immediate (envelope deletion) → refresh.
- **Auto-lock setting UI** — a number input (1–1440) bound to the **existing** `settingsGet/settingsSet
  ('vaultAutoLockMinutes')` bridge (**no new IPC**); an out-of-range write throws the settings
  validator's `TypeError` → the invoke rejects → the page catches + surfaces it. The store re-reads
  `getAutoLockMinutes()` per op, so a change arms the **next** idle timer (a currently-pending timer
  keeps the old value until the next vault op — acceptable; note it).
- **Sheet kinds** — `vault-stepup` (Escape-dismissible, on the modal-card helper) + `vault-accesskey-show`
  (**dismiss-locked**). a11y-audit needs all three edits: add both to `SHEET_STATES`, both node ids to
  **`SHEET_NODE_IDS`**, and a `SHEET_DISMISS_EXPR` branch for `vault-accesskey-show` (like the
  `sheet-vault-recovery` dismiss-locked special-case — else the audit's Escape leaves it open and the
  run fails).
- **Bridge/main/renderer wiring** — `listAccessKeys`/`revoke` internal IPC; the request-mint trigger +
  `onVaultRequestMint` chrome handler (mirror leg-4's `onVaultRequestSetup`); `vaultMintAccessKey`
  injection into `registerOverlayIpc`; bridge + d.ts.
- **Tests** — unit: `listAccessKeys` (keyIds only, no secret); the `vault-stepup`/`vault-accesskey-show`
  builders; the auto-lock input (validity 1–1440). Integration: `menu-overlay:vault-stepup-mint`
  (Buffer→mint, dual-zeroize, sender/token, **wrong password refuses**, returns secret+keyId once);
  `internal-vault-accesskey-list`/`-revoke` (non-internal rejected, locked→`{locked:true}`, revoke
  immediate); the auto-lock get/set round-trip.

## Acceptance Criteria

- [x] The page lists a vault's existing access keys by **keyId only** (no secret; grep AC), MRK-gated.
- [x] Minting requires a **fresh master password on the chrome sheet** (`vault-stepup`) even while
      unlocked; a **wrong password refuses** the mint (step-up gate); on success the minted secret is
      shown **once** (dismiss-locked sheet) and never appears in the page DOM or any `internal-*`
      payload (grep AC); the buffer is dual-zeroized.
- [x] Revoke removes the access envelope immediately (`revokeAccessKey`); the list refreshes.
- [x] The auto-lock setting reads/writes `vaultAutoLockMinutes` (1–1440) via the settings bridge; an
      out-of-range value is rejected (the existing validator).
- [x] `mintAccessKey` accepts the step-up master password as a Buffer (natively — no widening needed;
      no string guard exists).
- [x] Existing tests pass unmodified; `npm test`, `npm run typecheck`, lint clean.

## Verification Steps

- Unit: `listAccessKeys` (keyIds, no secret); the two builders; the auto-lock input validity.
- Integration: `menu-overlay:vault-stepup-mint` (Buffer→mint, dual-zeroize, sender/token, wrong-password
  refusal, one-time secret+keyId); `internal-vault-accesskey-list`/`-revoke` (non-internal, locked,
  immediate revoke); auto-lock get/set.
- `npm test` full — no regressions. typecheck + lint clean.
- Grep: no access secret on any `internal-*` payload or page DOM path; the minted secret only on the sheet.

## Implementation Guidance

1. **`listAccessKeys(target)`** (`vault-store.js`) — `_requireMrk()` → `_resolveTarget(target)` →
   `_readVault` → `listEnvelopeKeyIds` → filter `keyId !== 'mrk'` → `[{ keyId }]` (no secret).
2. **Step-up mint** — mirror leg-4: a `vault-stepup` sheet (one password field) on the modal-card
   helper; `menu-overlay:vault-stepup-mint` handler mirrors `menu-overlay:vault-setup` (sender+token,
   Buffer, dual-zeroize) → `vaultMintAccessKey` injection → `mintAccessKey({ target, masterPassword: buf })`
   (widen its guard for Buffer like leg-4 widened `setup`, if needed) → on success drive chrome to open
   `vault-accesskey-show` (dismiss-locked) with `{ secret, keyId }`; a `VaultAuthError` (wrong step-up
   password) → `{ ok:false }`, the sheet re-prompts. The page triggers via a cross-renderer
   request-mint (leg-4 idiom) carrying the target vault id (non-secret).
3. **Revoke** — `internal-vault-accesskey-revoke` handler (`catchLocked`) → `revokeAccessKey`.
4. **Auto-lock** — a number input (1–1440) bound to `settingsGet/Set('vaultAutoLockMinutes')`; surface
   the validator's rejection.
5. **Page** — an access-keys section (list + Mint + per-row Revoke) and an auto-lock section. No secret
   in the page; `textContent`-only. **a11y-audit (three edits):** `vault-stepup` + `vault-accesskey-show`
   in `SHEET_STATES`; both node ids in `SHEET_NODE_IDS`; a `SHEET_DISMISS_EXPR` dismiss-locked branch
   for `vault-accesskey-show` (parallel the `sheet-vault-recovery` case).

## Edge Cases

- **Wrong step-up password** — mint refused (`VaultAuthError` → `{ok:false}`); sheet re-prompts; nothing minted.
- **Locked** — every op MRK-gated → `{locked:true}` → page routes to unlock (leg-4 path).
- **accesskey-show dismissal** — dismiss-locked (Escape/backdrop/blur don't close); only acknowledge.
- **Revoke of a stale keyId** — `revokeAccessKey` returns false; refresh reflects reality.
- **Auto-lock out of range** — the settings validator rejects; the UI surfaces it, no store change.
- **Buffer zeroization** — both copy + incoming array, success and throw (F2/leg-4 pattern).

## Files Affected

- `src/main/vault/vault-store.js` — `listAccessKeys` (+ `mintAccessKey` Buffer widening if needed).
- `src/main/register-vault-ipc.js` — list/revoke handlers.
- `src/main/register-browser-ipc.js` — the request-mint trigger (→ `chromeForTab`).
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-stepup-mint` handler.
- `src/main/main.js` — `vaultMintAccessKey` injection.
- `src/renderer/menu-overlay.js` (+ `src/shared/vault-stepup-template.js`/`vault-accesskey-template.js`) — sheet kinds.
- `src/renderer/renderer.js` — `onVaultRequestMint` + the accesskey-show drive.
- `src/preload/internal-preload.js` + `src/renderer/renderer-globals.d.ts` — bridge + types.
- `src/renderer/pages/vault.{js,css}` — access-key + auto-lock sections.
- `scripts/a11y-audit.mjs` — `vault-stepup` + `vault-accesskey-show` in `SHEET_STATES`.
- `test/unit/…` — `listAccessKeys`, the builders, the mint/revoke handlers, auto-lock get/set.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] This is the FINAL leg — but do NOT set flight status or commit; the Flight Director runs the
      flight-end review, then commits + lands the whole flight.
