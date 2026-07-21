# Leg: first-run-setup

**Status**: completed
**Flight**: [Vault Management Page](../flight.md)

## Objective

Make `goldfinch://vault` usable from a fresh profile and while locked: first-run setup (choose the
master password on the chrome-owned sheet → `setup()` → show the recovery key once on the sheet) and
the request-unlock path (the page's locked-state affordance opens F2's chrome-owned unlock sheet).
Also land the DD5 template-registry / modal-card refactor before these new sheet kinds stack.

## Context

- **Flight DD5 (Architect-ruled)** — **no master-equivalent secret ever touches the vault page DOM.**
  The master password (setup) and the recovery-key display live on the chrome-owned menu-overlay
  sheet, reusing F2's zeroized-`Buffer` invoke channel. The page **orchestrates** (triggers the sheet,
  shows only non-secret results). This leg extends F2's sheet family with the setup/recovery kinds and
  lands the **template-registry / modal-card refactor** (F2's dialog-style `vault-unlock`/`vault-capture`
  controller wiring onto a shared modal-card helper; the roving `vault-picker` stays separate).
- **F1 substrate** — `setup({ masterPassword })` → `{ recoveryKeyDisplay, adminPrivateKeyB64 }`
  **exactly once**, leaves the store unlocked (`vault-store.js:374`). `isSetUp()`/`isUnlocked()`.
- **F2 substrate** — the `vault-unlock` sheet + `unlockVault({token, secret})` invoke Buffer channel,
  `menuOverlayOpen`, the lock-state broadcast (`onUnlock` from `_installMrk` → all chrome renderers),
  the `#vault-indicator`. Leg-1 stubbed the page's setup CTA + locked-unlock affordance.

## Inputs

- `src/renderer/menu-overlay.js` — F2's `vault-unlock`/`vault-picker`/`vault-capture` controller
  wiring (the dialog-style ones to factor); `TEMPLATES`/`NODE_OF_ENTRY`/the one-report token protocol.
- `src/shared/vault-*-template.js` — the F2 card builders (already factored; this leg adds set/recovery builders).
- `src/main/register-overlay-ipc.js` — the sheet→main invoke site (`menu-overlay:vault-unlock` precedent) + `recordForSheetSender`/token validation.
- `src/main/vault/vault-store.js` — `setup`, `isSetUp`, `isUnlocked`.
- `src/main/main.js` — the F2 `vaultUnlock` injection, the lock-state broadcast, `getVaultStore`, the chrome↔main wiring.
- `src/renderer/pages/vault.js` (leg 1) — the not-set-up CTA + locked-unlock affordance stubs; `internal-vault-state`.
- `src/preload/internal-preload.js` — the `goldfinchInternal` bridge.

## Outputs

- **Template-registry / modal-card refactor** — extract the shared modal-card controller (backdrop +
  Tab-trap + Escape + one-report token) **into its own importable module** (not inline in
  `menu-overlay.js`) so it can be behaviorally unit-tested; F2's `vault-unlock` + `vault-capture`
  (dialog-style) re-express on it. **The helper parameterizes dismissibility** (see
  `vault-recovery-show`). The roving `vault-picker` does NOT fold onto it. **Discipline (thin net —
  the F2 sheet tests are DOM-builder-only, no `menu-overlay.js` controller test exists):** write the
  behavioral tests (Tab-cycle, Escape/backdrop, token) as **characterization tests green against the
  F2 wiring FIRST**, then refactor and keep them green — the only real proof of byte-identical
  behavior. The refactor is the leg's **first sub-step with its own green checkpoint** before the new
  kinds stack.
- **New chrome-owned sheet kinds** (added to `TEMPLATES`/`NODE_OF_ENTRY`; add both to
  `a11y-audit.mjs` `SHEET_STATES` per DD9):
  - `vault-set` (on the shared helper) — master-password + confirm fields (client-side match check),
    submitting the password as a `Uint8Array` over a **dedicated invoke Buffer channel**
    (`menu-overlay:vault-setup`, mirroring `menu-overlay:vault-unlock` byte-for-byte: sender-identity
    + open-token + `secret instanceof Uint8Array` + `Buffer.from` copy + **dual-zeroize** `buf.fill(0);
    secret.fill?.(0)` in `finally`) → main `vaultSetup(buffer)` → returns `{ ok, recoveryKeyDisplay }`.
  - `vault-recovery-show` — a **read-only** one-time display of the **recovery key only** (admin key
    deferred to F4) + copy + an explicit "I've saved it" acknowledge. **It OPTS OUT of the shared
    dismiss wiring** — Escape / backdrop-click / window-blur must NOT close it (the store is already
    set up + unlocked and the key is unrecoverable; only the deliberate acknowledge closes). This is
    why the helper must parameterize dismissibility.
- **Cross-renderer trigger path (the DD5 orchestration — VERIFIED wireable)** — the internal page
  can't call chrome-trust `menuOverlay.*`, so: page → `internal-vault-request-setup` /
  `internal-vault-request-unlock` (internal IPC) → **main** resolves the owning window's chrome via
  `chromeForTab(event.sender.id)` (the internal tab is in `tabViews`, so `getWindowForGuest` resolves
  it) → main→chrome `send` (the `guest-vault-gesture`→`vault-gesture` idiom, `register-browser-ipc.js`)
  → chrome's handler opens the sheet via `openOverlayMenu` (the `onVaultGesture` precedent,
  `renderer.js`). On setup/unlock success the F2 lock-state broadcast fires → the page refreshes.
  **Handler home:** because `registerVaultIpc` has no `chromeForTab`, place the `internal-vault-request-*`
  handlers in **`register-browser-ipc.js`** (which already imports `chromeForTab`), or inject
  `getChromeForTab` into `registerVaultIpc` — resolve to one.
  **Distinct request-unlock renderer handler:** the page's unlock must open `vault-unlock` **without**
  F2's `pendingVaultFlow` picker-continuation (`onVaultGesture`'s locked branch → `onVaultLockState`
  springs the *fill picker*). Add a separate `onVaultRequestUnlock` chrome handler that opens
  `vault-unlock` with no picker continuation; the page refreshes off the lock-state broadcast.
- **Main wiring — `setup` needs a Buffer widening (the one landed-F1 store edit, explicitly scoped).**
  `setup({ masterPassword })` currently rejects a non-string (`vault-store.js:389`); widen that guard
  to accept a **non-empty Buffer** (crypto's `scrypt` accepts a Buffer password — no crypto change).
  Inject `vaultSetup: async (buf) => getVaultStore().setup({ masterPassword: buf })` into
  `registerOverlayIpc` (mirrors `vaultUnlock`); the `menu-overlay:vault-setup` handler zeroizes the
  buffer. Note: `setup` **returns the recovery key as a JS string** (F1) — un-zeroizable, an accepted
  limitation; it crosses main→sheet in the `menu-overlay:init` (channel-3) payload (the first sheet
  model to carry a secret) — the sheet must drop the reference on close and the model-replace/
  superseded path must never re-emit it.
- **Page** — replace leg-1's stubs: the not-set-up CTA calls `requestSetup()`; the locked-state
  affordance calls `requestUnlock()`; the page subscribes to lock-state (or re-queries on
  sheet-close) to move not-set-up → unlocked. `textContent`-only; **no secret in the page**.
- **Tests** — unit: the modal-card helper (Tab-cycle, Escape/backdrop dismiss, token) — behavioral,
  since a11y won't run headless; the `vault-set`/`vault-recovery-show` template builders (structure/
  aria, password confirm-match). Integration: `menu-overlay:vault-setup` (Buffer → `setup` → both
  buffers zeroized, returns recovery/admin, wrong-sender/stale-token rejected); the
  `internal-vault-request-*` handlers (non-internal rejected; forward to chrome). F2 sheet tests stay
  green (refactor guard).

## Open Questions

- [x] **The `adminPrivateKeyB64` from `setup()`** → **DEFERRED to F4 (Architect-ruled).** The admin
      private key is a *machine automation credential* (base64 PKCS8 X25519), not a human-memorable
      secret — dumping it on every new user's first-run "write these down" sheet muddies the threat
      model. F3 setup shows **only the recovery key**; the `adminPrivateKeyB64` returned by `setup()`
      is **not shown/persisted** by F3. **→ F4 requirement (carried):** F4's admin-key work must
      provide a **from-scratch provision** path (reseal the MRK to a fresh admin keypair while
      unlocked, show once) — not only rotate-from-existing — since the setup-minted admin key is not
      surfaced here. (F1 building blocks exist: `generateAdminKeypair`, `sealToAdmin`.)
- [x] **Combined set+confirm sheet vs. two sheets** → **one `vault-set` sheet** with password + confirm
      fields (client match-check), one Buffer round-trip.

## Acceptance Criteria

- [x] On a not-set-up profile, the page's setup CTA opens the chrome-owned `vault-set` sheet;
      entering + confirming a master password runs `setup({ masterPassword: <Buffer> })` in main (the
      `setup` guard widened to accept a non-empty Buffer; the password **never in the page DOM**), then
      the **recovery key only** (admin deferred to F4) is shown **once on the sheet**
      (`vault-recovery-show`), and after acknowledge the page moves to the unlocked state.
- [x] The master password + recovery key **never appear in the vault page DOM or any page-facing
      (`internal-*`) IPC payload** (grep AC) — they live only on the sheet / in main; the recovery-key
      string is dropped from the sheet on close and never re-emitted on model-replace.
- [x] The `menu-overlay:vault-setup` handler zeroizes both the copied Buffer and the incoming array
      (F2 pattern), validates sender + token, and rejects a non-current-sheet sender.
- [x] `vault-recovery-show` **cannot be closed by Escape / backdrop / blur** — only the explicit
      acknowledge closes it (the one-time key is unrecoverable).
- [x] The locked-state affordance opens F2's `vault-unlock` sheet via `internal-vault-request-unlock` →
      main → chrome through a **distinct `onVaultRequestUnlock`** handler (NOT the `pendingVaultFlow`
      fill-picker continuation); on unlock the page refreshes to unlocked.
- [x] The **template-registry refactor** leaves F2's `vault-unlock`/`vault-capture` behavior identical
      — all F2 sheet tests pass unmodified; the extracted modal-card helper has **behavioral**
      characterization tests (Tab-trap, Escape/backdrop, token) that were **green against the F2 wiring
      before the refactor**.
- [x] Confirm-mismatch is caught client-side (no setup attempt); setup failure surfaces an error on
      the sheet.
- [x] Existing tests pass unmodified; `npm test`, `npm run typecheck`, lint clean.

## Verification Steps

- Unit: modal-card helper (behavioral); `vault-set`/`vault-recovery-show` builders (structure/aria,
  confirm-match).
- Integration: `menu-overlay:vault-setup` (Buffer→setup, dual-zeroize, sender/token, returns
  recovery/admin); `internal-vault-request-setup`/`-unlock` (non-internal rejected; chrome forward).
- `npm test` full — F2 sheet tests green (refactor guard); no regressions. typecheck + lint clean.
- Grep: no master password / recovery key on any page-facing (internal) IPC payload or page DOM path.
- (Live-GUI: the real setup/unlock flow + a11y SHEET_STATES for the new sheets are F5-HAT / the
  flight-end a11y run — DD9.)

## Implementation Guidance

1. **Modal-card refactor first, with a real net** — (a) write characterization tests (Tab-cycle,
   Escape/backdrop dismiss, one-report token) against the **current** F2 `vault-unlock`/`vault-capture`
   wiring and get them green; (b) extract the shared backdrop-card controller into its **own importable
   module** (parameterizing dismissibility); (c) re-express F2's two dialog-style kinds on it and keep
   the characterization tests + the F2 DOM-builder suites green. Own green checkpoint before step 2.
2. **Sheet kinds** — `vault-set` (password + confirm, client match-check, submit via a new
   `menu-overlay:vault-setup` invoke Buffer channel, on the shared helper) + `vault-recovery-show`
   (read-only **recovery key only** + copy + acknowledge; **dismiss-disabled** — Escape/backdrop/blur
   do NOT close). Add both to `TEMPLATES`/`NODE_OF_ENTRY` and to `a11y-audit.mjs` `SHEET_STATES`.
3. **Main** — widen `setup`'s `:389` guard to accept a **non-empty Buffer** (the one landed-F1
   `vault-store.js` edit); inject `vaultSetup: async (buf) => getVaultStore().setup({ masterPassword:
   buf })` into `registerOverlayIpc`; the `menu-overlay:vault-setup` handler mirrors `vault-unlock`
   (sender+token, `Uint8Array`→Buffer, **dual-zeroize** in `finally`), calls `vaultSetup`, drives chrome
   to open `vault-recovery-show` with the returned `recoveryKeyDisplay` (string). **Do NOT surface
   `adminPrivateKeyB64` (F4).**
4. **Cross-renderer triggers** — `internal-vault-request-setup` / `internal-vault-request-unlock` in
   **`register-browser-ipc.js`** (has `chromeForTab`) → `chromeForTab(event.sender.id)?.send(...)` →
   chrome opens the sheet. Add an `onVaultRequestSetup` and a **distinct `onVaultRequestUnlock`**
   (no `pendingVaultFlow` picker continuation) in `renderer.js`, mirroring `onVaultGesture`.
5. **Page** — wire the not-set-up CTA → `requestSetup()`, the locked affordance → `requestUnlock()`;
   refresh `internal-vault-state` on the lock-state broadcast / sheet-close. No secret in the page.

## Edge Cases

- **Confirm mismatch** — client-side; no setup call.
- **Setup on an already-set-up store** — guard: `isSetUp()` true → the page shows the unlocked/locked
  view, not the setup CTA; the handler refuses a redundant `setup()`.
- **Recovery-show dismissal** — Escape/backdrop/blur are **disabled** for `vault-recovery-show`; only
  the explicit acknowledge closes it, so the one-time key can't be lost by a casual dismiss. (It is
  still un-re-showable after acknowledge — shown exactly once.)
- **Admin key** — `setup()` returns `adminPrivateKeyB64` but F3 does **not** surface it (deferred to
  F4's from-scratch admin-provision path); it is not shown, not persisted.
- **Buffer zeroization** — both the copy and the incoming array, on success and throw (F2 pattern).
- **Cross-renderer race** — the page requests, chrome opens; if the window's chrome isn't resolvable,
  the request no-ops gracefully.
- **Refactor regression** — any F2 sheet behavior change is a bug (F2 suites + a11y + HAT guard).

## Files Affected

- `src/renderer/menu-overlay.js` + a new importable **modal-card helper module** — refactor + new kinds.
- `src/shared/vault-set-template.js` / `vault-recovery-template.js` (new) — the builders.
- `src/main/vault/vault-store.js` — **widen `setup`'s guard to accept a non-empty Buffer** (the one landed-F1 edit).
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-setup` handler (dual-zeroize).
- `src/main/main.js` — `vaultSetup` injection into `registerOverlayIpc`.
- `src/main/register-browser-ipc.js` — the `internal-vault-request-setup`/`-unlock` handlers (→ `chromeForTab`).
- `src/renderer/renderer.js` — `onVaultRequestSetup` + distinct `onVaultRequestUnlock` (no picker continuation).
- `src/preload/internal-preload.js` + `src/renderer/renderer-globals.d.ts` — `requestSetup`/`requestUnlock` + types.
- `src/renderer/pages/vault.js` — un-stub the CTA + unlock affordance; lock-state refresh.
- `scripts/a11y-audit.mjs` — add `vault-set` + `vault-recovery-show` to `SHEET_STATES`.
- `test/unit/…` — modal-card helper (characterization), set/recovery builders, setup handler, request handlers.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
