# Leg: internal-bridge-secured

**Status**: completed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Introduce the **origin-checked internal IPC bridge** — a shared main-side verified-sender wrapper (exact
`goldfinch://settings` origin + internal-session check, reject otherwise), the first real channels
(`internal-settings-get`/`internal-settings-set` over the leg-1 store), and the `internal-preload.js`
exposure guarded by `location.origin` — closing the Flight-4/5 "web content in the internal session could
call privileged IPC" Known Issue **before** any real settings data flows.

## Context
- **DD2 (HARD PREREQUISITE).** The bridge is graduating from inert `{version:1}` to real IPC — exactly the
  moment the origin-check must exist. The **authoritative boundary is main-side sender verification**; a
  preload-only guard is bypassable because `webPreferences` are immutable after webview attach (so the
  internal preload persists across a navigation into web content).
- **Codebase facts (verified):**
  - The internal session carries `__goldfinchInternal = true` (`main.js` `session-created` hook ~628 +
    `whenReady` ~654) — a reliable sender-side discriminator.
  - `will-attach-webview` (`main.js:128`) sets `contextIsolation:true` + `sandbox:true` for the
    `INTERNAL_PARTITION` branch — `internal-preload.js` runs sandboxed-with-contextBridge (it can
    `require('electron')` for `contextBridge`/`ipcRenderer` and read `location`).
  - The chrome's `shields-*` channels live on `chrome-preload.js`'s `window.goldfinch` surface (a different
    trust domain — `file://`); **leave them untouched.**
  - `INTERNAL_PARTITION = 'goldfinch-internal'` (`src/shared/internal-page.js`); the page's origin is
    `goldfinch://settings` (a `{standard, secure}` scheme → origin = `scheme://host`).
- **Testability:** the security decision is a **pure predicate** over two scalars (origin string + an
  is-internal-session boolean), so it's unit-testable offline without Electron; the Electron wrapper just
  extracts those two values from the IPC `event` and calls it.

## Inputs
- `src/main/settings-store.js` (leg 1) — `get`/`getAll`/`set` (set throws on invalid/unknown).
- `src/preload/internal-preload.js` (inert `{version:1}`), `src/preload/chrome-preload.js` (the surface
  shape to mirror — `ipcRenderer.invoke`/`on`).
- `src/main/main.js` — `ipcMain`, the `__goldfinchInternal` session marker, `whenReady`.
- `src/shared/internal-page.js` (`INTERNAL_PARTITION`).

## Outputs
- `src/main/internal-ipc.js` (new) — the pure `isTrustedInternalSender` predicate + the
  `registerInternalHandler(ipcMain, channel, handler)` guarded-registration wrapper.
- `test/unit/internal-ipc.test.js` (new) — predicate unit tests.
- `src/main/main.js` — register `internal-settings-get`/`internal-settings-set` via the wrapper (backed by
  the store).
- `src/preload/internal-preload.js` — origin-guarded `window.goldfinchInternal` bridge (settingsGet/Set +
  onSettingsChanged/onShieldsChanged listeners).

## Acceptance Criteria
- [ ] `src/main/internal-ipc.js` exports a **pure** `isTrustedInternalSender(origin, isInternalSession)` →
  `boolean` that returns true **only** when `origin === 'goldfinch://settings'` **AND**
  `isInternalSession === true` (a constant `INTERNAL_ORIGIN`; `null`/`undefined` origin → false). It does NOT
  `require('electron')` at module top (so the predicate is unit-testable); `ipcMain` is **passed into** the
  wrapper, not imported.
- [ ] `registerInternalHandler(ipcMain, channel, handler)` registers `ipcMain.handle(channel, …)` that
  extracts `origin = event.senderFrame ? event.senderFrame.origin : null` and `isInternal =
  !!(event.sender && event.sender.session && event.sender.session.__goldfinchInternal)`, and **throws**
  (rejecting the `invoke`) when `!isTrustedInternalSender(origin, isInternal)` — otherwise calls
  `handler(event, …args)`. (Null `senderFrame` → reject.)
- [ ] `main.js` registers, via the wrapper, **`internal-settings-get`** (`(_e, key) => key ? settings.get(key)
  : settings.getAll()`) and **`internal-settings-set`** (`(_e, key, value) => settings.set(key, value)` —
  `set`'s throw propagates to the renderer as a rejected `invoke`). These are **separate** from the chrome's
  `shields-*` channels, which are unchanged.
- [ ] `src/preload/internal-preload.js` exposes `window.goldfinchInternal` **only when `location.origin ===
  'goldfinch://settings'`** (defense-in-depth) with: `version`, `settingsGet(key)`, `settingsSet(key, value)`
  (both → `ipcRenderer.invoke('internal-settings-…')`), and `onSettingsChanged(cb)` / `onShieldsChanged(cb)`
  listeners (`ipcRenderer.on('settings-changed' / 'shields-changed', …)` — the broadcast **senders** land in
  legs 3/4; the listeners are exposed now). **When the origin doesn't match, expose NOTHING** (not even
  `version` — the bridge should not exist for non-internal origins).
- [ ] **Unit tests** `test/unit/internal-ipc.test.js` (electron-free):
  - `isTrustedInternalSender` matrix — allow only on **exact** origin `'goldfinch://settings'` **AND** session
    `=== true`; deny on wrong origin (`https://evil.test`, `goldfinch://other`, `goldfinch://settings/`
    trailing-slash), deny on `null`/`undefined` origin, deny when the session flag is `false`/missing, and
    deny on a **truthy-but-not-`true`** session value (e.g. `1`) — pins the strict `=== true`.
  - **MANDATORY (security-critical): `registerInternalHandler` with a fake `ipcMain` + fake `event`** — a
    trusted event (`senderFrame.origin==='goldfinch://settings'`, `sender.session.__goldfinchInternal===true`)
    forwards to the handler; a non-internal event (wrong origin, or null `senderFrame`, or missing session
    flag) is **rejected** (throws). This catches extraction bugs the predicate test can't — e.g. reading
    `.url` instead of `.origin`, or `event.sender.__goldfinchInternal` instead of
    `event.sender.session.__goldfinchInternal`.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (196 + new internal-ipc tests).
- [ ] **Live round-trip + rejection are deferred to leg 6** (need the running app): `settingsGet('homePage')`
  from the guest returns the stored value; a non-internal sender is rejected. Leg 2 proves the predicate
  offline + the wiring by code-correctness.

## Verification Steps
- `npm test` — predicate unit tests pass.
- `npm run lint && npm run typecheck` — green.
- Code read: the wrapper extracts `senderFrame.origin` (not `.url`) + the session flag; the predicate is an
  exact-origin AND-session check; the preload guards on `location.origin`; the chrome's `shields-*` are
  untouched.
- **Deferred to leg 6 (live):** guest `settingsGet`/`settingsSet` round-trip; non-internal sender rejected
  (per DD5 — the in-session vector caveat).

## Implementation Guidance
1. **`src/main/internal-ipc.js`** (no `require('electron')` at top). **Add a comment at `INTERNAL_ORIGIN`**:
   *Chromium/Blink serializes a `{standard, secure}` scheme's frame origin to `'goldfinch://settings'` (tuple
   origin), which is what `event.senderFrame.origin` returns in-process — the correct value to match. Beware:
   Node's WHATWG `new URL('goldfinch://settings').origin` returns the string `'null'` (Node doesn't know the
   scheme is standard), so a `node -e` sanity check will mislead — do NOT "fix" the constant to match Node.*
   Also comment the wrapper's extraction tracing the session path (`event.sender` = the webview's WebContents
   → `.session` = `fromPartition(INTERNAL_PARTITION)` which carries `__goldfinchInternal`, set in
   `session-created`/`whenReady`).
   ```
   const INTERNAL_ORIGIN = 'goldfinch://settings';
   function isTrustedInternalSender(origin, isInternalSession) {
     return origin === INTERNAL_ORIGIN && isInternalSession === true;
   }
   function registerInternalHandler(ipcMain, channel, handler) {
     ipcMain.handle(channel, (event, ...args) => {
       const origin = event.senderFrame ? event.senderFrame.origin : null;
       const isInternal = !!(event.sender && event.sender.session && event.sender.session.__goldfinchInternal);
       if (!isTrustedInternalSender(origin, isInternal)) {
         throw new Error('forbidden: non-internal sender for ' + channel);
       }
       return handler(event, ...args);
     });
   }
   module.exports = { INTERNAL_ORIGIN, isTrustedInternalSender, registerInternalHandler };
   ```
2. **main.js** (near the existing `shields-*` handlers): `const { registerInternalHandler } =
   require('./internal-ipc');` then register `internal-settings-get` / `internal-settings-set` backed by the
   `settings` store (already required + loaded in `whenReady` from leg 1 — hoist the `require` to module
   scope or reuse the one in `whenReady`).
3. **internal-preload.js**: guard the whole exposure on `location.origin === 'goldfinch://settings'` (comment
   that `location` IS available in a `sandbox:true`+`contextIsolation:true` preload and reads the
   being-loaded URL at inject time); expose `version`/`settingsGet`/`settingsSet`/`onSettingsChanged`/
   `onShieldsChanged` **only inside that guard** (mismatch → expose nothing). Mirror `chrome-preload.js`'s
   `ipcRenderer.invoke`/`on` style. Also add a one-line comment at the chrome's `shields-*` handlers in
   `main.js` noting they are **intentionally NOT** behind the internal-sender guard (their trust domain is the
   `file://` chrome) — so a future contributor doesn't "close" the wrong channel.
4. **Tests**: `test/unit/internal-ipc.test.js` — pure predicate matrix; optional fake-`ipcMain` wrapper test.

## Edge Cases
- **`senderFrame` null** (frame destroyed mid-IPC) → `origin` null → predicate false → reject. Covered.
- **Origin serialization**: rely on the **exact** `event.senderFrame.origin` string (Chromium-serialized),
  never a `startsWith`/substring on `.url` — `.url` can be empty or carry a path.
- **Preload `location` timing**: the preload reads `location.origin` at document creation — it reflects the
  URL being loaded (`goldfinch://settings` for the real page; the web origin for any latent web-content load
  → bridge not exposed). The main-side check is authoritative regardless.
- **Do NOT touch the chrome `shields-*` channels** or `chrome-preload.js` — different trust domain.
- **No broadcast senders yet** — `onSettingsChanged`/`onShieldsChanged` listeners are inert until legs 3/4
  wire the `settings-changed`/`shields-changed` sends to the guest.

## Files Affected
- `src/main/internal-ipc.js` (new) — predicate + guarded-registration wrapper.
- `test/unit/internal-ipc.test.js` (new) — predicate unit tests.
- `src/main/main.js` — register the two `internal-settings-*` channels via the wrapper.
- `src/preload/internal-preload.js` — origin-guarded `window.goldfinchInternal` bridge + listeners.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live round-trip/rejection deferred to leg 6)
- [ ] Tests passing (unit + offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
