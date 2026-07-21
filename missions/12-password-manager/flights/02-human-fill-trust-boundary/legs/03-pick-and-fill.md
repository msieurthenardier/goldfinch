# Leg: pick-and-fill

**Status**: completed
**Flight**: [Human Fill Trust Boundary](../flight.md)

## Objective

Complete the human fill flow: from a lock-icon gesture, unlock (if locked) via the Leg-2 prompt,
show a chrome-owned **vault picker** of the exact-origin-matching credentials from {the tab's jar,
global} (badged), and on selection dispatch the chosen credential through F1's `vault-fill`
main→preload channel — with the password resolved and sent **only in main**, never through chrome
or the sheet.

## Context

- **Flight DD5** — a net-new, **origin-filtered, metadata-only** `VaultStore` reachable-items method
  (moved here from `chrome-unlock` to co-locate with its consumer, the picker). Returns login items
  from {global, the tab's jar} whose stored origin equals the tab origin, each tagged with its
  source `vaultId`; only `{ vaultId, id, title, origin, username, hasTotp }`, **never** a password.
  Returns `[]` (never throws) when locked / burner / uncreated vault (DD9 guards).
- **Flight DD6** — exact-origin, checked twice: the picker is origin-filtered at open, and the fill
  path re-checks at dispatch so a stale pick can't fill the wrong origin. If the vault locks between
  pick and fill, re-raise the unlock prompt rather than erroring.
- **Credential never leaves main** — the picker model and the selection are **metadata only**
  (title/username/ids). The password is read by `(vaultId, itemId)` under the MRK **in main** and
  handed to F1's `fillDelegate({ wcId, credential })` (`main.js:634-636`) → guest preload
  `vault-fill` listener → `fillLoginForm` (top-frame guarded, `vault-fill-fields.js:79`). Chrome and
  the sheet never see the password.
- **Leg 1 seam** — the chrome `onVaultGesture(({ wcId }) => …)` subscriber (currently the `void wcId`
  stub in `renderer.js`) is the entry point this leg replaces with the flow.
- **Leg 2 seams (present in the tree)** — `menuOverlayOpen({ menuType: 'vault-unlock' })` opens the
  unlock sheet; `getVaultLockState()` / `onVaultLockState(cb)` → `{ setUp, unlocked }` (+
  `buildVaultIndicatorModel`) is the lock-state API; the unlock sheet closes + broadcasts
  `vault-lock-state: unlocked` on success.
- **Precedent** — the container picker: `openOverlayMenu('new-container'|container-menu, …)`
  (`renderer.js`), the `'menu'` roving-list template kind (`menu-overlay.js` TEMPLATES), the model
  builder (`container-menu.js`), and `dispatchOverlayActivation` (`renderer.js:478-519`) that runs
  the chosen action on a channel-6 activated `{ id, value }`.

## Inputs

- `src/main/vault/vault-store.js` — `listItems(target)` (`:650`, MRK-gated per-target read),
  `_resolveTarget` (`:540-547`, `'global'` + persistent jars, excludes burner/unknown/`{id:'global'}`),
  `_requireMrk`/`isUnlocked`/`isSetUp`, item shape (`{ id, type, title, origin, username, password,
  totp?, ... }`).
- `src/main/main.js` — `getVaultStore()` singleton (`:566-573`); the F1 `fillDelegate`
  (`:634-636`); `webContents.fromId`; the jar/session resolution handles (`scopeCtx`,
  `resolvePersistJar` via the registry `getWindowForGuest(wcId).tabViews.get(wcId)` idiom Leg 1
  used); `broadcastToChromeAndInternal`.
- `src/main/vault/vault-context.js` — `originOf(url)` (`:44-50`) and the exact-origin gate
  (`:322-326`) — reuse the same origin-compare for the human fill re-check.
- `src/renderer/renderer.js` — `onVaultGesture` stub (replace); `onVaultLockState` subscription
  (Leg 2); `dispatchOverlayActivation` (`:478-519`); `openOverlayMenu` (`:384-409`).
- `src/renderer/menu-overlay.js` — TEMPLATES (`:524`), the `'menu'` roving template kind + its
  `NODE_OF_ENTRY`/register; the exactly-one-report token/`sent` discipline.
- `src/preload/chrome-preload.js` — the invoke pattern; `menuOverlayOpen`; add the reachable-items +
  fill invokes.
- `src/main/register-overlay-ipc.js` / `register-browser-ipc.js` — where the new invokes are handled
  (chrome-originated invokes belong with the browser IPC; sheet-originated activation stays overlay).

## Outputs

- `src/main/vault/vault-store.js` — a new `reachableLoginItems(jarId, origin)` →
  `{ vaultId, id, title, origin, username, hasTotp }[]` (metadata only; `[]` on locked/burner/
  uncreated; global + jarId only; exact-origin filtered). Unit-tested.
- `src/main/main.js` (or a small vault-human module) — two chrome-facing operations:
  - `vaultReachableItems(wcId)` — resolves the tab's origin (`new URL(fromId(wcId).getURL()).origin`)
    and persistent jar (registry idiom; burner → `null`), calls `reachableLoginItems(jarId, origin)`,
    returns the metadata list (or `[]`).
  - `vaultFillHuman({ wcId, vaultId, itemId })` — in order: requires MRK (`reason:'locked'`);
    **requires a persistent jar — burner → `reason:'ineligible'` before the scope assert (DD9)**;
    **asserts `vaultId === 'global' || vaultId === tabJar.id`** (cross-vault scope re-check — never
    fill a sibling jar's credential; `reason:'out-of-scope'`); requires `item.origin === tabOrigin`
    (`reason:'origin-mismatch'`); reads the credential by `(vaultId, itemId)` under the MRK; calls
    `fillDelegate({ wcId, credential })`; returns `{ filled:true }` (no password in the result).
- `src/renderer/menu-overlay.js` — a `vault-picker` menuType as a **dedicated sixth template kind**
  (centered backdrop; NOT an alias of `'menu'`, which can't render title+username+badge or emit a
  selection value): each row shows title + dimmed username + a **vault badge** (jar name vs "Global");
  selection reports the chosen index via the `id` field, `sendActivatedOnce({ id: 'pick:' + i })` (the
  `'sug:'+i` idiom; the selection is non-secret). An empty model renders a non-focusable
  `type:'note'` "No saved logins for this site" state.
- `src/renderer/renderer.js` — the flow state machine replacing the `onVaultGesture` stub (below),
  plus a `dispatchOverlayActivation` case `'vault-picker'`.
- `src/preload/chrome-preload.js` + `renderer-globals.d.ts` — `vaultReachableItems(wcId)` and
  `vaultFillHuman(payload)` invokes.
- Tests: unit for `reachableLoginItems` (origin filter, global+jar merge, source tagging, no
  password, empty on locked/burner/uncreated); integration for `vaultFillHuman` (happy path calls
  `fillDelegate` with the right credential; cross-vault `vaultId` rejected; origin-mismatch rejected;
  locked → `reason:'locked'`; password never in the return); unit for the picker template + the
  index→item mapping.

## Acceptance Criteria

- [x] `reachableLoginItems(jarId, origin)` returns only `{ vaultId, id, title, origin, username,
      hasTotp }` (no password/TOTP-secret), merged from **global + that jar only**, **exact-origin
      filtered**, source-tagged; returns `[]` (never throws) when the store is locked, the jar is
      burner/non-persistent, or the vault is uncreated. Unit-tested. *(`vault-store-reachable.test.js`.)*
- [x] On a lock-icon gesture in an **unlocked** state, a chrome-owned `vault-picker` sheet lists the
      origin-matching credentials from {tab jar, global}, each **badged** by source vault; a sibling
      jar's credential never appears. Empty set → "No saved logins for this site". *(Picker template +
      the flow state machine; sibling-exclusion is unit-pinned in `vault-store-reachable.test.js`.)*
- [x] On a gesture in a **locked** state, the Leg-2 `vault-unlock` prompt is raised first; on
      successful unlock the flow continues to the picker (chrome state machine keyed to the gesture's
      `wcId`). *(`onVaultGesture` → `onVaultLockState` phase-guarded continue in `renderer.js`.)*
- [x] Selecting an entry fills the tab's **top-frame** origin-matched login via F1's `vault-fill`
      channel; the password is resolved and sent **only in main** (`fillDelegate`) — it never
      appears in the picker model, the activated selection, the invoke result, or any chrome/sheet
      surface (grep-confirmed). *(`vault-human.js`; grep shows the credential only at `vault-human.js`
      + the main `fillDelegate` sends.)*
- [x] `vaultFillHuman` **re-checks** at dispatch, in order: locked → `reason:'locked'`; **no
      persistent jar (burner) → `reason:'ineligible'` (before the scope assert, so a `'global'`
      vaultId cannot fill a burner tab)**; `vaultId ∈ { 'global', tabJar.id }` else
      `reason:'out-of-scope'` (cross-vault — a sibling-jar/wrong `vaultId` refused); `item.origin
      === tabOrigin` else `reason:'origin-mismatch'`. Any refusal does **not** call `fillDelegate`.
      *(`vault-human.test.js` — each branch + fillDelegate-not-called asserted.)*
- [x] If the vault locks between pick and fill, `vaultFillHuman` returns `{ filled:false,
      reason:'locked' }` and the flow re-raises the unlock prompt (does not error/crash). *(Store
      lock → `reason:'locked'`; dispatch re-opens `vault-unlock` on that reason.)*
- [x] Burner/non-persistent tab: no reachable items **and** `vaultFillHuman` refuses with
      `reason:'ineligible'` even if invoked directly (defense-in-depth; DD9). *(`vault-human.test.js`
      — the `vaultId:'global'` burner case is the DD9 linchpin test.)*
- [x] Existing tests pass unmodified; `npm run test`, `npm run typecheck`, lint clean.
      *(2353/2353 pass; typecheck + lint clean.)*

## Verification Steps

- `node --test --test-timeout=60000 test/unit/<new suites>` — green.
- Unit: `reachableLoginItems` — origin filter, global+jar merge, source tagging, metadata-only,
  empty-on-locked/burner/uncreated.
- Integration: `vaultFillHuman` — happy path (fillDelegate called with the resolved credential, no
  password returned); cross-vault `vaultId` refused (no fillDelegate); origin-mismatch refused;
  locked → `reason:'locked'`; the fill result carries no password (grep + assertion).
- Unit: the `vault-picker` template renders badged rows + the empty state; index→item mapping is
  correct.
- `npm run test` full suite — no regressions. `npm run typecheck` + lint — clean.
- Grep: no password/`credential.password` on any chrome/sheet channel; the credential appears only in
  `fillDelegate`'s main-side call.

*(Citations below are against the current post-Leg-1+2 tree.)*

1. **`reachableLoginItems(jarId, origin)` (`vault-store.js`)** — guard `isUnlocked()` (`[]` if not);
   for each of `['global', jarId]` (skip a null/non-persistent jarId), `try { listItems(id) }`
   (`:665`; catch → skip, so an uncreated vault — `_readVault === null`, `:670` — contributes
   nothing), filter `type === 'login' && item.origin === origin`, map to `{ vaultId:id, id:item.id,
   title, origin, username, hasTotp: Boolean(item.totp) }`. Never include `password`/`totp` secret.

2. **Main ops (`main.js` or a `vault-human.js` sibling)** —
   - `vaultReachableItems(wcId)`: resolve origin from `webContents.fromId(wcId)?.getURL()`
     **wrapped in try/catch** (`new URL(url).origin` throws on a bad/empty URL — `[]` on
     missing/throw; `originOf` is **not exported** from `vault-context.js`, so use a local null-safe
     helper); resolve the persistent jar via the Leg-1 registry idiom
     (`registry.getWindowForGuest(wcId)?.tabViews.get(wcId)` → `resolvePersistJar(entry, jars.list())`,
     `register-browser-ipc.js:85-88`); burner/none → `[]`; else
     `getVaultStore().reachableLoginItems(jar.id, origin)` (`getVaultStore` at `main.js:567-581`).
   - `vaultFillHuman({ wcId, vaultId, itemId })` — order matters:
     1. `const store = getVaultStore(); if (!store.isUnlocked()) return { filled:false,
        reason:'locked' }`.
     2. Re-resolve `tabOrigin` (wrapped `new URL(...).origin`) and the **persistent jar**
        (`tabJar = resolvePersistJar(...)`). **[HIGH] `if (!tabJar) return { filled:false,
        reason:'ineligible' }`** — a burner/non-persistent tab is refused *before* the global/jar
        assert, so a `vaultId:'global'` can never fill a burner tab (DD9). `_resolveTarget`
        (`vault-store.js:555-562`) will NOT catch this for you — it admits any persistent jar.
     3. Assert `vaultId === 'global' || vaultId === tabJar.id` else `{ filled:false,
        reason:'out-of-scope' }` (cross-vault scope — `listItems(vaultId)` would otherwise happily
        decrypt a sibling jar under the MRK).
     4. `const item = store.listItems(vaultId).find(i => i.id === itemId)`; require `item &&
        type==='login' && item.origin === tabOrigin` else `{ filled:false, reason:'origin-mismatch' }`.
     5. `fillDelegate({ wcId, credential: { username: item.username, password: item.password } })`
        (`main.js:652-654`); return `{ filled:true }`. Build + consume the credential here; never
        return it. (Top-frame is guaranteed by the guest guard `vault-fill-fields.js:113`.)

3. **`vault-picker` template (`menu-overlay.js`) — a DEDICATED sixth template kind** (do NOT alias
   `'menu'`: `renderMenu` (`:170-238`) emits only a single label + optional color dot + hardcoded
   "Default" badge and reports `{ id }` with no `value` — it can't express title+username+vault-badge
   rows). Add a `vault-picker` builder + `TEMPLATES` entry + `NODE_OF_ENTRY` + `menuController.register`
   (roving list, no `items`-less trap). Render it **centered** (a `#sheet-dialog`-style backdrop like
   `vault-unlock`, `:522-539`) since the gesture carries no anchor coordinates. Each row: title,
   dimmed username, a vault **badge** (jar display name, or "Global"). Selection reports the row index
   via the **`id`** field using the established index idiom `sendActivatedOnce({ id: 'pick:' + i })`
   (the `suggestions` precedent `'sug:'+i`, `:511`) — `id` is not length-capped (only `value` is,
   `menu-overlay-value.js:17,27`). Empty model → a single non-focusable `type:'note'` row (`:194-201`)
   "No saved logins for this site".

4. **Chrome flow state machine (`renderer.js`)** — replace the `onVaultGesture` stub. Add stored
   lock state (`renderer.js` currently holds only `vaultStatePushed` + `renderVaultIndicator`
   `:1104-1126`; the `onVaultLockState` handler must now also stash `{ setUp, unlocked }`).
   - `pendingVaultFlow = null` (shape `{ wcId, phase }`, phase ∈ `'unlocking' | 'picking'`);
     `lastPickerModel = []`.
   - `onVaultGesture({ wcId })`: if `!lockState.setUp` → ignore (no setup UI in F2). If
     `lockState.unlocked` → `pendingVaultFlow = { wcId, phase:'picking' }; openPicker(wcId)`; else
     `pendingVaultFlow = { wcId, phase:'unlocking' }; openOverlayMenu('vault-unlock', [], null, 0)`
     (the real API is **positional** `openOverlayMenu(menuType, model, anchor, startIndex, opts)`,
     `:286,394` — not `menuOverlayOpen({...})`).
   - `onVaultLockState(s)`: **continue only when we are mid-unlock** — `if (pendingVaultFlow?.phase
     === 'unlocking' && s.unlocked) { pendingVaultFlow.phase = 'picking';
     openPicker(pendingVaultFlow.wcId); }`. The phase guard stops an *unrelated* later unlock
     (the broadcast fires for master/recovery/admin, `vault-store.js:502-513`) from springing the
     picker on a stale tab.
   - `onMenuOverlayClosed({ menuType })` (existing subscriber): if `menuType === 'vault-unlock' &&
     pendingVaultFlow?.phase === 'unlocking' && !lockState.unlocked` → `pendingVaultFlow = null`
     (user dismissed the unlock prompt — abandon the flow).
   - `openPicker(wcId)`: `lastPickerModel = await vaultReachableItems(wcId);
     openOverlayMenu('vault-picker', lastPickerModel, null, 0)`.
   - `dispatchOverlayActivation` case `'vault-picker'` (id `'pick:'+i`): `const item =
     lastPickerModel[Number(id.slice(5))]; const wcId = pendingVaultFlow?.wcId; pendingVaultFlow =
     null; const r = await vaultFillHuman({ wcId, vaultId: item.vaultId, itemId: item.id });` — if
     `r.reason === 'locked'`, set `pendingVaultFlow = { wcId, phase:'unlocking' }` and re-open
     `vault-unlock` (re-prompt → re-pick).

5. **Invokes (`chrome-preload.js` + handlers)** — add `vaultReachableItems(wcId)` and
   `vaultFillHuman(payload)` to `window.goldfinch` (invoke), handled in main (browser IPC). Both are
   chrome-originated; keep them off the sheet preload.

## Edge Cases

- **Empty origin-match set**: picker shows "No saved logins for this site" (create-new is F3).
- **Locked between pick and fill**: `vaultFillHuman` → `reason:'locked'` → re-prompt unlock, then
  re-open picker (re-pick). Documented; a slightly longer path, but correct.
- **Cross-vault `vaultId`** (defense-in-depth if the model were tampered): refused in main
  (`out-of-scope`).
- **Origin changed after picker opened** (tab navigated): fill-time origin re-check refuses.
- **Burner tab**: `[]` reachable, and `vaultFillHuman` refuses with `ineligible` (the burner gate
  precedes the scope assert, so a `'global'` vaultId can't slip through).
- **User dismisses the unlock prompt** (Cancel/Escape, no unlock): `onMenuOverlayClosed` clears
  `pendingVaultFlow` so a later unrelated unlock doesn't spring the picker on the stale tab.
- **Tab closed mid-flow**: `fromId(wcId)` null → `[]` / no fill; `fillDelegate` optional-chains.
- **TOTP**: `hasTotp` is surfaced as a badge/flag only; offering the TOTP code on fill is F3
  (enrollment + live display) — this leg fills username+password only.
- **Multiple rapid gestures**: `pendingVaultFlow` is last-wins; opening a new sheet model-replaces.

## Files Affected

- `src/main/vault/vault-store.js` — `reachableLoginItems`.
- `src/main/main.js` (or `src/main/vault-human.js`) — `vaultReachableItems`, `vaultFillHuman`.
- `src/renderer/menu-overlay.js` — `vault-picker` template.
- `src/renderer/menu-overlay.css` — picker row + badge styles.
- `src/renderer/renderer.js` — the flow state machine + `dispatchOverlayActivation` case.
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — the two invokes.
- `test/unit/…` — `reachableLoginItems`, `vaultFillHuman`, picker template.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (note the F1-fill-path live-verification result —
      see the flight prereq; if a live check isn't possible in-session, record it as deferred to the
      flight-end behavior-test run) — **F1 fill-path live check DEFERRED to the flight-end
      `vault-human-fill-boundary` behavior-test run.** This leg reuses F1's exact `vault-fill` channel
      (`main.js` `fillDelegate` → `webContents.fromId(wcId)?.send('vault-fill', credential)`), which is
      unit-covered here (the resolved credential reaches the delegate; the password never returns); a
      real end-to-end fill needs the live GUI (the sheet is MCP-unreachable by DD8), so it rides the
      flight-end behavior test with the rest of the guest-observable trust-boundary slice.
- [x] Set this leg's status to `landed` (Flight Director commits at flight end)
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits after the flight-end review)
