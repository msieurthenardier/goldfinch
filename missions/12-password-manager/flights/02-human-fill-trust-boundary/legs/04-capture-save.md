# Leg: capture-save

**Status**: completed
**Flight**: [Human Fill Trust Boundary](../flight.md)

## Objective

When the user submits a login form, capture the credential they just typed, and — only when the
manager is set up and unlocked and the tab is a persistent jar — raise a chrome-owned save/update
prompt (update when an exact origin+username already exists, save otherwise; default the active
jar's vault, global selectable), persisting via the existing `saveItem` primitive on accept. The
captured password lives in a short-lived **main-side** record and is dropped on accept/dismiss —
it never travels to chrome or the sheet.

## Context

- **Flight DD7** — capture reuses `saveItem` (`vault-store.js`, lazy-creates the vault, upserts by
  id, validates type); the submit observer lives in the guest preload; the captured secret is the
  user's **own freshly-typed** credential (already in web content by their action — within the
  trust model), held in main only until the prompt resolves. Update when an exact origin+username
  exists; save otherwise; default active jar, global selectable; only when set up.
- **Flight DD9** — burner/non-persistent tabs get **no** capture (structural + main-side gate).
- **v1 scope decision (Flight Director — flagged for the flight debrief go/no-go):** capture fires
  only when the manager is set up **AND unlocked**. This is a deliberate product choice, not only an
  implementation shortcut: the manager is a *dedicated, explicit-gesture* manager (not always-on
  autofill), so offering to save only while it is actively unlocked matches its ethos; and both
  `saveItem` and the update-vs-save existence check require the MRK, so a locked-time flow would mean
  prompt→unlock→save on every login submit (intrusive). **This narrows the mission's "only when set
  up" criterion to "set up and unlocked"** — documented here, surfaced in the flight log, and
  carried to the debrief for the operator to ratify or override (the mission's designated go/no-go);
  locked-time capture (prompt→unlock→save) is the F3/F4 enhancement path.
- **The password never reaches chrome/sheet** — mirrors Leg 3. Main holds `{ origin, username,
  password }` keyed by a `captureId`; the `vault-capture` model sent to chrome carries only
  `{ origin, username, mode, defaultVaultId, choices }` (no password). On accept, the sheet sends
  back only the chosen `vaultId` (+ `captureId`); main looks up the held record and saves.
- **Leg 3 seams (present in the tree)** — `reachableLoginItems(jarId, origin)` →
  `{ vaultId, id, title, origin, username, hasTotp }[]` is the **update-vs-save existence source**
  (match on `username`); `createVaultHuman(deps)` owns the tab→jar/origin resolution + burner
  gating (reuse/mirror its injected-deps shape); `vault-picker`/`vault-unlock` established the
  dedicated-template-kind + guest-triggered-open pattern; F1's `saveItem` is the persistence primitive.

## Inputs

- `src/preload/webview-preload.js` — the Leg-1 top-frame gate + `vault-eligible` flag + the
  detection helpers (`findAllLoginFields`); the F1 `vault-fill` listener sibling. Add the submit
  observer here (top-frame + eligible only).
- `src/preload/vault-fill-fields.js` — `findAllLoginFields(doc)` / `findLoginFields(doc)` to read
  the submitted form's username+password values.
- `src/main/vault/vault-store.js` — `saveItem(target, item)` (lazy-creates, upserts by `item.id`,
  validates `type ∈ login|card|note`, mints an id + stamps timestamps on new items); `isSetUp()`,
  `isUnlocked()`; `reachableLoginItems(jarId, origin)` (Leg 3, the existence source).
- `src/main/vault/vault-human.js` — `createVaultHuman(deps)` (Leg 3): tab→origin/jar resolution +
  burner gating; extend it (or mirror its deps) for the capture ops.
- `src/main/main.js` — `getVaultStore()` / `getVaultHuman()`; the trusted `getWindowForGuest →
  tabViews.get` + `resolvePersistJar` idiom; `chromeForTab` (the guest→chrome forward, like
  `vault-gesture`); where the Leg-3 invokes were handled.
- `src/main/register-browser-ipc.js` — the guest→main `ipcMain.on` site (where `guest-vault-gesture`
  lives) for the new `guest-vault-capture` channel; and `chromeForTab` forwarding.
- `src/renderer/renderer.js` — the chrome subscriber wiring (`onVaultGesture` precedent), the
  `overlayMenus` state + `dispatchOverlayActivation`; `openOverlayMenu(menuType, model, anchor,
  startIndex, opts)` positional.
- `src/renderer/menu-overlay.js` + `src/shared/` — the dedicated-template-kind pattern
  (`vault-picker`/`vault-unlock`): a pure `src/shared/` builder + `TEMPLATES`/`NODE_OF_ENTRY`/init
  dispatch + `menuController.register` + `overlayMenus` entry + the `<script>` in `menu-overlay.html`.
- `src/main/register-overlay-ipc.js` — the sheet→main invoke site (the `menu-overlay:vault-unlock`
  precedent) for the `vault-capture-save` invoke; `recordForSheetSender`/token validation.

## Outputs

- `src/preload/webview-preload.js` — a `submit` listener on detected login forms (top-frame +
  `vault-eligible` only) that reads the current `{ username, password }` and sends
  `guest-vault-capture` to main (password as a `Uint8Array`; origin is derived in main from the
  sender URL, not trusted from the guest).
- `src/main/vault/vault-human.js` — **the capture ops live here** (Electron-free, injected deps —
  it already has `getVaultStore`/`fromId`/`getTabEntry`/`listJars`; add an injected
  `setTimeout/clearTimeout/now` so the timeout is unit-testable, mirroring `vault-store.js:142-144`).
  A `captures` `Map<captureId, record>`:
  - `capture({ wcId, username, passwordBytes })`: resolve origin + persistent jar; **gate:
    `isSetUp() && isUnlocked() && jar` else drop** (no offer); **evict+zeroize any existing record
    for the same `wcId` first** (true last-wins-per-tab); normalize `username` (`'' → null`);
    compute disposition via `reachableLoginItems(jar.id, origin)` — **prefer the active-jar match
    over global on a username tie** (else `update` targets the global copy since global is iterated
    first); `update` → `{ vaultId, itemId }` fixed; else `save` with `defaultVaultId = jar.id`,
    choices `[jar.id, 'global']`; store `{ captureId, wcId, origin, username, password: Buffer, mode,
    vaultId?, itemId?, choices }`; arm the ~2-min drop timer; return `{ captureId, model }` (model =
    `{ origin, username, mode, defaultVaultId, choices }`, **no password**) for main to forward.
  - `captureSave({ captureId, vaultId })`: look up the record (`{ saved:false }` if gone);
    re-check `isUnlocked()` (`{ saved:false, reason:'locked' }` — may have idle-locked); for `save`
    require `vaultId ∈ record.choices`, for `update` use the record's fixed `{ vaultId, itemId }`;
    `saveItem(target, { id?: itemId, type:'login', title: <hostname of origin>, origin, username,
    password: record.password.toString('utf8') })`; zeroize + drop + clear the timer; return
    `{ saved:true }`.
  - `captureDismiss(captureId)`: zeroize + drop + clear the timer (no save).
- `src/main/main.js` / `src/main/register-browser-ipc.js` — wire the IPC (mirror the `vaultUnlock`
  injection at `main.js:1067-1076`): `ipcMain.on('guest-vault-capture', …)` → `getVaultHuman()
  .capture({ wcId: event.sender.id, … })`, and on a returned `{ captureId, model }` forward
  `chromeForTab(wcId)?.send('vault-capture-offer', { captureId, model })`; a `vaultCaptureDismiss`
  chrome-invoked handler → `getVaultHuman().captureDismiss(captureId)`; inject `vaultCaptureSave` into
  `registerOverlayIpc` (like `vaultUnlock`).
- `src/preload/chrome-preload.js` + `renderer-globals.d.ts` — `onVaultCaptureOffer(cb)` subscriber
  **and** a `vaultCaptureDismiss(captureId)` invoke, both chrome-side (`window.goldfinch`). (The
  *save* is sheet-originated — it rides the `menu-overlay-preload.js` `window.menuOverlay` invoke
  like `unlockVault`, NOT `window.goldfinch`.)
- `src/preload/menu-overlay-preload.js` — a `captureSave({ token, captureId, vaultId })` →
  `ipcRenderer.invoke('menu-overlay:vault-capture-save', …)` bridge method.
- `src/main/register-overlay-ipc.js` — `ipcMain.handle('menu-overlay:vault-capture-save', …)`:
  validate sender + token; call the injected `vaultCaptureSave`; on `saved` close the sheet.
- `src/renderer/menu-overlay.js` + `src/shared/vault-capture-template.js` — the `vault-capture`
  **seventh** template kind (centered backdrop): shows origin, username, a Save/Update heading, and
  — for `save` — a vault choice (default active jar, global selectable); Save + Cancel. Submit
  reports the chosen vaultId via the invoke.
- `src/renderer/renderer.js` — `onVaultCaptureOffer({ captureId, model })` opens the `vault-capture`
  sheet with the model (stash `captureId`); the Save invoke originates in the **sheet**
  (`window.menuOverlay.captureSave`), chrome only opens it. **Dismiss wiring (HIGH):** extend the
  existing `handleOverlayClosed` — when `menuType === 'vault-capture'` and the close was **not** a
  save, call `window.goldfinch.vaultCaptureDismiss(captureId)` so main drops+zeroizes the held
  record immediately (not just on the 2-min timeout). (Keep the flow symmetric with the picker:
  chrome opens; the sheet reports the choice to main.)
- Tests: unit for the disposition logic (update when origin+username exists, else save; default/
  choices); integration for `guest-vault-capture` gating (dropped when not set up / locked / burner)
  and `vaultCaptureSave` (saves via `saveItem` with the held credential; update uses the fixed id;
  the model carries no password; the held record is zeroized/dropped on save + on dismiss + on
  timeout); unit for the `vault-capture` template.

## Acceptance Criteria

- [x] Submitting a detected **top-frame** login form in a **set-up, unlocked, persistent-jar** tab
      raises a chrome-owned `vault-capture` prompt showing the origin + username. In a **not-set-up**,
      **locked**, or **burner** tab, **no** prompt is raised (main-side gate; grep/integration-tested).
- [x] The prompt is **update** when an exact origin+username already exists in {active jar, global}
      (via `reachableLoginItems`), **save** otherwise; a `save` defaults to the active jar's vault
      with the global vault selectable; an `update` targets the existing item's vault (no vault choice).
- [x] On accept, the credential is persisted via `saveItem` — a `save` creates a new login in the
      chosen vault, an `update` overwrites the existing item (same id). Verified by reading the vault
      back.
- [x] The captured **password never reaches chrome or the sheet**: the `vault-capture-offer` model
      and the sheet's save invoke carry only origin/username/vaultId — never the password (grep +
      assertion). The password lives only in the main-side held record.
- [x] The held record is **dropped and zeroized** on save, on dismiss (chrome `handleOverlayClosed`
      for `vault-capture` → `vaultCaptureDismiss(captureId)` → main drop), on **supersession** (a new
      capture for the same `wcId` evicts the prior record), and on a ~2-min safety timeout — no
      captured password lingers. Tested for each exit path (with an injected timer for the timeout).
- [x] Existing tests pass unmodified; `npm run test`, `npm run typecheck`, lint clean.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/<new suites>` — green.
- Unit: disposition (update-vs-save, default/choices); the `vault-capture` template (save vs update
  rendering, vault choice for save only).
- Integration: `guest-vault-capture` gate (dropped when not-set-up / locked / burner — no offer);
  `vaultCaptureSave` (save → new item via `saveItem`; update → same id overwritten; model+invoke
  carry no password; record zeroized/dropped on save, dismiss, and timeout).
- `npm run test` full — no regressions. `npm run typecheck` + lint — clean.
- Grep: no `password` on `vault-capture-offer` or `menu-overlay:vault-capture-save` payloads; the
  captured password appears only in the main-side record + the `saveItem` call.

## Implementation Guidance

1. **Submit observer (`webview-preload.js`)** — behind the existing top-frame + `vault-eligible`
   gate, add a capturing `document.addEventListener('submit', …)` (and/or per detected form). On a
   submit whose form contains a detected login (`findLoginFields(form)`/`findAllLoginFields`), read
   the current `{ username, password }` values, encode the password to a `Uint8Array`, and
   `ipcRenderer.send('guest-vault-capture', { username, password })`. Do **not** send the origin
   (main derives it from the sender URL — never trust a guest-supplied origin). Keep it to real form
   submits for v1 (SPA/fetch logins with no form submit are a documented F3 gap).

2. **Capture ops on `createVaultHuman` (`vault-human.js`)** — `capture`/`captureSave`/`captureDismiss`
   as in Outputs. Key correctness points: **evict+zeroize any prior record for the same `wcId`** before
   storing a new one; **normalize `username` `'' → null`** on both the capture read and the
   `reachableLoginItems` match; **prefer the active-jar match over global** on a username tie (global is
   iterated first in `reachableLoginItems`); `passwordBytes.fill?.(0)` after copying to the record
   Buffer; arm the drop timer via the **injected** `setTimeout` (testable). `main.js`/
   `register-browser-ipc.js` only wire the IPC + forward the offer (mirror the `vaultUnlock` injection).

3. **`captureSave` details** — re-check `isUnlocked()` (idle-lock race → `{ saved:false,
   reason:'locked' }`); `save` requires `vaultId ∈ record.choices`, `update` uses the record's fixed
   `{ vaultId, itemId }`; **synthesize a `title`** = the origin's hostname (`new URL(origin).hostname`)
   so captured items are self-describing; `saveItem(target, { id?: itemId, type:'login', title, origin,
   username, password: record.password.toString('utf8') })`; then `record.password.fill(0)` + drop +
   clear the timer.

4. **`vault-capture` template (seventh kind)** — pure `src/shared/vault-capture-template.js` builder
   + `menu-overlay.js` TEMPLATES/`NODE_OF_ENTRY`/init dispatch + `menuController.register` (centered
   backdrop, no `items` roving unless the vault choice is a list) + `overlayMenus` entry + the
   `<script>` in `menu-overlay.html`. Render: a "Save password?"/"Update password?" heading, the
   origin + username (read-only), and for `save` a vault radio/select (default active jar, "Global"
   selectable). Save + Cancel. Save → `window.menuOverlay.captureSave({ token: currentToken,
   captureId, vaultId })`; await `{ saved }` → close on true.

5. **Chrome open + preload/handlers** — `chrome-preload.js`: `onVaultCaptureOffer(cb)` subscriber +
   `vaultCaptureDismiss(captureId)` invoke. `renderer.js`: `onVaultCaptureOffer(({ captureId, model })
   => openOverlayMenu('vault-capture', model, null, 0, …))` (stash `captureId`); **extend
   `handleOverlayClosed`** — on `vault-capture` closed without a save, call
   `window.goldfinch.vaultCaptureDismiss(captureId)` (HIGH — the dismiss-drop path). `menu-overlay-
   preload.js`: `captureSave` invoke bridge. `register-overlay-ipc.js`:
   `ipcMain.handle('menu-overlay:vault-capture-save', …)` — validate sender+token, call the injected
   `vaultCaptureSave`, close the sheet on `saved`.

## Edge Cases

- **Not set up / locked / burner**: no offer (main gate). Locked-time capture is a documented v1
  limitation (the credential the user typed isn't saved this time).
- **Idle-locked between offer and save**: `vaultCaptureSave` re-checks `isUnlocked()` → `{ saved:false,
  reason:'locked' }`; the sheet shows an error / closes (the held record is dropped on close).
- **Update path**: the vault choice is suppressed (the item's vault is fixed); `saveItem` upserts by
  the existing id.
- **Password-only form (no username)**: capture with `username: ''`/null; disposition treats a
  null-username match conservatively (save, not update, unless an existing null-username item matches).
- **Multiple rapid submits**: last-wins; each capture gets a fresh `captureId`; superseded records
  are dropped+zeroized.
- **User dismisses**: `onMenuOverlayClosed` for `vault-capture` → drop + zeroize the held record.
- **Orphaned record** (sheet never resolves): the ~2-min timeout drops + zeroizes it.
- **Guest-supplied origin ignored**: origin is always derived in main from the sender URL.

## Files Affected

- `src/preload/webview-preload.js` — submit observer + `guest-vault-capture` send.
- `src/main/vault/vault-human.js` — the `capture`/`captureSave`/`captureDismiss` ops + held-record
  map + disposition + injected timer.
- `src/main/main.js` / `src/main/register-browser-ipc.js` — `guest-vault-capture` handler +
  `vault-capture-offer` forward + `vaultCaptureDismiss` handler + inject `vaultCaptureSave` into
  `registerOverlayIpc`.
- `src/preload/menu-overlay-preload.js` — `captureSave` invoke bridge.
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-capture-save` handler.
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — `onVaultCaptureOffer` +
  `vaultCaptureDismiss`.
- `src/renderer/menu-overlay.js` + `src/shared/vault-capture-template.js` + `menu-overlay.css` +
  `menu-overlay.html` — the `vault-capture` template.
- `src/renderer/renderer.js` — the capture-offer → open + `dispatchOverlayActivation`/close wiring.
- `test/unit/…` — disposition, capture gating, `vaultCaptureSave`, template.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] This is the FINAL leg — but do NOT set flight status or commit; the Flight Director runs the
      flight-end review, then commits the whole flight and lands it.
