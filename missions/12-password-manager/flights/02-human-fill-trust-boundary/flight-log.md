# Flight Log: Human Fill Trust Boundary

**Flight**: [Human Fill Trust Boundary](flight.md)

## Summary

Flight 2 of Mission 12 (Built-in Password Manager). Builds the human trust boundary on top of
F1's proven crypto core + fill channel: decorative lock-icon injection, chrome-owned unlock
prompt + badged vault picker, human gesture→fill flow, and capture (save/update) prompt.
Autonomous execution posture (mission-level pre-authorization); the closing HAT is Flight 4.

Status: **landed** — all 4 legs completed; whole-diff flight-end review passed (1 blocking
data-loss issue found + fixed + re-review-confirmed); `npm test` **2389/2389**, typecheck + lint
clean. Committed + draft PR opened. `npm run a11y` + the `vault-human-fill-boundary` behavior test
are live-GUI steps deferred to the flight-end/F4-HAT GUI session (per DD8). Debrief is the next
step (the go/no-go before F3).

**Branch**: `flight/02-human-fill-trust-boundary`, **stacked on `flight/01-...`** (F1's PR #108
is not yet merged to main, and F2 builds directly on F1's `vault-fill` channel / `vault-store` /
menu-overlay code). Flight Director judgment call: stacking is the only way to build F2 without
merging F1 (the operator's review gate to close); F2 rebases onto main once F1 merges.

---

## Reconnaissance Report

F2 is greenfield human-UI atop F1; it sources no prior-artifact work-item list, so a full
Phase-1b recon table does not apply. Three code-interrogation sweeps + one apparatus audit
established the substrate (all citations carried into the flight DDs):

| Area | Finding | Consequence |
|------|---------|-------------|
| Guest preload / fill | `webview-preload.js` runs contextIsolation:false / nodeIntegration:false; F1 `vault-fill` channel + `findLoginFields` (first password field only) exist | DD1/DD2/DD3 — decorative icon, extend detection to all fields, trigger channel via `event.sender.id` |
| Chrome modal | menu-overlay sheet + `input-dialog` (`new-container`) precedent; channel-4 `menu-overlay:activated` is string+24-char capped by `sanitizeActivatedValue` | DD4 — new templates; dedicated Buffer secret channel, not channel-4 |
| Vault store | `saveItem` exists (0 callers); no human "this jar + global" reachable list; exact-origin gate in `vault-context`; `deriveAuditDetail` args-only | DD5 (net-new reachable read), DD7 (reuse `saveItem`), DD6 (exact-origin), audit-origin deferred to F3 |
| **Apparatus audit** | **menu-overlay sheet WebContents is unreachable via every MCP path** (`getChromeTarget` → toolbar only; sheet classified `'guest'`, never enumerated); only admin `captureWindow` sees it as pixels | **DD8 — verification splits: guest-observable behavior test + main-process integration (simulated sheet IPC) + F4 HAT; the sheet is NOT exposed to the automation surface for test convenience** |

---

## Leg Progress

### lock-icon-inject
**Status**: landed
**Risk tier**: **HIGH** — new code on the untrusted guest main-world boundary, three new IPC
channels, and a burner-eligibility compartmentalization gate. Per the risk-tiering rule
(security-sensitive surface), ran the per-leg design review before implementation.

**Design review (1 cycle, approve with changes)** — verified all citations against the tree;
riskiest unknown (eligibility handler data access) resolved favorably (`registry` + `jars`
already in `register-browser-ipc.js` deps). Incorporated: **[HIGH]** icon mutations must be
filtered out of the media `MutationObserver` → `scheduleScan` path or the media scan never
settles (WeakSet of icon nodes); **[MED]** correct tab-entry lookup is
`registry.getWindowForGuest(id).tabViews.get(id)` → `resolvePersistJar` (NOT `event.sender.session`,
which lacks partition/trusted); **[MED]** gate icon injection to the top frame
(`window.top === window`) so iframe logins don't raise the prompt; **[LOW]** `isTrusted`
captured-getter hardening, zero-rect field filtering, one-icon-per-form de-dup. Fixes were
reviewer-specified (mechanical), so no second design-review cycle; the flight-end Reviewer
backstops the implementation.

**Implemented (2026-07-20):**
- `src/preload/vault-fill-fields.js` — factored the per-password username heuristic into a shared
  `resolveLoginEntry(password)`; added pure `findAllLoginFields(doc)` → one `{ username, password,
  form }` per `input[type=password]` in document order (`[]` when none). `findLoginFields`'s
  `{ username, password }` first-field contract is byte-for-byte unchanged (still consumes
  `resolveLoginEntry`).
- `src/preload/webview-preload.js` — top-frame gate (`window.top === window`) → init-time
  `ipcRenderer.sendSync('vault-eligible')` → decorative 🔒 injection (absolute overlay, max
  z-index, one icon per form via anchor de-dup, zero-rect/`offsetParent===null` fields skipped,
  repositioned/pruned on the existing scan+observer cycle). **Media-observer feedback loop (HIGH)
  closed**: injected nodes tracked in a `WeakSet`; the media observer callback early-returns when
  every mutation is icon-only (`isIconOnlyMutation` — icon-node attr change, or childList whose
  added/removed are all icon nodes), so icon append/reposition never re-arms `scheduleScan`. Click
  handler reads the captured `Event.prototype.isTrusted` getter (grabbed once at init); a non-trusted
  (scripted/synthetic) click early-returns, a trusted click sends `guest-vault-gesture` `{}`.
- `src/main/register-browser-ipc.js` — sync `vault-eligible` handler (`registry.getWindowForGuest
  (event.sender.id)?.tabViews.get(event.sender.id)` → `Boolean(resolvePersistJar(entry, jars.list()))`,
  `resolvePersistJar` `require`d same-dir); `ipcMain.on('guest-vault-gesture', …)` derives the wcId
  from `event.sender.id` and forwards `chromeForTab(wcId)?.send('vault-gesture', { wcId })`.
- `src/preload/chrome-preload.js` — `onVaultGesture(cb)` contextBridge subscriber (mirrors
  `onTabMediaList`); `src/renderer/renderer-globals.d.ts` — its typed entry.
- `src/renderer/renderer.js` — self-contained STUB consumer near the other `on*` subscribers:
  receives `{ wcId }` and no-ops (`void wcId`). The real unlock→pick→fill consumer is the
  `pick-and-fill` leg.
- `test/unit/vault-fill-fields.test.js` — 7 new `findAllLoginFields` cases (multi-form,
  password-only form, form-less password field, no-login page, two-passwords-in-one-form,
  null/garbage doc). Existing `findLoginFields`/`fillLoginForm` cases untouched (import line only).

**Test result**: focused `node --test test/unit/vault-fill-fields.test.js` — **12/12 pass**
(5 pre-existing + 7 new). Full `npm test` — **2314/2314 pass, 0 fail** (no regressions).
`npm run typecheck` clean; `npm run lint` clean.

**Deviations from guidance**: none of substance. Two implementer choices worth flagging: (1) the
media-observer icon filter is implemented as a batch predicate (`mutations.every(isIconOnlyMutation)`
covering both icon-node attribute changes AND all-icon-node childList adds/removes) rather than the
guidance's narrower "target and all addedNodes are icon nodes" phrasing — a strict superset that also
correctly ignores icon *removal* during pruning, so the media scan settles in every icon-churn case.
(2) `findAllLoginFields` returns one entry PER password field (per the AC / leg objective); the
one-icon-**per-form** de-dup lives in the preload's `placeVaultIcons` (anchor = `form || password`),
not in the pure helper — keeping the helper a faithful `querySelectorAll` enumeration.

**Notes for `chrome-unlock` (next leg)**: the chrome-side gesture arrival point is live —
`window.goldfinch.onVaultGesture(({ wcId }) => …)` in `renderer.js` (currently the `void wcId`
stub). `chrome-unlock`/`pick-and-fill` replaces that stub body to raise the sheet prompt; the
`{ wcId }` it receives is the trusted, main-derived tab id (never renderer-supplied). Channels are
in place: `vault-eligible` (sync bool), `guest-vault-gesture` `{}` (guest→main), `vault-gesture`
`{ wcId }` (main→chrome). No secret crosses any of them. Icon is intentionally decorative/spoofable
(DD1) — no chrome-side trust is placed in it.

### chrome-unlock
**Status**: ready → implementing
**Risk tier**: **HIGH** — a net-new secret (master-password) IPC channel + stateful human unlock
of the vault store + a new cross-renderer lock-state broadcast. Security-sensitive surface → runs
the per-leg design review before implementation.

**Adaptive scope change (Flight Director, leg-design):** the **DD5 reachable-items `VaultStore`
method moved from `chrome-unlock` to `pick-and-fill`** — co-located with its first consumer (the
picker). Rationale: the Architect's cycle-2 [low] flagged `chrome-unlock` as the heaviest leg;
shedding the reachable method leaves `chrome-unlock` as a tight, highly-reviewable secret-channel +
lock-state security surface, and gives `pick-and-fill` a cohesive "reachable read → picker → fill."
`capture-save` (Leg 4) still consumes the reachable read for its update-vs-save check — Leg 3 < Leg 4,
so the dependency order holds. flight.md leg list + checkpoints b1/b2 updated to match.

**Design review (1 cycle, approve with changes)** — confirmed the critical mechanism works: the
invoke-based `Uint8Array` secret channel survives the sheet's `contextIsolation:true` (contextBridge
+ invoke both clone typed arrays), and closing the sheet mid-invoke is safe (`closeMenuOverlay` only
hides the view, never destroys the reply-bearing webContents). Incorporated: **[HIGH]** wrap
`onUnlock` in try/catch inside `_installMrk` (a failing broadcast must not reject `unlock()` while
the store is unlocked) + constructor read + typedef; **[MED]** zeroize the **incoming** `Uint8Array`
too (`Buffer.from` copies; the deserialized array lingers); **[MED]** scope the `onLock` AC to
**idle auto-lock** (nothing calls `lockNow()` from main today — explicit Lock-now + before-quit
wiring is F3); **[MED]** amended **DD4** to state the channel is `invoke` (not `send`) — the
re-prompt needs the `{ ok }` result; **[LOW]** `vault-unlock` is a *fifth* template kind (builder +
`NODE_OF_ENTRY` + dispatch + register, avoiding the non-focusing fallback trap), `getVaultStore()`
memoized singleton + `vaultStoreModule.VaultAuthError`, subscribe-before-fetch on the indicator,
`sent=true` on success, `window-factory.js:88` citation fix. Reviewer-specified fixes (mechanical) —
no second design-review cycle; flight-end Reviewer backstops.

**Status**: landed

**Implemented (2026-07-20):**
- `src/main/vault/vault-store.js` — `onUnlock` dep read in the constructor + `VaultStoreDeps` typedef
  entry; fired **guarded** (try/catch) at the end of `_installMrk` after `_touch()`, so all three
  unlock paths (master/recovery/admin) broadcast and a failing notify never rejects `unlock()`.
  `unlock`'s param JSDoc widened to `string | Buffer` (deriveMasterKey already accepts both).
- `src/main/register-overlay-ipc.js` — `ipcMain.handle('menu-overlay:vault-unlock', …)` (gated on
  the injected `vaultUnlock` so the existing offline overlay test — no vault dep — never calls
  `handle`): sender-identity (`recordForSheetSender`) + `token === getCurrentMenu().token` checks,
  `Buffer.from(secret)`, `closeMenuOverlay('activated', token)` on ok, and a `finally` that zeroizes
  **both** the copied `Buffer` and the incoming `Uint8Array`.
- `src/main/main.js` — injected `onLock`/`onUnlock` (both → `broadcastVaultLockState()`) and
  `vaultUnlock` (memoized `getVaultStore().unlock`, `VaultAuthError`→`{ok:false}`, others rethrow)
  into the vault-store/overlay deps; `computeVaultLockState()`/`broadcastVaultLockState()` helpers;
  bare `ipcMain.handle('vault-lock-state-get', …)`; corrected the "never mutates human lock state"
  comment.
- `src/preload/menu-overlay-preload.js` — `unlockVault({token,secret}) → invoke('menu-overlay:vault-unlock')`
  (first `invoke` from the sheet preload). `src/preload/chrome-preload.js` — `onVaultLockState` +
  `getVaultLockState`.
- `src/renderer/menu-overlay.js` — the `vault-unlock` FIFTH template kind: `buildVaultUnlockCard`
  DOM, `menuController.register` (no `items`), submit → dedicated secret channel (encode → invoke →
  `{ok}`: true closes, false shows the inline error + stays open), Tab-trap + Escape + backdrop
  dismiss, TEMPLATES/NODE_OF_ENTRY/dispatch entries (does NOT fall through to the non-focusing
  fallback). `src/shared/vault-unlock-template.js` — the extracted, unit-tested card builder.
- `src/renderer/menu-overlay.css` — `#sheet-vault-unlock` backdrop + `.vault-unlock-error` styles.
- `src/renderer/index.html` + `chrome/context.js` + `renderer.js` + `styles.css` — `#vault-indicator`
  toolbar control (two padlock glyphs); `src/shared/vault-indicator-model.js` — pure
  hidden/locked/unlocked projection; wired subscribe-FIRST-then-fetch (a fresher push wins).
- `src/renderer/renderer-globals.d.ts` + `menu-overlay-globals.d.ts` — types for the new bridge
  methods. `menu-overlay.html` + `index.html` — `<script type="module">` tags for the two new
  shared modules.
- Tests: `test/unit/vault-unlock-handler.test.js` (6 — correct/wrong/throw + sender/token/type
  rejection, Buffer hand-off + both-array zeroization + broadcast/close on success only),
  `vault-store-onunlock.test.js` (4 — all three paths fire, wrong-pw fires nothing, throwing hook
  swallowed, absent-dep no-op), `vault-indicator-model.test.js` (4), `vault-unlock-template.test.js`
  (2 — DOM/aria).

**Test result**: focused new suites `node --test --test-timeout=60000` — **16/16 pass**. Full
`npm test` — **2330/2330 pass, 0 fail** (all pre-existing tests unmodified; +16 over lock-icon-inject's
2314). `npm run typecheck` clean; `npm run lint` clean. Grep AC confirmed: the vault-unlock submit
uses `unlockVault` only — the password never touches `menu-overlay:activated`.

**Deviations from guidance**:
- The `vault-unlock` template's card DOM was **extracted into a pure `src/shared/vault-unlock-template.js`
  builder** (`buildVaultUnlockCard(document)`) rather than built inline like the other four templates.
  Reason: the AC requires a structure/aria **unit test**, and the sheet IIFE isn't unit-loadable
  (no jsdom in this repo); the extracted builder tests against the existing fake-document helper — the
  same "pure module in `src/shared/`" idiom the codebase already uses. The builder uses `appendChild`
  (not `.append`) so it runs unchanged under the fake DOM.
- The handler's `ipcMain.handle` registration is **gated on the `vaultUnlock` injection** so the
  pre-existing `register-overlay-ipc.test.js` (fake ipcMain with `on` only, no vault dep) keeps
  passing **unmodified** — no existing test was touched.
- Buffer zeroization lives **only in the handler's `finally`** (owns the copy), not also in main's
  `vaultUnlock` — per Implementation Guidance step 3/4 ("Buffer zeroization is step 3"); the Outputs
  bullet's "`.fill(0)` in `finally`" for main is satisfied by the handler that owns the buffer.
- Sheet-side hardening beyond the letter of the guidance (all defensive, no behavior change on the
  happy path): a `vaultBusy` guard against double-submit, a stale-token guard after the await, a
  try/catch around the invoke so a rejected handler (e.g. not-set-up) degrades to a re-prompt instead
  of an unhandled rejection, and zeroizing the sheet-side `Uint8Array` copy after the round-trip.

**Notes for `pick-and-fill` (next leg)** — the exact shapes it will consume:
- **Chrome gesture arrival** (from Leg 1): `window.goldfinch.onVaultGesture(({ wcId }) => …)` in
  `renderer.js` is still the `void wcId` stub — replace its body to raise the sheet. `{ wcId }` is
  the trusted, main-derived tab id.
- **Open a sheet template**: chrome opens via `window.goldfinch.menuOverlayOpen({ menuType, model,
  anchor, startIndex, token })` (channel-1). To raise this leg's prompt, open with
  `menuType: 'vault-unlock'` (model may be `[]`; the card is fixed-layout, anchor ignored/centered).
  There is **no chrome-side trigger wired for `vault-unlock` yet** — this leg only added the sheet
  template + handler + indicator; `pick-and-fill` owns the trigger→open + the trigger-refocus wiring
  (and the flight-end a11y pass, per Verification Steps).
- **Lock-state query/subscribe API**: `window.goldfinch.getVaultLockState() → Promise<{setUp,
  unlocked}>` and `window.goldfinch.onVaultLockState(cb)` (payload `{setUp, unlocked}`); the pure
  projection is `buildVaultIndicatorModel({setUp, unlocked})` in `src/shared/`. Use `getVaultLockState()`
  to decide unlock-first-vs-pick when the gesture fires.
- **Secret channel** (if the picker ever needs to re-prompt): `window.menuOverlay.unlockVault({token,
  secret: Uint8Array}) → Promise<{ok}>` from the sheet; main handler `menu-overlay:vault-unlock`.
- **Where the reachable-items method should live**: the DD5 origin-filtered, metadata-only
  `VaultStore` reachable-items read was **deferred from this leg to `pick-and-fill`** (Flight Director
  scope change above) — add it on the vault store, co-located with the picker (its first consumer),
  and reuse the F1 `main.js` `vault-fill` delegate (`main.js` `fillDelegate` → `webContents.fromId(wcId)?.send('vault-fill', credential)`) for the fill half. Confirm the F1 fill path works end-to-end at leg start (prereq).

---

### pick-and-fill
**Status**: ready → implementing

**Design review (1 cycle, approve with changes)** — verified the three load-bearing properties
against the current tree: credential-never-leaves-main SOUND (mirrors F1 `vault-context.fill`; picker
model + selection are metadata/index only); the cross-vault assert is genuinely load-bearing
(`_resolveTarget`/`listItems` would decrypt a sibling jar under the MRK without it); `reachableLoginItems`
`[]`-safety holds. Incorporated: **[HIGH]** `vaultFillHuman` gates on persistent-jar eligibility FIRST
(`!tabJar → reason:'ineligible'`) — the bare `vaultId ∈ {'global', tabJarId}` assert *passes* for a
burner tab when `vaultId='global'` (tabJarId=null), which would fill a global cred into a burner tab
(DD9 violation); **[MED]** `vault-picker` is a dedicated SIXTH template kind (the `'menu'` kind can't
render title+username+badge or emit a selection value), centered backdrop, selection via `id:'pick:'+i`
(the `'sug:'+i` idiom); **[MED]** phase-tracked `pendingVaultFlow` state machine (clear on unlock-prompt
dismissal so a later unrelated unlock can't spring the picker on a stale tab; continue only when
phase==='unlocking'); **[LOW]** citation drift fixes (`fillDelegate` `:652-654`, top-frame guard `:113`,
etc.), `originOf` not exported (wrap a local `new URL().origin`), stored `lockState` in `renderer.js`,
positional `openOverlayMenu(...)`. F1-fill-live prereq read as a sequencing preference (channel is
unit-covered) → folds into the flight-end behavior-test run. Reviewer-specified fixes → no second cycle.
**Risk tier**: **HIGH** — resolves and dispatches real credentials, performs the cross-vault
scope re-check + origin re-check at fill, and adds a new chrome-side flow state machine. Runs the
per-leg design review. Architecture: the credential is resolved by `(vaultId, itemId)` under the
MRK and sent to the guest **only in main** (F1 `fillDelegate`); the picker model + selection are
metadata/index only — the password never touches chrome or the sheet.

**Status**: landed

**Implemented (2026-07-20):**
- `src/main/vault/vault-store.js` — new `reachableLoginItems(jarId, origin)` (DD5/DD6):
  `isUnlocked()`-guarded, `!jarId` (burner) → `[]` up front (defense-in-depth beyond the caller),
  global + that-jar targets, per-target `try { listItems(id) } catch { skip }`, `type==='login' &&
  origin===` filter, mapped to metadata `{ vaultId, id, title, origin, username, hasTotp }` — never a
  password/TOTP secret.
- `src/main/vault/vault-human.js` — NEW Electron-free injected-deps module `createVaultHuman(deps)` →
  `{ reachableItems(wcId), fillHuman({wcId,vaultId,itemId}) }`. Local null-safe `originOf` (not
  exported from vault-context). `fillHuman` re-checks in ORDER: locked → **burner ineligible (before
  the scope assert, DD9)** → cross-vault `out-of-scope` → exact-origin `origin-mismatch`; builds +
  consumes the credential HERE and returns `{ filled:true }` (no password). A `VaultLockedError` from
  `listItems` maps to `reason:'locked'` (lock-between-pick-and-fill).
- `src/main/main.js` — memoized `getVaultHuman()` (wired to `getVaultStore`, `webContents.fromId`, the
  registry tab-entry idiom `getWindowForGuest(id)?.tabViews.get(id)`, `jars.list`, and F1's
  `webContents.send('vault-fill', credential)` delegate); bare `ipcMain.handle('vault-reachable-items')`
  + `ipcMain.handle('vault-fill-human')` (chrome trust domain; type-guard the payload).
- `src/shared/vault-picker-template.js` — NEW pure module: `buildVaultPickerCard` (centered backdrop +
  `role="menu"` card), `renderVaultPickerRows` (badged title+username+badge menuitem rows / the empty
  `note`), and the `pickId`/`parsePickIndex`/`badgeLabelFor` helpers (the `id:'pick:'+i` ↔ index
  contract).
- `src/renderer/menu-overlay.js` — the `vault-picker` **sixth** template kind (NOT a `'menu'` alias):
  roving list via the shared controller, selection → `sendActivatedOnce({ id: pickId(i) })`, backdrop
  outside-click dismiss, empty→note focuses the card; TEMPLATES/NODE_OF_ENTRY/dispatch + Tab-flavor
  entries.
- `src/renderer/menu-overlay.css` — `#sheet-vault-picker` backdrop + `.vault-picker-*` row/badge/note
  styles. `src/renderer/menu-overlay.html` — the picker-template module `<script>` tag.
- `src/renderer/renderer.js` — the flow state machine replacing the `onVaultGesture` stub:
  phase-tracked `pendingVaultFlow`, `lastPickerModel`, stashed `lockState`; `openVaultPicker` (reads
  reachable items, enriches each row with a jar-name `badgeLabel`, opens the sheet); `onVaultLockState`
  stashes state + continues to the picker only when `phase==='unlocking' && unlocked`;
  `handleOverlayClosed` clears the flow on a dismissed `vault-unlock`; `dispatchOverlayActivation` case
  `'vault-picker'` (index → `vaultFillHuman`, re-prompt on `reason:'locked'`); `vault-unlock` +
  `vault-picker` state entries in `overlayMenus`.
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — `vaultReachableItems(wcId)`
  + `vaultFillHuman(payload)` invokes + types.
- Tests: `test/unit/vault-store-reachable.test.js` (6 — merge/filter/tagging/metadata-only/no-password,
  `[]` on locked/burner-null/uncreated/unknown/empty), `test/unit/vault-human.test.js` (11 — happy
  jar + happy global, burner-`ineligible` DD9 linchpin, cross-vault `out-of-scope`, `origin-mismatch`,
  `locked`, unknown-itemId, reachable metadata/no-password, `[]` burner/closed/locked),
  `test/unit/vault-picker-template.test.js` (7 — card/aria, badged rows + index stamp, empty note,
  re-render, title fallback, `pickId`/`parsePickIndex` round-trip + malformed-id → null, `badgeLabelFor`).

**Test result**: focused new suites `node --test --test-timeout=60000` — **23/23 pass**. Full
`npm test` — **2353/2353 pass, 0 fail** (all pre-existing tests unmodified; +23 over chrome-unlock's
2330). `npm run typecheck` clean; `npm run lint` clean. **Grep AC confirmed**: the credential
`{ username, password }` is built ONLY at `vault-human.js` and sent ONLY via the main-side
`fillDelegate` (`webContents.send('vault-fill', …)`); the picker model, the `pick:<i>` selection, and
both invokes' payloads/returns carry no password (every chrome/sheet `password`/`credential` hit is a
comment or the separate master-password unlock path).

**F1 fill-path live check**: **DEFERRED** to the flight-end `vault-human-fill-boundary` behavior-test
run. The reused `vault-fill` channel is unit-covered here (the resolved credential reaches the
delegate; the password never returns), but a real end-to-end fill needs the live GUI — the sheet is
MCP-unreachable by DD8 — so it rides the flight-end behavior test (per the design-review ruling that
folded the prereq into that run).

**Deviations from guidance**:
- **Store method refuses a null (burner) jarId with `[]` up front**, rather than the guidance's literal
  "read global, skip the null jar target". Reason: the Outputs/DD5 contract says the METHOD returns
  `[]` on burner, and never leaking global metadata for a null jar is strictly safer (defense-in-depth,
  matching DD9's posture). The only production caller (`vaultReachableItems`) already returns `[]` for a
  burner before calling, so this changes no real path — a non-null unknown jarId still reads global (the
  per-target catch skips the unknown jar). Belt-and-suspenders, no behavior change for any real tab.
- **The picker card DOM + rows are extracted to a pure `src/shared/vault-picker-template.js`** (the
  `vault-unlock-template.js` precedent) rather than built inline — the AC requires a unit-testable
  structure/aria + index-mapping test and the sheet IIFE isn't unit-loadable (no jsdom). Same idiom.
- **The two chrome-facing invokes are handled inline in `main.js`** (next to `vault-lock-state-get`),
  not in `register-browser-ipc.js` — the vault-store singleton, lock-state handler, and F1 delegate
  shape all already live in `main.js`; the Guidance allowed the ops to live in `main.js` or a
  `vault-human.js` sibling (I used the sibling for the testable logic + thin `main.js` handlers).
- **Row badge enrichment**: `openVaultPicker` maps each row's `vaultId` → the jar's display `name`
  (`badgeLabel`) from `jarsClient` before opening (the store returns `vaultId` only). The template shows
  "Global" for the global vault, else the enriched name (falling back to the raw `vaultId`). Dispatch
  still reads `vaultId`+`id` from the row — unaffected.

**Notes for `capture-save` (final leg):**
- **Reachable-items shape (capture reuses it for the update-vs-save existence check):**
  `VaultStore.reachableLoginItems(jarId, origin)` → `Array<{ vaultId, id, title, origin, username,
  hasTotp }>` (metadata only). It is `isUnlocked()`-guarded, returns `[]` for a null/burner jarId, and
  catches per-target so an unknown/uncreated jar contributes nothing. For capture's "does an exact
  origin+username already exist?" check, call it with the tab's persistent jar id + origin and match on
  `username` (an existing row → **update** that `{ vaultId, id }`; none → **save** to the default jar).
  Note the exact-origin filter is baked in — a match already means same-origin.
- **The `createVaultHuman` module (`src/main/vault/vault-human.js`)** owns the tab→jar (`tabJarFor`,
  the trusted `getTabEntry` registry idiom) + tab→origin (`tabOriginFor`, local `originOf`) resolution
  and the burner gate — capture's main handler can mirror the same injected-deps shape (or reuse these
  helpers) for its own burner/set-up gating rather than re-deriving them.
- **Template + open wiring (capture's `vault-capture` is the SEVENTH template kind):** follow the
  `vault-picker`/`vault-unlock` pattern — a pure `src/shared/*-template.js` builder imported by
  `menu-overlay.js`, a `TEMPLATES`/`NODE_OF_ENTRY`/init-dispatch entry (do NOT fall through to the
  non-focusing `'menu'` fallback), a matching `overlayMenus` state entry + a
  `dispatchOverlayActivation` case in `renderer.js`, and the module `<script>` in `menu-overlay.html`.
  `openOverlayMenu(menuType, model, anchor, startIndex, opts)` is positional. Capture is guest-triggered
  (a submit observer, DD7) → it likely reuses the same "no chrome trigger, `ariaTarget: () => null`,
  `refocus() {}`" state shape the vault-unlock/vault-picker entries use.

---

### capture-save
**Status**: ready → implementing

**Design review (1 cycle, approve with changes)** — all three load-bearing claims confirmed against
the tree: `saveItem` is MRK-gated + upsert-by-id + title-optional (`vault-store.js:625-657`);
password-never-to-chrome sound (held-record + captureId parallels Leg 3); the seventh-template-kind
pattern is complete. Incorporated: **[HIGH]** the dismiss-drop had no chrome→main channel (record is
in main; `onMenuOverlayClosed` fires in chrome) → added `vaultCaptureDismiss(captureId)` so a real
password isn't left until the 2-min timeout on Cancel; **[MED]** evict+zeroize any prior same-`wcId`
record on a new capture (true last-wins, not timeout-reliant); **[MED]** the unlocked-only gate
narrows the mission's "only when set up" — **kept for v1 as a deliberate product choice** (dedicated
manager offers only while actively unlocked; `saveItem`+existence-check need the MRK) and **flagged
for the debrief go/no-go**; **[LOW]** disposition prefers the active-jar copy over global on a
username tie, normalize `'' → null` username, synthesize a hostname title. **Suggestions**: capture
ops on the Electron-free `createVaultHuman` with an injected timer (testable); main wires the IPC
(mirrors the `vaultUnlock` injection). Reviewer-specified fixes → no second cycle; flight-end Reviewer
backstops.
**Risk tier**: **HIGH** — captures a real user password, holds it in a short-lived main-side record,
adds a guest→main channel carrying a secret, and persists via `saveItem`. Runs the per-leg design
review. Architecture: the password never reaches chrome/sheet — main holds it keyed by `captureId`,
the `vault-capture-offer` model carries only origin/username/disposition/choices; on accept the sheet
sends back only the chosen `vaultId`. **Scoping decision (flagged for review):** capture fires only
when set up **AND unlocked** (`saveItem` + the existence check need the MRK; prompt-then-unlock on
every submit is intrusive) — locked-time capture is a documented v1 limitation.

**Status**: landed

**Implemented (2026-07-20):**
- `src/main/vault/vault-human.js` — added the capture ops to `createVaultHuman` (Electron-free,
  injected deps): a `captures` `Map<captureId, record>`, an injected `setTimeout/clearTimeout/now`
  (drop timer testable), and `capture` / `captureSave` / `captureDismiss`. `capture` gates on
  `isSetUp() && isUnlocked() && persistentJar && origin` (else drops + zeroizes the incoming array,
  no offer), evicts+zeroizes any prior same-`wcId` record, normalizes `'' → null` username, computes
  the disposition via `reachableLoginItems` **preferring the active-jar match over global on a tie**,
  copies the password into a zeroizable Buffer, arms the ~2-min drop timer, and returns
  `{ captureId, model }` (model = origin/username/mode/defaultVaultId/choices — **no password**).
  `captureSave` re-checks `isUnlocked()` (idle-lock race → `{saved:false, reason:'locked'}`), requires
  `vaultId ∈ record.choices` for a save / uses the fixed `{vaultId, itemId}` for an update, synthesizes
  `title = new URL(origin).hostname`, calls `saveItem`, then zeroizes+drops. `dropCapture` is the single
  zeroize+evict+clear-timer choke point for all four exit paths.
- `src/main/register-browser-ipc.js` — `ipcMain.on('guest-vault-capture')` → `getVaultHuman().capture`
  (origin derived in main; forwards `vault-capture-offer` to the owning chrome via `chromeForTab`) +
  `ipcMain.handle('vault-capture-dismiss')` → `captureDismiss`; `getVaultHuman` added to the injected deps.
- `src/main/main.js` — injected `setTimeout/clearTimeout/now` into `getVaultHuman()`; passed
  `getVaultHuman` to `registerBrowserIpc`; injected `vaultCaptureSave` into `registerOverlayIpc`.
- `src/main/register-overlay-ipc.js` — `ipcMain.handle('menu-overlay:vault-capture-save')` (sender +
  open-token validated, mirrors `vault-unlock`; closes the sheet on `saved`), gated on the injection.
- `src/preload/webview-preload.js` — a capturing top-frame + `vault-eligible`-gated `submit` listener
  reading `{username, password}` from the submitted form and sending `guest-vault-capture` (password as
  a `Uint8Array`; **origin not sent** — derived in main). `findLoginFields` added to the import.
- `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts` — `onVaultCaptureOffer` +
  `vaultCaptureDismiss`. `src/preload/menu-overlay-preload.js` + `src/renderer/menu-overlay-globals.d.ts`
  — the sheet-side `captureSave` invoke.
- `src/shared/vault-capture-template.js` — NEW pure module: `buildVaultCaptureCard` (centered backdrop +
  `role="dialog"` card), `renderVaultCaptureCard` (Save/Update heading + origin/username + save-only vault
  radios; returns the choice inputs), `selectedVaultId`.
- `src/renderer/menu-overlay.js` — the `vault-capture` **seventh** template kind: build + register +
  `NODE_OF_ENTRY`/TEMPLATES + init-dispatch (object-model shape check alongside `suggestions`), the Save
  invoke (`window.menuOverlay.captureSave`, `{saved}`→close / re-prompt-with-error), Cancel/Escape/Tab.
- `src/renderer/menu-overlay.css` — `#sheet-vault-capture` backdrop + `.vault-capture-*` styles.
  `src/renderer/menu-overlay.html` — the capture-template module `<script>` tag.
- `src/renderer/renderer.js` — the `vault-capture` `overlayMenus` state entry, `onVaultCaptureOffer`
  (stash `captureId`, enrich save choices with jar labels, open the sheet with `{...model, captureId}`),
  and the `handleOverlayClosed` dismiss-drop branch (call `vaultCaptureDismiss` on a non-save, non-
  `superseded` close — `superseded` is skipped because main already evicted the prior record and
  `pendingCaptureId` now names the NEW capture).
- Tests: `test/unit/vault-capture.test.js` (24 — disposition save/update/jar-preference-on-tie/`''→null`;
  the gate dropped when not-set-up/locked/burner/closed; `captureSave` save→new item + update→same id +
  invalid-vault + re-check-locked + unknown id; drop on save/dismiss/supersession/timeout via the injected
  timer; incoming-array zeroize; no-password grep), `test/unit/vault-capture-template.test.js` (8 — save vs
  update rendering, vault-choice-on-save-only, null username, string-choices/Global label, re-render clears,
  `selectedVaultId`), `test/unit/vault-capture-handler.test.js` (7 — the save handler's sender/token
  discipline, close-on-save-only, no-password on the invoke, not-registered-without-injection), and +2 cases
  in `test/unit/register-browser-ipc.test.js` (offer forward / gate-drop no-forward / dismiss; no-password
  on the wire — additive, existing assertions untouched).

**Test result**: focused new suites `node --test --test-timeout=60000` — **38/38 pass** (no hangs; the
drop-timer timeout uses the injected fake — zero wall-clock wait). Full `npm test` — **2387/2387 pass,
0 fail** (all pre-existing tests unmodified; +34 over pick-and-fill's 2353). `npm run typecheck` clean;
`npm run lint` clean. **Grep AC confirmed**: the captured password appears only in `webview-preload.js`'s
`guest-vault-capture` send (Uint8Array), the `vault-human.js` held record, and the `saveItem` call in
`captureSave`; the `vault-capture-offer` model and the `menu-overlay:vault-capture-save` invoke carry
only origin/username/mode/defaultVaultId/choices/captureId/vaultId — never a password (every other
`password` hit in the renderer/template/menu-overlay is a comment or a UI label).

**Deviations from guidance**:
- **`update` overwrites via `saveItem` with only `{id, type, title, origin, username, password}`** — per
  the leg's precise Implementation Guidance. `saveItem` replaces the item wholesale (preserving only
  `createdAt`), so any **existing `totp`/other fields on an updated login are dropped**. Acceptable for
  F2 (capture is password save/update; per-credential TOTP editing is F3), but **flagged for the flight-end
  Reviewer** as a potential data-loss-on-update edge — a future capture could carry the prior item's extra
  fields forward if that's undesired.
- **`captureSave` returns `{saved:false, reason:'invalid-vault'}`** for a save whose chosen vault isn't in
  the offer's `choices` (the guidance says "require `vaultId ∈ record.choices`" without naming the reason);
  the sheet treats any `saved:false` as a generic re-prompt.
- **`vault-capture-dismiss` is a chrome bare `ipcMain.handle` in `register-browser-ipc.js`** (next to the
  capture forward) rather than `main.js` — co-located with `guest-vault-capture` since both need
  `getVaultHuman`; same chrome-trust class as the Leg-3 `vault-fill-human` handle.

**For the flight-end Reviewer** (this is the FINAL leg — scrutinize before commit + land):
- **The password-never-to-chrome invariant is the flight's core** — the offer model + save invoke are
  grep-verified clean, but re-audit the whole capture path end-to-end (guest send → main record →
  `saveItem`) plus the dismiss/timeout/supersession drops.
- **The `handleOverlayClosed` `superseded` skip** (renderer.js) is the subtle correctness point: a rapid
  re-submit model-replaces the sheet; main's `capture()` already evicted the prior record and
  `pendingCaptureId` now names the NEW capture, so dismissing on `superseded` would wrongly drop the live
  one. The main-side same-`wcId` eviction is the actual last-wins guarantee; the chrome skip prevents a
  double/mis-drop.
- **The unlocked-only capture gate** narrows the mission's "only when set up" to "set up AND unlocked" —
  the **debrief go/no-go** item (locked-time prompt→unlock→save is the F3/F4 path).
- **`npm run a11y`** for the new `vault-capture` sheet template is a flight-end step (needs the live GUI;
  not run in this headless leg) — run it alongside the `vault-human-fill-boundary` behavior test.
- **The `guest-vault-capture` submit observer fires on real `<form>` submits only** — SPA/fetch logins
  are a documented F3 gap (DD7); the behavior test's fixture should submit a real form.

---

## Flight-End Whole-Diff Review

**Reviewer verdict: NOT confirmed — 1 BLOCKING, then fix.** Full suite re-run by the reviewer:
**2387 pass / 0 fail**, typecheck + lint clean. The security core traced **sound**: all three secret
paths (master password / fill credential / captured password) confirmed never to cross into
chrome/renderer/sheet/returns/logs; 12 new channels, all unique, trust-validated (guest triggers
derive wcId from `event.sender.id`; sheet invokes validate `recordForSheetSender` identity + open
token); compartmentalization holds (burner `ineligible` fires before the scope assert; sibling-jar
`out-of-scope`; no cross-vault escape); Buffer zeroization on every exit path; tests carry real
security assertions (no-password-in-payload via stringify grep, zeroization, scope refusals).

**BLOCKING — capture-update destroys a login's `totp`/title (data loss).** `captureSave`'s update
branch calls `saveItem` with only `{id,type,title,origin,username,password}`; `saveItem` replaces
the item wholesale (keeps only `createdAt`), so an update **silently wipes the stored TOTP seed**
(a first-class F1 field — `hasTotp`, `vaultTotp`) + any custom title. Amplified by the fill→submit
loop (submitting after a fill raises "Update password?" on the stored credential; accepting wipes
the 2FA seed — possibly the user's only copy). The leg-04 AC ("update overwrites the existing item")
was *literally* met, so no per-leg review caught it — **exactly the F1 lesson: the flight-end
whole-diff review catches cross-leg/cross-flight emergent issues per-leg reviews structurally can't**
(here, the interaction between capture-update and F1's TOTP field). Fix: merge, not replace —
read the existing item, spread it, override only origin/username/password. Non-blocking N1: wrap
`saveItem` in try/finally so `dropCapture` runs even if `saveItem` throws.

**Fix applied (developer, post-review).** `src/main/vault/vault-human.js` — `captureSave`:
- **BLOCKING fixed (merge, not replace).** The `update` branch now reads the existing item
  (`store.listItems(target).find(i => i.id === rec.itemId)`) and spreads it, overriding only
  `origin`/`username`/`password` — so `totp`, a user-customized `title`, `notes`, and any future
  field survive the update (`saveItem` still preserves `createdAt`). The hostname-title synthesis
  was moved to the SAVE (new-item) branch ONLY, so a custom title is never clobbered on update. Added
  an item-vanished guard (deleted between offer and save → drop the held record, `{ saved:false }`).
  The **SAVE branch is unchanged** in behavior (same new-login `{type,title,origin,username,password}`
  + `choices` validation + hostname title).
- **N1 fixed.** The `store.saveItem(...)` call is wrapped in `try { … } finally { dropCapture(captureId) }`
  so a persist throw (disk error) zeroizes+drops the held record immediately instead of letting the
  captured password linger until the 2-min safety timeout. Success/return semantics unchanged; the
  early returns (locked / invalid-vault / record-gone / item-vanished) still do NOT persist.
- **Tests** (`test/unit/vault-capture.test.js`, additive — no existing test weakened): added a merge
  case (existing login WITH a `totp` seed + custom title + notes survives a capture-update; password
  updated, `createdAt` + `id` preserved) and an N1 case (a `saveItem` throw still drops the record +
  clears the drop timer).
- **Verification:** `npm test` **2389 pass / 0 fail** (was 2387 — +2 additive), `npm run typecheck`
  clean, `npm run lint` clean. Landed-but-uncommitted; no leg/flight status changed (Flight Director
  re-reviews + commits the whole flight).

---

## Decisions

### Flight Director Notes — design phase

**Context**: Designing F2 (human fill trust boundary) under the mission's autonomous-execution
posture. Four background recon sweeps ran before drafting (preload/fill surfaces; chrome-modal
machinery; vault-store/capture/audit; MCP-reach-to-sheet apparatus audit).

**Key decision — apparatus (DD8)**: the observability-axis premise audit the flight skill
mandates surfaced that the chrome-owned menu-overlay **sheet is deliberately MCP-unreachable**.
Rather than weaken that security property by exposing the sheet wcId to the automation registry
(the barrier is undiscoverability, not authorization — so it *could* be exposed), F2 verifies
the guest-observable trust boundary over MCP, the flow logic via main-process integration tests
that simulate the sheet's inbound IPC, and the true human end-to-end at F4's HAT. This is the
premise audit paying off before legs were locked, not a mid-flight scramble.

**Two deliberate scope deferrals to F3** (documented in the flight's Contributing/Deferred and
in DD6/DD8 rationale, not silently dropped): the registrable-domain per-credential opt-in
(F2 is exact-origin only, the mission's guaranteed-safe default), and the audit-origin fix
(mission Known Issue #2 — an MCP-wire concern with no cohesive home among F2's human-UI legs).

**No per-flight HAT leg** — consistent with F1 and the mission's F4-closing-HAT design.

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

- **2026-07-20** — Flight 2 spec drafted (DD1–DD8, 3 legs, apparatus per DD8). Behavior-test
  spec `vault-human-fill-boundary` authored inline (guest-observable slice).
- **2026-07-20** — **Architect design review, cycle 1** (approve with changes). Verified every
  cited claim against code; no fatal flaw. Incorporated: **[high]** burner suppression → new
  **DD9** (burner tabs run `webview-preload.js`; would MRK-reach global — gate icon + prompt +
  capture); **[med]** `event.isTrusted` gate on the gesture (DD3); **[med]** origin-filtered
  picker (DD5/DD6); **[med]** split old Leg 2 → `chrome-unlock` + `pick-and-fill` (now 4 legs);
  **[med]** lock-state source-of-truth + broadcast → new **DD10** (`onLock` unwired today, no
  `onUnlock`); **[med]** DD8 admin-reachability wording; **[med]** lock-between-pick-and-fill
  re-prompt (DD6); DD4 corrected (sheet is `contextIsolation:true` → `menuOverlay` contextBridge
  secret hop; `deriveMasterKey` already Buffer-accepts, no widening); F1-fill-live prereq added.
- **2026-07-20** — **Architect design review, cycle 2** (approve with changes; delta-focused).
  Confirmed all cycle-1 resolutions correct against code. One fix incorporated: **[med]** DD10
  `onUnlock` fires from inside `_installMrk` (the single choke point for master/recovery/admin
  unlock), not the master-password call site — so a recovery/admin unlock also broadcasts and the
  indicator can't go stale. **[low]** noted: `chrome-unlock` is the heaviest leg but executable
  as-is (DD5's reachable method may shed to `pick-and-fill` at leg-design if it proves heavy).
  Flight marked **ready**.
