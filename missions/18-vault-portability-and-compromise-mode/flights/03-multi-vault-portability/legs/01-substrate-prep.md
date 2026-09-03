# Leg: substrate-prep

**Status**: completed
**Flight**: [Multi-Vault Portability](../flight.md)

## Objective

Clear the flight's runway: extract the main.js vault-glue (the
error-class→reason ladder and the `resurfaceCompromiseReveal`
composition) into testable modules with the test-suite transcriptions
deleted (DD9), and land the operator-ruled blur contract — vault
credential sheets survive window blur — threaded through both the main
and renderer guard sites behind an explicit menuType allowlist, pinned
(DD8).

## Context

- **DD9** (flight.md): Flight 3's restore/sever delegates must be
  written ON an extracted error mapper — never as another inline
  transcription site. (Design review corrected the inherited count:
  there are EIGHT ladder sites, not nine — the grep of all of
  `src/main/` confirms no others exist.) The stores are already extracted (`pending-imports.js`,
  `autolock-suppression.js`, `pending-compromise-reveals.js`); this leg
  finishes the Flight 2 debrief's recommendation 1.
- **DD8** (flight.md): operator ruling reverses the shipped default —
  vault credential sheets retain half-entered state through window
  blur/refocus (the copy-paste-from-another-secrets-manager scenario).
  Blur-dismissal is dual-sited and app-wide; reusing `dismissible`
  would leak blur-survival to non-vault sheets. `vault-unlock` is ruled
  IN scope (confirmed at the spec walk, 2026-09-02).
- **DD11** (flight.md): `renderer.js` sits at 1835 lines against a
  pinned budget of 1836 (`test/unit/seam-contract.test.js:168`) —
  effectively zero headroom. This leg is not expected to touch
  `renderer.js`; if it must, the budget bump is named here and in the
  flight log, never discovered at CI.
- No new menuType is introduced by this leg — no lockstep registration
  (TEMPLATES/NODE_OF_ENTRY, a11y skip list, SEAM_COUNT) is needed.

## Inputs

- `main` at 5eaec48 merged into branch `flight/03-multi-vault-portability`
- Eight inline error-ladder sites in `src/main/main.js` (verified
  2026-09-02; the ONLY such sites in `src/main/` — design-review
  grep): `:1119` (vaultImportFromSheet), `:1757` (vaultUnlock),
  `:1798-1800` (vaultMintAccessKey), `:1834-1838`
  (vaultCompromiseRotate), `:1865-1866` (vaultRotateRecovery),
  `:1883-1884` (vaultRotateAdminKey), `:1900-1901` (vaultChangeMaster),
  `:1926-1928` (vaultRecover)
- `resurfaceCompromiseReveal` at `src/main/main.js:934-948` (closure
  over `registry` and `_compromiseReveals`)
- Transcribed ladder copies in three suites:
  `test/unit/vault-compromise-report-surface.test.js:80-95`,
  `test/unit/vault-stepup-mint-handler.test.js:278-289`,
  `test/unit/vault-unlock-handler.test.js:80-89`
- Blur guard sites: main — `src/main/window-factory.js:333`
  (`win.on('blur', () => sheet.closeMenuOverlay('blur'))`) →
  `src/main/menu-overlay-manager.js:401-411` (`closeMenuOverlay`,
  where one `currentDismissible` flag gates escape/outside-click/blur
  together); renderer — `src/renderer/menu-controller.js:115-133`
  (independent outside-click + window-blur guards reading
  `cur.dismissible`), fed by
  `src/shared/modal-card-controller.js:159` (`entry.dismissible`) and
  the per-entry wiring in `src/renderer/menu-overlay.js` (e.g.
  `:1388`, `:2925`)
- `keepFocus` precedent: per-open opt-in flag threaded chrome →
  payload → `menu-overlay-manager.js:376` state → guarded behavior,
  reset on close (`:414`); pinned at
  `test/unit/menu-overlay-manager.test.js:1032-1060`. Note `keepFocus`
  does NOT guard the window-blur close — it only drives the bounded
  re-grab (`KEEP_FOCUS_MAX`, `menu-overlay-manager.js:98`) for
  guest-stolen focus while the window stays focused. It is a
  neighboring axis, not the mechanism to extend.

## Outputs

- New module `src/main/vault/vault-sheet-errors.js` (name adjustable):
  the single source of truth for error-class→reason mapping, with its
  own unit suite
- New Electron-free resurface unit (either a new export from
  `pending-compromise-reveals.js` or a sibling module) with its own
  unit tests; `main.js:934-948` becomes a thin delegation
- All eight main.js ladders route through the mapper; three test-suite
  transcriptions deleted in favor of the real module
- New blur-survival axis (suggested name: `survivesBlur`) on the
  sheet-open payload, threaded through BOTH guard sites, scoped by a
  shared vault-credential menuType allowlist; pins on both sides
- Docs updated where sheet blur behavior is described

## Acceptance Criteria

### DD9 — glue extraction

- [x] A mapper module exists in `src/main/vault/` exporting the
      class→reason mapping; each of the eight delegate sites routes its
      catch through it. Per-delegate reason WIDTH is preserved exactly
      (e.g. `vaultRotateRecovery` maps only auth + busy; a
      VaultStateError there must still propagate — the width per
      delegate is deliberate, per the squawk-0058 comments). Unknown
      classes rethrow.
- [x] `vaultUnlock`'s bare-boolean return shape is preserved (the
      delegate adapts the mapper's result; the IPC surface does not
      change).
- [x] The mapper has its own unit suite: every mapped class per
      delegate config, unknown-error rethrow, and the exact result
      shapes (`{ok:false}` vs `{ok:false, reason}` vs `false`).
- [x] The transcribed ladders in the three named suites are DELETED;
      those suites compose their delegates from the real mapper module
      (real or fake store — two of the three run a REAL VaultStore
      against a temp dir — plus the real mapper), so a future mapping
      change fails
      loudly instead of silently diverging.
- [x] `resurfaceCompromiseReveal`'s composition (orphan scan over live
      chromeIds, at-most-one rekey, dead-chrome no-op, sheet re-open
      send) is extracted into an Electron-free unit with injected deps
      and its own tests; `main.js` delegates to it.
- [x] All existing vault handler/store suites pass with NO expectation
      changes other than the three transcription deletions —
      behavior-preserving refactor.

### DD8 — blur contract

- [x] A new per-open axis (NOT `dismissible`, NOT `keepFocus`) exists
      on the sheet-open payload and is honored at BOTH sites in this
      leg: `menu-overlay-manager.closeMenuOverlay` ignores reason
      `'blur'` (and only `'blur'`) for a survives-blur menu; the
      renderer window-blur listener in `menu-controller.js` skips
      `closeAll()` for it. Escape, outside-click, `'activated'`,
      tab/window lifecycle closes, and model-replace behave exactly as
      before on both sites.
- [x] The axis state resets on close/model-replace exactly as
      `keepFocus` does (no leak into the next menu session).
- [x] Membership is a single shared source of truth (a shared-module
      constant), applied at the ONE chrome-side funnel every sheet
      open passes through — `open()` in
      `src/renderer/chrome/overlay-menus.js:63-75` (design-review
      trace: all ~20 vault open sites in `vault-controller.js`,
      including the `*ForAudit` a11y duplicates, funnel there) — not
      scattered across the ~20 call sites. Membership was VERIFIED at
      design review against the templates (every listed sheet renders
      a `type="password"` input): `vault-unlock` (ruled IN),
      `vault-set`, `vault-stepup`, `vault-change-master`,
      `vault-recover`, `vault-import` / `vault-import-unlock` (one
      entry — `vault-import-unlock` is aliased to the `vault-import`
      template at `menu-overlay.js:2733`), `vault-compromise`,
      `vault-compromise-recover`. Explicitly OUT (verified): the show
      sheets (`vault-recovery-show`, `vault-accesskey-show`,
      `vault-adminkey-show` — already `dismissible:false`, blur-immune
      via that axis), `vault-capture` (offer card, no typed secret;
      its renderer-only `dismissible:false` at `menu-overlay.js:1192`
      is an unrelated mechanism and stays untouched), `vault-picker`
      (metadata-only by design).
- [x] Main trusts the chrome-sent flag, matching the `dismissible` /
      `keepFocus` precedent (`menu-overlay-manager.js:372`/`:376` —
      no main-side menuType validation): the payload originates in the
      trusted chrome document, not guest content. This is deliberate;
      recorded here so the choice is auditable.
- [x] The contract is pinned on both sides: main-site tests in
      `menu-overlay-manager.test.js` (survives-blur menu ignores
      `'blur'`, still closes on the other reasons; a non-flagged menu
      still blur-closes), and renderer-site tests beside the existing
      menu-controller/modal-card coverage.
- [x] `test/unit/vault-controller-capture.test.js:163`: the `'blur'`
      case in the unlock-prompt close-reasons loop is handled under the
      rename-not-silent-edit rule — annotated or split out as
      production-unreachable for `vault-unlock`, with the remaining
      reasons still pinned. Not silently deleted.
- [x] Sweep: no remaining test or load-bearing comment asserts
      blur-dismissal for an allowlisted vault sheet (grep for
      `'blur'` / `closeMenuOverlay('blur')` across tests + src); each
      hit is either out of scope (non-vault sheet — unchanged) or
      handled above. Design review pre-located two benign hits the
      sweep must disposition explicitly: `auth-challenges.test.js:507`
      (vault-unlock/'blur' as an arbitrary foreign-menuType stand-in,
      store called directly — keeps passing) and `:554-557`/`:1032`
      (vault-recovery-show, out of the allowlist). Findings listed in
      the flight log.
- [x] Docs that describe sheet dismissal/blur behavior tell the new
      truth, including the accepted trade-off (half-typed secret
      material persists in a blurred window until lock/close): both
      `docs/vault.md` AND the CLAUDE.md menu-overlay-sheet section
      (alongside its `dismissible`/`keepFocus` notes).
- [x] **Close-on-lock exists and is pinned.** Design review verified
      the current state: NOTHING closes a credential sheet on vault
      lock today — `vaultLockNow()` (`main.js:1973-1977`) →
      `broadcastVaultLockState()` is broadcast-only, no
      `closeMenuOverlay` anywhere on the lock path, and credential
      sheets hold no autolock-suppression hold, so the idle timer can
      fire under an open sheet. DD8's contract names close-on-lock,
      and survive-blur raises the stakes (half-typed secrets now
      outlive an app switch) — so this leg ADDS it: on vault lock
      (manual or autolock), an open ALLOWLISTED vault credential sheet
      is closed main-side via `closeMenuOverlay` with a new explicit
      reason (suggested `'vault-lock'`), wired from **the store's
      injected `onLock` callback (`main.js:769` —
      `onLock: () => broadcastVaultLockState()`)**. That is the ONLY
      anchor that covers both lock paths: manual lock
      (`vaultLockNow()`, `main.js:1973-1977`) and the autolock idle
      timer, which lives inside `vault-store.js` and calls
      `this.lockNow()` directly (`vault-store.js:624`) — it never
      passes through `vaultLockNow()`, so hooking the wrapper would
      silently miss autolock (cycle-2 review). A test MUST exercise
      the close via the idle-timer path (i.e. `VaultStore.lockNow()`
      reached other than via the manual handler), not just manual
      lock. Requirements: the new reason joins the
      documented reason enum (`menu-overlay-manager.js:396-397`
      JSDoc); it is a HARD reason (not gated by `dismissible` or the
      new blur axis — a dismiss-locked show-sheet is NOT closed by
      lock, since its one-time key is unrecoverable and lock doesn't
      invalidate it — scope the close to the allowlist); the
      vault-unlock sheet itself is exempt (locking is its precondition,
      not its invalidation — closing it on the lock broadcast would
      make the unlock prompt unopenable); the held-capture controller
      drops its record on the new reason
      (`vault-controller-capture.test.js:158-169` loop gains it, with
      a one-line comment noting `'vault-lock'` is a safety-net pin,
      not a reachable path — vault-unlock is exempt from that reason
      in production); and a sweep for reason-enum pins is part of the
      change — cycle-2 review pre-located the two hardcoded
      exhaustive-reason arrays that must gain the new reason:
      `menu-overlay-manager.test.js:486` ("focusChrome runs for
      escape/activated/input-empty only", array at `:493-502`) and
      `:526` ("the DD5 hook receives EVERY close reason", array at
      `:540-549`). Pinned by new main-site tests. Per-window fan-out
      anchor: `registry.records()` → `rec.sheet`
      (`window-factory.js:248`); `closeMenuOverlay` is idempotent, so
      an unconditional call per window is safe.

### Budgets / suite health

- [x] No pinned line budget is exceeded without a bump named in this
      leg and the flight log (`renderer.js` expected untouched; check
      `seam-contract.test.js` for budgets on any file actually
      touched).
- [x] Full unit suite, lint, and format checks green.

## Verification Steps

- `npm test` (full suite) — green; confirm the three named suites now
  import the mapper module (`grep -l vault-sheet-errors test/unit/...`).
- Run the new mapper + resurface suites in isolation.
- `grep -rn "instanceof vaultStoreModule.Vault.*Error) return" src/main/main.js`
  → zero inline ladder sites remain in the nine delegates.
- Main-site pin: run `menu-overlay-manager.test.js`; renderer-site pin:
  run the menu-controller/modal-card suites.
- `npm run format:check` / lint per project scripts.

## Implementation Guidance

1. **Mapper first.** Design the mapper as data + one function: a
   canonical class→reason table (`VaultAuthError→'auth'`,
   `VaultBusyError→'busy'`, `VaultStateError→'state'`,
   `VaultFormatError→'format'`, `VaultPasswordReuseError→'reuse'`,
   `VaultCollisionError→'collision'`), plus a per-call config naming
   (a) which reasons this delegate admits and (b) how auth renders
   (bare `{ok:false}` vs `{ok:false, reason:'auth'}` — compare
   `main.js:1835` vs `:1900`). Result: mapped shape, or `null` →
   caller rethrows. Keep it dependency-free (takes the error classes
   or uses `instanceof` against the module's re-exports —
   `vault-store.js` exports the classes).
2. **Thread the nine sites** one at a time, running the corresponding
   suite after each. Preserve every comment's substance (the
   squawk-0058 reachability notes) — move ladder-explaining comments to
   the mapper or the config, don't delete history the next reader
   needs.
3. **Extract the resurface unit** with injected `{ liveChromeIds |
   records, reveals, send }`; unit-test the orphan scan, the
   at-most-one break, the dead-chrome guard, and the
   `replacing: true` payload. `main.js` keeps only the Electron
   plumbing (webContents lookups).
4. **Delete the transcriptions**, wiring the three suites to compose
   from the real module. Their assertions should not change.
5. **Blur axis.** Add the field to `MenuOpenPayload`
   (`menu-overlay-manager.js:117-119` typedef), a `currentSurvivesBlur`
   state var beside `currentKeepFocus`, the guard in
   `closeMenuOverlay` (blur only — do NOT touch the `dismissible`
   guard), and reset sites. Renderer: plumb via
   `modal-card-controller`'s entry opts and the `menu-overlay.js`
   entry wiring to `menu-controller.js`'s two listeners (only the
   window-blur listener changes; the pointerdown outside-click guard
   stays `dismissible`-only). Chrome side: apply the shared allowlist
   constant at the single `open()` funnel in
   `overlay-menus.js:63-75` — every vault open site (including the
   `*ForAudit` duplicates) passes through it (cycle-2 verified: the
   only `bridge.menuOverlayOpen` call in the renderer is
   `overlay-menus.js:71`; no vault open originates outside
   `vault-controller.js`), so per-site flags can't drift. Apply the
   allowlist-derived flag AFTER the `...options` spread in the payload
   build (or exclude it from `options`) so no caller-supplied option
   can override the shared source of truth. The threading was traced hop-by-hop at design review
   (chrome → preload → `register-overlay-ipc.js:121-137`, which
   strips ONLY `slotBounds` → `openMenu` → `deliverInit` sends the
   whole payload → sheet retains full `payload` in closure,
   `payload.keepFocus` read at `menu-overlay.js:2883` is the model) —
   no hop drops unknown fields.
6. **Close-on-lock.** Hook the store's `onLock` callback at
   `main.js:769` (NOT `vaultLockNow()` — that wrapper is manual-only;
   autolock's idle timer calls `store.lockNow()` directly from
   `vault-store.js:624`) to close each window's open allowlisted
   credential sheet — except `vault-unlock` — with the new hard
   reason. Fan out via `registry.records()` → `rec.sheet`; the close
   is idempotent per window. Add the reason to the JSDoc enum and
   update the two named exhaustive-reason test arrays. Include an
   idle-timer-path test per the acceptance criterion.
7. **Pins + sweep + docs** per the acceptance criteria. Update the
   flight log (Leg Progress entry + sweep findings + any lock-path
   finding).

## Edge Cases

- **App-switch double-blur**: `closeMenuOverlay` is idempotent and the
  window fires BaseWindow blur AND sheet blur — the new guard must
  early-return without disturbing token/state so a later real close
  still works.
- **Model-replace into a non-vault menu**: the axis must not survive
  into the superseded menu's replacement (mirror `keepFocus` at
  `menu-overlay-manager.js:374-377`).
- **Blurred-window teardown**: a survives-blur sheet in a blurred
  window must still close on window close / teardown / tab lifecycle
  reasons.
- **`vault-capture` → `vault-unlock` chain**: the capture offer stays
  blur-dismissible; the unlock prompt raised over it survives blur.
  The held-capture drop semantics at
  `vault-controller-capture.test.js:158-169` change only for the
  `'blur'` reason (which stops arriving for vault-unlock).
- **Mapper unknown-class**: a genuinely unknown error must reject the
  invoke (propagate) at every site — no catch-all reason.
- **Close-on-lock vs the show sheets**: a dismiss-locked one-time-key
  display must NOT close on lock (the key is unrecoverable and lock
  doesn't invalidate it) — the lock-close is scoped to the credential
  allowlist, and `vault-unlock` is exempt within it (lock is its
  precondition; a duplicate/racing lock broadcast must not close the
  prompt mid-typing).
- **Lock while a recover-capable sheet is open** (`vault-recover`,
  `vault-compromise-recover` work from locked): they still close on
  lock — autolock firing means the operator walked away, and wiping
  half-typed new-master material is the conservative ruling; the flow
  reopens from the locked state.
- **Window close (`'teardown'`)**: already unconditional
  (`window-factory.js:279-280`, ahead of tab teardown) — not gated by
  `dismissible` or the new axis; verified at design review, needs
  confirmation-by-pin only if a pin doesn't already exist.

## Files Affected

- `src/main/main.js` — nine catch ladders → mapper calls; resurface
  body → delegation
- `src/main/vault/vault-sheet-errors.js` — NEW
- `src/main/vault/pending-compromise-reveals.js` (or sibling) —
  resurface unit
- `src/main/menu-overlay-manager.js` — axis state + guard
- `src/renderer/menu-controller.js` — window-blur guard
- `src/shared/modal-card-controller.js` — entry opt plumb
- `src/renderer/menu-overlay.js` — entry wiring
- `src/renderer/chrome/overlay-menus.js` — the single open funnel:
  allowlist applied here
- `src/renderer/chrome/vault-controller.js` — only if any open site
  needs an explicit opt (expected untouched if the funnel carries it)
- `src/shared/` — NEW allowlist constant module (or added to an
  existing shared vault constants module if one fits)
- `test/unit/` — new mapper + resurface suites; transcription deletions
  in the three named suites; blur pins in
  `menu-overlay-manager.test.js`, menu-controller/modal-card coverage,
  `vault-controller-capture.test.js` annotation
- `docs/` — sheet blur behavior + trade-off

---

## Citation Audit

All `file:line` citations verified against the working tree on
2026-09-02 (branch `flight/03-multi-vault-portability` at 61a5318):
nine ladder sites read directly; `resurfaceCompromiseReveal` at
`main.js:934`; blur guards at `window-factory.js:333`,
`menu-overlay-manager.js:401-411`, `menu-controller.js:115-133`;
`entry.dismissible` at `modal-card-controller.js:159`; `keepFocus`
state at `menu-overlay-manager.js:376`; capture pin at
`vault-controller-capture.test.js:163`; renderer budget at
`seam-contract.test.js:168` (`renderer.js` currently 1835 lines).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT commit — the flight-end review/commit covers all legs
