# Leg: vault-fill-trust

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Make the vault picker something only a real click can raise, and bind every fill to the page the operator was on when it was raised: main witnesses the click itself, mints a per-open context carrying the tab's committed origin, and refuses any fill whose context is gone or whose page has changed.

This is the first of two legs that together deliver DD4 and DD6. The picker's own controls (destination line, arming, no selected row, card / identity confirmation, certificate warning) are leg `vault-picker-controls`. The flight commits once, so the two ship together as DD4 requires.

## Context

- **Decisions**: DD4 and DD5 as **revised 2026-11-13** (operator ruling "shape 1" — main observes real input; the page-side message is a hint; the page-reported icon box is an accepted, documented residual; no debugger protocol).
- **Evidence**: [`probe-results.md`](../probe-results.md) Q1–Q3; [`gesture-transport-probe.md`](../gesture-transport-probe.md); [`guard-audit.md`](../guard-audit.md) NF4, NF12; the design review's own probe on a `WebContentsView` guest (2026-11-13), which measured: `input-event` delivers `mouseDown` / `mouseUp` with `button` and view-local `x`, `y` and cannot block delivery, while `before-mouse-event` **can** (it is preventable — do not use it); a right-button press is visible through `input-event` even when the page prevents `contextmenu`, and in that case main's `context-menu` event does **not** fire; `webContents.getURL()` returned the previous committed URL throughout a pending navigation.
- **What is true today** (surveyed 2026-11-13, working tree with legs 2–3 landed):
  - A page holding the preload's IPC object can send `guest-vault-gesture` or `guest-vault-icon-menu` with no click, from a background tab; the sheet opens over whatever the operator is looking at. The `isTrusted` check (`readTrusted` in `src/preload/vault-fill-icon.js`) runs in the page's world.
  - `fillHuman` (`src/main/vault/vault-human.js`) re-checks the origin at fill time for a login only. A card or identity fills whatever page is in the tab by then.
  - With no live fill target the guest fills the page's **first** detected form (`vault-fill-fields.js`, `vault-card-fields.js`, `vault-identity-fields.js`).
  - The icon is not keyboard-reachable and nothing else opens the picker from the keyboard.
- **Decisions taken at leg design and design review** (logged in the flight log):
  1. **No key-press witness.** There is no keyboard path to the picker to guard.
  2. **The witness uses `input-event`**, never `before-mouse-event`.
  3. **A per-open picker context, main-held**, minted when a gesture is accepted. It carries the tab, the committed origin and whether the tab's navigation carries a certificate override. Its id, the destination display string and the certificate flag ride the existing `vault-gesture` push to the chrome, so every picker — including the locked-vault picker that never reads the store — has them.
  4. **The committed origin is a derived read**, not a new tab-entry field: a pure function over `getURL()` that answers nothing for non-http(s) and error-page URLs. The existing `tabOriginFor` (also used by capture and automation) is not changed.
  5. **The context survives a vault lock.** A fill against a locked vault answers `locked` as today and the chrome's existing re-raise of the unlock sheet keeps working; the context's time limit bounds it.
  6. **A witnessed click is consumed on acceptance only** — consuming on refusal would let a page burn the operator's real click with a bogus message sent first.
  7. **Human fills lose the first-form fallback**; automation's fill is byte-identical and cannot consume a human's pending target.
  8. **Fill payload transit is unchanged** (revised DD5). Stale comments are corrected.
  9. **An MCP `click` is real input to main** (it is injected below the page), so automation can raise the sheet by clicking the icon, as it can today. That is what makes the positive case testable.
- **Not in this leg**: anything the operator sees inside the picker (`vault-picker-controls`); capture (`guest-vault-capture*`), whose gesture classifier keeps its own trust read; media, downloads, prompts.

## Inputs

- Branch `flight/01-page-containment` with legs `ipc-gate` and `ipc-gate-complete` landed (uncommitted); unit suite green at 6482 pass / 0 fail.
- The gate's `tab-guest` class and its `activeOnly` switch; the `gate.owningChrome` registrations of `vault-reachable-items`, `vault-fill-human`, `vault-fill-generated` in `src/main/main.js`.
- `src/main/guest-wiring.js` (`wireGuestContents`), `closeSavePromptAndDrop` in `src/main/register-tab-ipc.js` (the one helper every tab-lifecycle site already calls), the sheet's `onClosed({ menuType, reason })` hook consumed in `src/main/window-factory.js`.
- `src/renderer/chrome/vault-controller.js` (`onVaultGesture`, `pendingVaultFlow`, `openVaultPicker`, the `locked` re-raise).
- The fixture server under `tests/behavior/fixtures/page-containment-probe/` and its `refusal.html` (the hook that lets a page keep the IPC object).

## Outputs

- A pure verifier and a per-tab witness; a picker-context module (all Electron-free, under `src/main/vault/`), wired to tab guests.
- The two guest gesture channels `activeOnly` and verified; the three chrome-facing vault channels require a context.
- Fixture `gesture.html`; behavior spec `tests/behavior/vault-gesture-trust.md` (authored with this leg).
- Updated unit tests; `docs/vault.md` and `docs/dev-testing.md` sections for what this leg changes.

## Acceptance Criteria

### Before anything is built

- [ ] The fixture page `gesture.html` is authored first (a login form; the IPC-object hook from `refusal.html`; `sendGestureNoClick()`, `sendGestureWithBox(box)`, `sendIconMenuNoClick()`).
- [ ] **Non-vacuity on the unmodified build**: `sendGestureNoClick()` raises the sheet (census `sheetVisible: true`). Recorded in the flight log.
- [ ] **Global-hook rule — premises re-run in the product build**, results in the flight log, with a throwaway listener and no other change: (1) `input-event` fires `mouseDown` / `mouseUp` for an MCP `click` and for nothing a page script does (`element.click()`, `dispatchEvent`); (2) it fires before the page's own `click`; (3) its coordinates equal `clientX × zoomFactor` at zoom 1, 1.5 and 0.67; (4) a right-button MCP click is visible when the page prevents `contextmenu`; (5) `getURL()` stays at the committed URL during a slow pending navigation; (6) with the listener attached, `before-input-event` shortcuts, F6 traversal, the page context menu, MCP `click` / `typeText` / `pressKey` / `scroll` and find-in-page behave as before. If (1) or (2) fails in the product, stop and signal `[BLOCKED]`.

### Main witnesses the click

- [ ] Each tab web guest (not popups, not internal tabs) has one `input-event` listener that records, per tab, only the last real left-button press, left-button release and right-button press — view-local coordinates and a monotonic time. Any other event type returns on the first line. The record is cleared on tab close and window close and follows the tab on a window move, using an existing per-tab lifecycle path.
- [ ] `guest-vault-gesture` and `guest-vault-icon-menu` are registered `activeOnly`.
- [ ] `guest-vault-gesture` is forwarded to the chrome only when **all** hold, checked in this order: the tab's committed origin is an http(s) tuple origin; a real left-button release was witnessed in this tab within the window (one constant, 2 s) with its press on record before it; the message carries a box of four finite numbers no larger than four times the icon's real size in either dimension; scaled by the tab's live zoom factor, with a small stated tolerance, the box contains both the press and the release point; no gesture was accepted for this tab within the rate interval (one constant, 1 s). An accepted gesture consumes the witnessed click — one real click raises at most one sheet. A refusal consumes nothing.
- [ ] `guest-vault-icon-menu` is honoured only with a witnessed real right-button **press** inside the reported box under the same window, zoom and rate rules (press only — the platform decides whether `contextmenu` fires on press or release).
- [ ] "Fill login…" in the native icon menu: the `guest-vault-icon-menu` handler runs the verifier and passes the committed origin captured at the witnessed right-press into the injected menu delegate (`popupVaultIconMenu` stays in `main.js`; the registrar stays Electron-free). The menu item's click closure mints a context and sends the enriched push only if the tab is still alive, still its window's active tab and still at that origin. The guest binds its fill target in the icon's context-menu handler exactly as its click handler does, so this path still fills now that the fallback is gone.
- [ ] The guest sends the icon's own bounding box (viewport CSS pixels, read inside the handler) with both messages. `readTrusted` is removed from the icon's two handlers; a comment states that the page's world decides nothing and main's witness is the check. The existing unit tests that assert "a scripted click is ignored" are rewritten to assert the new contract (the message is sent; main refuses it), not deleted. The capture classifier's use of the same getter is untouched.
- [ ] One trace line per decision when `GOLDFINCH_IPC_TRACE=1`: `[vault-gesture] accepted` or `[vault-gesture] refused reason=<origin | no-real-input | bad-box | outside-box | rate>`, and `[vault-icon-menu] …` likewise — no URL, title, coordinate or item data. Nothing is logged otherwise.
- [ ] The verifier is a pure function (record, message, zoom, now → decision) with a unit matrix: every refusal reason, window boundaries, tolerance at each zoom, press and release zero milliseconds apart (an injected click), consumption on acceptance only, rate.
- [ ] **Stated residual**, in `docs/vault.md` and the code: the box is page-supplied, so a page that sends the message itself can claim a box around any real click the operator made on that page. It cannot raise the sheet with no click, from a background tab, or more than once per click. With the page-world trust check gone a page can also choose which of **its own** fields is the fill target; the credential still reaches only that page. The picker's controls (next leg) are the defence against a misdirected click.

### Per-open picker context

- [ ] An accepted gesture (or an accepted "Fill login…") mints a context: an unguessable id, the tab, the committed origin, and whether the tab's security state is "certificate overridden" (the same state that drives `tab-security`). One live context per tab; a new one replaces the old. The contexts hang off the existing vault-human object beside its per-tab capture drops, so the tab-lifecycle helper needs no new parameter.
- [ ] The `vault-gesture` push carries the context id, the destination display string and the certificate flag alongside today's fields. The chrome keeps them in `pendingVaultFlow` through **every** hop: the unlocked picker, the locked sheet and the picker that follows unlock, the locked generate / unlock two-row picker, the unlock row, and the `locked` re-raise after a pick. A controller-level unit test drives each hop from `onVaultGesture` and asserts the id reaches the fill call.
- [ ] The destination display string comes from one pure shared function — host as the URL parser serialises it (punycode for non-ASCII) plus a non-default port; an `http:` origin keeps its scheme. Unit-tested with an IDN host, a port and http. (It is rendered by the next leg; this leg only produces and carries it.)
- [ ] `vault-reachable-items`, `vault-fill-human` and `vault-fill-generated` each take the context id and refuse without a live context for that tab and id. Their argument shapes, tab-id extractors, bridge methods and type declarations are updated together; `vault-reachable-items` still returns a plain array.
- [ ] At fill, for **every** item type and for a generated password, the tab's committed origin must equal the context's origin; otherwise nothing is sent to the guest. Unit-pinned per type. (NF12: the origin is the derived committed read; a unit test pins that a URL the function is given for an error page or a non-http(s) scheme yields no origin.)
- [ ] The context is dropped: by a fill that used it; by `did-navigate` on that tab (a cross-document main-frame commit, including a reload) and deliberately **not** by `did-navigate-in-page` (same origin; the fill-time check covers it); through `closeSavePromptAndDrop`'s sites (tab switch, hide, close, move, and fullscreen entry via `html-fullscreen.js`); at window close, through the existing window-closed path (never a raw `closed` listener); when the sheet's `onClosed` reports **`vault-picker` or `vault-unlock`** — no other menu type — closing for a dismissal reason (an explicit allowlist: escape, outside click, blur, teardown and the tab reasons; never `activated`, `superseded` or `vault-lock`), in which case every context belonging to a tab of that window is dropped, since `onClosed` names no tab; and at a time limit. It survives a vault lock. The time limit and the guest's fill-target lifetime are **one shared constant, 120 s** (the guest's is 60 s today), so an unlock that takes a minute does not end in a silent no-fill.
- [ ] Unit-pinned facts the allowlist relies on: a successful unlock closes its sheet with `activated` (context kept); the unlock row replacing the picker closes with `superseded` (kept); a vault lock closes with `vault-lock` (kept).
- [ ] A refused context at any of the three channels writes one trace line when the trace is on — `[vault-gesture] context-refused reason=<missing | stale | origin>` — so the smoke's substitute for a real pick is observable.
- [ ] A lifecycle unit matrix covers mint, replace, each drop reason, the time limit, and a stale id.
- [ ] Chrome recovery leaves no usable context (the chrome has lost the id; the context ages out).

### Fill target

- [ ] A human fill (login, card, identity, generated) with no live fill target in the guest fills **nothing**. This is an explicit option on the three field modules, off by default, so automation's behaviour and its existing tests are unchanged. Main marks each fill message as human; the preload passes the option only for those, and an automation fill never consumes a human's pending target. Unit-pinned both ways; the isolated-world bundle is rebuilt.
- [ ] The preload comments claiming a page cannot listen for `vault-fill*` are replaced with what Leg 1 found.
- [ ] The automation fill's gates are unchanged (`vault-context.test.js` green with no edit to its assertions).

### Shared mechanisms (each sharer asserted unaffected)

- [ ] **Guest input and event wiring** — sharers: shortcuts, F6 cross-view traversal, the save prompt's key handling, the page context menu, fullscreen exit, MCP input. Assertion: premise (6) above; `guest-wiring.test.js` source pins hold.
- [ ] **`closeSavePromptAndDrop`** — sharers: the save prompt and capture drops. Assertion: its existing suites green; the new drop is additive.
- [ ] **The sheet's `onClosed`** — sharer: auth challenges. Assertion: `auth-challenges` suites green; the new consumer reads only menu type and reason.
- [ ] **The `vault-gesture` push and the three channels' shapes** — every consumer found by search and updated; `vault-controller-generate.test.js`, `register-browser-ipc.test.js`, `ipc-gate.test.js` updated where they pin the old shapes.
- [ ] **Isolated-world observer** — sharers: capture, provenance, generated fill, the save prompt. Assertion: capture corpus and save-prompt suites green; the observer build's installed assertion holds.

### Behaviour and regression

- [ ] `/mission-control:behavior-test vault-gesture-trust` passes (run by the Flight Director).
- [ ] Live smoke (dev mode, env-key scripts) exercises every apparatus primitive against the new state, and: a real click on the icon at zoom 1 and at zoom 1.5 (driver coordinates multiplied by the zoom) raises the sheet; a tab switch closes it; a navigation with the sheet open drops the context (a following `vault-fill-human` through the chrome bridge is refused — a substitute for the real pick, which is unscriptable, and stated as such); a right-button MCP click on the icon logs an icon-menu acceptance (the native menu itself is unobservable — the run restarts the app afterwards); a second window on the same jar is unaffected by the first window's gesture.
- [ ] `docs/dev-testing.md` gains the recipe for making the fill icon appear under automation (give the guest OS focus through the chrome's own focus call, then focus the field, with `document.hasFocus()` as the positive control).
- [ ] `[by-eye]`, deferred to `hat-and-alignment` and listed there by this leg: a **physical** pointer click raising the sheet, including at an OS display scale other than 100%; the native icon menu and "Fill login…"; an actual fill of each type; a fill refused after navigating with the picker open; the unlock-then-pick path. Known and documented, not fixed here: a touch tap produces no mouse press for the witness; Ctrl+click as a context-menu trigger is a left press.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `renderer.js` ≤ 1505 lines (no edit expected), evaluate seam 41.

## Verification Steps

1. Fixture, non-vacuity run, premise re-run — recorded before any product change.
2. Unit suites with the runner's timeout: verifier matrix, context lifecycle, controller hops, fill-target option.
3. Live smoke with the trace on; stdout saved outside the project tree.
4. Flight Director: `vault-gesture-trust`, and a re-run of `guest-ipc-refusal` (shared fixture server and hook).

## Implementation Guidance

1. Fixture → non-vacuity → premises. Stop on a failed premise.
2. Verifier and witness (pure, unit matrix), wired into the two guest handlers; guest sends the box; icon tests rewritten.
3. Context module and its drops; the push carries id, destination, certificate flag.
4. Chrome threading through `pendingVaultFlow`; the three channels require the id; origin equality at fill.
5. Fill-target option; "Fill login…" target binding; comments.
6. Smoke; docs.

## Edge Cases

- **Double-click on the icon**: the second message meets the rate rule.
- **Zoom changed between click and message**: the live factor is read at verification; a mismatch refuses.
- **Press on the icon, release off it**: refused — and the page's own `click` would not fire either.
- **A transformed ancestor** inflates the icon's measured box: allowed up to the four-times bound.
- **Injected clicks have press and release in the same instant**: ordering is checked, never a minimum duration.
- **The sheet covers the guest while open**: a real click on it never reaches the guest, so no new witness is recorded while a sheet is up.
- **A native menu left open across a tab switch or navigation**: the menu-click re-check refuses to mint. Left open longer than the shared time limit, it fills nothing.
- **A right button held longer than the witness window** on a platform that fires `contextmenu` on release: refused; the operator right-clicks again.
- **A fill that passes the origin check while a cross-document navigation is pending**: the message reaches the new document, whose preload holds no fill target, so nothing is filled — the reason the no-fallback rule is unconditional for human fills. Stated in `docs/vault.md`.
- **Unlock abandoned**: the chrome clears its own state; main's context lingers until its time limit and is harmless without the chrome's id.
- **A document served with an opaque origin at an http(s) URL** (sandboxing response header): treated by URL; it only affects that page's own fill.
- **Two windows on one jar**: witness and context are per tab.
- **Verbatim-move TDZ check** for any handler body moved into a new scope.

## Files Affected

`src/main/vault/` (new verifier/witness and picker-context modules; `vault-human.js`), `src/main/guest-wiring.js`, `src/main/register-browser-ipc.js`, `src/main/register-tab-ipc.js` (`closeSavePromptAndDrop`), `src/main/window-factory.js` (`onClosed` consumer, window close), `src/main/main.js` (fill delegates, `popupVaultIconMenu`, the three registrations), `src/main/ipc-channel-table.js` only if a channel is added, `src/preload/vault-fill-icon.js`, `src/preload/webview-preload.js`, `src/preload/vault-entry-tracker.js`, `src/preload/vault-entry-observer.js`, `src/preload/vault-fill-fields.js`, `src/preload/vault-card-fields.js`, `src/preload/vault-identity-fields.js`, `src/main/html-fullscreen.js` (only if the drop helper's call there needs it), a new shared destination-display module, `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, `src/renderer/chrome/vault-controller.js`, their unit tests — expect edits in `vault-fill-icon.test.js`, `vault-card-icon.test.js`, `vault-controller-generate.test.js`, `register-browser-ipc.test.js`, `ipc-gate.test.js`, `generate-gesture-contract.test.js`, `vault-human.test.js`, `vault-human-capture-dropped.test.js`, the three field-module suites and the two generated-fill suites, `guest-wiring.test.js`, `popup-parity-pins.test.js`, and re-checks of `preload-channel-literals.test.js`, `ipc-gate-invariant.test.js`, `webview-preload-bundle.test.js`, `vault-entry-observer-bundle.test.js` (both generated bundles are rebuilt by `npm run build:preload`) — `tests/behavior/fixtures/page-containment-probe/pages/gesture.html`, `docs/vault.md`, `docs/dev-testing.md`.

## Citation Audit

From a code survey and a design review of the working tree on 2026-11-13 (legs 2–3 landed, uncommitted), cited by symbol: `vault-fill-icon.js` — `createVaultIconController`, `onIconClick`, `onIconContextMenu`, `readTrusted`, `pendingFillTarget`; `webview-preload.js` — the `vault-fill*` listeners, `consumeFillTarget`; `register-browser-ipc.js` — "gate.tabGuest.on('guest-vault-gesture', {}", `validateGenerateGesture`; `main.js` — `popupVaultIconMenu`, the `vault-reachable-items` / `vault-fill-human` / `vault-fill-generated` registrations, the human and automation fill delegates; `vault-human.js` — `reachableItems`, `fillHuman`, `tabOriginFor`, `fillGenerated`; `vault-controller.js` — `onVaultGesture`, `openVaultPicker`, `pendingVaultFlow`; `register-tab-ipc.js` — `closeSavePromptAndDrop`; `menu-overlay-manager.js` — `onClosed`; `automation/input.js` — `mouseClickEvents` (move, press, release as one burst, coordinates passed through unchanged). The design review verified the six premises the first draft left open; its numbers are in the flight log.

## Post-Completion Checklist

- [ ] Leg status `landed`; flight log entry under `## Leg Progress` with premise results, the constants chosen, neuter text, smoke observations, the by-eye list and any deviation.
- [ ] No commit. Signal `[LAND:leg]`.
