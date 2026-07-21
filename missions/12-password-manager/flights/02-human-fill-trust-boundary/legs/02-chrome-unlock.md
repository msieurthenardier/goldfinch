# Leg: chrome-unlock

**Status**: completed
**Flight**: [Human Fill Trust Boundary](../flight.md)

## Objective

Render a chrome-owned master-password **unlock** prompt on the menu-overlay sheet, carry the
entered password to main as a zeroizable `Buffer` over a dedicated request/response channel (never
the 24-char-capped activated path), unlock the vault store's Manager Root Key, and broadcast the
resulting lock state to every chrome renderer with a new toolbar lock indicator.

## Context

- **Flight DD4** — chrome-owned prompts render on the menu-overlay sheet; the master password
  travels as a `Uint8Array` over a **dedicated** channel (NOT channel-4 `menu-overlay:activated`,
  which `sanitizeActivatedValue` caps at 24 chars / string-only, `menu-overlay-value.js:17,27`).
  The sheet is `contextIsolation:true` (`window-factory.js:91`) — the secret crosses a new
  `menuOverlay` contextBridge method → sheet preload → a new ipcMain channel. Main receives a
  `Buffer`, passes it to `deriveMasterKey` (which **already** accepts `string | Buffer`,
  `vault-crypto.js:276-289` — no crypto widening), and `.fill(0)`s it after `unlock()` resolves.
- **Flight DD10** — lock-state has one source of truth (`vault-store` MRK-present) pushed to all
  chrome renderers on every transition. `onUnlock` fires from **inside `_installMrk`**
  (`vault-store.js:494-499`) — the single choke point for all three unlock paths (`unlock` `:454`,
  `unlockWithRecovery` `:470`, `unlockWithAdmin` `:488`). `onLock` already fires from `lockNow`
  (`:312-318`) + the idle timer but is **currently unwired** in main (`main.js:568-571` injects only
  `listJars` + `getAutoLockMinutes`). Broadcast via `broadcastToChromeAndInternal` (`main.js:294`).
- **MRK model (from F1)** — the master password unlocks the **manager** (unwraps the MRK), which can
  reach every vault; the human unlock is therefore **manager-wide**, not per-vault. Per-jar
  compartmentalization for the human is enforced at the **picker** (`pick-and-fill`, DD5), not here.
  So this leg's unlock is wcId-agnostic.
- **Precedent** — the `new-container` → `input-dialog` template (`menu-overlay.js:328-441`,
  `submitDialog` `:394`) driven by the shared APG `menu-controller` (`menu-controller.js`): a
  chrome-owned modal collecting text. The `vault-unlock` template is a near-clone with a
  `type=password` input, an error line, and the secret going out the dedicated channel instead of
  channel-4.
- **Refinement of DD4 (reviewed):** DD4 sketched the secret channel as `ipcRenderer.send`
  (fire-and-forget); this leg uses **`ipcRenderer.invoke`** (request/response) because the
  wrong-password re-prompt needs the `{ ok }` result back to keep the sheet open and show an
  error. Verified safe: `ipcMain.handle` coexists with the existing `ipcMain.on` overlay handlers,
  and `closeMenuOverlay` only hides the sheet view (never destroys the webContents), so the reply
  reaches the sheet even when main closes it on success. DD4 amended to match.

## Inputs

- `src/renderer/menu-overlay.js` — the template registry `TEMPLATES` (`:524`), the `input-dialog`
  builder (`:328-441`), the APG registration idiom (`menuController.register`, no `items` getter →
  local keyboard/focus-trap; `onOpen`/`onClose`), the exactly-one-report token/`sent` discipline
  (`:53-78`).
- `src/preload/menu-overlay-preload.js` — the sheet contextBridge `window.menuOverlay` (`:18-24`):
  `onInit`, `sendActivated`, `sendDismissed`. Add the secret method here.
- `src/main/register-overlay-ipc.js` — the overlay ipcMain handlers (`:31-68`); sender-identity
  validation `recordForSheetSender` (`:18-28`); token check against `current.token`. Add the
  secret handler here.
- `src/main/menu-overlay-manager.js` — `openMenu`/`closeMenuOverlay` lifecycle (open-while-open is a
  model-replace); the sheet is opened by chrome via channel-1 `menu-overlay:open`.
- `src/main/vault/vault-store.js` — `unlock(masterPassword)` (`:451/454`, forwards to
  `deriveMasterKey`), `_installMrk` (`:494-499`, the choke point — add `onUnlock` here),
  `lockNow`/idle `onLock` (`:312-318`), `isUnlocked()` (`:355`), `isSetUp()` (`:350`); deps typedef
  `VaultStoreDeps` (`:91-102`).
- `src/main/main.js` — the vault-store deps injection (`:568-571`, add `onLock`/`onUnlock`);
  `broadcastToChromeAndInternal` (`:294`); the "only stateless methods / never mutates human lock
  state" comment (`:560-564`, now becomes false — update it); the vault-fill/`scopeCtx` wiring;
  the getter surface a chrome initial-state query can call.
- `src/preload/chrome-preload.js` — `window.goldfinch` bridge; subscriber pattern (`onTabMediaList`
  `:274`) and invoke pattern (`newContainerCreate` → `ipcMain.handle`, `register-browser-ipc.js:69`).
- `src/renderer/index.html` — the toolbar (`:47-111`); `#automation-indicator` (`:99`) is the slot
  precedent for a new `#vault-indicator` `icon-btn`.
- `src/renderer/renderer.js` — the `window.goldfinch.on*` subscriber wiring; the Leg-1
  `onVaultGesture` stub (still a `void wcId` no-op — untouched by this leg).

## Outputs

- `src/renderer/menu-overlay.js` — a `vault-unlock` menuType in `TEMPLATES` + a new template builder
  (password input, error line, Unlock/Cancel), APG-registered like `input-dialog`, whose submit
  sends the secret out the **dedicated** bridge method (not `sendActivated`) and shows an inline
  error on `{ ok:false }` (stays open), closing on `{ ok:true }`.
- `src/renderer/menu-overlay.css` — styles for the `vault-unlock` card + error line.
- `src/preload/menu-overlay-preload.js` — a new bridge method
  `unlockVault({ token, secret })` → `ipcRenderer.invoke('menu-overlay:vault-unlock', …)` returning
  `Promise<{ ok: boolean }>` (`secret` is a `Uint8Array`).
- `src/main/register-overlay-ipc.js` — `ipcMain.handle('menu-overlay:vault-unlock', …)`: validate
  the sender is the current sheet (`recordForSheetSender`) and `token === current.token`, convert
  `secret` → `Buffer`, call the injected `vaultUnlock(buffer)`, return `{ ok }`; on `ok` close the
  sheet (reason `'activated'`). Zeroize the buffer in a `finally`.
- `src/main/main.js` — inject `vaultUnlock(buffer)` (calls `vaultStore.unlock(buffer)`, `.fill(0)`
  in `finally`, returns ok/!ok on `VaultAuthError`), and inject `onLock`/`onUnlock` into the
  vault-store deps (both → `broadcastToChromeAndInternal('vault-lock-state', computeState())`);
  a `getVaultLockState()` invoke returning `{ setUp, unlocked }` for the chrome initial query;
  update the `:560-564` comment.
- `src/main/vault/vault-store.js` — an `onUnlock` dep fired from `_installMrk` (covers
  master/recovery/admin); `onLock` already fired — just needs main to inject it.
- `src/preload/chrome-preload.js` — `onVaultLockState(cb)` subscriber + `getVaultLockState()` invoke.
- `src/renderer/renderer-globals.d.ts` — types for the new bridge methods.
- `src/renderer/index.html` + `renderer.js` + `styles.css` — a `#vault-indicator` toolbar
  `icon-btn` reflecting locked / unlocked / hidden-when-not-set-up, queried at chrome init and
  updated on every `vault-lock-state` broadcast.
- Tests: an integration suite driving the secret handler with a fake event + fake vault store; unit
  tests for the `onUnlock`-from-`_installMrk` firing (all three paths), the lock-state model, and
  the `vault-unlock` template DOM/aria.

## Acceptance Criteria

- [x] A `vault-unlock` template renders on the sheet: `role="dialog" aria-modal="true"`, a
      `type="password"` input, an error line (`aria-live`), Unlock + Cancel, APG-registered
      (Tab-trap + Escape-dismiss) like the `input-dialog` precedent. Unit-tested for structure/aria.
- [x] The entered password leaves the sheet **only** via the dedicated
      `menu-overlay:vault-unlock` invoke as a `Uint8Array` — **never** via `sendActivated`
      (channel-4). Grep-confirm the password never touches `menu-overlay:activated`.
- [x] Main converts the `Uint8Array` to a `Buffer`, calls `getVaultStore().unlock(buffer)`, and in
      a `finally` (whether unlock succeeds or throws) `.fill(0)`s **both** the copied `Buffer`
      **and** the incoming `Uint8Array` (`Buffer.from(typedArray)` copies — the deserialized array
      is a separate lingering main-heap allocation). Unit/integration asserts `unlock` received a
      `Buffer` and both are zeroed afterward.
- [x] A correct password → `{ ok:true }`, the sheet closes, and `vault-lock-state` broadcasts
      `unlocked` to all chrome renderers. A wrong password → `VaultAuthError`
      (`vaultStoreModule.VaultAuthError`) caught → `{ ok:false }`, the sheet **stays open** and
      shows the error, and **no** broadcast fires and the store stays locked.
- [x] `onUnlock` fires from **`_installMrk`** (wrapped in try/catch so a failing broadcast never
      rejects `unlock()`), so an unlock via `unlock`, `unlockWithRecovery`, or `unlockWithAdmin`
      all broadcast `unlocked` (unit-tested against all three paths).
- [x] `onLock` is wired so the **idle auto-lock** timer broadcasts `locked` (the only live lock
      transition in F2). *Explicit "Lock now" (a vault-page control) and `before-quit`→`lockNow`
      wiring are F3 — nothing calls `lockNow()` from main today; do not claim app-quit relock in
      this leg.*
- [x] The `#vault-indicator` toolbar control reflects lock state — `unlocked` / `locked`, and
      `hidden` when the manager is not set up — from an init-time `getVaultLockState()` query plus
      every `vault-lock-state` broadcast. Never reads a cache; it is a pure projection of pushed
      state (DD10 freshness contract).
- [x] The sender-identity + token discipline of the existing overlay handlers is preserved on the
      new secret handler (a stale-token or wrong-sender invoke is rejected).
- [x] The `main.js:560-564` "never mutates human lock state" comment is corrected.
- [x] Existing tests pass unmodified; `npm run test`, `npm run typecheck`, lint all clean.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/<new vault-unlock + lock-state suites>` — green.
- Integration: simulate an inbound `menu-overlay:vault-unlock` invoke with (a) a correct and (b) a
  wrong password against a fake vault store; assert the `Buffer` hand-off + zeroization, the
  `{ ok }` result, the broadcast on success only, and the sheet-close-on-success.
- Unit: `onUnlock` fires from `_installMrk` for all three unlock methods; the lock-state model maps
  `{ setUp, unlocked }` → indicator state; the template builder emits the expected DOM/aria.
- `npm run test` full suite — no regressions. `npm run typecheck` + lint — clean.
- Grep: the password/secret never appears on `menu-overlay:activated`; only `menu-overlay:vault-unlock`.
- (a11y for the new template is deferred to flight-end, once `pick-and-fill` wires the live trigger
  that opens the sheet — consistent with the flight's checkpoint c.)

## Implementation Guidance

1. **`vault-unlock` template (`menu-overlay.js`) — this is a NEW template *kind*, not just a
   `TEMPLATES` entry.** `TEMPLATES` (`:524`) maps a menuType to one of four kinds
   (`menu`/`info-popup`/`input-dialog`/`suggestions`); a password dialog with an error line and a
   secret-channel submit is a **fifth kind**. Add: (a) a new builder cloning the `input-dialog`
   builder (`:328-441`) — a `#sheet-dialog`-style backdrop + card, `role="dialog" aria-modal="true"`,
   a `type="password"` input (`autocomplete="off"`), an `aria-live="polite"` error line, Unlock +
   Cancel; (b) an entry in `NODE_OF_ENTRY` (`:537-542`); (c) a render/init dispatch branch; (d) a
   `menuController.register` with **no `items`** getter (local Tab-trap + Escape). **Do not** let
   the new menuType fall through to the non-focusing `'menu'` fallback (`:530-534`). `onOpen` clears
   input + error and focuses the input; `onClose` reports dismissed.

2. **Submit → dedicated secret channel (`menu-overlay.js` + `menu-overlay-preload.js`)** — on
   submit, encode the input value to a `Uint8Array` (`new TextEncoder().encode(value)`), call the
   new `window.menuOverlay.unlockVault({ token: currentToken, secret })`, and **await** the result:
   `{ ok:true }` → set `sent = true` (so no trailing spurious `dismissed`) then
   `menuController.close(entry)`; `{ ok:false }` → show the error line, keep focus, clear the input
   (do NOT set `sent` — a later Cancel/Escape still reports `dismissed`). Do **not** route the
   secret through `sendActivated`. This is the **first `invoke` from the sheet preload** (today it
   only does `on`/`send`) — a deliberate, reviewed upgrade over DD4's literal `send` (the
   wrong-password re-prompt needs the `{ ok }` result).
   - `menu-overlay-preload.js`: add
     `unlockVault: (p) => ipcRenderer.invoke('menu-overlay:vault-unlock', p)` to the contextBridge.

3. **Secret handler (`register-overlay-ipc.js`)** — `ipcMain.handle('menu-overlay:vault-unlock',
   async (event, { token, secret }) => { … })`: reject unless the sender is the current sheet
   (`recordForSheetSender`/live-view check) and `token === current.token` (read
   `rec.sheet.getCurrentMenu().token`); `const buf = Buffer.from(secret)`;
   `try { const ok = await deps.vaultUnlock(buf); if (ok) closeMenuOverlay('activated',
   current.token); return { ok }; } finally { buf.fill(0); secret.fill?.(0); }` — zeroize **both**
   the copy and the incoming array. (`deps.vaultUnlock` injected from `main.js`.)

4. **Main wiring (`main.js`)** —
   - Inject `vaultUnlock: async (buf) => { try { await getVaultStore().unlock(buf); return true; }
     catch (e) { if (e instanceof vaultStoreModule.VaultAuthError) return false; throw e; } }` into
     `registerOverlayIpc`'s deps — use the memoized `getVaultStore()` singleton (`:566-573`), not a
     captured `vaultStore` (it may be unconstructed when MCP isn't running), and the re-exported
     `vaultStoreModule.VaultAuthError` (`vault-store.js:839`). (Buffer zeroization is step 3.)
   - Inject `onLock` + `onUnlock` into the vault-store deps (`:568-571`): both compute
     `{ setUp: getVaultStore().isSetUp(), unlocked: getVaultStore().isUnlocked() }` and
     `broadcastToChromeAndInternal('vault-lock-state', state)` (arity-2, `:294`). Add a
     `getVaultLockState` invoke returning the same. Update the `:560-564` comment.

5. **`onUnlock` hook (`vault-store.js`) — guarded.** Add `this.onUnlock = deps.onUnlock ?? null` in
   the constructor (`:139`, next to `onLock`), add it to the `VaultStoreDeps` typedef (`:91-102`),
   and call it **wrapped** at the end of `_installMrk` (`:494-499`), after `_touch()`:
   `try { this.onUnlock?.(); } catch { /* a failing notify must never reject unlock() */ }` —
   symmetric with the guarded `onLock` in `lockNow` (`:312-318`). Covers master/recovery/admin
   unlock; `changeMasterPassword` (`:508`) is not a transition.

6. **Indicator (`index.html`/`renderer.js`/`styles.css`)** — add a `#vault-indicator` `icon-btn`
   near `#automation-indicator` (`index.html:99`). In `renderer.js`, **subscribe first**
   (`window.goldfinch.onVaultLockState(state => …)`) **then** call
   `window.goldfinch.getVaultLockState()` for the initial state, and let a push that already
   arrived win over the initial fetch (avoid a late stale fetch overwriting a fresher push). States:
   hidden (`!setUp`), locked, unlocked. Keep it a pure projection — no caching beyond the last
   pushed state. (Optional: model the 3 states with a pure `buildVaultIndicatorModel` in
   `src/shared/`, mirroring `automation-indicator-model.js`, for unit-testability.)

## Edge Cases

- **Wrong password**: `{ ok:false }`, sheet stays, error shown, store stays locked, no broadcast.
- **Not set up**: `getVaultLockState` → `{ setUp:false }` → indicator hidden; (raising the prompt
  when not set up is prevented by the trigger in `pick-and-fill`; if the handler is somehow called,
  `vaultStore.unlock` on an un-set-up store throws — return `{ ok:false }`, do not crash).
- **Already unlocked**: unlocking again is idempotent (re-installs MRK); the `onUnlock` broadcast is
  harmless (indicator already unlocked). Fine.
- **Stale token / wrong sender** on the secret handler: reject, no unlock.
- **Buffer zeroization on throw**: the `finally` guarantees `.fill(0)` of **both** the copied
  `Buffer` and the incoming `Uint8Array` even if `unlock` throws a non-auth error.
- **Broadcast throws**: `onUnlock`/`onLock` are wrapped in try/catch — a failing
  `broadcastToChromeAndInternal` must never reject `unlock()` (store is already unlocked) or
  `lockNow()`.
- **Sheet closed mid-invoke** (blur/escape races the await): the invoke still resolves in main;
  `closeMenuOverlay` is idempotent/stale-token-safe (`menu-overlay-manager.js:293`).
- **Repeated wrong attempts / lockout**: out of scope for F2 (note as a possible F3 hardening); the
  prompt simply re-errors.

## Files Affected

- `src/renderer/menu-overlay.js` — `vault-unlock` template + `TEMPLATES` entry + submit→secret.
- `src/renderer/menu-overlay.css` — template styles.
- `src/preload/menu-overlay-preload.js` — `unlockVault` invoke bridge.
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-unlock` handler (validate, Buffer,
  zeroize, close-on-ok).
- `src/main/main.js` — `vaultUnlock` dep, `onLock`/`onUnlock` injection, `getVaultLockState`,
  comment fix.
- `src/main/vault/vault-store.js` — `onUnlock` hook from `_installMrk`.
- `src/preload/chrome-preload.js` — `onVaultLockState` + `getVaultLockState`.
- `src/renderer/renderer-globals.d.ts` — types.
- `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css` —
  `#vault-indicator`.
- `test/unit/…` — secret-handler integration, `onUnlock`/lock-state unit, template unit.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (Flight Director commits at flight end)
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits after the flight-end review)
