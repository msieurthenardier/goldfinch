# Leg: lock-icon-inject

**Status**: completed
**Flight**: [Human Fill Trust Boundary](../flight.md)

## Objective

Inject a decorative, spoofable lock icon into detected login forms in the guest main world
(suppressed in burner tabs), and route a **trusted** user click on it to the chrome renderer via
a new gesture channel — so a later leg can raise the chrome-owned unlock prompt. No secret
crosses any new channel; the icon carries none and the gesture is a bare trigger.

## Context

- **Flight DD1** — the icon is decorative and untrusted; all trust lives in main + chrome. It is
  injected into the guest main world (contextIsolation off), so it is necessarily spoofable — a
  hostile page gains nothing by faking/hiding it (no secret on the page, no privileged action).
- **Flight DD2** — reuse/extend the pure `vault-fill-fields.js` detection helper. Today
  `findLoginFields` returns only the first `input[type=password]`; per-form icon placement needs
  **all** password fields. Detection stays `type=password`-anchored (no login-form scoring).
- **Flight DD3** — the gesture channel mirrors the `guest-media-list` → `event.sender.id` →
  `chromeForTab` idiom, and the emit is gated on `event.isTrusted` so a scripted `icon.click()`
  cannot raise the prompt.
- **Flight DD9** — burner/non-persistent tabs get **no** icon: the preload queries main for a
  per-tab vault-eligibility flag at init (mirroring the `shields-farble` sync-IPC pattern); main
  answers eligible only when the tab's session resolves to a **persistent** jar
  (`resolvePersistJar`).
- **F1 substrate** — `webview-preload.js` already runs a debounced `MutationObserver` and a
  `DOMContentLoaded`/`load` scan for the media catalog; the icon re-placement reuses that hook.
  The F1 `vault-fill` listener (`webview-preload.js:215`) is the sibling this leg sits next to.

## Inputs

What exists before this leg runs:
- `src/preload/vault-fill-fields.js` — pure, Electron-free, unit-tested; exports
  `findLoginFields(doc)` (first password field, `:31-53`) and `fillLoginForm` (`:76-89`).
- `src/preload/webview-preload.js` — the guest main-world preload: media `collect()`/`send()`,
  the debounced `scheduleScan()` + `MutationObserver` (`:188-204`), the sync
  `ipcRenderer.sendSync('shields-farble', location.href)` at init (`:243`), and the F1
  `ipcRenderer.on('vault-fill', …)` listener (`:215`).
- `src/main/register-browser-ipc.js` — `ipcMain.on('guest-media-list', …)` → `chromeForTab` and
  the sync `ipcMain.on('shields-farble', …)` handler using `event.returnValue` (keyed off
  `event.sender.session`); the dependency bag (`ipcMain`, `chromeForTab`, etc.).
- `src/main/main.js` — `chromeForTab(wcId)` (`:263-266`); the `scopeCtx`/session-resolution
  handles; `resolvePersistJar` is available via `src/main/persist-jar-gate.js`.
- `src/preload/chrome-preload.js` — the chrome `contextBridge` (`window.goldfinch`) with
  subscriber methods like `onTabMediaList` (`:274`).
- `src/main/persist-jar-gate.js` — `resolvePersistJar(tabEntry, jarsList)`
  (`!tabEntry.trusted && jarsList.find(j => j.partition === tabEntry.partition) || null`).

## Outputs

What exists after this leg completes:
- `src/preload/vault-fill-fields.js` — a new pure exported `findAllLoginFields(doc)` returning
  one `{ password, username, form }` entry per detected password field (`[]` when none), plus
  unit tests. `findLoginFields` is unchanged (still used by fill).
- `src/preload/webview-preload.js` — decorative lock-icon injection anchored to each detected
  password field, re-placed on the existing observer/scan cycle, gated on a main-provided
  vault-eligibility flag (queried once at init), with an `event.isTrusted`-gated click that
  emits `ipcRenderer.send('guest-vault-gesture', {})`.
- `src/main/register-browser-ipc.js` — a new sync eligibility handler (mirroring `shields-farble`,
  answering from `resolvePersistJar`) and a new `ipcMain.on('guest-vault-gesture', …)` that takes
  the wcId from `event.sender.id` and forwards `chromeForTab(event.sender.id)?.send('vault-gesture', { wcId })`.
- `src/preload/chrome-preload.js` — a new `onVaultGesture(cb)` contextBridge subscriber.
- A chrome-renderer subscriber **stub** (`src/renderer/renderer.js` or the appropriate chrome
  module) that receives `{ wcId }` and no-ops for now (a log/marker) — the real consumer is the
  `pick-and-fill` leg. This keeps Leg 1 green and self-contained.

## Acceptance Criteria

- [x] `findAllLoginFields(doc)` (pure, in `vault-fill-fields.js`) returns one
      `{ password, username, form }` per `input[type=password]` in document order; `[]` when
      none; username resolved by the same last-preceding-text-input rule as `findLoginFields`.
      Unit-tested (multi-form page, password-only form, no-login page).
- [x] In a **persistent-jar** web tab, a decorative lock icon is injected — **top-frame only**
      (`window.top === window`, matching `fillLoginForm`'s guard at `vault-fill-fields.js:79`) —
      one icon **per detected login form** (de-duped by form; a form-less password field gets its
      own icon), re-placed when the form mutates.
- [x] **The media-scan observer still settles** — icon injection/re-placement does **not**
      re-trigger the existing media `MutationObserver` → `scheduleScan` → `guest-media-list`
      loop. On an eligible page with a login form, `guest-media-list` does not re-emit
      indefinitely (icon-only mutations — icon-node attr changes and all-icon-node childList
      adds/removes — are filtered via a `WeakSet` predicate before `scheduleScan`).
- [x] Zero-size / non-visible password fields (`display:none` honeypots, 0×0 rects) get **no**
      icon (filtered in the preload; the pure helper still returns all fields).
- [x] In a **burner** (non-persistent) tab, **no** icon is injected — the preload's init-time
      eligibility query returns not-eligible, and injection is skipped.
- [x] A **trusted** click on the icon emits `guest-vault-gesture`; a scripted
      `iconEl.click()` / synthetic dispatch (`event.isTrusted === false`) emits **nothing**
      (captured `Event.prototype.isTrusted` getter).
- [x] Main receives `guest-vault-gesture`, derives the wcId from `event.sender.id` (never a
      renderer-supplied id), and forwards `vault-gesture { wcId }` to the owning window's chrome
      via `chromeForTab`.
- [x] The chrome renderer receives `vault-gesture { wcId }` through the new `onVaultGesture`
      contextBridge subscriber (stub consumer; no user-visible behavior yet).
- [x] No secret, credential, or vault state crosses any new channel (grep-confirmed the payloads
      are `{}` / `{ wcId }` only; `vault-eligible` is a sync boolean).
- [x] The guest runs `nodeIntegration:false` so page JS cannot register its own listener on the
      new channels (unchanged from F1).
- [x] Existing tests pass unmodified; `npm run typecheck` + lint clean.

## Verification Steps

- `node --test test/unit/vault-fill-fields.test.js` — new `findAllLoginFields` cases green; the
  existing `findLoginFields`/`fillLoginForm` cases unchanged and green.
- `npm run test` — full suite green, no regressions.
- `npm run typecheck` and the project's lint — clean.
- Manual/inspection (or a preload-logic unit test if the injection is factored purely enough):
  confirm the eligibility gate skips injection when the flag is false, and the click handler
  early-returns when `!event.isTrusted`.
- Grep the new channels for payload shape: `guest-vault-gesture` carries `{}`, `vault-gesture`
  carries `{ wcId }` — no credential fields.

## Implementation Guidance

1. **Pure detection helper (`vault-fill-fields.js`)**
   - Add `findAllLoginFields(doc)`: `Array.from(doc.querySelectorAll('input[type=password]'))`,
     and for each, resolve `form = pw.form || pw.closest('form')` and the username field by the
     same last-preceding-`USERNAME_TYPES`-input rule `findLoginFields` uses (factor the
     shared per-password logic so `findLoginFields` can stay `[0]` of the new list, or keep them
     parallel — implementer's choice, but do not change `findLoginFields`'s contract).
   - Keep it pure (no `window`, no DOM globals beyond the passed `doc`) so it stays
     `node --test`-importable. Return `[]` for no password fields.

2. **Eligibility query at preload init (`webview-preload.js`)**
   - **Gate on top frame first:** if `window.top !== window`, do nothing (no query, no icons,
     no listeners) — icons are top-frame only, matching `fillLoginForm`'s guard.
   - In the top frame, near the existing `shields-farble` sync call, add
     `const vaultEligible = ipcRenderer.sendSync('vault-eligible')` (name at implementer's
     discretion; the shape is a sync boolean). If not eligible, skip all icon injection and the
     gesture wiring entirely (still leave the F1 `vault-fill` listener alone — that path is
     already jar-scoped in main).

3. **Icon injection + re-placement (`webview-preload.js`)** — **must not feedback-loop the media
   observer (HIGH).** The existing observer (`webview-preload.js:196-204`) watches `childList` +
   `subtree` + `attributes{src,srcset,style,poster}`. Appending an icon (childList) and
   positioning it via `.style` (style attr) both re-fire that observer → `scheduleScan` →
   `collect()` forever. Prevent it:
   - Keep every injected icon node in a module-level `WeakSet`. In the **media observer's
     callback**, before calling `scheduleScan`, ignore mutations whose `target` and all
     `addedNodes` are icon nodes (WeakSet / data-attr check). (Alternatively `observer.disconnect()`
     around placement and re-`observe()` after — the WeakSet filter is preferred, no lost real
     mutations.)
   - Drive icon placement on the same eligible-page scan cycle. Call `findAllLoginFields(document)`,
     **group by `entry.form`** (one icon per login form; a form-less password field gets its own),
     **skip zero-size / non-visible fields** (`getBoundingClientRect` 0×0, or offsetParent null),
     and inject/refresh one decorative lock icon per group, anchored (absolute overlay, high
     z-index; no shadow DOM — spoofability accepted per DD1). Tag icon nodes with a data attribute
     and reuse/reposition across scans (no stacking). Null-guard the anchor parent.
   - The icon element and its styles are inline in the preload (the guest page has no chrome CSS).

4. **Trusted click → gesture emit (`webview-preload.js`)**
   - Attach a click listener to each icon: `if (!e.isTrusted) return;` then
     `ipcRenderer.send('guest-vault-gesture', {})`. No payload beyond an empty object — the wcId
     is derived in main.
   - **`isTrusted` hardening (best-effort):** because contextIsolation is off, a hostile page can
     override `Event.prototype`'s `isTrusted` getter. Capture the genuine getter once at preload
     init — `const isTrustedGet = Object.getOwnPropertyDescriptor(Event.prototype,'isTrusted').get`
     — and read `isTrustedGet.call(e)` in the handler. Note at the handler that this is
     annoyance-hardening only (a determined page can still raise the prompt; it can never complete
     a chrome-owned fill — DD1/DD3).

5. **Main routing (`register-browser-ipc.js`)** — **`registry` and `jars` are already in this
   file's dependency bag** (destructured at `register-browser-ipc.js:10,24`; no `main.js`
   threading needed; `resolvePersistJar` is a same-dir `require('./persist-jar-gate')`, the
   `closed-tab-capture.js:20` / `session-snapshot.js:20` precedent).
   - Add the sync eligibility handler: resolve the tab entry via
     `registry.getWindowForGuest(event.sender.id)?.tabViews.get(event.sender.id)` (the entry
     `{ view, partition, trusted, active }` set at `register-tab-ipc.js:109`), then
     `event.returnValue = Boolean(resolvePersistJar(entry, jars.list()))`. Do **not** try to
     derive `partition`/`trusted` from `event.sender.session` — it carries neither.
   - Add `ipcMain.on('guest-vault-gesture', (event) => { const wcId = event.sender.id;
     chromeForTab(wcId)?.send('vault-gesture', { wcId }); })`. Never trust a renderer-supplied id.

6. **Chrome subscriber (`chrome-preload.js` + a chrome-renderer stub)**
   - Add `onVaultGesture(cb)` to the `window.goldfinch` contextBridge (mirror `onTabMediaList`).
   - Wire a stub consumer in the chrome renderer that receives `{ wcId }` and no-ops (a marker /
     debug log). The `pick-and-fill` leg replaces the stub with the real unlock→pick→fill flow.

## Edge Cases

- **Media-observer feedback loop (HIGH — see guidance step 3)**: icon DOM/style mutations must be
  filtered out of the media observer's `scheduleScan` path or the scan never settles.
- **Cross-origin iframe login**: no icon (top-frame gate in guidance step 2) — a subframe form
  must not raise the prompt via the shared tab wcId.
- **Multi-form / dynamically-added forms**: the observer cycle places icons on forms added after
  load; de-dupe by form + data attribute so re-scans don't stack icons.
- **Multiple password fields in one form** (signup/confirm): one icon per **form**, not per field.
- **Password field with no surrounding form**: still inject (anchor to the field); `form` null.
- **Hidden / zero-rect password field** (`display:none` honeypot, pre-render SPA field): skipped
  (no 0×0 icon at the top-left corner).
- **Icon overlap / layout thrash**: reposition on the debounced cycle only (no per-frame layout
  listener); accept minor mis-anchoring on exotic layouts (decorative).
- **`isTrusted` overridden by a hostile page**: best-effort captured-getter read (guidance step 4);
  annoyance-only, never a fill.
- **Burner tab**: eligibility false → no injection, no listeners; confirm no console errors.
- **Tab closed between click and forward**: `chromeForTab(wcId)?.` optional-chains to a no-op.

## Files Affected

- `src/preload/vault-fill-fields.js` — add pure `findAllLoginFields`.
- `src/preload/webview-preload.js` — eligibility query, icon injection + re-placement,
  `isTrusted`-gated gesture emit.
- `src/main/register-browser-ipc.js` — sync eligibility handler + `guest-vault-gesture` router.
- `src/preload/chrome-preload.js` — `onVaultGesture` subscriber.
- `src/renderer/renderer.js` (or the appropriate chrome module) — stub `vault-gesture` consumer.
- `test/unit/vault-fill-fields.test.js` — `findAllLoginFields` cases (multi-form, password-only,
  no-form password field, no-login page).
- *(No `main.js` dep threading needed — `registry` + `jars` are already in
  `register-browser-ipc.js`'s dependency bag; `resolvePersistJar` is a same-dir require.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (Flight Director commits at flight end)
- [x] Check off this leg in flight.md
- [x] (Not the final leg — no flight-status change here)
- [x] Do NOT commit (deferred-commit model — Flight Director commits after the flight-end review)
