# Leg: save-prompt-surface

**Status**: completed
**Flight**: [Non-blocking Save Prompt](../flight.md)

## Objective
Replace the centered `vault-capture` sheet with a non-blocking, content-sized corner prompt in its own per-window `WebContentsView`. The prompt is tab-bound, never focused on show, and times out after 10 s with four pause inputs. It drops the held capture main-side on every non-save close. Unlocked Save writes through a four-guarded channel. The locked path keeps today's auto-raised unlock sheet, and its post-unlock offer now presents in the corner (the **interim locked path**). The prompt view is fail-closed to automation and has two census booleans. The vault-login fixture gains a capture mode, so behavior test `save-prompt-non-blocking` Variant A can run.

## Context
- Flight DDs binding this leg: **DD1** (view, manager, geometry, deferral, hide/restore matrix, squawk-0100 order), **DD4** (timer), **DD5** (tab binding, offer `wcId`), **DD6** (close channel, reason table, `vault-capture-dropped`, result states, vault-lock), **DD8** (retirement + `save-prompt:save`), **DD9** (security model), **DD10** (fail-closed guard + census). DD7 is **Leg 2**, apart from the interim locked path below. DD2/DD3 are **Leg 3**: this leg ships no F6 hop, no `:key` channel and no `#save-prompt-status`.
- **Interim locked path (Checkpoints):** `onVaultCaptureOffer`'s locked branch still pushes onto `pendingCaptureUnlock` and auto-raises `vault-unlock` with `{ keepFocus: true }` (`src/renderer/chrome/vault-controller.js` `onVaultCaptureOffer`, "if (model && model.mode === 'locked')"). After a successful unlock, today's `advance()` → `vaultCaptureFinalize` → `presentationQueue` drain now presents each resolved model in the **corner prompt** instead of `openCaptureSheet`. No consent, no auto-write. A locked model is never presented in the prompt in this leg.
- Precedents to copy, not invent:
  - `src/main/find-overlay-manager.js`: Electron-free per-window factory, lazy view, destroyed-recreate guard, `render-process-gone` self-teardown, add-after-guest raise, visibility-gated `removeChildView` hide, `syncBounds` store-always/apply-while-visible, teardown is the sole destroy.
  - `src/main/find-overlay-geometry.js`: pure geometry.
  - `src/main/window-factory.js` `createWindow`: overlay construction and the `close` teardown order.
  - `src/main/menu-overlay-manager.js`: chrome-minted monotonic token, eager scrub on close.
  - `src/main/register-overlay-ipc.js` `menu-overlay:vault-capture-save` (~279): the handler being retired, whose guards the new channel strengthens.
- **Spikes P1/P2 run at this leg's landing, on the real surface, with the operator** (Flight Director deviation; see the flight log). The find overlay already proves a content-sized view over a live guest renders on WSLg. P1's fallback is localized because the manager takes a `pointerInside` boolean from a single seam (AC9). P3 is recorded **unverified** (no screen reader; flight Prerequisites).

## Inputs
- Clean branch `sortie/06-non-blocking-save-prompt` off `main` `7cdbb4e`. Only planning artifacts are uncommitted (`sorties/06-…/`, `tests/behavior/save-prompt-non-blocking.md`).
- `src/main/vault/vault-human.js`:
  - `dropCapture` (~306): the single zeroizing choke point;
  - `captureFinalize` (~1463), `captureSave` (~1540), `captureDismiss` (~1708), `dropCapturesForTab` (~1738), `dropCapturesForWindow` (~1763), `dropAllCaptures` (~1778).
- Offer send sites:
  - `src/main/guest-wiring.js` (~746): `sendToChrome('vault-capture-offer', { captureId, model })` in `did-navigate`, with `wcId` in scope;
  - `src/main/register-browser-ipc.js` (~299): `guest-vault-gesture-settle`, `wcId = event.sender.id`.
- `src/main/register-browser-ipc.js`: `vault-capture-dismiss` (~309) and `vault-capture-finalize` (~322), both unchanged in this leg.
- `src/main/register-tab-ipc.js`:
  - `tab-create` attach `addChildView` (~251);
  - `tab-close` `dropCapturesForTab` (~354);
  - move re-parent `addChildView` (~672);
  - `tab-hide` (~1044, overlay hides ~1063);
  - `tab-set-active` (~1186): guest re-add ~1238, find fan-out ~1257-1273, the squawk-0100 block ~1278-1311;
  - `tab-set-bounds` (~1342, fan-out ~1371-1376).
- `src/main/html-fullscreen.js` `enter` (~97; overlay hides ~129-130).
- `src/main/main.js`:
  - `onLock` (~979-998): `dropAllCaptures` runs BEFORE `closeVaultCredentialSheetsOnLock`;
  - `captureWindow` sheet/find layers (~785-850);
  - both `createEngine` sites (~1525-1556, ~1586-1591);
  - `vaultCaptureSave` delegate (~2205).
- `src/main/window-registry.js`: `isSheetContents` (~245), `sheetMenuFor` (~260), the record shape (~63/~108).
- `src/main/automation/resolve.js` `resolveContents` (~150-275): the secret-sheet guard ~216, the non-tab admin exemption ~247-272.
- `src/main/window-census.js` `buildWindowCensus` (~125).
- `src/renderer/chrome/vault-controller.js`:
  - `OCCLUSION_CLOSE_REASONS` (18), `pendingCaptureId` / `sheetOpen` / `presentationQueue` / `pendingCaptureUnlock` (~86-107);
  - `openCaptureSheet` (~156), `reportNoCaptureOffer` (~175), `dismissQueuedOffers` (~195), `advance` (~214), `onVaultCaptureOffer` (~448), `onVaultLockState` (~484);
  - the `'vault-capture'` overlay state (~546), `handleClosed` (~770; `vault-capture` branch ~831).
  - `handleClosed` receives EVERY menuType via `overlay-dispatch.js` `handleClosed` → `vaultHandleClosed` (~402-420).
- Sheet-side retirement targets:
  - `src/renderer/menu-overlay.js`: import line 69, template block ~1160-1230, `TEMPLATES` kind map ~2866/~2881, object-model dispatch ~3006, `vault-capture` branch ~3101;
  - `src/renderer/menu-overlay.html:33`;
  - `src/renderer/menu-overlay.css` ~1043-1100;
  - `src/preload/menu-overlay-preload.js:101`;
  - `src/renderer/menu-overlay-globals.d.ts` ~68-75;
  - `src/main/register-overlay-ipc.js` ~61 and ~275-292.
- `src/shared/vault-capture-template.js`: `KIND_TABLE`, the shell builder (~93-140, `#sheet-vault-capture`, `aria-modal`), the field/choice builders (~169-240).
- Fixture: `tests/behavior/fixtures/vault-login/{index.html,build-fixtures.mjs,README.md}`. `index.html`'s submit is `preventDefault()`ed at line ~77. The builder seeds a Login for the fixture origin in each jar's vault.
- Line budget: `src/renderer/renderer.js` is 1504 against a 1505 budget (`test/helpers/renderer-line-budget.js`).

## Outputs
- NEW `src/main/save-prompt-manager.js`: CJS, Electron-free, injected deps, `node --test`-able. One instance per window, on `rec.savePrompt`.
- NEW `src/main/save-prompt-geometry.js`: pure; `computeSavePromptBounds({ guest, anchorRightDip, findVisible, contentHeight })`.
- NEW `src/main/register-save-prompt-ipc.js`: the chrome→main `save-prompt:open` / `save-prompt:anchor` and page→main `save-prompt:pointer` / `:focus` / `:height` / `:dismiss` / `:save` handlers.
- NEW `src/shared/save-prompt-close-effects.js`: pure ESM, required by both main (Node ≥22 `require(esm)`) and the chrome. `savePromptCloseEffects(reason)` and the exported reason set.
- NEW `src/renderer/save-prompt.html`, `save-prompt.js`, `save-prompt.css`, `save-prompt-globals.d.ts`.
- NEW `src/preload/save-prompt-preload.js`: narrow, exposes `window.savePrompt` only.
- NEW `src/renderer/chrome/save-prompt-client.js`: the chrome-side opener, anchor measurement and close sink. It is constructed inside `vault-controller.js`, never in `renderer.js`.
- Modified:
  - `vault-human.js`: an `onCaptureDropped` dep;
  - `guest-wiring.js` and `register-browser-ipc.js`: offers carry `wcId`;
  - `register-tab-ipc.js`, `html-fullscreen.js`, `window-factory.js`, `window-registry.js`, `window-census.js`, `main.js`, `resolve.js`, `mcp-tools.js` (the `enumerateWindows` description), `chrome-preload.js`, `renderer-globals.d.ts`, `vault-controller.js`, `vault-capture-template.js`;
  - the retirement set above, `eslint.config.mjs` (if the new page script needs a module-`sourceType` entry), `csp-pins.test.js`.
- Tests (new): `save-prompt-manager.test.js`, `save-prompt-geometry.test.js`, `save-prompt-ipc.test.js`, `save-prompt-close-effects.test.js`, `save-prompt-client.test.js` (or folded into `vault-controller-capture.test.js`), `save-prompt-automation-guard.test.js`, `save-prompt-css-drift.test.js`.
- Tests (rewritten, never silently deleted): `vault-capture-template.test.js`, `vault-controller-capture.test.js`, `modal-card-controller.test.js`, `vault-capture-handler.test.js`, `window-census.test.js`, plus any test the retirement breaks (`seam-contract.test.js`, `guest-wiring.test.js`, `register-browser-ipc.test.js`, `vault-capture-drop-safety.test.js`; grep them).
- Fixture: `tests/behavior/fixtures/vault-login/capture.html` and `landed.html` (or one page with a mode query), plus README.
- Spec: `tests/behavior/save-prompt-non-blocking.md` preconditions corrected per AC22.
- Docs: `docs/vault.md`, `docs/renderer-menu.md`, `docs/mcp-automation.md`, `CLAUDE.md` (AC24).

## Acceptance Criteria

**Close-effects table (`save-prompt-close-effects.js`, pure)**
- [x] AC1 `savePromptCloseEffects(reason)` returns a frozen `{ dismissShown, advance, dropTabQueue, clearQueue, refocusGuest }` for every DD6 reason. The reasons are: `saved`, `dismissed`, `timeout`, `expired`, `unlock-requested`, `unlock-abandoned`, `tab-switch`, `tab-hide`, `tab-close`, `tab-moved`, `teardown`, `vault-lock`.
  - Unknown, `undefined` or `'constructor'` map to the `dismissed` row, via an `Object.hasOwn` lookup.
  - `refocusGuest` is `false` for every reason in this leg. Leg 3 sets it for `saved`/`dismissed`, when the prompt held focus.
  - `vault-lock`: `dismissShown` is `false`, because `dropAllCaptures` follows; the manager still sets `settling` so AC6 cannot fire.
  - `unlock-requested` and `unlock-abandoned` are present now, so Leg 2 consumes the table rather than editing its shape.
  - A drift test asserts that the manager's emitted reasons and the chrome client's handled reasons are both subsets of the exported set, using the source-scan flavor that throws rather than passing vacuously.

**Manager (`save-prompt-manager.js`, `save-prompt-manager.test.js`)**
- [x] AC2 **Lazy, never focused.**
  - The view is created on the first `present()`. Before that, `isVisible()` and `isPaused()` return `false` and `getView()` returns `null`, and none of them throws.
  - `present()` delivers `save-prompt:init` to the page and shows the view only after the page reports `:height` for THAT token. No stale-size or blank flash: the first paint is already the right size.
  - Showing is `addChildView` after the active guest. The manager NEVER calls `webContents.focus()`; a fake view whose `focus` throws stays green across the whole suite.
  - Destroyed-recreate guard and `render-process-gone` self-teardown, as in the find overlay.
  - **First-load queue** (the sheet manager's `did-finish-load` pending-init precedent, `menu-overlay-manager.js` ~296-310): an init sent before the page is ready is held and delivered on load.
  - **Height fail-safe**: if no `:height` arrives for the token within `SAVE_PROMPT_SHOW_FALLBACK_MS` (1500, exported), the view shows at height 160 (clamped).
  - If the page has crashed or failed to load, the manager closes the prompt `dismissed` instead, so the shown capture is dropped. Unit-pinned both ways.
- [x] AC3 **One prompt per window, one token.**
  - `present({ token, captureId, wcId, model, anchor, queue })` while visible model-replaces. The manager is the single holder of `{ token, captureId, wcId }`.
  - Every page→main message carrying a token ≠ the current token is dropped.
  - `close(reason)` is idempotent. It sends `save-prompt:clear` (the eager scrub) BEFORE `removeChildView`, and it emits exactly one `save-prompt-closed { token, captureId, reason }` to this window's chrome.
- [x] AC4 **Timer (DD4), MockTimers recipe.**
  - `SAVE_PROMPT_TIMEOUT_MS === 10_000` is exported. Expiry closes with `timeout`, and its effects run `dismissShown` → `vaultHuman.captureDismiss(captureId)`.
  - Four independent pause inputs: `pointer`, `focus`, `windowBlur` (blur or minimize), `sheet`. The timer is paused while ANY is true, and resume restores the remaining time.
  - Each `present()` starts a fresh 10 s, independent of pause state.
  - Every state change pushes `save-prompt:timer { remainingMs, paused }`, so the page animates the bar with no per-tick spam.
  - A test per input: pause at 4 s, advance 60 s, still visible, resume, close at +6 s.
  - Plus a combined test: two inputs on, one off, still paused.
  - Plus the DD1 reverse-race pin: the sheet becomes visible while the prompt is visible, the sheet closes, and the prompt resumes with its remaining time.
- [x] AC5 **Result states (DD6).**
  - `showResult(kind, text, holdMs, closeReason)` renders a `role="status"` state in the same view and starts no new 10 s.
  - After `holdMs` (success 2500, failure/expired 4000) it closes with `closeReason`, and the hide is deferred one macrotask after the last resize (squawk 0100).
  - A pointer or focus pause does NOT hold a result state open. Unit-pinned.
- [x] AC6 **Main-side drop → expired (DD6).**
  - When `onCaptureDropped({ captureId })` names the SHOWN capture and the prompt is not already settling, the manager shows "This save request expired" (4 s) then closes `expired`.
  - Settling is set before the manager itself calls `captureSave` or `captureDismiss`, so the prompt's own save/dismiss/timeout drop NEVER triggers the expired state. Pinned: a successful save → `saved`, never `expired`.
  - Drops of non-shown ids are ignored by the manager; the chrome handles its queue (AC14).
- [x] AC7 **Sheet-open and fullscreen refusal (DD1/N4).** `present()` creates, shows and queues nothing, and returns:
  - `{ presented: false, reason: 'sheet-open' }` when the injected `isSheetVisible()` is true;
  - `{ presented: false, reason: 'fullscreen' }` while the window holds HTML fullscreen (injected `isFullscreen()`);
  - otherwise `{ presented: true }`.

  Note that "sheet visible" includes the suggestions dropdown and the downloads popup, so a refused head retries on every suggestions close. That is intended: `advance()` is cheap and idempotent.
- [x] AC8 **Squawk-0100 ordering and z-order.**
  - `close('tab-switch')` completes its `removeChildView` BEFORE `findOverlay.syncBounds` / `sheet.syncBounds` in the `tab-set-active` fan-out. It keys on the OUTGOING `owner.activeTabWcId`, which is reassigned only at ~1302, and is hoisted AHEAD of the find block (~1257), because `switching` is computed later (~1291).
  - Same-tab re-activation re-raise order is: guest re-add (~1238) → find re-show → **prompt `syncBounds(rounded)` (gated `!fullscreenSameTab`) + `show()`** → `sheet.show()` (~1296-1299) → tear-off re-show (~1315). The prompt is never above an open sheet or the tear-off pill.
  - A call-order test on the handler pins both orders, using recorded fakes in the `register-tab-ipc` test-harness style.
  - A `:height` report is applied only while visible and is never applied in the tick of a hide.
- [x] AC9 **Pointer seam (P1 fallback-ready).** Pointer-inside reaches the timer through exactly one manager method (`setPointerInside(bool)`). The page's `pointerenter`/`pointerleave` is today's only caller, so a later main-side cursor-point hit test can replace the source without touching timer logic.

**Geometry (`save-prompt-geometry.js`, pure)**
- [x] AC10 `computeSavePromptBounds` returns integer DIP bounds:
  - width `min(340, guest.width − 16)`;
  - height `clamp(contentHeight, 80, guest.height − 16)`;
  - top `guest.y + 8`, plus `56` when `findVisible`;
  - right edge = `anchorRightDip` when it is a positive finite number, else `guest.x + guest.width − 12`;
  - x clamped so the card stays inside `[guest.x + 8, guest.x + guest.width − 8]`.
  Tests cover the anchor present/absent/zero/NaN cases, find-bar stacking, a guest narrower than 356, and a guest shorter than the content.
- [x] AC11 **Anchor freshness.** The chrome measures `#vault-indicator`'s `getBoundingClientRect().right` in CSS px. MAIN converts it to DIP with the chrome webContents' LIVE `getZoomFactor()`; no chrome-supplied scale is trusted.
  - The client sends the anchor with `open` and re-sends it via `save-prompt:anchor` while a prompt is presented. Triggers: a `ResizeObserver` on the indicator (this covers `applyToolbarPins` hiding it, since size → 0) and a window `resize` listener (this covers chrome zoom and window resizes). The listeners are idle while no prompt is presented.
  - `tab-set-bounds` on the active tab calls `savePrompt.syncBounds(rounded)`: store always, apply while visible.
  - Cache contract: source of truth = the indicator's live rect plus the active guest's bounds; rebuild triggers = those two events; max staleness = one event.

**Main wiring**
- [x] AC12 **Offers carry `wcId` and are gated main-side to the active tab (DD5).**
  - At BOTH send sites, the offer is `{ captureId, model, wcId }`, with `wcId` the guest's id.
  - When `wcId !== ownerRecord.activeTabWcId` at release, main calls `captureDismiss(captureId)` and does NOT send. This replaces a chrome-side arrival check, so `renderer.js` gains no lines.
  - One test per site, sending and not sending (`guest-wiring.test.js:685-748`, `register-browser-ipc.test.js:461,477-478`; their exact `deepEqual`s are updated).
  - `save-prompt:open` gate 2 (AC17) stays the backstop.
  - Known DD5 consequence, documented in `docs/vault.md` and the HAT: a login whose submit opens a foreground new tab loses its offer, because the original tab is no longer active when it releases.
- [x] AC13 **Hide/restore matrix + tab drops (DD1/DD5).** Each row is a handler-level test.

  Re-raise the prompt above the guest when it is visible, strictly after the guest re-add:
  - `tab-set-active` same-tab re-activation (~1238);
  - `tab-create` attach (~251).

  Drop, closing the prompt BEFORE any `dropCapturesForTab` / bounds sync so its close reason wins over AC6's `expired`, then `vaultHuman.dropCapturesForTab(outgoingWcId)`:
  - `tab-set-active` switching → close `tab-switch`;
  - `tab-hide` → `tab-hide`;
  - `html-fullscreen.js` `enter` → `tab-hide`;
  - `tab-close` → `tab-close`, placed before the existing ~354 drop;
  - move/tear-off/adopt-by-drop of the prompt's tab → `tab-moved`. ONE insertion in `moveTabIntoWindow` (~609-790), on the SOURCE window, beside the find-session close (~620) and before `htmlFullscreen.forceExit(source)` and the re-parent (~671). Captures for the moved tab ARE dropped: DD5 lists "tab moved to another window".
  - move into a TARGET window that deactivates its previous active tab (~762-776) → the target's prompt closes `tab-switch` at the existing `target.sheet?.closeMenuOverlay('tab-switch')` site, and that previous tab's captures drop.
  - window `close` → `teardown`. This is the FIRST statement of `window-factory.js`'s `close` handler: before `authChallenges.cancelForWindow`, before `releaseVaultHoldsForWindow` and before any capture-dropping call. Then `savePrompt.teardown()`, and `rec.savePrompt = null` beside the other three overlay slots (~347-351). No raw `.on('closed'` (`window-closed-invariant.test.js`); the window id is captured at create time.
  - chrome renderer gone (`chrome-recovery.js` `onChromeGone`): a new `closeSavePrompt` hook (typedef ~94, destructure ~99, supplied at `window-factory.js` ~303-315, read at call time) runs BEFORE BOTH early returns, `ignored` (~101-109) and `paused`, then closes `teardown`. `chrome-recovery.test.js` is updated.
  - Use ONE helper, e.g. `closeSavePromptAndDrop(owner, wcId, reason)` in `register-tab-ipc.js` and exported for `html-fullscreen.js`, rather than six hand-copied insertions.
  - `html-fullscreen.js`: `createHtmlFullscreen` (~38) gains a lazy `vaultHuman` getter dep, via the `main.js` ~1763 construction. `html-fullscreen.test.js` supplies it or tolerates its absence.

  The helper's prompt close is a no-op when the prompt shows a tab other than the outgoing one, while its `dropCapturesForTab` still runs. Navigation inside the tab does not close the prompt or drop captures; pinned with a `did-navigate` on the prompt's own tab. A drop for a tab the prompt does NOT show still runs `dropCapturesForTab` for the outgoing tab.
- [x] AC14 **`vault-capture-dropped` push (DD6).**
  - `vault-human.js` gains an optional `onCaptureDropped({ captureId, wcId, offered })` dep, invoked from `dropCapture` after eviction and zeroization, inside a `try/catch` so a throwing listener can never block the zeroize. `rec.wcId` is read before eviction.
  - `offered` is a new non-secret record flag. `captureRelease` (~1014) sets it on the NEW record (`captures.get(outcome.captureId)` after dispatch) for each released offer. `captureFinalize` keeps the same id. Pending-settle ids that are re-keyed (~1036-1073) are never `offered`.
  - `dropCapture` reads `rec.wcId`, `rec.offered` and the optional `cause` BEFORE `captures.delete` (~311).
  - A record AC12 dismisses main-side was flagged `offered` but never sent. Its push is a harmless extra (unknown id → no-op), and this is accepted.
  - **Supersession**: the per-family supersession calls (~748, ~843, ~901, ~954, ~1206, ~1405) pass `cause: 'superseded'`, and the manager closes a superseded SHOWN prompt silently with `dismissed`. No "expired" flash: the newer offer queues behind it.
  - Routing lives in its own module, `src/main/save-prompt-drop-router.js` (`routeCaptureDropped({ captureId, wcId, offered, cause }, { managerForTab, chromeForTab })`), wired in `main.js` and unit-tested without a manager. It returns quietly when the owner record, manager or chrome is null (tab-close, move and window-close drops), and that is pinned. It routes two ways:
    - to the owning window's manager (AC6), always;
    - owner-routed at event time via `getChromeForTab(wcId)` as `vault-capture-dropped { captureId }`, ONLY when `offered`. Class 3 per CLAUDE.md; never a fan-out. It tolerates a null chrome during teardown.
  - The chrome removes the id from `presentationQueue` and `pendingCaptureUnlock`. An unknown id is a no-op.
  - Tests:
    - the dep fires once per drop path: TTL, dismiss, save (including `captureSave` early failures such as a card update with no existing item), supersession, re-key, finalize, tab, window, all;
    - `offered` is correct on each;
    - a throwing dep still zeroizes;
    - the router call-through.
- [x] AC14b **Capture↔tab binding is main-verified.** `vault-human.js` exposes a metadata-only `captureTabOf(captureId)` → `wcId | null`. `save-prompt:open` requires `captureTabOf(captureId) === wcId`, and `:save` requires it to equal the manager's shown `wcId`. A chrome cannot pair one tab's capture with another tab's id. Tests refuse a mismatch at both channels.
- [x] AC15 **Vault lock (DD6).** The lock path closes every window's prompt with `vault-lock` BEFORE `_vaultHuman?.dropAllCaptures()`, so no prompt flashes `expired` on lock. The chrome applies `clearQueue`.
  - The `onLock` body (or its capture/prompt half) is extracted into a testable function, e.g. `runVaultLockTeardown({ records, vaultHuman, closeSheets, broadcast })`. A test drives it with spy managers and a spy `dropAllCaptures`, and asserts the call order.
  - A source pin asserts that `main.js`'s `onLock` calls that function (regex-target, wrap-insensitive, `assertMutated`).
- [x] AC16 **Window focus and sheet visibility pause inputs.**
  - `window-factory.js` feeds `windowBlur` from EVENTS only: `win` `blur`/`minimize` → true, `focus`/`restore` → false.
  - The initial value is `false`, never seeded from `win.isFocused()`. That call is unreliable under WSLg/dev-launch (`window-census.js` header). A missed pause costs at most a prompt timing out, while a stuck pause would hold a credential for the whole 2-minute TTL.
  - A TTL drop while paused → AC6 `expired`.
  - It feeds `sheet` through a new optional `menu-overlay-manager.js` dep, `onVisibilityChanged(visible)`. It is called at EVERY site that assigns `visible`: init ~189, teardown ~269, destroyed-recreate ~282, `show()` ~330, `hide()` ~343 and the cross-window model-replace detach ~402. It is deduped to real changes, since `show()` re-runs on each re-raise. No existing behavior changes, and `menu-overlay-manager.test.js` stays green plus new cases.
  - A `window-factory.test.js` case fires the fake `win` `blur`/`focus`/`minimize`/`restore` events and fake sheet visibility, then asserts the manager's `isPaused()`: the real trigger, not a direct call.
  - The existing `win.on('blur', () => sheet.closeMenuOverlay('blur'))` is untouched.

**Channels (`register-save-prompt-ipc.js`, `save-prompt-ipc.test.js`)**
- [x] AC17 **Chrome→main.**
  - `save-prompt:open` is an invoke with payload `{ token, captureId, wcId, model, anchor, queue }`. Gates in order:
    1. Sender = a registered chrome (`registry.getWindowForChrome(event.sender)`), with `rec.savePrompt` non-null (null after teardown → `{ presented:false, reason:'gone' }`).
    2. `wcId` is THAT window's `activeTabWcId`; else `{ presented:false, reason:'not-active' }`.
    3. **Offer models only**: `captureTabOf(captureId) === wcId` (AC14b); else `{ presented:false, reason:'not-active' }`. A result-only model is shown after `captureFinalize` has already dropped the record (`vault-human.js` ~1469/~1491/~1495), so it skips this gate and needs only gate 2. Its `wcId` comes from the chrome's queued entry: the chrome stores `wcId` alongside every `pendingCaptureUnlock` id from the offer. Result models carry no secret and grant no write. Tests: a result-only open for a dropped id is presented; an OFFER open for a dropped id is refused.
    4. The model is shape-checked against an explicit allowlist: an offer-model key set, OR a result-only model `{ result: 'unchanged'|'expired'|'tab-changed'|'locked'|'error' }` used by the interim locked path. Unknown keys are stripped, and secret field names from `vault-item-schema.js` are refused.
    5. `present()`. That covers `sheet-open` and `fullscreen` (AC7).
  - The chrome treats `not-active`, `fullscreen` and `gone` as drop (`vaultCaptureDismiss` + advance), and `sheet-open` as keep-head.
  - `save-prompt:anchor` is a send with `{ token, right }`. Sender = that chrome; the token must be current.
  - Each gate is refused in isolation by a test.
- [x] AC18 **Page→main.** `:pointer { token, inside }`, `:focus { token, inside }`, `:height { token, height }`, `:dismiss { token }` and `:save { token, captureId, vaultId }`. Every handler resolves the window by webContents identity. `recordForOverlaySender` is a closure inside `registerOverlayIpc` (`register-overlay-ipc.js` ~128) and is not exported. **Extract** it to `window-registry.js` as `registry.recordForOverlaySender(sender, key)` (keys `'sheet'`, `'findOverlay'`, `'savePrompt'`), and have `register-overlay-ipc.js` delegate to it with no behavior change, keeping its existing tests green. The new module uses the registry method.
  - `:save` is an invoke carrying four guards in order, each refused in isolation:
    1. Sender identity.
    2. Token freshness.
    3. Kind: the prompt is in its OFFER state, not a result state, and the model is not `locked`.
    4. Business gate: `captureId === manager.currentCaptureId`, the capture's tab is still the window's active tab, then `vaultHuman.captureSave({ captureId, vaultId })`.
  - **In-flight guard**: the manager flips to a `saving` state SYNCHRONOUSLY before calling `captureSave`, so a second `:save` (double-click) fails guard 3. Tested.
  - On `{ saved:true }` → success result "Password saved to {vault label}" (card/identity nouns per `KIND_TABLE`), then close `saved`.
  - On `{ saved:false, reason:'locked' }` → "Vault locked — not saved" → close `dismissed`.
  - On `{ saved:false }` with the record gone → the expired result → close `expired`.
  - A `captureSave` throw → "Couldn't save to that vault" → close `dismissed`.
  - `:dismiss` → close `dismissed` → `captureDismiss`.
  - `:height` clamps the value to a finite number in `[0, 4000]`.

**Chrome (`save-prompt-client.js` + `vault-controller.js`)**
- [x] AC19 **Queue on the prompt (DD6).**
  - `openCaptureSheet`, `sheetOpen`, `OCCLUSION_CLOSE_REASONS`, `dismissQueuedOffers`' occlusion caller, `reportNoCaptureOffer`'s toasts and the `'vault-capture'` overlay state are removed or retargeted.
  - `advance()` stays the single opener, idempotent on `promptOpen`.
  - It pre-checks the overlay `states[*].open` flags and then calls `save-prompt:open`. On `{ presented:false }` the offer stays at the HEAD; `not-active` drops it via `vaultCaptureDismiss`.
  - `handleClosed` for ANY menuType calls `advance()`, so a refused head retries when any sheet closes.
  - `onVaultCaptureOffer`: the active-tab check lives main-side (AC12), and the chrome adds none. `renderer.js` is not touched beyond the AC24 comment edit.
  - `save-prompt-closed` applies `savePromptCloseEffects(reason)`:
    - `advance` → `advance()`;
    - `dropTabQueue` → remove that `wcId`'s queued entries, without dismiss calls (main's `dropCapturesForTab` already dropped them);
    - `clearQueue` → empty both queues.
  - "1 of N" is sent in `queue`.
  - `finalize` results with no model (`unchanged`/`expired`/`tab-changed`/`locked`) on the interim locked path are presented as a prompt RESULT state, not a toast, through a `save-prompt:open` with a result-only model. The rewritten `vault-controller-capture.test.js` covers every DD6 row plus the deferral retry.
- [x] AC20 **Vault choice labels (DD9).** The client maps `choices` to `{ vaultId, label }` as `openCaptureSheet` did. A jar id that no longer resolves in `jarsClient.containers` becomes `{ vaultId, label: 'Unknown vault', disabled: true }`; it is not selectable, and main still validates.
- [x] AC21 **Interim locked path, end to end in unit tests.** With a locked offer arriving: the unlock sheet opens with `keepFocus`, no prompt is presented, and nothing is written. After unlock, `advance()` → `vaultCaptureFinalize` → the resolved model goes to `save-prompt:open`; if the unlock sheet is still visible the open is refused and retried on its close. An abandoned unlock still drops every queued id (the existing `handleClosed` vault-unlock branch, unchanged).

**Prompt page + security (DD9)**
- [x] AC22 **Page.** `save-prompt.html` is `file://` with a CSP mirroring `menu-overlay.html`'s, pinned in `csp-pins.test.js`.
  - The view is `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`, with only the `save-prompt-preload.js` preload, and has a transparent background.
  - The page:
    - renders through `vault-capture-template.js` builders, adjusted to a non-modal card: root `role="dialog"` with `aria-labelledby`/`aria-describedby` and NO `aria-modal`, no backdrop. `vault-capture-template.test.js` is rewritten to pin this shape;
    - is `textContent` only;
    - reports content height via `ResizeObserver`;
    - sends pointer/focus via `pointerenter`/`pointerleave` and `focusin`/`focusout`;
    - animates the 3 px countdown bar from the pushed `{ remainingMs, paused }` (dims while paused);
    - shows "1 of N";
    - has ✕ and "Not now" → `:dismiss`, and Save → `:save`;
    - empties its DOM synchronously on `save-prompt:clear`;
    - never calls `.focus()`. Source-scan pinned: no `.focus(` in `save-prompt.js` this leg.
  - The model is metadata only: a test feeds a model carrying a secret key and asserts it is stripped main-side (AC17) and that the page never reads it.
  - The mockup is the visual reference; exact pixels are tuned at the HAT.
- [x] AC23 **CSS↔builder drift guard (N11).** `save-prompt-css-drift.test.js` collects every `className` the template builders assign, and asserts each class appears as a selector in `save-prompt.css`. It THROWS if it collects zero classes.
  - `#sheet-vault-capture` and the `.vault-capture-*` rules are removed from `menu-overlay.css`.
  - `menu-overlay.html`'s `vault-capture-template.js` script tag is removed. Its `menu-overlay.js` import is removed only if nothing else in that file uses it.

**Retirement (DD8)**
- [x] AC24 The DD8 removals are done:
  - the `menu-overlay.js` template, `TEMPLATES` entry, kind union member and dispatch branches;
  - `menu-overlay-preload.js` `captureSave` and its `.d.ts` entry;
  - the `menu-overlay:vault-capture-save` handler and the `vaultCaptureSave` injection in `register-overlay-ipc.js` / `main.js`.

  A grep AC lists every remaining hit and judges it exempt or real: `rg -n "vault-capture'|'vault-capture|vaultCaptureSave|captureSave\(|#sheet-vault-capture|vault-capture-save" src test docs CLAUDE.md`. Allowed survivors:
  - `vault-capture-offer` / `-dismiss` / `-finalize` / `-dropped`;
  - `vault-capture-template.js`;
  - `vault-human.js` `captureSave`;
  - historical comments explicitly marked as history.

  Comment/doc retargets:
  - `vault-blur-survival.js` comment;
  - `overlay-dispatch.js:~418`;
  - `renderer.js:~476` (COMMENT ONLY, line count unchanged);
  - `modal-card-controller.js` comments;
  - `main.js:~988-992`, the inaccurate `pendingCaptureUnlock` one-shot comment.

  `modal-card-controller.test.js` and `vault-capture-handler.test.js` are rewritten to the prompt channel; they are not deleted unless every case moved (say which, in the flight log).

  Expected exempt survivors of the grep:
  - `docs/dev-testing.md:191`, the `[vault-capture]` log tag;
  - the `vault-capture-*` class names inside `vault-capture-template.js` and `save-prompt.css`;
  - history notes.

  Other tests touched by the change:
  - `automation-scope.test.js` ~460 and `automation-mcp-tools.test.js` ~1031-1041/~1230: census-row fixtures and description regexes;
  - `csp-pins.test.js`: the new overlay HTML;
  - `window-factory.test.js`, `chrome-recovery.test.js` and `html-fullscreen.test.js`.

  **Behavior specs**: `tests/behavior/vault-capture-save-update.md` steps 2/4 (~60-62) assert the old sheet through `captureWindow` pixels. The prompt is excluded from `captureWindow` (AC25), so those steps would pass vacuously or fail. Retarget them to `enumerateWindows().savePromptVisible` plus by-eye/HAT, or mark them `[by-eye]` with a header note. Check `vault-card-fill-capture.md` and `fixtures/vault-card/drive.mjs` the same way, and record what changed.

**Automation (DD10)**
- [x] AC25 **Fail-closed guard.**
  - `window-registry.js` gains `isSavePromptContents(wc)`. It is true for any window's live prompt view and false when none exists.
  - `resolveContents` throws `automation: save-prompt — … never automatable (any tier)` for it BEFORE the internal and non-tab checks, regardless of `allowInternal` / `allowSheet`.
  - It is threaded into BOTH `createEngine` sites in `main.js`.
  - `save-prompt-automation-guard.test.js`:
    - refuses at jar, admin and admin+`allowSheet` for every op dispatch that resolves contents;
    - checks that an absent injection is still refused at admin, fail-closed by an explicit guard order. If the absence cannot be refused without the predicate, the test pins that both sites inject it via a grep pin modeled on the `isSheetContents` pin;
    - pins that `captureWindow` composites only the find and sheet layers, never the prompt.
  - This guard is **unit-proven only**. No live MCP op can obtain the prompt's wcId, because the census deliberately omits it. Say so in the flight log and do not claim it as live-verified.
- [x] AC26 **Census.**
  - `enumerateWindows()` rows gain `savePromptVisible` and `savePromptPaused`, both always present booleans read live from `rec.savePrompt`, `false` when it is null or never created. No `savePromptWcId` is exposed.
  - `window-census.test.js`'s exact-shape `deepEqual`s are updated.
  - The `mcp-tools.js` `enumerateWindows` description and `docs/mcp-automation.md` name both fields.

**Fixture, line budget, behavior test, docs**
- [x] AC27 **Fixture capture mode.**
  - A capture page on the fixture origin has `#username`, `#password` and a submit `#submit` that does NOT `preventDefault`: it navigates (form GET/POST or `location.assign`) to a landing page. The landing page has `<input id="probe">`, a `<button id="bump">` and a visible `#count` incremented per click, starting at `0`.
  - `index.html` is unchanged, because `vault-mcp-surface` relies on it.
  - The README documents capture mode.
  - The behavior spec's precondition "no stored login for the fixture origin" is replaced by "each submit step uses a username AND password unique to the run". That makes the disposition `save` regardless of the seeded items. The spec's Step 2/6/7 wording is updated to match; the step table's other semantics are unchanged.
  - Verified live at landing (AC29): a trusted `click` on `#submit` after `typeText` navigates, and `did-navigate` releases an offer.
- [x] AC28 After `npm run format`, `src/renderer/renderer.js` is ≤ 1505 lines (`RENDERER_LINE_BUDGET`) and `seam-contract.test.js` is green. `SEAM_COUNT` changes only if an FD-approved seam is added; none is planned this leg.
- [ ] AC29 **Live (Flight Director with the operator, at landing; the Developer does NOT run these).**
  1. Apparatus probe: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` on a throwaway profile; `connectAutomation()` env-key script; every existing apparatus primitive (`enumerateWindows`, `enumerateTabs`, `openTab`, `evaluate`, `readDom`, `click`, `typeText`, `captureWindow`) exercised against the new state, plus `savePromptVisible`/`savePromptPaused`.
  2. P1 and P2 by eye.
  3. `/mission-control:behavior-test save-prompt-non-blocking`, Variant A.
  4. **Interim locked path, by eye**: a locked submit → the unlock sheet auto-raises → unlock → the offer appears in the CORNER prompt, not the old sheet → Save writes.
  - Anchor freshness checks (pin-toggle hides the indicator, chrome zoom, window resize) are by-eye and deferred to the HAT leg.

  The Developer's job is to make these runnable. The FD records the results in the flight log.
- [x] AC30 **Docs.**
  - `docs/vault.md`: the save moment presents in the corner prompt, the close table, the interim locked path note.
  - `docs/renderer-menu.md`: `vault-capture` removed from the template list, and a pointer to the save-prompt view.
  - `docs/mcp-automation.md`: the census fields, and the prompt as unobservable.
  - `CLAUDE.md`:
    - "Password vault" → "Save moment": "the chrome presents offers one sheet at a time (resolution-class close advances, occlusion-class drops the queue)" becomes the prompt queue rule.
    - The "Menu-overlay sheet" section names the prompt as a separate per-window view.
    - The standing unobservable-surfaces list gains the save-prompt view: presence via census only, content and input unobservable at every tier.
    - The "Non-obvious gotchas" find-overlay line mentions the prompt as the third overlay view.
- [x] AC31 `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` all pass. Run tests with a timeout (`node --test --test-timeout=60000`, or the project's script plus `timeout 900`).

## Verification Steps
- AC1-AC26: `npm test` with the named test files. Run each new file alone first: `node --test --test-timeout=60000 test/unit/save-prompt-*.test.js`.
- AC24: run the grep and paste the judged hit list into the flight log.
- AC28: `npm run format && wc -l src/renderer/renderer.js`.
- AC29: Flight Director live session at landing, after the Developer signals `[LAND:leg]`.
- AC31: the four commands.

## Implementation Guidance

**Work in three phases.** Run `npm test` and `npm run typecheck` green at the end of each before starting the next:
- **Phase A, additive**: steps 1-5. The old sheet and its tests still pass, and the app works with an unused prompt path.
- **Phase B, the flip**: steps 6-7 together. Retiring `openCaptureSheet` and rewriting `vault-controller-capture.test.js` are coupled.
- **Phase C**: step 8, `npm run format`, the four gates and the AC24 grep.

Wiring locations (design review 1):
- `createFindOverlayView` is in `window-factory.js` ~83-93.
- `paths.findPreload` / `paths.findHtml` are in `main.js` ~1833-1834, in the `createWindowFactory({ paths })` call at ~1822; factory deps are at ~1845. Add `createSavePromptManager`, `savePromptPreload` and `savePromptHtml` there, optional/defaulted so `window-factory.test.js` fakes still construct.
- `window-registry.js` gets `savePrompt: null` in the typedef (~55-70) and in `create()` (~100-108).
- `src/preload/save-prompt-preload.js` is added to `eslint.config.mjs`'s commonjs preload list (~36-38), beside `find-overlay-preload.js`.
- Main may `require()` `src/shared/save-prompt-close-effects.js` directly, as an established pattern (`menu-overlay-manager.js` ~128).

1. **Pure pieces first**: `save-prompt-close-effects.js` (+ test), `save-prompt-geometry.js` (+ test).
2. **Manager** with fakes (+ test): the AC2-AC9 state machine. Model it on `find-overlay-manager.js`'s lifecycle and header-comment style: cache contract, lifecycle, sole-destroy note. Deps (suggested):
   - `getContentView`, `createView`, `getActiveGuestBounds`, `isFindVisible`, `isSheetVisible`, `computeBounds`;
   - `chromeZoomFactor()`;
   - `sendToChrome(channel, payload)`;
   - `captureSave`, `captureDismiss`;
   - `now` / `setTimeout` / `clearTimeout`.
3. **Page + preload + CSS**:
   - Build the card from the template builders; add the non-modal adjustment in `vault-capture-template.js`.
   - The view construction (`createSavePromptView`) lives beside `createFindOverlayView`: find where `createFindOverlayView` and `paths.findPreload` are defined (`main.js` ~1833) and mirror them.
4. **IPC module**, registered beside the other `register-*-ipc` modules from `main.js`.
5. **Main wiring**:
   - `window-factory.js` construction plus close order; the pause feeds;
   - the `register-tab-ipc.js` matrix (closing BEFORE the fan-outs);
   - `html-fullscreen.js`;
   - `main.js` `onLock` order, the `onCaptureDropped` routing, the engine sites;
   - the census;
   - offers `wcId`.
6. **Chrome**:
   - `save-prompt-client.js`;
   - `vault-controller.js` queue retarget;
   - `chrome-preload.js`: `savePromptOpen`, `savePromptAnchor`, `onSavePromptClosed`, `onVaultCaptureDropped`; plus the `renderer-globals.d.ts` entries.
   - Construct the client INSIDE `createVaultController`, so `renderer.js` gains no lines. No active-tab getter is needed, because AC12 gates main-side.
7. **Retirement (DD8)** and test rewrites.
8. **Fixture + spec + docs.**
9. **Format, then all four gates.**

## Edge Cases
- **The prompt's own drop vs `expired`** (AC6): settle first, then call into vault-human.
- **Lock while a result state shows**: close `vault-lock` immediately, cancelling the result timer.
- **Offer for the active tab arriving while a result state shows**: it queues, and `advance()` runs on that result's close.
- **Two windows**: prompt A ignores window B's blur, focus, sheet and tab events (per-instance closures). The vault-lock fan-out is the only cross-window close. Test with two manager instances.
- **Chrome renderer crash** (`chrome-recovery.js`): close the prompt with `teardown`; the chrome's queue is gone with its renderer. Add `closeSavePrompt` beside `hideFind` in the `onChromeGone` call, if that hook list exists there.
- **Prompt renderer crash**: self-teardown; treat it as `dismissed` (drop the shown capture) and emit `save-prompt-closed`.
- **A `:height` arriving after close for the old token**: dropped by the token check.
- **The welcome (viewless) tab** never produces offers. No special case is needed.
- **An offer for a burner or internal tab** cannot arise: main never captures there. Don't add a branch.
- **Verbatim-extraction TDZ** (CLAUDE.md checklist): anything referenced above its construction site in `window-factory.js` / `vault-controller.js` needs a getter. `record.savePrompt` is read at CALL time, as `record.sheet` is.

## Files Affected
See Outputs.

---

## Post-Completion Checklist
Completion steps (status transitions, flight-log update, checking off in the parent flight, and commit) are Flight Control protocol, driven by the execution workflow. They are not repeated here.

## Citation Audit
Checked against `sortie/06-non-blocking-save-prompt` at `7cdbb4e` (2026-11-04):
- All `vault-controller.js`, `vault-human.js`, `register-browser-ipc.js`, `guest-wiring.js`, `register-tab-ipc.js`, `html-fullscreen.js`, `window-factory.js`, `resolve.js` and `window-census.js` anchors were re-read this session; line numbers are current to ±3.
- Flight DD citations corrected:
  - the `main.js` onLock order is `dropAllCaptures` then `closeVaultCredentialSheetsOnLock` (~996-997), which drives AC15;
  - overlay construction lives in `window-factory.js`, not `main.js`;
  - the census also exposes `sheetWcId`/`findWcId`, while the prompt deliberately exposes no wcId.
- `createFindOverlayView` / `paths.findPreload` were located at `main.js` ~1833 only by grep, so the Developer confirms them.
- `menu-overlay-manager.js` show/hide hook availability (AC16) is not verified, so the Developer confirms it.

**Design review 1** (Developer, Sonnet, 2026-11-04): approve with changes. All items are folded in:
- the target-window close on move (AC13);
- re-activation z-order and `syncBounds` (AC8);
- the `html-fullscreen` dep and fullscreen refusal (AC7/AC13);
- the event-only `windowBlur` (AC16);
- the height fail-safe (AC2);
- real-trigger tests for lock order, drop routing and blur (AC14/AC15/AC16);
- the main-verified capture↔tab binding (AC14b);
- the main-side active-tab gate in place of a `renderer.js` line (AC12);
- `offered`-only drop pushes (AC14);
- teardown-first close order and `chrome-recovery` early returns (AC13);
- `recordForOverlaySender` reuse (AC18);
- result-only model allowlist (AC17);
- the eslint preload entry;
- the extra test/spec retargets (AC24);
- the interim-locked live step (AC29);
- phased implementation order;
- corrected wiring locations.

Rulings on its questions:
- (1) moved-tab captures drop;
- (2) a pending-settle loss on a foreground-new-tab login is the accepted DD5 consequence, documented;
- (3) `windowBlur` is event-only, and a TTL drop while paused shows `expired`;
- (4) `present()` refuses during fullscreen;
- (5) the interim locked path gets a by-eye live step;
- (6) the active-tab gate lives main-side.

**Design review 2** (Developer, Sonnet, 2026-11-04, final cycle): approve with changes. Folded in:
- (high) the result-only models skip the capture↔tab gate (AC17);
- `recordForOverlaySender` is extracted to the registry (AC18);
- the `offered` set site, plus reads before eviction (AC14);
- the router module tolerates a null owner (AC14);
- silent close on supersession (AC14);
- the synchronous `:save` in-flight guard (AC18);
- the helper is a no-op for a non-shown tab (AC13);
- `vault-lock` close effects (AC1).
