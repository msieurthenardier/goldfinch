# Sortie: Non-blocking Save Prompt

**Status**: completed

## Charter

### Outcome
When the operator submits a login, card, or identity form, Goldfinch asks "Save …?" in a small corner prompt that never blocks the page. They can ignore it (it goes away after 10 s), dismiss it, or click Save. Save finishes the save, and asks for the master password only when the vault is locked.

### Why Now
Operator report: submitting a form with the vault locked immediately raises the master-password modal (`vault-controller.js` `onVaultCaptureOffer` locked branch, `openOverlayMenu('vault-unlock', …, { keepFocus: true })`), which covers the just-signed-in page and re-grabs focus until it is closed. The unlocked path is modal too (`vault-capture` is a centered `aria-modal` backdrop card on the full-guest sheet). Modern browsers ask non-modally.

### Success Criteria
- [x] With the vault locked OR unlocked, after a form submit the page stays fully usable (click, type, scroll) while the save prompt shows in a corner over the guest.
- [x] Unlocked: Save in the corner prompt saves or updates the item with no further dialog, and a new save still offers the destination-vault choice. Locked: Save opens the unlock sheet, and after a successful unlock the save completes without another blocking dialog.
- [x] ✕ / "Not now", or 10 s with no interaction, removes the prompt and the held credential is discarded on the main side. Nothing stays pending.
- [ ] *(met except the screen-reader announcement — P3 UNVERIFIED, no screen reader; HAT H10/H2 verified keyboard and pause)* The prompt is keyboard-reachable and operable, a screen reader announces it, and the 10 s timer pauses while the pointer or focus is on it.

### Constraints
- **Native-surface rule**: the prompt floats over the guest; it never resizes or moves the guest slot. The sheet stops covering the whole guest for this prompt only; every other menu type keeps today's behavior.
- **Vault security stays as it is**: the prompt carries metadata only and never a secret. The eager close scrub and the close-on-lock rules still apply. The unlock sheet keeps its current dialog behavior; only what triggers it changes.
- **Focus**: the prompt does not take OS focus when it appears.
- **Multiple offers**: login, card and identity offers from one submit still show one at a time.
- **Out of scope**: "Never for this site", a reopen badge on the toolbar icon, and any change to the 2-minute main-side hold (`CAPTURE_DROP_MS`).

> Constraint 1 wording note (DD1): the prompt turns out NOT to live on the menu-overlay sheet at all; it gets its own content-sized view. The constraint's intent — every other menu type keeps today's behavior — holds unchanged.

### Approved Mockup
https://claude.ai/artifact/EZGk1AegmbB1grdKi3wrTc (approved 2026-11-04): the interactive prototype, the "Today" comparison, and the prompt-variants sheet. Choices the operator accepted with the mockup:
- The prompt hangs from the vault toolbar indicator (top-right, over the guest), with a caret.
- It shows the username / card summary / identity field labels, never a masked password.
- The locked prompt offers "Save to" too, so the save completes straight after unlock; the primary button reads **Unlock & save**.
- A thin 10 s countdown bar dims while paused; queued offers show "1 of N".
- A brief "Password saved to {vault}" confirmation appears in the same corner (≈2.5 s, `role="status"`).

---

## Pre-Flight

### Objective
Replace both modal save surfaces — the auto-raised unlock-to-save sheet and the centered `vault-capture` sheet — with one non-blocking, content-sized corner prompt in its own per-window overlay view. The prompt is bound to the tab whose submit produced it, never takes OS focus on appearance, auto-dismisses after 10 s (paused on hover, focus, window blur, and while a menu sheet covers it), and drops the main-side held capture on every non-save close. Unlocked: Save writes directly. Locked: "Unlock & save" records the operator's consent and chosen vault, raises the existing unlock sheet, and after unlock completes a plain save directly, or re-asks non-blockingly when the post-unlock disposition is an update / identity merge.

### Open Questions
- [x] Which lock states get the corner prompt? → **Both** (operator, 2026-11-04).
- [x] Timeout: drop the credential or keep it reopenable? → **Drop** (operator).
- [x] Tab switch while the prompt shows? → **Drop** (operator) → DD5.
- [x] Keyboard reach for a prompt that never takes focus? → **F6** (operator) → DD2.
- [x] Locked save that turns out to be an update after unlock? → **Re-ask in the corner** (operator) → DD7.
- [x] Window blur? → **Prompt stays, timer pauses** (Flight Director; consistent with the M21 F3 operator ruling that pending saves survive blur) → DD4.
- [x] Can the prompt live on the menu-overlay sheet? → **No** → DD1.
- [x] Who owns deferral while a sheet is open? → **The chrome queue** (design review Q1) → DD1/DD6.
- [x] Vault unlocked by another route while a locked prompt shows? → **Convert in place** (finalize without consent, re-present as an unlocked offer, no write) (design review Q2) → DD7.
- [x] Can `CAPTURE_DROP_MS` expire a paused prompt? → **Yes**; main pushes `vault-capture-dropped`, the prompt shows "This save request expired" (design review Q3) → DD6.
- [ ] **Empirical premises — spiked FIRST in the leg that owns them, before the dependent AC is locked** (P3: no screen reader available, so recorded unverified; see Prerequisites):
  - P1 (Leg 1): a content-sized, never-focused `WebContentsView` over the guest receives `pointerenter`/`pointerleave` and clicks on WSLg/Wayland while the window is focused (the find overlay is no precedent — it focuses on show). Fallback: main-side hit test of `screen.getCursorScreenPoint()` against the prompt bounds for the hover pause.
  - P2 (Leg 1): resizing / showing / hiding a transparent content-sized view over a live guest does not flicker or leave stale pixels on WSLg, checked against a cross-platform control (native-surface rule; Divert criterion).
  - P3 (probed in Leg 1, wired in Leg 3): a polite live region in the NON-focused chrome `WebContents` (while the guest holds focus) is announced by the operator's screen reader. `#suggest-status` is no proof (the chrome holds focus there).

### Design Decisions

**DD1 — A dedicated per-window save-prompt view, not the menu-overlay sheet.**
A new content-sized, transparent, chrome-class `WebContentsView` per window (the find-overlay precedent: `find-overlay-manager.js` + `find-overlay-geometry.js`), with an Electron-free manager (`src/main/save-prompt-manager.js`, injected deps, `node --test`-able), a pure geometry helper (`src/main/save-prompt-geometry.js`), its own page (`src/renderer/save-prompt.{html,js,css}`, `file://`, disk-relative imports, own stylesheet — the reused builder's `new-container-inner` chrome classes are re-declared there, not imported from `menu-overlay.css`) and a narrow preload. Created lazily on the window's first presentation; the manager lives on the registry record (`rec.savePrompt`). Not in `tabViews`.
- Rationale: the sheet always matches the full guest bounds (`register-overlay-ipc.js:150-160`, `menu-overlay-manager.js:327,533`) and swallows every click over the guest (`docs/renderer-menu.md:128-131`), so it cannot be non-blocking. And there is ONE sheet per window: any other menu (suggestions while typing, downloads repaint, kebab) would supersede the prompt and — as an occlusion close — drop the capture and the whole queue.
- Trade-off: a third overlay-view kind with its own lifecycle, geometry and close rules — more code than a per-menuType sheet-bounds mode, but no regression risk to the sheet templates that assume full-region bounds. Re-checked against the sortie gate: an instance of an established pattern, not a new subsystem.
- **Deferral is owned by the chrome queue; main is the authority on "a sheet is visible"** (design review 2, N4). `advance()` uses the chrome's `overlay-menus.js` `states[*].open` flags only as a cheap pre-check (they are set at request time and can stick on a refused open). The chrome then calls `save-prompt:open`, and main answers `{ presented: false, reason: 'sheet-open' }` when `rec.sheet.isVisible()`. Main refuses; it never queues. On a refusal the offer stays at the head of the chrome queue. `handleClosed` for ANY menuType, and the `menu-overlay-closed` hook, call `advance()` to retry. This covers main-initiated sheets (`auth-basic` / `cert-picker` via `auth-challenge-present`), which reach the chrome only by push.
- **The reverse race** (an auth challenge or any other sheet raised while the prompt is visible) is covered by DD4's sheet-visible pause. A pinned test asserts the prompt resumes with its remaining time once the sheet closes.
- **Pre-creation**: until a window's prompt view is first created, `savePromptVisible` / `savePromptPaused` read `false` (no throw).
- **A sheet opened over a visible prompt** (address-bar suggestions, kebab, downloads) is added after it and intercepts pointer events over it, so the manager treats `sheet visible` as a timer pause input (DD4); the prompt stays and resumes when the sheet closes. `sheet.show()`'s `hideFindOverlay` does not touch the prompt.
- **Hide/restore matrix** (every guest re-add re-raises the prompt above the guest when it is visible): tab activation re-add (`register-tab-ipc.js:~1238`), tab attach (`:~251`), move-to-window (`:~672`, the prompt is dropped per DD5 first), HTML fullscreen enter (`html-fullscreen.js:~125`) → **drop** (treated as `tab-hide`; the page is taking over the screen), fullscreen exit → nothing to restore. Tear-off overlay shown → prompt unaffected (separate view; tear-off is above). Minimize → pause (DD4). A viewless welcome tab never produces offers.
- **Geometry** (pure, unit-tested): right edge = the chrome-measured vault-indicator right edge translated to window DIP. The chrome sends the anchor with `open` and re-sends it on `tab-set-bounds`, `applyToolbarPins` changes and chrome zoom-factor changes; fallback when the anchor is absent/zero (indicator unpinned/hidden via `applyToolbarPins`, or not yet measured) = guest right − 12. Top = guest.y + 8, plus 48 + 8 when the find bar is visible (find bar = guest right −12, top +8, 380×48). Width 340, clamped to guest width − 16. Height = page-reported content height, clamped to [80, guest height − 16].
- **Squawk 0100 ordering** (call-order unit tests required): on `tab-set-active`/`tab-switch`, the prompt is hidden BEFORE the `findOverlay`/`sheet` `syncBounds` fan-out (`register-tab-ipc.js ~1263-1310`), exactly as the sheet's tab-switch close was reordered. A page-reported `:height` change is applied only while visible and never in the same tick as a hide; a result-state close defers its hide one macrotask after its last resize.

**DD2 — Never focused on show; F6 reaches it (Leg 3).**
The manager never calls `webContents.focus()` on show and the page never calls `.focus()` on mount. The F6 cycle as it really exists: guest F6 is intercepted in the guest's `before-input-event` by `guest-wiring.js` `handleCrossView` (via `src/shared/cross-view-nav.js`), which focuses the chrome and sends `focus-address` (F6) / `focus-chrome-end` (Shift+F6); chrome F6 `focus-content` (`shortcut-controller.js:213`) focuses the guest. With a prompt visible for the window's active tab:
- guest **F6** → prompt (`handleCrossView` gains an injected `savePromptFor(wcId)` dep; when it reports visible, it calls `promptView.webContents.focus()` and focuses the prompt's first control instead of the chrome).
- prompt **F6** → address bar (today's guest-F6 target). Prompt **Shift+F6** → guest.
- chrome **F6** (`focus-content`) → guest, unchanged. Chrome Shift+F6 → unchanged.
- guest **Shift+F6** → chrome end, unchanged (the prompt is "after" the guest in the forward cycle only).
- No prompt visible → every path exactly as today (pinned: `guest-wiring.test.js` per-action payloads, the load-failure/crash `focusLoadFailureHeading` branch).
- Inside the prompt: Tab cycles its controls, Esc = "Not now", Enter activates the focused button. The prompt's `save-prompt:key` channel admits ONLY F6 / Shift+F6 / Esc and is a no-op when the prompt is not visible. Esc works the same whether the prompt was reached by F6 or clicked into.
  - **Leg 3 amendment (R11):** keys are read main-side from the prompt view's trusted `before-input-event` (`src/main/save-prompt-keys.js`); no page→main `save-prompt:key` channel exists. The guest→prompt hop resolves the prompt in-module via `registry.getWindowForGuest(...)?.savePrompt` (no `savePromptFor` dep). Esc is a no-op outside an interactive offer; Shift+F6 into a taken-over tab falls back to chrome `focus-content`.
- **Refocus rule** (design review 2, N3): the guest is refocused via the existing `tab-focus-guest` path, never the chrome, ONLY when all of these hold:
  - the close reason is `saved` or `dismissed` (including Esc);
  - the prompt held focus at close.
  Every other reason never refocuses the guest:
  - `unlock-requested`: the unlock sheet is opened next, with no guest focus in between.
  - `vault-lock`, `tab-*`, `teardown` and `expired`: the tab may be gone, or focus belongs elsewhere.
  - `timeout`: unreachable while the prompt is focused, because focus pauses the timer.
- **Click focus** (N8): a click on the never-focused view natively gives it OS focus, so the DD4 "focus inside" pause input comes from the page's own `focusin`/`focusout` (`save-prompt:focus`), not from F6. When the operator clicks back into the guest, focus has already moved and the prompt does nothing.
- Shared mechanism (CLAUDE.md rule): `cross-view-nav.js`, `handleCrossView`, `shortcut-controller.js` `focus-content`/`focus-chrome-end`, and the load-failure heading target — ACs assert all unchanged when no prompt is visible.

**DD3 — Announced through a chrome-side live region plus the prompt's own status (Leg 3).**
The prompt page root is `role="dialog"` with `aria-labelledby`/`aria-describedby` and NO `aria-modal`; it ALSO renders the announcement text in its own `role="status"` node at mount (cheap backup). The chrome writes one polite announcement to a new visually hidden `#save-prompt-status` (`role="status"`) in `index.html`: "Save password for {origin}? Press F6 to respond." (kind-specific noun). Result states render inside the prompt with `role="status"`.
- Rationale: `#toasts` is chrome DOM under the guest and invisible while a guest shows (`styles.css:1715-1723`; `register-overlay-ipc.js:758-762`); today's `reportNoCaptureOffer` toasts are already effectively silent and are replaced by prompt result states.
- Premise P3 is probed in Leg 1 (15-minute spike); if neither region is announced, the AC degrades to "F6 discoverability + HAT" with the gap recorded — never a focus steal.
- Shared mechanism: `#toasts`, `#media-status`, `#tab-status`, `#suggest-status` — the new region is a sibling, never a wrapper; no existing region's `aria-live` changes (M22 F1 lesson). ACs list all four as unaffected.

**DD4 — Main owns the 10 s timer; pause inputs are explicit.**
`SAVE_PROMPT_TIMEOUT_MS = 10_000` in the manager with an injected clock (MockTimers recipe). Paused while ANY input is true: pointer over the prompt; focus inside the prompt; window not focused (`win` blur/focus, minimize); a menu-overlay sheet visible in that window. Resume restores the remaining time. Each newly presented offer (queue advance, convert-in-place, or a re-ask) gets a fresh 10 s. Expiry closes with `timeout`. The page renders the bar from main-pushed `{ remainingMs, paused }`.
- Page→main `save-prompt:pointer` / `:focus` are sender-validated (this window's prompt view) and token-checked; they can only pause/resume.
- **The main-side hold still bounds everything**: `CAPTURE_DROP_MS` (2 min) can expire a paused prompt (DD6 `expired`).
- **Observability for tests**: the census exposes `savePromptPaused` alongside `savePromptVisible` (DD10), so a timeout failure is distinguishable from a focus fault (`win.isFocused()` may be false under `dev:automation`/WSLg).

**DD5 — The prompt belongs to its tab; leaving the tab drops it.**
`vault-capture-offer` gains `wcId` at BOTH send sites (`guest-wiring.js:~746`, where `wcId` is in scope; `register-browser-ipc.js:~298`, `event.sender.id`), each pinned by a unit test. The chrome presents an offer only if its tab is the window's active tab at arrival; otherwise it dismisses it at once. Any of **tab switch away, tab hide, HTML fullscreen enter, tab close, tab moved to another window, window teardown** drops the shown capture, every queued capture for that tab, AND a consented-awaiting-unlock capture for that tab. The main-side half reuses `vaultHuman.dropCapturesForTab(wcId)` (already called on tab close, `register-tab-ipc.js:354`) rather than N chrome dismiss calls; the chrome clears its own queue entries for that wcId. **Navigation inside the tab does NOT drop** (login redirect chains fire several `did-navigate`s); main-side hold rules are unchanged.
- Trade-off: a quick tab peek loses the save — accepted by the operator.
- **Two windows**: prompt A reacts only to window A's tab events and focus; only the vault-lock fan-out crosses windows.

**DD6 — Own close channel, reason vocabulary, queue, and main→chrome drop push.**
The prompt has its OWN main→chrome close channel (`save-prompt-closed { token, captureId, reason }`); its reasons never flow through `MENU_CLOSE_REASONS` / `SHEET_DISMISS_REASONS` or channel 7. `OCCLUSION_CLOSE_REASONS` and `handleClosed`'s `vault-capture` branch are retired with the sheet (DD8).
| Reason | Shown capture | Queue |
|---|---|---|
| `saved` | written | advance |
| `dismissed` (✕ / Not now / Esc) | `vaultCaptureDismiss` | advance |
| `timeout` | `vaultCaptureDismiss` | advance |
| `expired` (main dropped the record: `CAPTURE_DROP_MS`, `tab-changed`) | gone | advance |
| `unlock-requested` | held with consent (DD7) | held: `advance()` defers while the unlock sheet is visible (DD1) |
| unlock abandoned (unlock sheet closed while still locked: escape / outside-click / blur / superseded …) | dropped, `rec.consent` cleared | drop every queued locked entry and `pendingCaptureUnlock` (the existing drop-all, `vault-controller.js:~800`), unit-pinned |
| `tab-switch` / `tab-hide` / `tab-close` / `tab-moved` / `teardown` | dropped (DD5) | drop all for that tab |
| `vault-lock` | dropped main-side (`dropAllCaptures`) | clear the chrome queue |
Unknown reason → treated as `dismissed` (drop + advance), the same fail-safe-to-resolution default `auth-challenges.js` uses — never "keep pending".
- **One table, one source**: the per-reason effects (refocus guest? dismiss shown? drop tab queue? clear consent? advance?) live in a pure `src/shared/save-prompt-close-effects.js`, `savePromptCloseEffects(reason)`. The manager and the chrome client both consume it. DD2's refocus rule, DD5's drops, this table and DD7's consent clearing are all assertions against it, with a drift test.
- **Main→chrome `vault-capture-dropped { captureId }`** is pushed (owner-routed to the capture's tab's chrome) whenever main drops a held record for a reason the chrome did not initiate (`CAPTURE_DROP_MS`, `tab-changed`, tab/window close, lock). The chrome removes the id from its queue; if it is the shown prompt, the prompt switches to the "This save request expired" state (4 s) then closes `expired`. Source of truth for capture existence is main; the chrome queue is advisory and corrected by this push.
- Every vault lock (`main.js:~950-993` fan-out; `rec.savePrompt` added beside `closeVaultCredentialSheetsOnLock`) hides the prompt in all windows with `vault-lock`.
- Save result states (`save-prompt:save` returning `{saved:false, reason}`): `locked` → "Vault locked — not saved"; `invalid-vault` → "Couldn't save to that vault"; missing record → `expired` state. Each shows 4 s then closes with the matching reason.
- Queue: serial, "1 of N" from the chrome's queue length; `advance()` stays the single opener, idempotent, and defers while a sheet is open (DD1).

**DD7 — Locked flow: consent first, complete after unlock, convert in place on any unlock (Leg 2).**
- Locked login/card offers additionally carry `choices: [rec.jarId, 'global']` and `defaultVaultId: rec.jarId` (deterministic, non-secret). Identity locked offers carry no vault choice.
- "Unlock & save" → four-guarded `save-prompt:consent { token, captureId, vaultId }` (sender = this window's prompt view; token fresh; current prompt kind `vault-capture` and mode `locked`; business gate = record exists, held `locked`, owned by THIS window's active tab, `vaultId ∈ {rec.jarId,'global'}` for login/card or absent for identity). Main sets `rec.consent = { vaultId }` and closes the prompt with `unlock-requested`; on that close the chrome pushes the id onto `pendingCaptureUnlock` (populated at consent, NOT at offer arrival) and then opens `vault-unlock` (`{ keepFocus: true }`, user-initiated) — order: prompt hidden first, sheet opened in the next task.
- **Consent lifecycle**: cleared on drop (every DD5/DD6 path), on complete, and on unlock abandonment (existing drop-all). Any unlock within the hold after consent completes the save — documented: the operator already said yes; the write still re-checks everything below.
- Unlock succeeded → the drain calls the EXISTING `vaultCaptureFinalize(captureId)` (`renderer-globals.d.ts:625`). It is extended, not duplicated (design review 2, N2). There is ONE finalize path, which now also:
  - checks the sender is the chrome of the window that owns the capture's tab;
  - re-checks that the record's tab is still that window's ACTIVE tab (else `tab-changed`, no write);
  - performs the consent write below.
  Its `locked` / `expired` / `tab-changed` / `unchanged` outcomes are unchanged. After disposition: **plain `save` with `rec.consent` set and `rec.consent.vaultId ∈ rec.choices`** → `captureSave` → success state "Password saved to {vault}" (2.5 s) → `saved`; **`update` / identity gap-fill / conflict** → the resolved model re-presents, non-blocking, fresh 10 s, NO write; **`unchanged`** → "Already saved" (2.5 s); **`expired` / `tab-changed` / `locked`** → the DD6 result states. Without `rec.consent`, finalize writes nothing and only returns the model (today's behavior).
- **Convert in place** (the minimal form ships in Leg 1; see Legs): when the vault becomes unlocked by any route, the chrome finalizes locked entries lazily:
  - The visible one converts immediately: finalize without consent, then re-present as an unlocked offer with a fresh 10 s.
  - Queued ones convert when `advance()` reaches them.
  - The vault is global, so the `vault-lock-state` push converts EVERY window's visible locked prompt, including an unlock done in another window.
  A locked model is never presented while `lockState.unlocked` is true.
- The auto-raised unlock in `onVaultCaptureOffer` is removed.
- Security pins (unit, on the surviving finalize channel):
  - no consent → no write;
  - consent + `update` disposition → no write;
  - consent from another window's prompt → refused;
  - stale token → refused;
  - `vaultId` outside choices → refused;
  - finalize for a non-active tab → `tab-changed`, no write;
  - finalize from a non-owning window's chrome → refused.

**DD8 — Retire the `vault-capture` sheet; the prompt is the only save surface (Leg 1).**
Removed: the `vault-capture` template in `menu-overlay.js` (TEMPLATES map + kind dispatch, ~2866/2881/3006/3101), its markup in `menu-overlay.html`, `#sheet-vault-capture` CSS, `menu-overlay-preload.js:~101` `captureSave` + its `menu-overlay-globals.d.ts` entry, the overlay-state entry and `openCaptureSheet` in `vault-controller.js`, and `menu-overlay:vault-capture-save`. The pure builder `src/shared/vault-capture-template.js` is reused by the prompt page, adjusted for the non-modal card (no backdrop, no `aria-modal`). Comment/doc retargets: `vault-blur-survival.js` comment, `overlay-dispatch.js:~418`, `renderer.js:~476` (comment-only edit; line count must not grow — budget 1504/1505), `modal-card-controller.js` comments, `docs/renderer-menu.md:~39`, `docs/vault.md:~199,224`, the inaccurate `main.js:~989-992` `pendingCaptureUnlock` comment. Unlocked Save moves to four-guarded `save-prompt:save { token, captureId, vaultId }` (sender = prompt view; token; kind; business gate = `captureSave`), closing today's missing-menuType-guard gap.
- Tests rewritten with the change (not deleted silently): `vault-capture-template.test.js` (non-modal shape), `vault-controller-capture.test.js` (~15 queue tests re-targeted to DD6's table), `modal-card-controller.test.js` (capture cases removed), `vault-capture-handler.test.js` (moves to the prompt channel).

**DD9 — Security model of the prompt view.**
Chrome-class view: `file://` page, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a dedicated narrow preload (no `window.goldfinch`), CSP mirroring the sheet's and pinned in `csp-pins.test.js`, `textContent` only, no remote loads. Metadata only: origin, username, card brand/last4, identity field LABELS, vault ids + display labels — never a password, PAN, CVC or identity value. A jar deleted between offer and present: its choice is shown as "Unknown vault" and is not selectable (the `jars-changed` eviction makes the id stale; main still validates). Eager scrub: every hide sends a clear message that empties the DOM immediately. Every page→main channel is sender-validated by webContents identity; state-changing ones carry the four guards (DD7, DD8). **Drift guard** (N11): a pin asserts that the class names the prompt stylesheet declares cover every class `vault-capture-template.js`'s builders emit. A source-scan that throws rather than passing vacuously. New page controller gets its `eslint.config.mjs` module-`sourceType` entry; new chrome-preload methods get `renderer-globals.d.ts` entries.

**DD10 — Automation: fail-closed by mechanism, two census booleans.**
- **Fail-closed guard** (Leg 1): admin-tier `resolve.js` (~259-272) today admits any non-tab chrome-class wcId (that is how the find overlay is admin-evaluable). Add `isSavePromptContents` to `window-registry.js`, refuse it in `resolveContents` at EVERY tier, thread it into BOTH `createEngine` sites (main.js ~1545-1590) and grep-pin it like `isSheetContents`. `captureWindow` already composites only find + sheet (main.js ~807) — pin that the prompt is excluded.
- **Census**: `enumerateWindows()[i].savePromptVisible` and `.savePromptPaused` (admin, zero cached state, read live from the manager). Update `window-census.js`, `window-census.test.js`'s exact-shape `deepEqual`s, the `mcp-tools.js` (~623) tool description, and `docs/mcp-automation.md`.
- **Act path**: MCP `click`/`typeText` on the guest. **Read path**: `evaluate`/`readDom` on the guest + `enumerateWindows()` (`savePromptVisible`, `savePromptPaused`, `sheetVisible`).
- Not automatable (HAT): prompt pixels/placement, F6 into the prompt, Esc/Not now/✕, hover pause, the locked flow (master password typed into a chrome sheet by design), screen-reader announcement.
- CLAUDE.md "standing unobservable-surfaces list" gains the save-prompt view (presence observable via census; content and input unobservable at every tier).

### Prerequisites
- [x] Clean `main` at `7cdbb4e`; no open sorties or active missions overlap (checked 2026-11-04).
- [x] `renderer.js` is at 1504/1505 (`RENDERER_LINE_BUDGET`) → no new wiring there; the chrome-side client lives in `vault-controller.js` / a new `chrome/save-prompt-client.js`.
- [x] `dropCapturesForTab(wcId)` exists (`vault-human.js:1738`) and is already called on tab close.
- [x] The vault-login fixture does NOT produce an offer today (`index.html:77` `e.preventDefault()`, no navigation/detach) → **fixture extension is a Leg 1 deliverable** (see Leg 1).
- [x] *(verified in Leg 1 AC29 step 1)* `npm run dev:automation` with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1` launches and `enumerateWindows` returns `sheetVisible`. **Scheduled as the first step of Leg 1's live smoke**, using a dev-mode env-key script per the operator's standing preference, never the registered `goldfinch-dev` server, which was down during design review. Not verified at planning.
- [x] Screen reader: **none available** (operator, 2026-11-04). P3 cannot be probed. Leg 3 ships both announcement paths (chrome `#save-prompt-status` plus the in-prompt `role="status"`), and its announcement AC is recorded as **unverified** in the leg and the debrief. F6 discoverability is checked by eye in the HAT. This is a recorded gap, not a Divert: no focus steal is introduced to compensate.

### Pre-Flight Checklist
- [x] All open questions resolved (three empirical premises scheduled first in their legs)
- [x] Design decisions documented
- [x] Prerequisites verified (one live-apparatus probe scheduled at Leg 1 start, stated above)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach
1. **Main**: `save-prompt-manager.js` (per-window, `rec.savePrompt`), `save-prompt-geometry.js`, `register-save-prompt-ipc.js` (`save-prompt:pointer`, `:focus`, `:height`, `:dismiss`, `:save`, Leg 2 `:consent`, Leg 3 `:key`), lazy view construction in `window-factory.js` with explicit destroy in the close order BEFORE `sheet.teardown` (window id captured at create time; no raw `.on('closed'`). `register-tab-ipc.js` switch/hide/close/move + `html-fullscreen.js` + window blur/focus/minimize feed the manager; `tab-set-bounds` re-syncs geometry (hide-before-sync on switch). Vault: offers gain `wcId`; `vault-capture-dropped` push; Leg 2 `choices` on locked offers, `rec.consent`, the consent write on the extended `vaultCaptureFinalize`. Automation: `isSavePromptContents` guard + census booleans.
2. **Chrome**: `vault-controller.js` drops the `vault-capture` sheet branch; presents through `save-prompt-client.js` (open/close tokens, anchor measurement of `#vault-indicator` sent with open and re-sent on `tab-set-bounds`/pin changes, result states); queue/`advance()` survive with DD6's table and the any-menuType `handleClosed` retry. Leg 1: minimal convert-in-place for the interim locked path. Leg 2: auto-unlock removed, consent. Leg 3: `#save-prompt-status`.
3. **Prompt page**: renders from `vault-capture-template.js` builders; countdown bar from pushed remainder; pointer/focus signals; result states; reports content height; Leg 3 Esc/F6 forwarding.
4. **Guest side** (Leg 3): `handleCrossView` prompt hop.
5. **Docs**: `docs/vault.md`, `docs/renderer-menu.md`, `docs/mcp-automation.md`, `CLAUDE.md` (third overlay view; unobservable list; vault-capture references; F6 cycle).

### Checkpoints
- [ ] Leg 1 landed:
  - P1, P2 and P3 spiked.
  - Unlocked offers (login, card, identity) present in the corner, non-blocking, with the timer, tab, lock and drop rules and the result states.
  - The `vault-capture` sheet is retired.
  - The fail-closed guard and the census booleans are in.
  - The fixture is extended, and `save-prompt-non-blocking` Variant A passes.
  - **Interim locked path**: the unlock sheet is still auto-raised on offer arrival (`pendingCaptureUnlock` still populated at arrival). After unlock, finalize presents the result in the corner prompt as an unlocked offer. This is minimal convert-in-place, with no consent and no auto-write. Variant B is NOT run yet.
- [ ] Leg 2 landed: the locked path runs through consent → unlock → finalize-with-write / re-ask. The auto-raise is removed; `pendingCaptureUnlock` is populated at consent; there is cross-window convert-in-place; the security pins and two-window AC are in; Variant B passes.
- [ ] Leg 3 landed: the F6 hop (`handleCrossView` / `cross-view-nav.js`, prompt `:key`) and the DD3 announcement, wired according to the P3 result.
- [ ] HAT signed off by the operator watching the rendered surface.

### Adaptation Criteria

**Divert if**:
- P2 fails (flicker/stale pixels on WSLg AND a cross-platform control) — re-plan the surface before continuing.
- P1 fails and the cursor-point fallback can't drive the hover pause reliably — bring the timer trade-off back to the operator.
- P3 fails AND no accessible fallback exists without a focus steal — bring the trade-off back to the operator rather than shipping a silent prompt.
- The consent/complete split (DD7) cannot keep the vault write behind the guarded consent record — stop; this is a security boundary.

**Acceptable variations**:
- Exact pixel geometry, card height, and countdown-bar styling (the mockup is the reference; HAT tunes it).
- Lazy vs eager view creation, if a measured cost argues for eager.
- Channel names, as long as each state-changing channel carries the four guards in order.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `save-prompt-surface` — Spikes P1/P2 first, plus a 15-minute P3 probe (so a P3 Divert lands early, not on the last leg). Includes the **interim locked path** (Checkpoints) built on the minimal convert-in-place. **Explicit AC**: after `npm run format`, `renderer.js` stays ≤ 1505 lines (`RENDERER_LINE_BUDGET`), and the new client is wired from `vault-controller.js`. **Explicit fixture AC**: a trusted `click` on the capture-mode submit (after `typeText` into `#username`/`#password`) navigates, and `did-navigate` releases an offer. The per-window prompt view (manager, geometry, page, preload, IPC), DD1 deferral + hide/restore matrix + squawk-0100 ordering, offer `wcId` + DD5 tab binding, DD4 timer with all four pause inputs, DD6 close channel/table/`vault-capture-dropped`/result states, vault-lock close, unlocked save/update via `save-prompt:save`, DD8 retirement + test rewrites, DD10 fail-closed guard + census booleans, vault-login fixture extended (a mode whose submit navigates to a second page with a text input `#probe` and a `#bump` counter button, re-usable per fresh tab; profile seeded with no login for the origin), `save-prompt-non-blocking` Variant A run, docs for this slice. Locked path unchanged.
- [x] `locked-save-handoff` — DD7. It covers:
  - locked offers carrying `choices`;
  - `save-prompt:consent` and the `rec.consent` lifecycle;
  - the consent write on the extended `vaultCaptureFinalize`;
  - cross-window convert-in-place;
  - removing the auto-raised unlock, and moving `pendingCaptureUnlock` to consent time;
  - the security pins, the unlock-abandonment pin and the two-window AC;
  - the Variant B run and its docs.
- [x] `keyboard-and-announce` — The DD2 F6 hop in `handleCrossView` / `cross-view-nav.js` (injected `savePromptFor`), the prompt `:key`, the refocus rule, the DD3 `#save-prompt-status` plus the in-prompt status (as P3 allows), the shared-mechanism ACs (F6 paths and the four live regions unchanged), and docs.
- [x] `hat-and-alignment` *(optional, recommended — the native-surface rule makes a human watching the rendered prompt the acceptance signal)* — Guided HAT: unlocked + locked flows, all three kinds, F6/Esc/Tab, hover/focus/blur/sheet pause, tab-switch drop, find-bar stacking, resize, fullscreen, two windows, screen reader.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification
- Unit: manager (show-without-focus, timer pause/resume/expiry for each pause input with MockTimers, sheet-visible pause, squawk-0100 call order), geometry (pure; anchor fallback; find-bar stacking), IPC guards (sender, token, kind, business gate — each refused in isolation), chrome queue/close table incl. deferral retry and `vault-capture-dropped`, consent gate pins (DD7), fail-closed resolve guard at every tier + `createEngine` grep pin, census shape, both offer send sites carry `wcId`, F6 paths unchanged without a prompt.
- Behavior: `tests/behavior/save-prompt-non-blocking.md` Variants A (Leg 1) and B (Leg 2).
- HAT: everything DD10 lists as not automatable.
